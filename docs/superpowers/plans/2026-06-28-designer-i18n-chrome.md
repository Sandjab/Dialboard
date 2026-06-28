# WS-1 — i18n du chrome du designer · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser l'infrastructure i18n du designer (anglais par défaut, packs de langue `.json` via manifeste, `t()` à fallback) et la prouver end-to-end sur un pilote (~110 chaînes : `index.html`, toasts/statut, settings + sélecteur de langue, menus Electron).

**Architecture:** Catalogue EN intégré au bundle (`designer/i18n/en.js`, importé statiquement = fallback garanti). Packs `.json` (`fr.json`) découverts via `i18n/index.json` (manifeste), fetchés à la demande. Un moteur `designer/js/i18n.js` expose des helpers **purs** (testés node) + `t()`/`initI18n()`/`applyStaticI18n()`/`availableLanguages()` (singleton module, câblage vérifié navigateur). Changement de langue ⇒ `location.reload()`. Validation Latin-1 ciblée sur le namespace `default.*` (contrat WS-2).

**Tech Stack:** ES modules (designer), `node --test` (tests purs), Electron (IPC menus natifs), LittleFS staging (`tools/stage_fs.sh`).

**Spec:** `docs/superpowers/specs/2026-06-28-designer-i18n-chrome-design.md`

---

## Structure des fichiers

**Créés :**
- `designer/i18n/en.js` — catalogue EN (`export default {…}`), SOURCE DE VÉRITÉ, importé par le moteur.
- `designer/i18n/index.json` — manifeste des packs additionnels.
- `designer/i18n/fr.json` — pack français (= le FR actuel, ré-encodé en clés).
- `designer/js/i18n.js` — moteur : helpers purs + `t()`/`initI18n()`/`applyStaticI18n()`/`availableLanguages()`.
- `designer/tests/i18n.test.js` — tests des helpers purs.

**Modifiés :**
- `designer/index.html` — attributs `data-i18n*` sur le chrome statique.
- `designer/js/app.js` — init i18n au boot, `applyStaticI18n`, littéraux toasts → `t()`, câblage du sélecteur de langue, push des labels de menu Electron.
- `designer/js/statusbar.js` — littéraux → `t()`.
- `designer/js/settings.js` — `lang` dans le store + sélecteur de langue + `onLanguageChange`.
- `designer/electron/main.js` — `buildMenu(labels)` + IPC `menu:setLabels` + labels EN par défaut.
- `designer/electron/preload.js` — expose `window.desktop.setMenuLabels`.
- `tools/stage_fs.sh` — stage `designer/i18n/` dans `data/`.

**Convention de namespaces des clés :** `title.*` (titre de page), `toolbar.*`, `panel.*`, `drawer.*`, `shot.*`, `pill.*`, `status.*`, `toast.*`, `settings.*`, `menu.*`, et **`default.*`** (contenu injecté dans le layout — soumis à Latin-1 ; non utilisé par le pilote, cf. spec). Les chaînes de chrome acceptent tout Unicode.

**Garde-parité (à vérifier à la fin) :** `git diff --name-only main -- src lib schema designer/js/render.js` doit rester **vide**.

---

## Task 1 : Moteur i18n — helpers purs (TDD)

**Files:**
- Create: `designer/i18n/en.js`
- Create: `designer/js/i18n.js`
- Test: `designer/tests/i18n.test.js`

- [ ] **Step 1 : Créer le catalogue EN amorce** (pour que `i18n.js` puisse l'importer ; il grossit aux tâches suivantes)

`designer/i18n/en.js` :
```js
// Catalogue EN — SOURCE DE VÉRITÉ de l'i18n du designer. Importé statiquement par js/i18n.js
// (jamais fetché) ⇒ fallback garanti hors réseau/fichiers. Clés plates namespacées (cf. plan).
// Les autres langues sont des packs .json (designer/i18n/<code>.json) listés dans index.json.
export default {
  'i18n.language': 'Language',          // libellé du sélecteur de langue (Settings)
};
```

- [ ] **Step 2 : Écrire les tests des helpers purs (échouent)**

`designer/tests/i18n.test.js` :
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookup, interpolate, isLatin1, latin1Violations, missingKeys } from '../js/i18n.js';

test('lookup: pack prioritaire sur EN (intent : la langue active gagne)', () => {
  assert.equal(lookup({ 'a': 'FR' }, { 'a': 'EN' }, 'a'), 'FR');
});

test('lookup: clé absente du pack → fallback EN (intent : pack incomplet ne casse pas l’UI)', () => {
  assert.equal(lookup({}, { 'a': 'EN' }, 'a'), 'EN');
});

test('lookup: clé absente partout → clé brute (intent : jamais d’écran vide)', () => {
  assert.equal(lookup({}, {}, 'x.y'), 'x.y');
});

test('interpolate: remplace les placeholders nommés', () => {
  assert.equal(interpolate('Page « {name} »', { name: 'Accueil' }), 'Page « Accueil »');
  assert.equal(interpolate('{n} sur {n}', { n: 3 }), '3 sur 3');
});

test('interpolate: placeholder sans valeur laissé tel quel (intent : pas de "undefined")', () => {
  assert.equal(interpolate('a {x} b', {}), 'a {x} b');
});

test('isLatin1: accents OK, hors-Latin-1 rejeté (intent : parité fontes device, cf. WS-2)', () => {
  assert.equal(isLatin1('Météo · °C'), true);
  assert.equal(isLatin1('Texte'), true);
  assert.equal(isLatin1('😀'), false);
  assert.equal(isLatin1('日本語'), false);
});

test('latin1Violations: seules les clés default.* sont contraintes (intent : chrome libre, contenu device borné)', () => {
  const pack = { 'default.comp.text': '😀', 'toast.ok': '✓ émoji ok', 'default.comp.label': 'Étiquette' };
  assert.deepEqual(latin1Violations(pack), ['default.comp.text']);   // toast.* (chrome) ignoré ; default.comp.label (Latin-1) ok
});

test('missingKeys: clés EN absentes du pack (intent : mesure de complétude)', () => {
  assert.deepEqual(missingKeys({ a: '', b: '', c: '' }, { a: '' }), ['b', 'c']);
});
```

- [ ] **Step 3 : Lancer les tests, vérifier l’échec**

Run: `cd designer && node --test tests/i18n.test.js`
Expected: FAIL (`i18n.js` n'exporte pas encore ces helpers / module introuvable).

- [ ] **Step 4 : Implémenter le moteur**

`designer/js/i18n.js` :
```js
// Moteur i18n du designer. Helpers PURS (testés node) + état singleton (t/initI18n/applyStaticI18n/
// availableLanguages, câblage vérifié navigateur, cf. convention projet). EN intégré (import statique =
// fallback garanti) ; les autres langues sont des packs .json fetchés via le manifeste i18n/index.json.
// Changement de langue ⇒ location.reload() (le moteur se réinitialise au boot suivant).
import EN from '../i18n/en.js';

// --- Helpers purs ---
export function lookup(current, en, key) {
  // Résolution en cascade : langue active → EN → clé brute (jamais d'écran vide).
  return current[key] ?? en[key] ?? key;
}
export function interpolate(str, params) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? String(params[k]) : m));
}
export function isLatin1(s) {
  // Plafond d'affichage = Latin-1 (= ce que les fontes du device rendent, cf. WS-2).
  return /^[\x20-\x7E\xA0-\xFF]*$/.test(s);
}
export function latin1Violations(pack) {
  // Seul le contenu injecté dans le layout (namespace default.*) est contraint ; le chrome est libre.
  return Object.keys(pack).filter(k => k.startsWith('default.') && !isLatin1(pack[k]));
}
export function missingKeys(en, pack) {
  return Object.keys(en).filter(k => !(k in pack));
}

// --- État singleton + API câblage ---
let current = EN;          // catalogue de la langue active (EN, ou un pack fetché)
let activeLang = 'en';

export function currentLang() { return activeLang; }

export function t(key, params) {
  const raw = lookup(current, EN, key);
  return params ? interpolate(raw, params) : raw;
}

// Charge la langue demandée. 'en' (ou absent) ⇒ catalogue intégré. Sinon fetch i18n/<lang>.json :
// les clés default.* non-Latin-1 sont écartées (retombent sur EN) ; échec de fetch ⇒ fallback EN.
export async function initI18n(lang) {
  if (!lang || lang === 'en') { current = EN; activeLang = 'en'; return; }
  try {
    const res = await fetch(`i18n/${lang}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pack = await res.json();
    for (const k of latin1Violations(pack)) {
      console.warn(`[i18n] clé ${k} non-Latin-1 ignorée (fallback EN) — pack ${lang}`);
      delete pack[k];
    }
    current = pack; activeLang = lang;
  } catch (e) {
    console.warn(`[i18n] pack « ${lang} » indisponible, fallback EN`, e);
    current = EN; activeLang = 'en';
  }
}

// Applique les traductions au HTML statique marqué. data-i18n → textContent ; -title → title ;
// -placeholder → placeholder ; -tip → data-tip (l'attribut maison de tooltip) ; -alt → alt ;
// -aria-label → aria-label. Le texte FR du HTML reste un fallback de dernier recours (clé absente).
export function applyStaticI18n(root = document) {
  const map = [
    ['data-i18n', el => { el.textContent = t(el.getAttribute('data-i18n')); }],
    ['data-i18n-title', el => { el.title = t(el.getAttribute('data-i18n-title')); }],
    ['data-i18n-placeholder', el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); }],
    ['data-i18n-tip', el => { el.dataset.tip = t(el.getAttribute('data-i18n-tip')); }],
    ['data-i18n-alt', el => { el.alt = t(el.getAttribute('data-i18n-alt')); }],
    ['data-i18n-aria-label', el => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label'))); }],
  ];
  for (const [attr, apply] of map) {
    for (const el of root.querySelectorAll(`[${attr}]`)) apply(el);
  }
}

// Liste des langues pour le sélecteur Settings : English (intégré, toujours en tête) + le manifeste.
// Manifeste introuvable/illisible ⇒ EN seul (jamais de plantage).
export async function availableLanguages() {
  const builtin = [{ code: 'en', name: 'English' }];
  try {
    const res = await fetch('i18n/index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const packs = await res.json();
    const extra = (Array.isArray(packs) ? packs : []).map(p => ({ code: p.code, name: p.name || p.code }));
    return [...builtin, ...extra];
  } catch (e) {
    console.warn('[i18n] manifeste indisponible, EN seul', e);
    return builtin;
  }
}
```

- [ ] **Step 5 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test tests/i18n.test.js`
Expected: PASS (8 tests).

- [ ] **Step 6 : Vérifier la non-régression globale**

Run: `cd designer && node --test`
Expected: PASS, total = 432 + 8 = **440** tests.

- [ ] **Step 7 : Commit**

```bash
git add designer/i18n/en.js designer/js/i18n.js designer/tests/i18n.test.js
git commit -m "feat(designer): moteur i18n (helpers purs + t/initI18n/applyStaticI18n)

Claude-Session: https://claude.ai/code/session_01Cu2zZNMF4KhBQWdJcKoozh"
```

---

## Task 2 : Manifeste + amorce de pack + câblage du boot

But : brancher l'init i18n au boot d'`app.js` (sans encore extraire de chaîne), poser le manifeste et un `fr.json` amorce, ajouter `lang` au store des réglages. À la fin, le designer boote toujours en français (rien n'est traduit) sans erreur console — l'infra est en place.

**Files:**
- Create: `designer/i18n/index.json`
- Create: `designer/i18n/fr.json`
- Modify: `designer/js/settings.js`
- Modify: `designer/js/app.js:49-50` (début de `main`)

- [ ] **Step 1 : Créer le manifeste**

`designer/i18n/index.json` :
```json
[
  { "code": "fr", "name": "Français", "file": "fr.json" }
]
```

- [ ] **Step 2 : Créer le pack FR amorce** (grossit aux tâches suivantes)

`designer/i18n/fr.json` :
```json
{
  "i18n.language": "Langue"
}
```

- [ ] **Step 3 : Ajouter `lang` au store des réglages**

Dans `designer/js/settings.js` :
- `defaultSettings()` (l.9-13) : ajouter `lang: 'en'` à l'objet retourné.
- `normalizeSettings()` (l.15-29) : ajouter dans l'objet retourné :
```js
    lang: (typeof r.lang === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(r.lang)) ? r.lang : d.lang,
```

- [ ] **Step 4 : Mettre à jour le test de `defaultSettings`**

Dans `designer/tests/settings.test.js`, le test `defaultSettings: valeurs de référence` (l.5-11) : ajouter `lang: 'en',` à l'objet attendu.

- [ ] **Step 5 : Câbler l'init i18n au boot d'`app.js`**

Dans `designer/js/app.js`, ajouter l'import (près de la l.27) :
```js
import { initI18n, applyStaticI18n } from './i18n.js';
```
Puis au tout début de `main()` (juste après `installConsoleCapture();`, l.50) :
```js
  await initI18n(loadSettings().lang);   // langue active avant tout rendu (toasts, vues)
  applyStaticI18n(document);             // traduit le chrome statique marqué (no-op tant que rien n'est marqué)
```

- [ ] **Step 6 : Vérifier les tests**

Run: `cd designer && node --test`
Expected: PASS, **440** tests (le test settings mis à jour reste vert).

- [ ] **Step 7 : Vérification navigateur (boot inchangé)**

Servir le designer en no-store depuis `Dialboard/` et ouvrir `designer/index.html` (cf. mémoire `designer-verif-navigateur`). Attendu : le designer boote **en français** (rien n'est encore traduit), **0 erreur console**, le fetch `i18n/index.json` n'est pas encore déclenché (sélecteur pas posé). `loadSettings().lang` = `'en'` par défaut ⇒ `initI18n('en')` ne fetch rien.

- [ ] **Step 8 : Commit**

```bash
git add designer/i18n/index.json designer/i18n/fr.json designer/js/settings.js designer/tests/settings.test.js designer/js/app.js
git commit -m "feat(designer): manifeste i18n + init au boot + lang dans les réglages

Claude-Session: https://claude.ai/code/session_01Cu2zZNMF4KhBQWdJcKoozh"
```

---

## Task 3 : Extraction du chrome statique (`index.html`)

But : marquer tout le chrome statique d'`index.html` avec des attributs `data-i18n*`, ajouter les clés correspondantes à `en.js` (anglais) et `fr.json` (français actuel verbatim). Le texte FR reste dans le HTML comme fallback.

**Files:**
- Modify: `designer/index.html`
- Modify: `designer/i18n/en.js`
- Modify: `designer/i18n/fr.json`

- [ ] **Step 1 : Marquer `index.html`**

Appliquer ces attributs (ajoutés aux balises existantes, sans retirer le texte/valeur FR qui sert de fallback). Mapping complet :

| Élément (sélecteur) | Attribut(s) à ajouter | Clé |
|---|---|---|
| `<title>` (l.6) | — (traité en JS, cf. Step 4) | `title.app` |
| `#export` (l.23) | `data-i18n-tip` / `data-i18n-title` | `toolbar.export.tip` / `toolbar.export.title` |
| `#import` (l.24) | `data-i18n-tip` / `data-i18n-title` | `toolbar.import.tip` / `toolbar.import.title` |
| `#undo` (l.29) | `data-i18n-tip` / `data-i18n-title` | `toolbar.undo.tip` / `toolbar.undo.title` |
| `#redo` (l.30) | `data-i18n-tip` / `data-i18n-title` | `toolbar.redo.tip` / `toolbar.redo.title` |
| `#load` (l.34) | `data-i18n-tip` / `data-i18n-title` | `toolbar.load.tip` / `toolbar.load.title` |
| `#push` (l.35) | `data-i18n-tip` / `data-i18n-title` | `toolbar.push.tip` / `toolbar.push.title` |
| `#values` (l.36) | `data-i18n-tip` / `data-i18n-title` | `toolbar.values.tip` / `toolbar.values.title` |
| `#statusbtn` (l.37) | `data-i18n-tip` / `data-i18n-title` | `toolbar.status.tip` / `toolbar.status.title` |
| `#capture` (l.38) | `data-i18n-tip` / `data-i18n-title` | `toolbar.capture.tip` / `toolbar.capture.title` |
| `#drawer-toggle` (l.42) | `data-i18n-tip` / `data-i18n-title` | `toolbar.device.tip` / `toolbar.device.title` |
| `#settings-toggle` (l.46) | `data-i18n-tip` / `data-i18n-title` | `toolbar.settings.tip` / `toolbar.settings.title` |
| `label[for=base]` (l.51) | `data-i18n` | `toolbar.device_url.label` |
| `#base` (l.52) | `data-i18n-placeholder` | `toolbar.device_url.ph` |
| `#dev-pill` (l.54) | `data-i18n` / `data-i18n-title` | `pill.untested` / `pill.untested.title` *(le textContent reste affiché tant qu'aucune URL device n'est connue → à traduire aussi)* |
| `#layers > h2` (l.58) | `data-i18n` | `panel.layers` |
| `#canvas-col > h2` (l.60) | `data-i18n` | `panel.canvas` |
| `#inspector > h2` (l.73) | `data-i18n` | `panel.inspector` |
| `.drawer-panel[aria-label=Device]` (l.84) | `data-i18n-aria-label` | `drawer.device.aria` |
| drawer Device `h2` (l.86) | `data-i18n` | `drawer.device.title` |
| `.drawer-close` (l.87, l.107) | `data-i18n-title` | `drawer.close` |
| `.drawer-tab[data-tab=device]` (l.90) | `data-i18n` | `drawer.tab.outputs` |
| `.drawer-tab[data-tab=sources]` (l.91) | `data-i18n` | `drawer.tab.sources` |
| `.drawer-panel[aria-label=Réglages]` (l.104) | `data-i18n-aria-label` | `drawer.settings.aria` |
| drawer Réglages `h2` (l.106) | `data-i18n` | `drawer.settings.title` |
| `#shot` (l.117) | `data-i18n-alt` | `shot.alt` |
| `#shot-prev` (l.119) | `data-i18n-title` | `shot.prev` |
| `#shot-next` (l.121) | `data-i18n-title` | `shot.next` |
| `#shot-close` (l.122) | `data-i18n` | `shot.close` |

Exemple concret (bouton `#export`, l.23) — avant :
```html
<button id="export" class="tb-btn" data-tip="Exporter JSON" title="Enregistre le layout dans un fichier .json local">
```
après :
```html
<button id="export" class="tb-btn" data-i18n-tip="toolbar.export.tip" data-i18n-title="toolbar.export.title" data-tip="Exporter JSON" title="Enregistre le layout dans un fichier .json local">
```

- [ ] **Step 2 : Ajouter les clés EN à `en.js`**

Ajouter à l'objet exporté de `designer/i18n/en.js` :
```js
  'title.app': 'Dialboard — Designer',
  'toolbar.export.tip': 'Export JSON',
  'toolbar.export.title': 'Save the layout to a local .json file',
  'toolbar.import.tip': 'Import JSON',
  'toolbar.import.title': 'Load a layout from a local .json file',
  'toolbar.undo.tip': 'Undo (Ctrl+Z)',
  'toolbar.undo.title': 'Undo (Ctrl+Z)',
  'toolbar.redo.tip': 'Redo',
  'toolbar.redo.title': 'Redo',
  'toolbar.load.tip': 'Load (GET /layout)',
  'toolbar.load.title': "Read the device's current layout (GET /layout)",
  'toolbar.push.tip': 'Push (POST /layout)',
  'toolbar.push.title': "Write the layout to the device's persistent memory (POST /layout)",
  'toolbar.values.tip': 'Test values (POST /update)',
  'toolbar.values.title': 'Push preview (mock) values to the device via POST /update',
  'toolbar.status.tip': 'Status (GET /status)',
  'toolbar.status.title': 'Read GET /status (device health + sources state)',
  'toolbar.capture.tip': 'Screenshot (GET /screenshot)',
  'toolbar.capture.title': "Capture the device's screen (GET /screenshot)",
  'toolbar.device.tip': 'Device (physical outputs / sources)',
  'toolbar.device.title': 'I/O plumbing: physical outputs (led_ring/sound) + pull sources',
  'toolbar.settings.tip': 'Settings',
  'toolbar.settings.title': 'Designer settings (transparency, grid, snap…)',
  'toolbar.device_url.label': 'Device',
  'toolbar.device_url.ph': 'http://192.168.1.35',
  'pill.untested': '○ unchecked',
  'pill.untested.title': 'No device request made yet',
  'panel.layers': 'Layers',
  'panel.canvas': 'Canvas',
  'panel.inspector': 'Inspector',
  'drawer.device.aria': 'Device',
  'drawer.device.title': 'Device',
  'drawer.close': 'Close',
  'drawer.tab.outputs': 'Physical outputs',
  'drawer.tab.sources': 'Pull sources',
  'drawer.settings.aria': 'Settings',
  'drawer.settings.title': 'Settings',
  'shot.alt': 'Device screenshot',
  'shot.prev': 'Previous page on the device',
  'shot.next': 'Next page on the device',
  'shot.close': 'Close',
```

- [ ] **Step 3 : Ajouter les clés FR à `fr.json`** (texte FR verbatim de l'`index.html` actuel)

Ajouter à `designer/i18n/fr.json` :
```json
  "title.app": "Dialboard — Designer",
  "toolbar.export.tip": "Exporter JSON",
  "toolbar.export.title": "Enregistre le layout dans un fichier .json local",
  "toolbar.import.tip": "Importer JSON",
  "toolbar.import.title": "Charge un layout depuis un fichier .json local",
  "toolbar.undo.tip": "Annuler (Ctrl+Z)",
  "toolbar.undo.title": "Annuler (Ctrl+Z)",
  "toolbar.redo.tip": "Rétablir",
  "toolbar.redo.title": "Rétablir",
  "toolbar.load.tip": "Charger (GET /layout)",
  "toolbar.load.title": "Lit le layout actuel du device (GET /layout)",
  "toolbar.push.tip": "Pousser (POST /layout)",
  "toolbar.push.title": "Écrit le layout dans la mémoire persistante du device (POST /layout)",
  "toolbar.values.tip": "Valeurs test (POST /update)",
  "toolbar.values.title": "Pousse les valeurs d'aperçu (mocks) au device via POST /update",
  "toolbar.status.tip": "Statut (GET /status)",
  "toolbar.status.title": "Lit GET /status (santé device + état des sources)",
  "toolbar.capture.tip": "Capture écran (GET /screenshot)",
  "toolbar.capture.title": "Capture l'écran du device (GET /screenshot)",
  "toolbar.device.tip": "Device (sorties physiques / sources)",
  "toolbar.device.title": "Plomberie I/O : sorties physiques (led_ring/sound) + sources pull",
  "toolbar.settings.tip": "Réglages",
  "toolbar.settings.title": "Réglages du designer (transparence, grille, snap…)",
  "toolbar.device_url.label": "Device",
  "toolbar.device_url.ph": "http://192.168.1.35",
  "pill.untested": "○ non vérifié",
  "pill.untested.title": "Aucune requête device effectuée",
  "panel.layers": "Calques",
  "panel.canvas": "Canvas",
  "panel.inspector": "Inspecteur",
  "drawer.device.aria": "Device",
  "drawer.device.title": "Device",
  "drawer.close": "Fermer",
  "drawer.tab.outputs": "Sorties physiques",
  "drawer.tab.sources": "Sources pull",
  "drawer.settings.aria": "Réglages",
  "drawer.settings.title": "Réglages",
  "shot.alt": "Capture écran du device",
  "shot.prev": "Page précédente sur le device",
  "shot.next": "Page suivante sur le device",
  "shot.close": "Fermer"
```
*(Attention JSON : virgules entre entrées, pas de virgule finale ; insérer après l'amorce `"i18n.language"` en ajoutant la virgule requise.)*

- [ ] **Step 4 : Traduire le `<title>` en JS** (un `<title>` ne se marque pas en data-i18n proprement)

Dans `designer/js/app.js`, juste après `applyStaticI18n(document);` (ajouté en Task 2) :
```js
  document.title = t('title.app');
```
Et ajouter `t` à l'import : `import { initI18n, applyStaticI18n, t } from './i18n.js';`

- [ ] **Step 5 : Vérification navigateur (EN par défaut)**

Boot no-store, `loadSettings().lang === 'en'`. Attendu : le chrome statique s'affiche **en anglais** (Layers / Canvas / Inspector, tooltips EN), titre d'onglet « Dialboard — Designer », **0 erreur console**. Forcer FR temporairement (`localStorage` `rt-designer-settings` → `{"lang":"fr"}` puis reload) : le chrome repasse en **français** identique à l'actuel (le fetch `i18n/fr.json` réussit). Remettre `lang:'en'`.

- [ ] **Step 6 : Vérifier les tests**

Run: `cd designer && node --test`
Expected: PASS, **440** tests (aucun test touché).

- [ ] **Step 7 : Commit**

```bash
git add designer/index.html designer/i18n/en.js designer/i18n/fr.json designer/js/app.js
git commit -m "feat(designer): i18n du chrome statique (index.html) — EN + pack FR

Claude-Session: https://claude.ai/code/session_01Cu2zZNMF4KhBQWdJcKoozh"
```

---

## Task 4 : Extraction des toasts/statut (`app.js` + `statusbar.js`)

But : remplacer les littéraux UI-facing d'`app.js` (toasts, journal d'activité, pastille device) et de `statusbar.js` par des appels `t()` (avec interpolation), et ajouter les clés EN/FR. Les fragments dynamiques (`e.message`, ids, nombres) restent concaténés/interpolés.

**Files:**
- Modify: `designer/js/app.js`
- Modify: `designer/js/statusbar.js`
- Modify: `designer/i18n/en.js`
- Modify: `designer/i18n/fr.json`

- [ ] **Step 1 : Remplacer les littéraux d'`app.js`**

Appliquer ces remplacements (gauche = littéral actuel → droite = appel `t()`). Lignes indicatives.

| Actuel | Remplacement |
|---|---|
| `'Erreur init schema : ' + e.message` (l.58) | `t('toast.schema_error', { msg: e.message })` |
| `'URL device ?'` (l.121, 401, 423, 454, 463, 485) | `t('toast.device_url_q')` |
| `'Affichage…' : 'Masquage…'` (l.123) | `visible ? t('toast.showing') : t('toast.hiding')` |
| `'Affiché sur le device' : 'Caché sur le device'` (l.125) | `visible ? t('toast.shown') : t('toast.hidden')` |
| `'Composant collé : ' + clipboard.compDef.type` (l.156) | `t('activity.comp_pasted', { type: clipboard.compDef.type })` |
| `'Composant dupliqué'` (l.163) | `t('activity.comp_duplicated')` |
| `'Composant supprimé'` (l.170) | `t('activity.comp_removed')` |
| `'Bundle ouvert : ' + baseName(r.path)` (l.214) | `t('activity.bundle_opened', { name: baseName(r.path) })` |
| `'Bundle enregistré : ' + baseName(r.path)` (l.222) | `t('activity.bundle_saved', { name: baseName(r.path) })` |
| `'Fichier : ' + e.message` (l.225) | `t('toast.file_error', { msg: e.message })` |
| `'Nouveau layout'` (l.243) | `t('activity.new_layout')` |
| `'Opération device en cours…'` (l.359) | `t('toast.device_busy')` |
| `'Terminé'` (l.364) | `t('toast.done')` |
| `'Opération device'` (l.365) | `t('activity.device_op')` |
| `' (réseau/CORS ? cf. README)'` (l.369) | `t('toast.network_hint')` |
| `'Échec : ' + e.message + hint` (l.370) | `t('toast.failure', { msg: e.message }) + hint` |
| `'Échec device : ' + e.message` (l.371) | `t('activity.device_failure', { msg: e.message })` |
| `'Chargement…'` (l.381) | `t('toast.loading')` |
| `'Chargé'` (l.398) | `t('toast.loaded')` |
| `'Confirmer le chargement ?'` (l.400) | `t('confirm.load')` |
| `'Envoi…'` (l.406) | `t('toast.sending')` |
| `'Poussé et persisté'` (l.420) | `t('toast.pushed')` |
| `'Confirmer le push ?'` (l.422) | `t('confirm.push')` |
| `'Layout invalide'` (l.424) | `t('toast.layout_invalid')` |
| `'Statut…'` (l.455) | `t('toast.status')` |
| `'Statut OK'` (l.458) | `t('toast.status_ok')` |
| `'Aucune valeur de test à pousser'` (l.465) | `t('toast.no_test_values')` |
| `'Valeurs…'` (l.466) | `t('toast.values')` |
| `` `Valeurs poussées (${r.updated ?? '?'})` `` (l.468) | `t('toast.values_pushed', { n: r.updated ?? '?' })` |
| `'Capture…'` (l.486) | `t('toast.capturing')` |
| `'Capturé'` (l.488, 499) | `t('toast.captured')` |
| `'Navigation…'` (l.494) | `t('toast.navigating')` |
| `'Annuler'` (l.253) | `t('activity.undo')` |
| `'Rétablir'` (l.254) | `t('activity.redo')` |
| `'● ' + devHost()` + tooltip (l.441) | `'● ' + devHost()` (inchangé) ; tooltip → `t('pill.reachable.tip')` |
| `'○ injoignable'` (l.442) | `t('pill.unreachable')` |
| `` `page ${(+s.page) + 1}/${s.pages}` `` (l.480) | `t('shot.page', { cur: (+s.page) + 1, total: s.pages })` |

Note pastille (l.441) : `setDevicePill('ok', '● ' + devHost(), 'Device joignable — « Statut » pour le détail')` → le 3ᵉ argument devient `t('pill.reachable.tip')`.

- [ ] **Step 2 : Remplacer les littéraux de `statusbar.js`**

| Actuel | Remplacement |
|---|---|
| `` `✗ ${errors.length} erreur${errors.length > 1 ? 's' : ''}` `` (l.9) | `t('status.errors', { n: errors.length })` |
| `` `✓ valide · ${warnings.length} avert.` `` (l.10) | `t('status.valid_warn', { n: warnings.length })` |
| `'✓ valide'` (l.11) | `t('status.valid')` |
| `'Rien de sélectionné'` (l.22) | `t('status.nothing')` |
| `plural(pages.length, 'page')` / `plural(total, 'composant')` (l.25-26) | `t('status.doc', { pages: pages.length, comps: total })` |
| `` `Page « ${page.name ?? ''} » (${sel.page + 1}/${pages.length}) · …` `` (l.31) | `t('status.page', { name: page.name ?? '', cur: sel.page + 1, total: pages.length, comps: placements(page) })` |
| `'masqué' : 'visible'` (l.38) | `c && c.visible === false ? t('status.hidden') : t('status.visible')` |
| `` `${typeLabel} · ${pl.ref} · page « ${page.name ?? ''} » · ${pl.anchor ?? 'CENTER'} (${dx}, ${dy}) · ${vis}` `` (l.40) | `t('status.comp', { type: typeLabel, ref: pl.ref, name: page.name ?? '', anchor: pl.anchor ?? 'CENTER', dx, dy, vis })` |

Ajouter l'import en tête de `statusbar.js` : `import { t } from './i18n.js';`
Le helper local `plural` (l.14) devient inutilisé pour ces deux cas (le pluriel passe dans les clés via interpolation simple) ; le laisser s'il sert encore ailleurs, sinon le retirer. *Note pluriel : les chaînes EN/FR ci-dessous figent le pluriel en clair (`pages`/`components`) — acceptable au pilote ; un pluriel exact se traiterait par clés distinctes si besoin (hors-scope).* 

- [ ] **Step 3 : Ajouter les clés EN** (à `en.js`)

```js
  'toast.schema_error': 'Schema init error: {msg}',
  'toast.device_url_q': 'Device URL?',
  'toast.showing': 'Showing…',
  'toast.hiding': 'Hiding…',
  'toast.shown': 'Shown on the device',
  'toast.hidden': 'Hidden on the device',
  'toast.file_error': 'File: {msg}',
  'toast.device_busy': 'Device operation in progress…',
  'toast.done': 'Done',
  'toast.network_hint': ' (network/CORS? see README)',
  'toast.failure': 'Failed: {msg}',
  'toast.loading': 'Loading…',
  'toast.loaded': 'Loaded',
  'toast.sending': 'Sending…',
  'toast.pushed': 'Pushed and persisted',
  'toast.layout_invalid': 'Invalid layout',
  'toast.status': 'Status…',
  'toast.status_ok': 'Status OK',
  'toast.no_test_values': 'No test values to push',
  'toast.values': 'Values…',
  'toast.values_pushed': 'Values pushed ({n})',
  'toast.capturing': 'Capturing…',
  'toast.captured': 'Captured',
  'toast.navigating': 'Navigating…',
  'confirm.load': 'Confirm load?',
  'confirm.push': 'Confirm push?',
  'activity.comp_pasted': 'Component pasted: {type}',
  'activity.comp_duplicated': 'Component duplicated',
  'activity.comp_removed': 'Component removed',
  'activity.bundle_opened': 'Bundle opened: {name}',
  'activity.bundle_saved': 'Bundle saved: {name}',
  'activity.new_layout': 'New layout',
  'activity.device_op': 'Device operation',
  'activity.device_failure': 'Device failure: {msg}',
  'activity.undo': 'Undo',
  'activity.redo': 'Redo',
  'pill.reachable.tip': 'Device reachable — “Status” for details',
  'pill.unreachable': '○ unreachable',
  'shot.page': 'page {cur}/{total}',
  'status.errors': '✗ {n} error(s)',
  'status.valid_warn': '✓ valid · {n} warning(s)',
  'status.valid': '✓ valid',
  'status.nothing': 'Nothing selected',
  'status.doc': '{pages} page(s) · {comps} component(s)',
  'status.page': 'Page « {name} » ({cur}/{total}) · {comps} component(s)',
  'status.hidden': 'hidden',
  'status.visible': 'visible',
  'status.comp': '{type} · {ref} · page « {name} » · {anchor} ({dx}, {dy}) · {vis}',
```

- [ ] **Step 4 : Ajouter les clés FR** (à `fr.json` — texte FR actuel verbatim)

```json
  "toast.schema_error": "Erreur init schema : {msg}",
  "toast.device_url_q": "URL device ?",
  "toast.showing": "Affichage…",
  "toast.hiding": "Masquage…",
  "toast.shown": "Affiché sur le device",
  "toast.hidden": "Caché sur le device",
  "toast.file_error": "Fichier : {msg}",
  "toast.device_busy": "Opération device en cours…",
  "toast.done": "Terminé",
  "toast.network_hint": " (réseau/CORS ? cf. README)",
  "toast.failure": "Échec : {msg}",
  "toast.loading": "Chargement…",
  "toast.loaded": "Chargé",
  "toast.sending": "Envoi…",
  "toast.pushed": "Poussé et persisté",
  "toast.layout_invalid": "Layout invalide",
  "toast.status": "Statut…",
  "toast.status_ok": "Statut OK",
  "toast.no_test_values": "Aucune valeur de test à pousser",
  "toast.values": "Valeurs…",
  "toast.values_pushed": "Valeurs poussées ({n})",
  "toast.capturing": "Capture…",
  "toast.captured": "Capturé",
  "toast.navigating": "Navigation…",
  "confirm.load": "Confirmer le chargement ?",
  "confirm.push": "Confirmer le push ?",
  "activity.comp_pasted": "Composant collé : {type}",
  "activity.comp_duplicated": "Composant dupliqué",
  "activity.comp_removed": "Composant supprimé",
  "activity.bundle_opened": "Bundle ouvert : {name}",
  "activity.bundle_saved": "Bundle enregistré : {name}",
  "activity.new_layout": "Nouveau layout",
  "activity.device_op": "Opération device",
  "activity.device_failure": "Échec device : {msg}",
  "activity.undo": "Annuler",
  "activity.redo": "Rétablir",
  "pill.reachable.tip": "Device joignable — « Statut » pour le détail",
  "pill.unreachable": "○ injoignable",
  "shot.page": "page {cur}/{total}",
  "status.errors": "✗ {n} erreur(s)",
  "status.valid_warn": "✓ valide · {n} avert.",
  "status.valid": "✓ valide",
  "status.nothing": "Rien de sélectionné",
  "status.doc": "{pages} page(s) · {comps} composant(s)",
  "status.page": "Page « {name} » ({cur}/{total}) · {comps} composant(s)",
  "status.hidden": "masqué",
  "status.visible": "visible",
  "status.comp": "{type} · {ref} · page « {name} » · {anchor} ({dx}, {dy}) · {vis}"
```
*(Veiller à la virgule entre la dernière entrée existante et la première ajoutée ; pas de virgule après la toute dernière.)*

- [ ] **Step 5 : Vérifier les tests**

Run: `cd designer && node --test`
Expected: PASS, **440** tests. (statusbar.test.js teste les fonctions pures `formatValidationSummary`/`formatSelectionContext` ; comme elles appellent désormais `t()` qui, en contexte test, retombe sur EN, **mettre à jour les chaînes attendues de `statusbar.test.js` vers les libellés EN interpolés** — ex. `✓ valide` → `✓ valid`, `Rien de sélectionné` → `Nothing selected`, etc. Adapter chaque assertion au rendu EN.)

- [ ] **Step 6 : Vérification navigateur (EN + bascule FR)**

Boot EN : toasts/barre d'état en anglais (déclencher une action : Statut sans URL → « Device URL? » ; sélection d'un composant → barre `… · … · page « … » …` en EN). Forcer FR (localStorage) + reload : tout repasse en français identique à l'actuel. **0 erreur console.**

- [ ] **Step 7 : Commit**

```bash
git add designer/js/app.js designer/js/statusbar.js designer/tests/statusbar.test.js designer/i18n/en.js designer/i18n/fr.json
git commit -m "feat(designer): i18n des toasts/statut (app.js + statusbar.js)

Claude-Session: https://claude.ai/code/session_01Cu2zZNMF4KhBQWdJcKoozh"
```

---

## Task 5 : Sélecteur de langue (Settings) + bascule par reload

But : ajouter un `<select>` de langue dans le tiroir Settings, alimenté par `availableLanguages()` ; le changement persiste la langue et recharge la page. Traduire aussi les libellés statiques de Settings restants (thème/grille/…) reste hors pilote (lot inspecteur/registry) **sauf** le libellé du sélecteur lui-même (`i18n.language`, déjà au catalogue).

**Files:**
- Modify: `designer/js/settings.js`
- Modify: `designer/js/app.js`

- [ ] **Step 1 : Passer la liste des langues + le callback à `createSettings`**

Dans `designer/js/app.js`, avant `const settings = createSettings(...)` (l.236), charger les langues :
```js
  const languages = await availableLanguages();   // [{code,name}] — English en tête + manifeste
```
Ajouter `availableLanguages` à l'import i18n : `import { initI18n, applyStaticI18n, t, availableLanguages, currentLang } from './i18n.js';`
Puis dans l'objet d'options de `createSettings` (l.236-245), ajouter :
```js
    languages,
    currentLang: currentLang(),
    onLanguageChange: (code) => { setSettings({ lang: code }); location.reload(); },
```

- [ ] **Step 2 : Construire le sélecteur dans `settings.js`**

Dans `createSettings(root, { … })` (l.64), étendre la déstructuration des options avec `languages = [], currentLang = 'en', onLanguageChange`. Dans `build()` (après le bloc Thème, vers l.90), insérer :
```js
    // Langue de l'interface (anglais intégré + packs du manifeste). Le changement recharge la page.
    if (languages.length > 1 && onLanguageChange) {
      const langRow = settingRow(t('i18n.language'));
      const langSel = document.createElement('select');
      for (const { code, name } of languages) {
        const o = document.createElement('option'); o.value = code; o.textContent = name;
        if (code === currentLang) o.selected = true; langSel.appendChild(o);
      }
      langSel.onchange = () => onLanguageChange(langSel.value);
      langRow.querySelector('.set-line').appendChild(langSel);
      pane.appendChild(langRow);
    }
```
Ajouter l'import `t` en tête de `settings.js` : `import { t } from './i18n.js';`

- [ ] **Step 3 : Vérifier les tests**

Run: `cd designer && node --test`
Expected: PASS, **440** tests (settings.js n'a pas de test DOM ; les fonctions pures `defaultSettings`/`normalizeSettings` couvrent déjà `lang`).

- [ ] **Step 4 : Vérification navigateur (la bascule de langue fonctionne)**

Boot EN. Ouvrir Settings → un sélecteur **Language** liste **English / Français**, EN sélectionné. Choisir **Français** → la page **se recharge** en français (chrome + toasts). Rouvrir Settings → « Langue » avec Français sélectionné. Rebasculer **English** → reload en anglais. La langue **persiste** après un reload manuel (localStorage `rt-designer-settings`). **0 erreur console.**

- [ ] **Step 5 : Commit**

```bash
git add designer/js/settings.js designer/js/app.js
git commit -m "feat(designer): sélecteur de langue dans les réglages + bascule par reload

Claude-Session: https://claude.ai/code/session_01Cu2zZNMF4KhBQWdJcKoozh"
```

---

## Task 6 : Menus natifs Electron via IPC

But : le renderer pousse les libellés de menu traduits au process principal, qui (re)construit le menu Fichier. Source de catalogue unique (le renderer).

**Files:**
- Modify: `designer/electron/main.js`
- Modify: `designer/electron/preload.js`
- Modify: `designer/js/app.js`
- Modify: `designer/i18n/en.js`
- Modify: `designer/i18n/fr.json`

- [ ] **Step 1 : `main.js` — extraire `buildMenu(labels)` + IPC**

Dans `designer/electron/main.js`, remplacer le bloc menu (l.105-120) par une fonction réutilisable avec labels EN par défaut :
```js
  // Menu natif : raccourcis fichier → relayés au renderer (qui détient model + caches).
  const send = (action) => () => win.webContents.send('menu', action);
  const DEFAULT_MENU = { file: 'File', open: 'Open…', save: 'Save', saveAs: 'Save As…' };
  const buildMenu = (labels) => {
    const L = { ...DEFAULT_MENU, ...(labels || {}) };
    const fileMenu = {
      label: L.file,
      submenu: [
        { label: L.open, accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: L.save, accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: L.saveAs, accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    };
    const template = process.platform === 'darwin'
      ? [{ role: 'appMenu' }, fileMenu, { role: 'editMenu' }, { role: 'viewMenu' }]
      : [fileMenu, { role: 'editMenu' }, { role: 'viewMenu' }];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };
  buildMenu();   // menu initial (EN) ; le renderer le réémet dans la langue active au boot
  ipcMain.handle('menu:setLabels', (_e, labels) => buildMenu(labels));
```

- [ ] **Step 2 : `preload.js` — exposer `setMenuLabels`**

Dans `designer/electron/preload.js`, ajouter au pont `desktop` (l.7-13) :
```js
  setMenuLabels: (labels) => ipcRenderer.invoke('menu:setLabels', labels),
```

- [ ] **Step 3 : `app.js` — pousser les labels traduits au boot**

Dans le bloc `if (window.desktop) {` (l.200), juste après `refreshTitle();` (l.204), ajouter :
```js
    window.desktop.setMenuLabels({
      file: t('menu.file'), open: t('menu.open'), save: t('menu.save'), saveAs: t('menu.save_as'),
    });
```

- [ ] **Step 4 : Ajouter les clés EN/FR**

`en.js` :
```js
  'menu.file': 'File',
  'menu.open': 'Open…',
  'menu.save': 'Save',
  'menu.save_as': 'Save As…',
```
`fr.json` :
```json
  "menu.file": "Fichier",
  "menu.open": "Ouvrir…",
  "menu.save": "Enregistrer",
  "menu.save_as": "Enregistrer sous…"
```

- [ ] **Step 5 : Vérifier les tests**

Run: `cd designer && node --test`
Expected: PASS, **440** tests (l'IPC Electron n'a pas de test node ; le transport est vérifié dans l'app).

- [ ] **Step 6 : Vérification Electron (manuelle)**

```bash
cd designer/electron && npm start
```
Attendu (langue active = EN par défaut) : menu **File › Open… / Save / Save As…**. Basculer FR dans Settings → reload → menu **Fichier › Ouvrir… / Enregistrer / Enregistrer sous…**. Les raccourcis Cmd+O/S/Shift+S fonctionnent toujours. **0 erreur console (renderer + main).**

- [ ] **Step 7 : Commit**

```bash
git add designer/electron/main.js designer/electron/preload.js designer/js/app.js designer/i18n/en.js designer/i18n/fr.json
git commit -m "feat(designer): i18n des menus natifs Electron (IPC renderer→main)

Claude-Session: https://claude.ai/code/session_01Cu2zZNMF4KhBQWdJcKoozh"
```

---

## Task 7 : Staging device + vérification finale

But : stager `designer/i18n/` pour l'image LittleFS du device, et clôturer le pilote (tests verts, parité firmware, récap).

**Files:**
- Modify: `tools/stage_fs.sh`

- [ ] **Step 1 : Stager `designer/i18n/`**

Dans `tools/stage_fs.sh`, après `mkdir -p data/designer/js data/designer/vendor data/schema` (l.15), ajouter `data/designer/i18n` à la création :
```bash
mkdir -p data/designer/js data/designer/vendor data/designer/i18n data/schema
```
Et après `cp -R designer/vendor/.        data/designer/vendor/` (l.20), ajouter :
```bash
cp -R designer/i18n/.         data/designer/i18n/
```

- [ ] **Step 2 : Vérifier le staging**

Run: `bash tools/stage_fs.sh && ls data/designer/i18n/`
Expected: `en.js  fr.json  index.json` présents dans `data/designer/i18n/`.

- [ ] **Step 3 : Nettoyer le staging** (artefacts gitignorés régénérables)

Run: `rm -rf data/designer data/schema`
*(le staging réel se refait avant un `uploadfs` ; on ne committe pas `data/designer`.)*

- [ ] **Step 4 : Vérification de la complétude EN↔FR** (filet anti-oubli d'extraction)

Run (depuis `designer/`) :
```bash
node -e "import('./i18n/en.js').then(m=>{const en=Object.keys(m.default);const fr=require('./i18n/fr.json');const missing=en.filter(k=>!(k in fr));const extra=Object.keys(fr).filter(k=>!en.includes(k));console.log('EN keys:',en.length,'| FR missing:',missing,'| FR extra:',extra);})"
```
Expected: `FR missing: []` et `FR extra: []` (parité de clés EN/FR sur le pilote).

- [ ] **Step 5 : Garde-parité firmware/schéma**

Run: `git diff --name-only main -- src lib schema designer/js/render.js`
Expected: **vide** (WS-1 = 100 % designer ; firmware/schéma/parité intacts).

- [ ] **Step 6 : Suite complète verte**

Run: `cd designer && node --test`
Expected: PASS, **440** tests.

- [ ] **Step 7 : Commit**

```bash
git add tools/stage_fs.sh
git commit -m "build(designer): stage designer/i18n/ pour l'image LittleFS du device

Claude-Session: https://claude.ai/code/session_01Cu2zZNMF4KhBQWdJcKoozh"
```

- [ ] **Step 8 : (manuel, optionnel) Vérif device**

Après `bash tools/stage_fs.sh && pio run -e esp32s3 -t uploadfs` (⚠️ `uploadfs` efface les assets device — sauvegarder avant, cf. mémoire `uploadfs-efface-assets-device`), ouvrir `http://<ip>/designer/` : EN par défaut ; bascule FR → reload → `i18n/fr.json` servi par le device → chrome FR. Confirmer parité (pas de tofu).

---

## Notes & limites du pilote (consignées)

- **`preload.js` (picker mDNS)** : ses chaînes (`Devices détectés (mDNS)`, `Re-scanner…`, `N devices…`) vivent dans le preload CommonJS, sans accès au catalogue ES du renderer → **hors pilote**, traitées dans un lot ultérieur (mécanisme dédié : labels poussés au preload, ou catalogue minimal CommonJS).
- **Pluriels** : figés en clair dans les chaînes (`page(s)`, `error(s)`) au pilote. Un pluriel exact (FR/EN divergents) se traiterait par clés distinctes — hors-scope.
- **Settings (thème, grille, journaux…)** : libellés statiques non extraits au pilote (seul le sélecteur de langue l'est) → lot suivant avec inspecteur/registry.
- **Lots suivants** (même mécanique) : `registry.js` (~200), `humanize.js`/`validate.js` (~60) — dont le peuplement réel du namespace **`default.*`** (contenu par défaut localisé, mappé depuis `defaults()` du registre, validé Latin-1), `inspector.js` (~30), `sources.js`/`device-panel.js`/`console.js`/`tree.js`/`carousel.js` (~50).

## Self-review (rappel pour l'exécutant)

- Compteur de tests attendu après chaque tâche : **440** (432 existants + 8 du moteur). Si un test casse à la Task 4, c'est `statusbar.test.js` (chaînes EN) — adapter les attentes, ne pas contourner.
- Toute clé référencée par un `t()` DOIT exister dans `en.js` (sinon fallback clé brute visible) — la Task 7 Step 4 le vérifie.
- Convention de commit : finir chaque message par la ligne `Claude-Session:` (cf. exemples ci-dessus). Push **sur demande explicite uniquement**.
