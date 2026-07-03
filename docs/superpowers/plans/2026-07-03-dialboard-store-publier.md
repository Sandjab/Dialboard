# Dialboard Store — dialogue « Publier » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un dialogue « Publier » côté designer : saisit les métadonnées, produit un `.dboard` **v2 + `meta`**, le télécharge, et ouvre l'éditeur « new file » GitHub pré-rempli (repli téléchargement + lien « Contribuer » si le bundle est trop gros pour l'URL).

**Architecture :** `encodeBundle` étendu d'un 3ᵉ paramètre `meta` (présent → v2). Helpers **purs** dans `publish.js` (slug/validation/URL/seuil, testés node). Overlay-formulaire `publish-dialog.js` (DOM, vérifié navigateur) modelé sur `#shot-overlay`. Câblage `app.js`, markup `index.html`, CSS, i18n `publish.*`. Zéro firmware.

**Tech Stack :** JS modules ES (designer), `node --test` (pur), vérif navigateur (DOM). Réutilise `collectAssets`/`missingKeys` (bundle.js), `showToast`, `DOMAINS` (store-index.js), le pattern download de `bundle-io.js`.

**Hors périmètre :** pas d'auth/API GitHub ; l'export `.dboard` perso reste v1 ; pas d'upload d'images via l'URL (repli assumé).

---

## File Structure

**Créés :**
- `designer/js/publish.js` — purs : `slugify`, `validateMeta`, `buildMeta`, `publishUrl`, `fitsPrefill`, `PREFILL_MAX`.
- `designer/tests/publish.test.js` — tests node.
- `designer/js/publish-dialog.js` — overlay DOM : `mountPublishDialog`.

**Modifiés :**
- `designer/js/bundle.js` — `encodeBundle(layoutText, assets, meta?)` (meta → v2).
- `designer/tests/bundle.test.js` — couverture encode v2.
- `designer/index.html` — bouton `#publish-open` (en-tête tiroir Store) + overlay `#publish-overlay`.
- `designer/js/app.js` — import + `mountPublishDialog(...)`.
- `designer/style.css` — styles `.drawer-head-btn`, `.publish-box`, champs.
- `designer/i18n/fr.json` + `designer/i18n/en.js` — clés `publish.*` (parité).

---

## Task 1 : `encodeBundle` écrit v2 si `meta`

**Files:** Modify `designer/js/bundle.js` (fonction `encodeBundle`) ; Test `designer/tests/bundle.test.js`.

- [ ] **Step 1 : Tests qui échouent** — ajouter à la fin de `designer/tests/bundle.test.js` :

```js
test('encodeBundle : sans meta reste v1 sans clé meta (intent : l\'export perso est inchangé)', () => {
  const o = JSON.parse(encodeBundle(JSON.stringify(layout), assets));
  assert.equal(o.version, 1);
  assert.ok(!('meta' in o), 'pas de clé meta en v1');
});

test('encodeBundle : avec meta écrit v2 + bloc meta (intent : « Publier » produit un bundle de store)', () => {
  const meta = { name: 'X', author: 'a', description: 'd', domain: 'time', tags: ['t'], requires: '' };
  const o = JSON.parse(encodeBundle(JSON.stringify(layout), assets, meta));
  assert.equal(o.version, 2);
  assert.deepEqual(o.meta, meta);
  assert.deepEqual(o.layout, layout);
  assert.equal(typeof o.assets.bg.a1, 'string');   // assets toujours base64
});

test('encodeBundle+decode v2 : round-trip fidèle (intent : ce qu\'on publie se recharge)', () => {
  const meta = { name: 'X', author: 'a', description: 'd', domain: 'time' };
  const back = decodeBundle(encodeBundle(JSON.stringify(layout), assets, meta));
  assert.deepEqual(JSON.parse(back.layout), layout);
  assert.deepEqual([...back.assets.bg.a1], [1, 2, 3]);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd designer && node --test tests/bundle.test.js`
Expected: les 2 nouveaux tests « avec meta » FAIL (encode ignore le 3ᵉ arg, sort v1) ; le test « sans meta » PASS déjà.

- [ ] **Step 3 : Étendre `encodeBundle`** — remplacer dans `designer/js/bundle.js` :

```js
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
```

par :

```js
export function encodeBundle(layoutText, assets = {}, meta = null) {
  const bundle = { version: meta ? 2 : 1 };
  if (meta) bundle.meta = meta;                       // v2 : bloc meta juste après version
  bundle.layout = JSON.parse(layoutText);
  bundle.assets = {
    bg: mapVals(assets.bg, bytesToB64),
    image: mapVals(assets.image, bytesToB64),
    aimg: mapVals(assets.aimg, bytesToB64),
  };
  return JSON.stringify(bundle);
}
```

- [ ] **Step 4 : Lancer, vérifier le vert**

Run: `cd designer && node --test tests/bundle.test.js`
Expected: PASS (dont l'ancien « pose version 1 » — appelé sans meta, reste v1).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/bundle.js designer/tests/bundle.test.js
git commit -m "feat(designer): encodeBundle écrit .dboard v2 quand un bloc meta est fourni"
```

---

## Task 2 : `publish.js` (purs) + tests node

**Files:** Create `designer/js/publish.js` ; Test `designer/tests/publish.test.js`.

- [ ] **Step 1 : Tests qui échouent** — créer `designer/tests/publish.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, validateMeta, buildMeta, publishUrl, fitsPrefill, PREFILL_MAX } from '../js/publish.js';

test('slugify : minuscule, accents retirés, espaces→tirets, borné (intent : nom de fichier sûr)', () => {
  assert.equal(slugify('  Ma Météo à Paris !  '), 'ma-meteo-a-paris');
  assert.equal(slugify(''), 'dashboard');                 // vide → défaut
  assert.equal(slugify('----'), 'dashboard');             // que du séparateur → défaut
  assert.ok(slugify('x'.repeat(80)).length <= 40);        // borné
});

test('validateMeta : requis name/author/description/domain (intent : la CI store les exige)', () => {
  assert.equal(validateMeta({ name: 'a', author: 'b', description: 'c', domain: 'time' }).valid, true);
  assert.deepEqual(validateMeta({ name: '', author: 'b', description: 'c', domain: 'time' }).missing, ['name']);
  assert.ok(validateMeta({ name: 'a', author: 'b', description: 'c', domain: 'zzz' }).missing.includes('domain')); // hors enum
  assert.equal(validateMeta({}).valid, false);
});

test('buildMeta : tags CSV→array nettoyé, champs trimés (intent : meta propre)', () => {
  const m = buildMeta({ name: ' N ', author: ' me ', description: ' d ', domain: 'time', tags: 'a, b ,,c', requires: ' r ' });
  assert.deepEqual(m, { name: 'N', author: 'me', description: 'd', domain: 'time', tags: ['a', 'b', 'c'], requires: 'r' });
});

test('publishUrl : éditeur new-file GitHub pré-rempli chemin+contenu (intent : soumission quasi 1-clic)', () => {
  const u = publishUrl('https://github.com/Sandjab/dialboard-store', 'Me', 'my-clock', '{"version":2}');
  assert.ok(u.startsWith('https://github.com/Sandjab/dialboard-store/new/main?'));
  assert.ok(u.includes('filename=' + encodeURIComponent('entries/me/my-clock.dboard')));
  assert.ok(u.includes('value=' + encodeURIComponent('{"version":2}')));
});

test('fitsPrefill : petit → true, gros → false (intent : basculer prefill/repli selon la longueur d\'URL)', () => {
  assert.equal(fitsPrefill('{"a":1}'), true);
  assert.equal(fitsPrefill('x'.repeat(PREFILL_MAX + 1)), false);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd designer && node --test tests/publish.test.js`
Expected: FAIL (`Cannot find module '../js/publish.js'`).

- [ ] **Step 3 : Implémentation** — créer `designer/js/publish.js` :

```js
// Helpers purs du dialogue « Publier » (slug, validation, URL GitHub, seuil). Aucun DOM → testé node.
// Le domaine partage l'enum DOMAINS avec la galerie (store-index.js), source commune.
import { DOMAINS } from './store-index.js';

const REQUIRED = ['name', 'author', 'description', 'domain'];

// Nom → slug de fichier sûr : minuscule, accents retirés, non-alphanum → tirets, borné 40, défaut si vide.
export function slugify(name) {
  const s = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'dashboard';
}

// fields → { valid, missing:[...] }. Requis non vides + domaine dans l'enum.
export function validateMeta(fields = {}) {
  const missing = REQUIRED.filter(k => !fields[k] || !String(fields[k]).trim());
  if (fields.domain && !DOMAINS.includes(fields.domain) && !missing.includes('domain')) missing.push('domain');
  return { valid: missing.length === 0, missing };
}

// Formulaire → bloc meta propre (tags CSV → array sans vides, champs trimés).
export function buildMeta(fields) {
  return {
    name: fields.name.trim(),
    author: fields.author.trim(),
    description: fields.description.trim(),
    domain: fields.domain,
    tags: String(fields.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    requires: String(fields.requires || '').trim(),
  };
}

// URL de l'éditeur « new file » GitHub pré-rempli (chemin sous entries/<auteur-slug>/ + contenu).
export function publishUrl(repoUrl, author, slug, dboardText) {
  const path = `entries/${slugify(author)}/${slug}.dboard`;
  return `${repoUrl}/new/main?filename=${encodeURIComponent(path)}&value=${encodeURIComponent(dboardText)}`;
}

// Le contenu URL-encodé tient-il sous le seuil ? (prefill viable vs repli téléchargement)
export const PREFILL_MAX = 6000;
export function fitsPrefill(dboardText, max = PREFILL_MAX) {
  return encodeURIComponent(dboardText).length <= max;
}
```

- [ ] **Step 4 : Lancer, vérifier le vert**

Run: `cd designer && node --test tests/publish.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/publish.js designer/tests/publish.test.js
git commit -m "feat(designer): publish.js — slug/validation/URL GitHub/seuil (pur, testé node)"
```

---

## Task 3 : i18n `publish.*` (fr + en, parité)

**Files:** Modify `designer/i18n/fr.json`, `designer/i18n/en.js`.

- [ ] **Step 1 : Clés FR** — ajouter dans `designer/i18n/fr.json` (près des clés `store.*`) :

```json
  "publish.open": "Publier le vôtre",
  "publish.title": "Publier au Store",
  "publish.name": "Nom",
  "publish.author": "Pseudo GitHub",
  "publish.description": "Description",
  "publish.domain": "Domaine",
  "publish.domain_placeholder": "— choisir —",
  "publish.tags": "Tags (séparés par des virgules)",
  "publish.requires": "À brancher (optionnel)",
  "publish.cancel": "Annuler",
  "publish.submit": "Publier",
  "publish.missing_assets": "{n} image(s) non incluse(s) (absente(s) du cache)",
  "publish.opened_github": "Fichier téléchargé — ouvre GitHub pour créer la PR.",
  "publish.download_only": "Fichier téléchargé — trop gros pour le pré-remplissage : ouvre le guide Contribuer et dépose-le.",
```

- [ ] **Step 2 : Clés EN** — mêmes clés dans `designer/i18n/en.js` :

```js
  'publish.open': 'Publish yours',
  'publish.title': 'Publish to the Store',
  'publish.name': 'Name',
  'publish.author': 'GitHub handle',
  'publish.description': 'Description',
  'publish.domain': 'Domain',
  'publish.domain_placeholder': '— choose —',
  'publish.tags': 'Tags (comma-separated)',
  'publish.requires': 'Wiring notes (optional)',
  'publish.cancel': 'Cancel',
  'publish.submit': 'Publish',
  'publish.missing_assets': '{n} image(s) not included (missing from cache)',
  'publish.opened_github': 'File downloaded — opening GitHub to create the PR.',
  'publish.download_only': 'File downloaded — too large to prefill: open the Contributing guide and drop it in.',
```

- [ ] **Step 3 : Parité**

Run: `cd designer && node --test tests/i18n-parity.test.js`
Expected: PASS.

- [ ] **Step 4 : Commit**

```bash
git add designer/i18n/fr.json designer/i18n/en.js
git commit -m "feat(designer): i18n publish.* (fr+en)"
```

---

## Task 4 : markup (bouton + overlay) + CSS

**Files:** Modify `designer/index.html`, `designer/style.css`.

- [ ] **Step 1 : Bouton dans l'en-tête du tiroir Store** — dans `designer/index.html`, dans le `.drawer-head` du `#templates-drawer`, insérer le bouton entre le `<h2>` et le `.drawer-close` :

```html
        <h2 data-i18n="drawer.templates.title">Store</h2>
        <button id="publish-open" class="drawer-head-btn" type="button" data-i18n="publish.open">Publier le vôtre</button>
        <button class="drawer-close" type="button" data-i18n-title="drawer.close" title="Fermer">✕</button>
```

- [ ] **Step 2 : Overlay du formulaire** — ajouter après le `#shot-overlay` (après sa balise fermante `</div>` de `#shot-overlay`) :

```html
  <div id="publish-overlay" class="shot-overlay" hidden>
    <div class="publish-box">
      <h2 data-i18n="publish.title">Publier au Store</h2>
      <label class="pub-field"><span data-i18n="publish.name">Nom</span><input id="pub-name" type="text" /></label>
      <label class="pub-field"><span data-i18n="publish.author">Pseudo GitHub</span><input id="pub-author" type="text" /></label>
      <label class="pub-field"><span data-i18n="publish.description">Description</span><input id="pub-description" type="text" /></label>
      <label class="pub-field"><span data-i18n="publish.domain">Domaine</span><select id="pub-domain"></select></label>
      <label class="pub-field"><span data-i18n="publish.tags">Tags</span><input id="pub-tags" type="text" /></label>
      <label class="pub-field"><span data-i18n="publish.requires">À brancher</span><textarea id="pub-requires" rows="2"></textarea></label>
      <div class="publish-actions">
        <button id="pub-cancel" type="button" data-i18n="publish.cancel">Annuler</button>
        <button id="pub-submit" type="button" data-i18n="publish.submit" disabled>Publier</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 3 : CSS** — ajouter à la fin de `designer/style.css` :

```css
/* --- Publier (dialogue de dépose Store) --- */
.drawer-head-btn { margin-left: auto; margin-right: 8px; padding: 4px 10px; border-radius: 8px; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 600; border: 1px solid currentColor; background: transparent; color: inherit; opacity: .85; }
.drawer-head-btn:hover { opacity: 1; }
.publish-box { background: var(--panel, #1a1a1f); color: inherit; border-radius: 12px; padding: 20px; width: min(420px, 92vw);
  display: flex; flex-direction: column; gap: 10px; max-height: 90vh; overflow: auto; }
.publish-box h2 { margin: 0 0 4px; font-size: 16px; }
.pub-field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; opacity: .9; }
.pub-field input, .pub-field select, .pub-field textarea { font: inherit; padding: 6px 8px; border-radius: 8px;
  border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; box-sizing: border-box; width: 100%; }
.publish-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.publish-actions button { padding: 6px 14px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 13px;
  border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; }
#pub-submit { font-weight: 600; border-color: currentColor; }
#pub-submit:disabled { opacity: .4; cursor: default; }
```

> `.shot-overlay` (réutilisé) fournit le fond fixe centré ; la CSS `var(--panel,…)` a un fallback au cas où le nom de variable diffère (vérifié navigateur en Task 6).

- [ ] **Step 4 : Commit**

```bash
git add designer/index.html designer/style.css
git commit -m "feat(designer): markup + styles du dialogue Publier (bouton en-tête Store + overlay)"
```

---

## Task 5 : `publish-dialog.js` (DOM) + câblage app.js

**Files:** Create `designer/js/publish-dialog.js` ; Modify `designer/js/app.js`.

> DOM → vérifié navigateur (Task 6), pas de test node.

- [ ] **Step 1 : Module** — créer `designer/js/publish-dialog.js` :

```js
// Overlay « Publier » : formulaire meta → .dboard v2 (encodeBundle avec meta) → download + soumission
// GitHub. Modelé sur #shot-overlay (open/close via .hidden). Câblage DOM, vérifié navigateur (pas de test node).
import { encodeBundle, collectAssets, missingKeys } from './bundle.js';
import { slugify, validateMeta, buildMeta, publishUrl, fitsPrefill } from './publish.js';
import { DOMAINS } from './store-index.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

const STORE_REPO_URL = 'https://github.com/Sandjab/dialboard-store';   // dépôt (≠ base CDN de la galerie)

export function mountPublishDialog(model, { openBtn, overlay } = {}) {
  if (!openBtn || !overlay) return;
  const $ = id => overlay.querySelector('#' + id);
  const fieldsEls = { name: $('pub-name'), author: $('pub-author'), description: $('pub-description'),
    domain: $('pub-domain'), tags: $('pub-tags'), requires: $('pub-requires') };
  const submit = $('pub-submit');

  // Peuple le <select> domaine : placeholder vide (force un choix) + un <option> par domaine (labels store.domain.*).
  const ph = document.createElement('option');
  ph.value = ''; ph.disabled = true; ph.selected = true; ph.textContent = t('publish.domain_placeholder');
  fieldsEls.domain.appendChild(ph);
  for (const d of DOMAINS) {
    const o = document.createElement('option');
    o.value = d; o.textContent = t(`store.domain.${d}`);
    fieldsEls.domain.appendChild(o);
  }

  const read = () => Object.fromEntries(Object.entries(fieldsEls).map(([k, el]) => [k, el.value]));
  const refresh = () => { submit.disabled = !validateMeta(read()).valid; };
  for (const el of Object.values(fieldsEls)) el.addEventListener('input', refresh);
  refresh();

  const open = () => { overlay.hidden = false; };
  const close = () => { overlay.hidden = true; };
  openBtn.addEventListener('click', open);
  $('pub-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });   // clic sur le fond ferme

  submit.addEventListener('click', () => {
    const fields = read();
    if (!validateMeta(fields).valid) return;                 // garde-fou (le bouton devrait être désactivé)
    const meta = buildMeta(fields);
    const assets = collectAssets(model);
    const miss = missingKeys(model.state, assets);
    const n = miss.bg.length + miss.image.length + miss.aimg.length;
    if (n) showToast(t('publish.missing_assets', { n }), { kind: 'warn' });   // fail-loud, non bloquant

    const slug = slugify(meta.name);
    const dboardText = encodeBundle(model.toJSON(), assets, meta);            // v2
    downloadDboard(slug, dboardText);                                         // l'auteur a toujours le fichier

    if (fitsPrefill(dboardText)) {
      window.open(publishUrl(STORE_REPO_URL, meta.author, slug, dboardText), '_blank', 'noopener');
      showToast(t('publish.opened_github'), { kind: 'ok', ms: 5000 });
    } else {
      window.open(`${STORE_REPO_URL}/blob/main/CONTRIBUTING.md`, '_blank', 'noopener');
      showToast(t('publish.download_only'), { kind: 'warn', ms: 6000 });
    }
    close();
  });
}

// Download blob (miroir de bundle-io.js : révocation différée, payload base64 potentiellement gros).
function downloadDboard(slug, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${slug}.dboard`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
```

- [ ] **Step 2 : Câblage app.js** — près de l'appel `mountStore(...)` (ajouté au Plan 1), ajouter l'import en tête (à côté de `import { mountStore } from './store-gallery.js';`) :

```js
import { mountPublishDialog } from './publish-dialog.js';
```

puis, après le bloc `mountStore(...)`, ajouter :

```js
  mountPublishDialog(model, { openBtn: $('publish-open'), overlay: $('publish-overlay') });
```

- [ ] **Step 3 : Vérif syntaxe**

Run: `cd designer && node --check js/publish-dialog.js && node --check js/app.js`
Expected: aucune sortie.

- [ ] **Step 4 : Commit**

```bash
git add designer/js/publish-dialog.js designer/js/app.js
git commit -m "feat(designer): publish-dialog.js — overlay Publier (v2 + download + prefill GitHub/repli), câblé"
```

---

## Task 6 : vérification navigateur

**Files:** aucun (QA).

- [ ] **Step 1 : Servir + ouvrir** — servir la **racine repo** en no-store (port ≠ 8000 ; le designer fait `fetch('../schema/…')` → sert depuis la racine). Ouvrir `http://localhost:<port>/designer/index.html`.

- [ ] **Step 2 : Ouvrir le dialogue** — ouvrir le tiroir Store, cliquer « Publier le vôtre ». Attendu : overlay visible, `<select>` domaine peuplé (placeholder + 9 domaines), bouton « Publier » **désactivé**.

- [ ] **Step 3 : Validation live** — remplir name/author/description, choisir un domaine → « Publier » **s'active** ; vider un requis → se **désactive**. (Piloter par events réels ; pour un `input`, `el.value=…` + `dispatchEvent(new Event('input',{bubbles:true}))`.)

- [ ] **Step 4 : Publier (petit layout)** — sur un layout léger (canvas par défaut), stubber `window.open` pour capturer l'URL, cliquer « Publier ». Vérifier au navigateur :
  - un download `.dboard` est déclenché (spy sur `a.click` OU `URL.createObjectURL` appelé) ;
  - `window.open` appelé avec une URL `https://github.com/Sandjab/dialboard-store/new/main?filename=entries/<author-slug>/<slug>.dboard&value=…` ;
  - le `.dboard` encodé est **v2** (`JSON.parse(decodeURIComponent(value)).version === 2` et `.meta.name` correct) ;
  - l'overlay se ferme, toast OK.
  Exemple de spy : `window.__u=null; const o=window.open; window.open=(u)=>{window.__u=u; return null;}` avant le clic, puis lire `window.__u`.

- [ ] **Step 5 : Repli (gros bundle)** — (optionnel si un gros layout est dispo) forcer un bundle > seuil et vérifier que `window.open` vise `…/blob/main/CONTRIBUTING.md` + toast `download_only`. À défaut, la bascule est couverte par le test node `fitsPrefill`.

- [ ] **Step 6 : Console propre + arrêter le serveur.**

- [ ] **Step 7 : Commit** (le cas échéant, si des fixtures/ajustements QA)

```bash
git commit --allow-empty -m "test(designer): Publier vérifié navigateur (validation, encode v2, prefill GitHub)"
```

---

## Task 7 : suite complète

- [ ] **Step 1 : Toute la suite**

Run: `cd designer && node --test`
Expected: PASS (existants + `publish.test.js` + ajouts `bundle.test.js`, parité i18n verte).

- [ ] **Step 2 : Checkpoint** — encode v2 ✓, helpers purs testés ✓, dialogue/validation/prefill vérifiés navigateur ✓, parité i18n ✓. Feature « Publier » complète.

---

## Self-Review (rempli à la rédaction)

- **Couverture spec** : §2 encode v2 par extension (T1) ; §3 flux form→v2→download→prefill/repli (T2/T5) ; §4 composants `publish.js`/`publish-dialog.js`/bundle étendu/markup (T2/T4/T5) ; §5 validation + `missingKeys` + domaine via `DOMAINS` (T2/T5) ; i18n (T3). Placement en-tête tiroir Store (T4). Hors périmètre respecté (export perso v1 intact — testé T1 « sans meta »).
- **Placeholders** : aucun `TODO`. `STORE_REPO_URL` = valeur réelle (repo publié). Seuil `PREFILL_MAX` explicite.
- **Cohérence des types** : `validateMeta(read())`/`buildMeta(fields)` consomment `{name,author,description,domain,tags,requires}` = les 6 `#pub-*` ; `encodeBundle(text, assets, meta)` = signature étendue T1 ; `publishUrl(repoUrl, author, slug, text)` = signature T2 ; `DOMAINS` importé (non redéclaré). `collectAssets`/`missingKeys`/`showToast` = signatures existantes.
