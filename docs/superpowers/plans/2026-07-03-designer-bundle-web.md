# Export/Import `.dboard` en web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer dans l'UI web du designer l'export/import du bundle `.dboard` (layout + images), en réutilisant le code déjà écrit et testé (`bundle.js`).

**Architecture:** Nouveau module `bundle-io.js`, miroir de `file-io.js`, câblé dans `app.js` à côté de `bindFileIO`. Un helper pur `missingKeys` (dans `bundle.js`, testé node) détecte les octets référencés absents du cache pour avertir avant l'export. Deux nouveaux boutons dans la toolbar + clés i18n + une classe CSS `.toast-warn`.

**Tech Stack:** JS modules ES (navigateur, servis directement — pas de bundler), `node --test` pour la logique pure, LVGL côté firmware (hors scope ici).

Spec de référence : `docs/superpowers/specs/2026-07-03-designer-bundle-web-design.md`.

---

## File Structure

| Fichier | Responsabilité | Nature |
|---|---|---|
| `designer/js/bundle.js` | + `missingKeys(state, assets)` : clés référencées absentes des assets, par type (pur) | Modifier |
| `designer/tests/bundle.test.js` | + tests node de `missingKeys` | Modifier |
| `designer/js/bundle-io.js` | `bindBundleIO(...)` : câblage download/upload `.dboard` (DOM) | **Créer** |
| `designer/index.html` | + 2 boutons + 1 input dans le groupe « Fichier local » | Modifier |
| `designer/js/app.js` | + import et appel `bindBundleIO(...)` près de `bindFileIO` | Modifier |
| `designer/i18n/en.js` | + clés toolbar/activity/toast (source de vérité) | Modifier |
| `designer/i18n/fr.json` | + mêmes clés en français | Modifier |
| `designer/style.css` | + `.toast-warn` (miroir de `.toast-ok`/`.toast-err`) | Modifier |

Rappel conventions : `node --test` teste la **logique pure** ; le **rendu/câblage DOM est vérifié au navigateur** (Task 6). Tests designer invoqués **sans argument** : `cd designer && node --test`.

---

## Task 1 : `missingKeys` (logique pure, TDD node)

**Files:**
- Modify: `designer/js/bundle.js`
- Test: `designer/tests/bundle.test.js`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à la fin de `designer/tests/bundle.test.js` (le fichier importe déjà `node:test` et `node:assert/strict`). Modifier la ligne d'import existante et ajouter les tests :

```js
// Remplacer la ligne d'import existante :
import { encodeBundle, decodeBundle, missingKeys } from '../js/bundle.js';

// … (tests existants inchangés) …

const stateMK = {
  pages: [{ background_image: 'bg1' }, { background_image: 'bg2' }],
  components: {
    c1: { type: 'image', src: 'img1' },
    c2: { type: 'image_anim', src: 'anim1' },
  },
};

test('missingKeys : liste par type les clés référencées absentes des assets (intent : avertir avant un bundle partiel)', () => {
  const assets = { bg: { bg1: new Uint8Array([1]) }, image: {}, aimg: { anim1: new Uint8Array([2]) } };
  assert.deepEqual(missingKeys(stateMK, assets), { bg: ['bg2'], image: ['img1'], aimg: [] });
});

test('missingKeys : assets vides → toutes les clés référencées manquent (intent : export sans cache = tout absent)', () => {
  assert.deepEqual(missingKeys(stateMK, {}), { bg: ['bg1', 'bg2'], image: ['img1'], aimg: ['anim1'] });
});

test('missingKeys : tout en cache → aucun manquant (intent : bundle complet = pas d\'avertissement)', () => {
  const full = { bg: { bg1: 1, bg2: 1 }, image: { img1: 1 }, aimg: { anim1: 1 } };
  assert.deepEqual(missingKeys(stateMK, full), { bg: [], image: [], aimg: [] });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `missingKeys` n'est pas exporté (`SyntaxError` ou `missingKeys is not a function`).

- [ ] **Step 3 : Implémenter `missingKeys`**

Dans `designer/js/bundle.js`, ajouter la fonction juste après `collectAssets` (qui se termine ligne ~59). `referencedKeys` (bg), `referencedImageKeys`, `referencedAimgKeys` sont **déjà importés** en tête de fichier :

```js
// Clés référencées par le layout mais absentes des assets collectés, par type. Pur (comparaison de
// clés) → testable node. Sert à avertir à l'export quand des octets ne sont pas en cache.
export function missingKeys(state, assets = {}) {
  const miss = (keys, have) => keys.filter(k => !have || !(k in have));
  return {
    bg:    miss(referencedKeys(state),      assets.bg),
    image: miss(referencedImageKeys(state), assets.image),
    aimg:  miss(referencedAimgKeys(state),  assets.aimg),
  };
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS (tous les tests, dont les 3 nouveaux `missingKeys`).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/bundle.js designer/tests/bundle.test.js
git commit -m "feat(designer): missingKeys — détecte les octets d'assets absents du cache"
```

---

## Task 2 : i18n + CSS `.toast-warn`

**Files:**
- Modify: `designer/i18n/en.js`
- Modify: `designer/i18n/fr.json`
- Modify: `designer/style.css:544`

- [ ] **Step 1 : Ajouter les clés EN (source de vérité)**

Dans `designer/i18n/en.js`, après `'toolbar.import.title'` (ligne 10) :

```js
  'toolbar.export_bundle.tip': 'Export .dboard',
  'toolbar.export_bundle.title': 'Save the layout and images to a local .dboard file',
  'toolbar.import_bundle.tip': 'Import .dboard',
  'toolbar.import_bundle.title': 'Load a layout and images from a local .dboard file',
```

Puis, près de `'activity.layout_imported'` / `'toast.import_failed'` (lignes ~445-447) :

```js
  'activity.bundle_exported': 'Bundle exported (file)',
  'activity.bundle_imported': 'Bundle imported (file)',
  'toast.bundle_missing_assets': '{n} image(s) not included (missing from cache)',
```

- [ ] **Step 2 : Ajouter les mêmes clés FR**

Dans `designer/i18n/fr.json`, après `"toolbar.import.title"` (ligne 7) :

```json
  "toolbar.export_bundle.tip": "Exporter .dboard",
  "toolbar.export_bundle.title": "Enregistre le layout + images dans un fichier .dboard local",
  "toolbar.import_bundle.tip": "Importer .dboard",
  "toolbar.import_bundle.title": "Charge un layout + images depuis un fichier .dboard local",
```

Puis, près de `"activity.layout_imported"` / `"toast.import_failed"` (lignes ~422-423) :

```json
  "activity.bundle_exported": "Bundle exporté (fichier)",
  "activity.bundle_imported": "Bundle importé (fichier)",
  "toast.bundle_missing_assets": "{n} image(s) non incluse(s) (absente(s) du cache)",
```

Attention à la virgule JSON de la ligne précédente et à ne pas casser le tableau/objet.

- [ ] **Step 3 : Ajouter la classe CSS `.toast-warn`**

Dans `designer/style.css`, juste après `.toast-err` (ligne 544) :

```css
.toast-warn { border-color: var(--warn); color: var(--warn); }
```

- [ ] **Step 4 : Vérifier que rien n'est cassé**

Run: `cd designer && node --test`
Expected: PASS (les catalogues i18n ne sont pas testés en node, mais on s'assure qu'aucun test n'a régressé). Vérifier que `fr.json` reste un JSON valide :
Run: `python3 -c "import json; json.load(open('designer/i18n/fr.json'))"`
Expected: aucune sortie (JSON valide).

- [ ] **Step 5 : Commit**

```bash
git add designer/i18n/en.js designer/i18n/fr.json designer/style.css
git commit -m "feat(designer): i18n + toast-warn pour l'export/import .dboard"
```

---

## Task 3 : Module `bundle-io.js`

**Files:**
- Create: `designer/js/bundle-io.js`

- [ ] **Step 1 : Créer le module**

Créer `designer/js/bundle-io.js` avec exactement :

```js
// Export / import du bundle .dboard (layout + images) en fichier local — pendant WEB du workflow
// Electron (window.desktop.*). Miroir de file-io.js, mais : (1) extension .dboard, (2) collecte les
// assets et AVERTIT sur les octets manquants du cache avant l'export (bundle partiel signalé, jamais
// bloqué). Réutilise encodeBundle/collectAssets/loadBundle/missingKeys de bundle.js. Vérifié au navigateur.
import { encodeBundle, collectAssets, loadBundle, missingKeys } from './bundle.js';
import { showToast } from './toast.js';
import { logs } from './logs.js';
import { t } from './i18n.js';

export function bindBundleIO(model, { exportBtn, importBtn, importInput, onLoad } = {}) {
  exportBtn.addEventListener('click', () => {
    const assets = collectAssets(model);
    const miss = missingKeys(model.state, assets);
    const n = miss.bg.length + miss.image.length + miss.aimg.length;
    if (n) showToast(t('toast.bundle_missing_assets', { n }), { kind: 'warn' });   // fail-loud, non bloquant
    const blob = new Blob([encodeBundle(model.toJSON(), assets)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'layout.dboard';
    a.click();
    URL.revokeObjectURL(url);
    logs.logActivity(t('activity.bundle_exported'));
  });

  importBtn.addEventListener('click', () => importInput.click());

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      loadBundle(model, text);            // throw si bundle invalide (bundle.invalid)
      onLoad && onLoad();
      logs.logActivity(t('activity.bundle_imported'));
    } catch (e) {
      showToast(t('toast.import_failed', { msg: e.message }), { kind: 'err' });
    } finally {
      importInput.value = '';             // réautorise la réimportation du même fichier
    }
  });
}
```

- [ ] **Step 2 : Vérifier que node ne régresse pas**

Run: `cd designer && node --test`
Expected: PASS (aucun test n'importe `bundle-io.js` ; ce step confirme juste l'absence de régression). Le câblage DOM sera vérifié en Task 6.

- [ ] **Step 3 : Commit**

```bash
git add designer/js/bundle-io.js
git commit -m "feat(designer): bundle-io.js — export/import .dboard web (miroir de file-io)"
```

---

## Task 4 : Boutons UI + câblage `app.js`

**Files:**
- Modify: `designer/index.html:22-26`
- Modify: `designer/js/app.js:17` (import) et `designer/js/app.js:200-203` (appel)

- [ ] **Step 1 : Ajouter les boutons dans la toolbar**

Dans `designer/index.html`, le groupe « Fichier local » est actuellement :

```html
    <!-- Fichier local -->
    <div class="tb-group">
      <button id="export" ...>...</button>
      <button id="import" ...>...</button>
      <input id="import-file" type="file" accept="application/json,.json" hidden />
    </div>
```

Insérer les deux boutons + l'input juste **avant** `<input id="import-file"` (donc après le bouton `#import`) :

```html
      <button id="export-bundle" class="tb-btn" data-i18n-tip="toolbar.export_bundle.tip" data-i18n-title="toolbar.export_bundle.title" data-tip="Exporter .dboard" title="Enregistre le layout + images dans un fichier .dboard local"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="11" height="8" rx="1"/><path d="M2.5 5.5L8 2.5l5.5 3"/><path d="M8 7.4v4.2M6.4 10L8 11.6 9.6 10"/></svg></button>
      <button id="import-bundle" class="tb-btn" data-i18n-tip="toolbar.import_bundle.tip" data-i18n-title="toolbar.import_bundle.title" data-tip="Importer .dboard" title="Charge un layout + images depuis un fichier .dboard local"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="11" height="8" rx="1"/><path d="M2.5 5.5L8 2.5l5.5 3"/><path d="M8 11.6V7.4M6.4 9 8 7.4 9.6 9"/></svg></button>
      <input id="import-bundle-file" type="file" accept=".dboard,application/json" hidden />
```

- [ ] **Step 2 : Importer `bindBundleIO` dans `app.js`**

Dans `designer/js/app.js`, après la ligne 17 (`import { bindFileIO } from './file-io.js';`) :

```js
import { bindBundleIO } from './bundle-io.js';
```

- [ ] **Step 3 : Câbler `bindBundleIO` après `bindFileIO`**

Dans `designer/js/app.js`, l'appel existant est (lignes 200-203) :

```js
  bindFileIO(model, {
    exportBtn: $('export'), importBtn: $('import'), importInput: $('import-file'),
    onLoad,
  });
```

Ajouter juste après :

```js
  bindBundleIO(model, {
    exportBtn: $('export-bundle'), importBtn: $('import-bundle'), importInput: $('import-bundle-file'),
    onLoad,
  });
```

- [ ] **Step 4 : Vérifier que node ne régresse pas**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add designer/index.html designer/js/app.js
git commit -m "feat(designer): boutons Export/Import .dboard + câblage app.js"
```

---

## Task 5 : Vérification navigateur (browser-verified)

**Files:** aucun changement attendu (sauf correctifs si bug).

Servir le designer en **no-store** (cache des modules ES) sur un port **autre que 8000** (réservé), et **arrêter le serveur** à la fin (cf. hygiène serveur de test). Piloter avec de **vrais events pointer** (pas `.click()` synthétique) pour les vérifs manuelles.

- [ ] **Step 1 : Lancer un serveur local no-store**

```bash
cd designer && python3 - <<'PY'
import http.server
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
http.server.test(HandlerClass=H, port=8765)
PY
```

(ou tout serveur équivalent envoyant `Cache-Control: no-store` sur le port 8765). Ouvrir `http://localhost:8765/`.

- [ ] **Step 2 : Round-trip export → import**

1. Placer un composant **image** sur une page et lui affecter une image (via l'inspecteur) → aperçu visible.
2. Cliquer **Export .dboard** → un fichier `layout.dboard` est téléchargé, et le journal d'activité affiche « Bundle exporté (fichier) ». Aucun toast d'avertissement (l'image est en cache).
3. Recharger la page (les caches d'octets se vident), puis cliquer **Import .dboard** et choisir le fichier téléchargé.
4. Attendu : le layout ET l'aperçu de l'image reviennent (les octets sont ré-hydratés depuis le bundle), journal « Bundle importé (fichier) ».

- [ ] **Step 3 : Avertissement octets manquants**

1. Recharger la page (caches vides). Importer un **`layout.json` nu** (bouton Import JSON existant) qui référence une image — les clés existent mais aucun octet n'est en cache.
2. Cliquer **Export .dboard**.
3. Attendu : un **toast d'avertissement** (classe `toast-warn`, ambre) « N image(s) non incluse(s) (absente(s) du cache) », et le fichier `.dboard` est **quand même** téléchargé.

- [ ] **Step 4 : Import d'un fichier invalide**

1. Importer via **Import .dboard** un fichier texte non-bundle (p. ex. un `.txt` quelconque).
2. Attendu : toast d'erreur « Import échoué : … » (classe `toast-err`), pas de crash, l'input se réarme (réimport possible).

- [ ] **Step 5 : Arrêter le serveur de test**

Terminer le processus du serveur local (Ctrl-C / kill). Ne rien laisser tourner.

- [ ] **Step 6 : Si un bug est trouvé** — le corriger dans le module concerné, relancer `cd designer && node --test`, refaire la vérif, puis commit :

```bash
git add -A
git commit -m "fix(designer): <correctif issu de la vérif navigateur .dboard>"
```

---

## Self-Review (rempli à la rédaction)

- **Couverture du spec** : UI (Task 4) ✔ ; `bundle-io.js` (Task 3) ✔ ; `missingKeys` pur+testé (Task 1) ✔ ; i18n (Task 2) ✔ ; avertissement octets manquants Q2 (Task 3 + vérif Task 5.3) ✔ ; import→push inchangé, hors code (noté, rien à faire) ✔ ; compat Electron (même format, vérif optionnelle Task 5) ✔.
- **CSS `.toast-warn`** : ajout requis car `showToast({kind:'warn'})` pose la classe `toast-warn`, absente de `style.css` (seuls `toast-ok`/`toast-err` existent) → sinon toast non stylé. Couvert Task 2.3.
- **Cohérence des types/noms** : `missingKeys(state, assets)` défini Task 1, importé/appelé identique Task 3 ; ids DOM `export-bundle`/`import-bundle`/`import-bundle-file` identiques entre index.html (Task 4.1) et app.js (Task 4.3) ; clés i18n `toolbar.export_bundle.*`/`toolbar.import_bundle.*`/`activity.bundle_exported`/`activity.bundle_imported`/`toast.bundle_missing_assets` identiques entre en.js/fr.json (Task 2) et leurs usages (Task 3, Task 4.1).
- **Hors périmètre** confirmé : IndexedDB (levier B), boutons adaptatifs, suivi dirty — non inclus.
