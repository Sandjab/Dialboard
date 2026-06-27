# Découverte mDNS desktop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Au lancement de l'app desktop, découvrir le device sur le réseau (browse mDNS) et remplir l'URL automatiquement, `designer/` restant zéro-touch.

**Architecture:** Le main process Electron browse `_http._tcp` (via `bonjour-service`, pur JS), filtre les « dialboard » et renvoie leurs IP. Un nouveau `preload.js` pose l'URL dans `#base` et dispatche un `change` — ce qui déclenche le `probeConnection` déjà présent dans `app.js` (→ pastille). La logique de parsing/filtrage est isolée dans `discovery.mjs` (pure, testée en node).

**Tech Stack:** Electron 42 (main CommonJS, `ipcMain`/preload), `bonjour-service` (mDNS, pur JS), `node:test`.

**Spec :** `docs/superpowers/specs/2026-06-27-designer-desktop-mdns-design.md`
**Branche :** `feat/designer-desktop-electron` (suite du socle ; le correctif `probeConnection` au `change` y est déjà).

---

## File Structure

| Fichier | Rôle |
|---|---|
| `designer/electron/discovery.mjs` (créer) | Logique PURE : `toDeviceUrl`, `isDialboardService`, `parseService`. Aucune I/O. |
| `designer/tests/mdns-discovery.test.js` (créer) | Tests node de `discovery.mjs`. |
| `designer/electron/main.js` (modif) | + `ipcMain.handle('discover-devices')` : browse bonjour → applique discovery → liste. |
| `designer/electron/preload.js` (créer) | DOMContentLoaded → invoke → remplit `#base` (+`change`) / sélecteur / bouton ⟳. |
| `designer/electron/mock-device.mjs` (modif) | Écoute `HOST` (env, défaut `127.0.0.1`) → permet le test E2E sans matériel. |
| `designer/electron/mock-announce.mjs` (créer) | Faux annonceur mDNS « dialboard » (dev, sans matériel). |
| `designer/electron/package.json` (modif) | + dépendance `bonjour-service`. |
| `designer/js/` | ZÉRO-TOUCH (le preload s'appuie sur `probeConnection` au `change`, déjà en place). |

---

## Task 1 : `discovery.mjs` (logique pure) + tests

**Files:**
- Test: `designer/tests/mdns-discovery.test.js` (créer)
- Create: `designer/electron/discovery.mjs`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `designer/tests/mdns-discovery.test.js` :

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDeviceUrl, isDialboardService, parseService } from '../electron/discovery.mjs';

test('toDeviceUrl : omet :80, conserve les autres ports (intent : URL device propre)', () => {
  assert.equal(toDeviceUrl('192.168.1.5', 80), 'http://192.168.1.5');
  assert.equal(toDeviceUrl('192.168.1.5', 8099), 'http://192.168.1.5:8099');
});

test('isDialboardService : matche un device dialboard, rejette le bruit _http._tcp (intent : ne pas pointer une imprimante)', () => {
  assert.equal(isDialboardService({ name: 'dialboard', host: 'dialboard.local' }), true);
  assert.equal(isDialboardService({ name: 'dialboard-2', host: 'dialboard-2.local' }), true);
  assert.equal(isDialboardService({ name: 'HP LaserJet', host: 'printer.local' }), false);
});

test('parseService : extrait la 1re IPv4 + url ; null si aucune IPv4 (intent : on a besoin d’une IP joignable)', () => {
  assert.deepEqual(
    parseService({ name: 'dialboard', port: 80, addresses: ['fe80::1', '192.168.1.5'] }),
    { name: 'dialboard', ip: '192.168.1.5', port: 80, url: 'http://192.168.1.5' }
  );
  assert.equal(parseService({ name: 'dialboard', port: 80, addresses: ['fe80::1'] }), null);
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `(cd designer && node --test)`
Expected: ÉCHEC — `mdns-discovery.test.js` ne peut pas importer `../electron/discovery.mjs` (`ERR_MODULE_NOT_FOUND`). Les autres tests restent verts.

- [ ] **Step 3: Implémenter `discovery.mjs`**

Créer `designer/electron/discovery.mjs` :

```javascript
// Logique pure de découverte mDNS (aucune I/O réseau) → testable en node.
const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

// URL device depuis IP + port : http://<ip> (port 80 omis), sinon http://<ip>:<port>.
export function toDeviceUrl(ip, port) {
  return `http://${ip}` + (port && port !== 80 ? `:${port}` : '');
}

// Vrai si l'enregistrement ressemble à un device Dialboard (nom/host commençant par « dialboard »).
export function isDialboardService(svc) {
  const name = (svc?.name ?? '').toLowerCase();
  const host = (svc?.host ?? '').toLowerCase();
  return name.startsWith('dialboard') || host.startsWith('dialboard');
}

// Enregistrement bonjour → { name, ip, port, url } ; null si pas d'adresse IPv4.
export function parseService(svc) {
  const ip = (svc?.addresses ?? []).find((a) => IPV4.test(a));
  if (!ip) return null;
  return { name: svc.name ?? '', ip, port: svc.port, url: toDeviceUrl(ip, svc.port) };
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `(cd designer && node --test)`
Expected: SUCCÈS — les 3 tests `discovery` passent, suite designer verte.

- [ ] **Step 5: Commit**

```bash
git add designer/electron/discovery.mjs designer/tests/mdns-discovery.test.js
git commit -F - <<'EOF'
feat(designer): logique pure de découverte mDNS (discovery.mjs) + tests

toDeviceUrl (omet :80), isDialboardService (filtre « dialboard »),
parseService (1re IPv4 → {name,ip,port,url}). Sans I/O → testée en node.

Claude-Session: https://claude.ai/code/session_01RJn5U2gefBafayaAov6tCN
EOF
```

---

## Task 2 : Câblage desktop (browse + preload + auto-remplissage)

Pas de test automatique : `main.js`/`preload.js` exigent le runtime Electron (validation manuelle). La régression `node --test` doit rester verte (la modif `HOST` du mock garde le défaut `127.0.0.1`).

**Files:**
- Modify: `designer/electron/package.json` (dépendance) + `designer/electron/main.js`
- Create: `designer/electron/preload.js`, `designer/electron/mock-announce.mjs`
- Modify: `designer/electron/mock-device.mjs`

- [ ] **Step 1: Installer `bonjour-service`**

Run: `(cd designer/electron && npm install --save-dev bonjour-service)`
Expected: `package.json` gagne `devDependencies.bonjour-service`, lockfile mis à jour.

- [ ] **Step 2: Ajouter le handler IPC dans `main.js`**

Dans `designer/electron/main.js`, modifier la ligne d'import d'electron pour ajouter `ipcMain` :

```javascript
const { app, BrowserWindow, protocol, session, net, ipcMain } = require('electron');
```

Puis, à l'intérieur du callback `app.whenReady().then(() => { … })`, AVANT la création de la `BrowserWindow`, ajouter l'enregistrement du handler :

```javascript
  // Découverte mDNS : browse _http._tcp pendant ~2,5 s, filtre « dialboard », renvoie [{name,ip,port,url}].
  ipcMain.handle('discover-devices', async () => {
    try {
      const { Bonjour } = await import('bonjour-service');
      const { parseService, isDialboardService } = await import('./discovery.mjs');
      const bonjour = new Bonjour();
      const browser = bonjour.find({ type: 'http' });
      await new Promise((r) => setTimeout(r, 2500));
      const found = browser.services.filter(isDialboardService).map(parseService).filter(Boolean);
      browser.stop();
      bonjour.destroy();
      const byIp = new Map();
      for (const d of found) if (!byIp.has(d.ip)) byIp.set(d.ip, d);
      return [...byIp.values()];
    } catch (e) {
      return [];   // best-effort : jamais bloquant
    }
  });
```

- [ ] **Step 3: Brancher le preload sur la `BrowserWindow`**

Dans `designer/electron/main.js`, remplacer la création de la fenêtre :

```javascript
  const win = new BrowserWindow({ width: 1100, height: 800, webPreferences: { contextIsolation: true } });
```

par :

```javascript
  const win = new BrowserWindow({
    width: 1100, height: 800,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
```

- [ ] **Step 4: Créer `preload.js`**

Créer `designer/electron/preload.js` :

```javascript
// Preload desktop : découverte mDNS auto. Capacité desktop-only → vit ici, pas dans designer/.
// Contrat designer (zéro-touch) : poser #base.value puis dispatcher « change » déclenche le check
// de connexion (probeConnection) et la pastille. Aucune modif de designer/ requise.
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  const base = document.getElementById('base');
  if (!base) return;

  const setUrl = (url) => { base.value = url; base.dispatchEvent(new Event('change')); };

  // UI injectée à côté du champ URL : sélecteur (si plusieurs) + bouton re-scan.
  const box = document.createElement('span');
  box.style.marginLeft = '6px';
  const picker = document.createElement('select');
  picker.style.display = 'none';
  picker.title = 'Devices détectés (mDNS)';
  picker.addEventListener('change', () => { if (picker.value) setUrl(picker.value); });
  const rescan = document.createElement('button');
  rescan.type = 'button';
  rescan.textContent = '⟳';
  rescan.title = 'Re-scanner le réseau (mDNS)';
  rescan.addEventListener('click', () => scan());
  box.appendChild(picker);
  box.appendChild(rescan);
  base.insertAdjacentElement('afterend', box);

  function renderPicker(list) {
    picker.replaceChildren();
    if (list.length < 2) { picker.style.display = 'none'; return; }
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = `${list.length} devices…`;
    picker.appendChild(ph);
    for (const d of list) {
      const o = document.createElement('option');
      o.value = d.url; o.textContent = `${d.name || 'dialboard'} — ${d.url}`;
      picker.appendChild(o);
    }
    picker.style.display = '';
  }

  async function scan() {
    rescan.disabled = true;
    let list = [];
    try { list = await ipcRenderer.invoke('discover-devices'); } catch (e) { list = []; }
    rescan.disabled = false;
    renderPicker(list);
    if (list.length === 1) setUrl(list[0].url);   // 1 device → remplissage direct
  }

  scan();
});
```

- [ ] **Step 5: Rendre l'hôte d'écoute du mock configurable**

Dans `designer/electron/mock-device.mjs`, remplacer la ligne d'écoute :

```javascript
    server.listen(port, '127.0.0.1', () => {
```

par :

```javascript
    server.listen(port, process.env.HOST || '127.0.0.1', () => {   // HOST=0.0.0.0 pour le test mDNS E2E
```

- [ ] **Step 6: Créer le faux annonceur `mock-announce.mjs`**

Créer `designer/electron/mock-announce.mjs` :

```javascript
// Faux annonceur mDNS pour tester la découverte SANS matériel : publie un service « dialboard »
// _http._tcp sur PORT (défaut 8099). À lancer en parallèle du mock device (HOST=0.0.0.0).
import { Bonjour } from 'bonjour-service';

const port = Number(process.env.PORT) || 8099;
const bonjour = new Bonjour();
const svc = bonjour.publish({ name: 'dialboard', type: 'http', port });
svc.on('up', () => console.log(`annonce mDNS « dialboard » _http._tcp port ${port}`));
process.on('SIGINT', () => svc.stop(() => { bonjour.destroy(); process.exit(0); }));
```

- [ ] **Step 7: Vérifs statiques + non-régression**

Run: `node --check designer/electron/main.js && node --check designer/electron/preload.js && echo OK`
Expected: `OK` (exit 0).

Run: `(cd designer && node --test)`
Expected: 386 + 3 (discovery) tests verts, 0 échec — la modif `HOST` n'a pas cassé le test transport (défaut `127.0.0.1` préservé).

- [ ] **Step 8: Validation manuelle (runtime Electron)**

*Sans matériel (faux annonceur)* — 3 terminaux depuis `designer/electron/` :
```bash
HOST=0.0.0.0 PORT=8099 node mock-device.mjs   # 1 : faux device sur toutes interfaces
node mock-announce.mjs                          # 2 : annonce mDNS « dialboard »
npm start                                       # 3 : l'app
```
Attendu : au lancement, le champ « URL device » se remplit tout seul avec `http://<ip-LAN>:8099` et la pastille passe **verte**. Le bouton **⟳** relance le scan. (Si plusieurs annonceurs : un sélecteur apparaît.)

*Avec le vrai device* : `npm start` seul → le champ se remplit avec l'IP du device, pastille verte.

> Si le device est indisponible ET le faux annonceur ne remonte pas (réseau mDNS bloqué), signaler la validation manuelle comme **non faite** plutôt que de la cocher. La logique `discovery.mjs` reste, elle, auto-vérifiée (Task 1).

- [ ] **Step 9: Commit**

```bash
git add designer/electron/main.js designer/electron/preload.js designer/electron/mock-device.mjs designer/electron/mock-announce.mjs designer/electron/package.json designer/electron/package-lock.json
git commit -F - <<'EOF'
feat(designer): découverte mDNS auto au lancement (browse + preload)

Main process browse _http._tcp (bonjour-service), filtre « dialboard », renvoie
les IP via IPC. preload.js auto-remplit #base (+ dispatch change → probeConnection),
sélecteur si plusieurs, bouton ⟳. mock-device écoute HOST (défaut 127.0.0.1) et
mock-announce simule un device pour le test sans matériel. designer/ zéro-touch.

Claude-Session: https://claude.ai/code/session_01RJn5U2gefBafayaAov6tCN
EOF
```

---

## Notes d'exécution

- **cwd** : commandes en sous-shells `( … )` pour éviter la dérive de `cd`.
- **Port** : 8099 pour le mock, jamais 8000 (réservé).
- **ESM/CJS** : `discovery.mjs` et `mock-announce.mjs` sont ESM ; `main.js` (CJS) charge `discovery.mjs` et `bonjour-service` via `await import(...)` dans le handler async.
- **Couverture honnête** : seul `discovery.mjs` est auto-testé ; `main.js`/`preload.js` sont validés manuellement (runtime Electron).
- **Pas de push** sans demande explicite.
