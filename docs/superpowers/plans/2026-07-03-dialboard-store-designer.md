# Dialboard Store — Plan 1 : designer (consommateur) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le tiroir « Modèles » du designer par une galerie « Store » qui fetch un `index.json` distant (filtre par domaine + recherche + install + téléchargement), retombe sur les 5 templates intégrés hors-ligne, et installe des bundles `.dboard` **v2** (avec bloc `meta`).

**Architecture :** Deux modules neufs — `store-index.js` (logique pure : parse/filtre/recherche, testé node) et `store-gallery.js` (DOM : fetch, chips, cartes, install arm-confirm, download ; vérifié navigateur). `bundle.js::decodeBundle` relâché pour accepter v1 **ou** v2. Câblage dans `app.js` : `mountStore(...)` remplace l'appel `mountTemplatesGallery(...)`, qui devient le **fallback offline**. QA de bout en bout contre une fixture locale servie via l'override `?store=`.

**Tech Stack :** JS modules ES (designer), `node --test` (logique pure), vérification navigateur (DOM). Réutilise `template-preview.js::buildThumbnail`, `bundle.js::loadBundle`, l'i18n maison (`i18n.js::t`).

**Périmètre exclu (Plan 2) :** création du repo store + CI + `index.json` généré + seed entries + bascule de `DEFAULT_STORE_BASE` sur le CDN réel ; dialogue « Publier » (écriture de v2 à l'export). Ce plan n'écrit PAS de v2 — il ne fait que le **décoder**.

---

## File Structure

**Créés :**
- `designer/js/store-index.js` — logique pure du catalogue : `parseIndex`, `domainsOf`, `filterEntries`, `DOMAINS`. Aucun DOM/fetch.
- `designer/tests/store-index.test.js` — tests node de la logique pure.
- `designer/js/store-gallery.js` — galerie DOM : `mountStore`, `storeBase`. Fetch index, chips, cartes, install, download, fallback.
- `designer/tests/fixtures/store/index.json` — fixture QA (catalogue).
- `designer/tests/fixtures/store/clock.dboard` — fixture QA (bundle v2 layout-only, install sans config).
- `designer/tests/fixtures/store/weather.dboard` — fixture QA (bundle v2 layout-only, note « à brancher »).

**Modifiés :**
- `designer/js/bundle.js` (l.40) — `decodeBundle` accepte version 1 **ou** 2.
- `designer/tests/bundle.test.js` — ajoute la couverture v2.
- `designer/index.html` (l.133-140) — barre `#store-toolbar` (recherche + chips) dans le pane ; libellé « Store ».
- `designer/js/app.js` (imports + l.277-287) — `mountStore` + fallback + import `loadBundle`.
- `designer/style.css` — styles `.store-toolbar/.store-chip/.tpl-author/.tpl-actions/.store-install/.store-dl/.store-empty`.
- `designer/i18n/fr.json` + `designer/i18n/en.js` — clés `store.*` (identiques des deux côtés : test de parité) + libellés « Store ».

---

## Task 1 : `decodeBundle` accepte v2

**Files:**
- Modify: `designer/js/bundle.js:40`
- Test: `designer/tests/bundle.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à la fin de `designer/tests/bundle.test.js` :

```js
test('decodeBundle : accepte un bundle v2 avec meta (intent : consommer un .dboard du Store)', () => {
  const v2 = JSON.stringify({
    version: 2,
    meta: { name: 'X', author: 'a', description: 'd', domain: 'time', tags: ['t'], requires: '' },
    layout,
    assets: { bg: { a1: 'AQID' }, image: {}, aimg: {} },   // AQID = base64 de [1,2,3]
  });
  const back = decodeBundle(v2);
  assert.deepEqual(JSON.parse(back.layout), layout);        // meta ignoré, layout intact
  assert.deepEqual([...back.assets.bg.a1], [1, 2, 3]);
});

test('decodeBundle : rejette une version inconnue (intent : ne pas charger un format futur non géré)', () => {
  assert.throws(() => decodeBundle(JSON.stringify({ version: 3, layout, assets: {} })), /version|invalid/i);
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec du v2**

Run: `cd designer && node --test tests/bundle.test.js`
Expected: le test « accepte un bundle v2 » **FAIL** (throw `bundle.invalid` car `version !== 1`) ; le test « rejette version 3 » PASS déjà.

- [ ] **Step 3 : Relâcher la garde de version**

Dans `designer/js/bundle.js`, remplacer la ligne 40 :

```js
  if (o.version !== 1 || !o.assets || !o.layout) throw new Error(t('bundle.invalid'));
```

par :

```js
  if ((o.version !== 1 && o.version !== 2) || !o.assets || !o.layout) throw new Error(t('bundle.invalid'));
```

- [ ] **Step 4 : Lancer les tests pour vérifier le vert**

Run: `cd designer && node --test tests/bundle.test.js`
Expected: PASS (tous — v1 régression + v2 + rejets sans-version/version-3).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/bundle.js designer/tests/bundle.test.js
git commit -m "feat(designer): decodeBundle accepte .dboard v2 (bloc meta ignoré à l'install)"
```

---

## Task 2 : `store-index.js` (logique pure) + tests node

**Files:**
- Create: `designer/js/store-index.js`
- Test: `designer/tests/store-index.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `designer/tests/store-index.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndex, domainsOf, filterEntries, DOMAINS } from '../js/store-index.js';

const raw = [
  { id: 'a/clock',  file: 'clock.dboard',   name: 'Horloge', author: 'a', description: 'digitale', domain: 'time',    tags: ['clock'],  layout: { pages: [] } },
  { id: 'b/crypto', file: 'crypto.dboard',  name: 'Ticker',  author: 'b', description: 'BTC/ETH',  domain: 'finance', tags: ['crypto'], layout: { pages: [] } },
  { id: 'c/weird',  file: 'weird.dboard',   name: 'Weird',   author: 'c', description: 'x',         domain: 'zzz',     tags: [],         layout: { pages: [] } },
];

test('parseIndex : normalise et écarte les entrées malformées (intent : une entrée pourrie ne casse pas le catalogue)', () => {
  const bad = [null, {}, { id: 'x' }, { id: 'x', file: 'x.dboard' } /* pas de layout */];
  const out = parseIndex([...raw, ...bad]);
  assert.equal(out.length, 3);                       // les 4 malformées écartées
  assert.equal(out[2].domain, 'other');              // domaine inconnu 'zzz' → 'other'
});

test('parseIndex : défauts sûrs pour les champs optionnels (intent : la galerie ne rend jamais undefined)', () => {
  const out = parseIndex([{ id: 'i/d', file: 'f.dboard', layout: {} }]);
  assert.deepEqual(out, [{ id: 'i/d', file: 'f.dboard', name: 'i/d', author: '', description: '', domain: 'other', tags: [], requires: '', layout: {} }]);
});

test('parseIndex : entrée non-tableau → [] (intent : index corrompu = catalogue vide, pas de throw)', () => {
  assert.deepEqual(parseIndex(null), []);
  assert.deepEqual(parseIndex({ nope: 1 }), []);
});

test('domainsOf : domaines présents dans l\'ordre canonique (intent : chips stables et ordonnées)', () => {
  const out = domainsOf(parseIndex(raw));
  assert.deepEqual(out, ['time', 'finance', 'other']);   // ordre de DOMAINS, pas d'apparition
  assert.ok(DOMAINS.indexOf('time') < DOMAINS.indexOf('finance'));
});

test('filterEntries : filtre par domaine (intent : cliquer une chip restreint au domaine)', () => {
  const out = filterEntries(parseIndex(raw), { domain: 'finance' });
  assert.deepEqual(out.map(e => e.id), ['b/crypto']);
});

test('filterEntries : recherche nom/description/tags insensible à la casse (intent : trouver par mot-clé)', () => {
  const p = parseIndex(raw);
  assert.deepEqual(filterEntries(p, { query: 'HORLOGE' }).map(e => e.id), ['a/clock']);   // nom
  assert.deepEqual(filterEntries(p, { query: 'btc' }).map(e => e.id),     ['b/crypto']);  // description
  assert.deepEqual(filterEntries(p, { query: 'clock' }).map(e => e.id),   ['a/clock']);   // tag
});

test('filterEntries : sans filtre → tout (intent : état initial montre le catalogue complet)', () => {
  assert.equal(filterEntries(parseIndex(raw), {}).length, 3);
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd designer && node --test tests/store-index.test.js`
Expected: FAIL (`Cannot find module '../js/store-index.js'`).

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `designer/js/store-index.js` :

```js
// Logique pure du catalogue Store (parse/filtre/recherche). Aucun DOM ni fetch → testé node.
// La galerie DOM (store-gallery.js) consomme ces helpers ; l'index provient de index.json (généré CI, Plan 2).

// Domaines canoniques (enum figé, cf. spec §8). Ordre = ordre d'affichage des chips.
export const DOMAINS = ['time', 'weather', 'finance', 'system', 'home', 'transit', 'health', 'fun', 'other'];

// JSON brut de index.json → tableau d'entrées normalisées. Tolérant : une entrée sans id/file/layout est
// écartée (pas de throw) ; les champs optionnels reçoivent un défaut sûr ; domaine inconnu → 'other'.
export function parseIndex(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(e => e && typeof e === 'object'
      && typeof e.id === 'string' && e.id
      && typeof e.file === 'string' && e.file
      && e.layout && typeof e.layout === 'object')
    .map(e => ({
      id: e.id,
      file: e.file,
      name: (typeof e.name === 'string' && e.name) ? e.name : e.id,
      author: typeof e.author === 'string' ? e.author : '',
      description: typeof e.description === 'string' ? e.description : '',
      domain: DOMAINS.includes(e.domain) ? e.domain : 'other',
      tags: Array.isArray(e.tags) ? e.tags.filter(t => typeof t === 'string') : [],
      requires: typeof e.requires === 'string' ? e.requires : '',
      layout: e.layout,
    }));
}

// Domaines réellement présents dans le catalogue, dans l'ordre canonique de DOMAINS (chips de filtre).
export function domainsOf(entries) {
  const present = new Set(entries.map(e => e.domain));
  return DOMAINS.filter(d => present.has(d));
}

// Filtre par domaine (null/'' = tous) puis par requête (nom/description/tags, insensible à la casse).
export function filterEntries(entries, { domain = null, query = '' } = {}) {
  const q = String(query).trim().toLowerCase();
  return entries.filter(e => {
    if (domain && e.domain !== domain) return false;
    if (!q) return true;
    return e.name.toLowerCase().includes(q)
      || e.description.toLowerCase().includes(q)
      || e.tags.some(tag => tag.toLowerCase().includes(q));
  });
}
```

- [ ] **Step 4 : Lancer pour vérifier le vert**

Run: `cd designer && node --test tests/store-index.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/store-index.js designer/tests/store-index.test.js
git commit -m "feat(designer): store-index.js — parse/filtre/recherche du catalogue (pur, testé node)"
```

---

## Task 3 : clés i18n `store.*` (fr + en, parité)

**Files:**
- Modify: `designer/i18n/fr.json`
- Modify: `designer/i18n/en.js`
- Test: `designer/tests/i18n-parity.test.js` (existant, non modifié)

- [ ] **Step 1 : Ajouter les clés FR**

Dans `designer/i18n/fr.json`, après la ligne `"templates.home-assistant.setup": ...` (l.455), ajouter (attention à la virgule de la ligne précédente) :

```json
  "store.search.placeholder": "Rechercher un dashboard…",
  "store.filter.all": "Tous",
  "store.install": "Installer",
  "store.installing": "Installation…",
  "store.replace": "Remplacer ?",
  "store.download": "Télécharger",
  "store.download_failed": "Téléchargement échoué : {msg}",
  "store.by": "par {author}",
  "store.none": "Aucun dashboard ne correspond.",
  "store.domain.time": "Horloge",
  "store.domain.weather": "Météo",
  "store.domain.finance": "Finance",
  "store.domain.system": "Système",
  "store.domain.home": "Maison",
  "store.domain.transit": "Transport",
  "store.domain.health": "Santé",
  "store.domain.fun": "Fun",
  "store.domain.other": "Autre",
```

Puis remplacer les 3 libellés « Modèles » par « Store » :

```json
  "toolbar.templates.tip": "Store",
  "drawer.templates.title": "Store",
```
(laisser `toolbar.templates.title` = la description longue inchangée.)

- [ ] **Step 2 : Ajouter les mêmes clés EN**

Dans `designer/i18n/en.js`, ajouter les clés miroir (mêmes clés, valeurs anglaises) au même endroit, et passer les libellés à « Store » :

```js
  'store.search.placeholder': 'Search a dashboard…',
  'store.filter.all': 'All',
  'store.install': 'Install',
  'store.installing': 'Installing…',
  'store.replace': 'Replace?',
  'store.download': 'Download',
  'store.download_failed': 'Download failed: {msg}',
  'store.by': 'by {author}',
  'store.none': 'No dashboard matches.',
  'store.domain.time': 'Clock',
  'store.domain.weather': 'Weather',
  'store.domain.finance': 'Finance',
  'store.domain.system': 'System',
  'store.domain.home': 'Home',
  'store.domain.transit': 'Transit',
  'store.domain.health': 'Health',
  'store.domain.fun': 'Fun',
  'store.domain.other': 'Other',
```
et `'toolbar.templates.tip': 'Store'`, `'drawer.templates.title': 'Store'`.

- [ ] **Step 3 : Vérifier la parité EN/FR**

Run: `cd designer && node --test tests/i18n-parity.test.js`
Expected: PASS (aucune clé présente d'un seul côté).

- [ ] **Step 4 : Commit**

```bash
git add designer/i18n/fr.json designer/i18n/en.js
git commit -m "feat(designer): i18n store.* (fr+en) + libellé tiroir « Store »"
```

---

## Task 4 : markup du tiroir (barre recherche + chips)

**Files:**
- Modify: `designer/index.html:133-140`

- [ ] **Step 1 : Remplacer le contenu du pane**

Dans `designer/index.html`, remplacer le bloc (l.133-140) :

```html
    <div class="drawer-panel" role="dialog" aria-label="Templates" data-i18n-aria-label="drawer.templates.aria">
      <div class="drawer-head">
        <h2 data-i18n="drawer.templates.title">Modèles</h2>
        <button class="drawer-close" type="button" data-i18n-title="drawer.close" title="Fermer">✕</button>
      </div>
      <div id="templates-pane" class="drawer-pane">
        <div id="templates-gallery" class="tpl-gallery"></div>
      </div>
    </div>
```

par :

```html
    <div class="drawer-panel" role="dialog" aria-label="Store" data-i18n-aria-label="drawer.templates.aria">
      <div class="drawer-head">
        <h2 data-i18n="drawer.templates.title">Store</h2>
        <button class="drawer-close" type="button" data-i18n-title="drawer.close" title="Fermer">✕</button>
      </div>
      <div id="templates-pane" class="drawer-pane">
        <div id="store-toolbar" class="store-toolbar">
          <input id="store-search" class="store-search" type="search" data-i18n-placeholder="store.search.placeholder" placeholder="Rechercher un dashboard…" />
          <div id="store-domains" class="store-chips"></div>
        </div>
        <div id="templates-gallery" class="tpl-gallery"></div>
      </div>
    </div>
```

- [ ] **Step 2 : Commit** (vérification visuelle en Task 8)

```bash
git add designer/index.html
git commit -m "feat(designer): markup tiroir Store — barre recherche + conteneur chips"
```

---

## Task 5 : `store-gallery.js` (DOM)

**Files:**
- Create: `designer/js/store-gallery.js`

> Module DOM → **vérifié navigateur** (Task 8), pas de test node (pas de `document`), conformément à la convention projet (logique pure testée, rendu DOM browser-verified).

- [ ] **Step 1 : Écrire le module**

Créer `designer/js/store-gallery.js` :

```js
// Galerie Store montée dans le tiroir. Fetch index.json distant (parseIndex), rend chips de domaine +
// recherche + cartes (miniature live, install arm-confirm, download blob). Échec réseau → mountFallback()
// (les 5 templates embarqués via templates.js). Câblage DOM, vérifié navigateur (pas de test node).
import { buildThumbnail } from './template-preview.js';
import { parseIndex, filterEntries, domainsOf } from './store-index.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

// Base du catalogue. Figée sur le CDN réel en Plan 2 (le repo store n'existe pas encore) ; la QA Plan 1
// l'override via ?store=<base> pour pointer une fixture locale.
const DEFAULT_STORE_BASE = 'https://cdn.jsdelivr.net/gh/Sandjab/dialboard-store@main';

export function storeBase() {
  const q = new URLSearchParams(location.search).get('store');
  return (q || DEFAULT_STORE_BASE).replace(/\/+$/, '');
}

// host = #templates-gallery (grille de cartes) ; toolbar = #store-toolbar (recherche + chips).
export async function mountStore(host, model, { onInstall, mountFallback, toolbar } = {}) {
  let entries;
  try {
    const res = await fetch(`${storeBase()}/index.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    entries = parseIndex(await res.json());
  } catch (e) {
    console.warn('[store] index distant indisponible → fallback built-ins', e);
    if (toolbar) toolbar.hidden = true;               // pas de filtre/recherche hors-ligne
    mountFallback && mountFallback();                 // les 5 templates embarqués (templates.js)
    return;
  }

  const search = toolbar && toolbar.querySelector('#store-search');
  const chips = toolbar && toolbar.querySelector('#store-domains');
  let domain = null;

  const rerender = () => renderCards(host, model, filterEntries(entries, { domain, query: search ? search.value : '' }), onInstall);

  if (chips) {
    chips.textContent = '';
    const mkChip = (d, label) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'store-chip'; b.textContent = label;
      b.addEventListener('click', () => {
        domain = d;
        for (const c of chips.children) c.classList.toggle('on', c === b);
        rerender();
      });
      return b;
    };
    chips.appendChild(mkChip(null, t('store.filter.all')));
    for (const d of domainsOf(entries)) chips.appendChild(mkChip(d, t(`store.domain.${d}`)));
    chips.firstChild.classList.add('on');             // « Tous » actif au départ
  }
  if (search) search.addEventListener('input', rerender);
  rerender();
}

function renderCards(host, model, list, onInstall) {
  host.textContent = '';
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'store-empty'; empty.textContent = t('store.none');
    host.appendChild(empty);
    return;
  }
  for (const entry of list) {
    const card = document.createElement('div');
    card.className = 'tpl-card store-card';
    card.appendChild(buildThumbnail(entry.layout));   // assets absents ⇒ emplacements image en placeholder

    const meta = document.createElement('div');
    meta.className = 'tpl-meta';
    const h = document.createElement('div'); h.className = 'tpl-name'; h.textContent = entry.name;
    const by = document.createElement('div'); by.className = 'tpl-author'; by.textContent = entry.author ? t('store.by', { author: entry.author }) : '';
    const p = document.createElement('div'); p.className = 'tpl-desc'; p.textContent = entry.description;
    const badge = document.createElement('span'); badge.className = 'tpl-badge'; badge.textContent = t(`store.domain.${entry.domain}`);
    meta.append(h, by, p, badge);
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'tpl-actions';
    const install = document.createElement('button');
    install.type = 'button'; install.className = 'store-install'; install.textContent = t('store.install');
    wireInstall(install, model, entry, onInstall);
    const dl = document.createElement('button');
    dl.type = 'button'; dl.className = 'store-dl'; dl.textContent = t('store.download');
    dl.addEventListener('click', () => downloadEntry(entry));
    actions.append(install, dl);
    card.appendChild(actions);

    host.appendChild(card);
  }
}

// Install : arm-confirm si le canvas a été travaillé (repris de templates.js — pas de modale, 2 clics,
// disarm 3 s), puis fetch le .dboard COMPLET (avec assets) et délègue à onInstall(text, entry).
function wireInstall(btn, model, entry, onInstall) {
  let armed = false, timer = null;
  const disarm = () => { armed = false; btn.classList.remove('confirm'); btn.textContent = t('store.install'); if (timer) clearTimeout(timer); timer = null; };
  const go = async () => {
    btn.disabled = true; btn.textContent = t('store.installing');
    try {
      const res = await fetch(`${storeBase()}/${entry.file}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onInstall && onInstall(await res.text(), entry);
    } catch (e) {
      console.warn('[store] install KO', e);
      showToast(t('store.download_failed', { msg: e.message }), { kind: 'err' });
    } finally {
      btn.disabled = false; disarm();
    }
  };
  btn.addEventListener('click', () => {
    if (!model.canUndo()) return go();                // rien à protéger → install direct
    if (armed) { disarm(); return go(); }             // 2e clic → install
    armed = true; btn.classList.add('confirm'); btn.textContent = t('store.replace'); timer = setTimeout(disarm, 3000);
  });
}

// Download : fetch → blob → objectURL. Marche même cross-origin (le CDN fournit le CORS), contrairement
// à un simple <a download> cross-origin. Révocation différée (cf. PR #31 : payload base64 volumineux).
async function downloadEntry(entry) {
  try {
    const res = await fetch(`${storeBase()}/${entry.file}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = (entry.id.split('/').pop() || 'dashboard') + '.dboard';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  } catch (e) {
    showToast(t('store.download_failed', { msg: e.message }), { kind: 'err' });
  }
}
```

- [ ] **Step 2 : Vérifier l'import du toast**

Run: `grep -n "export function showToast" designer/js/toast.js`
Expected: la signature existe (utilisée par `bundle-io.js`) ⇒ l'import est valide. Si le nom diffère, aligner l'import.

- [ ] **Step 3 : Commit** (rendu vérifié en Task 8)

```bash
git add designer/js/store-gallery.js
git commit -m "feat(designer): store-gallery.js — galerie distante, install arm-confirm, download blob, fallback offline"
```

---

## Task 6 : CSS de la barre + cartes Store

**Files:**
- Modify: `designer/style.css`

> Rendu → **vérifié navigateur** (Task 8). Styles auto-suffisants (flex + `currentColor`/opacité), sans dépendre d'un nom de variable de palette non confirmé ; réutilise `.tpl-card/.tpl-badge/.tpl-name/.tpl-desc` existants.

- [ ] **Step 1 : Ajouter le bloc**

À la fin de `designer/style.css`, ajouter :

```css
/* --- Store (galerie distante) --- */
.store-toolbar { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.store-search { width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 8px;
  border: 1px solid rgba(127, 127, 127, .35); background: transparent; color: inherit; font: inherit; }
.store-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.store-chip { padding: 3px 10px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 12px;
  border: 1px solid rgba(127, 127, 127, .35); background: transparent; color: inherit; opacity: .7; }
.store-chip:hover { opacity: 1; }
.store-chip.on { opacity: 1; border-color: currentColor; font-weight: 600; }

.store-card { display: flex; flex-direction: column; }
.tpl-author { font-size: 11px; opacity: .6; margin: 2px 0; }
.tpl-actions { display: flex; gap: 8px; margin-top: 8px; }
.store-install, .store-dl { flex: 1; padding: 6px 8px; border-radius: 8px; cursor: pointer; font: inherit;
  font-size: 12px; border: 1px solid rgba(127, 127, 127, .35); background: transparent; color: inherit; }
.store-install { font-weight: 600; }
.store-install:hover, .store-dl:hover { border-color: currentColor; }
.store-install.confirm { border-color: #E4572E; color: #E4572E; }
.store-install:disabled { opacity: .5; cursor: default; }
.store-empty { opacity: .6; padding: 24px 8px; text-align: center; }
```

- [ ] **Step 2 : Commit** (rendu vérifié en Task 8)

```bash
git add designer/style.css
git commit -m "style(designer): styles barre Store + cartes (recherche, chips, install, download)"
```

---

## Task 7 : câblage `app.js`

**Files:**
- Modify: `designer/js/app.js` (imports + l.277-287)

- [ ] **Step 1 : Ajouter les imports**

Dans `designer/js/app.js`, à côté de `import { mountTemplatesGallery } from './templates.js';` (l.6), ajouter :

```js
import { mountStore } from './store-gallery.js';
import { loadBundle } from './bundle.js';
```

- [ ] **Step 2 : Remplacer l'appel de la galerie**

Remplacer le bloc `mountTemplatesGallery(...)` (l.277-287) par :

```js
  // Fallback offline : si l'index distant est injoignable, mountStore rappelle ce thunk qui monte les
  // 5 templates embarqués (templates.js inchangé — layout-only, model.loadJSON).
  const templatesFallback = () => mountTemplatesGallery($('templates-gallery'), model, {
    onPick: (text, entry) => {
      model.loadJSON(text);
      onLoad();                                   // même reset que l'import fichier (ensurePhysicals…)
      templatesDrawer.close();
      const setup = t(`templates.${entry.id}.setup`);
      if (setup) showToast(setup, { kind: 'warn', ms: 6000 });
      else showToast(t('toast.template_loaded'), { kind: 'ok' });
      logs.logActivity(t('activity.template_loaded', { id: entry.id }));
    },
  });
  mountStore($('templates-gallery'), model, {
    toolbar: $('store-toolbar'),
    mountFallback: templatesFallback,
    onInstall: (text, entry) => {
      loadBundle(model, text);                    // layout + assets (.dboard v1/v2)
      onLoad();
      templatesDrawer.close();
      if (entry.requires) showToast(entry.requires, { kind: 'warn', ms: 6000 });   // note « à brancher »
      else showToast(t('toast.template_loaded'), { kind: 'ok' });
      logs.logActivity(t('activity.template_loaded', { id: entry.id }));
    },
  });
```

- [ ] **Step 3 : Vérifier qu'aucune régression de syntaxe**

Run: `cd designer && node --check js/app.js`
Expected: aucune sortie (syntaxe OK).

- [ ] **Step 4 : Commit** (comportement vérifié en Task 8)

```bash
git add designer/js/app.js
git commit -m "feat(designer): câble mountStore (galerie distante) + fallback templates offline"
```

---

## Task 8 : fixtures QA + vérification navigateur

**Files:**
- Create: `designer/tests/fixtures/store/index.json`
- Create: `designer/tests/fixtures/store/clock.dboard`
- Create: `designer/tests/fixtures/store/weather.dboard`

- [ ] **Step 1 : Créer le bundle fixture clock (v2, sans config)**

Créer `designer/tests/fixtures/store/clock.dboard` :

```json
{
  "version": 2,
  "meta": { "name": "Horloge de bureau", "author": "dialboard", "description": "Horloge digitale minimaliste, zéro réglage.", "domain": "time", "tags": ["clock", "time"], "requires": "" },
  "layout": {
    "title": "Clock", "background": "#0B0B0F", "tz": "CET-1CEST,M3.5.0,M10.5.0",
    "components": {
      "deco": { "type": "ring", "color": "#FF9F40", "min": 0, "max": 60, "rounded": true },
      "time": { "type": "clock", "mode": "digital", "show_seconds": true, "color": "#F5F5F7", "font": 54, "font_family": "jetbrains_mono" },
      "hello": { "type": "label", "text": "Hello", "font": 18, "color": "#9AA0AA" }
    },
    "pages": [ { "name": "Clock", "place": [
      { "ref": "deco", "radius": 170, "thickness": 8, "gap_deg": 0 },
      { "ref": "time", "anchor": "CENTER", "dy": -6 },
      { "ref": "hello", "anchor": "CENTER", "dy": 48 }
    ] } ]
  },
  "assets": { "bg": {}, "image": {}, "aimg": {} }
}
```

- [ ] **Step 2 : Créer le bundle fixture weather (v2, avec note « à brancher »)**

Créer `designer/tests/fixtures/store/weather.dboard` (layout minimal valide + `requires` non vide pour exercer le toast d'install) :

```json
{
  "version": 2,
  "meta": { "name": "Météo", "author": "dialboard", "description": "Température en direct via open-meteo.", "domain": "weather", "tags": ["weather", "temp"], "requires": "Renseigne lat/lon dans l'URL de la source (panneau Sources)." },
  "layout": {
    "title": "Weather", "background": "#0A1020",
    "components": {
      "temp": { "type": "label", "text": "18°", "font": 48, "color": "#FFFFFF", "source": "temp" },
      "city": { "type": "label", "text": "Paris", "font": 18, "color": "#9AA0AA" }
    },
    "pages": [ { "name": "Weather", "place": [
      { "ref": "temp", "anchor": "CENTER", "dy": -10 },
      { "ref": "city", "anchor": "CENTER", "dy": 40 }
    ] } ]
  },
  "assets": { "bg": {}, "image": {}, "aimg": {} }
}
```

- [ ] **Step 3 : Créer l'index fixture (layout sans assets, miroir des .dboard)**

Créer `designer/tests/fixtures/store/index.json` (les `layout` reprennent ceux des `.dboard` ci-dessus — c'est ce que la CI produira en Plan 2) :

```json
[
  {
    "id": "dialboard/clock", "file": "clock.dboard", "name": "Horloge de bureau", "author": "dialboard",
    "description": "Horloge digitale minimaliste, zéro réglage.", "domain": "time", "tags": ["clock", "time"],
    "requires": "", "bytes": 620,
    "layout": {
      "title": "Clock", "background": "#0B0B0F", "tz": "CET-1CEST,M3.5.0,M10.5.0",
      "components": {
        "deco": { "type": "ring", "color": "#FF9F40", "min": 0, "max": 60, "rounded": true },
        "time": { "type": "clock", "mode": "digital", "show_seconds": true, "color": "#F5F5F7", "font": 54, "font_family": "jetbrains_mono" },
        "hello": { "type": "label", "text": "Hello", "font": 18, "color": "#9AA0AA" }
      },
      "pages": [ { "name": "Clock", "place": [
        { "ref": "deco", "radius": 170, "thickness": 8, "gap_deg": 0 },
        { "ref": "time", "anchor": "CENTER", "dy": -6 },
        { "ref": "hello", "anchor": "CENTER", "dy": 48 }
      ] } ]
    }
  },
  {
    "id": "dialboard/weather", "file": "weather.dboard", "name": "Météo", "author": "dialboard",
    "description": "Température en direct via open-meteo.", "domain": "weather", "tags": ["weather", "temp"],
    "requires": "Renseigne lat/lon dans l'URL de la source (panneau Sources).", "bytes": 430,
    "layout": {
      "title": "Weather", "background": "#0A1020",
      "components": {
        "temp": { "type": "label", "text": "18°", "font": 48, "color": "#FFFFFF", "source": "temp" },
        "city": { "type": "label", "text": "Paris", "font": 18, "color": "#9AA0AA" }
      },
      "pages": [ { "name": "Weather", "place": [
        { "ref": "temp", "anchor": "CENTER", "dy": -10 },
        { "ref": "city", "anchor": "CENTER", "dy": 40 }
      ] } ]
    }
  }
]
```

- [ ] **Step 4 : Servir le designer (no-store) et ouvrir avec l'override fixture**

Lancer un serveur statique no-store depuis `designer/` (cf. mémoire projet : cache des modules ES ⇒ no-store ; **ne pas** utiliser le port 8000). Exemple :

Run: `cd designer && python3 -c "import http.server,functools; http.server.test(HandlerClass=functools.partial(http.server.SimpleHTTPRequestHandler), port=8123)"`
(ou tout serveur no-store équivalent ; penser à l'arrêter en fin de QA.)

Ouvrir : `http://localhost:8123/index.html?store=tests/fixtures/store`

- [ ] **Step 5 : Vérifier la galerie (piloter avec de vrais events pointer)**

Cocher visuellement / au navigateur (cf. mémoire : events pointer réels, pas `.click()`) :
- Le tiroir « Store » s'ouvre ; la barre montre le champ recherche + chips « Tous / Horloge / Météo ».
- 2 cartes rendues, **miniatures live** (horloge + météo), auteur « par dialboard », badge domaine.
- Chip « Horloge » → seule la carte Horloge reste ; « Tous » → les 2 reviennent.
- Recherche « paris » → seule Météo (match description) ; « xyz » → message `store.none`.
- **Install Horloge** (canvas vierge) → 1 clic charge le layout sur le canvas, tiroir se ferme, toast OK.
- Retravailler le canvas (déplacer un composant), **Install Météo** → 1er clic « Remplacer ? », 2e clic installe, toast **warn** = la note `requires`.
- **Télécharger** une carte → un fichier `.dboard` est téléchargé.
- Console sans erreur (`read_console_messages`).

- [ ] **Step 6 : Vérifier le fallback offline**

Ouvrir `http://localhost:8123/index.html?store=tests/fixtures/does-not-exist` (base injoignable).
Attendu : la barre recherche/chips est **masquée**, la galerie affiche les **5 templates intégrés** (fallback), console log `[store] index distant indisponible → fallback built-ins` (warn attendu, pas d'erreur).

- [ ] **Step 7 : Arrêter le serveur de QA**

Arrêter le serveur statique (mémoire projet : toujours arrêter ses serveurs de test).

- [ ] **Step 8 : Commit**

```bash
git add designer/tests/fixtures/store/
git commit -m "test(designer): fixtures QA Store (index + 2 .dboard v2) + vérif navigateur"
```

---

## Task 9 : suite complète + garde-fous

**Files:** aucun (vérification)

- [ ] **Step 1 : Lancer TOUTE la suite designer**

Run: `cd designer && node --test`
Expected: PASS (les tests existants + `store-index.test.js` + les ajouts `bundle.test.js` ; parité i18n verte).

- [ ] **Step 2 : Vérifier qu'aucun `.dboard` fixture ne contient de secret/PII**

Run: `grep -rIl "token\|secret\|password\|@" designer/tests/fixtures/store/ || echo "clean"`
Expected: `clean` (les fixtures ne contiennent que des layouts publics factices).

- [ ] **Step 3 : Checkpoint**

Confirmer : decode v2 ✓, logique catalogue testée ✓, galerie/filtre/recherche/install/download/fallback vérifiés navigateur ✓, parité i18n ✓, suite verte ✓. Plan 1 terminé — le designer consomme un catalogue (fixture). Reste **Plan 2** : repo store + CI + `index.json` généré + seed + bascule `DEFAULT_STORE_BASE` sur le CDN réel.

---

## Self-Review (rempli à la rédaction)

- **Couverture spec §4.3/§5/§6/§7/§8** : `index.json` (layout embarqué) consommé par `parseIndex` (T2) ; `.dboard` v2 decode (T1) ; `store-index.js`/`store-gallery.js` (T2/T5) ; galerie/install/download/fallback + tiroir renommé (T4/T5/T7/T8) ; enum domaines + i18n (T2/T3). §9 phasage : Plan 1 = consommation (ce doc), « Publier »/repo = Plan 2 (hors périmètre, énoncé en tête).
- **Placeholders** : aucun `TODO/TBD`. `DEFAULT_STORE_BASE` est une valeur réelle provisoire (repo confirmé en Plan 2), la QA l'override via `?store=` — documenté, pas un trou.
- **Cohérence des types** : `parseIndex` produit `{id,file,name,author,description,domain,tags,requires,layout}` ; `store-gallery.js` et le fixture `index.json` consomment exactement ces champs ; `onInstall(text, entry)` reçoit `entry.file/id/requires` ; `loadBundle(model, text)` = signature existante (bundle.js). `storeBase()` exporté et utilisé pour index + fichier + download.
- **Dépendances externes** : `showToast` (toast.js, déjà utilisé par bundle-io) vérifié en T5S2 ; `buildThumbnail(layout)` prend un objet layout (template-preview.js) ; `model.canUndo/loadJSON` (model.js) ; `onLoad`/`templatesDrawer`/`logs`/`t` déjà en portée au point d'insertion app.js.
