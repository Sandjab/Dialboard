# Assets images sur carte SD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stocker les assets image (fonds, images placées, packs animés) sur la carte microSD du K718 avec repli LittleFS, pour permettre des layouts plus riches en images.

**Architecture:** Un helper `asset_fs` choisit le FS cible (SD vs LittleFS) derrière `fs::FS&` et centralise la résolution de chemin (préfixe `/dialboard` sur SD). La logique pure de décision/préfixe est isolée dans `asset_path` (testable en natif). Le HAL `k718_sd` (header-only) monte la SD au boot. Les loaders `view.cpp` et les handlers `api.cpp` passent par le helper ; le pipeline de rendu LVGL (chargement PSRAM) est inchangé.

**Tech Stack:** C++/Arduino (ESP32-S3), LVGL 9.5, lib core `SD_MMC` (SDMMC 4-bit), `LittleFS`, PlatformIO, tests natifs Unity.

**Spec:** `docs/superpowers/specs/2026-06-23-assets-sur-sd-design.md`

---

## File Structure

- **Create** `src/asset_path.h` / `src/asset_path.cpp` — logique pure (sans Arduino) : décision source de lecture + résolution de préfixe. Compilé en natif ET esp32s3.
- **Create** `lib/board_k718/k718_sd.h` — HAL SDMMC, header-only `static inline` (convention du board).
- **Create** `src/asset_fs.h` / `src/asset_fs.cpp` — helper Arduino : init, `asset_open_read`, `asset_fs_target`, `asset_resolve`. Compilé en esp32s3 seulement (dépend de SD_MMC/LittleFS).
- **Modify** `src/main.cpp` — appel `asset_fs_init()` au boot.
- **Modify** `src/view.cpp` — 3 loaders lisent via `asset_open_read`.
- **Modify** `src/api.cpp` — 9 handlers (upload/done/get) + 3 sweeps + `/status` passent par `asset_fs`.
- **Modify** `test/test_core/test_main.cpp` — tests de la logique pure.
- **Modify** `platformio.ini` — ajoute `asset_path.cpp` au `build_src_filter` natif.

---

### Task 1 : Logique pure `asset_path` (TDD natif)

**Files:**
- Create: `src/asset_path.h`
- Create: `src/asset_path.cpp`
- Modify: `test/test_core/test_main.cpp` (include ligne 7-zone, tests, `RUN_TEST`)
- Modify: `platformio.ini:32`

- [ ] **Step 1 : Écrire le header (déclarations pures)**

Create `src/asset_path.h` :

```cpp
#pragma once
#include <stddef.h>

// Source de lecture d'un asset.
enum AssetSource { ASSET_SD, ASSET_LITTLEFS };

// SD primaire + fallback : on lit sur SD si elle est active ET que le fichier y est,
// sinon on retombe sur LittleFS.
AssetSource asset_source_for_read(bool sd_active, bool exists_on_sd);

// Chemin physique pour le FS cible. Sur SD on isole sous "/dialboard" pour ne jamais
// toucher les données de l'utilisateur ; sur LittleFS le chemin logique est utilisé tel quel.
// `logical` commence par '/', ex. "/img/ab12.565a". Tronque proprement si out_sz est court.
void asset_resolve_path(char* out, size_t out_sz, const char* logical, bool sd_active);
```

- [ ] **Step 2 : Écrire les tests qui échouent**

In `test/test_core/test_main.cpp`, ajouter après la ligne `#include "context.h"` (ligne 7) :

```cpp
#include "asset_path.h"
```

Ajouter les fonctions de test (à côté des autres, ex. après `test_hex_fallback`) :

```cpp
void test_asset_read_sd_when_active_and_present(void) {
    TEST_ASSERT_EQUAL_INT(ASSET_SD, asset_source_for_read(true, true));
}
void test_asset_read_fallback_when_absent_on_sd(void) {
    TEST_ASSERT_EQUAL_INT(ASSET_LITTLEFS, asset_source_for_read(true, false));
}
void test_asset_read_littlefs_when_no_card(void) {
    TEST_ASSERT_EQUAL_INT(ASSET_LITTLEFS, asset_source_for_read(false, false));
    TEST_ASSERT_EQUAL_INT(ASSET_LITTLEFS, asset_source_for_read(false, true));
}
void test_asset_resolve_prefixes_on_sd(void) {
    char out[80];
    asset_resolve_path(out, sizeof(out), "/img/ab12.565a", true);
    TEST_ASSERT_EQUAL_STRING("/dialboard/img/ab12.565a", out);
}
void test_asset_resolve_bare_on_littlefs(void) {
    char out[80];
    asset_resolve_path(out, sizeof(out), "/bg/ab12.565", false);
    TEST_ASSERT_EQUAL_STRING("/bg/ab12.565", out);
}
```

Enregistrer les tests dans `main()` (avant `UNITY_END()`, après la dernière ligne `RUN_TEST(...)` vers la ligne 997) :

```cpp
    RUN_TEST(test_asset_read_sd_when_active_and_present);
    RUN_TEST(test_asset_read_fallback_when_absent_on_sd);
    RUN_TEST(test_asset_read_littlefs_when_no_card);
    RUN_TEST(test_asset_resolve_prefixes_on_sd);
    RUN_TEST(test_asset_resolve_bare_on_littlefs);
```

Ajouter `asset_path.cpp` au filtre natif. Remplacer `platformio.ini:32` :

```ini
build_src_filter = -<*> +<dashboard.cpp> +<format.cpp> +<color.cpp> +<nav_logic.cpp> +<context.cpp> +<asset_path.cpp>
```

- [ ] **Step 3 : Lancer les tests pour vérifier l'échec**

Run: `pio test -e native`
Expected: échec de compilation/link — `asset_source_for_read` / `asset_resolve_path` non définis (le `.cpp` n'existe pas encore).

- [ ] **Step 4 : Écrire l'implémentation minimale**

Create `src/asset_path.cpp` :

```cpp
#include "asset_path.h"
#include <stdio.h>

AssetSource asset_source_for_read(bool sd_active, bool exists_on_sd) {
    return (sd_active && exists_on_sd) ? ASSET_SD : ASSET_LITTLEFS;
}

void asset_resolve_path(char* out, size_t out_sz, const char* logical, bool sd_active) {
    if (sd_active) snprintf(out, out_sz, "/dialboard%s", logical);
    else           snprintf(out, out_sz, "%s", logical);
}
```

- [ ] **Step 5 : Lancer les tests pour vérifier le succès**

Run: `pio test -e native`
Expected: PASS (tous les tests, y compris les 5 nouveaux).

- [ ] **Step 6 : Commit**

```bash
git add src/asset_path.h src/asset_path.cpp test/test_core/test_main.cpp platformio.ini
git commit -m "feat(sd): logique pure de routage/résolution d'assets (asset_path)"
```

---

### Task 2 : HAL SDMMC `k718_sd.h` (header-only)

**Files:**
- Create: `lib/board_k718/k718_sd.h`

- [ ] **Step 1 : Écrire le header**

Create `lib/board_k718/k718_sd.h` :

```cpp
#pragma once
#include <SD_MMC.h>
#include "k718_pins.h"

// Monte la carte microSD en SDMMC 4-bit, sans formatage automatique.
// Renvoie true si une carte FAT a été montée. À appeler une fois au boot (montage
// au boot uniquement : pas de card-detect sur ce board, insertion à chaud non gérée).
// NB : FAT32 recommandé — l'exFAT (souvent les SDXC > 32 Go) n'est pas garanti par le
// build FATFS et peut échouer au montage (on retombe alors sur LittleFS).
static inline bool k718_sd_begin() {
    if (!SD_MMC.setPins(SD_CLK_PIN, SD_CMD_PIN, SD_D0_PIN, SD_D1_PIN, SD_D2_PIN, SD_D3_PIN))
        return false;
    if (!SD_MMC.begin("/sdcard", /*mode1bit=*/false, /*format_if_mount_failed=*/false))
        return false;
    return SD_MMC.cardType() != CARD_NONE;
}
```

- [ ] **Step 2 : Vérifier la compilation (intégrée à Task 3)**

Pas de test natif (I/O matérielle). La compilation est validée quand `asset_fs.cpp` (Task 3) inclut ce header et que `pio run -e esp32s3` passe.

- [ ] **Step 3 : Commit**

```bash
git add lib/board_k718/k718_sd.h
git commit -m "feat(sd): HAL k718_sd_begin (SDMMC 4-bit, sans format auto)"
```

---

### Task 3 : Helper `asset_fs` (Arduino)

**Files:**
- Create: `src/asset_fs.h`
- Create: `src/asset_fs.cpp`

- [ ] **Step 1 : Écrire le header**

Create `src/asset_fs.h` :

```cpp
#pragma once
#include <FS.h>
#include <Arduino.h>

// Initialise la couche d'assets : monte la SD (k718_sd_begin) et crée /dialboard/{bg,img,aimg}
// si la carte est active. À appeler une fois au boot, après persist_begin().
void    asset_fs_init();

// La SD est-elle montée et utilisable comme stockage primaire d'assets ?
bool    asset_fs_sd_active();

// Chemin physique pour le FS cible : "/dialboard"+logical sur SD, logical nu sinon.
String  asset_resolve(const char* logical);

// Ouvre un asset en lecture : SD d'abord (chemin résolu) si présent, sinon LittleFS (nu).
File    asset_open_read(const char* logical);

// FS cible des écritures et du balayage GC : SD_MMC si active, sinon LittleFS.
fs::FS& asset_fs_target();
```

- [ ] **Step 2 : Écrire l'implémentation**

Create `src/asset_fs.cpp` :

```cpp
#include "asset_fs.h"
#include <LittleFS.h>
#include <SD_MMC.h>
#include "k718_sd.h"
#include "asset_path.h"
#include "config.h"

static bool s_sd_active = false;

bool asset_fs_sd_active() { return s_sd_active; }

fs::FS& asset_fs_target() {
    return s_sd_active ? (fs::FS&)SD_MMC : (fs::FS&)LittleFS;
}

String asset_resolve(const char* logical) {
    char out[80];
    asset_resolve_path(out, sizeof(out), logical, s_sd_active);
    return String(out);
}

void asset_fs_init() {
    s_sd_active = k718_sd_begin();
    if (!s_sd_active) { Serial.println("[sd] absente/non montee -> LittleFS"); return; }
    Serial.printf("[sd] montee, %lu Mo\n", (unsigned long)(SD_MMC.cardSize() >> 20));
    if (!SD_MMC.exists("/dialboard"))            SD_MMC.mkdir("/dialboard");
    if (!SD_MMC.exists(asset_resolve(BG_DIR)))   SD_MMC.mkdir(asset_resolve(BG_DIR));
    if (!SD_MMC.exists(asset_resolve(IMG_DIR)))  SD_MMC.mkdir(asset_resolve(IMG_DIR));
    if (!SD_MMC.exists(asset_resolve(AIMG_DIR))) SD_MMC.mkdir(asset_resolve(AIMG_DIR));
}

File asset_open_read(const char* logical) {
    if (s_sd_active) {
        String sp = asset_resolve(logical);
        if (SD_MMC.exists(sp)) {
            File f = SD_MMC.open(sp, "r");
            if (f) return f;
        }
    }
    return LittleFS.open(logical, "r");   // fallback : chemin logique nu
}
```

- [ ] **Step 3 : Vérifier la compilation (sans câblage runtime encore)**

Run: `pio run -e esp32s3`
Expected: build OK (le helper compile ; `SD_MMC` résolu via `#if SOC_SDMMC_HOST_SUPPORTED` pour l'ESP32-S3). Pas encore appelé : aucun changement de comportement.

- [ ] **Step 4 : Commit**

```bash
git add src/asset_fs.h src/asset_fs.cpp
git commit -m "feat(sd): helper asset_fs (lecture fallback + FS cible + résolution /dialboard)"
```

---

### Task 4 : Câbler l'init au boot

**Files:**
- Modify: `src/main.cpp:48-57`

- [ ] **Step 1 : Ajouter l'include**

In `src/main.cpp`, après la ligne `#include "secret_store.h"` (ligne 15) :

```cpp
#include "asset_fs.h"
```

- [ ] **Step 2 : Appeler `asset_fs_init()` au boot**

In `src/main.cpp`, dans `setup()`, après la ligne `secret_store_begin();` (ligne 57) :

```cpp
    asset_fs_init();        // monte la SD (si présente) + crée /dialboard/{bg,img,aimg}
```

(`asset_fs_init()` appelle `k718_sd_begin()` en interne ; l'ordre vis-à-vis de `persist_begin()` est indifférent, les deux FS sont indépendants.)

- [ ] **Step 3 : Vérifier la compilation**

Run: `pio run -e esp32s3`
Expected: build OK.

- [ ] **Step 4 : Commit**

```bash
git add src/main.cpp
git commit -m "feat(sd): monter la SD au boot (asset_fs_init)"
```

---

### Task 5 : Loaders `view.cpp` → lecture via `asset_open_read`

**Files:**
- Modify: `src/view.cpp` (include + 3 occurrences de `LittleFS.open(path, "r")`)

- [ ] **Step 1 : Ajouter l'include**

In `src/view.cpp`, à côté des autres includes projet (ex. après `#include "config.h"`) :

```cpp
#include "asset_fs.h"
```

- [ ] **Step 2 : Remplacer les 3 ouvertures**

Dans `bg_load_page`, `img_load_component`, `aimg_load_component`, remplacer chaque occurrence :

```cpp
    File f = LittleFS.open(path, "r");
```

par :

```cpp
    File f = asset_open_read(path);
```

(Les 3 loaders gèrent déjà `if (!f) return false;` juste après — inchangé.)

- [ ] **Step 3 : Vérifier la compilation**

Run: `pio run -e esp32s3`
Expected: build OK.

- [ ] **Step 4 : Commit**

```bash
git add src/view.cpp
git commit -m "feat(sd): loaders d'images lisent via asset_open_read (SD->LittleFS)"
```

---

### Task 6 : Handlers `api.cpp` upload/done/get → `asset_fs`

**Files:**
- Modify: `src/api.cpp` (include + handlers bg/img/aimg : `*_upload`, `*_done`, `*_get`)

- [ ] **Step 1 : Ajouter les includes**

In `src/api.cpp`, après `#include "persist.h"` (ligne 14) :

```cpp
#include "asset_fs.h"
#include <SD_MMC.h>
```

- [ ] **Step 2 : Adapter `h_bgimage_upload` (lignes 269-280)**

Remplacer le corps de `UPLOAD_FILE_START` :

```cpp
    if (up.status == UPLOAD_FILE_START) {
        String dir = asset_resolve(BG_DIR);
        if (!asset_fs_target().exists(dir)) asset_fs_target().mkdir(dir);
        s_bg_written = 0;
        s_bg_up = asset_fs_target().open(asset_resolve(BG_TMP), "w");
    } else if (up.status == UPLOAD_FILE_WRITE) {
```

- [ ] **Step 3 : Adapter `h_bgimage_done` (lignes 282-299)**

Remplacer les accès `LittleFS` :

```cpp
static void h_bgimage_done() {
    String key = S->arg("key");
    String tmp = asset_resolve(BG_TMP);
    if (s_bg_written != BG_IMG_BYTES) {
        asset_fs_target().remove(tmp);
        S->send(400, "text/plain", "bad size (expected 259200)\n"); return;
    }
    if (!bg_key_valid(key.c_str())) {
        asset_fs_target().remove(tmp);
        S->send(400, "text/plain", "bad key\n"); return;
    }
    String dst = asset_resolve((String(BG_DIR) + "/" + key + ".565").c_str());
    asset_fs_target().remove(dst);                       // rename echoue si la cible existe
    if (!asset_fs_target().rename(tmp, dst)) {
        asset_fs_target().remove(tmp);
        S->send(500, "text/plain", "FS rename failed\n"); return;
    }
    S->send(200, "application/json", "{\"ok\":true}\n");
}
```

- [ ] **Step 4 : Adapter `h_bgimage_get` (lignes 301-309)**

```cpp
static void h_bgimage_get() {
    String key = S->arg("key");
    if (!bg_key_valid(key.c_str())) { S->send(400, "text/plain", "bad key\n"); return; }
    String path = String(BG_DIR) + "/" + key + ".565";
    File f = asset_open_read(path.c_str());
    if (!f) { S->send(404, "text/plain", "not found\n"); return; }
    S->streamFile(f, "application/octet-stream");
    f.close();
}
```

- [ ] **Step 5 : Adapter les handlers image (`h_image_upload` 316-327, `h_image_done` 329-348, `h_image_get` 350-358)**

`h_image_upload` — `UPLOAD_FILE_START` :

```cpp
    if (up.status == UPLOAD_FILE_START) {
        String dir = asset_resolve(IMG_DIR);
        if (!asset_fs_target().exists(dir)) asset_fs_target().mkdir(dir);
        s_img_written = 0;
        s_img_up = asset_fs_target().open(asset_resolve(IMG_TMP), "w");
    } else if (up.status == UPLOAD_FILE_WRITE) {
```

`h_image_done` :

```cpp
static void h_image_done() {
    String key = S->arg("key");
    String tmp = asset_resolve(IMG_TMP);
    if (s_img_written == 0 || s_img_written > (size_t)IMG_MAX_BYTES || (s_img_written % IMG_PX_BYTES) != 0) {
        asset_fs_target().remove(tmp);
        S->send(400, "text/plain", "bad size\n"); return;
    }
    if (!bg_key_valid(key.c_str())) {
        asset_fs_target().remove(tmp);
        S->send(400, "text/plain", "bad key\n"); return;
    }
    String dst = asset_resolve((String(IMG_DIR) + "/" + key + ".565a").c_str());
    asset_fs_target().remove(dst);
    if (!asset_fs_target().rename(tmp, dst)) {
        asset_fs_target().remove(tmp);
        S->send(500, "text/plain", "FS rename failed\n"); return;
    }
    S->send(200, "application/json", "{\"ok\":true}\n");
}
```

`h_image_get` :

```cpp
static void h_image_get() {
    String key = S->arg("key");
    if (!bg_key_valid(key.c_str())) { S->send(400, "text/plain", "bad key\n"); return; }
    String path = String(IMG_DIR) + "/" + key + ".565a";
    File f = asset_open_read(path.c_str());
    if (!f) { S->send(404, "text/plain", "not found\n"); return; }
    S->streamFile(f, "application/octet-stream");
    f.close();
}
```

- [ ] **Step 6 : Adapter les handlers aimg (`h_aimg_upload`, `h_aimg_done`, `h_aimg_get`, lignes ~360-402)**

`h_aimg_upload` — `UPLOAD_FILE_START` (même motif) :

```cpp
    if (up.status == UPLOAD_FILE_START) {
        String dir = asset_resolve(AIMG_DIR);
        if (!asset_fs_target().exists(dir)) asset_fs_target().mkdir(dir);
        s_aimg_written = 0;
        s_aimg_up = asset_fs_target().open(asset_resolve(AIMG_TMP), "w");
    } else if (up.status == UPLOAD_FILE_WRITE) {
```

`h_aimg_done` — remplacer `LittleFS.remove(AIMG_TMP)` par `asset_fs_target().remove(tmp)` (avec `String tmp = asset_resolve(AIMG_TMP);` en tête), et le bloc rename :

```cpp
    String dst = asset_resolve((String(AIMG_DIR) + "/" + key + ".565p").c_str());
    asset_fs_target().remove(dst);
    if (!asset_fs_target().rename(tmp, dst)) {
        asset_fs_target().remove(tmp);
        S->send(500, "text/plain", "FS rename failed\n"); return;
    }
```

`h_aimg_get` — remplacer l'ouverture :

```cpp
    String path = String(AIMG_DIR) + "/" + key + ".565p";
    File f = asset_open_read(path.c_str());
```

(Vérifier le nom exact de la variable de taille du pack — `s_aimg_written` — et conserver les checks de taille/validité existants tels quels, en n'échangeant que `LittleFS.*` → `asset_fs_target().*` et `*_TMP` → `asset_resolve(*_TMP)`.)

- [ ] **Step 7 : Vérifier la compilation**

Run: `pio run -e esp32s3`
Expected: build OK.

- [ ] **Step 8 : Commit**

```bash
git add src/api.cpp
git commit -m "feat(sd): upload/get d'assets via asset_fs (écriture SD + lecture fallback)"
```

---

### Task 7 : Sweeps GC `api.cpp` → `asset_fs_target`

**Files:**
- Modify: `src/api.cpp:96-162` (les 3 blocs sweep dans `h_set_layout`)

- [ ] **Step 1 : Adapter le sweep `/bg` (lignes 98-117)**

Remplacer `File dir = LittleFS.open(BG_DIR);` par :

```cpp
        File dir = asset_fs_target().open(asset_resolve(BG_DIR));
```

Remplacer `victims[nv++] = String(BG_DIR) + "/" + base;` par :

```cpp
                if (!referenced) victims[nv++] = asset_resolve((String(BG_DIR) + "/" + base).c_str());
```

Remplacer `for (int i = 0; i < nv; i++) LittleFS.remove(victims[i]);` par :

```cpp
        for (int i = 0; i < nv; i++) asset_fs_target().remove(victims[i]);
```

- [ ] **Step 2 : Adapter le sweep `/img` (lignes 119-139)**

Mêmes 3 remplacements avec `IMG_DIR` :

```cpp
        File dir = asset_fs_target().open(asset_resolve(IMG_DIR));
```
```cpp
                if (!referenced) victims[nv++] = asset_resolve((String(IMG_DIR) + "/" + b).c_str());
```
```cpp
        for (int i = 0; i < nv; i++) asset_fs_target().remove(victims[i]);
```

- [ ] **Step 3 : Adapter le sweep `/aimg` (lignes 141-161)**

Mêmes 3 remplacements avec `AIMG_DIR` :

```cpp
        File dir = asset_fs_target().open(asset_resolve(AIMG_DIR));
```
```cpp
                if (!referenced) victims[nv++] = asset_resolve((String(AIMG_DIR) + "/" + b).c_str());
```
```cpp
        for (int i = 0; i < nv; i++) asset_fs_target().remove(victims[i]);
```

- [ ] **Step 4 : Vérifier la compilation**

Run: `pio run -e esp32s3`
Expected: build OK. Le sweep ne regarde plus que `/dialboard/...` sur SD → données utilisateur jamais touchées.

- [ ] **Step 5 : Commit**

```bash
git add src/api.cpp
git commit -m "feat(sd): sweeps GC balaient le FS cible (isolés sous /dialboard sur SD)"
```

---

### Task 8 : Exposer l'état SD dans `/status`

**Files:**
- Modify: `src/api.cpp` (`h_status`)

- [ ] **Step 1 : Ajouter le bloc `sd` dans `h_status`**

Dans `h_status`, après `doc["components"] = D->comp_count;` :

```cpp
    JsonObject sd = doc["sd"].to<JsonObject>();
    sd["mounted"] = asset_fs_sd_active();
    if (asset_fs_sd_active()) {
        sd["size_mb"] = (uint32_t)(SD_MMC.cardSize() >> 20);
        sd["used_mb"] = (uint32_t)(SD_MMC.usedBytes() >> 20);
    }
```

(`<SD_MMC.h>` est déjà inclus en Task 6.)

- [ ] **Step 2 : Vérifier la compilation**

Run: `pio run -e esp32s3`
Expected: build OK.

- [ ] **Step 3 : Commit**

```bash
git add src/api.cpp
git commit -m "feat(sd): /status expose l'état de la carte (mounted/size/used)"
```

---

### Task 9 : Vérification d'ensemble (build + natif + designer + device)

**Files:** aucun (vérification).

- [ ] **Step 1 : Tests natifs**

Run: `pio test -e native`
Expected: PASS (dont les 5 tests `asset_*`).

- [ ] **Step 2 : Build firmware**

Run: `pio run -e esp32s3`
Expected: SUCCESS.

- [ ] **Step 3 : Non-régression designer**

Run: `cd designer && node --test`
Expected: PASS (protocole/format inchangés).

- [ ] **Step 4 : Vérification device (manuelle, evidence)**

Flasher (`pio run -e esp32s3 -t upload`), puis vérifier :
- **Carte FAT32 non vide insérée** : `GET /status` → `sd.mounted=true` ; pousser une image via le designer → fichier présent sous `/dialboard/img/` sur la carte ; les fichiers préexistants de la carte sont intacts ; l'image s'affiche.
- **Survie au `uploadfs`** : `pio run -e esp32s3 -t uploadfs` puis recharger la page → l'asset poussé sur SD est toujours affiché.
- **Sans carte** : `sd.mounted=false` ; comportement identique à avant (assets servis depuis LittleFS).

Documenter le résultat réel de chaque sous-cas (ne déclarer « marche » que sur les cas exécutés).

---

## Self-Review

**1. Spec coverage**
- Décision 1 (SD primaire + fallback) → Task 1 (`asset_source_for_read`) + Task 3 (`asset_open_read`, `asset_fs_target`). ✓
- Décision 2 (montage au boot) → Task 2 (`k718_sd_begin`) + Task 4 (appel unique). ✓
- Décision 3 (4-bit, pas de format) → Task 2. ✓
- Décision 4 (legacy lu/non balayé) → Task 3 (fallback chemin nu LittleFS) + Task 7 (sweep FS cible seul). ✓
- Décision 5 (isolation `/dialboard`) → Task 1 (`asset_resolve_path`) + Task 3 (`asset_resolve` + mkdir) + Tasks 6/7 (chemins résolus). ✓
- Décision 6 (`/status` SD) → Task 8. ✓
- Décision 7 (exFAT/FAT32) → Task 2 (commentaire FAT32 + pas de format) ; surfacé au runtime via Task 8 (`mounted`). ✓
- Lecture GET depuis SD → Task 6 (get handlers via `asset_open_read`). ✓

**2. Placeholder scan** : aucun TODO/TBD ; chaque step montre le code réel. La seule note « vérifier le nom exact de la variable » (Task 6 step 6) concerne `s_aimg_written` — confirmé présent dans `api.cpp` (`static size_t s_aimg_written`) ; à relire au moment de l'édition.

**3. Type consistency** : `asset_source_for_read(bool,bool)→AssetSource` ; `asset_resolve_path(char*,size_t,const char*,bool)` ; `asset_resolve(const char*)→String` ; `asset_open_read(const char*)→File` ; `asset_fs_target()→fs::FS&` ; `asset_fs_sd_active()→bool` ; `asset_fs_init()→void`. Signatures cohérentes entre header (Task 3), usages (Tasks 5-8) et logique pure (Task 1).
