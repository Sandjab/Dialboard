# Fichiers locaux desktop (bundle `.dboard`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ouvrir/enregistrer un bundle `.dboard` (layout + assets embarqués) avec un workflow éditeur natif (fichier courant, Cmd+S/O/Shift+S, titre, indicateur modifié), sans toucher l'Export/Import existant.

**Architecture:** `designer/js/bundle.js` (dé)sérialise `{version:1, layout, assets:{bg,image,aimg en base64}}` — partie pure (encode/decode) + partie caches (réutilise `referenced*`/`cacheBytes`/`rehydrate*` comme `app.js`). La couche Electron expose `window.desktop` (preload) + menu natif/`dialog`/`fs` (main). `app.js` gagne un « mode desktop » activé si `window.desktop` existe.

**Tech Stack:** Electron 42 (`Menu`/`dialog`/`fs`), `node:test`, base64 via `btoa`/`atob` (portable node+navigateur).

**Spec :** `docs/superpowers/specs/2026-06-27-designer-desktop-fichiers-locaux-design.md`
**Branche :** `feat/designer-desktop-electron`.

---

## File Structure

| Fichier | Rôle |
|---|---|
| `designer/js/bundle.js` (créer) | `encodeBundle`/`decodeBundle` (purs) + `collectAssets`/`applyAssets`/`serializeBundle`/`loadBundle` (caches). |
| `designer/tests/bundle.test.js` (créer) | Round-trip `encodeBundle`/`decodeBundle` (sans I/O ni canvas). |
| `designer/electron/preload.js` (modif) | + `contextBridge` `window.desktop`. |
| `designer/electron/main.js` (modif) | + menu natif + handlers `file:open/save/saveAs` + `window:setTitle`. |
| `designer/js/app.js` (modif) | + bloc « mode desktop » (workflow fichier). |

---

## Task 1 : `bundle.js` — encode/decode purs + tests

**Files:**
- Test: `designer/tests/bundle.test.js` (créer)
- Create: `designer/js/bundle.js`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `designer/tests/bundle.test.js` :

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBundle, decodeBundle } from '../js/bundle.js';

const layout = { title: 'X', pages: [{ name: 'p', place: [] }] };
const assets = {
  bg:    { a1: new Uint8Array([1, 2, 3]) },
  image: { b2: new Uint8Array([4, 5, 6, 7]) },
  aimg:  { c3: new Uint8Array([8, 9]) },
};

test('round-trip : layout + assets des 3 types survivent à encode→decode (intent : le bundle est fidèle)', () => {
  const back = decodeBundle(encodeBundle(JSON.stringify(layout), assets));
  assert.deepEqual(JSON.parse(back.layout), layout);
  assert.deepEqual([...back.assets.bg.a1], [1, 2, 3]);
  assert.deepEqual([...back.assets.image.b2], [4, 5, 6, 7]);
  assert.deepEqual([...back.assets.aimg.c3], [8, 9]);
});

test('encodeBundle : pose version 1 et des assets base64 (intent : format stable et lisible)', () => {
  const o = JSON.parse(encodeBundle(JSON.stringify(layout), assets));
  assert.equal(o.version, 1);
  assert.equal(typeof o.assets.bg.a1, 'string');   // base64
});

test('decodeBundle : rejette un bundle sans version (intent : ne pas charger un format inconnu)', () => {
  assert.throws(() => decodeBundle(JSON.stringify({ layout, assets: {} })), /version|invalide/i);
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `(cd designer && node --test)`
Expected: ÉCHEC — `bundle.test.js` ne peut pas importer `../js/bundle.js` (`ERR_MODULE_NOT_FOUND`). Autres tests verts.

- [ ] **Step 3: Implémenter la partie pure de `bundle.js`**

Créer `designer/js/bundle.js` :

```javascript
// Bundle .dboard : { version:1, layout, assets:{ bg|image|aimg : { key: base64 } } }.
// Partie PURE (encode/decode + base64) — testée en node. La partie « caches » (plus bas) touche
// les modules d'assets et n'est exécutable qu'au navigateur (canvas).

const CHUNK = 0x8000;
function bytesToB64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i += CHUNK) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  return btoa(bin);
}
function b64ToBytes(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
const mapVals = (m, f) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, f(v)]));

// layoutText (string JSON) + assets {bg,image,aimg : {key:Uint8Array}} → string .dboard.
export function encodeBundle(layoutText, assets = {}) {
  return JSON.stringify({
    version: 1,
    layout: JSON.parse(layoutText),
    assets: {
      bg: mapVals(assets.bg, bytesToB64),
      image: mapVals(assets.image, bytesToB64),
      aimg: mapVals(assets.aimg, bytesToB64),
    },
  });
}

// string .dboard → { layout: string JSON, assets:{bg,image,aimg : {key:Uint8Array}} }. Throw si invalide.
export function decodeBundle(text) {
  const o = JSON.parse(text);
  if (o.version !== 1 || !o.assets) throw new Error('Bundle .dboard invalide ou version non supportée');
  return {
    layout: JSON.stringify(o.layout),
    assets: {
      bg: mapVals(o.assets.bg, b64ToBytes),
      image: mapVals(o.assets.image, b64ToBytes),
      aimg: mapVals(o.assets.aimg, b64ToBytes),
    },
  };
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `(cd designer && node --test)`
Expected: SUCCÈS — les 3 tests `bundle` passent ; suite designer verte.

- [ ] **Step 5: Commit**

```bash
git add designer/js/bundle.js designer/tests/bundle.test.js
git commit -F - <<'EOF'
feat(designer): bundle .dboard — encode/decode (purs) + tests

Format {version:1, layout, assets bg/image/aimg en base64}. encodeBundle/
decodeBundle sans I/O ni canvas (base64 via btoa/atob, portable) → testés node.

Claude-Session: https://claude.ai/code/session_01RJn5U2gefBafayaAov6tCN
EOF
```

---

## Task 2 : `bundle.js` — collecte/ré-hydratation des assets

Pas de test auto : la collecte/ré-hydratation touche les caches (canvas) → validée au navigateur. Réutilise la logique déjà éprouvée de `app.js` (load/push).

**Files:**
- Modify: `designer/js/bundle.js`

- [ ] **Step 1: Ajouter les fonctions caches à `bundle.js`**

Ajouter en tête les imports, et en fin de fichier les 4 fonctions :

En tête de `designer/js/bundle.js` (après le commentaire d'en-tête) :
```javascript
import { referencedKeys, cacheBytes as bgBytes, cachePut as bgPut } from './bg-image.js';
import { referencedImageKeys, cacheBytes as imgBytes, rehydrate as imgRehydrate } from './image-asset.js';
import { referencedAimgKeys, packBytes as aimgBytes, rehydrate as aimgRehydrate } from './image-anim-asset.js';
```

En fin de `designer/js/bundle.js` :
```javascript
// Lit les octets en cache pour toutes les clés référencées par le layout (3 types).
export function collectAssets(model) {
  const pick = (keys, get) => Object.fromEntries(keys.map(k => [k, get(k)]).filter(([, v]) => v));
  return {
    bg: pick(referencedKeys(model.state), bgBytes),
    image: pick(referencedImageKeys(model.state), imgBytes),
    aimg: pick(referencedAimgKeys(model.state), aimgBytes),
  };
}

// Ré-hydrate les caches depuis les octets du bundle. Fonds par clé ; image/anim par composant
// (rehydrate exige compId + dims, lues dans le layout) — même logique que app.js load.
export function applyAssets(model, assets) {
  for (const [k, bytes] of Object.entries(assets.bg || {})) bgPut(k, bytes);
  for (const [id, ic] of Object.entries(model.state.components || {})) {
    if (ic.type === 'image' && assets.image?.[ic.src] && ic.w > 0 && ic.h > 0) {
      imgRehydrate(ic.src, id, assets.image[ic.src], ic.w, ic.h);
    }
    if (ic.type === 'image_anim' && assets.aimg?.[ic.src] && ic.w > 0 && ic.h > 0 && ic.frames > 0) {
      aimgRehydrate(ic.src, assets.aimg[ic.src], ic.w, ic.h, ic.frames);
    }
  }
}

export function serializeBundle(model) {
  return encodeBundle(model.toJSON(), collectAssets(model));
}

export function loadBundle(model, text) {
  const { layout, assets } = decodeBundle(text);
  model.loadJSON(layout);
  applyAssets(model, assets);
}
```

- [ ] **Step 2: Vérif statique + non-régression**

Run: `(cd designer && node --check js/bundle.js) && echo OK`
Expected: `OK` (note : `node --check` valide la syntaxe ; les imports canvas ne sont pas exécutés).
Run: `(cd designer && node --test)`
Expected: suite toujours verte (les tests de Task 1 n'exercent que la partie pure ; ils n'importent pas les fonctions caches).

- [ ] **Step 3: Validation navigateur (le contrôleur)**

Servir le designer en no-store et confirmer qu'il charge sans erreur console avec `bundle.js` importable, et que `serializeBundle`/`loadBundle` font un round-trip sur un layout (sans assets, via console). La validation E2E avec de vrais assets (image/anim) se fait en Electron à la Task 4.

- [ ] **Step 4: Commit**

```bash
git add designer/js/bundle.js
git commit -F - <<'EOF'
feat(designer): bundle .dboard — collecte/ré-hydratation des assets

collectAssets (référencés → octets en cache) et applyAssets (octets → caches
via cachePut/rehydrate, par composant pour image/anim). serializeBundle/
loadBundle bouclent layout + assets. Réutilise la logique app.js load/push.

Claude-Session: https://claude.ai/code/session_01RJn5U2gefBafayaAov6tCN
EOF
```

---

## Task 3 : Pont desktop (`window.desktop` + menu/dialog/fs)

Validé manuellement (runtime Electron).

**Files:**
- Modify: `designer/electron/preload.js`, `designer/electron/main.js`

- [ ] **Step 1: Exposer `window.desktop` dans le preload**

Au DÉBUT de `designer/electron/preload.js`, après la ligne `const { ipcRenderer } = require('electron');`, remplacer cette ligne par :
```javascript
const { contextBridge, ipcRenderer } = require('electron');

// Pont desktop pour les fichiers locaux (.dboard). Exposé au renderer ; le designer l'utilise s'il existe.
contextBridge.exposeInMainWorld('desktop', {
  openBundle: () => ipcRenderer.invoke('file:open'),
  saveBundle: (text, path) => ipcRenderer.invoke('file:save', { text, path }),
  saveBundleAs: (text) => ipcRenderer.invoke('file:saveAs', { text }),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
  setTitle: (name) => ipcRenderer.invoke('window:setTitle', name),
});
```
(Le reste du preload — la découverte mDNS sur `DOMContentLoaded` — est conservé tel quel.)

- [ ] **Step 2: Ajouter menu + handlers dans `main.js`**

Étendre l'import electron de `main.js` :
```javascript
const { app, BrowserWindow, protocol, session, net, ipcMain, Menu, dialog } = require('electron');
```
Ajouter en haut (après les autres `require`) :
```javascript
const fs = require('node:fs/promises');
```
Refactorer la création de fenêtre pour garder une référence et installer le menu. Remplacer le bloc :
```javascript
  const win = new BrowserWindow({
    width: 1100, height: 800,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.loadURL('app://app/designer/index.html');
```
par :
```javascript
  const win = new BrowserWindow({
    width: 1100, height: 800,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.loadURL('app://app/designer/index.html');

  // Menu natif : raccourcis fichier → relayés au renderer (qui détient model + caches).
  const send = (action) => () => win.webContents.send('menu', action);
  const fileMenu = {
    label: 'Fichier',
    submenu: [
      { label: 'Ouvrir…', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: 'Enregistrer', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { label: 'Enregistrer sous…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
      { type: 'separator' },
      process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
    ],
  };
  const template = process.platform === 'darwin'
    ? [{ role: 'appMenu' }, fileMenu, { role: 'editMenu' }, { role: 'viewMenu' }]
    : [fileMenu, { role: 'editMenu' }, { role: 'viewMenu' }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  const DBOARD = [{ name: 'Dialboard', extensions: ['dboard'] }];
  ipcMain.handle('file:open', async () => {
    const r = await dialog.showOpenDialog(win, { filters: DBOARD, properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { path: r.filePaths[0], text: await fs.readFile(r.filePaths[0], 'utf8') };
  });
  ipcMain.handle('file:save', async (_e, { text, path: p }) => {
    let target = p;
    if (!target) {
      const r = await dialog.showSaveDialog(win, { filters: DBOARD, defaultPath: 'layout.dboard' });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    await fs.writeFile(target, text);
    return { path: target };
  });
  ipcMain.handle('file:saveAs', async (_e, { text }) => {
    const r = await dialog.showSaveDialog(win, { filters: DBOARD, defaultPath: 'layout.dboard' });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, text);
    return { path: r.filePath };
  });
  ipcMain.handle('window:setTitle', (_e, name) => win.setTitle(name));
```

- [ ] **Step 3: Vérif statique**

Run: `node --check designer/electron/main.js && node --check designer/electron/preload.js && echo OK`
Expected: `OK`.

- [ ] **Step 4: Validation manuelle (Electron)**

`(cd designer/electron && npm start)` → vérifier que le menu **Fichier** apparaît avec Ouvrir/Enregistrer/Enregistrer sous (Cmd+O/S/Shift+S). Le comportement effectif (lecture/écriture) est validé à la Task 4 (qui branche le renderer). Pas d'erreur console au boot.

- [ ] **Step 5: Commit**

```bash
git add designer/electron/preload.js designer/electron/main.js
git commit -F - <<'EOF'
feat(designer): pont desktop fichiers (window.desktop + menu/dialog/fs)

preload expose window.desktop (open/save/saveAs/onMenu/setTitle). main ajoute
le menu natif Fichier (Cmd+O/S/Shift+S) + handlers dialog/fs + setTitle.

Claude-Session: https://claude.ai/code/session_01RJn5U2gefBafayaAov6tCN
EOF
```

---

## Task 4 : Mode desktop dans `app.js` (workflow Ouvrir/Enregistrer)

Validé manuellement (Electron GUI). Touche le designer (zéro-touch levé, acté dans la spec).

**Files:**
- Modify: `designer/js/app.js`

- [ ] **Step 1: Importer le bundle**

Ajouter aux imports en tête de `designer/js/app.js` :
```javascript
import { serializeBundle, loadBundle } from './bundle.js';
```

- [ ] **Step 2: Brancher le mode desktop**

Localiser l'appel existant `bindFileIO(model, { exportBtn: $('export'), importBtn: $('import'), importInput: $('import-file'), onLoad: … })` dans `app.js`. Juste APRÈS cet appel, ajouter ce bloc (il réutilise la même fonction `onLoad` que `bindFileIO` ; si elle est inline, l'extraire dans une const `onLoad` et la passer aux deux) :

```javascript
  // Mode desktop (Electron) : workflow fichier .dboard (layout + assets). Inactif en web (window.desktop absent).
  if (window.desktop) {
    let currentPath = null, dirty = false;
    const baseName = (p) => (p ? p.replace(/^.*[\\/]/, '') : 'Sans titre');
    const refreshTitle = () => window.desktop.setTitle(baseName(currentPath) + (dirty ? ' •' : ''));
    refreshTitle();
    model.subscribe(() => { dirty = true; refreshTitle(); });
    window.desktop.onMenu(async (action) => {
      try {
        if (action === 'open') {
          const r = await window.desktop.openBundle();
          if (!r) return;
          loadBundle(model, r.text);
          onLoad && onLoad();
          currentPath = r.path; dirty = false; refreshTitle();
          logs.logActivity('Bundle ouvert : ' + baseName(r.path));
        } else {                                   // 'save' | 'saveAs'
          const text = serializeBundle(model);
          const r = (action === 'save' && currentPath)
            ? await window.desktop.saveBundle(text, currentPath)
            : await window.desktop.saveBundleAs(text);
          if (!r) return;                          // dialogue annulé → ne pas marquer propre
          currentPath = r.path; dirty = false; refreshTitle();
          logs.logActivity('Bundle enregistré : ' + baseName(r.path));
        }
      } catch (e) {
        showToast('Fichier : ' + e.message, { kind: 'err' });
      }
    });
  }
```

Note : `app.js` importe déjà `logs` et `showToast` (utilisés ailleurs). Si `onLoad` est défini inline dans l'appel `bindFileIO`, extraire `const onLoad = () => { … };` au-dessus et le passer à `bindFileIO` ET au bloc desktop (DRY).

- [ ] **Step 3: Vérif statique + non-régression**

Run: `(cd designer && node --check js/app.js) && echo OK`
Expected: `OK`.
Run: `(cd designer && node --test)`
Expected: suite verte (les tests n'importent pas `app.js`).

- [ ] **Step 4: Validation manuelle (Electron GUI) — le critère de succès du sous-projet**

`(cd designer/electron && npm start)`. Avec un layout contenant **un fond + une image + une animation** :
1. **Enregistrer sous** (Cmd+Shift+S) → choisir `essai.dboard` → fichier écrit ; titre = `essai.dboard`.
2. Éditer un composant → titre passe à `essai.dboard •`.
3. **Enregistrer** (Cmd+S) → `•` disparaît (réécrit au même chemin sans redemander).
4. Relancer l'app, **Ouvrir** (Cmd+O) → `essai.dboard` → board + fond + image + animation **restaurés** ; titre = `essai.dboard`.
5. **Pousser** vers le device (ou le mock) après ouverture → fonctionne (caches ré-hydratés).
6. Vérifier que l'**Export/Import `layout.json`** existant marche toujours (coexistence intacte).

> Si le device/asset complet n'est pas disponible, valider au minimum le round-trip layout + une image, et signaler ce qui n'a pas été couvert (ne pas cocher à la légère).

- [ ] **Step 5: Commit**

```bash
git add designer/js/app.js
git commit -F - <<'EOF'
feat(designer): mode desktop — workflow Ouvrir/Enregistrer .dboard

app.js active un mode fichier si window.desktop : fichier courant, indicateur
modifié (model.subscribe), Cmd+O/S/Shift+S via le menu natif, titre de fenêtre.
serializeBundle/loadBundle embarquent les assets. Web inchangé (pont absent).

Claude-Session: https://claude.ai/code/session_01RJn5U2gefBafayaAov6tCN
EOF
```

---

## Notes d'exécution

- **cwd** : commandes en sous-shells `( … )`.
- **Zéro-touch levé** uniquement où nécessaire : `app.js` (bloc desktop) + nouveau `bundle.js`. `file-io.js`, `index.html` et les modules d'assets restent inchangés.
- **Couverture honnête** : seule la partie pure de `bundle.js` est auto-testée ; caches, pont et workflow sont validés au navigateur/Electron.
- **base64** : `btoa`/`atob` (pas `Buffer`) pour fonctionner en node (test) ET au navigateur (prod).
- **Pas de push** sans demande explicite.
