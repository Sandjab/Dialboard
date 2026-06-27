# Designer Desktop — Fichiers locaux (bundle `.dboard` + workflow éditeur)

- **Date** : 2026-06-27
- **Branche** : `feat/designer-desktop-electron` (suite du socle + mDNS)
- **Statut** : design validé (brainstorm), spec à relire avant plan d'implémentation
- **Scope** : ouvrir/enregistrer un **bundle `.dboard`** (layout **+ assets** embarqués) sur disque,
  avec un **workflow éditeur** (fichier courant, Cmd+S / Cmd+O / Cmd+Shift+S, titre de fenêtre,
  indicateur « modifié »). L'Export/Import `layout.json` existant reste **intact** (coexistence).
  **Hors-scope** : auto-save, fichiers récents, migration de versions de bundle, drag-drop de fichier.

## Problème

Le designer sait déjà exporter/importer un `layout.json` brut (`file-io.js` : download + file picker),
mais (1) sans les **assets** (images), donc pas de vrai hors-ligne transférable, et (2) sans workflow
fichier (chaque export re-télécharge dans ~/Downloads, pas de « Enregistrer » au même endroit). En
desktop, on veut un vrai système de fichiers locaux : un bundle autonome (layout + images) et le
confort éditeur (Cmd+S, fichier courant, titre).

Choix arbitrés au brainstorm : **workflow éditeur complet**, **assets embarqués**, format
**JSON + base64** (extension `.dboard`), **coexistence** avec l'Export/Import existant.

## État vérifié (source de vérité)

### Export/Import layout-only existant — à NE PAS toucher (`designer/js/file-io.js`)
- `bindFileIO(model, { exportBtn, importBtn, importInput, onLoad })` : Export = `Blob([model.toJSON()])`
  → download `layout.json` ; Import = file picker → `model.loadJSON(text)`. Boutons `#export`/`#import`
  + `#import-file` dans `index.html`. Reste le canal « layout brut » (partage / device).

### Caches d'assets et (dé)sérialisation — la logique à réutiliser
- `model` (`model.js`) : `toJSON()` → `JSON.stringify(state, null, 2)` ; `loadJSON(text)` → parse + set
  state + emit ; `subscribe(fn)` → notifié à chaque commit (sert au flag « modifié »).
- Fonds (`bg-image.js`) : `referencedKeys(state)`, `cacheBytes(key)`, `cachePut(key, bytes)`, `previewUrl(key)`.
- Images placées (`image-asset.js`) : `referencedImageKeys(state)`, `cacheBytes(key)`,
  `rehydrate(key, compId, bytes, w, h)`, `previewUrl(key)`.
- Animations (`image-anim-asset.js`) : `referencedAimgKeys(state)`, `packBytes(key)`,
  `rehydrate(key, bytes, w, h, frames)`, `previewUrl(key)`.
- **`app.js` fait déjà exactement ce dont on a besoin**, mais contre le device :
  - *Collecte (push)* : `referencedKeys`→`cacheBytes`, `referencedImageKeys`→`imageCacheBytes`,
    `referencedAimgKeys`→`aimgPackBytes`.
  - *Ré-hydratation (load)* : itère `model.state.components` ; fond → `cachePut(key, bytes)` ;
    `image` → `rehydrateImage(ic.src, id, bytes, ic.w, ic.h)` ; `image_anim` →
    `rehydrateAimg(ic.src, bytes, ic.w, ic.h, ic.frames)`. Le bundle remplace device par fichier.

### Socle desktop (point d'ancrage)
- `designer/electron/main.js` : Electron main (CJS) — `app://`, CORS, `ipcMain`, `BrowserWindow` avec
  `preload`. On y ajoute le menu natif + les handlers fichiers.
- `designer/electron/preload.js` : déjà présent (mDNS). On y ajoute l'API `window.desktop`.

## Décisions

1. **Le zéro-touch est levé** (nécessairement) : seul le designer détient `model` + les caches → il
   participe à la (dé)sérialisation. On ajoute un **« mode desktop » activé si `window.desktop` existe**
   ; en web (absent), comportement **inchangé**.
2. **Format `.dboard`** = `{ "version": 1, "layout": <objet layout>, "assets": { "bg": {key:b64},
   "image": {key:b64}, "aimg": {key:b64} } }`. JSON + base64, une seule dépendance : aucune.
3. **`bundle.js` (nouveau, designer)** sépare une **partie pure testable** (`encodeBundle`/`decodeBundle`)
   d'une **partie caches** (collecte/ré-hydratation).
4. **Pont desktop** : `window.desktop` (preload, contextBridge) + menu natif/`dialog`/`fs` (main).
5. **Coexistence** : on **ajoute** Ouvrir/Enregistrer `.dboard` ; l'Export/Import `layout.json` n'est
   pas modifié.

## Architecture

```
designer/js/
  bundle.js   (créer)  # encodeBundle/decodeBundle (purs) + collectAssets/applyAssets (caches)
  app.js      (modif)  # « mode desktop » si window.desktop : fichier courant, dirty, Cmd+S/O, titre
designer/electron/
  preload.js  (modif)  # expose window.desktop (open/save/saveAs/onMenu/setTitle)
  main.js     (modif)  # menu natif Cmd+O/S/Shift+S + handlers dialog/fs + titre fenêtre
designer/tests/
  bundle.test.js (créer)  # round-trip encodeBundle/decodeBundle (sans I/O ni canvas)
designer/index.html, file-io.js, autres modules assets  # INCHANGÉS
```

## Composants

### `designer/js/bundle.js`
- **Pur (testable node)** :
  - `encodeBundle(layoutText, assets)` → string. `assets = { bg:{key:Uint8Array}, image:{…}, aimg:{…} }`.
    Produit `{version:1, layout: JSON.parse(layoutText), assets:{…en base64…}}` sérialisé.
  - `decodeBundle(text)` → `{ layout: <string JSON>, assets: { bg:{key:Uint8Array}, image, aimg } }`.
    Rejette (throw) si `version !== 1` ou structure absente.
- **Caches (orchestration, navigateur)** :
  - `collectAssets(model)` → `{bg, image, aimg}` via `referenced*` + `cacheBytes`/`imageCacheBytes`/`aimgPackBytes`.
  - `applyAssets(model, assets)` → ré-hydrate : fonds via `cachePut` ; itère `model.state.components`
    pour `image`/`image_anim` → `rehydrateImage`/`rehydrateAimg` (mêmes args que `app.js` load).
  - `serializeBundle(model)` = `encodeBundle(model.toJSON(), collectAssets(model))`.
  - `loadBundle(model, text)` = `{ const {layout, assets} = decodeBundle(text); model.loadJSON(layout); applyAssets(model, assets); }`.

### `designer/electron/preload.js` (ajout)
- `contextBridge.exposeInMainWorld('desktop', { openBundle, saveBundle, saveBundleAs, onMenu, setTitle })`.
  - `openBundle()` → `ipcRenderer.invoke('file:open')` → `{path, text} | null`.
  - `saveBundle(text, path)` → `invoke('file:save', {text, path})` → `{path} | null` (null si annulé).
  - `saveBundleAs(text)` → `invoke('file:saveAs', {text})` → `{path} | null`.
  - `onMenu(cb)` → `ipcRenderer.on('menu', (_e, action) => cb(action))` (`'open'|'save'|'saveAs'`).
  - `setTitle(name)` → `invoke('window:setTitle', name)`.

### `designer/electron/main.js` (ajout)
- **Menu natif** (`Menu.setApplicationMenu`) : Ouvrir `Cmd+O`, Enregistrer `Cmd+S`, Enregistrer sous
  `Cmd+Shift+S` → `win.webContents.send('menu', 'open'|'save'|'saveAs')`.
- **Handlers** : `file:open` (`dialog.showOpenDialog` filtre `.dboard` → lit le fichier → `{path,text}` ou
  `null`) ; `file:save` (si `path` fourni → `fs.writeFile` ; sinon `showSaveDialog` → write → `{path}`) ;
  `file:saveAs` (`showSaveDialog` → write → `{path}`) ; `window:setTitle` (`win.setTitle`).

### `designer/js/app.js` (mode desktop)
- Au boot, si `window.desktop` : initialise `currentPath = null`, `dirty = false`.
- `model.subscribe(() => { dirty = true; refreshTitle(); })`.
- `window.desktop.onMenu(action => …)` : `open` → `openBundle()` → `loadBundle` + `currentPath=path`,
  `dirty=false`, `refreshTitle()` ; `save` → `saveBundle(serializeBundle(model), currentPath)` (bascule
  sur `saveAs` si `currentPath` null) ; `saveAs` → `saveBundleAs(serializeBundle(model))`.
- `refreshTitle()` → `window.desktop.setTitle((currentPath ? basename : 'Sans titre') + (dirty ? ' •' : ''))`.

## Flux

Cmd+O → menu → renderer `onMenu('open')` → `desktop.openBundle()` (main : dialog+read) → `loadBundle`
(layout + ré-hydratation caches) → titre/`currentPath`/`dirty=false`. Édition → `model` commit →
`dirty=true` + titre `•`. Cmd+S → `serializeBundle` (collecte caches + base64) → `desktop.saveBundle`
(main : write au `currentPath`) → `dirty=false`. Le « Pousser » device fonctionne après ouverture (les
caches sont ré-hydratés).

## Gestion d'erreurs

- Lecture/écriture disque échouée → toast d'échec (`showToast`, `kind:'err'`), `dirty` **non** remis à
  false. Dialogue annulé → no-op silencieux (`null`).
- `decodeBundle` : `version` inconnue ou structure invalide → throw → toast clair, modèle inchangé.
- Web (pas de `window.desktop`) : aucun de ces chemins n'est branché → designer strictement inchangé.

## Tests & critères de succès

- **Auto (node:test)** : `bundle.test.js` — round-trip `encodeBundle`/`decodeBundle` (layout + assets
  des 3 types en `Uint8Array` → base64 → re-décodés identiques), `version:1` posée, rejet d'un bundle
  sans `version`/`assets`. Pas d'I/O disque ni de canvas. Critère : verts + suite non régressée.
- **Navigateur/Electron (manuel)** : avec un layout contenant **fond + image + animation** —
  Enregistrer (Cmd+S) → fichier `.dboard` écrit ; relancer, Ouvrir (Cmd+O) → board + images restaurés ;
  titre = nom du fichier, `•` après édition, disparaît après Enregistrer ; « Pousser » device OK ensuite.
- **Honnêteté de couverture** : la collecte/ré-hydratation (caches + canvas) et le workflow (menu,
  dialogues, titre) ne sont **pas** auto-testés (DOM/Electron requis) — validés manuellement. Seule la
  partie format de `bundle.js` est auto-testée.

## Risques / points d'attention

- **Ré-hydratation = canvas** : `rehydrateImage`/`rehydrateAimg` reconstruisent les previews via canvas
  → non testables en node → validés au navigateur. D'où la séparation pur/caches dans `bundle.js`.
- **Ré-hydratation par composant** : `rehydrateImage` exige `(key, compId, bytes, w, h)` → `applyAssets`
  itère les composants du layout chargé (comme `app.js` load), pas juste les clés.
- **Taille** : base64 = +33 % ; acceptable pour des assets de quelques centaines de Ko (écran 360×360).
- **`bundle.js` importe les modules à état des caches** : même graphe que `app.js` ; pas de cycle
  introduit (bundle dépend des caches, pas l'inverse).
- **Packaging** : `bundle.js` est du designer (servi via `app://`), aucune dépendance npm ajoutée.
