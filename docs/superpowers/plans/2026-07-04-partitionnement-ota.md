# Partitionnement flash + OTA (chantier 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rééquilibrer la table de partitions flash (slots app 6,5→4 Mo, LittleFS 3,4→~7,9 Mo, OTA conservée) et ajouter au firmware deux routes OTA (`/firmware`, `/fs`).

**Architecture:** Un CSV de partitions custom versionné remplace `default_16MB.csv`. Deux paires de handlers `WebServer` (calquées sur l'upload streamé de `/image`) pilotent `Update.h` (dans le core ESP32, aucune dépendance ajoutée) pour flasher le slot app inactif (`U_FLASH`) ou la partition LittleFS (`U_SPIFFS`).

**Tech Stack:** PlatformIO, Arduino-ESP32, `WebServer` (synchrone), `Update.h`, LittleFS.

---

## ⚠ Note de vérification (lire avant de commencer)

Ce chantier **n'a pas de tests unitaires** : c'est de la **config de partitions** (Task 1) et du **code dépendant du matériel/`Update.h`** (Tasks 2-3) — rien de testable en `pio test -e native`. Ne cherche pas à écrire de test Unity : la vérification de Tasks 1-3 est **`pio run -e esp32s3` (build vert)**, et la vérification **fonctionnelle** (boot, flash réel) est **Task 4, on-device**. C'est un choix assumé (cf. spec §8), pas un oubli.

**Faits confirmés dans `Update.h` du core** (`framework-arduinoespressif32/libraries/Update/src/Update.h`) : `U_FLASH=0`, `U_SPIFFS=100` (**il n'existe pas de `U_FS`** dans ce core), `UPDATE_SIZE_UNKNOWN=0xFFFFFFFF`, `bool begin(size_t size=UPDATE_SIZE_UNKNOWN, int command=U_FLASH, …)`.

## Fichiers touchés

- **Create** `dialboard_16MB.csv` (racine) — table de partitions custom.
- **Modify** `platformio.ini:11` — pointer `board_build.partitions` sur le nouveau CSV.
- **Modify** `src/api.cpp` — `#include <Update.h>` (~L15) ; 4 handlers statiques avant `api_register` (~L486) ; 2 `server.on` dans `api_register` (~L508).

---

## Task 1 : Table de partitions

**Files:**
- Create: `dialboard_16MB.csv`
- Modify: `platformio.ini:11`

- [ ] **Step 1 : Créer le CSV de partitions**

Créer `dialboard_16MB.csv` à la racine du projet avec **exactement** ce contenu (offsets contigus, total = 16 Mo ; slots app `0x400000`=4 Mio, LittleFS `0x7E0000`=7,875 Mio) :

```
# Name,   Type, SubType,  Offset,    Size,      Flags
nvs,      data, nvs,      0x9000,    0x5000,
otadata,  data, ota,      0xe000,    0x2000,
app0,     app,  ota_0,    0x10000,   0x400000,
app1,     app,  ota_1,    0x410000,  0x400000,
spiffs,   data, spiffs,   0x810000,  0x7E0000,
coredump, data, coredump, 0xFF0000,  0x10000,
```

- [ ] **Step 2 : Pointer `platformio.ini` sur le nouveau CSV**

Dans `platformio.ini`, remplacer la ligne 11 :

```ini
board_build.partitions = default_16MB.csv
```

par :

```ini
board_build.partitions = dialboard_16MB.csv
```

- [ ] **Step 3 : Build pour valider la table**

Run: `pio run -e esp32s3`
Expected: **SUCCESS**. Le récapitulatif Flash passe de ~38 % à **~60 %** (le binaire ~2,5 Mo est désormais rapporté sur une partition app de 4 Mio, non plus 6,5). La RAM est inchangée. Un build vert prouve qu'esptool a accepté la nouvelle table (`partitions.bin` régénéré).

- [ ] **Step 4 : Commit**

```bash
git add dialboard_16MB.csv platformio.ini
git commit -m "feat(fw): table de partitions dialboard_16MB (app 4/4 Mo, LittleFS ~7,9 Mo)"
```

---

## Task 2 : Route OTA firmware `/firmware`

**Files:**
- Modify: `src/api.cpp` (include ~L15 ; handlers ~L486 ; register ~L508)

- [ ] **Step 1 : Ajouter l'include `Update.h`**

Dans `src/api.cpp`, après la ligne `#include <LittleFS.h>` (L15), ajouter :

```cpp
#include <Update.h>
```

- [ ] **Step 2 : Ajouter les handlers firmware**

Dans `src/api.cpp`, **juste avant** `void api_register(...)` (actuellement L487, après `h_aimg_get`), insérer :

```cpp
// --- OTA firmware : ecrit le slot app INACTIF ; bascule otadata au reboot. Calque du pattern
// d'upload streame de /image (S->upload() : START/WRITE/END). Le double-slot protege d'un
// transfert rate (l'ancien slot reste actif tant que Update.end(true) n'a pas reussi). ---
static void h_firmware_upload() {
    HTTPUpload& up = S->upload();
    if (up.status == UPLOAD_FILE_START)      Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH);
    else if (up.status == UPLOAD_FILE_WRITE) Update.write(up.buf, up.currentSize);
    else if (up.status == UPLOAD_FILE_END)   Update.end(true);
}
static void h_firmware_done() {
    if (Update.hasError()) { S->send(500, "text/plain", "update failed\n"); return; }
    S->send(200, "text/plain", "ok, rebooting\n");
    delay(200); ESP.restart();
}
```

- [ ] **Step 3 : Enregistrer la route**

Dans `api_register`, après la ligne `server.on("/aimg", HTTP_GET, h_aimg_get);` (L508), ajouter :

```cpp
    server.on("/firmware", HTTP_POST, h_firmware_done, h_firmware_upload);   // OTA firmware (U_FLASH)
```

- [ ] **Step 4 : Build**

Run: `pio run -e esp32s3`
Expected: **SUCCESS** (compile `Update.h`). La vérification fonctionnelle est en Task 4.

- [ ] **Step 5 : Commit**

```bash
git add src/api.cpp
git commit -m "feat(fw): route OTA firmware POST /firmware (Update.h, U_FLASH)"
```

---

## Task 3 : Route OTA filesystem `/fs`

**Files:**
- Modify: `src/api.cpp` (handlers ~après ceux de Task 2 ; register ~après `/firmware`)

- [ ] **Step 1 : Ajouter les handlers filesystem**

Dans `src/api.cpp`, **juste après** `h_firmware_done` (ajouté en Task 2), insérer :

```cpp
// --- OTA filesystem (LittleFS, U_SPIFFS = partition data 'spiffs'). ECRASE toute la partition,
// assets compris : primitive BRUTE. La sauvegarde/restauration des assets vit cote designer
// (chantier 2). Pas de reboot ici : l'appelant decidera de redemarrer pour remonter le FS. ---
static void h_fs_upload() {
    HTTPUpload& up = S->upload();
    if (up.status == UPLOAD_FILE_START)      Update.begin(UPDATE_SIZE_UNKNOWN, U_SPIFFS);
    else if (up.status == UPLOAD_FILE_WRITE) Update.write(up.buf, up.currentSize);
    else if (up.status == UPLOAD_FILE_END)   Update.end(true);
}
static void h_fs_done() {
    if (Update.hasError()) { S->send(500, "text/plain", "fs update failed\n"); return; }
    S->send(200, "text/plain", "ok, reboot to remount\n");
}
```

- [ ] **Step 2 : Enregistrer la route**

Dans `api_register`, juste après la ligne `/firmware` ajoutée en Task 2, ajouter :

```cpp
    server.on("/fs",       HTTP_POST, h_fs_done,       h_fs_upload);         // OTA filesystem (U_SPIFFS)
```

- [ ] **Step 3 : Build**

Run: `pio run -e esp32s3`
Expected: **SUCCESS**.

- [ ] **Step 4 : Commit**

```bash
git add src/api.cpp
git commit -m "feat(fw): route OTA filesystem POST /fs (Update.h, U_SPIFFS, primitive brute)"
```

---

## Task 4 : Migration on-device + vérification fonctionnelle

**Destructif — device branché en USB requis.** Le changement de table impose un flash complet qui **efface NVS (WiFi) et LittleFS (assets)**. Aucun code ; c'est la vérification réelle du chantier.

- [ ] **Step 1 : Sauvegarder l'état device (avant l'erase)**

Le device tourne encore l'ancien build. Récupérer layout + assets référencés (adapter `<ip>` = `192.168.1.35` et les clés d'assets présentes) :

```bash
curl -s http://192.168.1.35/layout -o /tmp/device-layout.json
# pour chaque clé d'asset référencée (voir le layout) :
#   curl -s "http://192.168.1.35/image?key=<hex>"   -o /tmp/<hex>.565a
#   curl -s "http://192.168.1.35/bgimage?key=<hex>" -o /tmp/<hex>.565
#   curl -s "http://192.168.1.35/aimg?key=<hex>"    -o /tmp/<hex>.565p
```

Noter aussi les identifiants WiFi hors-bande (le NVS ne survivra pas ; `GET /wifi` ne rend que les SSID).

- [ ] **Step 2 : Flash complet (nouvelle table + firmware + FS)**

```bash
pio run -e esp32s3 -t erase            # efface toute la flash (etat propre)
pio run -e esp32s3 -t upload           # firmware neuf + nouvelle table de partitions
pio run -e esp32s3 -t uploadfs         # image LittleFS (designer a jour) — passer par stage_fs.sh si besoin
```

Note : `stage_fs.sh` stage `designer/`+`schema/` dans `data/` avant `uploadfs` (cf. CLAUDE.md).

- [ ] **Step 3 : Re-provisionner le WiFi**

Au boot, le device n'a plus de réseau stocké → portail captif `Dialboard-XXXXXX` (softAP ouvert, cf. #29). S'y connecter, saisir SSID/pass, laisser rebooter.
Expected: le device rejoint le LAN et répond à `curl -s http://<ip>/status`.

- [ ] **Step 4 : Vérifier la nouvelle table (FS agrandi)**

Le device booté, ré-pousser le layout sauvegardé puis inspecter :

```bash
curl -s -X POST http://<ip>/layout --data-binary @/tmp/device-layout.json
curl -s http://<ip>/status
```

Expected: `/status` répond 200, le device affiche le dashboard. Le designer embarqué reste servi (`http://<ip>/designer/`). (Le FS de 7,9 Mo n'a pas de champ dédié dans `/status` ; la preuve d'espace est qu'`uploadfs` du designer + re-push des assets réussit sans « FS full ».)

- [ ] **Step 5 : Vérifier l'OTA firmware `/firmware`**

Flasher **par le réseau** le binaire déjà buildé (multipart ; le nom du champ est ignoré par le handler) :

```bash
curl -F "firmware=@.pio/build/esp32s3/firmware.bin" http://<ip>/firmware
```

Expected: réponse `ok, rebooting`, puis le device **redémarre** (l'écran se réinitialise) et répond à nouveau sur `/status` après reboot. Pour une preuve forte, incrémenter une chaîne de version dans le firmware, rebuild, re-flasher par `/firmware`, et confirmer la nouvelle version au boot.

- [ ] **Step 6 : Vérifier l'OTA filesystem `/fs`**

Générer l'image LittleFS et la pousser par le réseau :

```bash
pio run -e esp32s3 -t buildfs                                  # genere .pio/build/esp32s3/littlefs.bin
curl -F "fs=@.pio/build/esp32s3/littlefs.bin" http://<ip>/fs
```

Expected: réponse `ok, reboot to remount`. **Rebooter** le device (couper/rétablir l'alim, ou re-flasher `/firmware` qui reboote), puis vérifier que `http://<ip>/designer/` répond et que le dashboard se recharge — preuve que la partition LittleFS a bien été réécrite et remontée.

- [ ] **Step 7 : Restaurer les assets**

Ré-uploader les assets sauvegardés en Step 1 (`POST /image?key=…`, etc.) et re-pousser le layout perso. Le device retrouve son état.

---

## Self-review (rempli)

- **Couverture spec** : §4.1 table → Task 1 ; §4.2 platformio → Task 1 Step 2 ; §4.3 `/firmware` → Task 2 ; §4.4 `/fs` → Task 3 ; §7 migration → Task 4 Steps 1-4, 7 ; §8 vérif on-device → Task 4 Steps 5-6. §6 (erreurs 500, pas de reboot sur /fs) → codé dans les handlers. §10 hors-périmètre (UI, rollback, auth, polices) → non implémenté, conforme.
- **Placeholders** : aucun — tout symbole (`Update`, `U_FLASH`, `U_SPIFFS`, `UPDATE_SIZE_UNKNOWN`, `S->upload()`, `HTTPUpload`, `ESP.restart`) est confirmé dans le core ou l'existant `api.cpp`.
- **Cohérence des noms** : handlers `h_firmware_upload`/`h_firmware_done`/`h_fs_upload`/`h_fs_done` ; routes `/firmware`/`/fs` ; constantes `U_FLASH`/`U_SPIFFS` — identiques entre définition et enregistrement.
- **Limite consignée** : pas de rollback auto (spec §6) — un firmware qui boote-crashe impose un reflash USB ; acceptable au chantier 1.
