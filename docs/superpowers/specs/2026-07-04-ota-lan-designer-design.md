# Chantier 2a — OTA LAN (firmware + FS) piloté depuis le designer

> Spec de conception. Statut : **validée en brainstorm, prête à planifier**. Date : 2026-07-04.

## 1. Motivation

Le chantier 1 (PR #35, mergée + vérifiée on-device) a livré le **socle** : partitionnement double-slot OTA
et deux routes brutes `POST /firmware` (`U_FLASH`, reboot auto) et `POST /fs` (`U_SPIFFS`, écrase le
LittleFS). Le chantier 2 = **l'UI qui pilote ce socle** — « flasher un device déployé sans câble USB ».

Le périmètre initialement évoqué (« tout + Web Serial ») couvre **deux sous-systèmes disjoints** :
transport HTTP sur le LAN (device déjà en ligne) et flash série USB d'un device vierge (esptool.js,
Chromium-only, toutes les partitions). Décision de cadrage : **les séparer**. Cette spec ne couvre que
l'**OTA LAN (2a)**. Le **Web Serial (2b)** fera l'objet d'un spec/plan/PR distincts, ultérieurs ; l'UI
de 2a (overlay, sélection de fichier, progression, gestion reboot) sera réutilisée par 2b.

## 2. Périmètre

**Dans le périmètre :**
- Overlay designer pour flasher un binaire **firmware** et/ou une image **FS** vers un device en ligne.
- Une route firmware nouvelle : `POST /reboot`.
- Garde-fou de validation anti-brick côté designer (magic byte + tailles).
- Préservation **automatique** du dashboard utilisateur (layout + assets) autour d'un flash FS, adaptée
  à la présence d'une carte SD.
- Barre de progression réelle sur l'upload.
- Vérification **on-device** finale (vrai flash), comme le chantier 1.

**Hors périmètre (2b ou plus tard) :**
- Web Serial / flash USB navigateur (device vierge, esptool.js).
- Rollback firmware automatique (le double-slot protège du transfert raté ; un firmware qui boote-crashe
  = reflash USB — cf. limites §9).
- Authentification des routes (posture LAN mono-utilisateur, identique aux routes existantes).

## 3. Décisions du brainstorm (récapitulatif)

| # | Décision | Choix retenu |
|---|----------|--------------|
| Périmètre | firmware/fs/les deux/+Web Serial | Décomposé : **2a = OTA LAN firmware + FS**, 2b = Web Serial séparé |
| Reboot après `/fs` seul | route / manuel / imposer firmware | **Ajouter `POST /reboot`** au firmware |
| Préservation layout+assets | auto / guidé / avertir | **Auto backup+restore, adaptatif SD** |
| Emplacement UI | onglet console / overlay / tiroir | **Overlay dialogue dédié** (façon Publier/Capture) |
| Point d'entrée | topbar device / Réglages | **Bouton topbar près de la pastille device** |
| Progression upload | fetch (indéterminé) / XHR | **XHR** (`upload.onprogress`), localisé aux 2 fonctions OTA |

## 4. Faits techniques établis (source vivante, vérifiés cette session)

- **Routes existantes** (`src/api.cpp`) : `POST /firmware` → `200 "ok, rebooting\n"` puis `ESP.restart()` ;
  `500 "update failed\n"` ; `400 "no image\n"`. `POST /fs` → `200 "ok, reboot to remount\n"` (**pas** de
  reboot) ; `500`/`400`. Réponses `text/plain`. CORS activé sur toutes les réponses. Garde `s_ota_written`
  (consommée dans le done handler) protège d'un POST sans partie fichier.
- **Partitions** (`dialboard_16MB.csv`) : `app0`/`app1` = `0x400000` (**4 194 304 o = 4 Mo**) chacun ;
  `spiffs` = `0x7E0000` (**8 257 536 o ≈ 7,875 Mo**).
- **Stockage assets** (`src/asset_fs.cpp`) : si une carte SD est montée, les assets (bg/image/aimg) vivent
  sur **SD** (`/dialboard/<dir>/<clé>.<ext>`) ; sinon en **LittleFS**. `GET /status` expose **déjà**
  `sd.mounted` (+ `size_mb`/`used_mb` si monté) → détection sans ajout firmware.
- **Toujours en LittleFS** (donc **toujours** écrasés par `/fs`) : `layout.json` (`persist.cpp`),
  `designer/`, `schema/` (`serveStatic`).
- **Transport designer** (`designer/js/device.js`) : `devFetch` instrumenté (journal réseau) ; uploads
  multipart `uploadImage`/`uploadBgImage`/`uploadAimg` (clé hex, extensions `.565a`/`.565`/`.565p`) ;
  lectures `fetchImage`/`fetchBgImage`/`fetchAimg` (`null` si 404) ; `loadLayout`, `pushLayout`, `getStatus`.
- **Bundle** (`designer/js/bundle.js`) : `collectAssets`, `referenced*Keys`, `encodeBundle`/`decodeBundle`
  (v1|v2) — réutilisables pour lister/porter les assets.
- **Patterns UI** : overlays `#shot-overlay` (capture) et `publish-dialog.js` (Publier).

## 5. Architecture — unités

### 5.1 Firmware — `POST /reboot`

Une route dans `src/api.cpp`, calquée sur `h_firmware_done` :

```
h_reboot(): S->send(200, "text/plain", "ok, rebooting\n"); delay(200); ESP.restart();
server.on("/reboot", HTTP_POST, h_reboot);
```

Rend `/fs` autonome (flash → reboot piloté par l'UI) et servira aussi à 2b. Aucune autre modif firmware.

### 5.2 Designer — logique pure (testable `node --test`)

- **`validateBinary(bytes, kind, sizes)` → `{ok, reason}`** — garde-fou anti-brick, **avant** tout envoi :
  - `kind === 'firmware'` : premier octet **`0xE9`** (magic image ESP) **et** taille ≤ `sizes.app` (`0x400000`).
  - `kind === 'fs'` : taille ≤ `sizes.spiffs` (`0x7E0000`) **et** premier octet **≠ `0xE9`** (heuristique : une
    image LittleFS ne commence pas par le magic app). Rejette un firmware sélectionné par erreur dans le
    champ FS et vice-versa. Motif : flasher un FS dans le slot app = **device mort → reflash USB**.
  - `sizes` injecté (constantes dérivées du csv) pour rester testable et localiser les valeurs.
- **`planFlash({hasFw, hasFs, sdMounted}) → [étapes]`** — séquence ordonnée. Règles encodées :
  - FS et firmware présents → `backup` (si hasFs), `flashFs`, `flashFw` (reboot auto), `wait`, `restore`.
  - FS seul → `backup`, `flashFs`, `reboot`, `wait`, `restore`.
  - Firmware seul → `flashFw` (reboot auto), `wait`. Pas de backup/restore (le FS n'est pas touché).
  - `restore` inclut les assets **seulement si `!sdMounted`** ; le layout est **toujours** restauré.
  - Un seul reboot dans le cas combiné : FS **avant** firmware, le reboot du firmware remonte le nouveau FS.
- **Collecte des clés d'assets** référencées par le layout, via `collectAssets`/`referenced*Keys`
  (`bundle.js`), pour savoir quoi sauver/restaurer.

### 5.3 Designer — transport (`designer/js/device.js`)

- **`postFirmware(base, bytes, onProgress)`** / **`postFs(base, bytes, onProgress)`** — upload multipart en
  **XHR** (`xhr.upload.onprogress` → barre réelle ; `fetch` n'expose pas la progression d'upload de façon
  portable). Résolvent sur le `200` `text/plain`. Seul écart au tout-`fetch` de `device.js`, **localisé** à
  ces deux fonctions et justifié par la progression sur une opération à risque. Journalisation réseau
  conservée (même esprit que `devFetch`).
- **`rebootDevice(base)`** → `POST /reboot`.
- **`waitForDevice(base, timeoutMs)`** → poll `GET /status` jusqu'à réponse OK (device revenu). Timeout
  ~45 s. **La reconnexion est la source de vérité** : un `POST /firmware` peut voir sa connexion coupée par
  le reboot avant de recevoir la réponse → traité comme succès *probable*, confirmé (ou infirmé) par le poll.
- Backup/restore **réutilisent le transport existant** : `loadLayout`/`fetch*Image` (lecture) et
  `pushLayout`/`upload*Image` (écriture). Aucune nouvelle route de lecture/écriture d'assets.

### 5.4 Designer — UI

- **`designer/js/ota-dialog.js`** — overlay modelé sur `#shot-overlay`/`publish-dialog.js` :
  - Deux `<input type=file>` **indépendants** (firmware `.bin`, image FS `.bin`) — l'un, l'autre, ou les deux.
  - À l'ouverture : `GET /status` → `sd.mounted` → **zone d'avertissement** adaptée (« ton dashboard sera
    sauvegardé puis restauré » ; les assets ne sont mentionnés comme à risque que si `!sd.mounted`).
  - Validation inline par fichier (`validateBinary`) : OK/erreur avant d'armer le bouton.
  - Bouton « Mettre à jour », **barre de progression** par phase, **journal d'étapes** (backup / flash FS /
    flash firmware / reboot / attente / restore), verdict succès/erreur.
  - Filet de sécurité : bouton « Télécharger un `.dboard` de sauvegarde » (bundle du device) avant de flasher.
- **Point d'entrée** : bouton topbar près de la **pastille device** (l'OTA est une action device →
  découvrabilité). `index.html` + `style.css` (`.ota-*`) + i18n **EN + FR**.
- **`designer/js/app.js`** — câblage du bouton + **orchestration** : lit `planFlash`, exécute les étapes via
  le transport, met à jour l'overlay. Garde base-vide (comme les autres actions device).

## 6. Séquence OTA (cas firmware + FS)

1. **Ouvrir** l'overlay → `GET /status` → afficher l'avertissement selon `sd.mounted`.
2. **Sélectionner** firmware et/ou image FS → `validateBinary` → OK/erreur inline.
3. **Backup** (si FS) : `GET /layout` (+ assets référencés si `!sd.mounted`) en mémoire. Proposer un
   download `.dboard`. **Backup incomplet + `!sd.mounted` → ne pas flasher** (avertir, laisser l'utilisateur
   décider).
4. **Flash FS** (si sélectionné) : `POST /fs` avec progression.
5. **Flash firmware** (si sélectionné) : `POST /firmware` avec progression → reboot auto. Sinon (FS seul) :
   `POST /reboot`.
6. **Attendre** : `waitForDevice` (poll `/status`, timeout ~45 s).
7. **Restore** (si FS flashé) : `POST /layout` (backup) + (si `!sd.mounted`) `POST /image…` pour chaque asset.
8. **Fin** : toast succès / message d'erreur précis par phase.

## 7. Préservation adaptative SD

- `layout.json` est **toujours** écrasé par `/fs` (il vit en LittleFS, et l'image flashée porte le
  `layout.json` par défaut committé, pas le dashboard perso) → **toujours** sauvé/restauré.
- Assets écrasés **seulement si `sd.mounted == false`**. Sur un device avec SD (cas de référence), ils
  survivent → on **ne les re-pousse pas** inutilement. Sur un device sans SD, ils sont sauvés avant et
  restaurés après.
- Le `.dboard` de sauvegarde (layout + assets encodés) est un filet universel indépendant de la SD.

## 8. Gestion d'erreur & cas limites

- **Firmware qui boote-crashe** : hors de portée du designer. Le double-slot fait qu'un transfert raté
  laisse l'ancien slot actif ; un firmware valide-transféré mais bogué exige un **reflash USB**. L'overlay
  l'énonce en cas de non-reconnexion après timeout.
- **`POST /firmware` sans réponse** (connexion coupée par le reboot) : succès *probable* → le poll de
  reconnexion tranche.
- **Backup partiel** (un `GET` d'asset échoue) et `!sd.mounted` : **stop avant flash**, on ne détruit pas
  des assets non sauvegardés.
- **Mauvais fichier** (FS dans le champ firmware, ou l'inverse, ou fichier arbitraire) : bloqué par
  `validateBinary` (magic + taille) **avant** envoi.
- **Restore partiel** (un `POST` d'asset échoue après reboot) : signaler précisément quel asset ; le
  `.dboard` de sauvegarde reste disponible pour un re-import manuel.

## 9. Limites assumées

- Pas de rollback firmware auto (double-slot + reflash USB en dernier recours).
- Pas d'auth (posture LAN, cohérente avec l'existant).
- `validateBinary` est une **heuristique** (magic + tailles), pas une vérification cryptographique
  d'intégrité — suffisante contre l'erreur de manipulation, pas contre un binaire corrompu de bonne taille.

## 10. Tests

- **`node --test`** : `validateBinary` (magic 0xE9 présent/absent, bornes de taille app/spiffs, mauvais
  couple champ↔fichier) ; `planFlash` (toutes combinaisons `hasFw`×`hasFs`×`sdMounted`, ordre FS→firmware,
  cas reboot explicite, inclusion assets ssi `!sd`) ; collecte des clés d'assets.
- **Browser-verified** : flux complet contre un **mock device** (`/status`, `/fs`, `/firmware`, `/reboot`,
  `/layout`, `/image`) — validation off→on, progression, backup, séquence, restore, états d'erreur, 0 erreur
  console ; EN + FR. Servir depuis la **racine du repo**, ouvrir `/designer/` (cf. mémoire
  `designer-verif-navigateur`).
- **On-device** (périmètre 2a) : vrai flash firmware + FS sur `192.168.1.35` (⚠ viser l'IP, pas
  `dialboard.local`) — reboot confirmé, dashboard restauré, designer embarqué à jour. Sauvegarder l'état
  device avant (cf. mémoire `uploadfs-efface-assets-device`).

## 11. Points d'accroche (fichiers)

- Firmware : `src/api.cpp` (route `/reboot`), `docs/` manuel/context (nouvelle route + flux).
- Designer : `designer/js/device.js` (transport OTA), nouveaux modules purs (validation/plan), 
  `designer/js/ota-dialog.js`, `designer/js/app.js` (câblage), `designer/index.html`, `designer/style.css`,
  i18n EN + FR, tests `node`.

## 12. Décomposition future (rappel)

**Chantier 2b — Web Serial** : flash USB navigateur (esptool.js, Chromium) pour bootstrapper un device
vierge (bootloader + table + app + FS). Spec/plan/PR distincts. Réutilisera l'overlay, la sélection de
fichier, la barre de progression et la validation de 2a.
