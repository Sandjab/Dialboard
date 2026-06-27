# Designer Desktop — PoC socle (Electron)

- **Date** : 2026-06-27
- **Branche** : `feat/designer-desktop-electron` (à créer)
- **Statut** : design validé (brainstorm), spec à relire avant plan d'implémentation
- **Scope** : PoC **socle uniquement** — une fenêtre Electron affiche le designer existant et fait
  fonctionner Charger / Statut / Pousser contre un device, sans que CORS soit un souci, `designer/`
  restant intact. **Hors-scope** : mDNS, fichiers locaux, installeurs/signature, auto-update.

## Problème

Le designer est aujourd'hui **pur web** : une SPA en modules ES (`designer/index.html` + `js/` +
`style.css` + `vendor/`), servie soit en dev local, soit embarquée dans le device (LittleFS,
`http://<ip>/designer/`). On veut en faire **aussi** une app desktop (Windows / macOS / Linux),
**sans dupliquer ni forker** le code du designer, qui reste la source unique partagée avec
l'embarqué.

Choix de techno arbitré en amont : **Electron** (et non Tauri/PWA). Raison décisive pour *ce*
projet : le designer a des invariants canvas/SVG/pointer-events fragiles, validés au navigateur
**Chromium** (Playwright). Electron embarque ce même Chromium → parité de rendu garantie entre web
et desktop, et les tests navigateur restent un proxy fidèle du desktop. Coût accepté : poids du
binaire (le critère « empreinte minimale », qui aurait penché Tauri, est sciemment sacrifié). Tauri
reste la cible si l'empreinte devient un *hard requirement* — il faudrait alors re-valider la parité
sur les 3 webviews système.

## État vérifié (source de vérité)

### La couche transport device est déjà isolée et paramétrable (`designer/js/device.js`)
- Tout passe par `devFetch(base, path, init)` : `fetch(clean(base) + path, init)`. `base` est une URL
  configurable, pas une origine figée. **Aucune réécriture réseau n'est nécessaire** pour le desktop.
- Opérations : `loadLayout` (GET `/layout`), `getStatus` (GET `/status`), `pushLayout` (POST
  `/layout`), `update` (POST `/update`), `captureScreenshot` (GET `/screenshot`, renvoie une blob
  URL), images (GET/POST `/image?key=`).
- **Uploads en multipart `FormData`** (`uploadImage`/`uploadAimg` : `fd = new FormData()`, POST
  `/image?key=`). C'est ce détail qui écarte le routage IPC pour le socle (voir Décisions).
- En-tête du module : « Pont REST avec le device. CORS résolu côté firmware (header + OPTIONS). » →
  le firmware **répond déjà au préflight `OPTIONS`** ; le socle desktop s'appuie dessus.

### La base URL est saisie et persistée (`designer/js/app.js`)
- Champ `#base` (`app.js:306`+). Pré-rempli : embarqué → `location.origin` ; dev local
  (file/localhost) → dernière URL saisie (`localStorage` clé `rt-designer-base`).
- Un check de connexion silencieux part au 1er lancement dès qu'une URL est connue.
- En desktop, l'utilisateur saisit `base` = IP du device (ou l'URL du mock). **L'UI existante suffit
  pour le socle** — aucune modification.

### Le schéma est chargé en chemin relatif (`designer/js/app.js:53`)
- `fetch('../schema/layout.schema.json')`, relatif à `designer/index.html`. Contrainte forte sur la
  façon de servir le designer (voir Décisions : protocole `app://`).

### Pile de tests (`designer/package.json`, `designer/tests/`)
- `package.json` : `"type": "module"`. Tests via `node:test` + `node:assert/strict`, import direct
  des modules `js/`. Un `device.test.js` existe déjà → modèle pour tester le contrat
  designer↔device contre un mock.

## Décisions

1. **Electron**, wrapper minimal dans `designer/electron/` (le wrapper vit à côté de sa source).
2. **Zéro-touch sur `designer/`** : toute la logique desktop vit dans la couche Electron. `designer/`
   et `schema/` restent l'octet près identiques à la version embarquée → parité préservée.
3. **Servir le designer via un protocole interne `app://`** (et non `file://`, qui casse les modules
   ES — origine `null`). Le schéme est enregistré *standard* + *supportFetchAPI* + *stream*, et
   **non-secure** (clé : la page n'est alors pas un *secure context*, donc le `fetch` vers
   `http://<device>` n'est pas bloqué en mixed-content ; les modules ES et `localStorage`
   fonctionnent car l'origine `app://app` est une origine valide).
4. **Neutralisation CORS par injection d'en-têtes (approche A)** : `session.webRequest`
   `onHeadersReceived` ajoute `Access-Control-Allow-Origin` (+ Methods/Headers) aux réponses
   `http(s)` du device. Couvre GET / POST JSON / **multipart** sans rien sérialiser. Pour le
   préflight `OPTIONS`, on s'appuie sur le firmware qui y répond déjà.
   - **Écartée pour le socle — approche B** (routage `window.fetch` → main `net.request`, vraiment
     hors navigateur) : indépendance totale du CORS firmware, mais impose de sérialiser
     `FormData`/`Blob` via IPC et de reconstruire un objet `Response`. C'est la cible d'un incrément
     ultérieur si on veut durcir/retirer le CORS firmware, pas le PoC.

## Architecture

```
designer/                 # SOURCE UNIQUE, inchangée
  index.html, js/, style.css, vendor/
schema/                   # inchangé (servi à côté de designer/)
designer/electron/        # NOUVEAU — wrapper desktop
  package.json            # dépend d'electron ; script "start"
  main.js                 # app:// + injection CORS + BrowserWindow
  mock-device.mjs         # faux device HTTP (dev manuel + test)
```

## Composants

### `designer/electron/main.js`
- **Avant `app.ready`** : `protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: {
  standard: true, supportFetchAPI: true, stream: true, secure: false } }])`.
- **Sur `app.ready`** :
  - `protocol.handle('app', req => …)` : mappe `app://app/<chemin>` → `<racine>/<chemin>`, où
    `<racine>` contient `designer/` **et** `schema/` côte à côte (en dev = racine du repo). La page
    se charge sur `app://app/designer/index.html` ; le `fetch('../schema/…')` de `app.js:53` résout
    alors vers `app://app/schema/…`. Fichier absent → réponse 404 (logée).
  - `session.defaultSession.webRequest.onHeadersReceived` : si l'URL de la réponse est `http(s)://`
    (donc le device, pas `app://`), ajoute les en-têtes CORS permissifs.
  - Crée la `BrowserWindow` (360×360 n'a pas de sens ici : fenêtre desktop classique, le board est
    mis à l'échelle par le designer lui-même) et `loadURL('app://app/designer/index.html')`.
- Pas de `preload` requis pour le socle (approche A ne route rien via IPC).

### `designer/electron/package.json`
- `devDependencies` : `electron`. Script `start` : `electron .`. (`electron-builder` + cibles
  Win/macOS/Linux = incrément packaging ultérieur.)

### `designer/electron/mock-device.mjs`
- Serveur HTTP node (lib `node:http`, zéro dépendance) répondant aux routes utilisées par le socle :
  - `GET /layout` → un layout JSON minimal valide (réutiliser `data/layout.json` ou un layout
    canned).
  - `GET /status` → JSON santé (ip, page, pages, uptime…).
  - `POST /layout` → 200 (accuse réception ; peut stocker en mémoire pour un round-trip).
  - `POST /update` → 200.
  - `GET/POST /image?key=` → 404 / 200 (suffit pour le socle ; pas d'asset réel requis).
  - `GET /screenshot` → un BMP/PNG canned (octets statiques) pour `captureScreenshot`.
- Sert **deux usages** : cible du dev manuel (`base = http://localhost:<port>`) et cible du test
  automatique.

## Flux

1. `npm start` (dans `designer/electron/`) → Electron démarre.
2. `main.js` enregistre `app://`, pose l'injection CORS, crée la fenêtre, charge
   `app://app/designer/index.html`.
3. Le designer tourne **identique au navigateur**. L'utilisateur saisit `base` (IP device ou mock).
4. Charger / Statut / Pousser → `device.js` émet `fetch(base + path)` → Chromium envoie la requête →
   le device répond → Electron injecte les en-têtes CORS → le `fetch` réussit → le designer rend.

## Gestion d'erreurs

- **Côté designer** : inchangée. `withBusy` (`app.js`) gère déjà progression/verdict, distingue
  échec réseau (`TypeError` → suffixe « réseau/CORS ? ») d'un HTTP 4xx ou d'une validation, et met à
  jour la pastille de joignabilité.
- **Côté Electron** : le handler `app://` renvoie 404 explicite si un fichier manque (logué) ;
  l'injection d'en-têtes ne doit jamais avaler une réponse — pas d'échec muet.

## Tests & critères de succès

- **Auto (reproductible, sans matériel)** : un test `node:test` qui lance `mock-device.mjs` puis
  exerce `loadLayout` / `getStatus` / `pushLayout` de `device.js` contre lui (le `fetch` global de
  node sert de transport ; même esprit que `device.test.js`). Vérifie le **contrat
  designer↔device**. Critère : le test passe.
- **Manuel (la couche Electron)** : `npm start` → la fenêtre affiche le designer ; Charger / Statut /
  Pousser réussissent **contre le mock**, puis **contre le vrai device branché** (capture à
  l'appui). Critère : les trois opérations aboutissent dans les deux cas.
- **Honnêteté de couverture** : `main.js` (protocole `app://`, injection CORS) n'est **pas** couvert
  par un test automatique — il exige le runtime Electron. Il est validé **manuellement**. À ne pas
  présenter comme auto-testé.

## Hors scope (YAGNI — incréments suivants, chacun son cycle spec→plan)

- **mDNS** : découverte automatique de l'IP du device.
- **Fichiers locaux** : ouvrir/enregistrer `layout.json` et assets sur disque, sans device.
- **Packaging** : `electron-builder` → installeurs NSIS (Win) / dmg (macOS) / AppImage+deb (Linux),
  **signature** (notarisation macOS, signature Windows), auto-update.
- **Approche B** : indépendance totale du CORS firmware (routage IPC), si on durcit le firmware.
- **Staging packagé** : copie de `designer/` + `schema/` dans les `resources` (en dev on sert en
  place ; le staging n'est utile qu'à l'empaquetage).

## Risques / points d'attention

- **`file://` proscrit** : il casserait les imports de modules ES (origine `null`) → d'où `app://`.
- **Mixed-content** : neutralisé en enregistrant `app://` *non-secure* ; à re-vérifier si une
  dépendance exige un *secure context*.
- **Préflight `OPTIONS`** : le socle s'appuie sur le firmware. Si un jour le firmware cesse de
  répondre à `OPTIONS`, l'approche A ne suffit plus → bascule approche B.
- **Version Electron** : épingler une version LTS récente ; vérifier la dispo de `protocol.handle`
  (API moderne) dans la version retenue.
