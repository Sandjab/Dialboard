# Refonte designer — Câblage de la sélection partagée — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ⚠️ **Refactor fortement couplé** (canvas ↔ inspecteur ↔ app). Les tâches 2-3 ne sont PAS indépendantes : l'app est cassée *entre* les éditions de la tâche 2, qui doit donc être committée d'un bloc. L'exécution **inline** (executing-plans) peut être préférable au subagent-par-tâche ici.

**Goal:** Externaliser la sélection courante du designer dans le store partagé `selection.js` (créé aux Fondations), de sorte que canvas et inspecteur lisent/écrivent **la même** source de vérité — **sans changer aucun comportement** (régression zéro) et en **préservant les gardes F1/F5**.

**Architecture:** Aujourd'hui `canvas.js` détient `let selected` (index de placement) et notifie l'inspecteur par un callback `onSelect`. L'inspecteur tient SA copie `sel = {placeIndex, ref}`. On remplace les deux par le store `createSelection()` (forme `{kind:'comp', page, index}` | `null`), injecté depuis `app.js`. Un **coordinateur** `setSelection()` dans `app.js` centralise le garde F1 (blur d'un champ inspecteur focalisé avant tout changement). Canvas et inspecteur **s'abonnent** au store. On **garde** l'API `canvas.getSelected()`/`selectPlacement()` comme proxys → les raccourcis/copier-coller d'`app.js` restent inchangés.

**Tech Stack:** JS modules ES, store `selection.js` (Fondations : `createSelection`, `sameSelection`, `isSelectionValid`). Tests `node:test` pour les helpers purs ; le reste est **vérifié au navigateur** (le `node --test` du repo est sans DOM, cf. `CLAUDE.md`). Spec : `docs/superpowers/specs/2026-06-21-designer-refonte-ihm-design.md` §1/§2 + §Risques.

**Périmètre / hors-périmètre.** CE plan = le câblage seul (spec **Phase 2, tail**). **Hors scope, plans suivants :** l'**arbre des calques** (Phase 3 — c'est lui qui introduira la sélection de pages/Document et le drag reorder/move) ; le **split inspecteur Document/Page/Composant** (Phase 4). Ici la sélection reste **uniquement un composant** (ou null), exactement comme aujourd'hui — on change la *plomberie*, pas le comportement.

**Convention commits :** terminer chaque message par `Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP`. Branche : `feat/designer-refonte-ihm` (en cours).

---

## File Structure

- `designer/js/selection.js` — **modifié** : +1 helper pur `placementSelection(sel, activePage)` (l'index à surligner sur le canvas, ou null).
- `designer/js/canvas.js` — **modifié** : `createCanvas` accepte `{ selection, setSelection, onLiveMove }` (au lieu de `onSelect`) ; suppression de `let selected` ; `applySelection` lit le store ; `select()` écrit via `setSelection` ; abonnement au store.
- `designer/js/inspector.js` — **modifié** : `createInspector` accepte `{ selection, ... }` ; suppression du `let sel` piloté par `select(s)` et de la méthode `select` ; `render()` recalcule `sel` depuis le store ; abonnement au store. Le garde F1 (blur) **part dans le coordinateur**.
- `designer/js/app.js` — **modifié** : crée le store + le coordinateur `setSelection` ; recâble canvas/inspecteur ; ajoute la purge `isSelectionValid` sur changement de modèle.
- `designer/tests/selection.test.js` — **modifié** : +cas pour `placementSelection`.

---

## Task 1 : helper pur `placementSelection`

**Files:**
- Modify: `designer/js/selection.js` (après `isSelectionValid`)
- Test: `designer/tests/selection.test.js`

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter `placementSelection` à l'import en tête de `designer/tests/selection.test.js`, puis :

```js
test('placementSelection : composant sur la page affichée → son index', () => {
  assert.equal(placementSelection({ kind: 'comp', page: 1, index: 3 }, 1), 3);
});

test('placementSelection : composant sur une AUTRE page → null', () => {
  assert.equal(placementSelection({ kind: 'comp', page: 0, index: 3 }, 1), null);
});

test('placementSelection : doc / page / null → null', () => {
  assert.equal(placementSelection({ kind: 'doc' }, 0), null);
  assert.equal(placementSelection({ kind: 'page', page: 0 }, 0), null);
  assert.equal(placementSelection(null, 0), null);
});

test('placementSelection : index 0 sur la page affichée → 0 (pas confondu avec null)', () => {
  assert.equal(placementSelection({ kind: 'comp', page: 2, index: 0 }, 2), 0);
});
```

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `cd designer && node --test`
Expected: FAIL — `placementSelection is not a function`.

- [ ] **Step 3 : implémenter le helper**

Ajouter dans `designer/js/selection.js`, après `isSelectionValid` :

```js
// L'index de placement à surligner sur le canvas pour la sélection courante : `index` si la sélection est
// un composant sur la page affichée (`activePage`), sinon null (doc/page/null, ou composant d'une AUTRE
// page). Pur — le canvas s'en sert dans applySelection. Le test « index 0 » garde le piège du falsy.
export function placementSelection(sel, activePage) {
  if (!sel || sel.kind !== 'comp' || sel.page !== activePage) return null;
  return sel.index;
}
```

- [ ] **Step 4 : lancer les tests, vérifier qu'ils passent**

Run: `cd designer && node --test`
Expected: PASS (suite = 254 + 4 nouveaux = 258).

- [ ] **Step 5 : commit**

```bash
git add designer/js/selection.js designer/tests/selection.test.js
git commit -m "designer: selection.js — helper placementSelection (index a surligner) + tests

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Task 2 : recâbler canvas + inspecteur + app sur le store (refactor couplé, 1 commit)

**Files:**
- Modify: `designer/js/canvas.js`
- Modify: `designer/js/inspector.js`
- Modify: `designer/js/app.js`

> Ces trois éditions forment **un seul** changement cohérent : l'app est cassée tant que les trois ne sont pas faites. Implémenter les 3 steps, vérifier au navigateur, puis committer une fois.

- [ ] **Step 1 : `canvas.js` — lire/écrire le store au lieu de `selected`**

a) Importer le helper. Modifier l'import de `mutations.js`/ajouter selection — en tête de `canvas.js`, sous les imports existants, ajouter :

```js
import { placementSelection } from './selection.js';
```

b) Changer la signature et supprimer l'état local. Remplacer :

```js
export function createCanvas({ stage }, model, { onSelect, onLiveMove } = {}) {
  let selected = null;    // index du placement sélectionné sur la page active
  let activePage = 0;     // page affichée par le canvas (source de vérité de l'éditeur, hors layout)
```

par :

```js
export function createCanvas({ stage }, model, { selection, setSelection, onLiveMove } = {}) {
  let activePage = 0;     // page affichée par le canvas (source de vérité de l'éditeur, hors layout)
  const selectedIndex = () => placementSelection(selection.get(), activePage);   // index à surligner (store)
```

c) `applySelection` lit le store. Remplacer le corps :

```js
  function applySelection() {
    stage.querySelectorAll('.w.selected').forEach(n => n.classList.remove('selected'));
    stage.querySelectorAll('.handle').forEach(n => n.remove());
    if (selected == null) return;
    const node = nodeFor(selected);
    if (!node) { selected = null; return; }
```

par :

```js
  function applySelection() {
    stage.querySelectorAll('.w.selected').forEach(n => n.classList.remove('selected'));
    stage.querySelectorAll('.handle').forEach(n => n.remove());
    const selected = selectedIndex();
    if (selected == null) return;
    const node = nodeFor(selected);
    if (!node) return;   // sélection périmée : la purge isSelectionValid (app.js) la nettoiera
```

d) `select(i)` écrit via le coordinateur. Remplacer :

```js
  function select(i) {
    selected = i;
    applySelection();
    onSelect && onSelect(i == null ? null : { placeIndex: i, ref: placements()[i].ref });
  }
```

par :

```js
  // Écrit la sélection dans le store partagé (via le coordinateur app.js qui gère le garde F1).
  // Le store ré-émet → applySelection (abonnement ci-dessous) + l'inspecteur se reconstruit.
  function select(i) {
    setSelection(i == null ? null : { kind: 'comp', page: activePage, index: i });
  }
```

e) `setPage` passe par le store. Remplacer :

```js
  function setPage(i) {
    activePage = i;
    selected = null;
    render();
    onSelect && onSelect(null);
  }
```

par :

```js
  function setPage(i) {
    activePage = i;
    setSelection(null);   // un index n'a pas de sens d'une page à l'autre (cf. Décisions C2)
    render();
  }
```

f) S'abonner au store + exposer `getSelected` dérivé. Remplacer le bloc de retour :

```js
  model.subscribe(render);
  render();
  // La webfont Montserrat (font-display:swap) charge en asynchrone : le 1er render mesure
  // avant le swap → centrage à ~8px près. Re-render une fois la police prête (fidélité).
  if (document.fonts?.ready) document.fonts.ready.then(render);
  return {
    render, getSelected: () => selected, selectPlacement: select, setPage, getActivePage: () => activePage,
    previewProp(ref, patch) { preview = { ref, patch }; render(); },   // aperçu live (canvas seul, sans commit ni undo)
    clearPreview() { preview = null; },                                // à appeler avant le commit : le commit re-render l'état réel
  };
```

par :

```js
  model.subscribe(render);
  selection.subscribe(applySelection);   // changement de sélection (sans changement de modèle) → re-surligner
  render();
  // La webfont Montserrat (font-display:swap) charge en asynchrone : le 1er render mesure
  // avant le swap → centrage à ~8px près. Re-render une fois la police prête (fidélité).
  if (document.fonts?.ready) document.fonts.ready.then(render);
  return {
    render, getSelected: () => selectedIndex(), selectPlacement: select, setPage, getActivePage: () => activePage,
    previewProp(ref, patch) { preview = { ref, patch }; render(); },   // aperçu live (canvas seul, sans commit ni undo)
    clearPreview() { preview = null; },                                // à appeler avant le commit : le commit re-render l'état réel
  };
```

(Le `stage.addEventListener('pointerdown', … select(null))` et `onPointerDown` appellent toujours `select()` — inchangés, ils passent maintenant par le store. Le ré-accrochage du nœud vivant ligne ~149 reste valide : `select()` peut déclencher blur+commit → render.)

- [ ] **Step 2 : `inspector.js` — recalculer `sel` depuis le store**

a) Signature : ajouter `selection`. Remplacer :

```js
export function createInspector(root, model, { rerenderCanvas, clearSelection, getActivePage = () => 0, previewProp, clearPreview, pushVisible } = {}) {
  let sel = null; // { placeIndex, ref } ou null
  let placementInputs = {}; // { anchor, dx, dy } → <input>/<select> de la rubrique Placement, pour la MAJ live au drag

  const comp = () => sel && model.state.components[sel.ref];
  const place = () => sel && model.state.pages?.[getActivePage()]?.place?.[sel.placeIndex];
```

par :

```js
export function createInspector(root, model, { selection, rerenderCanvas, clearSelection, getActivePage = () => 0, previewProp, clearPreview, pushVisible } = {}) {
  let sel = null; // { placeIndex, page, ref } ou null — RECALCULÉ depuis le store à chaque render()
  let placementInputs = {}; // { anchor, dx, dy } → <input>/<select> de la rubrique Placement, pour la MAJ live au drag

  // La sélection courante, dérivée du store : un composant existant, ou null (doc/page/null/périmé).
  // Le `ref` se DÉRIVE du placement (jamais stocké dans la sélection — cf. spec §1).
  const currentSel = () => {
    const s = selection.get();
    if (!s || s.kind !== 'comp') return null;
    const pl = model.state.pages?.[s.page]?.place?.[s.index];
    if (!pl) return null;
    return { placeIndex: s.index, page: s.page, ref: pl.ref };
  };

  const comp = () => sel && model.state.components[sel.ref];
  const place = () => sel && model.state.pages?.[sel.page]?.place?.[sel.placeIndex];
```

b) Supprimer la méthode `select()` (le garde F1 part dans le coordinateur app.js). Supprimer **tout** le bloc :

```js
  function select(s) {
    // Changement de sélection : si un champ de l'inspecteur a encore le focus, le blur AVANT de
    // changer `sel`. Sinon (F1) deux pièges quand on clique un autre widget déplaçable (son
    // pointerdown fait preventDefault → le focus ne part pas) : (a) le garde-focus de render()
    // bloque la reconstruction → l'inspecteur reste figé sur l'ANCIEN composant alors que le canvas
    // a déjà sélectionné le nouveau ; (b) une édition en attente (change non encore émis) se
    // committerait sur le NOUVEAU composant (clé étrangère → layout invalide). Blur ici committe
    // l'édition en attente sur l'ANCIEN composant (sel encore inchangé) puis lève le garde.
    const changed = sel?.ref !== s?.ref || sel?.placeIndex !== s?.placeIndex;
    if (changed && root.contains(document.activeElement) && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    sel = s;
    render();
  }
```

c) `render()` recalcule `sel` depuis le store. Au tout début de `render()`, juste après le garde-focus, remplacer :

```js
  function render() {
    // garde focus : ne pas reconstruire pendant qu'un champ de l'inspecteur est en cours d'édition.
    if (root.contains(document.activeElement) && document.activeElement !== document.body) return;
    if (_aimgPreviewTimer) { clearInterval(_aimgPreviewTimer); _aimgPreviewTimer = null; }   // stoppe l'apercu avant tout rebuild de l'inspecteur
```

par :

```js
  function render() {
    // garde focus : ne pas reconstruire pendant qu'un champ de l'inspecteur est en cours d'édition.
    if (root.contains(document.activeElement) && document.activeElement !== document.body) return;
    sel = currentSel();   // source de vérité : le store partagé (recalculé à chaque rendu)
    if (_aimgPreviewTimer) { clearInterval(_aimgPreviewTimer); _aimgPreviewTimer = null; }   // stoppe l'apercu avant tout rebuild de l'inspecteur
```

d) S'abonner au store + ne plus exposer `select`. Remplacer la fin :

```js
  model.subscribe(render);
  render();
  return { select, setLivePlacement };
```

par :

```js
  model.subscribe(render);
  selection.subscribe(render);   // changement de sélection (canvas/arbre) → reconstruire l'inspecteur
  render();
  return { setLivePlacement };
```

(Les closures de commit figent toujours `sel.ref`/`sel.placeIndex` au rendu — garde F5 intacte, puisque `sel` est recalculé en tête de `render()`. Le bouton « Supprimer » fait `sel = null; clearSelection()` → on garde, `clearSelection` est maintenant backé par le store côté app.js.)

- [ ] **Step 3 : `app.js` — store + coordinateur + recâblage**

a) Importer. Modifier l'import de `selection`/`mutations` — ajouter en tête d'`app.js` (avec les autres imports) :

```js
import { createSelection, sameSelection, isSelectionValid } from './selection.js';
```

b) Créer le store + le coordinateur, juste avant `let inspector;` (≈ ligne 60). Insérer :

```js
  // Sélection partagée (canvas ↔ inspecteur ↔ futur arbre). Coordinateur = garde F1 centralisé :
  // avant tout changement RÉEL de sélection, si un champ de l'inspecteur a le focus, le blur. Cela
  // (a) committe l'édition en attente sur l'ANCIENNE sélection (closure à ref figée — F5) et (b) lève
  // le garde-focus de render() pour que l'inspecteur se reconstruise sur la nouvelle sélection.
  const selection = createSelection(null);
  const setSelection = (next) => {
    if (!sameSelection(selection.get(), next)) {
      const insp = $('inspector');
      if (insp.contains(document.activeElement) && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    }
    selection.set(next);
  };
  // Purge d'une sélection périmée après suppression / undo / import (l'index ne pointe plus rien).
  model.subscribe(() => { if (!isSelectionValid(model.state, selection.get())) setSelection(null); });
```

c) Recâbler le canvas. Remplacer :

```js
  const canvas = createCanvas({ stage: $('stage') }, model, {
    onSelect: s => inspector.select(s),
    onLiveMove: p => inspector.setLivePlacement(p)   // MAJ live des champs Placement pendant le drag
  });
```

par :

```js
  const canvas = createCanvas({ stage: $('stage') }, model, {
    selection, setSelection,
    onLiveMove: p => inspector.setLivePlacement(p)   // MAJ live des champs Placement pendant le drag
  });
```

d) Recâbler l'inspecteur. Remplacer la 1re ligne de l'appel :

```js
  inspector = createInspector($('inspector'), model, {
    rerenderCanvas: canvas.render,
    clearSelection: () => canvas.selectPlacement(null),
```

par :

```js
  inspector = createInspector($('inspector'), model, {
    selection,
    rerenderCanvas: canvas.render,
    clearSelection: () => setSelection(null),
```

(Le reste de l'objet d'options inspecteur — `getActivePage`, `previewProp`, `clearPreview`, `pushVisible` — est inchangé. `palette`/`pages`/raccourcis/désélection globale d'`app.js` restent **inchangés** : ils passent par `canvas.getSelected()`/`selectPlacement()`/`setPage()`, désormais proxys du store.)

- [ ] **Step 4 : vérifier le suite node (régression des helpers) + syntaxe**

Run: `cd designer && node --test`
Expected: PASS, 258 cas (rien de cassé ; aucun test DOM).
Run: `cd designer && node --check js/canvas.js && node --check js/inspector.js && node --check js/app.js`
Expected: aucune sortie.

- [ ] **Step 5 : VÉRIFICATION NAVIGATEUR (régression — c'est le vrai filet)**

Servir le designer en local et tout exercer. Lancer un serveur sur un port libre (PAS 8000, réservé utilisateur — cf. mémoire ; le cache des modules ES impose souvent de changer de port ou `Cache-Control: no-store`) depuis `Dialboard/` :

```bash
cd /Users/jean-paulgavini/Documents/Dev/Dialboard && python3 -m http.server 8781
# puis ouvrir http://localhost:8781/designer/
```

Cocher **chaque** comportement (tout doit marcher **comme avant**) :
- [ ] Cliquer un widget → il se sélectionne (cadre + poignées), l'inspecteur affiche ses champs.
- [ ] Cliquer le vide (disque/liseré) → désélection, l'inspecteur retombe sur le panneau Layout/Page.
- [ ] Éditer une prop (texte/couleur/num) → commit sur `change`, undo/redo OK.
- [ ] **F5** : ouvrir le color picker d'un widget, bouger le curseur, **cliquer un AUTRE widget** → la couleur se committe sur le BON widget (celui qu'on éditait), pas le nouveau.
- [ ] **F1** : sélectionner widget A, focus dans un champ texte de A, puis cliquer widget B → l'inspecteur bascule sur B (pas figé sur A), et l'édition de A est committée sur A.
- [ ] Changer de page (onglets) → désélection + la page s'affiche.
- [ ] Glisser un type de la palette sur le canvas → crée + sélectionne le nouveau.
- [ ] Raccourcis : Cmd+C/Cmd+V (copie indépendante sélectionnée), Cmd+D (duplique + sélectionne), Suppr (retire), Échap (désélectionne).
- [ ] Drag d'un widget → aperçu live des champs Placement, **un seul** undo au drop.
- [ ] Supprimer via le bouton « Supprimer de la page » de l'inspecteur → retiré, inspecteur revient au panneau Page.
- [ ] **Undo** après une suppression d'un widget sélectionné → réapparaît ; la sélection ne « colle » pas à un index fantôme (purge `isSelectionValid`).

Arrêter le serveur après (`Ctrl-C` / kill).

- [ ] **Step 6 : commit**

```bash
git add designer/js/canvas.js designer/js/inspector.js designer/js/app.js
git commit -m "designer: sélection partagée — canvas+inspecteur lisent le store (F1 dans le coordinateur)

Refactor sans changement de comportement : canvas.selected et inspector.sel
remplaces par le store selection.js. Coordinateur setSelection (app.js)
centralise le garde F1 ; F5 (ref figee au rendu) intacte. getSelected/
selectPlacement gardes comme proxys -> raccourcis app.js inchanges.

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Task 3 : confirmer la purge `isSelectionValid` (déjà câblée en Task 2) — vérif ciblée

> La purge a été ajoutée en Task 2 step 3b. Cette tâche est une **vérification dédiée** des cas limites où l'ancien code reposait sur le repli de `render()` (comp/place absent → panneau Page) plutôt que sur une purge explicite du store.

**Files:** aucun (vérification).

- [ ] **Step 1 : vérif navigateur des cas de péremption**

Sur le serveur local :
- [ ] Sélectionner le **dernier** widget d'une page, faire **Undo** d'un ajout antérieur qui décale les index → la sélection ne pointe pas un autre widget par erreur (purge → désélection propre).
- [ ] **Importer** un layout (bouton Importer) pendant qu'un widget est sélectionné → désélection propre, pas d'inspecteur figé sur un ref disparu.
- [ ] **Charger** depuis le device (si dispo) idem.

- [ ] **Step 2 : (si un comportement diffère)** corriger `model.subscribe(() => { if (!isSelectionValid(...)) setSelection(null); })` dans `app.js`, re-vérifier, puis :

```bash
git add designer/js/app.js
git commit -m "designer: purge selection perimee (isSelectionValid) — ajustement

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

(Si tout est conforme dès Task 2 : pas de commit ici, cocher et passer.)

---

## Couverture du spec (auto-revue)

| Élément | Tâche |
|---|---|
| Externaliser la sélection canvas dans `selection.js` (spec §Risques, risque n°1) | Task 2 |
| Inspecteur piloté par la sélection (lecture du store) | Task 2 step 2 |
| Garde F1 préservé (blur avant changement) — centralisé dans le coordinateur | Task 2 step 3b |
| Garde F5 préservé (ref/placeIndex figés au rendu) | Task 2 step 2 (sel recalculé en tête de render) |
| `.ref` dérivé, jamais stocké (note revue finale Fondations #1) | Task 2 step 2 (`currentSel`) |
| Purge des sélections périmées (`isSelectionValid`) | Task 2 step 3b + Task 3 |
| Helper d'index pur testé | Task 1 |

**Hors de cette tranche (plans suivants) :** arbre des calques (Phase 3 : sélection de pages/Document, drag reorder/move → c'est là que l'**instabilité d'index** post-reorder/move de la note finale #3 devra être gérée) ; split inspecteur Document/Page/Composant (Phase 4). Aujourd'hui la sélection reste « composant ou null ».

## Notes pour l'exécutant

- **Refactor couplé** : la Task 2 doit être vue comme atomique (3 fichiers, 1 commit). Ne pas committer entre les steps 1-3.
- Le vrai filet est la **vérification navigateur** (step 5) : c'est un refactor « zéro changement de comportement », donc tout doit marcher *identiquement*. Si un comportement régresse, c'est un bug du câblage, pas une nouvelle fonctionnalité.
- Ne PAS toucher `render.js` (moteur de parité firmware), ni les raccourcis/`pages.js`/`palette.js` (ils passent par les proxys canvas inchangés).
- Port de test : **pas 8000** (réservé utilisateur). Cache des modules ES → changer de port entre deux essais si l'ancien JS persiste.
