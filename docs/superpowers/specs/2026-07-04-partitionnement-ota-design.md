# Partitionnement flash + capability OTA — design

## 1. Objectif & valeur

Le device (ESP32-S3, flash 16 Mo) tourne sur `default_16MB.csv`, un partitionnement **subi, jamais décidé** : deux slots d'application de 6,5 Mo (OTA-ready) largement **surdimensionnés** pour un firmware de 2,5 Mo, pendant que le LittleFS étouffe à 3,4 Mo.

Ce chantier :
1. **Rééquilibre** la table de partitions → LittleFS **×2,3** (3,4 → ~7,9 Mo) **sans** sacrifier la capacité OTA (slots app resserrés à 4/4 Mo, marge firmware saine conservée).
2. **Ajoute au firmware la capability OTA** (firmware **et** filesystem) via deux routes HTTP, socle du futur « flash depuis le designer » (chantier 2).

Le tout est payé par **un seul** flash USB destructif (voir §7). Après quoi les mises à jour peuvent passer sans câble.

## 2. Décisions de cadrage (brainstorm)

- **Designer on-device conservé** : on partitionne comme s'il restait (coût fixe FS = 1,1 Mo). Son retrait éventuel ne fera que *libérer* de la place plus tard — réversible **sans** re-partitionner.
- **Croissance des polices** : +1 famille au maximum anticipée (≈ 450 Ko firmware — les fontes pèsent déjà ~1,8 Mo des 2,5 Mo du binaire). Les **tailles** de texte (10, 16, >96…) sont rendues par **Tiny TTF** à la volée depuis les mêmes données TTF → **coût flash nul**, hors périmètre (voir §10).
- **Croissance des composants** : un nouveau *type* coûte quelques Ko de code → non contraignant.
- **Usage bitmap cible = modéré** : quelques fonds/images statiques par dashboard, pas d'animations lourdes → FS large mais **pas maximal** ; on privilégie la marge firmware.
- **Dimensionnement retenu** : app0/app1 = **4 Mo**, LittleFS = **~7,9 Mo**.
- **Découpage** : chantier 1 (cette spec) = **partitions + routes OTA firmware & FS** ; chantier 2 (spec séparée) = **UI designer** pour piloter l'OTA. Motivation : ne payer qu'**un** flash USB.

## 3. Rapport avec l'existant

- **Partitions** : `default_16MB.csv` (fourni par le framework) réservait déjà `otadata` + deux slots `ota_0`/`ota_1` → l'OTA était structurellement possible, jamais exploitée. On ne « crée » pas l'OTA, on **rend son coût utile** en resserrant les slots.
- **Serveur HTTP** : `WebServer` synchrone (core ESP32, `src/api.h`), routes enregistrées dans `api_register` (`src/api.cpp:487`). Le handler d'upload streamé **`h_image_upload` (`src/api.cpp:393`)** — pattern `server.on(uri, HTTP_POST, done, upload)` + `S->upload()` (START/WRITE/END) — est le **modèle direct** des routes OTA.
- **`Update.h`** est dans le core Arduino-ESP32 : **aucune dépendance à ajouter**.
- **NVS WiFi** : partition distincte, survivait à `uploadfs` (cf. `uploadfs-efface-assets-device`) mais **pas** à un changement de table (§7).

## 4. Architecture

### 4.1 Table de partitions — `dialboard_16MB.csv` (à la racine, versionné)

```
# Name,   Type, SubType,  Offset,    Size,      Flags
nvs,      data, nvs,      0x9000,    0x5000,
otadata,  data, ota,      0xe000,    0x2000,
app0,     app,  ota_0,    0x10000,   0x400000,
app1,     app,  ota_1,    0x410000,  0x400000,
spiffs,   data, spiffs,   0x810000,  0x7E0000,
coredump, data, coredump, 0xFF0000,  0x10000,
```

- `app0`/`app1` = **4 Mo** (`0x400000`) chacun — firmware projeté ≤ 3,5 Mo (2,5 actuel + 0,45 police + marge code) → ~0,5 Mo de rab. OTA préservée.
- `spiffs` = **`0x7E0000` = 7,875 Mio (≈ 7,9 Mo)** (le *subtype* reste `spiffs` par convention ; c'est bien du **LittleFS** qui s'y monte, cf. `board_build.filesystem = littlefs`).
- Total = `0xFF0000 + 0x10000 = 0x1000000` = 16 Mo exact. Offsets alignés sur 64 Ko pour les partitions app.

### 4.2 `platformio.ini`

```ini
board_build.partitions = dialboard_16MB.csv   ; remplace default_16MB.csv
```

### 4.3 Route OTA firmware — `POST /firmware`

Calquée sur `/image`. Register dans `api_register` :

```cpp
server.on("/firmware", HTTP_POST, h_firmware_done, h_firmware_upload);
```

```cpp
static void h_firmware_upload() {
    HTTPUpload& up = S->upload();
    if (up.status == UPLOAD_FILE_START)      Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH);
    else if (up.status == UPLOAD_FILE_WRITE) Update.write(up.buf, up.currentSize);
    else if (up.status == UPLOAD_FILE_END)   Update.end(true);   // true = fige la taille écrite
}
static void h_firmware_done() {
    if (Update.hasError()) { S->send(500, "text/plain", "update failed\n"); return; }
    S->send(200, "text/plain", "ok, rebooting\n");
    delay(200); ESP.restart();
}
```

### 4.4 Route OTA filesystem — `POST /fs`

Identique, avec la cible **LittleFS** au lieu de l'app :

```cpp
server.on("/fs", HTTP_POST, h_fs_done, h_fs_upload);
// h_fs_upload : Update.begin(size, U_SPIFFS) au START (U_SPIFFS = partition data 'spiffs')
```

Le corps est l'image LittleFS brute (celle produite par `pio run -t buildfs`). `h_fs_done` renvoie 200 **sans reboot** (le FS est relu au montage ; un reboot reste plus sûr et pourra être décidé côté appelant au chantier 2).

> **Portée volontairement brute** : `/fs` **écrase toute la partition LittleFS** (assets compris — même piège qu'`uploadfs`). La logique « sauvegarder puis restaurer les assets autour de l'écriture » vit **côté designer, au chantier 2**. Ici on ne fournit que la primitive.

## 5. Séquence (data flow)

```
client ──POST /firmware (binaire streamé)──▶ h_firmware_upload
                                              START → Update.begin(U_FLASH)
                                              WRITE → Update.write (slot inactif)
                                              END   → Update.end(true) → bascule otadata
        ◀──── 200 "ok, rebooting" ─────────  h_firmware_done → ESP.restart()
        (device redémarre sur le nouveau slot)
```

## 6. Erreurs & sûreté

- **Échec de flash** : `Update.hasError()` → **HTTP 500**, pas de reboot. Le **double-slot protège** — un transfert interrompu ou corrompu laisse le slot actif **intact** (la bascule `otadata` n'a lieu qu'après `Update.end(true)` réussi).
- **Rollback automatique : NON** (limite assumée de la version minimale). Un firmware qui flashe correctement mais **crashe au boot** laisse le device inutilisable jusqu'à un **reflash USB**. Amélioration future possible via `esp_ota_mark_app_valid_cancel_rollback` + `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`.
- **Authentification : aucune**, cohérent avec **toutes** les routes actuelles (`/layout`, `/update`, `/image`…) — posture LAN inchangée. Nuance consignée : l'OTA élève l'enjeu (flasher un firmware arbitraire). Ajouter une auth serait incohérent tant qu'aucune route n'en a → **hors scope**, mais candidat si on expose au-delà du LAN.

## 7. Migration — le flash USB unique (destructif)

Changer la table casse le mapping flash → **une** passe USB, qui **efface NVS (WiFi) et LittleFS (assets)** :

1. **Sauvegarder** : `GET /layout` + assets référencés (`GET /image?key=…`, `/bgimage`, `/aimg`). Noter les SSID/pass WiFi hors-bande (le NVS ne survit pas ; `GET /wifi` ne rend que les SSID).
2. `pio run -e esp32s3 -t erase` → `-t upload` (firmware neuf **+ nouvelle table**) → `-t uploadfs` (designer à jour).
3. **Re-provisionner WiFi** via le portail captif (#29), puis re-pousser layout + assets.

> **À vérifier au flash** : `-t upload` doit réécrire la partition table (`partitions.bin` à `0x8000`). L'`erase` préalable garantit un état propre.

## 8. Tests

Ce chantier **n'introduit aucune logique pure** nouvelle (pas de module natif `test/` Unity, contrairement aux features précédentes — le partitionnement est de la config, les routes OTA dépendent de `Update.h`/matériel). La vérification est **on-device** :

- le device **boote** sur la nouvelle table ;
- `GET /status` reflète le FS agrandi et le firmware fonctionnel ;
- un `POST /firmware` d'un binaire de test (ex. version incrémentée) provoque le **reboot sur la nouvelle version** ;
- un `POST /fs` d'une image LittleFS de test est **monté** après coup.

C'est consigné tel quel — pas de couverture unitaire simulée.

## 9. Phasage

- **Chantier 1 (cette spec)** : CSV + `platformio.ini` + routes `/firmware` & `/fs` + migration on-device. Livrable : device **rééquilibré et OTA-capable**.
- **Chantier 2 (spec séparée)** : UI designer pilotant l'OTA (sélection binaire, progression, gestion d'erreur, **sauvegarde/restauration des assets** autour de `/fs`, éventuel Web Serial pour le bootstrap d'un device vierge).

## 10. Hors périmètre (non-buts)

- **UI designer** pour l'OTA (chantier 2).
- **OTA FS « propre »** (préserver les assets) — chantier 2 ; `/fs` est ici une primitive brute.
- **Rollback automatique** et **authentification** (§6).
- **Web Serial** (bootstrap USB navigateur d'un device vierge) — chantier 2 si retenu.
- **Tailles de police** (`FONTS` du designer + borne 120 px firmware) — micro-tâche indépendante, coût flash nul, sans lien avec le partitionnement.
- **Retrait du designer on-device** — décidé *conservé* ; réversible plus tard.

## 11. Risques & questions ouvertes

- **Brick sur firmware boot-crash** (pas de rollback auto) → reflash USB. Acceptable au chantier 1 ; mitigé plus tard.
- **OTA non authentifiée sur LAN** — enjeu relevé vs routes existantes ; assumé.
- **Réécriture de la table par `-t upload`** — à confirmer on-device (erase préalable recommandé).
- **`U_SPIFFS` vs `U_FS`** — la constante exacte de `Update.h` est à confirmer selon la version du core à l'implémentation (cible = partition data `spiffs`).
