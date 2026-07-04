# Chantier 2a — OTA LAN (firmware + FS) piloté depuis le designer — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au designer un overlay qui flashe firmware et/ou image FS d'un device en ligne (routes OTA du chantier 1), en préservant automatiquement le dashboard utilisateur.

**Architecture:** Une route firmware `POST /reboot` (rend `/fs` autonome). Côté designer : un module **pur** (`ota-plan.js` : validation anti-brick + planification de séquence, testé node), des fonctions **transport** dans `device.js` (upload XHR avec progression + reboot + attente de reconnexion, réutilisant les fetch/upload d'assets existants), et un **overlay DOM** (`ota-dialog.js`) qui orchestre backup → flash → reboot → attente → restore. Parité EN/FR.

**Tech Stack:** C++/Arduino (`Update.h`, déjà en place), JS modules ESM (designer), `node --test` (Unity côté firmware non requis ici), XHR pour la progression d'upload.

**Spec de référence :** `docs/superpowers/specs/2026-07-04-ota-lan-designer-design.md`. Branche : `feat/ota-lan-designer` (déjà créée, spec commitée `edb2722`).

---

## Structure des fichiers

| Fichier | Rôle | Action |
|---------|------|--------|
| `src/api.cpp` | Route `POST /reboot` | Modifier (~+6 lignes) |
| `designer/js/ota-plan.js` | **Pur** : `validateBinary`, `planFlash`, `PART` | Créer |
| `designer/tests/ota-plan.test.js` | Tests node du module pur | Créer |
| `designer/js/device.js` | Transport : `postFirmware`, `postFs`, `rebootDevice`, `waitForDevice` | Modifier (+ fonctions) |
| `designer/js/ota-dialog.js` | Overlay + orchestration (DOM, browser-verified) | Créer |
| `designer/index.html` | Bouton topbar `#ota-open` + overlay `#ota-overlay` | Modifier |
| `designer/style.css` | Styles `.ota-*` | Modifier |
| `designer/i18n/en.js` + `i18n/fr.json` | Clés `ota.*` / `toolbar.ota.*` | Modifier (parité) |
| `designer/js/app.js` | Import + `mountOtaDialog(...)` | Modifier (2 lignes) |

**Conventions établies (vérifiées) :** module pur défensif façon `publish.js` (arg non conforme → pas de throw) ; overlay façon `publish-dialog.js` (`mount…(model, {openBtn, overlay})`, open/close via `.hidden`, clic fond ferme) ; `$ = id => document.getElementById(id)` ; URL device = `$('base').value` ; `showToast(msg,{kind,ms})` + `t(key,vars)` importés directement ; i18n = **clés plates namespacées** dans `en.js` (source) et `fr.json` (pack, **Latin-1 uniquement**) ; tests node = logique pure seulement (le DOM/transport est browser-verified, cf. mémoire `designer-tests-dom-builders`).

---

## Task 1 : Firmware — route `POST /reboot`

**Files:**
- Modify: `src/api.cpp` (près des routes `/firmware` et `/fs`, register vers la ligne ~550)

- [ ] **Step 1 : Ajouter le handler `h_reboot`**

Après `h_fs_done()` (vers la ligne 525 de `src/api.cpp`), ajouter, dans le même style que `h_firmware_done` :

```cpp
// --- Reboot logiciel : primitive pour l'UI OTA (remonter le LittleFS apres un /fs, qui ne reboote
// pas de lui-meme). Reponse envoyee AVANT le restart (marge 200 ms), comme /firmware. ---
static void h_reboot() {
    S->send(200, "text/plain", "ok, rebooting\n");
    delay(200); ESP.restart();
}
```

- [ ] **Step 2 : Enregistrer la route**

Après la ligne `server.on("/fs", HTTP_POST, h_fs_done, h_fs_upload);` (~550), ajouter :

```cpp
    server.on("/reboot", HTTP_POST, h_reboot);                              // reboot logiciel (UI OTA)
```

- [ ] **Step 3 : Compiler**

Run: `pio run -e esp32s3`
Expected: `SUCCESS` (la route est triviale ; pas de test unitaire — comportement HW).

- [ ] **Step 4 : Commit**

```bash
git add src/api.cpp
git commit -m "feat(fw): route POST /reboot (reboot logiciel pour l'UI OTA)"
```

---

## Task 2 : Module pur `ota-plan.js` — `validateBinary`

Garde-fou anti-brick : un firmware valide commence par le magic byte `0xE9` et tient dans un slot app (`0x400000`) ; une image FS ne commence **pas** par `0xE9` et tient dans la partition spiffs (`0x7E0000`). Rejette le mauvais couple champ↔fichier avant tout envoi.

**Files:**
- Create: `designer/js/ota-plan.js`
- Test: `designer/tests/ota-plan.test.js`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `designer/tests/ota-plan.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBinary, PART } from '../js/ota-plan.js';

const fw = (n) => { const b = new Uint8Array(n); b[0] = 0xE9; return b; };   // magic ESP
const fs = (n) => { const b = new Uint8Array(n); b[0] = 0x00; return b; };   // pas de magic

test('validateBinary firmware : magic 0xE9 + taille ok (intent : accepter un vrai firmware)', () => {
  assert.deepEqual(validateBinary(fw(1024), 'firmware'), { ok: true, reason: null });
});

test('validateBinary firmware : sans magic → rejet (intent : refuser un fichier qui n\'est pas une image app)', () => {
  assert.equal(validateBinary(fs(1024), 'firmware').reason, 'firmware_magic');
});

test('validateBinary firmware : plus gros que le slot app → rejet (intent : ne pas deborder 0x400000)', () => {
  assert.equal(validateBinary(fw(PART.app + 1), 'firmware').reason, 'firmware_too_big');
});

test('validateBinary fs : pas de magic + taille ok (intent : accepter une image LittleFS)', () => {
  assert.deepEqual(validateBinary(fs(1024), 'fs'), { ok: true, reason: null });
});

test('validateBinary fs : commence par 0xE9 → rejet (intent : detecter un firmware mis dans le champ FS = brick)', () => {
  assert.equal(validateBinary(fw(1024), 'fs').reason, 'fs_looks_like_firmware');
});

test('validateBinary fs : plus gros que spiffs → rejet (intent : ne pas deborder 0x7E0000)', () => {
  assert.equal(validateBinary(fs(PART.spiffs + 1), 'fs').reason, 'fs_too_big');
});

test('validateBinary : octets vides/absents → empty (intent : robustesse, pas de throw)', () => {
  assert.equal(validateBinary(new Uint8Array(0), 'firmware').reason, 'empty');
  assert.equal(validateBinary(null, 'fs').reason, 'empty');
});
```

- [ ] **Step 2 : Lancer le test → échec attendu**

Run: `cd designer && node --test tests/ota-plan.test.js`
Expected: FAIL (`Cannot find module '../js/ota-plan.js'`).

- [ ] **Step 3 : Implémentation minimale**

Créer `designer/js/ota-plan.js` :

```js
// Logique PURE de l'OTA (validation anti-brick + planification de sequence). Aucun DOM/reseau → testee node.
// Defensif (fonctions exportees, cf. convention projet) : entree non conforme → resultat, jamais throw.

// Tailles de partition (dialboard_16MB.csv) : slot app OTA et partition FS (spiffs).
export const PART = { app: 0x400000, spiffs: 0x7E0000 };

// bytes (Uint8Array) + kind ('firmware'|'fs') → { ok, reason }. reason ∈ null | 'empty' |
// 'firmware_magic' | 'firmware_too_big' | 'fs_looks_like_firmware' | 'fs_too_big' (l'UI mappe → ota.err.<reason>).
export function validateBinary(bytes, kind, part = PART) {
  if (!bytes || !bytes.length) return { ok: false, reason: 'empty' };
  const magic = bytes[0] === 0xE9;                        // 0xE9 = magic d'une image applicative ESP
  if (kind === 'firmware') {
    if (!magic) return { ok: false, reason: 'firmware_magic' };
    if (bytes.length > part.app) return { ok: false, reason: 'firmware_too_big' };
    return { ok: true, reason: null };
  }
  // kind === 'fs'
  if (magic) return { ok: false, reason: 'fs_looks_like_firmware' };   // un firmware dans le champ FS = brick
  if (bytes.length > part.spiffs) return { ok: false, reason: 'fs_too_big' };
  return { ok: true, reason: null };
}
```

- [ ] **Step 4 : Lancer le test → succès**

Run: `cd designer && node --test tests/ota-plan.test.js`
Expected: PASS (7 tests validateBinary).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/ota-plan.js designer/tests/ota-plan.test.js
git commit -m "feat(designer): ota-plan.validateBinary — garde-fou anti-brick (magic + tailles)"
```

---

## Task 3 : Module pur `ota-plan.js` — `planFlash`

Séquence ordonnée. Règles : FS **avant** firmware (le reboot auto du firmware remonte le nouveau FS → un seul reboot) ; FS **seul** → `reboot` explicite ; layout **toujours** restauré, assets **seulement si `!sdMounted`** ; firmware seul ne touche ni backup ni restore.

**Files:**
- Modify: `designer/js/ota-plan.js`
- Modify: `designer/tests/ota-plan.test.js`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `designer/tests/ota-plan.test.js` :

```js
import { planFlash } from '../js/ota-plan.js';
const ops = (p) => p.map(s => s.op);

test('planFlash firmware+fs : backup, fs, fw, wait, restore — un seul reboot (fw auto)', () => {
  assert.deepEqual(ops(planFlash({ hasFw: true, hasFs: true, sdMounted: true })),
    ['backup', 'flashFs', 'flashFw', 'wait', 'restore']);
});

test('planFlash fs seul : reboot explicite (fs ne reboote pas)', () => {
  assert.deepEqual(ops(planFlash({ hasFw: false, hasFs: true, sdMounted: false })),
    ['backup', 'flashFs', 'reboot', 'wait', 'restore']);
});

test('planFlash firmware seul : pas de backup/restore (le FS n\'est pas touche)', () => {
  assert.deepEqual(ops(planFlash({ hasFw: true, hasFs: false, sdMounted: true })),
    ['flashFw', 'wait']);
});

test('planFlash restore.assets : true ssi pas de SD (avec SD les assets survivent)', () => {
  const withSd = planFlash({ hasFw: false, hasFs: true, sdMounted: true }).find(s => s.op === 'restore');
  const noSd = planFlash({ hasFw: false, hasFs: true, sdMounted: false }).find(s => s.op === 'restore');
  assert.equal(withSd.assets, false);
  assert.equal(noSd.assets, true);
});

test('planFlash rien : sequence vide', () => {
  assert.deepEqual(planFlash({ hasFw: false, hasFs: false, sdMounted: true }), []);
});
```

- [ ] **Step 2 : Lancer le test → échec attendu**

Run: `cd designer && node --test tests/ota-plan.test.js`
Expected: FAIL (`planFlash is not a function`).

- [ ] **Step 3 : Implémentation minimale**

Ajouter à `designer/js/ota-plan.js` :

```js
// { hasFw, hasFs, sdMounted } → liste ordonnee d'etapes { op[, assets] }. op ∈ 'backup' | 'flashFs' |
// 'flashFw' | 'reboot' | 'wait' | 'restore'. FS avant firmware (reboot auto du fw remonte le FS) ;
// fs seul → reboot explicite ; restore.assets = !sdMounted (avec SD les assets survivent au /fs).
export function planFlash({ hasFw, hasFs, sdMounted } = {}) {
  const steps = [];
  if (hasFs) { steps.push({ op: 'backup' }); steps.push({ op: 'flashFs' }); }
  if (hasFw) steps.push({ op: 'flashFw' });          // reboot automatique
  else if (hasFs) steps.push({ op: 'reboot' });      // fs seul : reboot explicite pour remonter le FS
  if (hasFw || hasFs) steps.push({ op: 'wait' });
  if (hasFs) steps.push({ op: 'restore', assets: !sdMounted });
  return steps;
}
```

- [ ] **Step 4 : Lancer le test → succès**

Run: `cd designer && node --test tests/ota-plan.test.js`
Expected: PASS (12 tests au total dans le fichier).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/ota-plan.js designer/tests/ota-plan.test.js
git commit -m "feat(designer): ota-plan.planFlash — sequence backup/flash/reboot/restore adaptative SD"
```

---

## Task 4 : i18n — clés `ota.*` (EN + FR)

**Files:**
- Modify: `designer/i18n/en.js`
- Modify: `designer/i18n/fr.json`

- [ ] **Step 1 : Ajouter les clés à `en.js`**

Dans `designer/i18n/en.js` (objet `export default`), ajouter ce bloc (avant l'accolade fermante) :

```js
  'toolbar.ota.tip': 'Update (OTA)',
  'toolbar.ota.title': 'Flash firmware / filesystem over the network',
  'ota.title': 'Update the device',
  'ota.warn.sd': 'Your dashboard (layout) will be backed up and restored. Assets are on the SD card and are kept.',
  'ota.warn.nosd': 'No SD card: your dashboard AND its images will be backed up, then restored after reboot.',
  'ota.firmware': 'Firmware (.bin)',
  'ota.fs': 'Filesystem image (.bin)',
  'ota.backup': 'Download a .dboard backup',
  'ota.cancel': 'Close',
  'ota.submit': 'Update',
  'ota.err.empty': 'Empty file.',
  'ota.err.firmware_magic': 'Not a firmware image (missing 0xE9 magic).',
  'ota.err.firmware_too_big': 'Too large for the 4 MB app slot.',
  'ota.err.fs_looks_like_firmware': 'This looks like a firmware, not a filesystem image.',
  'ota.err.fs_too_big': 'Too large for the filesystem partition.',
  'ota.step.backup': 'Backing up the device…',
  'ota.step.flashFs': 'Flashing the filesystem…',
  'ota.step.flashFw': 'Flashing the firmware…',
  'ota.step.reboot': 'Rebooting…',
  'ota.step.wait': 'Waiting for the device to come back…',
  'ota.step.restore': 'Restoring your dashboard…',
  'ota.done': 'Device updated.',
  'ota.failed': 'Update failed: {msg}',
  'ota.reconnect_timeout': 'Device did not come back. If the firmware fails to boot, reflash over USB.',
  'ota.backup_incomplete': 'Backup incomplete and no SD card — aborted to avoid losing assets.',
```

- [ ] **Step 2 : Ajouter les mêmes clés à `fr.json`** (valeurs Latin-1 ; pas de `œ`)

Dans `designer/i18n/fr.json`, ajouter les mêmes clés avec les valeurs FR :

```json
  "toolbar.ota.tip": "Mettre à jour (OTA)",
  "toolbar.ota.title": "Flasher firmware / système de fichiers par le réseau",
  "ota.title": "Mettre à jour le device",
  "ota.warn.sd": "Votre dashboard (layout) sera sauvegardé puis restauré. Les images sont sur la carte SD et sont conservées.",
  "ota.warn.nosd": "Pas de carte SD : votre dashboard ET ses images seront sauvegardés, puis restaurés après le reboot.",
  "ota.firmware": "Firmware (.bin)",
  "ota.fs": "Image système de fichiers (.bin)",
  "ota.backup": "Télécharger une sauvegarde .dboard",
  "ota.cancel": "Fermer",
  "ota.submit": "Mettre à jour",
  "ota.err.empty": "Fichier vide.",
  "ota.err.firmware_magic": "Ce n'est pas une image firmware (magic 0xE9 absent).",
  "ota.err.firmware_too_big": "Trop gros pour le slot app de 4 Mo.",
  "ota.err.fs_looks_like_firmware": "Cela ressemble à un firmware, pas à une image système de fichiers.",
  "ota.err.fs_too_big": "Trop gros pour la partition système de fichiers.",
  "ota.step.backup": "Sauvegarde du device…",
  "ota.step.flashFs": "Flash du système de fichiers…",
  "ota.step.flashFw": "Flash du firmware…",
  "ota.step.reboot": "Reboot…",
  "ota.step.wait": "Attente du retour du device…",
  "ota.step.restore": "Restauration de votre dashboard…",
  "ota.done": "Device mis à jour.",
  "ota.failed": "Échec de la mise à jour : {msg}",
  "ota.reconnect_timeout": "Le device n'est pas revenu. Si le firmware ne démarre pas, reflasher par USB.",
  "ota.backup_incomplete": "Sauvegarde incomplète et pas de carte SD — interrompu pour ne pas perdre d'images."
```

- [ ] **Step 3 : Vérifier la parité EN=FR**

Run: `cd designer && node --test tests/i18n-parity.test.js`
Expected: PASS (même nombre de clés EN et FR ; échoue si une clé manque d'un côté).

- [ ] **Step 4 : Commit**

```bash
git add designer/i18n/en.js designer/i18n/fr.json
git commit -m "feat(designer): i18n ota.* (EN+FR)"
```

---

## Task 5 : Markup — bouton topbar + overlay + CSS

**Files:**
- Modify: `designer/index.html` (groupe device ~ligne 45, après `#capture` ; overlay après `#publish-overlay` ~ligne 173)
- Modify: `designer/style.css`

- [ ] **Step 1 : Bouton dans le groupe device**

Dans `designer/index.html`, juste après le bouton `#capture` (ligne 45), ajouter :

```html
      <button id="ota-open" class="tb-btn" data-i18n-tip="toolbar.ota.tip" data-i18n-title="toolbar.ota.title" data-tip="Mettre à jour (OTA)" title="Flasher firmware / FS par le réseau"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v7M5 6l3 3 3-3"/><path d="M3 11v2h10v-2"/></svg></button>
```

- [ ] **Step 2 : Overlay OTA**

Après le bloc `#publish-overlay` (fermeture `</div>` ~ligne 178), ajouter :

```html
  <div id="ota-overlay" class="shot-overlay" hidden>
    <div class="ota-box">
      <h2 data-i18n="ota.title">Mettre à jour le device</h2>
      <p id="ota-warn" class="ota-warn"></p>
      <label class="ota-field"><span data-i18n="ota.firmware">Firmware (.bin)</span><input id="ota-fw" type="file" accept=".bin" /></label>
      <div id="ota-fw-err" class="ota-err"></div>
      <label class="ota-field"><span data-i18n="ota.fs">Image système de fichiers (.bin)</span><input id="ota-fs" type="file" accept=".bin" /></label>
      <div id="ota-fs-err" class="ota-err"></div>
      <button id="ota-backup" class="ota-secondary" type="button" data-i18n="ota.backup">Télécharger une sauvegarde .dboard</button>
      <div id="ota-progress" class="ota-progress" hidden><div id="ota-bar"></div></div>
      <ul id="ota-log" class="ota-log"></ul>
      <div class="ota-actions">
        <button id="ota-cancel" type="button" data-i18n="ota.cancel">Fermer</button>
        <button id="ota-submit" type="button" data-i18n="ota.submit" disabled>Mettre à jour</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 3 : CSS**

Dans `designer/style.css`, ajouter (après les styles `.publish-*`) :

```css
/* Overlay OTA — réutilise .shot-overlay (fond + centrage). Boîte façon .publish-box. */
.ota-box { background: var(--panel, #1b2330); color: var(--text, #e6edf3); border-radius: 10px;
  padding: 20px; width: min(460px, 92vw); display: flex; flex-direction: column; gap: 10px; }
.ota-warn { margin: 0; font-size: 13px; color: var(--text-dim, #9fb0c3); }
.ota-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.ota-err { min-height: 0; color: #ef6a6a; font-size: 12px; }
.ota-err:empty { display: none; }
.ota-secondary { align-self: flex-start; background: none; border: 1px solid var(--border, #33415a);
  color: var(--text-dim, #9fb0c3); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
.ota-progress { height: 8px; background: var(--border, #33415a); border-radius: 4px; overflow: hidden; }
.ota-progress > #ota-bar { height: 100%; width: 0; background: var(--accent, #4c9ffe); transition: width .1s linear; }
.ota-log { list-style: none; margin: 0; padding: 0; font-size: 12px; max-height: 30vh; overflow: auto; }
.ota-log li { padding: 2px 0; color: var(--text-dim, #9fb0c3); }
.ota-log li.err { color: #ef6a6a; }
.ota-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
```

- [ ] **Step 4 : Commit** (le rendu sera vérifié en Task 8)

```bash
git add designer/index.html designer/style.css
git commit -m "feat(designer): markup + CSS de l'overlay OTA"
```

---

## Task 6 : Transport `device.js` — upload OTA + reboot + attente

Pas de test node (le transport réseau n'est pas testé dans ce projet ; seules les fonctions pures `formatDevice*` le sont — cf. `tests/device.test.js`). Vérifié en Task 8/9.

**Files:**
- Modify: `designer/js/device.js` (ajouter en fin de fichier, avant `formatDeviceStatus`)

- [ ] **Step 1 : Ajouter les fonctions transport**

Dans `designer/js/device.js`, ajouter (juste après `fetchAimg`, avant `formatDeviceStatus`) :

```js
// --- OTA (chantier 2a). Upload en XHR (et non fetch) pour exposer la progression via upload.onprogress.
// Le champ multipart 'img' est aligne sur /image ; le handler firmware lit S->upload() sans filtrer le nom.
function xhrUpload(base, path, bytes, filename, onProgress) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const fd = new FormData();
    fd.append('img', new Blob([bytes], { type: 'application/octet-stream' }), filename);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', clean(base) + path);
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      logs.logNet({ method: 'POST', path, status: xhr.status, ms: Math.round(performance.now() - t0), ok: xhr.status >= 200 && xhr.status < 300 });
      (xhr.status >= 200 && xhr.status < 300) ? resolve(xhr.responseText) : reject(new Error('HTTP ' + xhr.status));
    };
    xhr.onerror = () => {   // connexion coupee (p. ex. reboot du firmware) → l'appelant tranche via waitForDevice
      logs.logNet({ method: 'POST', path, status: 0, ms: Math.round(performance.now() - t0), ok: false });
      reject(new TypeError('network'));
    };
    xhr.send(fd);
  });
}
// POST /firmware (U_FLASH) : ecrit le slot app inactif ; le device reboote au succes (peut couper la connexion).
export function postFirmware(base, bytes, onProgress) { return xhrUpload(base, '/firmware', bytes, 'firmware.bin', onProgress); }
// POST /fs (U_SPIFFS) : ecrase le LittleFS ; PAS de reboot (l'appelant enchaine rebootDevice).
export function postFs(base, bytes, onProgress) { return xhrUpload(base, '/fs', bytes, 'littlefs.bin', onProgress); }

// POST /reboot : reboot logiciel du device.
export async function rebootDevice(base) {
  const r = await devFetch(base, '/reboot', { method: 'POST' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text().catch(() => '');
}

// Poll GET /status jusqu'a ce que le device reponde (source de verite apres un reboot). true si revenu, false si timeout.
export async function waitForDevice(base, timeoutMs = 45000, stepMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await getStatus(base); return true; } catch (e) { /* pas encore revenu */ }
    await new Promise(r => setTimeout(r, stepMs));
  }
  return false;
}
```

- [ ] **Step 2 : Vérifier que le module se charge (pas de test node ; smoke import)**

Run: `cd designer && node -e "import('./js/device.js').then(m => console.log(['postFirmware','postFs','rebootDevice','waitForDevice'].map(k => typeof m[k]).join(',')))"`
Expected: `function,function,function,function`

- [ ] **Step 3 : Lancer la suite complète (non-régression)**

Run: `cd designer && node --test`
Expected: PASS (toute la suite, dont `ota-plan` et `i18n-parity`).

- [ ] **Step 4 : Commit**

```bash
git add designer/js/device.js
git commit -m "feat(designer): transport OTA — postFirmware/postFs (XHR), rebootDevice, waitForDevice"
```

---

## Task 7 : `ota-dialog.js` — overlay + orchestration + câblage `app.js`

DOM + orchestration, browser-verified (Task 8). Réutilise `ota-plan.js`, le transport (Task 6) et les fetch/upload d'assets existants.

**Files:**
- Create: `designer/js/ota-dialog.js`
- Modify: `designer/js/app.js` (import + montage)

- [ ] **Step 1 : Créer `designer/js/ota-dialog.js`**

```js
// Overlay OTA : selection firmware/FS → validation anti-brick → backup → flash → reboot → attente → restore.
// Modele sur publish-dialog.js (mount(model,{...}), open/close via .hidden). DOM + orchestration : browser-verified.
import { validateBinary, planFlash } from './ota-plan.js';
import { encodeBundle } from './bundle.js';
import { referencedKeys } from './bg-image.js';
import { referencedImageKeys } from './image-asset.js';
import { referencedAimgKeys } from './image-anim-asset.js';
import {
  getStatus, loadLayout, pushLayout,
  postFirmware, postFs, rebootDevice, waitForDevice,
  fetchBgImage, fetchImage, fetchAimg, uploadBgImage, uploadImage, uploadAimg,
} from './device.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

export function mountOtaDialog(model, options) {
  const { openBtn, overlay, getBase, onBusy } = options || {};   // onBusy(bool) optionnel : partage le verrou « une seule I/O device » d'app.js
  if (!model || !openBtn || !overlay || typeof getBase !== 'function') return;
  const $ = id => overlay.querySelector('#' + id);
  const warn = $('ota-warn'), submit = $('ota-submit'), progress = $('ota-progress'), bar = $('ota-bar'), log = $('ota-log');
  const fw = { input: $('ota-fw'), err: $('ota-fw-err'), bytes: null };
  const fs = { input: $('ota-fs'), err: $('ota-fs-err'), bytes: null };
  let sdMounted = false, busy = false;

  const setBar = (frac) => { progress.hidden = false; bar.style.width = Math.round(frac * 100) + '%'; };
  const clearLog = () => { log.textContent = ''; progress.hidden = true; bar.style.width = '0'; };
  const logStep = (op) => { const li = document.createElement('li'); li.textContent = t('ota.step.' + op); log.appendChild(li); };
  const logErr = (msg) => { const li = document.createElement('li'); li.className = 'err'; li.textContent = msg; log.appendChild(li); };

  const refresh = () => {                                   // arme le bouton : au moins un fichier valide, aucun invalide
    const anyErr = fw.err.textContent || fs.err.textContent;
    submit.disabled = busy || !!anyErr || (!fw.bytes && !fs.bytes);
  };

  // Lit un <input file> → octets + validation → message d'erreur i18n (ou vide). kind ∈ 'firmware'|'fs'.
  async function onPick(slot, kind) {
    slot.bytes = null; slot.err.textContent = '';
    const file = slot.input.files[0];
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const v = validateBinary(bytes, kind);
      if (v.ok) slot.bytes = bytes;
      else slot.err.textContent = t('ota.err.' + v.reason);
    }
    refresh();
  }
  fw.input.addEventListener('change', () => onPick(fw, 'firmware'));
  fs.input.addEventListener('change', () => onPick(fs, 'fs'));

  // Backup device (layout toujours ; assets ssi includeAssets). Un GET reseau qui echoue propage (l'orchestration stoppe).
  async function backupDevice(base, includeAssets) {
    const layout = await loadLayout(base);
    const layoutText = JSON.stringify(layout);
    const assets = { bg: {}, image: {}, aimg: {} };
    if (includeAssets) {
      for (const k of referencedKeys(layout))      { const b = await fetchBgImage(base, k); if (b) assets.bg[k] = b; }
      for (const k of referencedImageKeys(layout)) { const b = await fetchImage(base, k);   if (b) assets.image[k] = b; }
      for (const k of referencedAimgKeys(layout))  { const b = await fetchAimg(base, k);    if (b) assets.aimg[k] = b; }
    }
    return { layoutText, assets };
  }
  async function restoreDevice(base, backup, includeAssets) {
    await pushLayout(base, backup.layoutText);
    if (includeAssets) {
      for (const [k, b] of Object.entries(backup.assets.bg))    await uploadBgImage(base, k, b);
      for (const [k, b] of Object.entries(backup.assets.image)) await uploadImage(base, k, b);
      for (const [k, b] of Object.entries(backup.assets.aimg))  await uploadAimg(base, k, b);
    }
  }
  // /firmware reboote au succes : une coupure reseau (TypeError) est un succes probable, tranche par waitForDevice.
  async function flashFirmware(base, bytes) {
    try { await postFirmware(base, bytes, setBar); }
    catch (e) { if (!(e instanceof TypeError)) throw e; }
  }

  async function run() {
    const base = getBase();
    if (!base) return void showToast(t('toast.device_url_q'));
    if (submit.disabled) return;
    busy = true; refresh(); clearLog();
    if (onBusy) onBusy(true);                                // grise les boutons device d'app.js pendant le flash
    try {
      const status = await getStatus(base);
      sdMounted = !!(status && status.sd && status.sd.mounted);
      const steps = planFlash({ hasFw: !!fw.bytes, hasFs: !!fs.bytes, sdMounted });
      let backup = null;
      for (const step of steps) {
        logStep(step.op); progress.hidden = true; bar.style.width = '0';
        if (step.op === 'backup')       backup = await backupDevice(base, !sdMounted);
        else if (step.op === 'flashFs') await postFs(base, fs.bytes, setBar);
        else if (step.op === 'flashFw') await flashFirmware(base, fw.bytes);
        else if (step.op === 'reboot')  await rebootDevice(base);
        else if (step.op === 'wait')    { if (!await waitForDevice(base)) throw new Error(t('ota.reconnect_timeout')); }
        else if (step.op === 'restore') await restoreDevice(base, backup, step.assets);
      }
      showToast(t('ota.done'), { kind: 'ok', ms: 5000 });
      close();
    } catch (e) {
      logErr(e.message);
      showToast(t('ota.failed', { msg: e.message }), { kind: 'warn', ms: 6000 });
    } finally { busy = false; refresh(); if (onBusy) onBusy(false); }
  }

  // Bouton « sauvegarde .dboard » : bundle COMPLET (layout + tous les assets references), filet universel.
  $('ota-backup').addEventListener('click', async () => {
    const base = getBase();
    if (!base) return void showToast(t('toast.device_url_q'));
    try {
      const b = await backupDevice(base, true);
      const text = encodeBundle(b.layoutText, b.assets);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'device-backup.dboard'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (e) { showToast(t('ota.failed', { msg: e.message }), { kind: 'warn', ms: 6000 }); }
  });

  const open = async () => {
    overlay.hidden = false; clearLog();
    fw.input.value = ''; fs.input.value = ''; fw.bytes = fs.bytes = null;
    fw.err.textContent = ''; fs.err.textContent = ''; refresh();
    const base = getBase();
    try { const s = await getStatus(base); sdMounted = !!(s && s.sd && s.sd.mounted); }
    catch (e) { sdMounted = false; }
    warn.textContent = t(sdMounted ? 'ota.warn.sd' : 'ota.warn.nosd');
  };
  const close = () => { overlay.hidden = true; };
  openBtn.addEventListener('click', open);
  $('ota-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay && !busy) close(); });
  submit.addEventListener('click', run);
}
```

- [ ] **Step 2 : Câbler dans `app.js`**

**2a.** Après l'import de `mountPublishDialog` (ligne 8), ajouter :

```js
import { mountOtaDialog } from './ota-dialog.js';
```

Ne rien changer à l'import `./device.js` de la ligne 9 : le transport OTA (`postFirmware`…) est consommé par `ota-dialog.js`, pas par `app.js`.

**2b.** Ajouter `'ota-open'` au tableau `deviceBtns` (ligne 422) pour que le bouton soit grisé pendant toute I/O device (invariant « une seule I/O device en vol ») :

```js
  const deviceBtns = ['load', 'push', 'values', 'statusbtn', 'capture', 'shot-prev', 'shot-next', 'ota-open'].map($);
```

**2c.** Après `mountPublishDialog(model, { openBtn: $('publish-open'), overlay: $('publish-overlay') });` (ligne 304), monter l'overlay OTA. `onBusy` passe le verrou `setDeviceBusy` (défini plus bas ligne ~424 ; la closure n'est appelée qu'au clic, après son initialisation → pas de TDZ) pour griser les autres boutons device pendant le flash :

```js
  mountOtaDialog(model, {
    openBtn: $('ota-open'), overlay: $('ota-overlay'),
    getBase: () => $('base').value, onBusy: (b) => setDeviceBusy(b),
  });
```

- [ ] **Step 3 : Non-régression suite complète + smoke import**

Run: `cd designer && node --test`
Expected: PASS (aucune régression ; `ota-dialog.js` n'est pas importé par node — DOM).

Run: `cd designer && node -e "import('./js/ota-plan.js').then(()=>console.log('ok'))"`
Expected: `ok`

- [ ] **Step 4 : Commit**

```bash
git add designer/js/ota-dialog.js designer/js/app.js
git commit -m "feat(designer): overlay OTA — orchestration backup/flash/reboot/restore + cablage"
```

---

## Task 8 : Vérification navigateur (mock device)

Suivre la mémoire `designer-verif-navigateur` : servir depuis la **racine du repo** en **no-store**, ouvrir `/designer/`, piloter avec de vrais events. Mocker le device (`/status` avec `sd.mounted`, `/fs`, `/firmware`, `/reboot`, `/layout`, `/image`…).

**Files:**
- Create (scratchpad, non commité) : petit serveur mock façon `scratchpad/mockserve.py` (cf. mémoire).

- [ ] **Step 1 : Servir + mock**

Lancer un serveur no-store à la racine du repo (port ≠ 8000) qui sert les fichiers ET répond aux routes device mockées. Renseigner l'URL du mock dans le champ `#base` du designer.

- [ ] **Step 2 : Vérifier (à cocher un par un)**

- [ ] Ouverture de l'overlay via `#ota-open` ; l'avertissement affiche la variante **SD** ou **sans SD** selon `sd.mounted` du mock.
- [ ] Sélectionner un `.bin` firmware **sans** magic 0xE9 → message `ota.err.firmware_magic`, bouton désarmé.
- [ ] Sélectionner un firmware trop gros (> 4 Mo) → `ota.err.firmware_too_big`.
- [ ] Sélectionner un firmware valide (1er octet 0xE9, petit) → pas d'erreur, bouton **armé**.
- [ ] Champ FS : un fichier commençant par 0xE9 → `ota.err.fs_looks_like_firmware`.
- [ ] Firmware + FS valides, mock `sd.mounted:true` → séquence journalisée `backup → flashFs → flashFw → wait → restore` ; barre de progression bouge ; `restore` **ne** re-pousse **pas** d'images (SD) ; toast `ota.done`.
- [ ] FS seul, mock `sd.mounted:false` → séquence `backup → flashFs → reboot → wait → restore` ; `restore` re-pousse les images (POST /image observés côté mock).
- [ ] `#ota-backup` télécharge un `.dboard` (intercepter le Blob comme dans la QA #31).
- [ ] Erreur `wait` (mock qui ne revient jamais) → message `ota.reconnect_timeout` en rouge dans le journal.
- [ ] Reprendre en **FR** : mêmes clés traduites, 0 erreur console.

- [ ] **Step 3 : Consigner** le résultat dans `docs/_internal/` (rapport QA), non commité (dossier gitignoré).

---

## Task 9 : Vérification on-device (vrai flash)

⚠ Viser l'**IP** `192.168.1.35` (pas `dialboard.local`, muet en HTTP). Sauvegarder l'état device avant (mémoire `uploadfs-efface-assets-device` / `verif-on-device-screenshots`).

- [ ] **Step 1 : Pré-requis** — flasher le firmware de cette branche (route `/reboot`) et le designer à jour :

```bash
pio run -e esp32s3 -t upload
bash tools/stage_fs.sh && pio run -e esp32s3 -t uploadfs
```

(⚠ `uploadfs` écrase le LittleFS ; sur ce device les assets sont sur SD → conservés. Re-pousser le layout perso ensuite si besoin.)

- [ ] **Step 2 : Produire les binaires à flasher** (dans le designer, via l'overlay) :
  - `firmware.bin` = `.pio/build/esp32s3/firmware.bin`
  - image FS = `.pio/build/esp32s3/littlefs.bin` (générée par `pio run -e esp32s3 -t uploadfs`, présente dans `.pio/build/esp32s3/`)

- [ ] **Step 3 : Test FS seul** — sélectionner l'image FS, lancer. Vérifier : backup, flash, reboot (uptime repart de ~0 via `/status`), dashboard restauré, designer embarqué à jour.
- [ ] **Step 4 : Test firmware seul** — sélectionner `firmware.bin`, lancer. Vérifier : flash, reboot auto, reconnexion, uptime remis à zéro.
- [ ] **Step 5 : Test combiné** — firmware + FS. Vérifier un seul reboot et dashboard préservé.
- [ ] **Step 6 : Capturer l'écran** (`GET /screenshot`) pour preuve visuelle ; consigner dans `docs/_internal/`.

---

## Task 10 : Clôture

- [ ] **Step 1 : Suite complète + build**

Run: `cd designer && node --test` → Expected: PASS (toute la suite).
Run: `pio run -e esp32s3` → Expected: SUCCESS.

- [ ] **Step 2 : Mettre à jour le HANDOFF** (`docs/_internal/HANDOFF.md`) : état chantier 2a livré + vérifié, prochain = chantier 2b (Web Serial).

- [ ] **Step 3 : Pousser + ouvrir la PR** — **uniquement sur demande explicite de l'utilisateur** (cf. CLAUDE.md projet). Ne pas pousser spontanément.

---

## Auto-revue du plan (fait)

- **Couverture spec** : `/reboot` (T1) ; validation anti-brick (T2) ; séquence adaptative SD (T3) ; i18n (T4) ; overlay + point d'entrée topbar device (T5) ; transport XHR + progression + reconnexion (T6) ; backup/restore auto adaptatif + `.dboard` de secours (T7) ; erreurs/cas limites — mauvais fichier (T2), firmware sans retour (T6/T7 `flashFirmware`), timeout reconnexion (T7 `wait`), backup incomplet (T7 propage → stop) ; tests node + browser + on-device (T8/T9). ✅
- **Placeholders** : aucun (code complet à chaque étape). ✅
- **Cohérence des noms** : `validateBinary`/`planFlash`/`PART` (T2/T3) = signatures utilisées en T7 ; `postFirmware`/`postFs`/`rebootDevice`/`waitForDevice` (T6) = appels de T7 ; `referenced*Keys` = signatures réelles vérifiées ; clés i18n `ota.*` (T4) = clés lues en T5/T7. ✅
