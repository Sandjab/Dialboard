# Flash USB (Web Serial) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flasher un device K718 vierge/briqué par USB depuis le designer public (GitHub Pages), sans outil installé — via esptool-js + Web Serial, en flashant les 5 partitions.

**Architecture:** Un overlay designer dédié « Nouveau device » pilote esptool-js (vendorisé) sur `navigator.serial`. Les 5 images firmware sont hébergées **same-origine** sous `_site/firmware/` (build CI sur tag → Release → téléchargées au déploiement Pages) et décrites par un `manifest.json`. Logique pure (`usb-plan.js`) testée node ; transport série (`serial.js`) et overlay (`usb-dialog.js`) browser-verified. Réutilise `validateBinary`, `setBar`/`logStep`, i18n et le pattern `mount…(model,{…})` de l'OTA LAN (2a).

**Tech Stack:** JS modules ES (designer), esptool-js (Apache-2.0), Web Serial API (Chromium), Node test runner, PlatformIO, GitHub Actions (Pages + Release).

**Spec:** `docs/superpowers/specs/2026-07-04-web-serial-flash-design.md`

---

## Structure des fichiers

**Créés :**
- `designer/vendor/esptool-bundle.js` — esptool-js vendorisé (bundle ESM, en-tête Apache-2.0).
- `designer/js/usb-plan.js` — module PUR : offsets, `validateManifest`, `planParts`.
- `designer/js/serial.js` — transport esptool-js : `flashDevice(port, fileArray, opts)`.
- `designer/js/usb-dialog.js` — overlay : `mountUsbDialog(model, options)`.
- `designer/tests/usb-plan.test.js` — tests node du module pur.
- `.github/workflows/firmware-release.yml` — build firmware sur tag → Release.

**Modifiés :**
- `designer/index.html` — bouton topbar `#usb-open` + overlay `#usb-overlay`.
- `designer/style.css` — réemploi `.ota-*` / classes `.usb-*` au besoin.
- `designer/js/app.js` — montage `mountUsbDialog` + dégradation hors Chromium.
- `designer/i18n/en.js` + `designer/i18n/fr.json` — clés `usb.*` (parité EN=FR).
- `.github/workflows/pages.yml` — télécharge les assets de la dernière release dans `_site/firmware/`.

---

## Task 1 : Spike de dé-risque (connect-only, on-device) — **GATE**

> **But :** prouver que l'auto-reset DTR/RTS entre en mode bootloader **via Web Serial** sur le K718, **sans rien écrire**. Confirme aussi l'API réelle du bundle vendorisé (noms exportés, ctor `Transport`, `main()`, méthode de reset). **Si le spike échoue, STOP** : ne pas construire l'UI avant d'avoir confirmé l'entrée bootloader (ou conçu le fallback BOOT manuel). Étape **pilotée par l'utilisateur** (branchement K718 + geste `requestPort()` dans Chrome).
>
> **✅ RÉSULTAT (2026-07-04, spike passé) :** esptool-js **0.6.0** (Apache-2.0) vendorisé ; exports ESM `ESPLoader`/`Transport` (+ stratégies `ClassicReset`/`HardReset`/`UsbJtagSerialReset`). `ESPLoader.main()` a **détecté « ESP32-S3 (QFN56) rev v0.2 » du premier coup → auto-reset OK, PAS de fallback BOOT manuel obligatoire**. Méthode de reset réelle = **`ESPLoader.after('hard_reset')`** (et NON `loader.hardReset`, qui n'existe pas sur l'instance). Ctor `new Transport(port, tracing)`, `new ESPLoader({transport, baudrate})` (le ctor 0.6.0 ne lit PAS `romBaudrate` — hardcodé 115200). Steps 1-5 ci-dessous **faits** (bundle committé, harnais supprimé).

**Files:**
- Create: `designer/vendor/esptool-bundle.js`
- Create (jetable, supprimé en fin de tâche): `designer/usb-spike.html`

- [ ] **Step 1 : Vendoriser esptool-js (version épinglée)**

```bash
cd <repo>/designer
# Récupère la version publiée pour l'épingler dans un commentaire :
curl -s https://unpkg.com/esptool-js/package.json | grep '"version"'
# Télécharge le bundle ES (contient esptool-js + pako) :
curl -sL https://unpkg.com/esptool-js/bundle.js -o vendor/esptool-bundle.js
head -c 400 vendor/esptool-bundle.js
```

Ajouter en tête du fichier un commentaire (garder la licence Apache-2.0) :
```js
// esptool-js — vendorisé (bundle ESM, esptool-js@<VERSION>, https://github.com/espressif/esptool-js)
// Licence Apache-2.0 © Espressif Systems. Non modifié.
```

- [ ] **Step 2 : Confirmer le format du module et l'API**

```bash
grep -Eo 'export\{[^}]*\}|export (class|function) (ESPLoader|Transport)' vendor/esptool-bundle.js | head
grep -Eo '(hardReset|after|reset|disconnect)\s*\(' vendor/esptool-bundle.js | sort -u | head
```
Attendu : le bundle exporte `ESPLoader` et `Transport` (ESM). Noter la **méthode de reset** réellement présente (`hardReset` / `after` / reset via `transport`) — elle sera réutilisée en Task 3. Si le bundle n'est PAS un module ESM à exports nommés, adapter l'import (le designer est en ESM) et le consigner.

- [ ] **Step 3 : Écrire le harnais jetable `designer/usb-spike.html`**

```html
<!doctype html><meta charset="utf-8"><title>USB spike</title>
<button id="go">Connecter (connect-only, aucune écriture)</button>
<pre id="out"></pre>
<script type="module">
import { ESPLoader, Transport } from './vendor/esptool-bundle.js';
const out = document.getElementById('out');
const log = m => { out.textContent += m + '\n'; };
document.getElementById('go').onclick = async () => {
  out.textContent = '';
  try {
    const port = await navigator.serial.requestPort();     // geste utilisateur
    const transport = new Transport(port, true);
    const loader = new ESPLoader({ transport, baudrate: 921600, romBaudrate: 115200 });
    const chip = await loader.main();                       // fait le reset DTR/RTS + sync + détection
    log('OK — puce détectée : ' + chip);
    try { await loader.hardReset(); } catch (e) { log('(reset : ' + e.message + ')'); }  // remet le device en boot normal
    await transport.disconnect();
    log('déconnecté proprement');
  } catch (e) { log('ÉCHEC : ' + e.message); }
};
</script>
```
> Si Step 2 a révélé un nom de reset différent de `hardReset`, l'employer ici.

- [ ] **Step 4 : Servir + faire tourner le spike (utilisateur)**

Servir en no-store depuis la racine `designer/` puis l'utilisateur ouvre `usb-spike.html` **dans Chrome**, branche le K718 en USB, clique « Connecter », choisit le port.

```bash
cd <repo>/designer
python3 -m http.server 8123
# → l'utilisateur ouvre http://localhost:8123/usb-spike.html dans Chrome
```
Attendu : « OK — puce détectée : ESP32-S3 » puis « déconnecté proprement ».

- **Si ÉCHEC de connexion** : demander à l'utilisateur de maintenir **BOOT** + taper **RESET** sur le K718 puis recliquer. Si ça ne marche qu'ainsi → l'auto-reset ne passe pas sur ce matériel → **le fallback BOOT manuel devient obligatoire** dans l'UI (Task 4) ; consigner la découverte avant de continuer.

- [ ] **Step 5 : Nettoyer + commiter le bundle vendorisé**

```bash
cd <repo>
rm designer/usb-spike.html                      # le harnais est jetable ; le bundle reste
git add designer/vendor/esptool-bundle.js
git commit -m "feat(2b): vendorise esptool-js + spike bootloader on-device (connect-only) OK

Claude-Session: https://claude.ai/code/session_014cpGioFcrC72ZkADCjcs9c"
```

Consigner dans le message/HANDOFF : version épinglée, méthode de reset confirmée, verdict auto-reset (OK / BOOT manuel requis).

---

## Task 2 : Module pur `usb-plan.js` + tests node

**Files:**
- Create: `designer/js/usb-plan.js`
- Test: `designer/tests/usb-plan.test.js`

- [ ] **Step 1 : Écrire les tests d'abord**

```js
// designer/tests/usb-plan.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OFFSETS, validateManifest, planParts } from '../js/usb-plan.js';

const goodManifest = () => ({
  version: 'v1.2.3',
  parts: [
    { path: 'bootloader.bin', offset: OFFSETS.bootloader },
    { path: 'partitions.bin', offset: OFFSETS.partitions },
    { path: 'boot_app0.bin',  offset: OFFSETS.boot_app0 },
    { path: 'firmware.bin',   offset: OFFSETS.app },
    { path: 'littlefs.bin',   offset: OFFSETS.fs },
  ],
});
const app = (n) => { const b = new Uint8Array(n || 64); b[0] = 0xE9; return b; };  // magic ESP
const raw = (n) => new Uint8Array(n || 64);

test('validateManifest : forme valide → ok (intent : accepter un manifest CI conforme)', () => {
  assert.deepEqual(validateManifest(goodManifest()), { ok: true, reason: null });
});

test('validateManifest : non-objet → shape (intent : défensif comme le reste du projet)', () => {
  assert.equal(validateManifest(null).reason, 'shape');
  assert.equal(validateManifest('x').reason, 'shape');
});

test('validateManifest : version manquante → version (intent : afficher une version fiable)', () => {
  const m = goodManifest(); delete m.version;
  assert.equal(validateManifest(m).reason, 'version');
});

test('validateManifest : offset inattendu → offset (intent : refuser un manifest qui viserait une mauvaise adresse)', () => {
  const m = goodManifest(); m.parts[0].offset = 0x1000;   // 0x1000 = bootloader ESP32 classique, PAS S3
  assert.equal(validateManifest(m).reason, 'offset');
});

test('validateManifest : une part manquante → parts (intent : exiger les 5 partitions)', () => {
  const m = goodManifest(); m.parts.pop();
  assert.equal(validateManifest(m).reason, 'parts');
});

test('planParts : blobs présents → fileArray trié par offset (intent : ordre de flash déterministe)', () => {
  const blobs = { 'bootloader.bin': raw(), 'partitions.bin': raw(), 'boot_app0.bin': raw(), 'firmware.bin': app(), 'littlefs.bin': raw() };
  const r = planParts(goodManifest(), blobs);
  assert.equal(r.ok, true);
  assert.deepEqual(r.fileArray.map(f => f.address), [OFFSETS.bootloader, OFFSETS.partitions, OFFSETS.boot_app0, OFFSETS.app, OFFSETS.fs]);
  assert.ok(r.fileArray[3].data instanceof Uint8Array);
});

test('planParts : blob manquant → missing_blob (intent : ne pas flasher une part vide)', () => {
  const blobs = { 'bootloader.bin': raw(), 'partitions.bin': raw(), 'boot_app0.bin': raw(), 'firmware.bin': app() };  // pas de littlefs
  assert.equal(planParts(goodManifest(), blobs).reason, 'missing_blob');
});

test('planParts : image app sans magic 0xE9 → app_magic (intent : anti-brick, réutilise validateBinary)', () => {
  const blobs = { 'bootloader.bin': raw(), 'partitions.bin': raw(), 'boot_app0.bin': raw(), 'firmware.bin': raw(), 'littlefs.bin': raw() };
  assert.equal(planParts(goodManifest(), blobs).reason, 'app_magic');
});
```

- [ ] **Step 2 : Lancer les tests → échec (module absent)**

```bash
cd designer && node --test tests/usb-plan.test.js
```
Attendu : FAIL (`Cannot find module '../js/usb-plan.js'`).

- [ ] **Step 3 : Écrire `designer/js/usb-plan.js`**

```js
// Logique PURE du flash USB (Web Serial) : validation du manifest hébergé + planification des parts.
// Aucun DOM/réseau/série → testée node. Défensif (entrée non conforme → résultat, jamais throw), comme ota-plan.js.
import { validateBinary } from './ota-plan.js';

// Offsets des 5 images d'un device vierge (dialboard_16MB.csv ; ESP32-S3 : bootloader @0x0, PAS 0x1000).
export const OFFSETS = { bootloader: 0x0, partitions: 0x8000, boot_app0: 0xe000, app: 0x10000, fs: 0x810000 };
const EXPECTED = new Set(Object.values(OFFSETS));   // les 5 offsets attendus, exactement

// obj → { ok, reason }. reason ∈ null | 'shape' | 'version' | 'parts' | 'offset'.
export function validateManifest(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'shape' };
  if (typeof obj.version !== 'string' || !obj.version) return { ok: false, reason: 'version' };
  const parts = obj.parts;
  if (!Array.isArray(parts) || parts.length !== EXPECTED.size) return { ok: false, reason: 'parts' };
  const seen = new Set();
  for (const p of parts) {
    if (!p || typeof p.path !== 'string' || !p.path) return { ok: false, reason: 'parts' };
    if (!EXPECTED.has(p.offset)) return { ok: false, reason: 'offset' };
    seen.add(p.offset);
  }
  if (seen.size !== EXPECTED.size) return { ok: false, reason: 'offset' };   // doublon → un offset manque
  return { ok: true, reason: null };
}

// (manifest, blobs:{path→Uint8Array}) → { ok, fileArray?, reason? }. fileArray trié par offset croissant.
// reason ∈ 'missing_blob' | 'app_magic'. Réutilise validateBinary (magic 0xE9) sur l'image app.
export function planParts(manifest, blobs) {
  const parts = [...manifest.parts].sort((a, b) => a.offset - b.offset);
  const fileArray = [];
  for (const p of parts) {
    const data = blobs && blobs[p.path];
    if (!(data instanceof Uint8Array) || data.length === 0) return { ok: false, reason: 'missing_blob' };
    if (p.offset === OFFSETS.app && !validateBinary(data, 'firmware').ok) return { ok: false, reason: 'app_magic' };
    fileArray.push({ data, address: p.offset });
  }
  return { ok: true, fileArray };
}
```

- [ ] **Step 4 : Lancer les tests → succès**

```bash
cd designer && node --test tests/usb-plan.test.js
```
Attendu : PASS (8 tests). Puis vérifier la suite complète : `node --test`.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/usb-plan.js designer/tests/usb-plan.test.js
git commit -m "feat(2b): usb-plan.js — validateManifest + planParts (module pur, tests node)

Claude-Session: https://claude.ai/code/session_014cpGioFcrC72ZkADCjcs9c"
```

---

## Task 3 : Transport série `serial.js`

> Enveloppe esptool-js. **Non testable node** (Web Serial) → browser-verified en Task 5. Utilise l'API confirmée en Task 1 (ctor `Transport`, `main()`, méthode de reset, `disconnect`).

**Files:**
- Create: `designer/js/serial.js`

- [ ] **Step 1 : Écrire `designer/js/serial.js`**

```js
// Transport de flash série (Web Serial + esptool-js). Browser-only → browser-verified (comme les builders DOM).
import { ESPLoader, Transport } from '../vendor/esptool-bundle.js';

// port (SerialPort), fileArray ([{data:Uint8Array, address}] de usb-plan.planParts), opts.
// onProgress(frac 0..1) pondéré par taille des parts ; onLog(op, arg?) pour le journal ; eraseAll (efface la NVS/WiFi).
export async function flashDevice(port, fileArray, { onProgress, onLog, eraseAll = false } = {}) {
  const transport = new Transport(port, true);
  const loader = new ESPLoader({ transport, baudrate: 921600 });   // esptool-js 0.6.0 : le ctor ne lit PAS romBaudrate (hardcodé 115200)
  try {
    onLog && onLog('connect');
    const chip = await loader.main();                    // reset DTR/RTS + sync + détection de puce
    onLog && onLog('detected', chip);
    const total = fileArray.reduce((n, f) => n + f.data.length, 0) || 1;
    const done = new Array(fileArray.length).fill(0);
    onLog && onLog('write');
    await loader.writeFlash({
      fileArray,
      flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep',   // 'keep' : ne pas repatcher l'en-tête bootloader (déjà 16 Mo)
      eraseAll, compress: true,
      reportProgress: (i, written) => {
        done[i] = written;
        onProgress && onProgress(done.reduce((a, b) => a + b, 0) / total);
      },
    });
    onLog && onLog('reset');
    await loader.after('hard_reset');                    // reset confirmé Task 1 (esptool-js 0.6.0 : ESPLoader.after, défaut 'hard_reset')
  } finally {
    try { await transport.disconnect(); } catch { /* déjà fermé / débranché */ }
  }
}
```

- [ ] **Step 2 : Sanity-check syntaxe (import ES résolu par le navigateur en Task 5 ; ici juste la forme)**

```bash
cd designer && node --check js/serial.js
```
Attendu : PAS d'erreur de syntaxe. (L'import du bundle n'est pas résolu par `node --check`, c'est normal.)

- [ ] **Step 3 : Commit**

```bash
git add designer/js/serial.js
git commit -m "feat(2b): serial.js — flashDevice (esptool-js/Web Serial, progression pondérée)

Claude-Session: https://claude.ai/code/session_014cpGioFcrC72ZkADCjcs9c"
```

---

## Task 4 : Overlay `usb-dialog.js` + markup + CSS + i18n + câblage

**Files:**
- Create: `designer/js/usb-dialog.js`
- Modify: `designer/index.html` (bouton topbar près de `#ota-open` l.46 ; overlay après `#ota-overlay` ~l.178)
- Modify: `designer/style.css`
- Modify: `designer/js/app.js` (montage ~l.306 ; **pas** dans `deviceBtns` l.427 — le flash USB n'utilise pas `base`)
- Modify: `designer/i18n/en.js`, `designer/i18n/fr.json`

- [ ] **Step 1 : Ajouter les clés i18n EN (`designer/i18n/en.js`, après le bloc `ota.*`)**

```js
  'toolbar.usb.tip': 'Set up a new device (USB)',
  'toolbar.usb.title': 'Flash a blank device over USB (Chrome/Edge)',
  'usb.title': 'Set up a new device (USB)',
  'usb.intro': 'Plug the screen into this computer with a USB cable, then flash the Dialboard firmware. Nothing to install.',
  'usb.unsupported': 'USB flashing needs Web Serial — open this page in Chrome or Edge on desktop.',
  'usb.unavailable': 'No firmware release is available yet.',
  'usb.version': 'Firmware to flash: {version}',
  'usb.erase': 'Erase everything (also erases the saved Wi-Fi)',
  'usb.connect': 'Connect & flash',
  'usb.close': 'Close',
  'usb.step.connect': 'Connecting to the device…',
  'usb.step.detected': 'Detected: {chip}',
  'usb.step.write': 'Writing firmware…',
  'usb.step.reset': 'Restarting the device…',
  'usb.done': 'Device flashed. It restarts as a Dialboard (Wi-Fi setup portal “Dialboard-XXXX” if no Wi-Fi is saved).',
  'usb.failed': 'Flashing failed: {msg}',
  'usb.fetch_failed': 'Could not download the firmware: {msg}',
  'usb.bootloader_hint': 'Could not connect. Hold BOOT, tap RESET on the device, then try again.',
```

- [ ] **Step 2 : Ajouter les MÊMES clés en FR (`designer/i18n/fr.json`, après le bloc `ota.*`)**

```json
  "toolbar.usb.tip": "Installer un nouveau device (USB)",
  "toolbar.usb.title": "Flasher un device vierge par USB (Chrome/Edge)",
  "usb.title": "Installer un nouveau device (USB)",
  "usb.intro": "Branche l'écran à cet ordinateur avec un câble USB, puis flashe le firmware Dialboard. Rien à installer.",
  "usb.unsupported": "Le flash USB nécessite Web Serial — ouvre cette page dans Chrome ou Edge sur ordinateur.",
  "usb.unavailable": "Aucune version du firmware n'est disponible pour l'instant.",
  "usb.version": "Firmware à flasher : {version}",
  "usb.erase": "Tout effacer (efface aussi le Wi-Fi enregistré)",
  "usb.connect": "Connecter & flasher",
  "usb.close": "Fermer",
  "usb.step.connect": "Connexion au device…",
  "usb.step.detected": "Détecté : {chip}",
  "usb.step.write": "Écriture du firmware…",
  "usb.step.reset": "Redémarrage du device…",
  "usb.done": "Device flashé. Il redémarre en Dialboard (portail de config « Dialboard-XXXX » si aucun Wi-Fi enregistré).",
  "usb.failed": "Échec du flash : {msg}",
  "usb.fetch_failed": "Téléchargement du firmware impossible : {msg}",
  "usb.bootloader_hint": "Connexion impossible. Maintiens BOOT, appuie sur RESET du device, puis réessaie.",
```

- [ ] **Step 3 : Vérifier la parité i18n**

```bash
cd designer && node --test tests/i18n-parity.test.js
```
Attendu : PASS (EN et FR ont exactement les mêmes clés).

- [ ] **Step 4 : Bouton topbar dans `designer/index.html`** (juste après `#ota-open`, l.46)

```html
      <button id="usb-open" class="tb-btn" data-i18n-tip="toolbar.usb.tip" data-i18n-title="toolbar.usb.title" data-tip="Installer un nouveau device (USB)" title="Flasher un device vierge par USB"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v9M5 7l3 3 3-3"/><rect x="6" y="12" width="4" height="3" rx="1"/></svg></button>
```

- [ ] **Step 5 : Overlay dans `designer/index.html`** (après le bloc `#ota-overlay`, ~l.193)

```html
  <div id="usb-overlay" class="shot-overlay" hidden>
    <div class="ota-box">
      <h2 data-i18n="usb.title">Installer un nouveau device (USB)</h2>
      <p id="usb-intro" class="ota-warn" data-i18n="usb.intro">Branche l'écran en USB, puis flashe.</p>
      <p id="usb-unsupported" class="ota-err" data-i18n="usb.unsupported" hidden></p>
      <p id="usb-version"></p>
      <label class="usb-erase"><input id="usb-erase" type="checkbox" /> <span data-i18n="usb.erase">Tout effacer (efface aussi le Wi-Fi enregistré)</span></label>
      <div id="usb-progress" class="ota-progress" hidden><div id="usb-bar"></div></div>
      <ul id="usb-log" class="ota-log"></ul>
      <div class="ota-actions">
        <button id="usb-cancel" type="button" data-i18n="usb.close">Fermer</button>
        <button id="usb-submit" type="button" data-i18n="usb.connect" disabled>Connecter & flasher</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 6 : CSS dans `designer/style.css`** (réemploi `.ota-*` ; juste l'appoint)

```css
.usb-erase { display: flex; align-items: center; gap: .5rem; font-size: .9rem; margin: .5rem 0; }
#usb-version { font-weight: 600; margin: .25rem 0; }
```

- [ ] **Step 7 : Écrire `designer/js/usb-dialog.js`**

```js
// Overlay « Nouveau device » : fetch manifest same-origine → affiche la version → requestPort() → flashDevice.
// Ossature calquée sur ota-dialog.js. flash/requestPort/hasSerial injectables → testable en mock (Task 5). Browser-verified.
import { validateManifest, planParts } from './usb-plan.js';
import { flashDevice } from './serial.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

export function mountUsbDialog(model, options) {
  const {
    openBtn, overlay, manifestUrl,
    flash = flashDevice,                                   // injectable pour le mock
    requestPort = () => navigator.serial.requestPort(),    // injectable pour le mock
    hasSerial = ('serial' in navigator),                   // injectable pour le mock
  } = options || {};
  if (!openBtn || !overlay || typeof manifestUrl !== 'string') return;
  const $ = id => overlay.querySelector('#' + id);
  const intro = $('usb-intro'), unsupported = $('usb-unsupported'), versionEl = $('usb-version');
  const erase = $('usb-erase'), submit = $('usb-submit'), progress = $('usb-progress'), bar = $('usb-bar'), log = $('usb-log');
  let manifest = null, busy = false;

  const setBar = (frac) => { progress.hidden = false; bar.style.width = Math.round(frac * 100) + '%'; };
  const clearLog = () => { log.textContent = ''; progress.hidden = true; bar.style.width = '0'; };
  const logStep = (op, arg) => { const li = document.createElement('li'); li.textContent = t('usb.step.' + op, arg ? { chip: arg } : undefined); log.appendChild(li); };
  const logErr = (msg) => { const li = document.createElement('li'); li.className = 'err'; li.textContent = msg; log.appendChild(li); };

  // Charge le manifest same-origine + affiche la version. Manifest 404/invalide → indisponible.
  async function loadManifest() {
    versionEl.textContent = ''; manifest = null;
    try {
      const res = await fetch(manifestUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const obj = await res.json();
      if (!validateManifest(obj).ok) throw new Error('invalid manifest');
      manifest = obj;
      versionEl.textContent = t('usb.version', { version: obj.version });
    } catch (e) { versionEl.textContent = t('usb.unavailable'); }
    refresh();
  }
  const refresh = () => { submit.disabled = busy || !hasSerial || !manifest; };

  async function run() {
    if (submit.disabled) return;
    busy = true; refresh(); clearLog();
    try {
      const port = await requestPort();                    // geste utilisateur
      // fetch des 5 blobs same-origine (résolus relativement au manifest)
      const blobs = {};
      for (const p of manifest.parts) {
        const url = new URL(p.path, new URL(manifestUrl, location.href)).href;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(t('usb.fetch_failed', { msg: p.path + ' HTTP ' + res.status }));
        blobs[p.path] = new Uint8Array(await res.arrayBuffer());
      }
      const plan = planParts(manifest, blobs);
      if (!plan.ok) throw new Error(t('usb.fetch_failed', { msg: plan.reason }));
      await flash(port, plan.fileArray, { onProgress: setBar, onLog: logStep, eraseAll: erase.checked });
      showToast(t('usb.done'), { kind: 'ok', ms: 8000 });
      close();
    } catch (e) {
      logErr(e.message);
      logErr(t('usb.bootloader_hint'));                    // repli bootloader (auto-reset raté possible)
      showToast(t('usb.failed', { msg: e.message }), { kind: 'warn', ms: 6000 });
    } finally { busy = false; refresh(); }
  }

  const open = async () => {
    overlay.hidden = false; clearLog();
    erase.checked = false;
    unsupported.hidden = hasSerial; intro.hidden = !hasSerial;   // hors Chromium : message d'aide, pas de flash
    await loadManifest();
  };
  const close = () => { overlay.hidden = true; };
  openBtn.addEventListener('click', open);
  $('usb-cancel').addEventListener('click', () => { if (!busy) close(); });
  overlay.addEventListener('click', e => { if (e.target === overlay && !busy) close(); });
  submit.addEventListener('click', run);
}
```

- [ ] **Step 8 : Câbler dans `designer/js/app.js`**

Ajouter l'import (près de `import { mountOtaDialog }` l.9) :
```js
import { mountUsbDialog } from './usb-dialog.js';
```
Monter (près du `mountOtaDialog(...)` ~l.306) :
```js
  mountUsbDialog(model, {
    openBtn: $('usb-open'), overlay: $('usb-overlay'),
    manifestUrl: '../firmware/manifest.json',             // frère de designer/ sur Pages (_site/firmware/), comme ../schema/
  });
  if (!('serial' in navigator)) $('usb-open').hidden = true;   // dégradation : pas d'entrée morte hors Chromium
```
> Ne PAS ajouter `usb-open` à la liste `deviceBtns` (l.427) : le flash USB n'utilise pas `base` et ne doit pas être grisé pendant une I/O device.

- [ ] **Step 9 : Vérif syntaxe + suite de tests**

```bash
cd designer && node --check js/usb-dialog.js && node --test
```
Attendu : pas d'erreur de syntaxe ; suite node au vert (dont `usb-plan` et `i18n-parity`).

- [ ] **Step 10 : Commit**

```bash
git add designer/js/usb-dialog.js designer/index.html designer/style.css designer/js/app.js designer/i18n/en.js designer/i18n/fr.json
git commit -m "feat(2b): overlay « Nouveau device » — mountUsbDialog + markup + i18n + câblage + dégradation

Claude-Session: https://claude.ai/code/session_014cpGioFcrC72ZkADCjcs9c"
```

---

## Task 5 : QA navigateur (mock) — browser-verified

> Web Serial réel non mockable de bout en bout : on injecte `flash`/`requestPort`/`hasSerial` stubbés et un `manifestUrl` de fixture, et on vérifie tout l'overlay. Cf. mémoire `designer-verif-navigateur` (servir en no-store depuis la **racine du repo**, ouvrir `/designer/`, vrais events pointer).

**Files:** aucun fichier committé (vérif manuelle) ; noter les preuves.

- [ ] **Step 1 : Fixture manifest + servir**

Créer une fixture jetable `designer/firmware/manifest.json` (device off, sera supprimée) contenant un manifest valide (5 parts, offsets `OFFSETS`, `version: "vTEST"`) et 5 fichiers `.bin` bidons (dont `firmware.bin` commençant par `0xE9`). Servir en no-store depuis la racine du repo, ouvrir `/designer/`.

- [ ] **Step 2 : Cas nominal (flash stubbé)** — dans la console du navigateur, remonter l'overlay avec un `flash` stub qui appelle `onLog('connect')`, `onLog('detected','ESP32-S3')`, `onProgress` de 0→1, résout ; `requestPort` stub renvoyant un faux port ; `hasSerial:true`. Vérifier : version « vTEST » affichée, bouton armé, barre 0→100 %, log des étapes, toast `ok`, overlay fermé.

- [ ] **Step 3 : Dégradation** — remonter avec `hasSerial:false` : `#usb-unsupported` visible, `#usb-intro` masqué, bouton **désactivé**.

- [ ] **Step 4 : Manifest indisponible** — `manifestUrl` pointant un 404 : `#usb-version` = « Aucune version… », bouton désactivé.

- [ ] **Step 5 : Chemin d'erreur** — `flash` stub qui `throw new Error('sync failed')` : log rouge + **hint bootloader** loggé, toast `warn`, overlay **laissé ouvert**.

- [ ] **Step 6 : 0 erreur console. Nettoyer la fixture.**

```bash
rm -rf designer/firmware        # fixture jetable ; le vrai firmware/ vient de Pages (Task 6)
```
Consigner les preuves (captures) dans `docs/_internal/`.

---

## Task 6 : CI — build firmware sur tag + service same-origine par Pages

**Files:**
- Create: `.github/workflows/firmware-release.yml`
- Modify: `.github/workflows/pages.yml`

- [ ] **Step 1 : Écrire `.github/workflows/firmware-release.yml`**

```yaml
# Build le firmware ESP32-S3 + l'image LittleFS sur tag v*, assemble les 5 images d'un device
# vierge + un manifest.json, et publie le tout en assets de Release. Consommé par pages.yml
# (téléchargées dans _site/firmware/, servies same-origine au designer pour le flash USB — chantier 2b).
name: Build & release firmware
on:
  push:
    tags: ['v*']
  workflow_dispatch:
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - name: Cache PlatformIO
        uses: actions/cache@v4
        with:
          path: |
            ~/.platformio
            .pio
          key: pio-${{ runner.os }}-${{ hashFiles('platformio.ini') }}
      - run: pip install --upgrade platformio
      - name: Build firmware (app + bootloader + partitions)
        run: pio run -e esp32s3
      - name: Build LittleFS image (designer + schema + layout)
        run: |
          bash tools/stage_fs.sh
          pio run -e esp32s3 -t buildfs
      - name: Assemble firmware images + manifest
        run: |
          set -euo pipefail
          mkdir -p out
          B=.pio/build/esp32s3
          cp "$B/bootloader.bin" "$B/partitions.bin" "$B/firmware.bin" "$B/littlefs.bin" out/
          cp "$(find ~/.platformio/packages/framework-arduinoespressif32 -name boot_app0.bin | head -1)" out/boot_app0.bin
          cat > out/manifest.json <<JSON
          { "version": "${GITHUB_REF_NAME}",
            "parts": [
              { "path": "bootloader.bin", "offset": 0 },
              { "path": "partitions.bin", "offset": 32768 },
              { "path": "boot_app0.bin",  "offset": 57344 },
              { "path": "firmware.bin",   "offset": 65536 },
              { "path": "littlefs.bin",   "offset": 8454144 } ] }
          JSON
      - name: Publish release
        uses: softprops/action-gh-release@v2
        with:
          files: out/*
```
> Offsets décimaux = 0x0 / 0x8000 / 0xe000 / 0x10000 / 0x810000. Ils sont revalidés côté designer par `validateManifest` (fail-safe si dérive). `${GITHUB_REF_NAME}` = le tag (ex. `v0.1.0`) sur un push de tag ; sur `workflow_dispatch`, c'est la branche — lancer de préférence par tag.

- [ ] **Step 2 : Étendre `.github/workflows/pages.yml`**

Ajouter le déclencheur `release` (bloc `on:`) pour redéployer Pages quand un firmware sort :
```yaml
on:
  push:
    branches: [main]
    paths:
      - 'designer/**'
      - 'schema/**'
      - '.github/workflows/pages.yml'
  release:
    types: [published]
  workflow_dispatch:
```
Dans le job `build`, après l'étape « Assemble _site », ajouter :
```yaml
      - name: Fetch latest firmware release into _site/firmware
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          mkdir -p _site/firmware
          gh release download --dir _site/firmware --pattern '*' \
            || echo "Pas encore de release firmware — flash USB désactivé jusqu'au premier tag."
```
> `gh release download` sans tag = dernière release. Le `|| echo` tolère l'absence de release (l'overlay se dégrade sur un manifest 404, Task 4).

- [ ] **Step 3 : Valider la syntaxe YAML**

```bash
python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in ['.github/workflows/firmware-release.yml','.github/workflows/pages.yml']]; print('YAML OK')"
```
Attendu : `YAML OK`.

- [ ] **Step 4 : Commit**

```bash
git add .github/workflows/firmware-release.yml .github/workflows/pages.yml
git commit -m "ci(2b): build firmware sur tag → Release ; Pages sert _site/firmware/ same-origine

Claude-Session: https://claude.ai/code/session_014cpGioFcrC72ZkADCjcs9c"
```

> **Vérif CI réelle** (hors flux git local) : après merge + un tag `v*`, confirmer que `firmware-release.yml` produit les 5 `.bin` + `manifest.json`, que Pages les sert sous `<pages-url>/firmware/`, et que l'overlay affiche la version. À faire à la demande (nécessite un tag).

---

## Task 7 : Vérification on-device finale (flash réel)

> Prouve le flux complet de bout en bout sur le K718. **Risqué mais récupérable** (`pio run -t upload` + `uploadfs`). ⚠ **Backup d'abord.**

- [ ] **Step 1 : Backup du layout perso** (device en ligne avant l'effacement)

```bash
curl -s http://192.168.1.35/layout -o docs/_internal/ota-qa/device-layout-2b-before.json
wc -c docs/_internal/ota-qa/device-layout-2b-before.json
```

- [ ] **Step 2 : Effacer la flash** (simule un device vierge)

```bash
pio run -e esp32s3 -t erase        # efface TOUTE la flash (NVS/WiFi inclus)
```

- [ ] **Step 3 : Flasher via l'overlay réel** — servir le designer localement (ou utiliser Pages une fois le CI en place), ouvrir dans **Chrome**, brancher le K718, cliquer « Connecter & flasher » (device off, geste utilisateur), choisir le port. Vérifier : détection puce, barre 0→100 %, log des étapes, toast `usb.done`.

- [ ] **Step 4 : Vérifier le boot** — le device redémarre en Dialboard : portail captif `Dialboard-XXXX` (NVS effacée) → re-provisionner le WiFi ; designer embarqué présent (`GET /designer/` = 200) ; re-pousser le layout perso (`POST /layout` avec le backup Step 1).

- [ ] **Step 5 : Consigner les preuves** dans `docs/_internal/` + mettre à jour `HANDOFF.md` et la mémoire `ota-plan-state` (2b LIVRÉ).

---

## Auto-revue (fait à l'écriture)

- **Couverture spec** : §5.1→T2, §5.2→T3, §5.3/5.4→T4, §6→T6, §7 (UX/risque bootloader)→T1(gate)+T4(hint), §9 (tests)→T2/T5/T7, §11 (spike/ordre)→T1 puis UI(T2-5) avant CI(T6). ✅
- **Placeholders** : aucun « TODO/à compléter » ; code complet à chaque étape. Les 2 renvois « méthode de reset confirmée en Task 1 » sont un contrat explicite entre tâches, pas un trou.
- **Cohérence des types** : `OFFSETS`/`validateManifest`/`planParts` (T2) consommés identiquement par `usb-dialog` (T4) ; `flashDevice(port, fileArray, {onProgress,onLog,eraseAll})` (T3) appelé avec la même signature (T4) ; `fileArray:[{data:Uint8Array,address}]` cohérent T2→T3 ; ids DOM (`usb-open/-overlay/-version/-erase/-submit/-cancel/-progress/-bar/-log/-intro/-unsupported`) cohérents index.html↔usb-dialog.js. ✅
