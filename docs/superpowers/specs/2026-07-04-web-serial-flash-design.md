# Chantier 2b — Flash USB (Web Serial) d'un device vierge depuis le designer

> Suite du chantier « flasher depuis le designer ». **2a** (OTA LAN, PR #36) flashe un device
> **déjà en ligne** par HTTP. **2b** flashe un device **vierge / briqué** par **USB** depuis le
> navigateur, sans aucun outil installé. Sous-systèmes techniquement disjoints (cf. spec 2a §12).

## 1. Motivation

Bootstrapper un device **vierge** (jamais flashé, sans WiFi) ou **récupérer un device briqué**
(firmware qui boote-crashe) directement par **USB depuis Chrome** — le cas que l'OTA LAN (2a) ne
couvre pas (2a exige un device déjà en ligne sur le LAN).

**Valeur stratégique — le flux zéro-install** : quelqu'un achète un K718 (~15 €), le branche en
USB, ouvre le designer **public hébergé sur GitHub Pages**, et flashe — **sans PlatformIO ni
esptool**. C'est l'aboutissement du « flash depuis le designer ».

**Synergie Pages décisive** : sur le designer public (Pages, HTTPS), les boutons device de l'OTA
LAN (2a) **ne marchent pas** (page HTTPS → device HTTP sur le LAN = *mixed content* bloqué par le
navigateur ; cf. `.github/workflows/pages.yml` l.7-9). **Web Serial n'a pas ce problème** : c'est
`navigator.serial` (USB), pas du HTTP-LAN. **2b est donc le SEUL chemin de configuration d'un
device qui fonctionne depuis le designer public hébergé** — ce qui rend enfin la version Pages
utile pour bootstrapper un device.

## 2. Périmètre

**Dans le périmètre** :

- Overlay designer **dédié « Nouveau device »** (distinct de l'overlay OTA LAN de 2a).
- Flash **complet des 5 partitions** via esptool-js + Web Serial (couvre vierge **et** briqué).
- Binaires firmware **hébergés** (release), servis **same-origine** depuis GitHub Pages.
- Pipeline CI : build firmware sur tag → Release → le déploiement Pages sert les assets.
- Dégradation propre hors Chromium (bouton masqué si `navigator.serial` absent).

**Hors périmètre (non-goals, YAGNI)** :

- Flash **partiel** (app seule / FS seul) par USB — c'est ce que fait déjà 2a en ligne.
- **Sélecteur de version** — on flashe toujours la **dernière** release stable.
- **Improv / provisioning WiFi par série** — le portail captif (#29) couvre déjà le besoin.
  Consigné comme **idée future** (le seul attrait d'esp-web-tools qu'on écarte).
- **Fichiers locaux** (`.pio/build/*.bin` fournis par l'utilisateur) — écartés au brainstorm au
  profit du seul flux hébergé. Réouvrable si un besoin dev se confirme.
- **Designer embarqué** : 2b **ne va pas** dans le designer servi par le device (un device vierge
  n'en a pas ; on n'embarque pas esptool-js en LittleFS). 2b vit en **web / Electron / Pages**.

## 3. Décisions du brainstorm (récapitulatif)

1. **Source des binaires = hébergés (release)** — flux zéro-install pour l'utilisateur final.
2. **Hosting = build même-origine via Pages** — le designer fetch `_site/firmware/` sans CORS.
   Raffinement retenu : le firmware est **build sur tag → publié en Release** (pas committé), et le
   job Pages **télécharge l'asset** dans `_site/firmware/` à chaque déploiement (résout « push
   designer ⇒ `_site/firmware/` vide »).
3. **Entrée UI = overlay dédié « Nouveau device »** — sur Pages c'est le seul chemin device qui
   marche, donc mis en avant (pas noyé dans un sous-onglet de l'overlay LAN, mort sur Pages).
4. **Moteur = esptool-js brut** enveloppé dans notre overlay (approche A). esp-web-tools écarté :
   impose son propre dialogue (conflit d'ethos) + son Improv fait doublon avec le portail captif.
5. **Préservation NVS** : les 5 images ne touchent pas `0x9000` (nvs) → un reflash **garde le WiFi**.
   `eraseAll` reste une **option explicite** (« repartir de zéro »), OFF par défaut.

## 4. Faits techniques établis (source vivante, vérifiés cette session)

- **Table de partitions** (`dialboard_16MB.csv`) → un device vierge veut **5 images** :

  | Image | Offset | Source (`.pio/build/esp32s3/` sauf indication) |
  |---|---|---|
  | `bootloader.bin` | `0x0` | build (⚠ ESP32-S3 : bootloader à **0x0**, pas 0x1000) |
  | `partitions.bin` | `0x8000` | build |
  | `boot_app0.bin` | `0xe000` | package framework arduino-esp32 |
  | `firmware.bin` (app) | `0x10000` | build (`pio run`) |
  | `littlefs.bin` (FS) | `0x810000` | `pio run -t buildfs` (après `stage_fs.sh`) |

  La NVS est à `0x9000` (taille `0x5000`) → **aucune** des 5 images ne la recouvre → le WiFi
  provisionné (NVS) **survit à un reflash** ; seul `erase_flash` l'efface.

- **esptool-js** (source : README officiel, vérifié cette session) :
  - Licence **Apache-2.0** (⚠ le HANDOFF disait MIT — **corrigé**). Permissive, vendorisable dans un
    repo public en conservant l'en-tête LICENSE/NOTICE.
  - `navigator.serial.requestPort()` (**geste utilisateur requis**).
  - `ESPLoader` + `Transport` ; `writeFlash({ fileArray:[{data:Uint8Array, address:number}],
    flashMode, flashFreq, flashSize, eraseAll, compress, reportProgress(fileIndex, written, total) })`
    et `eraseFlash()`. Le `fileArray:[{data, address}]` colle **exactement** à nos 5 images à leurs
    offsets → **multipart** naturel (pas de merged-bin gonflé de padding 0xFF).
  - Données en **`Uint8Array`**. Détection de puce auto (`main()`) → **ESP32-S3 géré**.
  - `bundle.js` (CDN unpkg) → **vendorisable en un fichier**, sans bundler (comme `qrcodegen.js`).

- **Designer déjà déployé sur Pages** (`pages.yml`) : `_site/designer/` + `_site/schema/`,
  redirection racine. HTTPS. Web Serial y fonctionne (contrairement aux boutons LAN).

## 5. Architecture — unités

### 5.1 Designer — logique pure (`designer/js/usb-plan.js`, testable `node --test`)

Aucun DOM/réseau/série. Défensif (entrée non conforme → résultat, jamais `throw`), comme
`ota-plan.js`.

- `validateManifest(obj)` → `{ ok, reason }` : forme `{version:string, parts:[{path, offset}]}`,
  offsets ∈ ensemble attendu `{0x0, 0x8000, 0xe000, 0x10000, 0x810000}`, présence des 5 parts.
- `planParts(manifest, blobs)` → `fileArray` ordonné `[{data:Uint8Array, address}]` pour esptool,
  trié par offset croissant. Réutilise **`validateBinary`** de `ota-plan.js` pour le magic `0xE9`
  sur l'image app (anti-brick).
- Constantes d'offsets partagées (mono-source avec le manifest CI).

### 5.2 Designer — transport série (`designer/js/serial.js`, browser-only)

Enveloppe esptool-js. Non testable node (Web Serial) → **browser-verified** (comme les builders
DOM, cf. mémoire `designer-tests-dom-builders`).

- `flashDevice(port, fileArray, { onProgress, onLog, eraseAll })` : construit `Transport(port)` →
  `ESPLoader` → `main()` (connexion + détection puce) → `writeFlash({fileArray, compress:true,
  eraseAll, reportProgress})` → **reset matériel** du device via le `Transport` (redémarrage sur le
  firmware fraîchement flashé). Traduit `reportProgress(i, written, total)` en
  fraction **globale pondérée par taille** des 5 parts → `onProgress(frac)`. Loggue les étapes via
  `onLog`.
- Vendorisation : `designer/vendor/esptool-bundle.js` (le `bundle.js` unpkg, en-tête Apache-2.0).

### 5.3 Designer — overlay (`designer/js/usb-dialog.js`)

`mountUsbDialog(model, { openBtn, overlay, manifestUrl })`, ossature calquée sur `mountOtaDialog`
(`ota-dialog.js`) : `open/close` via `.hidden`, `setBar`/`clearLog`/`logStep`/`logErr` réutilisés,
verrou `busy`. Flux :

1. À l'ouverture : si `!('serial' in navigator)` → message de dégradation, pas de flash (l'entrée
   est de toute façon masquée par `app.js`, ceinture + bretelles).
2. `fetch(manifestUrl)` same-origine → `validateManifest` → affiche la **version** à flasher.
   Manifest 404 (pas encore de release) → état « indisponible ».
3. Case **« Tout effacer (efface le WiFi enregistré) »**, OFF par défaut.
4. Bouton **« Connecter & flasher »** (= le geste `requestPort()`) → fetch des 5 blobs
   same-origine → `planParts` → `flashDevice(port, fileArray, {onProgress:setBar, onLog:logStep,
   eraseAll})` → à la fin, message « device flashé, il redémarre en Dialboard (portail
   `Dialboard-XXXX` si pas de WiFi enregistré) ».
5. Chemin d'erreur : `logErr` + toast `warn` (comme 2a), overlay laissé ouvert, réessayable.
   Instruction de repli bootloader (cf. §7) affichée sur échec de connexion.

### 5.4 Designer — câblage

- `index.html` : bouton topbar `#usb-flash-toggle` + overlay `#usb-overlay` (markup miroir de
  `#ota-overlay`).
- `style.css` : réemploi des classes `.ota-*` (barre, log, warn) ; twin `.usb-*` seulement si un
  écart de structure l'impose.
- `js/app.js` : `mountUsbDialog(model, {openBtn:$('usb-flash-toggle'), overlay:$('usb-overlay'),
  manifestUrl:'../firmware/manifest.json'})`. **Dégradation** : si `!('serial' in navigator)`,
  masquer `#usb-flash-toggle` (pas d'entrée morte).
- i18n `usb.*` **EN + FR** (parité, cf. `i18n-parity.test.js`).

## 6. CI / hosting

Le firmware **n'est pas committé** (pas de `.bin` de ~10 Mo dans git). Deux workflows :

### 6.1 `firmware-release.yml` (sur tag `v*` + `workflow_dispatch`)

- Setup PlatformIO (cache toolchain/`.pio`).
- `pio run -e esp32s3` → `firmware.bin` + `bootloader.bin` + `partitions.bin`.
- `bash tools/stage_fs.sh` puis `pio run -e esp32s3 -t buildfs` → `littlefs.bin`.
- `boot_app0.bin` : copié depuis le package framework arduino-esp32.
- Génère `manifest.json` = `{ version:<tag>, parts:[{path, offset} × 5] }`.
- Publie les 5 `.bin` + `manifest.json` en **assets de Release**.

### 6.2 `pages.yml` (étendu)

Après l'assemblage `designer/`+`schema/` : `gh release download` (dernière release) →
`_site/firmware/` (5 `.bin` + `manifest.json`). Servi **same-origine**. **Tolère l'absence de
release** (avant le 1er tag → `|| true`, l'overlay se dégrade sur un manifest 404).

## 7. UX série & risques

- **Geste utilisateur** : `requestPort()` déclenché par le clic « Connecter & flasher ». Sans filtre
  USB dur (l'identité USB du K718 varie : USB natif S3 vs pont UART).
- **Progression** : `reportProgress(i, written, total)` → fraction globale pondérée par taille →
  `setBar`. `compress:true` (esptool compresse chaque part).
- **`eraseAll`** : option explicite. OFF → NVS/WiFi préservés (§4). ON → `erase_flash` complet.
- **Reboot** : reset matériel après flash (via `Transport`) → le device boote en Dialboard. WiFi en
  NVS → reconnexion ; sinon → portail captif `Dialboard-XXXX`.
- **⚠ Risque n°1 — entrée en mode bootloader (inconnue matérielle centrale, à lever on-device)** :
  esptool-js tente le reset auto via DTR/RTS (`setSignals`). Selon le câblage USB du K718 (USB natif
  S3 vs pont UART externe avec DTR/RTS reliés à EN/GPIO0), l'auto-reset peut **échouer**. Fallback
  UX : l'overlay affiche « maintiens **BOOT** + appuie **RESET**, puis réessaie » sur échec de
  connexion. **À vérifier on-device en priorité.**
- **Déconnexion** : erreur série / `disconnect` → `logErr` + réessai possible.

## 8. Limites assumées

- **Chromium-only** (Web Serial absent de Firefox/Safari) → dégradation, pas de polyfill.
- Pas de rollback : un flash raté se rejoue (device toujours accessible en USB). Récupération
  ultime = `pio run -t upload` + `uploadfs`.
- Dernière version stable uniquement (pas de choix de version/canal).
- Dépend d'une release firmware existante (avant le 1er tag, la feature est simplement indisponible).

## 9. Tests

- **`usb-plan.js`** en `node --test` : `validateManifest` (formes valides/invalides, offsets
  inattendus, part manquante), `planParts` (ordre par offset, réutilisation de `validateBinary`).
- **QA navigateur (mock)** : `serial.js` **stubbé** (faux flasher injecté) → fetch manifest +
  affichage version, dégradation `!('serial' in navigator)`, progression/log, chemin d'erreur,
  0 erreur console. (Web Serial réel non mockable de bout en bout.)
- **On-device (K718)** : ⚠ **backup `GET /layout` d'abord** (`docs/_internal/ota-qa/` a déjà un
  backup). `esptool erase_flash` → reflash via l'**overlay réel** (Chrome + USB) → boot en Dialboard,
  designer embarqué présent, portail captif (NVS effacée par erase_flash). **Risqué mais
  récupérable** (USB `pio upload`/`uploadfs`). Sert aussi à **lever le risque n°1** (bootloader).

## 10. Points d'accroche (fichiers)

- Réutilise de 2a : `ota-plan.js::validateBinary`, l'ossature `ota-dialog.js` (`setBar`/`logStep`/
  `mount…`), les classes CSS `.ota-*`, le pattern i18n.
- Neufs : `designer/vendor/esptool-bundle.js`, `designer/js/usb-plan.js`, `designer/js/serial.js`,
  `designer/js/usb-dialog.js` ; `index.html` (`#usb-flash-toggle`/`#usb-overlay`) ; `style.css` ;
  `js/app.js` (mount + dégradation) ; i18n EN+FR `usb.*` ; `.github/workflows/firmware-release.yml` ;
  `.github/workflows/pages.yml` (étendu).

## 11. Séquencement d'implémentation (décisions)

1. **Dé-risquer tôt — spike « connect seul » (non destructif), EN TÊTE.** Avant de construire l'UI :
   vendoriser esptool-js + un harnais jetable minimal (bouton « Connecter » → `requestPort()` →
   `Transport` → `ESPLoader.main()` → afficher puce détectée + flash id → `disconnect`, **sans aucune
   écriture**). L'utilisateur branche le K718 en USB, le pilote dans Chrome (le geste `requestPort()`
   + le choix du port sont **manuels**, dialogue natif). Si `main()` détecte l'ESP32-S3 → l'auto-reset
   DTR/RTS via Web Serial **fonctionne** → **risque n°1 levé**. Non destructif : pas d'`erase_flash`,
   pas de backup nécessaire (le flash réel est vérifié à la fin, §9). Confiance a priori haute : le
   K718 est déjà flashé en boucle par `pio run -t upload` (esptool.py, **même** reset DTR/RTS).
2. **UI d'abord, CI ensuite.** L'overlay + les modules designer sont testables en **mock** (sans
   release) → valeur visible tôt. Le pipeline CI (§6) vient après. Tant qu'il n'y a pas de release,
   l'overlay se dégrade sur un manifest 404 (§5.3).

## 12. Idée future (consignée)

- **Improv / provisioning WiFi par USB juste après le flash** (fonctionnalité d'esp-web-tools) :
  saisir le SSID/mot de passe par série au lieu du portail captif. Doublon partiel avec #29 → non
  retenu pour 2b, à rouvrir si l'UX portail se révèle un point de friction.
