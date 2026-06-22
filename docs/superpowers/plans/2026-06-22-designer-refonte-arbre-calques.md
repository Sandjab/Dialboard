# Arbre des calques (Phase 3a — MVP navigable) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la barre d'onglets `nav#pages` par un **arbre des calques** (Document → pages → composants en z-order inversé) qui pilote la sélection partagée et reprend le CRUD des pages — sans régression du designer.

**Architecture:** Un module neuf `tree.js` à deux faces : une **fonction pure** `treeModel(state)` (structure de l'arbre, z-order inversé, libellés — testée sous `node --test`) et un **rendu DOM** `createTree(root, model, deps)` (vérifié au navigateur, comme `pages.js`/`canvas.js`). Il vit dans un **dock gauche** (colonne `#palette` empilée avec un panneau `#layers`), lit/écrit la **sélection partagée** (`selection.js`, déjà câblée au canvas+inspecteur) via le coordinateur `setSelection` d'`app.js` (gardes F1/F5), et réutilise les **mutations existantes** (`addPage`/`renamePage`/`reorderPages`/`removePage`, plus la page active de `canvas.js`). `nav#pages` reste comme filet jusqu'à la dernière tâche.

**Tech Stack:** JS modules ES (designer), `node --test` (logique pure, sans DOM), CSS structurelle (variables existantes `--panel/--line/--ink/--accent/--muted`). Aucun changement schéma ni firmware.

**Hors périmètre de ce plan (→ Phase 3b)** : drag & drop (reorder z-order intra-page + déplacer un placement entre pages avec « la sélection suit l'élément »), menu contextuel clic-droit, raccourci **F2**, renommage de l'**id** d'un composant (`renameComponent`), duplication de page, expansion multi-pages indépendante. Le MVP **déplie la seule page active** ; cliquer une page repliée l'active (= la déplie).

---

## File Structure

- **Create** `designer/js/tree.js` — `treeModel(state)` (pur) + `createTree(root, model, { selection, setSelection, getActivePage, setPage })` (DOM). Responsabilité unique : l'arbre des calques.
- **Create** `designer/tests/tree.test.js` — tests node de `treeModel` (z-order inversé, index réels, visible, libellés, fallback ref cassée).
- **Modify** `designer/index.html` — colonne gauche → dock (`#palette` + `#layers`) ; retrait de `nav#pages` (Task 6).
- **Modify** `designer/style.css` — CSS structurel `.dock-left` / `.tree-*` ; retrait du CSS `.pages-bar`/`.page-*` (Task 6).
- **Modify** `designer/js/app.js` — instancier `createTree($('layers'), …)` ; retirer `createPages`/`pages.js` du câblage (Task 6) ; remplacer `pages.render()` par `tree.render()` dans `bindFileIO` onLoad.
- **Delete** `designer/js/pages.js` (Task 6, devient mort — logique UI absorbée par `tree.js`, mutations déjà dans `mutations.js`).

Les mutations `reorderPlacement`/`movePlacementToPage`/`renameComponent` (Phase 1) existent déjà : ce plan **ne les réécrit pas** (elles serviront en 3b ; le MVP n'en utilise aucune).

---

## Task 1: `treeModel(state)` — structure pure de l'arbre + tests

**Files:**
- Create: `designer/js/tree.js`
- Test: `designer/tests/tree.test.js`

**Contexte.** `treeModel` transforme le `state` du layout en la structure que le rendu DOM consommera. Règles (cf. spec §1) : les pages dans l'ordre de `pages[]` (= ordre de navigation) ; les composants d'une page dans l'**ordre inversé** de `place[]` (dernier placement = dessus = première ligne) ; chaque composant garde son **index réel** dans `place[]` (cible de `setSelection {kind:'comp', index}` et des mutations) ; `visible` vaut `false` seulement si la clé `visible` est explicitement `false` ; le libellé de type vient du registre (`COMPONENTS[type].label`), avec repli `'?'` si le `ref` est orphelin (composant supprimé mais placement résiduel — la validation le signale par ailleurs, mais l'arbre doit rester affichable).

- [ ] **Step 1: Write the failing test**

Créer `designer/tests/tree.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeModel } from '../js/tree.js';

// État avec 2 pages ; page 0 a 3 placements dans l'ordre [ring, readout, image].
const fresh = () => ({
  title: 'Mon dash',
  components: {
    temp_ring: { type: 'ring', color: '#fff' },
    temp_val:  { type: 'readout' },
    logo_bg:   { type: 'image', visible: false },
  },
  pages: [
    { name: 'Accueil', place: [
      { ref: 'temp_ring', radius: 80 },
      { ref: 'temp_val', anchor: 'CENTER' },
      { ref: 'logo_bg', anchor: 'CENTER' },
    ] },
    { name: 'Détails', place: [] },
  ],
});

test('treeModel expose le titre et les pages dans l’ordre de navigation', () => {
  const t = treeModel(fresh());
  assert.equal(t.title, 'Mon dash');
  assert.deepEqual(t.pages.map(p => p.name), ['Accueil', 'Détails']);
  assert.deepEqual(t.pages.map(p => p.index), [0, 1]);
});

test('treeModel rend les composants en z-order INVERSÉ avec leur index RÉEL', () => {
  const comps = treeModel(fresh()).pages[0].components;
  // place[] = [ring(0), readout(1), image(2)] → affichage [image, readout, ring]
  assert.deepEqual(comps.map(c => c.ref), ['logo_bg', 'temp_val', 'temp_ring']);
  assert.deepEqual(comps.map(c => c.index), [2, 1, 0]);   // index dans place[], pas l'ordre d'affichage
});

test('treeModel dérive le libellé de type depuis le registre', () => {
  const comps = treeModel(fresh()).pages[0].components;
  const byRef = Object.fromEntries(comps.map(c => [c.ref, c]));
  assert.equal(byRef.temp_ring.type, 'ring');
  assert.equal(byRef.temp_ring.label, 'Anneau');   // COMPONENTS.ring.label
  assert.equal(byRef.temp_val.label, 'Lecture');   // COMPONENTS.readout.label
});

test('treeModel : visible=false seulement si la clé vaut explicitement false', () => {
  const comps = treeModel(fresh()).pages[0].components;
  const byRef = Object.fromEntries(comps.map(c => [c.ref, c]));
  assert.equal(byRef.logo_bg.visible, false);   // visible:false dans le composant
  assert.equal(byRef.temp_val.visible, true);   // clé absente → visible
});

test('treeModel : ref orpheline → type null, libellé de repli, ligne conservée', () => {
  const s = fresh();
  s.pages[0].place.push({ ref: 'fantome' });   // aucun composant 'fantome'
  const comps = treeModel(s).pages[0].components;
  const ghost = comps.find(c => c.ref === 'fantome');
  assert.equal(ghost.type, null);
  assert.equal(ghost.label, '?');
  assert.equal(ghost.visible, true);
});

test('treeModel tolère un état vide / sans pages (pas de throw)', () => {
  assert.deepEqual(treeModel({}).pages, []);
  assert.equal(treeModel({}).title, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd designer && node --test tests/tree.test.js`
Expected: FAIL — `treeModel` n'existe pas (`tree.js` absent / pas d'export).

- [ ] **Step 3: Write minimal implementation**

Créer `designer/js/tree.js` (partie pure uniquement pour l'instant) :

```js
// Arbre des calques du designer. Deux faces : treeModel (pur, testé node) calcule la structure
// affichée ; createTree (plus bas, Task 2+) en fait du DOM et pilote la sélection partagée.
// Remplace nav#pages : Document → pages (ordre nav) → composants (z-order INVERSÉ). cf. spec §1.
import { COMPONENTS } from './registry.js';

// Structure pure pour le rendu. Les composants sont renvoyés en ordre inversé (dernier placement =
// dessus = première ligne) MAIS chaque item garde son index RÉEL dans place[] (cible de la sélection
// et des mutations). visible=false seulement si la clé vaut explicitement false (cohérent firmware/
// canvas/inspecteur). Le libellé vient du registre ; repli '?' si le ref est orphelin.
export function treeModel(state) {
  const comps = state?.components || {};
  const pages = (state?.pages || []).map((p, index) => {
    const place = Array.isArray(p.place) ? p.place : [];
    const components = place
      .map((pl, i) => {
        const c = comps[pl.ref];
        const type = c?.type ?? null;
        return {
          index: i,                                   // position réelle dans place[]
          ref: pl.ref,
          type,
          label: (type && COMPONENTS[type]?.label) || '?',
          visible: c?.visible !== false,
        };
      })
      .reverse();                                     // z-order inversé : dessus en premier
    return { index, name: p.name, components };
  });
  return { title: state?.title ?? '', pages };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd designer && node --test tests/tree.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full designer suite (no regression)**

Run: `cd designer && node --test`
Expected: tout vert (les tests existants + les 6 neufs).

- [ ] **Step 6: Commit**

```bash
git add designer/js/tree.js designer/tests/tree.test.js
git commit -m "$(cat <<'EOF'
designer: tree.js — treeModel pur (z-order inversé, libellés, visible) + tests

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP
EOF
)"
```

---

## Task 2: Panneau Calques (dock) + rendu DOM de l'arbre en lecture

**Files:**
- Modify: `designer/index.html:53-64` (la `<main>` : colonne gauche → dock `#palette` + `#layers`)
- Modify: `designer/style.css` (ajout `.dock-left` / `.tree-*` après le bloc `.col`, ~ligne 42)
- Modify: `designer/js/tree.js` (ajout de `createTree` — rendu lecture seule)
- Modify: `designer/js/app.js:104-108` (instancier `createTree`)

**Contexte.** On introduit l'arbre **à côté** de `nav#pages` (qui reste le pilote des pages jusqu'à Task 6). Cette tâche n'ajoute **aucune interaction** : juste l'affichage de la structure (Document, pages, composants de la page active). La sélection vient en Task 3.

- [ ] **Step 1: HTML — colonne gauche en dock (Palette + Calques)**

Dans `designer/index.html`, remplacer le bloc `<main>` (lignes 53-64) par :

```html
  <main>
    <div class="dock-left">
      <aside id="palette" class="col"><h2>Palette</h2></aside>
      <aside id="layers" class="col"><h2>Calques</h2></aside>
    </div>
    <section id="canvas-col" class="col">
      <h2>Canvas</h2>
      <div id="stage-wrap" class="stage-wrap">
        <div id="stage" class="stage">
          <div class="screen-circle"></div>
        </div>
      </div>
    </section>
    <aside id="inspector" class="col"><h2>Inspecteur</h2></aside>
  </main>
```

(La 1re colonne de la grille `main` contient désormais le dock ; `#palette` reste l'élément ciblé par `createPalette($('palette'))`, inchangé.)

- [ ] **Step 2: CSS — dock + lignes d'arbre**

Dans `designer/style.css`, après la règle `.col h2 { … }` (~ligne 42), ajouter :

```css
/* --- Dock gauche : Palette empilée sur Calques (Arrangement A) --- */
.dock-left { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
#layers { flex: 1 1 auto; min-height: 120px; max-height: 60vh; overflow: auto; }

/* --- Arbre des calques --- */
.tree { display: flex; flex-direction: column; gap: 1px; }
.tree-row { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 5px;
  cursor: pointer; color: var(--ink); font-size: 12.5px; white-space: nowrap; }
.tree-row:hover { background: #16161c; }
.tree-row.selected { background: rgba(167, 139, 250, .14); box-shadow: inset 0 0 0 1px var(--accent); }
.tree-twist { width: 12px; text-align: center; color: var(--muted); flex: none; }
.tree-icon { width: 16px; height: 16px; flex: none; color: var(--muted); }
.tree-label { overflow: hidden; text-overflow: ellipsis; }
.tree-ref { color: var(--muted); font-family: var(--font-mono); font-size: 11.5px; }
.tree-comp { padding-left: 22px; }          /* indentation sous la page */
.tree-comp.hidden .tree-label,
.tree-comp.hidden .tree-ref { opacity: .45; text-decoration: line-through; }
.tree-spacer { flex: 1 1 auto; }            /* pousse l'œil/contrôles à droite */
```

- [ ] **Step 3: `createTree` — rendu lecture seule**

Ajouter à la fin de `designer/js/tree.js` :

```js
import { iconFor } from './icons.js';

// Rendu DOM de l'arbre + pilotage de la sélection partagée. Mêmes deps que pages.js (getActivePage/
// setPage : la page active vit dans canvas.js) PLUS le store de sélection (selection/setSelection).
// La sélection et les interactions arrivent en Task 3 ; ici, rendu lecture seule.
export function createTree(root, model, { selection, setSelection, getActivePage = () => 0, setPage } = {}) {
  // Backstop identique à pages.js : après removePage/undo/import l'index actif peut dépasser la liste.
  function clampActive() {
    const n = model.state.pages?.length ?? 0;
    if (n && getActivePage() > n - 1) setPage(n - 1);
  }

  function compRow(c) {
    const row = document.createElement('div');
    row.className = 'tree-row tree-comp' + (c.visible ? '' : ' hidden');
    const ic = c.type ? iconFor(c.type) : null;
    if (ic) { ic.classList.add('tree-icon'); row.appendChild(ic); }
    const lbl = document.createElement('span'); lbl.className = 'tree-label'; lbl.textContent = c.label;
    const ref = document.createElement('span'); ref.className = 'tree-ref'; ref.textContent = c.ref;
    row.appendChild(lbl); row.appendChild(ref);
    return row;
  }

  function pageRow(p, active) {
    const row = document.createElement('div');
    row.className = 'tree-row tree-page';
    const tw = document.createElement('span'); tw.className = 'tree-twist'; tw.textContent = active ? '▾' : '▸';
    const lbl = document.createElement('span'); lbl.className = 'tree-label';
    lbl.textContent = p.name || `Page ${p.index + 1}`;
    row.appendChild(tw); row.appendChild(lbl);
    return row;
  }

  function render() {
    clampActive();
    root.querySelectorAll('.tree').forEach(n => n.remove());
    const t = treeModel(model.state);
    const active = getActivePage();
    const tree = document.createElement('div'); tree.className = 'tree';

    // Document
    const doc = document.createElement('div'); doc.className = 'tree-row tree-doc';
    const dtw = document.createElement('span'); dtw.className = 'tree-twist'; dtw.textContent = '⚙';
    const dlbl = document.createElement('span'); dlbl.className = 'tree-label';
    dlbl.textContent = `Document — ${t.title || '(sans titre)'}`;
    doc.appendChild(dtw); doc.appendChild(dlbl);
    tree.appendChild(doc);

    // Pages (+ composants de la page active uniquement, MVP)
    t.pages.forEach(p => {
      tree.appendChild(pageRow(p, p.index === active));
      if (p.index === active) p.components.forEach(c => tree.appendChild(compRow(c)));
    });

    root.appendChild(tree);
  }

  model.subscribe(render);
  render();
  return { render };
}
```

- [ ] **Step 4: Câbler dans `app.js`**

Dans `designer/js/app.js`, ajouter l'import en tête (près des autres `create*`) :

```js
import { createTree } from './tree.js';
```

Puis, juste **après** le bloc `createPages(…)` (lignes 110-114), ajouter :

```js
  // Arbre des calques (dock gauche). Coexiste avec nav#pages jusqu'à son retrait (Phase 3a, dernière tâche).
  const tree = createTree($('layers'), model, {
    selection, setSelection,
    getActivePage: canvas.getActivePage,
    setPage: i => canvas.setPage(i),
  });
```

- [ ] **Step 5: Vérification navigateur**

Servir depuis la **racine du repo** (pas `designer/`) pour que `../schema/…` se charge, avec cache désactivé (évite le piège du module ES figé, cf. HANDOFF). Choisir un port libre **autre que 8000** (réservé) :

Run (depuis `/Users/jean-paulgavini/Documents/Dev/Dialboard`) : `python3 -m http.server 8779`
Ouvrir : `http://127.0.0.1:8779/designer/`

Vérifier (verdict visuel = utilisateur) :
- Le dock gauche montre **Palette** au-dessus, **Calques** en dessous.
- L'arbre affiche `⚙ Document — <titre>`, puis chaque page ; la **page active** est dépliée (`▾`) et liste ses composants **du dessus vers le dessous** (z-order inversé) ; les autres pages sont repliées (`▸`).
- Une ligne composant montre icône de type + libellé FR + id ; un composant `visible:false` apparaît **grisé/barré**.
- Changer de page via les **onglets `nav#pages`** (toujours là) → l'arbre suit (la nouvelle page se déplie).
- Aucune régression : palette, canvas, inspecteur, undo fonctionnent comme avant.

Arrêter le serveur après vérification.

- [ ] **Step 6: Commit**

```bash
git add designer/index.html designer/style.css designer/js/tree.js designer/js/app.js
git commit -m "$(cat <<'EOF'
designer: arbre des calques — dock + rendu lecture (coexiste avec nav#pages)

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP
EOF
)"
```

---

## Task 3: Sélection depuis l'arbre (Document / page / composant)

**Files:**
- Modify: `designer/js/tree.js` (`createTree` : clics + surlignage + abonnement sélection)

**Contexte.** L'arbre devient le pilote de la sélection partagée. Règles d'ordre (critiques pour les gardes F1/F5) :
- **Document** → `setSelection({ kind: 'doc' })`. Ne change pas la page active.
- **Page** `i` → `setPage(i)` **puis** `setSelection({ kind: 'page', page: i })`. (`canvas.setPage` met la sélection à `null` en interne ; on la repositionne juste après.)
- **Composant** (page `pg`, index `idx`) → si `pg !== getActivePage()` faire `setPage(pg)` d'abord, **puis** `setSelection({ kind: 'comp', page: pg, index: idx })`.

`setSelection` (coordinateur `app.js`) blur le champ inspecteur focalisé **avant** de changer la sélection (garde F1) ; les commits en attente partent sur l'ancien `ref` figé (garde F5). On passe **toujours** par lui (jamais par `selection.set` direct). Le surlignage lit `selection.get()` au render ; l'arbre s'abonne aussi à `selection` pour se redessiner quand le canvas/inspecteur changent la sélection.

- [ ] **Step 1: Surlignage — lire la sélection au render**

Dans `createTree`, en tête de `render()`, après `const active = getActivePage();`, ajouter la lecture de la sélection :

```js
    const sel = selection.get();
```

Modifier `compRow(c)` pour accepter la page et marquer la sélection. Remplacer la signature et l'ajout de classe :

```js
  function compRow(c, pageIndex, sel) {
    const row = document.createElement('div');
    const isSel = sel && sel.kind === 'comp' && sel.page === pageIndex && sel.index === c.index;
    row.className = 'tree-row tree-comp' + (c.visible ? '' : ' hidden') + (isSel ? ' selected' : '');
    // … (icône + label + ref inchangés) …
    row.addEventListener('click', () => {
      if (pageIndex !== getActivePage()) setPage(pageIndex);
      setSelection({ kind: 'comp', page: pageIndex, index: c.index });
      render();
    });
    return row;
  }
```

Modifier `pageRow(p, active)` → `pageRow(p, active, sel)` et marquer + câbler le clic :

```js
  function pageRow(p, active, sel) {
    const row = document.createElement('div');
    const isSel = sel && sel.kind === 'page' && sel.page === p.index;
    row.className = 'tree-row tree-page' + (isSel ? ' selected' : '');
    // … (twist + label inchangés) …
    row.addEventListener('click', () => {
      setPage(p.index);                                  // met la sélection à null (canvas)…
      setSelection({ kind: 'page', page: p.index });     // …puis sélectionne la page
      render();
    });
    return row;
  }
```

Et la ligne Document, marquer + câbler :

```js
    const isDoc = sel && sel.kind === 'doc';
    doc.className = 'tree-row tree-doc' + (isDoc ? ' selected' : '');
    doc.addEventListener('click', () => { setSelection({ kind: 'doc' }); render(); });
```

Mettre à jour les appels dans `render()` : `pageRow(p, p.index === active, sel)` et `compRow(c, p.index, sel)`.

- [ ] **Step 2: S'abonner aux changements de sélection**

À la fin de `createTree`, avant `render(); return …`, ajouter l'abonnement (re-surligne quand la sélection change ailleurs — canvas, inspecteur, Échap) :

```js
  selection.subscribe(render);
```

(Note : `selection.set` n'émet qu'au vrai changement — cf. `selection.js` — donc pas de boucle ni de re-render redondant.)

- [ ] **Step 3: Vérification navigateur**

Servir comme Task 2 (`python3 -m http.server 8779` depuis la racine ; port ≠ 8000). Vérifier (verdict utilisateur) :
- Cliquer un **composant** dans l'arbre → il est sélectionné sur le **canvas** (poignées) et l'**inspecteur** l'édite ; la ligne d'arbre est surlignée.
- Cliquer un composant d'une **autre page** → l'arbre/canvas basculent sur cette page puis le sélectionnent.
- Cliquer une **page** → elle devient active (se déplie) et est surlignée ; l'inspecteur montre le panneau page/layout (comportement inspecteur actuel pour une sélection non-`comp`).
- Cliquer **Document** → surligné ; (l'inspecteur dédié Document arrive en Phase 4 — ici il retombe sur le panneau actuel).
- Sélectionner sur le **canvas** → la bonne ligne d'arbre se surligne. **Échap** → plus aucune ligne surlignée.
- **Garde F1** : éditer un champ texte de l'inspecteur (sans valider), puis cliquer une autre ligne d'arbre → l'édition se committe sur le **bon** (ancien) composant, et l'inspecteur bascule proprement. **Garde F5** : color picker → cliquer ailleurs dans l'arbre → la couleur part sur le bon composant.

- [ ] **Step 4: Commit**

```bash
git add designer/js/tree.js
git commit -m "$(cat <<'EOF'
designer: arbre — sélection partagée (doc/page/comp) + surlignage, gardes F1/F5

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP
EOF
)"
```

---

## Task 4: Œil de visibilité par ligne composant

**Files:**
- Modify: `designer/js/tree.js` (`createTree` : œil dans `compRow`)

**Contexte.** L'œil de la ligne de calque est **la même brique** que l'œil d'en-tête de l'inspecteur (`inspector.js:388-404`) : toggle de la clé `visible` du composant via `setComponentProp(s, ref, 'visible', next)`. On réutilise les mêmes data-URI d'icône et le style `.insp-eye`. Le clic sur l'œil **ne doit pas** sélectionner la ligne (`stopPropagation`).

- [ ] **Step 1: Constantes d'icône (réutilisées de l'inspecteur)**

En tête de `designer/js/tree.js`, après les imports, ajouter les data-URI (copie des constantes `EYE_OPEN_URI`/`EYE_OFF_URI` de `inspector.js:24-25`, mêmes valeurs — l'inspecteur garde les siennes ; pas de couplage entre modules) :

```js
// Œil de visibilité — mêmes icônes que l'en-tête inspecteur (brique commune, cf. spec §1).
const EYE_OPEN_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23E5E7EB' stroke-width='2'%3E%3Cpath d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3C/svg%3E";
const EYE_OFF_URI  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23EF4444' stroke-width='2'%3E%3Cpath d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3Cline x1='3' y1='3' x2='21' y2='21'/%3E%3C/svg%3E";
```

- [ ] **Step 2: Ajouter l'œil dans `compRow`**

Dans `compRow`, après l'ajout de `lbl` et `ref` et **avant** le `return row`, insérer un spacer + l'œil (le `ref` du composant est `c.ref`, figé dans la closure du listener) :

```js
    const spacer = document.createElement('span'); spacer.className = 'tree-spacer';
    row.appendChild(spacer);
    const eye = document.createElement('button');
    eye.className = 'insp-eye';                       // style partagé (icône bouton plat)
    eye.title = c.visible ? 'Visible — cliquer pour cacher' : 'Caché — cliquer pour afficher';
    const icon = document.createElement('img');
    icon.src = c.visible ? EYE_OPEN_URI : EYE_OFF_URI;
    icon.width = 14; icon.height = 14; icon.alt = c.visible ? 'visible' : 'caché';
    eye.appendChild(icon);
    const ref = c.ref;
    eye.addEventListener('click', e => {
      e.stopPropagation();                            // ne pas sélectionner la ligne
      model.commit(s => setComponentProp(s, ref, 'visible', c.visible ? false : true));
    });
    row.appendChild(eye);
```

Ajouter l'import en tête de `tree.js` :

```js
import { setComponentProp } from './mutations.js';
```

- [ ] **Step 3: Vérification navigateur**

Servir comme précédemment. Vérifier (verdict utilisateur) :
- Chaque ligne composant a un **œil** à droite. Clic → bascule `visible` : la ligne se grise/barre, le composant se grise sur le **canvas** (classe `.w.hidden`), et l'**œil d'en-tête inspecteur** reflète le même état si le composant est sélectionné.
- Le clic sur l'œil **ne change pas** la sélection courante.
- **Undo** annule la bascule en un coup.

- [ ] **Step 4: Commit**

```bash
git add designer/js/tree.js
git commit -m "$(cat <<'EOF'
designer: arbre — œil de visibilité par ligne (brique commune avec l'inspecteur)

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP
EOF
)"
```

---

## Task 5: CRUD des pages dans l'arbre (add / renommer / réordonner / supprimer)

**Files:**
- Modify: `designer/js/tree.js` (`createTree` : en-tête `+ Page`, contrôles de ligne page, rename inline)
- Modify: `designer/style.css` (boutons de contrôle de ligne `.tree-actions`)

**Contexte.** L'arbre doit reprendre **tout** ce que faisait `nav#pages` avant de pouvoir le retirer (Task 6) : ajouter une page, renommer (inline, avec **garde anti-doublon** — le nom de page est la cible de `POST /page`), réordonner, supprimer (garder ≥ 1 page). On réutilise les mutations `addPage`/`renamePage`/`reorderPages`/`removePage` et les helpers `uniquePageName`/`pageNameTaken` (déjà dans `mutations.js`), et le `showToast` pour le verdict de doublon — exactement comme `pages.js`. La page active suit la même logique qu'`onglets` (sélectionner la nouvelle/voisine après l'action).

- [ ] **Step 1: Imports + état de renommage**

En tête de `designer/js/tree.js`, étendre les imports mutations et ajouter `showToast` :

```js
import { setComponentProp, addPage, removePage, renamePage, reorderPages, uniquePageName, pageNameTaken } from './mutations.js';
import { showToast } from './toast.js';
```

Dans `createTree`, déclarer l'état de renommage inline en tête (comme `pages.js`) :

```js
  let renaming = null;   // index de la page en cours de renommage inline, ou null
```

- [ ] **Step 2: CSS des contrôles de ligne**

Dans `designer/style.css`, après le bloc `.tree-*` (Task 2), ajouter :

```css
.tree-actions { display: none; gap: 2px; flex: none; }
.tree-row:hover .tree-actions { display: flex; }
.tree-actions button { padding: 1px 6px; font-size: 12px; line-height: 1.2; }
.tree-rename { width: 110px; }
.tree-rename.invalid { border-color: var(--err); color: var(--err); }
.tree-head { display: flex; justify-content: flex-end; margin-bottom: 6px; }
```

- [ ] **Step 3: En-tête « + Page »**

Dans `render()`, juste après `const tree = …`, avant d'ajouter la ligne Document, insérer un en-tête avec le bouton d'ajout :

```js
    const head = document.createElement('div'); head.className = 'tree-head';
    const addBtn = document.createElement('button'); addBtn.className = 'page-btn'; addBtn.textContent = '+ Page';
    addBtn.addEventListener('click', () => {
      model.commit(s => addPage(s, uniquePageName(s)));
      setPage(model.state.pages.length - 1);
      setSelection({ kind: 'page', page: model.state.pages.length - 1 });
      render();
    });
    head.appendChild(addBtn);
    root.appendChild(head);   // hors .tree pour survivre au replaceChildren de .tree
```

Note : `render()` retire `.tree` ET `.tree-head` en début (ajuster le nettoyage). Remplacer la ligne de nettoyage par :

```js
    root.querySelectorAll('.tree, .tree-head').forEach(n => n.remove());
```

- [ ] **Step 4: Renommage inline + contrôles dans `pageRow`**

Réécrire `pageRow` pour gérer le mode renommage et les actions au survol. Remplacer la fonction par :

```js
  function pageRow(p, active, sel) {
    // Mode renommage inline (réutilise la garde anti-doublon de pages.js).
    if (renaming === p.index) {
      const row = document.createElement('div'); row.className = 'tree-row tree-page';
      const inp = document.createElement('input'); inp.className = 'tree-rename'; inp.value = p.name || '';
      const orig = p.name || '';
      const tryCommit = () => {
        const name = inp.value.trim() || uniquePageName(model.state);
        if (name === orig) { renaming = null; render(); return true; }
        if (pageNameTaken(model.state, name, p.index)) { showToast(`« ${name} » est déjà utilisé`); return false; }
        renaming = null;
        model.commit(s => renamePage(s, p.index, name));
        return true;
      };
      inp.addEventListener('input', () => {
        const v = inp.value.trim();
        inp.classList.toggle('invalid', !!v && pageNameTaken(model.state, v, p.index));
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); tryCommit(); }
        else if (e.key === 'Escape') { e.preventDefault(); renaming = null; render(); }
      });
      inp.addEventListener('blur', () => { if (renaming === p.index && !tryCommit()) { renaming = null; render(); } });
      row.appendChild(inp);
      queueMicrotask(() => inp.focus());
      return row;
    }

    const row = document.createElement('div');
    const isSel = sel && sel.kind === 'page' && sel.page === p.index;
    row.className = 'tree-row tree-page' + (isSel ? ' selected' : '');
    const tw = document.createElement('span'); tw.className = 'tree-twist'; tw.textContent = active ? '▾' : '▸';
    const lbl = document.createElement('span'); lbl.className = 'tree-label';
    lbl.textContent = p.name || `Page ${p.index + 1}`;
    row.appendChild(tw); row.appendChild(lbl);
    row.addEventListener('click', () => {
      setPage(p.index); setSelection({ kind: 'page', page: p.index }); render();
    });

    const spacer = document.createElement('span'); spacer.className = 'tree-spacer'; row.appendChild(spacer);
    const actions = document.createElement('div'); actions.className = 'tree-actions';
    const total = model.state.pages?.length ?? 0;
    const mkAct = (txt, title, fn, disabled) => {
      const b = document.createElement('button'); b.textContent = txt; b.title = title; b.disabled = !!disabled;
      b.addEventListener('click', e => { e.stopPropagation(); if (!disabled) fn(); });
      actions.appendChild(b);
    };
    mkAct('✎', 'Renommer', () => { setPage(p.index); renaming = p.index; render(); });
    mkAct('↑', 'Monter', () => {
      model.commit(s => reorderPages(s, p.index, p.index - 1)); setPage(p.index - 1); render();
    }, p.index <= 0);
    mkAct('↓', 'Descendre', () => {
      model.commit(s => reorderPages(s, p.index, p.index + 1)); setPage(p.index + 1); render();
    }, p.index >= total - 1);
    mkAct('✕', 'Supprimer la page', () => {
      model.commit(s => removePage(s, p.index));
      setPage(Math.min(p.index, model.state.pages.length - 1));
      render();
    }, total <= 1);
    row.appendChild(actions);
    return row;
  }
```

(Le bouton `page-btn` / `page-del` CSS existe encore — réutilisé tel quel jusqu'à Task 6 ; les contrôles d'arbre utilisent `.tree-actions button`.)

- [ ] **Step 5: Vérification navigateur**

Servir comme précédemment. Vérifier (verdict utilisateur), **uniquement via l'arbre** (ignorer `nav#pages`) :
- **+ Page** ajoute une page (nom « Page N » unique), l'active et la sélectionne.
- **✎** (ou re-clic) ouvre un champ inline ; Entrée valide, Échap annule ; un **doublon** est refusé (toast, on reste en édition / revert au blur).
- **↑/↓** réordonnent la page (désactivés aux extrémités) ; la page déplacée reste active.
- **✕** supprime (désactivé s'il ne reste qu'une page) ; l'index actif est ramené dans les bornes (pas d'arbre vide ni d'erreur).
- Undo/redo cohérents ; `nav#pages` et l'arbre restent synchronisés.

- [ ] **Step 6: Commit**

```bash
git add designer/js/tree.js designer/style.css
git commit -m "$(cat <<'EOF'
designer: arbre — CRUD pages (ajout/renommage inline/réordre/suppr), reprise de pages.js

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP
EOF
)"
```

---

## Task 6: Retrait de `nav#pages` et de `pages.js`

**Files:**
- Modify: `designer/index.html:51` (supprimer `<nav id="pages">`)
- Modify: `designer/js/app.js` (retirer l'import + l'appel `createPages` ; `bindFileIO` onLoad → `tree.render()`)
- Delete: `designer/js/pages.js`
- Modify: `designer/style.css` (retirer le CSS `.pages-bar` / `.page-*`)

**Contexte.** L'arbre couvre désormais la sélection de page active + le CRUD pages : `nav#pages` (et son module `pages.js`) deviennent morts. On les retire. Seul point de câblage résiduel : `bindFileIO` (app.js:118-121) appelle `pages.render()` après import — à remplacer par `tree.render()`.

- [ ] **Step 1: Retirer la barre d'onglets du HTML**

Dans `designer/index.html`, supprimer la ligne 51 :

```html
  <nav id="pages" class="pages-bar"></nav>
```

- [ ] **Step 2: Découpler `app.js` de `pages.js`**

Dans `designer/js/app.js` :

a) Supprimer l'import (ligne 12) :

```js
import { createPages } from './pages.js';
```

b) Supprimer le bloc `createPages` (lignes 110-114) :

```js
  // Onglets de pages : sélectionner la page active + CRUD + réordonner.
  const pages = createPages($('pages'), model, {
    getActivePage: canvas.getActivePage,
    setPage: i => canvas.setPage(i)
  });
```

c) Dans `bindFileIO(...)` (onLoad, ligne 120), remplacer `pages.render()` par `tree.render()` :

```js
    onLoad: () => { model.commit(s => stripPhysicalPlacements(s)); canvas.setPage(0); tree.render(); }
```

(L'ordre d'instanciation est bon : `tree` est créé avant `bindFileIO`. Si `bindFileIO` apparaît avant `createTree` dans le fichier, déplacer le bloc `createTree` au-dessus de `bindFileIO`.)

- [ ] **Step 3: Supprimer le module mort**

```bash
git rm designer/js/pages.js
```

- [ ] **Step 4: Retirer le CSS des onglets**

Dans `designer/style.css`, supprimer les règles `.pages-bar`, `.page-tabs`, `.page-tab`, `.page-tab.active`, `.page-tab.dragging`, `.page-tab.drag-over`, `.page-rename`, `.page-rename.invalid`, `.page-ctrls`, `.page-btn`, `.page-btn:disabled`, `.page-del`, `.page-del:disabled` (lignes ~224-239).

⚠️ **Attention** : Task 5 utilise `.page-btn` pour le bouton « + Page ». Avant de supprimer `.page-btn`, remplacer dans `tree.js` la classe du bouton « + Page » par `.tree-actions button` (ou lui donner `class="tree-addbtn"` avec une règle dédiée). Vérifier qu'aucune classe `.page-*` n'est plus référencée :

Run: `grep -rn "page-btn\|page-tab\|pages-bar\|page-del\|page-rename\|page-ctrls" designer/js designer/index.html`
Expected: aucun résultat (sinon corriger avant de retirer le CSS).

- [ ] **Step 5: Vérification — pas de référence morte**

Run: `grep -rn "pages.js\|createPages\|getElementById('pages')\|\$('pages')\|id=\"pages\"" designer/`
Expected: aucun résultat.

Run: `cd designer && node --test`
Expected: tout vert (aucun test n'importait `pages.js` — confirmer ; sinon retirer le test mort).

- [ ] **Step 6: Vérification navigateur (régression complète)**

Servir comme précédemment. Vérifier (verdict utilisateur) que **tout le flux pages passe par l'arbre**, sans `nav#pages` :
- Ajout/renommage/réordre/suppression de page ; changement de page active ; sélection comp/page/doc ; œil ; undo/redo ; **import d'un layout** (`Importer`) → l'arbre se reconstruit, page 0 active.
- Gardes F1/F5 toujours bons. Aucune zone vide ni bouton orphelin là où était la barre d'onglets.

- [ ] **Step 7: Commit**

```bash
git add designer/index.html designer/js/app.js designer/style.css designer/js/tree.js
git rm designer/js/pages.js 2>/dev/null; git add -A designer/js/pages.js 2>/dev/null
git commit -m "$(cat <<'EOF'
designer: retrait de nav#pages + pages.js — l'arbre des calques pilote les pages

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP
EOF
)"
```

---

## Self-Review (contre la spec §1)

**Couverture spec §1 (MVP) :**
- Remplace `nav#pages` → Task 6. ✅
- Trois niveaux Document → pages (ordre nav) → composants (z-order inversé) → Task 1 (modèle) + Task 2 (rendu). ✅
- Sélection unique pilote inspecteur + canvas → Task 3 ; Échap désélectionne (existant, vérifié Task 3). ✅
- Œil = brique commune inspecteur → Task 4. ✅
- Pas d'œil sur les pages → respecté (œil seulement dans `compRow`). ✅
- Pages : pliage (page active), réordonner, renommer inline (garde-doublon), supprimer (≥1), + Page → Task 5. ✅
- Invariants F1/F5 préservés (toujours via `setSelection`) → Task 3, vérifs dédiées. ✅

**Reporté en Phase 3b (hors MVP, annoncé en tête)** : drag & drop (reorder + move inter-page, « la sélection suit l'élément » — note HANDOFF sur l'instabilité d'index), menu contextuel clic-droit, **F2**, renommage d'**id** composant (`renameComponent`), `⧉` dupliquer une page, expansion multi-pages indépendante. ✅ (écart assumé et tracé)

**Cohérence des types/signatures :** `treeModel(state)` → `{ title, pages:[{ index, name, components:[{ index, ref, type, label, visible }] }] }`, consommé tel quel par `createTree`. `createTree(root, model, { selection, setSelection, getActivePage, setPage })` — mêmes deps que `createPages` + le store de sélection. Mutations appelées : `addPage`/`removePage`/`renamePage`/`reorderPages`/`uniquePageName`/`pageNameTaken`/`setComponentProp` — toutes existantes (`mutations.js`), signatures vérifiées.

**Placeholders :** aucun TODO/TBD ; chaque step de code montre le code.

**Risque connu (note pour l'exécutant)** : Task 5 introduit `.page-btn` sur « + Page », que Task 6 retire — l'étape 4 de Task 6 le rappelle explicitement (basculer la classe avant de supprimer le CSS). À ne pas oublier.
