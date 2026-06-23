# Assets images sur carte SD — design

Date : 2026-06-23
Statut : design validé (brainstorming) — à transformer en plan d'implémentation.

## Objectif

Permettre des **layouts plus riches en images** en levant la contrainte d'espace de
stockage du LittleFS. Le board Guition JC3636K718 expose un slot microSD (SDMMC 4-wire)
déjà câblé mais **non utilisé** par le firmware. On veut stocker les assets image
(fonds, images placées, packs animés) sur la SD, avec repli sur le LittleFS.

## Contrainte qui motive le travail (vérifiée)

- Partition LittleFS = `spiffs` dans `default_16MB.csv` : `0x360000` ≈ **3,375 Mo**,
  **partagés** avec le designer embarqué + le schéma + `layout.json`. Résiduel pour assets
  nettement sous 3,4 Mo.
- Tailles d'assets : fond `/bg/*.565` (RGB565) = 259 200 o ≈ 253 Ko ; image placée
  `/img/*.565a` (RGB565A8) jusqu'à 360×360×3 ≈ 380 Ko ; pack animé `/aimg/*.565p` =
  N frames concaténées → un pack de 10 frames plein écran ≈ 3,8 Mo, soit **plus que tout
  le LittleFS**. L'animation riche est donc déjà quasi impossible aujourd'hui.

## Constat d'architecture déterminant (vérifié dans `view.cpp`)

Le firmware charge **chaque image intégralement en PSRAM au moment du rendu de la page** :
`LittleFS.open(path,"r")` → `heap_caps_malloc(MALLOC_CAP_SPIRAM)` → descripteur
`lv_image_dsc_t`. L'animation rejoue ensuite **depuis la PSRAM**, pas depuis le stockage.

Conséquences :
- La SD ne touche que **la source de lecture** ; le pipeline de rendu LVGL est inchangé.
- La latence SD ne pèse qu'au **changement de page** (chargement), pas par frame.
- La limite *par page* reste la **PSRAM** (un pack animé doit y tenir entièrement). La SD
  lève la limite de *stockage total*, pas celle d'*affichage simultané*.

## Décisions verrouillées

1. **Modèle de stockage : SD primaire + fallback LittleFS.** Carte présente →
   lecture/écriture des assets sur SD ; sinon comportement actuel (LittleFS) inchangé.
   Zéro régression sans carte ; les assets poussés sur SD survivent à `pio uploadfs`.
2. **Détection : montage au boot uniquement.** Pas de pin card-detect sur ce board ;
   insertion/retrait à chaud ignorés jusqu'au reboot. Simple et robuste.
3. **Mode SDMMC : 4-bit** (les 4 lignes data sont câblées), pas de formatage automatique.
4. **Assets legacy sur LittleFS : lus via fallback, non migrés, non balayés.** Pas de
   déduplication inter-FS (YAGNI). Si un même `<key>` existe sur SD et LittleFS, la
   **version SD prime** ; la copie LittleFS devient un orphelin invisible et inoffensif.

## Approche retenue : helper `asset_fs` minimal

Choisie parmi trois :
- **(retenue) Helper `asset_fs`** : une fine couche qui choisit l'objet FS (SD vs LittleFS)
  derrière `fs::FS&`. Chirurgical, conforme aux conventions du repo (API Arduino
  `FS`/`File`, comme `persist.cpp`/`api.cpp`), SD isolée et testable.
- (rejetée) **Driver `lv_fs`** : le code ne passe pas par `lv_fs` (gestion PSRAM manuelle) ;
  l'adopter = refonte du pipeline d'images. Trop invasif.
- (rejetée) **VFS POSIX unifié (`fopen` partout)** : réécrit toute l'I/O Arduino existante
  (`persist`, `api`, `view`, `secret_store`). Surface de régression large, aucun gain ici.

Détail clé qui rend l'approche minimale : `SDMMCFS` et `LittleFSFS` héritent **tous deux de
`fs::FS`**, et chacun expose la racine de son FS. Les **mêmes chemins logiques**
(`/img/...`, `/bg/...`, `/aimg/...`) fonctionnent sur les deux → le helper ne réécrit pas
les chemins, il choisit seulement l'objet FS.

## Architecture & composants

**Nouveau — `lib/board_k718/k718_sd.h`** (init matérielle, couche carte, convention `k718_*`)
- `bool k718_sd_begin()` → `SD_MMC.setPins(SD_CLK_PIN, SD_CMD_PIN, SD_D0_PIN, SD_D1_PIN,
  SD_D2_PIN, SD_D3_PIN)` puis `SD_MMC.begin("/sdcard", /*mode1bit=*/false,
  /*format_if_mount_failed=*/false)`. Renvoie l'état monté.
- `bool k718_sd_mounted()` ; accès statut optionnel (`SD_MMC.cardSize()`/`usedBytes()`).
- Pas de conflit GPIO : `k718_pins.h` documente déjà que SDMMC (38-41, 47, 48) est sur des
  pins distincts du LCD/encodeur/I2S audio+mic.

**Nouveau — `src/asset_fs.{h,cpp}`** (cœur de l'approche, ~30 lignes)
- `void asset_fs_init()` — appelé au boot après `k718_sd_begin()` ; crée `/img`, `/bg`,
  `/aimg` sur la SD si absents (FAT n'a pas l'arborescence pré-créée du LittleFS).
- `bool asset_fs_sd_active()`.
- `File asset_open_read(const char* path)` — SD d'abord si `SD_MMC.exists(path)` et
  `open` réussit, sinon `LittleFS.open(path, "r")` (fallback).
- `fs::FS& asset_fs_target()` — `SD_MMC` si active, sinon `LittleFS` ; cible des écritures
  **et** du balayage GC.
- Fonction pure testable : `asset_source_for_read(bool sd_active, bool exists_on_sd)
  → {SD | LITTLEFS}` — encode l'intent « SD primaire + fallback ». Le helper se branche
  dessus.

**Modif — `src/view.cpp`** : les 3 loaders (`/bg`, `/img`, `/aimg`) remplacent
`LittleFS.open(path,"r")` par `asset_open_read(path)`. Reste inchangé (PSRAM, descripteurs,
anim). Les 3 gèrent déjà `if (!f) return false`.

**Modif — `src/api.cpp`** : les 3 handlers d'upload écrivent sur `asset_fs_target()` au
lieu de `LittleFS` (`open(_upload.tmp,"w")` + `rename` + `remove`/`exists`) ; les 3 sweeps
GC balaient `asset_fs_target()`. Statut `/status` éventuellement enrichi (présence/usage
carte) — optionnel, hors chemin critique.

**Boot** : init board → `k718_sd_begin()` → `persist_begin()` (LittleFS) → `asset_fs_init()`.
Aucun ajout de `lib_deps` (`SD_MMC` est dans le core ESP32).

## Flux de données

- **Boot** : montage SD (4-bit, `/sdcard`). Échec → `sd_active=false`, on continue.
  `asset_fs_init()` crée les répertoires sur SD si active.
- **Lecture (rendu de page)** : `asset_open_read` → SD si `exists`+`open` OK, sinon
  LittleFS. Lecture intégrale en PSRAM comme aujourd'hui. Une I/O par asset, au changement
  de page.
- **Upload (`POST /bgimage|/image|/aimg`)** : multipart streamé vers `asset_fs_target()` ;
  fichier temp à **nom fixe** `<dir>/_upload.tmp` → `rename` vers `/dir/<key>.<ext>` si la
  taille est exacte. Avec carte, les nouveaux assets vont sur SD (survivent à `uploadfs`).
- **GC/sweep (`POST /layout`|`/page`)** : balaie `asset_fs_target()`, supprime les fichiers
  non référencés par le layout. Orphelins legacy sur LittleFS non touchés (lisibles, sans
  gêne pour la SD).

## Gestion d'erreurs & cas limites

| Situation | Comportement |
|---|---|
| Pas de carte au boot | `begin()` échoue → `sd_active=false` → tout via LittleFS (zéro régression). |
| FAT illisible/corrompu | `begin()` échoue → fallback LittleFS. Jamais de formatage auto. |
| Carte retirée en marche | `exists`/`open` SD échouent → fallback LittleFS ; asset SD-only ne charge plus → loader renvoie `false` (pas de crash). |
| SD pleine à l'upload | `write`/`rename` échoue → taille finale ≠ attendue → handler renvoie erreur, comme LittleFS plein aujourd'hui. |
| Coupure d'alim pendant écriture | Pattern *temp → rename* protège le fichier final ; le temp a un nom fixe réutilisé/écrasé → pas d'accumulation, pas de nettoyage boot nécessaire. |
| `mkdir` SD échoue | `asset_fs_init` log l'échec ; l'upload échoue proprement faute de répertoire. |

## Tests

- **Natif (`pio test -e native`, Unity)** : tester la fonction pure
  `asset_source_for_read` (priorité SD, fallback LittleFS, cas sans carte). C'est ce qui
  encode l'intent « SD primaire + fallback ». Le reste du helper est de l'I/O HW non
  testable en natif.
- **Designer (`cd designer && node --test`)** : protocole HTTP et format d'assets
  inchangés → relancer la suite pour prouver la **non-régression** (aucun nouveau test).
- **Sur device (evidence, manuel)** : (a) build `pio run -e esp32s3` OK avec `SD_MMC` ;
  (b) avec carte : upload via designer → fichier présent sur SD, asset affiché, survit à un
  `uploadfs` ; (c) sans carte : comportement identique à aujourd'hui.

## Hors-scope (YAGNI)

- Détection à chaud / card-detect logiciel.
- Migration active LittleFS → SD des assets existants.
- Déduplication inter-FS d'un même `<key>`.
- Préparation manuelle de la carte sur PC (le workflow d'arrivée des assets reste HTTP via
  le designer ; les dimensions/clé vivent dans le layout).
- Logging des valeurs poussées sur SD et chargement de layouts depuis SD (autres usages
  possibles de la SD, évalués puis écartés pour cet objectif).

## Faits de référence vérifiés

- Pins SDMMC (`lib/board_k718/k718_pins.h:42-48`) : CMD=38, CLK=39, D0=40, D1=41, D2=48,
  D3=47.
- Partition LittleFS : `default_16MB.csv`, `spiffs` = `0x360000` ≈ 3,375 Mo ; double OTA
  (app0+app1 = 2×6,5 Mo).
- API core ESP32 (`framework-arduinoespressif32/libraries/SD_MMC/src/SD_MMC.h`) :
  `class SDMMCFS : public FS`, `setPins(clk,cmd,d0,d1,d2,d3)`,
  `begin(mountpoint="/sdcard", mode1bit=false, format_if_mount_failed=false,
  sdmmc_frequency=BOARD_MAX_SDMMC_FREQ, maxOpenFiles=5)`. Gardé par
  `#if SOC_SDMMC_HOST_SUPPORTED` (l'ESP32-S3 le supporte — à confirmer au build).
- `class LittleFSFS : public FS` → base commune `fs::FS` avec SDMMCFS.
- Loaders `view.cpp` : `s_bg_dsc`/`s_img_dsc`/`s_aimg_dsc`, chargement PSRAM, `if (!f)
  return false`.
- Uploads `api.cpp` : temp à nom fixe `_upload.tmp` par dir, pattern temp+rename, sweeps GC
  ignorant déjà `_upload.tmp`.
