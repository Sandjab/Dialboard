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
5. **Isolation sur SD dans un sous-dossier dédié `/dialboard/`.** La carte peut **ne pas
   être vide** (données de l'utilisateur). Tous nos fichiers vivent sous
   `/dialboard/img`, `/dialboard/bg`, `/dialboard/aimg` → le GC/sweep ne peut jamais
   toucher les données de l'utilisateur, aucune pollution de la racine, aucune collision.
   Sur LittleFS, FS dédié, on garde `/img`, `/bg`, `/aimg` (pas d'isolation nécessaire).
6. **État SD visible dans `/status`** (monté/non, type/taille). Évite qu'un échec de
   montage (ex. exFAT) passe inaperçu derrière le fallback LittleFS silencieux.
7. **FAT32 recommandé.** Le support exFAT du build Arduino/FATFS n'est pas garanti ; une
   carte exFAT (souvent les SDXC > 32 Go) peut ne pas se monter → fallback LittleFS.
   À confirmer au build ; à documenter pour l'utilisateur.

## Approche retenue : helper `asset_fs` minimal

Choisie parmi trois :
- **(retenue) Helper `asset_fs`** : une fine couche qui choisit l'objet FS (SD vs LittleFS)
  derrière `fs::FS&` **et centralise la résolution de chemin** (préfixe `/dialboard` sur
  SD). Chirurgical, conforme aux conventions du repo (API Arduino `FS`/`File`, comme
  `persist.cpp`/`api.cpp`), SD isolée et testable.
- (rejetée) **Driver `lv_fs`** : le code ne passe pas par `lv_fs` (gestion PSRAM manuelle) ;
  l'adopter = refonte du pipeline d'images. Trop invasif.
- (rejetée) **VFS POSIX unifié (`fopen` partout)** : réécrit toute l'I/O Arduino existante
  (`persist`, `api`, `view`, `secret_store`). Surface de régression large, aucun gain ici.

Détail qui garde l'approche minimale : `SDMMCFS` et `LittleFSFS` héritent **tous deux de
`fs::FS`**. Le helper manipule donc un `fs::FS&` polymorphe et n'ajoute que la réécriture
du **préfixe de chemin** pour la SD (`/img/x` → `/dialboard/img/x`). Tous les points de
chemin (loaders, uploads, temp, sweeps) passent par cette résolution centralisée pour
rester cohérents.

## Architecture & composants

**Nouveau — `lib/board_k718/k718_sd.h`** (init matérielle, couche carte, convention `k718_*`)
- `bool k718_sd_begin()` → `SD_MMC.setPins(SD_CLK_PIN, SD_CMD_PIN, SD_D0_PIN, SD_D1_PIN,
  SD_D2_PIN, SD_D3_PIN)` puis `SD_MMC.begin("/sdcard", /*mode1bit=*/false,
  /*format_if_mount_failed=*/false)`. Renvoie l'état monté.
- `bool k718_sd_mounted()` ; accès statut (`SD_MMC.cardType()`/`cardSize()`/`usedBytes()`).
- Pas de conflit GPIO : `k718_pins.h` documente déjà que SDMMC (38-41, 47, 48) est sur des
  pins distincts du LCD/encodeur/I2S audio+mic.

**Nouveau — `src/asset_fs.{h,cpp}`** (cœur de l'approche)
- `void asset_fs_init()` — appelé au boot après `k718_sd_begin()` ; crée `/dialboard`,
  `/dialboard/img`, `/dialboard/bg`, `/dialboard/aimg` sur la SD si absents.
- `bool asset_fs_sd_active()`.
- `String asset_resolve(const char* logical_path)` — préfixe `/dialboard` si SD active,
  sinon renvoie le chemin logique tel quel (cible LittleFS). Utilisé pour écriture, temp,
  ouverture de répertoire, construction des chemins de victimes du sweep.
- `File asset_open_read(const char* logical_path)` — SD d'abord (`asset_resolve` →
  `exists`+`open`), sinon `LittleFS.open(logical_path,"r")` (fallback, chemin non préfixé).
- `fs::FS& asset_fs_target()` — `SD_MMC` si active, sinon `LittleFS` ; cible des écritures
  **et** du balayage GC.
- Fonction pure testable : `asset_source_for_read(bool sd_active, bool exists_on_sd)
  → {SD | LITTLEFS}` — encode l'intent « SD primaire + fallback ». Le helper se branche
  dessus.

**Modif — `src/view.cpp`** : les 3 loaders (`/bg`, `/img`, `/aimg`) remplacent
`LittleFS.open(path,"r")` par `asset_open_read(path)`. Reste inchangé (PSRAM, descripteurs,
anim). Les 3 gèrent déjà `if (!f) return false`.

**Modif — `src/api.cpp`** :
- Les 3 handlers d'upload écrivent sur `asset_fs_target()` avec chemins résolus via
  `asset_resolve` (`<dir>/_upload.tmp` + `rename` + `remove`/`exists`).
- Les 3 sweeps GC ouvrent le répertoire résolu (`asset_fs_target().open(asset_resolve(
  BG_DIR))`, etc.) et construisent les chemins de victimes via `asset_resolve`. Comme le
  sweep ne regarde que sous `/dialboard/` sur SD, il ne peut pas toucher les données de
  l'utilisateur.
- `/status` (`h_status`) expose l'état SD (monté/non, type, taille/usage).

**Boot** : init board → `k718_sd_begin()` → `persist_begin()` (LittleFS) → `asset_fs_init()`.
Aucun ajout de `lib_deps` (`SD_MMC` est dans le core ESP32).

## Flux de données

- **Boot** : montage SD (4-bit, `/sdcard`). Échec → `sd_active=false`, on continue.
  `asset_fs_init()` crée l'arbo `/dialboard/...` sur SD si active.
- **Lecture (rendu de page)** : `asset_open_read("/img/<key>.565a")` → SD
  (`/dialboard/img/<key>.565a`) si `exists`+`open` OK, sinon LittleFS (`/img/<key>.565a`).
  Lecture intégrale en PSRAM comme aujourd'hui. Une I/O par asset, au changement de page.
- **Upload (`POST /bgimage|/image|/aimg`)** : multipart streamé vers `asset_fs_target()` ;
  fichier temp `<dir résolu>/_upload.tmp` → `rename` vers `<dir résolu>/<key>.<ext>` si la
  taille est exacte. Avec carte, les nouveaux assets vont sous `/dialboard/` sur SD
  (survivent à `uploadfs`).
- **GC/sweep (`POST /layout`|`/page`)** : balaie le répertoire résolu sous
  `asset_fs_target()`, supprime les fichiers `.565*` non référencés par le layout.
  Orphelins legacy sur LittleFS non touchés (lisibles, sans gêne).

## Gestion d'erreurs & cas limites

| Situation | Comportement |
|---|---|
| Pas de carte au boot | `begin()` échoue → `sd_active=false` → tout via LittleFS (zéro régression). |
| Carte **non vide** (données utilisateur) | Jamais formatée. Nos fichiers isolés sous `/dialboard/` ; le sweep ne regarde que là → données utilisateur intactes. |
| FAT illisible/corrompu | `begin()` échoue → fallback LittleFS. Jamais de formatage auto. |
| Carte **exFAT** (SDXC > 32 Go) | Montage non garanti par le build FATFS → probablement échec → fallback LittleFS. Surfacé via `/status` ; FAT32 recommandé. |
| Carte retirée en marche | `exists`/`open` SD échouent → fallback LittleFS ; asset SD-only ne charge plus → loader renvoie `false` (pas de crash). |
| SD pleine à l'upload | `write`/`rename` échoue → taille finale ≠ attendue → handler renvoie erreur, comme LittleFS plein aujourd'hui. |
| Coupure d'alim pendant écriture | Pattern *temp → rename* protège le fichier final ; le temp a un nom fixe réutilisé/écrasé → pas d'accumulation, pas de nettoyage boot nécessaire. |
| `mkdir` SD échoue | `asset_fs_init` log l'échec ; l'upload échoue proprement faute de répertoire. |

## Tests

- **Natif (`pio test -e native`, Unity)** : tester la fonction pure
  `asset_source_for_read` (priorité SD, fallback LittleFS, cas sans carte) ; et, si extraite
  proprement, la résolution de préfixe `asset_resolve` (SD → `/dialboard/...`, LittleFS →
  chemin nu). C'est ce qui encode l'intent « SD primaire + fallback + isolation ». Le reste
  du helper est de l'I/O HW non testable en natif.
- **Designer (`cd designer && node --test`)** : protocole HTTP et format d'assets
  inchangés → relancer la suite pour prouver la **non-régression** (aucun nouveau test).
- **Sur device (evidence, manuel)** : (a) build `pio run -e esp32s3` OK avec `SD_MMC` ;
  (b) avec carte **non vide** : upload via designer → fichier sous `/dialboard/` sur SD,
  données préexistantes intactes, asset affiché, survit à un `uploadfs` ; (c) sans carte :
  comportement identique à aujourd'hui ; (d) `/status` reflète l'état SD.

## Hors-scope (YAGNI)

- Détection à chaud / card-detect logiciel.
- Migration active LittleFS → SD des assets existants.
- Déduplication inter-FS d'un même `<key>`.
- Préparation manuelle de la carte sur PC (le workflow d'arrivée des assets reste HTTP via
  le designer ; les dimensions/clé vivent dans le layout).
- Formatage automatique de la carte ou conversion exFAT → FAT32 (l'utilisateur formate).
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
- Sweeps `api.cpp:96-162` : **non récursifs** (un seul niveau de `/bg|/img|/aimg`), filtrés
  par extension (`.565`/`.565a`/`.565p` ; `continue` sinon), suppriment les non-référencés
  (max 16 victimes/passe). Temp à nom fixe `_upload.tmp` par dir, pattern temp+rename,
  sweeps ignorant déjà `_upload.tmp`.
