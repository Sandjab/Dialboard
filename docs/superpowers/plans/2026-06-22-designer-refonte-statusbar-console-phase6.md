# Designer — refonte IHM Phase 6 : barre d'état + console + validation décrochée — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Décrocher la validation et la vue JSON du `<footer>` fourre-tout : une **barre d'état** permanente (contexte de sélection + verdict de validation cliquable + zoom) et une **console repliable** [Problèmes | Source] (Source = JSON lecture seule + Copier).

**Architecture :** Deux modules neufs (`statusbar.js`, `console.js`) qui s'abonnent au modèle partagé (`model.subscribe`) et à la sélection (`selection.subscribe`), exactement comme les modules existants (tree/inspector). La logique de validation (`validate.js`) est **réutilisée inchangée** ; `json-view.js` est **dissous** (ses 25 lignes se redistribuent : validation → barre d'état + console ; textarea → onglet Source lecture seule). Deux fonctions **pures** portent le formatage testable (`formatSelectionContext`, `formatValidationSummary`), sur le moule de `formatDeviceStatus` (Phase 5). Aucune mutation, aucun changement de schéma/firmware/`render.js`.

**Tech Stack :** JS modules ES (designer), `node --test` (cœur pur, sans DOM), vérif navigateur Playwright (DOM). Spec : `docs/superpowers/specs/2026-06-21-designer-refonte-ihm-design.md` §4 (barre d'état), §5 (console + validation décrochée).

---

## Contexte d'exécution (état au démarrage)

- Branche `feat/designer-refonte-ihm`, tip `115c3a2`, arbre propre. Phase 5 ✅. `cd designer && node --test` → **301/301**.
- **Périmètre** : `designer/` uniquement (web + tests node). Le moteur de rendu `render.js`, le firmware, le schéma : **intacts**.
- **Serveur de vérif** : `python3 -m http.server <port>` **depuis la racine du repo** (`Dialboard/`), PAS `designer/` — `app.js` fait `fetch('../schema/layout.schema.json')`. Servir en **no-store** (cache modules ES). Port libre ≠ 8000 (réservé utilisateur). Arrêter le serveur en fin de tâche.
- **Invariants à ne pas régresser** (cf. `CLAUDE.md` « invariants inspecteur/canvas ») : gardes F1 (blur avant changement de sélection) et F5 (ref figée au rendu). La Phase 6 ne touche NI au canvas NI à l'inspecteur de composant → ces gardes ne doivent pas bouger ; on vérifie seulement qu'ils restent verts.

## File Structure

**Neufs :**
- `designer/js/statusbar.js` — barre d'état. Deux fonctions **pures exportées** (`formatSelectionContext`, `formatValidationSummary`) + `createStatusbar(root, model, { selection, validate, onValidClick })` (DOM). Responsabilité unique : afficher l'état ambiant (contexte de sélection à gauche, verdict de validation à droite) et router le clic validation vers la console.
- `designer/js/console.js` — `createConsole(root, model, { validate })` (DOM). Panneau bas repliable, deux onglets : **Problèmes** (liste `errors`/`warnings` humanisées) et **Source** (`model.toJSON()` lecture seule + bouton Copier). Expose `{ open(tab), render }`.
- `designer/tests/statusbar.test.js` — tests node des deux fonctions pures.

**Modifiés :**
- `designer/index.html` — retire le groupe Zoom de la toolbar ; retire le `<details>` JSON du footer ; ajoute `<div id="statusbar">` + `<section id="console">` entre `</main>` et `<footer>`.
- `designer/js/app.js` — remplace `bindJsonView(...)` par `createStatusbar(...)` + `createConsole(...)` ; retire l'import `bindJsonView` ; retire la garde « Modifs JSON non appliquées » du handler push ; retire les `$('json').blur()` des handlers undo/redo (plus de textarea).
- `designer/style.css` — CSS **structurelle** des nouvelles zones (`.statusbar`, `.console`, onglets). Pas de direction artistique.

**Supprimé :**
- `designer/js/json-view.js` — dissous (validation → statusbar/console ; textarea → console Source).

**Réutilisés tels quels :** `validate.js`, `selection.js`, `model.js`, `registry.js` (labels de type), `humanize.js`. Le footer **garde** ses `<details>` Device + Sources (transitoire — la Phase 7 les déplace dans le tiroir et supprime le footer).

## Décisions de conception (verrouillées)

1. **`json-view.js` supprimé, pas conservé en couche mince.** Ses deux responsabilités se redistribuent proprement (validation déjà dans `validate.js` ; vue Source → console). Garder un fichier de 5 lignes serait un YAGNI inverse.
2. **Chaque module valide indépendamment.** `statusbar` et `console` s'abonnent tous deux au modèle et appellent `validate(model.state)` à chaque changement. `validate` est pur, ajv sur un layout de quelques Ko = sub-milliseconde → la double exécution est négligeable et préférable à un couplage des deux modules via `app.js`. (Pattern réactif standard : deux vues dérivées du même modèle.)
3. **`formatValidationSummary` préserve la sémantique `valid`.** `valid = errors.length === 0` (les warnings ne bloquent pas le push, cf. `validate.js:55`). Donc avec 0 erreur + N warnings → `✓ valide · N avert.` (niveau `warn`, restant « valide »/poussable), PAS `✗`. Trois états : `✓ valide` (ok) / `✓ valide · N avert.` (warn) / `✗ N erreurs` (err).
4. **Décompte « composants » = placements visuels** (somme des `place[].length`), pas `Object.keys(components)`. En modèle 1:1 (cf. HANDOFF « modèle 1:1 ») un placement ↔ un composant visuel ; les physiques (`led_ring`/`sound`) sont dans la map `components` mais non placés → exclus, cohérent avec l'arbre (qui ne les montre pas).
5. **Console = bandeau fin toujours visible + corps replié par défaut.** « Cachée par défaut » de la spec = corps replié ; le bandeau (onglets + ▲▼) reste comme poignée (sinon l'onglet Source serait injoignable). Pattern « drawer console » de devtools.
6. **Zoom display-only migré tel quel.** Le `<select id="zoom">` change de parent (toolbar → barre d'état) ; le câblage `$('zoom')` d'`app.js` (persistance localStorage `rt-designer-zoom`) reste **inchangé** — on déplace le markup, pas la logique.

---

## Task 1 : Fonction pure `formatValidationSummary`

**Files:**
- Create: `designer/js/statusbar.js`
- Create: `designer/tests/statusbar.test.js`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `designer/tests/statusbar.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatValidationSummary } from '../js/statusbar.js';

test('formatValidationSummary : 0 erreur 0 avert → ✓ valide, niveau ok (intent : feu vert, push possible)', () => {
  const r = formatValidationSummary({ valid: true, errors: [], warnings: [] });
  assert.equal(r.text, '✓ valide');
  assert.equal(r.level, 'ok');
});

test('formatValidationSummary : erreurs → ✗ N erreurs au pluriel, niveau err (intent : push bloqué, compte visible)', () => {
  const r = formatValidationSummary({ valid: false, errors: ['a', 'b'], warnings: [] });
  assert.equal(r.text, '✗ 2 erreurs');
  assert.equal(r.level, 'err');
});

test('formatValidationSummary : une seule erreur → singulier « erreur »', () => {
  const r = formatValidationSummary({ valid: false, errors: ['a'], warnings: [] });
  assert.equal(r.text, '✗ 1 erreur');
});

test('formatValidationSummary : 0 erreur + warnings → reste « ✓ valide » + compte avert, niveau warn (intent : un warning ne bloque PAS le push, sémantique validate.js)', () => {
  const r = formatValidationSummary({ valid: true, errors: [], warnings: ['x', 'y'] });
  assert.equal(r.text, '✓ valide · 2 avert.');
  assert.equal(r.level, 'warn');
});

test('formatValidationSummary : erreurs ET warnings → l’erreur prime (intent : ne pas noyer le bloquant sous l’avertissement)', () => {
  const r = formatValidationSummary({ valid: false, errors: ['a'], warnings: ['x'] });
  assert.equal(r.level, 'err');
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run: `cd designer && node --test tests/statusbar.test.js`
Expected: FAIL — `formatValidationSummary` introuvable (module `statusbar.js` inexistant ou sans export).

- [ ] **Step 3 : Implémenter le minimum**

Créer `designer/js/statusbar.js` (la partie DOM viendra Task 3 ; pour l'instant, juste les fonctions pures) :

```js
// Barre d'état (Phase 6, spec §4) : contexte de sélection (gauche) + verdict de validation cliquable (droite).
// Fonctions PURES (testées node) ; la construction DOM (createStatusbar) est en bas (vérifiée navigateur).
import { COMPONENTS } from './registry.js';

// Verdict de validation condensé pour la barre d'état. `valid` ne dépend QUE des errors (validate.js) : un
// warning ne bloque pas le push → on reste « ✓ valide » avec le compte d'avertissements (niveau warn).
// L'erreur prime sur l'avertissement (ne pas masquer le bloquant).
export function formatValidationSummary({ valid, errors = [], warnings = [] }) {
  if (errors.length) return { text: `✗ ${errors.length} erreur${errors.length > 1 ? 's' : ''}`, level: 'err' };
  if (warnings.length) return { text: `✓ valide · ${warnings.length} avert.`, level: 'warn' };
  return { text: '✓ valide', level: 'ok' };
}
```

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

Run: `cd designer && node --test tests/statusbar.test.js`
Expected: PASS (5 tests `formatValidationSummary`).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/statusbar.js designer/tests/statusbar.test.js
git commit -m "designer: statusbar — formatValidationSummary pur (verdict condensé, testé node)"
```

---

## Task 2 : Fonction pure `formatSelectionContext`

**Files:**
- Modify: `designer/js/statusbar.js`
- Modify: `designer/tests/statusbar.test.js`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter en bas de `designer/tests/statusbar.test.js` :

```js
import { formatSelectionContext } from '../js/statusbar.js';

// Layout minimal : 2 pages, 3 placements au total (2 + 1), un composant masqué.
const ST = {
  title: 'Demo',
  pages: [
    { name: 'Accueil', place: [{ ref: 'ring1', anchor: 'CENTER', dx: 0, dy: -20 }, { ref: 'lbl1', anchor: 'TOP_MID', dx: 0, dy: 40 }] },
    { name: 'Détails', place: [{ ref: 'img1', anchor: 'CENTER', dx: 5, dy: 5 }] },
  ],
  components: {
    ring1: { type: 'ring' },
    lbl1: { type: 'label' },
    img1: { type: 'image', visible: false },
  },
};

test('formatSelectionContext : null → « Rien de sélectionné »', () => {
  assert.equal(formatSelectionContext(ST, null), 'Rien de sélectionné');
});

test('formatSelectionContext : doc → N pages · M composants (M = somme des placements, pas la map ; intent : compter le visuel, pas les physiques)', () => {
  assert.equal(formatSelectionContext(ST, { kind: 'doc' }), '2 pages · 3 composants');
});

test('formatSelectionContext : page → nom + index base 1 + nb placements de CETTE page', () => {
  const s = formatSelectionContext(ST, { kind: 'page', page: 0 });
  assert.match(s, /Accueil/);
  assert.match(s, /1\/2/);
  assert.match(s, /2 composants/);
});

test('formatSelectionContext : comp → libellé de type + ref + page + visible (intent : identifier l’élément édité d’un coup d’œil)', () => {
  const s = formatSelectionContext(ST, { kind: 'comp', page: 0, index: 0 });
  assert.match(s, /Anneau/);     // COMPONENTS.ring.label
  assert.match(s, /ring1/);
  assert.match(s, /Accueil/);
  assert.match(s, /visible/);
});

test('formatSelectionContext : comp masqué → « masqué » (intent : signaler visible:false dans le contexte)', () => {
  const s = formatSelectionContext(ST, { kind: 'comp', page: 1, index: 0 });
  assert.match(s, /Image/);      // COMPONENTS.image.label
  assert.match(s, /masqué/);
});

test('formatSelectionContext : comp à ref orpheline → repli « ? » sans throw (intent : robustesse, ne pas casser la barre)', () => {
  const orphan = { pages: [{ name: 'P', place: [{ ref: 'nope' }] }], components: {} };
  const s = formatSelectionContext(orphan, { kind: 'comp', page: 0, index: 0 });
  assert.match(s, /\?/);
  assert.match(s, /nope/);
});

test('formatSelectionContext : sélection périmée (index hors place) → chaîne vide, pas de throw', () => {
  assert.equal(formatSelectionContext(ST, { kind: 'comp', page: 0, index: 9 }), '');
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run: `cd designer && node --test tests/statusbar.test.js`
Expected: FAIL — `formatSelectionContext` introuvable.

- [ ] **Step 3 : Implémenter le minimum**

Ajouter dans `designer/js/statusbar.js`, après `formatValidationSummary` :

```js
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const placements = p => (Array.isArray(p?.place) ? p.place.length : 0);

// Contexte de sélection pour la gauche de la barre (lu sur le store selection + le modèle). Pur. Décompte
// « composants » = placements visuels (somme des place[]), cohérent avec l'arbre (les physiques led_ring/sound
// ne sont pas placés → exclus). Repli '?' sur ref orpheline ; '' sur sélection périmée (l'intégration purge,
// mais on ne throw jamais — la barre doit rester affichable).
export function formatSelectionContext(state, sel) {
  if (!sel) return 'Rien de sélectionné';
  const pages = Array.isArray(state?.pages) ? state.pages : [];
  if (sel.kind === 'doc') {
    const total = pages.reduce((n, p) => n + placements(p), 0);
    return `${plural(pages.length, 'page')} · ${plural(total, 'composant')}`;
  }
  const page = pages[sel.page];
  if (!page) return '';
  if (sel.kind === 'page') {
    return `Page « ${page.name ?? ''} » (${sel.page + 1}/${pages.length}) · ${plural(placements(page), 'composant')}`;
  }
  // comp
  const pl = page.place?.[sel.index];
  if (!pl) return '';
  const c = state.components?.[pl.ref];
  const typeLabel = (c && COMPONENTS[c.type]?.label) || '?';
  const vis = c && c.visible === false ? 'masqué' : 'visible';
  const dx = pl.dx ?? 0, dy = pl.dy ?? 0;
  return `${typeLabel} · ${pl.ref} · page « ${page.name ?? ''} » · ${pl.anchor ?? 'CENTER'} (${dx}, ${dy}) · ${vis}`;
}
```

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

Run: `cd designer && node --test tests/statusbar.test.js`
Expected: PASS (5 + 7 tests).

- [ ] **Step 5 : Lancer la suite complète (non-régression)**

Run: `cd designer && node --test`
Expected: PASS, total **313** (301 + 12).

- [ ] **Step 6 : Commit**

```bash
git add designer/js/statusbar.js designer/tests/statusbar.test.js
git commit -m "designer: statusbar — formatSelectionContext pur (contexte doc/page/comp, testé node)"
```

---

## Task 3 : `createStatusbar` (DOM) + markup + CSS + câblage

**Files:**
- Modify: `designer/js/statusbar.js` (ajout `createStatusbar`)
- Modify: `designer/index.html` (retire le groupe Zoom de la toolbar ; ajoute `<div id="statusbar">`)
- Modify: `designer/style.css` (`.statusbar` et enfants)
- Modify: `designer/js/app.js` (instancie `createStatusbar`)

> DOM non unit-testable ici (convention projet) → vérif navigateur en fin de tâche.

- [ ] **Step 1 : Ajouter `createStatusbar` dans `designer/js/statusbar.js`**

Ajouter en bas du fichier :

```js
// --- DOM (vérifié navigateur ; pas de test node, cf. convention projet) ---
// Barre d'état : gauche = contexte de sélection (s'abonne à selection + model) ; droite = verdict de
// validation cliquable (s'abonne à model → validate) qui ouvre la console Problèmes (onValidClick). Le
// <select id="zoom"> vit dans le markup à droite (display-only, câblé par app.js — pas géré ici).
export function createStatusbar(root, model, { selection, validate, onValidClick }) {
  const context = document.createElement('span');
  context.className = 'sb-context';
  const valid = document.createElement('button');
  valid.type = 'button';
  valid.className = 'sb-valid';
  valid.title = 'Voir les problèmes';
  valid.onclick = () => onValidClick?.();
  const spacer = document.createElement('span');
  spacer.className = 'sb-spacer';
  // Ordre : contexte | spacer | validation | (zoom déjà présent dans le markup HTML à droite).
  root.prepend(context, spacer, valid);

  const renderContext = () => { context.textContent = formatSelectionContext(model.state, selection.get()); };
  const renderValid = () => {
    const r = formatValidationSummary(validate(model.state));
    valid.textContent = r.text;
    valid.className = 'sb-valid sb-' + r.level;
  };
  // Le contexte dépend de la sélection ET du modèle (un rename/déplacement change le libellé sans changer
  // la sélection). La validation ne dépend que du modèle.
  selection.subscribe(renderContext);
  model.subscribe(() => { renderContext(); renderValid(); });
  renderContext(); renderValid();
}
```

- [ ] **Step 2 : Markup `index.html` — retirer le groupe Zoom de la toolbar**

Dans `designer/index.html`, **supprimer** ce bloc de `<header>` (lignes ~36-45) :

```html
    <!-- Affichage : zoom du canvas (visuel uniquement, n'affecte pas le layout) -->
    <div class="hgroup">
      <label>Zoom
        <select id="zoom" title="Échelle d'affichage du canvas (n'affecte pas le layout)">
          <option value="1">1×</option>
          <option value="1.5">1,5×</option>
          <option value="2">2×</option>
        </select>
      </label>
    </div>
```

- [ ] **Step 3 : Markup `index.html` — ajouter la barre d'état après `</main>`**

Juste après `</main>` (ligne ~63) et **avant** `<footer>`, insérer :

```html
  <div id="statusbar" class="statusbar">
    <!-- contexte (gauche) + validation injectés par statusbar.js ; zoom (display-only) câblé par app.js -->
    <label class="sb-zoom">Zoom
      <select id="zoom" title="Échelle d'affichage du canvas (n'affecte pas le layout)">
        <option value="1">1×</option>
        <option value="1.5">1,5×</option>
        <option value="2">2×</option>
      </select>
    </label>
  </div>
```

- [ ] **Step 4 : CSS structurelle `designer/style.css`**

Ajouter après la règle `footer { … }` (ligne ~85) :

```css
/* --- Barre d'état (Phase 6) : contexte de sélection (gauche) · validation cliquable + zoom (droite) --- */
.statusbar { display: flex; align-items: center; gap: 12px; padding: 5px 14px;
  border-top: 1px solid var(--line); background: var(--panel-2); font-size: 12.5px; color: var(--muted); }
.sb-context { color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sb-spacer { flex: 1 1 auto; }
.sb-valid { font-size: 12.5px; padding: 2px 8px; border-color: transparent; }
.sb-valid.sb-ok { color: var(--ok); }
.sb-valid.sb-warn { color: var(--warn); }
.sb-valid.sb-err { color: var(--err); }
.sb-zoom { display: flex; align-items: center; gap: 6px; color: var(--muted); }
```

- [ ] **Step 5 : Câblage `app.js` — instancier la barre d'état**

Dans `designer/js/app.js`, ajouter l'import en tête (après l'import de `json-view`, qu'on retirera Task 4) :

```js
import { createStatusbar } from './statusbar.js';
```

Puis, juste **après** le bloc `bindJsonView(...)` (lignes ~170-172), ajouter (l'ouverture de console viendra Task 4 ; pour l'instant un no-op) :

```js
  createStatusbar($('statusbar'), model, { selection, validate, onValidClick: () => {} });
```

- [ ] **Step 6 : Vérif syntaxe**

Run: `cd designer && node --check js/statusbar.js && node --check js/app.js && node --test`
Expected: pas d'erreur de syntaxe ; **313/313**.

- [ ] **Step 7 : Vérif navigateur (Playwright, no-store, racine repo)**

Servir depuis la racine en no-store, ouvrir `http://127.0.0.1:<port>/designer/`. Vérifier (captures envoyées à l'utilisateur) :
- Barre d'état visible sous le canvas ; **au boot** (sélection Document) → gauche affiche `N pages · M composants`, droite affiche `✓ valide` (ou `· N avert.`).
- Sélectionner une page dans l'arbre → contexte `Page « … » (i/n) · M composants`. Sélectionner un composant (arbre ou canvas) → `<type> · <ref> · page … · <anchor> (dx,dy) · visible`.
- Le **zoom** fonctionne toujours (changer 1×→2×, le canvas grossit ; reload → échelle persistée).
- Échap → `Rien de sélectionné`.
- Toolbar : plus de groupe Zoom en haut.

- [ ] **Step 8 : Commit**

```bash
git add designer/js/statusbar.js designer/index.html designer/style.css designer/js/app.js
git commit -m "designer: barre d'état — contexte de sélection + verdict validation + zoom migré"
```

---

## Task 4 : `console.js` (Problèmes | Source) + scission `json-view.js` + nettoyages

**Files:**
- Create: `designer/js/console.js`
- Delete: `designer/js/json-view.js`
- Modify: `designer/index.html` (retire le `<details>` JSON du footer ; ajoute `<section id="console">`)
- Modify: `designer/style.css` (`.console` et enfants)
- Modify: `designer/js/app.js` (retire `bindJsonView` ; instancie `createConsole` ; relie le clic validation ; retire la garde « Modifs JSON non appliquées » et les `$('json').blur()`)

> DOM non unit-testable → vérif navigateur en fin de tâche.

- [ ] **Step 1 : Créer `designer/js/console.js`**

```js
// Console bas repliable (Phase 6, spec §5) : deux onglets [Problèmes | Source]. Cachée (corps replié) par
// défaut ; le bandeau (onglets + ▲▼) reste comme poignée. S'abonne au modèle : re-rend la liste de problèmes
// (validate) et la vue Source (model.toJSON()). Câblage DOM, vérifié navigateur (pas de test node).
export function createConsole(root, model, { validate }) {
  let tab = 'problems';     // onglet actif
  let open = false;         // corps déplié ?

  // --- Bandeau : onglets + bascule de pliage ---
  const head = document.createElement('div');
  head.className = 'console-head';
  const tabProblems = document.createElement('button');
  tabProblems.type = 'button'; tabProblems.className = 'console-tab'; tabProblems.textContent = 'Problèmes';
  const tabSource = document.createElement('button');
  tabSource.type = 'button'; tabSource.className = 'console-tab'; tabSource.textContent = 'Source';
  const spacer = document.createElement('span'); spacer.className = 'console-spacer';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'console-toggle'; toggle.title = 'Replier / déplier la console';
  head.append(tabProblems, tabSource, spacer, toggle);

  // --- Corps : panneau Problèmes (liste) + panneau Source (pre lecture seule + Copier) ---
  const body = document.createElement('div');
  body.className = 'console-body';
  const problems = document.createElement('div');
  problems.className = 'console-problems';
  const source = document.createElement('div');
  source.className = 'console-source';
  const pre = document.createElement('pre'); pre.className = 'console-json';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button'; copyBtn.className = 'console-copy'; copyBtn.textContent = 'Copier';
  source.append(copyBtn, pre);
  body.append(problems, source);
  root.append(head, body);

  const syncView = () => {
    root.classList.toggle('open', open);
    body.hidden = !open;
    tabProblems.classList.toggle('active', tab === 'problems');
    tabSource.classList.toggle('active', tab === 'source');
    problems.hidden = tab !== 'problems';
    source.hidden = tab !== 'source';
    toggle.textContent = open ? '▾' : '▴';
  };

  const renderProblems = () => {
    const { errors = [], warnings = [] } = validate(model.state);
    problems.replaceChildren();
    if (!errors.length && !warnings.length) {
      const ok = document.createElement('div'); ok.className = 'console-empty'; ok.textContent = 'Aucun problème.';
      problems.append(ok);
      return;
    }
    for (const e of errors) {
      const li = document.createElement('div'); li.className = 'console-err'; li.textContent = '✗ ' + e; problems.append(li);
    }
    for (const w of warnings) {
      const li = document.createElement('div'); li.className = 'console-warn'; li.textContent = '⚠ ' + w; problems.append(li);
    }
  };
  const renderSource = () => { pre.textContent = model.toJSON(); };

  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(model.toJSON()); copyBtn.textContent = 'Copié ✓'; }
    catch (e) { copyBtn.textContent = 'Échec copie'; }
    setTimeout(() => { copyBtn.textContent = 'Copier'; }, 1500);
  };

  const selectTab = (t) => { tab = t; open = true; syncView(); };
  tabProblems.onclick = () => selectTab('problems');
  tabSource.onclick = () => selectTab('source');
  toggle.onclick = () => { open = !open; syncView(); };

  model.subscribe(() => { renderProblems(); renderSource(); });
  renderProblems(); renderSource(); syncView();

  return {
    // Ouvre la console sur un onglet (appelé par le clic validation de la barre d'état → 'problems').
    open(t = 'problems') { selectTab(t); },
  };
}
```

- [ ] **Step 2 : Markup `index.html` — retirer le `<details>` JSON du footer**

Dans `designer/index.html`, **supprimer** ce bloc du `<footer>` (lignes ~74-83) :

```html
    <details>
      <summary>JSON avancé</summary>
      <textarea id="json" spellcheck="false"></textarea>
      <div class="row">
        <button id="apply">Appliquer le JSON</button>
        <span id="valid" class="valid"></span>
      </div>
      <pre id="errors" class="errors"></pre>
      <pre id="warnings" class="warnings"></pre>
    </details>
```

(Le footer garde ses `<details>` Device + Sources — la Phase 7 les déplacera.)

- [ ] **Step 3 : Markup `index.html` — ajouter la console après la barre d'état**

Juste **après** `<div id="statusbar">…</div>` (ajouté Task 3) et **avant** `<footer>`, insérer :

```html
  <section id="console" class="console"><!-- bandeau + corps injectés par console.js --></section>
```

- [ ] **Step 4 : CSS structurelle `designer/style.css`**

Ajouter après les règles `.statusbar`/`.sb-*` (Task 3). **Retirer aussi** les règles désormais mortes : `textarea { … }` (ligne ~86), `.row` (ligne ~87 — vérifié : seul usage était le `<div class="row">` du bloc JSON supprimé Step 2), `.valid`/`.valid.ok`/`.valid.err` (lignes ~88-90), `.errors` (ligne ~91), `.warnings` (ligne ~92) : leurs éléments (`#json`/`#valid`/`#errors`/`#warnings`) ont disparu du footer.

```css
/* --- Console bas repliable (Phase 6) : [Problèmes | Source], corps replié par défaut --- */
.console { border-top: 1px solid var(--line); background: var(--panel-2); }
.console-head { display: flex; align-items: center; gap: 4px; padding: 4px 10px; }
.console-tab { font-size: 12px; padding: 3px 10px; color: var(--muted); }
.console-tab.active { color: var(--ink); border-color: var(--accent); }
.console-spacer { flex: 1 1 auto; }
.console-toggle { padding: 2px 8px; }
.console-body { max-height: 30vh; overflow: auto; padding: 8px 12px; border-top: 1px solid var(--line); }
.console-problems { display: flex; flex-direction: column; gap: 3px; font: 12px/1.4 var(--font-mono); }
.console-empty { color: var(--muted); font-style: italic; }
.console-err { color: var(--err); white-space: pre-wrap; }
.console-warn { color: var(--warn); white-space: pre-wrap; }
.console-source { position: relative; }
.console-copy { position: absolute; top: 0; right: 0; font-size: 12px; padding: 2px 8px; }
.console-json { margin: 0; background: #0a0a0e; color: #cbd5e1; border: 1px solid var(--line);
  border-radius: 8px; font: 12.5px/1.5 var(--font-mono); padding: 10px; white-space: pre-wrap; word-break: break-all; }
```

- [ ] **Step 5 : Supprimer `json-view.js`**

```bash
git rm designer/js/json-view.js
```

- [ ] **Step 6 : `app.js` — retirer `bindJsonView`, instancier la console, relier le clic validation**

Dans `designer/js/app.js` :

1. **Retirer** l'import (ligne ~3) :
```js
import { bindJsonView } from './json-view.js';
```
2. **Ajouter** l'import :
```js
import { createConsole } from './console.js';
```
3. **Remplacer** le bloc `bindJsonView(...)` (lignes ~170-172) par :
```js
  const dconsole = createConsole($('console'), model, { validate });
```
4. **Modifier** l'appel `createStatusbar` (ajouté Task 3) pour router le clic validation vers la console :
```js
  createStatusbar($('statusbar'), model, { selection, validate, onValidClick: () => dconsole.open('problems') });
```
(Déclarer `dconsole` AVANT `createStatusbar` — déplacer l'appel `createStatusbar` après `createConsole` si besoin.)

- [ ] **Step 7 : `app.js` — retirer la garde JSON obsolète et les blur du textarea**

1. Handlers undo/redo (lignes ~176-177) — retirer `$('json').blur()` :
```js
  $('undo').onclick = () => { model.undo(); };
  $('redo').onclick = () => { model.redo(); };
```
2. Handler push (ligne ~314) — **retirer** la garde (la vue Source est lecture seule, plus de divergence textarea↔modèle possible) :
```js
    if ($('json').value.trim() !== model.toJSON().trim()) return void showToast('Modifs JSON non appliquées — clique « Appliquer » d’abord');
```
La validité reste contrôlée par la ligne suivante (`if (!validate(model.state).valid) return void showToast('Layout invalide');`) — conservée.

- [ ] **Step 8 : Vérif syntaxe + grep anti-référence morte**

Run:
```bash
cd designer && node --check js/console.js && node --check js/app.js && node --test
grep -rn "json-view\|bindJsonView\|getElementById('json')\|\$('json')\|'apply'\|'errors'\|'warnings'\|getElementById('valid')\|\$('valid')" js/ index.html
```
Expected: `node --test` **313/313** ; le grep ne renvoie **plus aucune** référence à `json`/`apply`/`valid`/`errors`/`warnings` (sinon nettoyer). `node --check` OK.

- [ ] **Step 9 : Vérif navigateur (Playwright, no-store, racine repo)**

Servir depuis la racine en no-store, ouvrir `http://127.0.0.1:<port>/designer/`. Vérifier (captures) :
- **Console repliée** au boot (bandeau [Problèmes | Source] + ▾/▴ visible, corps masqué). Footer ne montre plus « JSON avancé ».
- Clic sur le verdict de validation en barre d'état → console s'ouvre sur **Problèmes**. Sur un layout valide → « Aucun problème. ». Forcer une erreur (p. ex. injecter un layout à `ref` inconnue via `localStorage`/import) → la liste montre `✗ référence inconnue …` et la barre d'état passe à `✗ 1 erreur` (rouge).
- Onglet **Source** → JSON en lecture seule (non éditable) reflétant le modèle ; éditer un composant dans l'inspecteur met à jour le JSON. **Copier** → presse-papier contient le JSON (`Copié ✓`).
- ▾/▴ replie/déplie ; l'onglet actif reste surligné.
- **Pousser** fonctionne sans la garde « Modifs JSON » (ne plus voir ce toast) ; un layout invalide bloque toujours (`Layout invalide`).
- **Non-régression** : undo/redo OK (sans le blur disparu) ; sélection canvas/arbre/inspecteur intacte (gardes F1/F5).

- [ ] **Step 10 : Commit**

```bash
git add designer/js/console.js designer/index.html designer/style.css designer/js/app.js
git rm designer/js/json-view.js
git commit -m "designer: console [Problèmes|Source] + validation décrochée (json-view dissous)"
```

---

## Task 5 : Vérification finale + mise à jour HANDOFF

**Files:**
- Modify: `docs/_internal/HANDOFF.md` (phasage : Phase 6 ✅)

- [ ] **Step 1 : Suite complète verte**

Run: `cd designer && node --test`
Expected: **313/313**, 0 fail.

- [ ] **Step 2 : Grep final anti-résidu**

Run:
```bash
cd designer && grep -rn "json-view\|bindJsonView\|#status\|setStatus\|devbar" js/ index.html style.css || echo "OK : aucun résidu"
```
Expected: `OK : aucun résidu` (json-view dissous ; #status/devbar déjà retirés en Phase 5).

- [ ] **Step 3 : Récapitulatif de vérif navigateur**

Liste de contrôle (captures envoyées à l'utilisateur, qui est le juge visuel) :
- Barre d'état : 4 contextes (doc/page/comp/rien) corrects ; zoom fonctionnel et persistant.
- Validation : `✓ valide` / `✓ valide · N avert.` / `✗ N erreurs` selon le modèle ; clic → console Problèmes.
- Console : repli par défaut, onglets, Source lecture seule + Copier, ▾/▴.
- Non-régression : undo/redo, sélection F1/F5, push (garde validité conservée, garde JSON retirée).

- [ ] **Step 4 : Mettre à jour `docs/_internal/HANDOFF.md`**

Marquer la Phase 6 ✅ dans la section phasage (ligne « 6-7. ») et la date du jour ; pointer le plan `2026-06-22-designer-refonte-statusbar-console-phase6.md` ; noter « Reste : Phase 7 (tiroir Device + retrait footer) ». Mettre à jour le compte `node --test` (313).

- [ ] **Step 5 : Commit**

```bash
git add docs/_internal/HANDOFF.md
git commit -m "docs(handoff): Phase 6 designer ✅ (barre d'état + console + validation décrochée)"
```

---

## Self-Review (couverture spec)

- **§4 barre d'état** — gauche contexte (`formatSelectionContext`, Task 2/3) ✅ ; droite validation cliquable (`formatValidationSummary` + `onValidClick`, Task 1/3/4) ✅ ; zoom migré display-only (Task 3) ✅ ; pastille device reste en toolbar (Phase 5, non touchée) ✅.
- **§5 console** — Problèmes (liste errors/warnings humanisées, Task 4) ✅ ; Source lecture seule + Copier, plus de textarea/Appliquer/garde (Task 4, Step 7) ✅ ; ouverte au clic validation (Task 4, Step 6) ✅ ; cachée par défaut (corps replié, Task 4, Step 1) ✅.
- **§5 validation décrochée** — `json-view.js` dissous, `validate.js` réutilisé inchangé (Task 4, Step 5) ✅.
- **Tiroir Device + retrait footer** — **hors Phase 6** (Phase 7). Le footer Device/Sources reste transitoirement.
- **Tests** — fonctions pures testées node (Task 1/2) ; DOM vérifié navigateur (Task 3/4). Conforme à la contrainte « node --test sans DOM ».
- **Invariants F1/F5** — non touchés (ni canvas ni inspecteur composant modifiés) ; vérifiés en non-régression (Task 4, Step 9).
