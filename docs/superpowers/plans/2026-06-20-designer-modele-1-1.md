# Designer — modèle 1:1 + copier/coller/dupliquer — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirer la Bibliothèque-partage du designer et la remplacer par copier/coller (cross-page) + dupliquer (sur place), produisant toujours des copies indépendantes.

**Architecture:** Mutations pures dans `mutations.js` (testées `node --test`) + câblage DOM dans `app.js`/`inspector.js`. La suppression devient défensive (supprime le composant ssi plus référencé & non physique). Le panneau Bibliothèque et le drop `text/rt-ref` disparaissent. Zéro changement de schéma ni de firmware.

**Tech Stack:** JavaScript vanilla (ES modules), `node:test` + `node:assert/strict`, pas de build.

**Spec :** `docs/superpowers/specs/2026-06-20-designer-modele-1-1-design.md`

**Convention de commit :** chaque commit de ce plan se termine par la ligne
`Claude-Session: https://claude.ai/code/session_012QBMYnsJCr9dAm4e27UhhB`
(convention du repo). Les commandes ci-dessous montrent le message ; ajouter ce trailer.

**Branche :** travailler sur `designer-modele-1-1` (déjà créée, contient la spec).

**Lancer les tests :** `cd designer && node --test`

---

### Task 1 : Mutation `placeComponentCopy`

**Files:**
- Modify: `designer/js/mutations.js` (ajout après `removePlacement`, ~ligne 27)
- Test: `designer/tests/mutations.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter l'import en tête de `designer/tests/mutations.test.js` (compléter la liste existante lignes 3-9) avec `placeComponentCopy` :

```js
import {
  uniqueId, addComponent, addPlacement, removePlacement,
  placeComponentCopy,
  setComponentProp, setPlacementProp, setThresholds,
  addPage, removePage, renamePage, reorderPages, uniquePageName, pageNameTaken,
  setPageBackground, effectivePageBg,
  setPageBackgroundImage, effectivePageBgImage
} from '../js/mutations.js';
```

Ajouter les tests (à la fin du fichier) :

```js
test('placeComponentCopy : id neuf, copie indépendante, offset, ref re-pointé', () => {
  const s = fresh();
  s.components.bar1 = { type: 'bar', color: '#38BDF8', label: 'CPU' };
  const placement = { ref: 'bar1', anchor: 'CENTER', dx: 10, dy: 20 };
  const idx = placeComponentCopy(s, 0, s.components.bar1, placement);

  assert.equal(idx, 0);                              // index = dernier placement de la page
  const copy = s.pages[0].place[0];
  assert.equal(copy.ref, 'bar2');                    // uniqueId(bar), bar1 pris
  assert.equal(copy.dx, 18);                         // 10 + 8
  assert.equal(copy.dy, 28);                         // 20 + 8
  s.components.bar2.color = '#FF0000';
  assert.equal(s.components.bar1.color, '#38BDF8');  // original intact (copie indépendante)
});

test('placeComponentCopy : placement sans dx/dy → offset depuis 0', () => {
  const s = fresh();
  s.components.label1 = { type: 'label', text: 'Hi' };
  const idx = placeComponentCopy(s, 0, s.components.label1, { ref: 'label1', anchor: 'CENTER' });
  assert.equal(idx, 0);
  assert.equal(s.pages[0].place[0].dx, 8);
  assert.equal(s.pages[0].place[0].dy, 8);
});

test('placeComponentCopy : page absente → -1', () => {
  const s = fresh();
  assert.equal(placeComponentCopy(s, 9, { type: 'label' }, { ref: 'x' }), -1);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `placeComponentCopy is not a function` (ou export manquant).

- [ ] **Step 3 : Implémenter la mutation**

Dans `designer/js/mutations.js`, après `removePlacement` (ligne 27), ajouter :

```js
// Décalage (unités écran) appliqué à une copie pour qu'elle ne masque pas l'original.
const COPY_OFFSET = 8;

// Crée une copie INDÉPENDANTE d'un composant + place cette copie sur une page. Brique commune
// de duplicateComponent et du coller (paste) : la copie reçoit un id neuf (uniqueId), le
// placement est cloné, re-pointé sur le nouvel id et décalé. dx/dy sont des clés valides pour
// tout placement (schéma $defs/placement) ; pour un ring centré l'offset est inerte (copie
// concentrique). Retourne l'index du nouveau placement, ou -1 si la page/def est absente.
export function placeComponentCopy(state, pageIndex, compDef, placement) {
  const page = state.pages?.[pageIndex];
  if (!page || !compDef) return -1;
  const id = uniqueId(state, compDef.type);
  addComponent(state, id, structuredClone(compDef));
  const copy = { ...structuredClone(placement), ref: id,
                 dx: (placement.dx || 0) + COPY_OFFSET, dy: (placement.dy || 0) + COPY_OFFSET };
  addPlacement(state, pageIndex, copy);
  return page.place.length - 1;
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS (tous, y compris les 3 nouveaux).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/mutations.js designer/tests/mutations.test.js
git commit -m "designer: ajoute placeComponentCopy (copie indépendante d'un composant + placement)"
```

---

### Task 2 : Mutation `duplicateComponent`

**Files:**
- Modify: `designer/js/mutations.js` (après `placeComponentCopy`)
- Test: `designer/tests/mutations.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter `duplicateComponent` à l'import du fichier de test (à côté de `placeComponentCopy`), puis ajouter :

```js
test('duplicateComponent : copie indépendante depuis un placement existant', () => {
  const s = fresh();
  s.components.label1 = { type: 'label', text: 'Bonjour' };
  s.pages[0].place.push({ ref: 'label1', anchor: 'CENTER', dx: 0, dy: 0 });
  const idx = duplicateComponent(s, 0, 0);

  assert.equal(idx, 1);                               // ajouté après l'original
  assert.equal(s.pages[0].place[1].ref, 'label2');
  assert.equal(s.components.label2.text, 'Bonjour');  // contenu copié
  s.components.label2.text = 'Modifié';
  assert.equal(s.components.label1.text, 'Bonjour');  // original intact
});

test('duplicateComponent : placeIndex invalide → -1, aucun ajout', () => {
  const s = fresh();
  assert.equal(duplicateComponent(s, 0, 5), -1);
  assert.equal(s.pages[0].place.length, 0);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `duplicateComponent is not a function`.

- [ ] **Step 3 : Implémenter la mutation**

Dans `designer/js/mutations.js`, après `placeComponentCopy` :

```js
// Duplique le composant d'un placement EXISTANT en une copie indépendante sur la même page.
// Retourne l'index du nouveau placement, ou -1 si le placement / composant est introuvable.
export function duplicateComponent(state, pageIndex, placeIndex) {
  const placement = state.pages?.[pageIndex]?.place?.[placeIndex];
  if (!placement) return -1;
  const compDef = state.components?.[placement.ref];
  if (!compDef) return -1;
  return placeComponentCopy(state, pageIndex, compDef, placement);
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/mutations.js designer/tests/mutations.test.js
git commit -m "designer: ajoute duplicateComponent (duplique un placement existant)"
```

---

### Task 3 : Mutation `removePlacementAndOrphan` (suppression défensive)

**Files:**
- Modify: `designer/js/mutations.js` (import `COMPONENTS` en tête + fonction après `duplicateComponent`)
- Test: `designer/tests/mutations.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter `removePlacementAndOrphan` à l'import du fichier de test, puis ajouter :

```js
test('removePlacementAndOrphan : 1:1 → retire le placement ET le composant', () => {
  const s = fresh();
  s.components.bar1 = { type: 'bar' };
  s.pages[0].place.push({ ref: 'bar1', anchor: 'CENTER' });
  removePlacementAndOrphan(s, 0, 0);
  assert.equal(s.pages[0].place.length, 0);
  assert.equal(s.components.bar1, undefined);
});

test('removePlacementAndOrphan : composant encore référencé ailleurs → conservé', () => {
  const s = { components: { bar1: { type: 'bar' } },
              pages: [{ name: 'P1', place: [{ ref: 'bar1' }] },
                      { name: 'P2', place: [{ ref: 'bar1' }] }] };
  removePlacementAndOrphan(s, 0, 0);                  // retire l'occurrence page 1
  assert.equal(s.pages[0].place.length, 0);
  assert.ok(s.components.bar1);                       // page 2 l'utilise encore → conservé
});

test('removePlacementAndOrphan : composant physique jamais supprimé', () => {
  const s = fresh();
  s.components.led_ring1 = { type: 'led_ring' };
  s.pages[0].place.push({ ref: 'led_ring1' });        // cas théorique (un physique placé)
  removePlacementAndOrphan(s, 0, 0);
  assert.equal(s.pages[0].place.length, 0);
  assert.ok(s.components.led_ring1);                  // physique → conservé
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `removePlacementAndOrphan is not a function`.

- [ ] **Step 3 : Implémenter la mutation**

En tête de `designer/js/mutations.js` (après le bandeau de commentaire, avant `uniqueId`), ajouter l'import (sûr : `registry.js` → `geometry`/`render`, aucun cycle ; déjà chargé sous node par `registry.test.js`) :

```js
import { COMPONENTS } from './registry.js';
```

Puis, après `duplicateComponent` :

```js
// Retire un placement, puis supprime son composant s'il n'est plus référencé par aucun placement
// (toutes pages) ET qu'il n'est pas physique. Modèle 1:1 : le composant est en pratique toujours
// supprimé ; la garde « encore référencé » protège un éventuel ref hérité partagé (zéro casse, sans
// migration) ; la garde « physique » est défensive (led_ring/sound ne sont jamais placés).
export function removePlacementAndOrphan(state, pageIndex, placeIndex) {
  const placement = state.pages?.[pageIndex]?.place?.[placeIndex];
  if (!placement) return;
  const ref = placement.ref;
  removePlacement(state, pageIndex, placeIndex);
  const stillUsed = (state.pages || []).some(p => (p.place || []).some(pl => pl.ref === ref));
  if (stillUsed) return;
  const comp = state.components?.[ref];
  if (comp && !COMPONENTS[comp.type]?.physical) delete state.components[ref];
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS (y compris le test existant `removePlacement retire par index`, primitive inchangée).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/mutations.js designer/tests/mutations.test.js
git commit -m "designer: ajoute removePlacementAndOrphan (suppression défensive du composant orphelin)"
```

---

### Task 4 : Raccourcis duplicate / copy / paste

**Files:**
- Modify: `designer/js/shortcuts.js:18-25` (fonction `resolveShortcut`)
- Test: `designer/tests/shortcuts.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à la fin de `designer/tests/shortcuts.test.js` :

```js
test('Cmd+D → duplicate', () => {
  assert.equal(resolveShortcut({ key: 'd', metaKey: true, editable: false }), 'duplicate');
});
test('Ctrl+C → copy', () => {
  assert.equal(resolveShortcut({ key: 'c', ctrlKey: true, editable: false }), 'copy');
});
test('Cmd+V → paste', () => {
  assert.equal(resolveShortcut({ key: 'v', metaKey: true, editable: false }), 'paste');
});
test('Cmd+C dans un champ éditable → null (copie de texte native)', () => {
  assert.equal(resolveShortcut({ key: 'c', metaKey: true, editable: true }), null);
});
test('Cmd+Shift+D → null (non mappé, évite les raccourcis navigateur)', () => {
  assert.equal(resolveShortcut({ key: 'd', metaKey: true, shiftKey: true, editable: false }), null);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `Cmd+D → duplicate` attend `'duplicate'`, reçoit `null`.

- [ ] **Step 3 : Implémenter**

Remplacer le corps de `resolveShortcut` (`designer/js/shortcuts.js:18-25`) par :

```js
export function resolveShortcut(ev) {
  if (ev.editable) return null;                          // champ texte : laisser le comportement natif
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && (ev.key || '').toLowerCase() === 'z') return ev.shiftKey ? 'redo' : 'undo';
  if (mod && !ev.shiftKey) {                             // Cmd/Ctrl + lettre (sans Shift)
    const k = (ev.key || '').toLowerCase();
    if (k === 'd') return 'duplicate';
    if (k === 'c') return 'copy';
    if (k === 'v') return 'paste';
  }
  if (!mod && (ev.key === 'Delete' || ev.key === 'Backspace')) return 'delete';
  if (!mod && ev.key === 'Escape') return 'deselect';
  return null;
}
```

Mettre à jour le commentaire d'en-tête du fichier (lignes 2-8) pour citer aussi `Cmd/Ctrl+D/C/V`.

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/shortcuts.js designer/tests/shortcuts.test.js
git commit -m "designer: raccourcis Cmd/Ctrl+D/C/V (dupliquer, copier, coller)"
```

---

### Task 5 : Câblage `app.js` (presse-papier + actions + suppression défensive)

**Files:**
- Modify: `designer/js/app.js:19` (import), `app.js:107-130` (handler keydown), `app.js:72` (commentaire)

Pas de test unitaire (couche DOM, non testée par convention du projet). Vérification au navigateur.

- [ ] **Step 1 : Remplacer l'import**

`designer/js/app.js:19` :
```js
import { placeComponentCopy, duplicateComponent, removePlacementAndOrphan } from './mutations.js';
```
(remplace `import { removePlacement } from './mutations.js';`)

- [ ] **Step 2 : Ajouter le presse-papier et étendre le handler**

Juste avant le `document.addEventListener('keydown', ...)` (vers la ligne 107), déclarer le presse-papier :
```js
  // Presse-papier interne (session) : copie indépendante d'un composant + son placement, sans id.
  let clipboard = null;
```

Remplacer le commentaire + le handler `keydown` (lignes 107-130) par :
```js
  // Raccourcis clavier globaux : Cmd/Ctrl+Z = annuler, +Shift+Z = rétablir, Échap = désélectionner,
  // Cmd/Ctrl+D = dupliquer, +C = copier, +V = coller (copies indépendantes ; coller sur la page
  // active = réutilisation cross-page), Suppr = retirer de la page active. Inactifs dans un champ.
  document.addEventListener('keydown', e => {
    const action = resolveShortcut({
      key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey,
      editable: isEditableTarget(e.target)
    });
    if (!action) return;
    if (action === 'undo') { e.preventDefault(); if (model.canUndo()) model.undo(); return; }
    if (action === 'redo') { e.preventDefault(); if (model.canRedo()) model.redo(); return; }
    if (action === 'deselect') {
      if (canvas.getSelected() == null) return;
      e.preventDefault();
      canvas.selectPlacement(null);
      return;
    }
    if (action === 'copy') {
      const sel = canvas.getSelected();
      if (sel == null) return;
      const pl = model.state.pages?.[canvas.getActivePage()]?.place?.[sel];
      const cd = pl && model.state.components?.[pl.ref];
      if (!cd) return;
      e.preventDefault();
      clipboard = { compDef: structuredClone(cd), placement: structuredClone(pl) };
      return;
    }
    if (action === 'paste') {
      if (!clipboard) return;
      e.preventDefault();
      let ni = -1;
      model.commit(s => { ni = placeComponentCopy(s, canvas.getActivePage(), clipboard.compDef, clipboard.placement); });
      if (ni >= 0) canvas.selectPlacement(ni);          // sélectionne la copie après re-render
      return;
    }
    if (action === 'duplicate') {
      const sel = canvas.getSelected();
      if (sel == null) return;
      e.preventDefault();
      let ni = -1;
      model.commit(s => { ni = duplicateComponent(s, canvas.getActivePage(), sel); });
      if (ni >= 0) canvas.selectPlacement(ni);
      return;
    }
    // delete : ne consomme la touche que s'il y a une sélection.
    const sel = canvas.getSelected();
    if (sel == null) return;
    e.preventDefault();
    canvas.selectPlacement(null);                       // désélectionne avant le commit (cf. inspector.js)
    model.commit(s => removePlacementAndOrphan(s, canvas.getActivePage(), sel));
  });
```

- [ ] **Step 3 : Mettre à jour le commentaire `app.js:72`**

Remplacer la mention « ou un composant de la bibliothèque (partage) » par une description de la seule création par type (la bibliothèque n'existe plus).

- [ ] **Step 4 : Régression — les tests restent verts**

Run: `cd designer && node --test`
Expected: PASS (rien de cassé ; app.js n'est pas testé en unitaire).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/app.js
git commit -m "designer: câble dupliquer/copier/coller + suppression défensive (presse-papier interne)"
```

---

### Task 6 : Bouton « Supprimer de la page » → suppression défensive

**Files:**
- Modify: `designer/js/inspector.js:4` (import), `inspector.js:344`

Pas de test unitaire. Vérification au navigateur.

- [ ] **Step 1 : Remplacer l'import**

`designer/js/inspector.js:4` — remplacer `removePlacement` par `removePlacementAndOrphan` dans la liste importée depuis `./mutations.js` (vérifier qu'aucun autre usage de `removePlacement` ne subsiste dans le fichier ; le seul call site est la ligne 344).

- [ ] **Step 2 : Remplacer le call site**

`designer/js/inspector.js:344` :
```js
      model.commit(s => removePlacementAndOrphan(s, getActivePage(), i));
```

- [ ] **Step 3 : Régression**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 4 : Commit**

```bash
git add designer/js/inspector.js
git commit -m "designer: bouton supprimer → removePlacementAndOrphan (retire aussi le composant)"
```

---

### Task 7 : Retrait du panneau Bibliothèque

**Files:**
- Modify: `designer/js/palette.js` (retrait section Bibliothèque + branche `text/rt-ref`, MAJ commentaires)
- Modify: `designer/style.css` (retrait des classes `.lib-*`)
- Modify: `designer/js/pages.js:73` (commentaire)

Pas de test (palette non testée en unitaire, par convention). Vérification au navigateur.

- [ ] **Step 1 : Simplifier `palette.js`**

Supprimer la section Bibliothèque : les blocs créant `libTitle`, `libHint`, `libList` (≈ lignes 36-49), la fonction `renderLibrary` (≈ 51-73) et les appels `model.subscribe(renderLibrary); renderLibrary();` (≈ 74-75).

Remplacer les handlers `dragover`/`dragleave`/`drop` (≈ lignes 78-109) par la version « création par type » uniquement :
```js
  // --- Cible de drop : crée un composant du type glissé sur la page active ---
  stage.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('text/rt-type')) { e.preventDefault(); stage.classList.add('drop-active'); }
  });
  stage.addEventListener('dragleave', e => { if (!stage.contains(e.relatedTarget)) stage.classList.remove('drop-active'); });
  stage.addEventListener('drop', e => {
    const type = e.dataTransfer.getData('text/rt-type');
    stage.classList.remove('drop-active');
    if (!type) return;
    if (COMPONENTS[type]?.physical) return;             // type physique : pas de placement
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const s = r.width / SCREEN;                          // zoom d'affichage : ramener le drop en unités écran
    const x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s;
    const pi = page();
    let newIndex;
    model.commit(s => {
      const id = uniqueId(s, type);
      addComponent(s, id, COMPONENTS[type].defaults());
      addPlacement(s, pi, COMPONENTS[type].makePlacement(id, x, y));
      newIndex = s.pages[pi].place.length - 1;
    });
    if (newIndex != null) onCreated && onCreated(newIndex);
  });
```

Mettre à jour le commentaire d'en-tête (lignes 1-4) : ne décrire que la création par type (plus de bibliothèque/partage).

- [ ] **Step 2 : Retirer le CSS `.lib-*`**

Dans `designer/style.css`, supprimer la section « --- Plan C2 : bibliothèque de composants --- » et toutes ses règles : `.lib-title`, `.lib-list`, `.lib-item`, `.lib-item:active`, `.lib-item:hover`, `.lib-item:hover .palette-icon`, `.lib-item .lib-type`, `.lib-empty` (≈ lignes 211-222).

- [ ] **Step 3 : MAJ commentaire `pages.js:73`**

Remplacer la mention `'rt-type'/'rt-ref'` par `'rt-type'` (le type `rt-ref` n'existe plus).

- [ ] **Step 4 : Vérification au navigateur**

Servir depuis la racine du repo (port ≠ 8000) puis ouvrir le designer :
```bash
python3 -m http.server 8772 --bind 127.0.0.1   # depuis la racine Dialboard/, en arrière-plan
```
Ouvrir `http://127.0.0.1:8772/designer/index.html`. Vérifier :
- La section « Bibliothèque » a disparu de la palette ; seuls les 8 créateurs de type restent.
- Glisser un type (ex. Barre) sur le disque crée toujours un composant.
- Aucune erreur dans la console.

Arrêter le serveur après vérification : `pkill -f "http.server 8772"`.

- [ ] **Step 5 : Régression + Commit**

Run: `cd designer && node --test` → Expected: PASS.
```bash
git add designer/js/palette.js designer/style.css designer/js/pages.js
git commit -m "designer: retire le panneau Bibliothèque (modèle 1:1, plus de composant partagé)"
```

---

### Task 8 : Vérification de bout en bout (navigateur)

**Files:** aucun (vérification manuelle des critères de succès de la spec, §6). Pas de commit.

- [ ] **Step 1 : Servir et ouvrir**

```bash
python3 -m http.server 8772 --bind 127.0.0.1   # depuis la racine Dialboard/, en arrière-plan
```
Ouvrir `http://127.0.0.1:8772/designer/index.html` (le designer charge son layout par défaut).

- [ ] **Step 2 : Dérouler les critères**

- Sélectionner un composant, `Cmd/Ctrl+D` → une copie indépendante apparaît décalée et devient la sélection.
- `Cmd/Ctrl+C` sur un composant → naviguer vers une autre page → `Cmd/Ctrl+V` → la copie est collée sur cette page.
- Éditer une prop de la copie dans l'inspecteur → l'original n'est pas modifié (ouvrir « JSON avancé » pour confirmer deux ids distincts).
- Sélectionner un composant, `Suppr` (ou bouton « Supprimer de la page ») → le placement disparaît ET le composant disparaît de `components` (vérifier dans « JSON avancé »).
- Cliquer dans un champ texte de l'inspecteur, `Cmd/Ctrl+C`/`V` → copie/colle du texte natif (les raccourcis ne déclenchent pas dupliquer/coller de composant).

- [ ] **Step 3 : Arrêter le serveur**

```bash
pkill -f "http.server 8772"
```

Si tous les critères passent, l'implémentation est complète.

---

## Self-Review (auteur du plan)

**1. Couverture de la spec :**
- §4.1 modèle 1:1 / physiques → Task 3 (garde physique), Task 7 (retrait bibliothèque). ✓
- §4.2 `placeComponentCopy` / `duplicateComponent` / `removePlacementAndOrphan` / `removePlacement` conservée → Tasks 1, 2, 3. ✓
- §4.3 raccourcis + presse-papier + remplacement des 2 call sites → Task 4 (shortcuts), Task 5 (app.js:128), Task 6 (inspector.js:344). ✓
- §4.4 retrait Bibliothèque (palette.js + style.css + commentaires) → Task 7. ✓
- §4.5 tests → Tasks 1-4 (mutations + shortcuts). ✓
- §6 critères de succès → Task 8. ✓

**2. Placeholders :** aucun TBD/TODO ; tout le code est explicite.

**3. Cohérence des types/signatures :** `placeComponentCopy(state, pageIndex, compDef, placement)`, `duplicateComponent(state, pageIndex, placeIndex)`, `removePlacementAndOrphan(state, pageIndex, placeIndex)` — noms et signatures identiques entre mutations, tests et câblage app.js/inspector.js. `canvas.getSelected()/getActivePage()/selectPlacement(i|null)` conformes à `canvas.js:322`. `COPY_OFFSET = 8` cohérent avec les tests (dx 10→18, 0→8). ✓
