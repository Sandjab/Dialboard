# Designer Desktop — PoC socle (Electron) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empaqueter le designer web existant dans une fenêtre Electron qui parle au device sans souci de CORS, `designer/` restant intact.

**Architecture:** Wrapper Electron minimal dans `designer/electron/`. Il sert le designer via un protocole interne `app://` (mappé sur la racine du repo, qui contient `designer/` et `schema/` côte à côte) et injecte les en-têtes CORS sur les réponses du device via `session.webRequest.onHeadersReceived`. Un faux device HTTP (node) sert au dev manuel et au test automatique du contrat transport.

**Tech Stack:** Electron (main process CommonJS, `protocol.handle` + `net.fetch`), node:http (mock device), `node:test` (test transport, déjà la pile du designer).

**Spec de référence :** `docs/superpowers/specs/2026-06-27-designer-desktop-electron-design.md`

**Branche :** `feat/designer-desktop-electron` (déjà créée, contient la spec).

---

## File Structure

| Fichier | Rôle |
|---|---|
| `designer/electron/mock-device.mjs` (créer) | Faux device HTTP : routes `/status`, `/layout` (GET/POST), `/update`. Export `startMockDevice(port)`. Lançable en CLI pour le dev manuel. |
| `designer/tests/electron-transport.test.js` (créer) | Test `node:test` du round-trip `device.js` ↔ mock (Charger / Statut / Pousser + rejet). |
| `designer/electron/package.json` (créer) | Manifeste Electron (CommonJS), script `start`, dép `electron`. |
| `designer/electron/main.js` (créer) | Process principal : `app://` + injection CORS + `BrowserWindow`. |
| `designer/electron/README.md` (créer) | Mode d'emploi : dev avec mock, validation vrai device, statut PoC. |
| `.gitignore` (modifier) | Ignorer `designer/electron/node_modules/`. |

Note convention : `designer/` n'est **jamais** modifié (zéro-touch, parité avec l'embarqué).

---

## Task 1: Mock device + test transport (TDD)

**Files:**
- Test: `designer/tests/electron-transport.test.js` (créer)
- Create: `designer/electron/mock-device.mjs`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `designer/tests/electron-transport.test.js` :

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLayout, getStatus, pushLayout } from '../js/device.js';
import { startMockDevice } from '../electron/mock-device.mjs';

// Intent : prouver que le contrat REST designer↔device tient bout-à-bout (vrai HTTP round-trip),
// pas seulement que device.js compile. Le mock joue le firmware.

test('transport : getStatus rend le statut du device (le contrat /status tient bout-à-bout)', async () => {
  const dev = await startMockDevice();
  try {
    const s = await getStatus(dev.url);
    assert.equal(typeof s.ip, 'string');
    assert.equal(s.pages, 1);
  } finally { await dev.close(); }
});

test('transport : loadLayout parse et rend le layout servi (le designer reçoit le layout réel)', async () => {
  const dev = await startMockDevice();
  try {
    const lay = await loadLayout(dev.url);
    assert.equal(lay.title, 'Dialboard');
    assert.ok(Array.isArray(lay.pages));
  } finally { await dev.close(); }
});

test('transport : pushLayout réussit sur un layout valide (un push accepté ne lève pas)', async () => {
  const dev = await startMockDevice();
  try {
    const res = await pushLayout(dev.url, JSON.stringify({ pages: [{ name: 'x', place: [] }] }));
    assert.equal(res.ok, true);
  } finally { await dev.close(); }
});

test('transport : pushLayout LÈVE quand le device rejette (ne jamais avaler un rejet → l’utilisateur voit l’échec)', async () => {
  const dev = await startMockDevice();
  try {
    await assert.rejects(() => pushLayout(dev.url, JSON.stringify({})), /pages/);
  } finally { await dev.close(); }
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `(cd designer && node --test)`
Expected: ÉCHEC — le fichier `electron-transport.test.js` ne peut pas importer `../electron/mock-device.mjs` (`ERR_MODULE_NOT_FOUND`). Les autres tests du designer restent verts.

- [ ] **Step 3: Implémenter le mock device**

Créer `designer/electron/mock-device.mjs` :

```javascript
// Faux device HTTP pour le PoC desktop : dev manuel (CLI) + test transport.
// Sert les routes utilisées par le socle ; simule la validation device sur POST /layout.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAYOUT_PATH = join(__dirname, '..', '..', 'data', 'layout.json'); // racine repo / data

const STATUS = { ip: '127.0.0.1', page: 0, pages: 1, uptime_s: 1, components: 0, sources: [] };

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

// Démarre le mock. port=0 → port libre attribué par l'OS (tests). Renvoie { url, close }.
export function startMockDevice(port = 0) {
  const layout = readFileSync(LAYOUT_PATH, 'utf8');
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const sendJson = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET' && url.pathname === '/status') return sendJson(200, STATUS);
    if (req.method === 'GET' && url.pathname === '/layout') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(layout);
    }
    if (req.method === 'POST' && url.pathname === '/layout') {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body); } catch { return sendJson(400, { ok: false, error: 'JSON invalide' }); }
      if (!Array.isArray(parsed.pages)) return sendJson(200, { ok: false, error: 'layout sans pages' });
      return sendJson(200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/update') {
      return sendJson(200, { ok: true, updated: [], unknown: [] });
    }
    return sendJson(404, { ok: false, error: 'not found' });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({
        url: `http://127.0.0.1:${p}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// Lancement CLI direct : `node mock-device.mjs` → écoute sur PORT (défaut 8099) pour le dev manuel.
// 8099 et non 8000 (port réservé à l'utilisateur).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT) || 8099;
  startMockDevice(port).then((d) => console.log('mock device →', d.url));
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `(cd designer && node --test)`
Expected: SUCCÈS — les 4 tests `transport : …` passent, et toute la suite designer reste verte.

- [ ] **Step 5: Commit**

```bash
git add designer/electron/mock-device.mjs designer/tests/electron-transport.test.js
git commit -F - <<'EOF'
test(designer): transport device.js ↔ mock device (round-trip node)

Mock HTTP node (startMockDevice) servant /status, /layout, /update, et
simulant la validation device sur POST /layout. Test node:test du contrat
designer↔device bout-à-bout : Charger/Statut/Pousser + rejet propagé.

Claude-Session: https://claude.ai/code/session_01RJn5U2gefBafayaAov6tCN
EOF
```

---

## Task 2: Wrapper Electron (app:// + injection CORS)

Cette tâche n'a **pas** de test automatique : `main.js` exige le runtime Electron (acté dans la spec, §Tests). Validation **manuelle** contre le mock à la fin de la tâche.

**Files:**
- Create: `designer/electron/package.json`
- Create: `designer/electron/main.js`
- Modify: `.gitignore`

- [ ] **Step 1: Créer le manifeste Electron**

Créer `designer/electron/package.json` (CommonJS — pas de `"type": "module"`, pour que `main.js` reste en `require` ; `electron` sera ajouté à l'étape d'installation) :

```json
{
  "name": "dialboard-designer-desktop",
  "version": "0.0.0",
  "private": true,
  "description": "Wrapper Electron du designer Dialboard (PoC socle).",
  "main": "main.js",
  "scripts": {
    "start": "electron ."
  }
}
```

- [ ] **Step 2: Créer le process principal**

Créer `designer/electron/main.js` :

```javascript
// Process principal Electron du designer desktop (PoC socle).
// - sert designer/ + schema/ via le protocole interne app:// (file:// casserait les modules ES) ;
// - injecte les en-têtes CORS sur les réponses du device (approche A) → designer/ reste zéro-touch.
const { app, BrowserWindow, protocol, session, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Racine servie par app:// : contient designer/ ET schema/ côte à côte (= racine du repo en dev).
// app://app/designer/index.html → ROOT/designer/index.html ; le fetch('../schema/…') de app.js → ROOT/schema/…
const ROOT = path.resolve(__dirname, '..', '..');

// Doit être appelé AVANT app.whenReady. standard:true → modules ES + localStorage ;
// secure:false → la page n'est pas un secure context, donc fetch http://<device> n'est pas bloqué (mixed-content).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: false, supportFetchAPI: true, stream: true } },
]);

function injectCors() {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (/^https?:\/\//.test(details.url)) {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Access-Control-Allow-Origin': ['*'],
          'Access-Control-Allow-Methods': ['GET, POST, OPTIONS'],
          'Access-Control-Allow-Headers': ['*'],
        },
      });
    } else {
      cb({});
    }
  });
}

function serveApp() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.join(ROOT, decodeURIComponent(pathname));
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

app.whenReady().then(() => {
  injectCors();
  serveApp();
  const win = new BrowserWindow({ width: 1100, height: 800, webPreferences: { contextIsolation: true } });
  win.loadURL('app://app/designer/index.html');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: Ignorer node_modules d'Electron**

Ajouter une ligne à `.gitignore` (à la fin du fichier) :

```
designer/electron/node_modules/
```

- [ ] **Step 4: Installer Electron**

Run: `(cd designer/electron && npm install --save-dev electron@latest)`
Expected: installation OK ; `package.json` gagne `"devDependencies": { "electron": "^<version>" }` et un `package-lock.json` est créé. (`protocol.handle`/`net.fetch` exigent Electron ≥ 25 ; `@latest` les couvre largement.)

- [ ] **Step 5: Validation manuelle contre le mock**

Dans un 1er terminal :
Run: `(cd designer/electron && PORT=8099 node mock-device.mjs)`
Expected: affiche `mock device → http://127.0.0.1:8099` (laisser tourner).

Dans un 2e terminal :
Run: `(cd designer/electron && npm start)`
Expected : une fenêtre s'ouvre et affiche le designer (board rond, toolbar, inspecteur — identique au navigateur). Vérifier la console (View ▸ Toggle Developer Tools) : **aucune** erreur de chargement de module ni de MIME.

Dans la fenêtre :
1. Saisir l'URL device : `http://127.0.0.1:8099`.
2. **Statut** → la pastille device passe au vert (`● 127.0.0.1`).
3. **Charger** → le layout du mock s'affiche sur le board (titre « Dialboard », anneaux).
4. **Pousser** → toast « Poussé et persisté » (le mock accepte le layout valide).

Si la console signale une erreur MIME sur les `.js` (modules non chargés), c'est LE point à corriger : forcer `Content-Type: text/javascript` dans le handler `app://` pour les `.js`. Sinon, rien à faire.

Arrêter le mock (Ctrl-C dans le 1er terminal) une fois validé.

- [ ] **Step 6: Commit**

```bash
git add designer/electron/package.json designer/electron/package-lock.json designer/electron/main.js .gitignore
git commit -F - <<'EOF'
feat(designer): wrapper Electron — app:// + injection CORS (PoC socle)

Fenêtre Electron servant designer/ + schema/ via le protocole interne
app:// (file:// casse les modules ES) et injectant les en-têtes CORS sur
les réponses device (onHeadersReceived). designer/ reste zéro-touch.
Validé manuellement contre le mock device.

Claude-Session: https://claude.ai/code/session_01RJn5U2gefBafayaAov6tCN
EOF
```

---

## Task 3: Mode d'emploi + validation contre le vrai device

**Files:**
- Create: `designer/electron/README.md`

- [ ] **Step 1: Écrire le README**

Créer `designer/electron/README.md` :

```markdown
# Designer desktop (Electron) — PoC socle

Empaquette le designer web (`designer/`) dans une fenêtre desktop qui parle au device
sans souci de CORS. `designer/` et `schema/` ne sont pas modifiés : ils sont servis en
place via un protocole interne `app://`.

Design : `docs/superpowers/specs/2026-06-27-designer-desktop-electron-design.md`.

## Prérequis

    cd designer/electron && npm install   # installe Electron (local)

## Lancer

    cd designer/electron && npm start

Saisir l'URL du device dans la barre (champ « URL device »), puis Charger / Statut / Pousser.

## Dev sans matériel (mock device)

    cd designer/electron && PORT=8099 node mock-device.mjs   # terminal 1
    cd designer/electron && npm start                        # terminal 2
    # URL device → http://127.0.0.1:8099

## Tests

    cd designer && node --test    # inclut le test transport device.js ↔ mock

## Statut

PoC **socle** : fenêtre + transport device. Hors scope : découverte mDNS, ouverture/
sauvegarde de fichiers locaux, installeurs Win/macOS/Linux + signature, auto-update.
```

- [ ] **Step 2: Validation manuelle contre le vrai device**

Prérequis : l'écran Dialboard est flashé et joignable sur le réseau (relever son IP, p. ex. via le moniteur série ou la box).

Run: `(cd designer/electron && npm start)`
Dans la fenêtre :
1. Saisir l'URL device : `http://<ip-du-device>`.
2. **Statut** → pastille verte `● <ip>` avec page/uptime/composants en infobulle.
3. **Charger** → le layout réel du device s'affiche.
4. **Pousser** → « Poussé et persisté » ; vérifier que l'écran reflète le layout.

Expected : les 4 étapes aboutissent. Faire une capture de la fenêtre comme preuve.

> Si le device est indisponible au moment de l'implémentation, cette validation matériel est **reportée** et doit être signalée explicitement comme non faite (ne pas la cocher). Le reste du PoC (Tasks 1–2) reste livrable et vérifié.

- [ ] **Step 3: Commit**

```bash
git add designer/electron/README.md
git commit -F - <<'EOF'
docs(designer): mode d'emploi du designer desktop Electron

Lancement (dev mock + vrai device), tests, et statut PoC socle.

Claude-Session: https://claude.ai/code/session_01RJn5U2gefBafayaAov6tCN
EOF
```

---

## Notes d'exécution

- **cwd** : les commandes utilisent des sous-shells `( … )` pour éviter que `cd` ne « colle » entre étapes.
- **Convention de test** : `cd designer && node --test` sans argument (cf. CLAUDE.md) ; la suite complète tourne, le nouveau fichier apparaît dedans.
- **Port mock** : 8099, jamais 8000 (réservé à l'utilisateur).
- **Pas de push** : tous les commits restent locaux ; pousser uniquement sur demande explicite (CLAUDE.md).
