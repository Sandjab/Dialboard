# Refonte designer — Fondations (mutations + sélection) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser les briques pures de la refonte IHM — 3 mutations de calques (`reorderPlacement`, `movePlacementToPage`, `renameComponent`) et un store de sélection partagé (`selection.js`) — toutes testées sous `node --test`, sans toucher au DOM.

**Architecture:** Fonctions pures ajoutées à `designer/js/mutations.js` (moule existant : mutent l'état en place, appelées via `model.commit`, no-op sur index invalide). Nouveau module `designer/js/selection.js` : source de vérité de la sélection courante `{kind:'doc'|'page'|'comp', page?, index?}` ou `null`, avec subscribe/emit (même forme que `model.js`). **Aucune intégration UI ici** (le câblage canvas/arbre/inspecteur est browser-verified → plan suivant). Cette tranche est 100 % unit-testable.

**Tech Stack:** JS modules ES (pas de build), tests `node:test` + `node:assert/strict` (lancés par `cd designer && node --test`, **sans argument**). Périmètre = `docs/superpowers/specs/2026-06-21-designer-refonte-ihm-design.md` §« Nouvelles mutations » + §1/§5 (selection.js).

**Convention commits :** terminer chaque message par `Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP` (convention harness). Branche : `feat/designer-refonte-ihm` (déjà créée, porte le spec).

---

## File Structure

- `designer/js/mutations.js` — **modifié** : +3 fonctions pures (`reorderPlacement`, `movePlacementToPage`, `renameComponent`), à la suite des mutations de pages/placements existantes. Une responsabilité : muter le layout.
- `designer/js/selection.js` — **créé** : store de sélection (`createSelection`) + helpers purs (`sameSelection`, `isSelectionValid`). Une responsabilité : tenir/observer la sélection courante. Pas de DOM.
- `designer/tests/mutations.test.js` — **modifié** : +cas pour les 3 mutations (ajouter les imports).
- `designer/tests/selection.test.js` — **créé** : tests du store + helpers.

---

## Task 1 : mutation `reorderPlacement` (z-order intra-page)

**Files:**
- Modify: `designer/js/mutations.js` (à la suite de `reorderPages`, ~ligne 180)
- Test: `designer/tests/mutations.test.js`

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter `reorderPlacement` à la liste d'import en tête de `designer/tests/mutations.test.js`, puis ajouter :

```js
test('reorderPlacement : déplace un placement vers le bas du tableau (= au-dessus en z-order)', () => {
  // place[] : l'ordre du tableau EST l'ordre de rendu (dernier = dessus). Bouger en fin = mettre au-dessus.
  const s = { components: {}, pages: [{ name: 'P', place: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }] }] };
  reorderPlacement(s, 0, 0, 2);
  assert.deepEqual(s.pages[0].place.map(p => p.ref), ['b', 'c', 'a']);
});

test('reorderPlacement : from === to est un no-op', () => {
  const s = { components: {}, pages: [{ name: 'P', place: [{ ref: 'a' }, { ref: 'b' }] }] };
  reorderPlacement(s, 0, 1, 1);
  assert.deepEqual(s.pages[0].place.map(p => p.ref), ['a', 'b']);
});

test('reorderPlacement : index hors bornes → no-op (pas de throw)', () => {
  const s = { components: {}, pages: [{ name: 'P', place: [{ ref: 'a' }, { ref: 'b' }] }] };
  reorderPlacement(s, 0, 0, 5);
  reorderPlacement(s, 0, -1, 0);
  assert.deepEqual(s.pages[0].place.map(p => p.ref), ['a', 'b']);
});

test('reorderPlacement : page inexistante → no-op', () => {
  const s = { components: {}, pages: [{ name: 'P', place: [{ ref: 'a' }] }] };
  reorderPlacement(s, 9, 0, 0);   // ne doit pas throw
  assert.deepEqual(s.pages[0].place.map(p => p.ref), ['a']);
});
```

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `cd designer && node --test`
Expected: FAIL — `reorderPlacement is not exported` / `not a function`.

- [ ] **Step 3 : implémenter la mutation**

Ajouter dans `designer/js/mutations.js`, juste après `reorderPages` (~ligne 180) :

```js
// Déplace un placement de `from` vers `to` dans pages[pageIndex].place. L'ordre du tableau = l'ordre de
// rendu (z-index : le dernier est dessus). No-op si page/place absent, index hors bornes ou identiques.
// Miroir de reorderPages (même garde de bornes).
export function reorderPlacement(state, pageIndex, from, to) {
  const place = state.pages?.[pageIndex]?.place;
  if (!place || from === to) return;
  if (from < 0 || from >= place.length || to < 0 || to >= place.length) return;
  const [p] = place.splice(from, 1);
  place.splice(to, 0, p);
}
```

- [ ] **Step 4 : lancer les tests, vérifier qu'ils passent**

Run: `cd designer && node --test`
Expected: PASS (tous, dont les 4 nouveaux).

- [ ] **Step 5 : commit**

```bash
git add designer/js/mutations.js designer/tests/mutations.test.js
git commit -m "designer: mutation reorderPlacement (z-order intra-page) + tests

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Task 2 : mutation `movePlacementToPage` (déplacer un composant entre pages)

**Files:**
- Modify: `designer/js/mutations.js` (après `reorderPlacement`)
- Test: `designer/tests/mutations.test.js`

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter `movePlacementToPage` à l'import, puis :

```js
test('movePlacementToPage : retire de la source, ajoute en fin de la cible, components intact', () => {
  const s = {
    components: { a: { type: 'ring' }, b: { type: 'bar' } },
    pages: [
      { name: 'P1', place: [{ ref: 'a' }, { ref: 'b' }] },
      { name: 'P2', place: [{ ref: 'x' }] },
    ],
  };
  movePlacementToPage(s, 0, 0, 1);   // déplace 'a' de P1 vers P2
  assert.deepEqual(s.pages[0].place.map(p => p.ref), ['b']);
  assert.deepEqual(s.pages[1].place.map(p => p.ref), ['x', 'a']);
  assert.deepEqual(Object.keys(s.components).sort(), ['a', 'b']);   // la map globale ne bouge pas
});

test('movePlacementToPage : même page = remonte le placement en fin (au-dessus)', () => {
  const s = { components: {}, pages: [{ name: 'P', place: [{ ref: 'a' }, { ref: 'b' }] }] };
  movePlacementToPage(s, 0, 0, 0);
  assert.deepEqual(s.pages[0].place.map(p => p.ref), ['b', 'a']);
});

test('movePlacementToPage : placement inexistant → no-op', () => {
  const s = { components: {}, pages: [{ name: 'P1', place: [] }, { name: 'P2', place: [{ ref: 'x' }] }] };
  movePlacementToPage(s, 0, 0, 1);   // place[0] de P1 n'existe pas
  assert.deepEqual(s.pages[1].place.map(p => p.ref), ['x']);
});

test('movePlacementToPage : page cible inexistante → no-op (placement source conservé)', () => {
  const s = { components: {}, pages: [{ name: 'P1', place: [{ ref: 'a' }] }] };
  movePlacementToPage(s, 0, 0, 9);
  assert.deepEqual(s.pages[0].place.map(p => p.ref), ['a']);
});
```

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `cd designer && node --test`
Expected: FAIL — `movePlacementToPage is not a function`.

- [ ] **Step 3 : implémenter la mutation**

Ajouter dans `designer/js/mutations.js`, après `reorderPlacement` :

```js
// Déplace un placement de la page `fromPage` (index `placeIndex`) vers la FIN de pages[toPage].place.
// Le composant reste dans la map globale `components` (seul le placement migre). No-op si page/placement
// absent. Même page autorisée (retire puis ré-ajoute en fin = remonte au-dessus). `||= []` couvre une page
// cible sans tableau place (parité avec addPlacement).
export function movePlacementToPage(state, fromPage, placeIndex, toPage) {
  const srcPage = state.pages?.[fromPage];
  const dstPage = state.pages?.[toPage];
  if (!srcPage?.place || !dstPage) return;
  const placement = srcPage.place[placeIndex];
  if (!placement) return;
  srcPage.place.splice(placeIndex, 1);
  (dstPage.place ||= []).push(placement);
}
```

- [ ] **Step 4 : lancer les tests, vérifier qu'ils passent**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add designer/js/mutations.js designer/tests/mutations.test.js
git commit -m "designer: mutation movePlacementToPage (deplacer entre pages) + tests

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Task 3 : mutation `renameComponent` (renommer un id partout)

**Files:**
- Modify: `designer/js/mutations.js` (après `movePlacementToPage`)
- Test: `designer/tests/mutations.test.js`

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter `renameComponent` à l'import, puis :

```js
test('renameComponent : renomme la clé map ET tous les place[].ref (multi-pages)', () => {
  const s = {
    components: { old: { type: 'ring', color: '#fff' } },
    pages: [
      { name: 'P1', place: [{ ref: 'old', radius: 100 }, { ref: 'other' }] },
      { name: 'P2', place: [{ ref: 'old' }] },
    ],
  };
  assert.equal(renameComponent(s, 'old', 'temp_ring'), true);
  assert.deepEqual(Object.keys(s.components).sort(), ['temp_ring']);
  assert.deepEqual(s.components.temp_ring, { type: 'ring', color: '#fff' });
  assert.equal(s.pages[0].place[0].ref, 'temp_ring');
  assert.equal(s.pages[0].place[1].ref, 'other');   // les autres refs intacts
  assert.equal(s.pages[1].place[0].ref, 'temp_ring');
});

test('renameComponent : collision avec un id existant → rejet (false, aucun changement)', () => {
  const s = { components: { a: { type: 'ring' }, b: { type: 'bar' } }, pages: [{ name: 'P', place: [{ ref: 'a' }] }] };
  assert.equal(renameComponent(s, 'a', 'b'), false);
  assert.deepEqual(Object.keys(s.components).sort(), ['a', 'b']);
  assert.equal(s.pages[0].place[0].ref, 'a');
});

test('renameComponent : id source absent → false', () => {
  const s = { components: { a: { type: 'ring' } }, pages: [] };
  assert.equal(renameComponent(s, 'zzz', 'b'), false);
});

test('renameComponent : nouveau nom vide ou identique → false (no-op)', () => {
  const s = { components: { a: { type: 'ring' } }, pages: [] };
  assert.equal(renameComponent(s, 'a', ''), false);
  assert.equal(renameComponent(s, 'a', 'a'), false);
  assert.deepEqual(Object.keys(s.components), ['a']);
});
```

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `cd designer && node --test`
Expected: FAIL — `renameComponent is not a function`.

- [ ] **Step 3 : implémenter la mutation**

Ajouter dans `designer/js/mutations.js`, après `movePlacementToPage` :

```js
// Renomme l'id d'un composant : la clé dans `components` ET tous les place[].ref qui la pointent (toutes
// pages). Retourne false (no-op) si oldId absent, newId vide, identique, ou DÉJÀ pris (garde d'unicité →
// pas d'écrasement). Retourne true si renommé. L'id n'est PAS du texte d'affichage device (≠ text/label/
// unit) → pas de contrainte ASCII ici.
export function renameComponent(state, oldId, newId) {
  const comps = state.components;
  if (!comps || !comps[oldId]) return false;
  if (!newId || newId === oldId || comps[newId]) return false;
  comps[newId] = comps[oldId];
  delete comps[oldId];
  for (const page of state.pages || [])
    for (const pl of page.place || [])
      if (pl.ref === oldId) pl.ref = newId;
  return true;
}
```

- [ ] **Step 4 : lancer les tests, vérifier qu'ils passent**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add designer/js/mutations.js designer/tests/mutations.test.js
git commit -m "designer: mutation renameComponent (renommer un id partout) + tests

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Task 4 : `selection.js` — `sameSelection` (égalité de sélection)

**Files:**
- Create: `designer/js/selection.js`
- Test: `designer/tests/selection.test.js` (créé)

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `designer/tests/selection.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSelection } from '../js/selection.js';

test('sameSelection : deux null sont égaux', () => {
  assert.equal(sameSelection(null, null), true);
});

test('sameSelection : null vs objet → différent', () => {
  assert.equal(sameSelection(null, { kind: 'doc' }), false);
  assert.equal(sameSelection({ kind: 'doc' }, null), false);
});

test('sameSelection : deux doc → égaux', () => {
  assert.equal(sameSelection({ kind: 'doc' }, { kind: 'doc' }), true);
});

test('sameSelection : kinds différents → différents', () => {
  assert.equal(sameSelection({ kind: 'doc' }, { kind: 'page', page: 0 }), false);
});

test('sameSelection : pages par index', () => {
  assert.equal(sameSelection({ kind: 'page', page: 1 }, { kind: 'page', page: 1 }), true);
  assert.equal(sameSelection({ kind: 'page', page: 1 }, { kind: 'page', page: 2 }), false);
});

test('sameSelection : composants par page + index', () => {
  assert.equal(sameSelection({ kind: 'comp', page: 0, index: 2 }, { kind: 'comp', page: 0, index: 2 }), true);
  assert.equal(sameSelection({ kind: 'comp', page: 0, index: 2 }, { kind: 'comp', page: 0, index: 3 }), false);
  assert.equal(sameSelection({ kind: 'comp', page: 0, index: 2 }, { kind: 'comp', page: 1, index: 2 }), false);
});
```

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `cd designer && node --test`
Expected: FAIL — module `selection.js` introuvable / `sameSelection` non exporté.

- [ ] **Step 3 : implémenter `selection.js` (en-tête + `sameSelection`)**

Créer `designer/js/selection.js` :

```js
// Source de vérité de la sélection courante du designer, partagée entre l'arbre des calques, le canvas et
// l'inspecteur. Pur (pas de DOM). Une sélection est l'un de :
//   { kind: 'doc' }                       → le nœud Document (params globaux)
//   { kind: 'page', page }                → une page (index dans pages[])
//   { kind: 'comp', page, index }         → un placement (index dans pages[page].place[])
//   null                                  → rien de sélectionné
// (cf. spec 2026-06-21-designer-refonte-ihm-design.md §1/§2).

// Égalité structurelle de deux sélections (ou null). Sert à éviter les emits redondants du store et à
// décider si l'inspecteur doit re-render.
export function sameSelection(a, b) {
  if (a === b) return true;          // même réf, ou null === null
  if (!a || !b) return false;        // l'un seulement est null
  if (a.kind !== b.kind) return false;
  if (a.kind === 'page') return a.page === b.page;
  if (a.kind === 'comp') return a.page === b.page && a.index === b.index;
  return true;                       // 'doc' (pas d'autre champ discriminant)
}
```

- [ ] **Step 4 : lancer les tests, vérifier qu'ils passent**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add designer/js/selection.js designer/tests/selection.test.js
git commit -m "designer: selection.js — sameSelection (egalite de selection) + tests

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Task 5 : `selection.js` — store `createSelection` (subscribe/set/get/clear)

**Files:**
- Modify: `designer/js/selection.js`
- Test: `designer/tests/selection.test.js`

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter `createSelection` à l'import de `selection.test.js`, puis :

```js
test('createSelection : get rend la sélection initiale (null par défaut)', () => {
  assert.equal(createSelection().get(), null);
  assert.deepEqual(createSelection({ kind: 'doc' }).get(), { kind: 'doc' });
});

test('createSelection : set change la valeur et notifie les abonnés', () => {
  const sel = createSelection();
  let seen;
  sel.subscribe(s => { seen = s; });
  sel.set({ kind: 'page', page: 2 });
  assert.deepEqual(sel.get(), { kind: 'page', page: 2 });
  assert.deepEqual(seen, { kind: 'page', page: 2 });
});

test('createSelection : set d’une sélection identique n’émet pas', () => {
  const sel = createSelection({ kind: 'comp', page: 0, index: 1 });
  let calls = 0;
  sel.subscribe(() => calls++);
  sel.set({ kind: 'comp', page: 0, index: 1 });   // structurellement identique
  assert.equal(calls, 0);
});

test('createSelection : clear remet à null et notifie', () => {
  const sel = createSelection({ kind: 'doc' });
  let seen = 'unset';
  sel.subscribe(s => { seen = s; });
  sel.clear();
  assert.equal(sel.get(), null);
  assert.equal(seen, null);
});

test('createSelection : subscribe renvoie un désabonnement', () => {
  const sel = createSelection();
  let calls = 0;
  const off = sel.subscribe(() => calls++);
  sel.set({ kind: 'doc' });
  off();
  sel.set({ kind: 'page', page: 0 });
  assert.equal(calls, 1);   // une seule notif avant désabonnement
});
```

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `cd designer && node --test`
Expected: FAIL — `createSelection is not a function`.

- [ ] **Step 3 : implémenter le store**

Ajouter dans `designer/js/selection.js`, sous `sameSelection` :

```js
// Store de sélection : même forme que createModel (subscribe rend un désabonnement). Émet uniquement quand
// la sélection change réellement (sameSelection court-circuite les set redondants → pas de re-render inutile,
// invariant clé pour l'inspecteur).
export function createSelection(initial = null) {
  let cur = initial;
  const subs = new Set();
  const emit = () => subs.forEach(fn => fn(cur));
  const api = {
    get() { return cur; },
    set(next) { if (sameSelection(cur, next)) return; cur = next; emit(); },
    clear() { api.set(null); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
  return api;
}
```

- [ ] **Step 4 : lancer les tests, vérifier qu'ils passent**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add designer/js/selection.js designer/tests/selection.test.js
git commit -m "designer: selection.js — store createSelection (subscribe/set/get/clear) + tests

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Task 6 : `selection.js` — `isSelectionValid` (purge des sélections périmées)

**Files:**
- Modify: `designer/js/selection.js`
- Test: `designer/tests/selection.test.js`

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter `isSelectionValid` à l'import de `selection.test.js`, puis :

```js
const S = () => ({
  components: { a: {} },
  pages: [{ name: 'P1', place: [{ ref: 'a' }, { ref: 'b' }] }, { name: 'P2', place: [] }],
});

test('isSelectionValid : null → false', () => {
  assert.equal(isSelectionValid(S(), null), false);
});

test('isSelectionValid : doc → toujours valide', () => {
  assert.equal(isSelectionValid(S(), { kind: 'doc' }), true);
});

test('isSelectionValid : page existante / inexistante', () => {
  assert.equal(isSelectionValid(S(), { kind: 'page', page: 1 }), true);
  assert.equal(isSelectionValid(S(), { kind: 'page', page: 9 }), false);
});

test('isSelectionValid : composant existant', () => {
  assert.equal(isSelectionValid(S(), { kind: 'comp', page: 0, index: 1 }), true);
});

test('isSelectionValid : composant à un index disparu → false', () => {
  assert.equal(isSelectionValid(S(), { kind: 'comp', page: 0, index: 5 }), false);
});

test('isSelectionValid : composant sur une page disparue → false', () => {
  assert.equal(isSelectionValid(S(), { kind: 'comp', page: 9, index: 0 }), false);
});
```

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `cd designer && node --test`
Expected: FAIL — `isSelectionValid is not a function`.

- [ ] **Step 3 : implémenter le helper**

Ajouter dans `designer/js/selection.js`, sous `createSelection` :

```js
// La sélection pointe-t-elle encore quelque chose d'existant dans `state` ? Utilisé à l'intégration pour
// purger une sélection périmée après suppression / undo / import (sinon l'inspecteur édite dans le vide).
export function isSelectionValid(state, sel) {
  if (!sel) return false;
  if (sel.kind === 'doc') return true;
  const page = state.pages?.[sel.page];
  if (!page) return false;
  if (sel.kind === 'page') return true;
  return !!page.place?.[sel.index];   // 'comp'
}
```

- [ ] **Step 4 : lancer les tests, vérifier qu'ils passent**

Run: `cd designer && node --test`
Expected: PASS (suite complète verte ; les compteurs montent du total actuel + ~23 nouveaux cas).

- [ ] **Step 5 : commit**

```bash
git add designer/js/selection.js designer/tests/selection.test.js
git commit -m "designer: selection.js — isSelectionValid (purge des selections perimees) + tests

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Vérification finale (après Task 6)

- [ ] **Suite complète verte**

Run: `cd designer && node --test`
Expected: PASS, 0 échec. (Le total passe du nombre actuel — 223 au dernier HANDOFF — à ~246.)

- [ ] **Syntaxe des modules touchés**

Run: `cd designer && node --check js/mutations.js && node --check js/selection.js`
Expected: aucune sortie (OK).

---

## Couverture du spec (auto-revue)

| Élément du spec | Tâche |
|---|---|
| `reorderPlacement(state, pageIndex, from, to)` | Task 1 |
| `movePlacementToPage(state, fromPage, placeIndex, toPage)` | Task 2 |
| `renameComponent(state, oldId, newId)` — clé map + tous refs, garde unicité | Task 3 |
| Sélection `{kind, page, index}` + égalité | Task 4 |
| Store partagé (subscribe/set/get/clear), émet seulement au vrai changement | Task 5 |
| Purge des sélections périmées (suppression/undo/import) | Task 6 |

**Hors de cette tranche (plans suivants, browser-verified) :** câblage `selection.js` ↔ `canvas.js` (gardes F1/F5), arbre `tree.js`, inspecteur contextuel, notifications, barre d'état, console, tiroir. Cf. spec §Phasage (étapes 3-7).

## Notes pour l'exécutant

- `node --test` se lance **sans argument** (cf. `CLAUDE.md`), depuis `designer/`.
- Les mutations sont **pures** : elles ne s'occupent ni de `model.commit` ni d'undo (c'est l'appelant UI, plus tard).
- Ne PAS intégrer `selection.js` au canvas dans cette tranche : l'externalisation de la sélection est le **risque n°1** du spec (gardes F1/F5) et se fait au navigateur, au plan suivant.
