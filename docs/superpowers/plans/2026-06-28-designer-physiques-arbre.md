# Physiques dans l'arbre (composants statiques du Document) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire des sorties physiques (`led_ring`, `sound`) des composants statiques du Document dans l'arbre des calques, éditables dans l'inspecteur (parité complète, aperçu LED inclus), et supprimer le panneau Device séparé (le tiroir devient « Sources »).

**Architecture :** Nouvelle forme de sélection `{kind:'physical', ref}` (sans placement). L'arbre rend le nœud Document dépliable avec les physiques en enfants ; l'inspecteur route un physique vers `renderComp` (déjà conscient des physiques) et y porte l'aperçu de l'anneau LED. Le tiroir perd ses onglets : un seul panneau Sources. 100 % designer — firmware/schéma/`render.js` intacts.

**Tech Stack :** JS modules ES (designer), tests `node:test` (`cd designer && node --test`), vérif DOM au navigateur (no-store + vrais events pointer). LVGL/firmware non touchés.

**Branche :** `feat/designer-physiques-arbre` (déjà créée ; spec à `docs/superpowers/specs/2026-06-28-designer-physiques-arbre-design.md`).

**Convention de test du projet :** la logique pure est testée en `node:test` (TDD). Le DOM (arbre, inspecteur, tiroir) n'a **pas** de test node (cf. `drawer.js`) → vérifié au navigateur en fin des tâches DOM.

**Préambule vérif navigateur** (réutilisé par les tâches DOM) — serveur no-store sur port ≠ 8000 :
```bash
cd designer && node -e "const h=require('http'),f=require('fs'),p=require('path');h.createServer((q,s)=>{let fp=p.join(process.cwd(),q.url==='/'?'/index.html':q.url.split('?')[0]);f.readFile(fp,(e,d)=>{if(e){s.writeHead(404);return s.end()}const ct={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'}[p.extname(fp)]||'application/octet-stream';s.writeHead(200,{'Content-Type':ct,'Cache-Control':'no-store'});s.end(d)})}).listen(8011,()=>console.log('http://localhost:8011'))"
```
Piloter avec Playwright/Chrome en **vrais events pointer** (pas `.click()`), console à 0 erreur. Arrêter le serveur après.

---

## File Structure

- `designer/js/selection.js` — **modifié** : forme `physical` dans `sameSelection`/`isSelectionValid` (+ commentaire). Pur.
- `designer/tests/selection.test.js` — **modifié** : cas `physical`.
- `designer/js/tree.js` — **modifié** : `treeModel` expose `physicals` ; `render` rend le Document dépliable + `physicalRow` ; `beginRename`/`runMenu`/`selection.subscribe` gèrent `physical`. Pur (treeModel) + DOM (reste).
- `designer/tests/tree.test.js` — **modifié** : `treeModel` expose les physiques hors pages.
- `designer/js/contextmenu.js` — **modifié** : `contextMenuItems` → `physical` = `rename` seul. Pur.
- `designer/tests/contextmenu.test.js` — **créé** : cas `physical`.
- `designer/js/inspector.js` — **modifié** : `currentSel` reconnaît `physical` ; note `sound` ; port de l'aperçu LED. DOM.
- `designer/js/app.js` — **modifié** : retrait de `createDevicePanel`.
- `designer/js/drawer.js` — **réécrit** : plus d'onglets, panneau Sources unique. DOM.
- `designer/index.html` — **modifié** : tiroir « Sources » sans onglets, sans `#device`.
- `designer/i18n/en.js` + `designer/i18n/fr.json` — **modifiés** : clés tiroir renommées/retirées, libellés Sources, clé orpheline retirée. Parité EN/FR stricte.
- `designer/js/device-panel.js` — **supprimé**.
- `designer/tests/device.test.js` — **modifié** : retrait du test `createDevicePanel`.

---

## Task 1 : Modèle de sélection — forme `{kind:'physical', ref}`

**Files:**
- Modify: `designer/js/selection.js`
- Test: `designer/tests/selection.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à la fin de `designer/tests/selection.test.js` :
```js
test('sameSelection : physiques par ref (intent : un physique = son id, pas de page/index)', () => {
  assert.equal(sameSelection({ kind: 'physical', ref: 'led' }, { kind: 'physical', ref: 'led' }), true);
  assert.equal(sameSelection({ kind: 'physical', ref: 'led' }, { kind: 'physical', ref: 'buzz' }), false);
  assert.equal(sameSelection({ kind: 'physical', ref: 'led' }, { kind: 'comp', page: 0, index: 0 }), false);
});

test('isSelectionValid : physique valide ssi le composant existe (intent : ne pas éditer un id supprimé)', () => {
  const state = { components: { led: { type: 'led_ring' } }, pages: [] };
  assert.equal(isSelectionValid(state, { kind: 'physical', ref: 'led' }), true);
  assert.equal(isSelectionValid(state, { kind: 'physical', ref: 'absent' }), false);
});

test('placementSelection : un physique ne se surligne pas sur le canvas (intent : pas de placement)', () => {
  assert.equal(placementSelection({ kind: 'physical', ref: 'led' }, 0), null);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd designer && node --test tests/selection.test.js`
Expected: FAIL (`sameSelection` renvoie `true` par défaut pour `physical` via le `return true` final → le 2e cas `led` vs `buzz` échoue ; `isSelectionValid` lit `state.pages?.[undefined]` → `false` même pour un physique valide → le cas « valide » échoue).

- [ ] **Step 3 : Implémenter dans `selection.js`**

Dans `sameSelection`, ajouter la ligne `physical` **avant** le `return true` final :
```js
  if (a.kind === 'comp') return a.page === b.page && a.index === b.index;
  if (a.kind === 'physical') return a.ref === b.ref;
  return true;                       // 'doc' (pas d'autre champ discriminant)
```

Dans `isSelectionValid`, ajouter la branche `physical` **avant** la recherche de page :
```js
export function isSelectionValid(state, sel) {
  if (!sel) return false;
  if (sel.kind === 'doc') return true;
  if (sel.kind === 'physical') return !!state.components?.[sel.ref];
  const page = state.pages?.[sel.page];
  if (!page) return false;
  if (sel.kind === 'page') return true;
  return !!page.place?.[sel.index];   // 'comp'
}
```

Mettre à jour le bloc de commentaire d'entête (liste des formes) en ajoutant :
```js
//   { kind: 'physical', ref }             → un composant global (led_ring/sound), sans placement
```

(`placementSelection` est déjà correct : `kind !== 'comp'` → `null`. Aucun changement.)

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test tests/selection.test.js`
Expected: PASS (tous).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/selection.js designer/tests/selection.test.js
git commit -m "feat(designer): sélection — forme physical (composant global sans placement)"
```

---

## Task 2 : `treeModel` expose les physiques (hors pages)

**Files:**
- Modify: `designer/js/tree.js` (fonction `treeModel`, l.21-41 ; imports l.4-6)
- Test: `designer/tests/tree.test.js`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `designer/tests/tree.test.js` :
```js
test('treeModel : les physiques sont listés hors pages, par ref + type + label', () => {
  const state = {
    title: 'D',
    components: {
      led: { type: 'led_ring' },
      buzz: { type: 'sound' },
      t1: { type: 'label', text: 'x' },
    },
    pages: [{ name: 'P1', place: [{ ref: 't1' }, { ref: 'led' }] }],
  };
  const tm = treeModel(state);
  // physiques présents, par ref
  assert.deepEqual(tm.physicals.map(p => p.ref).sort(), ['buzz', 'led']);
  // un physique n'apparaît JAMAIS dans une page, même si un placement le référence par erreur (legacy)
  assert.equal(tm.pages[0].components.some(c => c.ref === 'led'), true); // (legacy : reste affiché côté page si placé)
  // type et label remontés
  const led = tm.physicals.find(p => p.ref === 'led');
  assert.equal(led.type, 'led_ring');
  assert.equal(typeof led.label, 'string');
});
```
> Note : `tm.physicals` provient de `state.components` (via `physicalComponentIds`), indépendamment des placements ; `ensurePhysicals`/`stripPhysicalPlacements` garantissent en pratique qu'aucun physique n'est placé. Le test vérifie surtout la **présence dans `physicals`** et la forme.

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd designer && node --test tests/tree.test.js`
Expected: FAIL (`tm.physicals` est `undefined` → `.map` lève).

- [ ] **Step 3 : Implémenter dans `tree.js`**

Ajouter l'import de `physicalComponentIds` (l.6, à la suite des imports `./mutations.js` — `physicalComponentIds` vient de `./physical.js`) :
```js
import { physicalComponentIds } from './physical.js';
```

Dans `treeModel`, calculer `physicals` et l'ajouter au retour :
```js
export function treeModel(state) {
  const comps = state?.components || {};
  const physicals = physicalComponentIds(state || {}).map(ref => {
    const type = comps[ref]?.type ?? null;
    return { ref, type, label: type ? t(COMPONENTS[type].label) : '?' };
  });
  const pages = (state?.pages || []).map((p, index) => {
    /* … inchangé … */
  });
  return { title: state?.title ?? '', physicals, pages };
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test tests/tree.test.js`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/tree.js designer/tests/tree.test.js
git commit -m "feat(designer): treeModel expose les physiques hors pages"
```

---

## Task 3 : `contextMenuItems` — physique = « Renommer » seulement

**Files:**
- Modify: `designer/js/contextmenu.js` (fonction `contextMenuItems`, début l.9)
- Test: `designer/tests/contextmenu.test.js` (**créé**)

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `designer/tests/contextmenu.test.js` :
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextMenuItems } from '../js/contextmenu.js';

test('contextMenuItems : physique → un seul item « Renommer » (intent : permanent, ni suppr/déplacement/z-order)', () => {
  const items = contextMenuItems({ kind: 'physical', ref: 'led' }, { pages: [], components: { led: { type: 'led_ring' } } });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'rename');
});

test('contextMenuItems : doc/null → menu vide (régression existante)', () => {
  assert.deepEqual(contextMenuItems({ kind: 'doc' }, {}), []);
  assert.deepEqual(contextMenuItems(null, {}), []);
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd designer && node --test tests/contextmenu.test.js`
Expected: FAIL (sans branche `physical`, le code tombe dans la branche `comp` et lit `pages[sel.page]?.place` → `sel.page` indéfini → menu `comp` complet, `length !== 1`).

- [ ] **Step 3 : Implémenter dans `contextmenu.js`**

Ajouter la branche `physical` juste après la garde `doc/null` (l.10) :
```js
export function contextMenuItems(sel, state, { hasClipboard = false } = {}) {
  if (!sel || sel.kind === 'doc') return [];
  if (sel.kind === 'physical') return [{ id: 'rename', label: t('ctx.rename_id') }];
  const pages = state?.pages || [];
  /* … reste inchangé … */
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test tests/contextmenu.test.js`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/contextmenu.js designer/tests/contextmenu.test.js
git commit -m "feat(designer): menu contextuel — physique = Renommer seulement"
```

---

## Task 4 : Arbre DOM — Document dépliable + `physicalRow` + renommage

**Files:**
- Modify: `designer/js/tree.js` (état closures l.67-71 ; `render` doc l.407-415 + boucle pages ; `beginRename` l.437-446 ; `runMenu` l.449-482 ; `selection.subscribe` l.430-434 ; nouvelle fonction `physicalRow`)

> DOM → pas de test node ; vérif navigateur en Step final.

- [ ] **Step 1 : Ajouter l'état `expandedDoc` et `renamingPhysical`**

Dans `createTree`, près des autres `let` (après `let renamingComp = null;`, l.68) :
```js
  let renamingPhysical = null;   // ref du physique en rename inline, ou null
  let expandedDoc = true;        // nœud Document déplié par défaut (montre les physiques)
```

- [ ] **Step 2 : Écrire `physicalRow` (calquée sur `compRow`, sans drag/œil/suppression)**

Ajouter la fonction (par ex. juste après `compRow`, avant `pageRow`) :
```js
  function physicalRow(ph, sel) {
    if (renamingPhysical === ph.ref) {
      const row = document.createElement('div'); row.className = 'tree-row tree-comp tree-physical';
      const inp = document.createElement('input'); inp.className = 'tree-rename'; inp.value = ph.ref;
      const orig = ph.ref;
      const tryCommit = () => {
        const id = inp.value.trim();
        if (!id || id === orig) { renamingPhysical = null; render(); return true; }
        if (!isValidId(id)) { showToast(t('id.invalid')); return false; }
        if (model.state.components?.[id]) { showToast(t('id.taken', { id })); return false; }
        renamingPhysical = null;
        model.commit(s => renameComponent(s, orig, id));
        return true;
      };
      inp.addEventListener('input', () => {
        const v = inp.value.trim();
        inp.classList.toggle('invalid', !!v && v !== orig && (!isValidId(v) || !!model.state.components?.[v]));
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); tryCommit(); }
        else if (e.key === 'Escape') { e.preventDefault(); renamingPhysical = null; render(); }
      });
      inp.addEventListener('blur', () => { if (renamingPhysical && !tryCommit()) { renamingPhysical = null; render(); } });
      row.appendChild(inp);
      queueMicrotask(() => { inp.focus(); inp.select(); });
      return row;
    }

    const row = document.createElement('div');
    const isSel = sel && sel.kind === 'physical' && sel.ref === ph.ref;
    row.className = 'tree-row tree-comp tree-physical' + (isSel ? ' selected' : '');
    const ic = ph.type ? iconFor(ph.type) : null;
    if (ic) { ic.classList.add('tree-icon'); row.appendChild(ic); }
    const name = document.createElement('span'); name.className = 'tree-label'; name.textContent = ph.ref;
    const type = document.createElement('span'); type.className = 'tree-ref'; type.textContent = ph.label;
    row.appendChild(name); row.appendChild(type);
    row.addEventListener('click', () => { setSelection({ kind: 'physical', ref: ph.ref }); render(); });
    row.addEventListener('dblclick', e => {
      e.preventDefault();
      setSelection({ kind: 'physical', ref: ph.ref });
      renamingPhysical = ph.ref; render();
    });
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      setSelection({ kind: 'physical', ref: ph.ref });
      render();
      openContextMenu(e.clientX, e.clientY,
        contextMenuItems(selection.get(), model.state, { hasClipboard: !!getClipboard() }),
        runMenu);
    });
    return row;   // PAS draggable, PAS d'œil, PAS de suppression (permanent, sans placement)
  }
```

- [ ] **Step 3 : Rendre le nœud Document dépliable et y accrocher les physiques**

Dans `render()`, remplacer le bloc Document (actuellement `dtw.textContent = '⚙'` non interactif, l.410-415) par :
```js
    // Document
    const doc = document.createElement('div');
    doc.className = 'tree-row tree-doc' + (sel && sel.kind === 'doc' ? ' selected' : '');
    const dtw = document.createElement('span'); dtw.className = 'tree-twist';
    dtw.textContent = expandedDoc ? '▾' : '▸';
    dtw.title = expandedDoc ? t('tree.twist.collapse') : t('tree.twist.expand');
    dtw.addEventListener('click', e => { e.stopPropagation(); expandedDoc = !expandedDoc; render(); });
    const dlbl = document.createElement('span'); dlbl.className = 'tree-label';
    dlbl.textContent = t('tree.doc', { title: tm.title || t('tree.untitled') });
    doc.appendChild(dtw); doc.appendChild(dlbl);
    doc.addEventListener('click', () => { setSelection({ kind: 'doc' }); render(); });
    tree.appendChild(doc);
    if (expandedDoc) tm.physicals.forEach(ph => tree.appendChild(physicalRow(ph, sel)));
```

- [ ] **Step 4 : Câbler `beginRename`, `runMenu`, `selection.subscribe` pour `physical`**

Dans `beginRename` (l.437) ajouter une branche :
```js
  function beginRename() {
    const sel = selection.get();
    if (!sel) return;
    if (sel.kind === 'page') { goPage(sel.page); renaming = sel.page; render(); }
    else if (sel.kind === 'comp') {
      if (sel.page !== getActivePage()) goPage(sel.page);
      renamingComp = { page: sel.page, index: sel.index };
      render();
    }
    else if (sel.kind === 'physical') { expandedDoc = true; renamingPhysical = sel.ref; render(); }
  }
```

Dans `runMenu` (l.449), ajouter la branche `physical` (après le bloc `sel.kind === 'page'`) :
```js
    } else if (sel.kind === 'physical') {
      if (id === 'rename') return beginRename();
    }
```

Dans `selection.subscribe` (l.430), déplier le Document quand un physique devient sélectionné (canvas n'en sélectionne pas, mais Échap/programmatique oui) :
```js
  selection.subscribe(() => {
    const sel = selection.get();
    if (sel && sel.kind === 'comp') expanded.add(sel.page);
    if (sel && sel.kind === 'physical') expandedDoc = true;
    render();
  });
```

- [ ] **Step 5 : Vérifier que la suite node reste verte**

Run: `cd designer && node --test`
Expected: PASS (442 + nouveaux tests des Tasks 1-3 ; aucune régression — le DOM n'est pas testé node mais `treeModel` l'est).

- [ ] **Step 6 : Vérif navigateur (préambule no-store + Playwright pointer réel)**

Observer :
- Nœud Document avec chevron ▾, déplié par défaut ; `led` et `buzz` listés dessous (icône + **nom en blanc**, **type grisé**).
- Clic sur le chevron → plie/déplie ; clic sur le libellé Document → sélectionne le Document (inspecteur vue Document).
- Clic sur `led`/`buzz` → ligne surlignée (l'inspecteur viendra en Task 5/6 ; ici, juste la sélection + surlignage).
- Double-clic sur `led` → input de renommage ; renommer en `led2` valide ; renommer en `buzz` → toast « id déjà pris », pas de changement.
- Clic droit sur `led` → menu avec **« Renommer » uniquement**.
- `led`/`buzz` **non draggables** (tenter un drag ne les déplace pas), **pas d'œil**, **pas de ✕**.
- Console : 0 erreur.

- [ ] **Step 7 : Commit**

```bash
git add designer/js/tree.js
git commit -m "feat(designer): arbre — Document dépliable + physiques en enfants (sélection/rename)"
```

---

## Task 5 : Inspecteur — sélection d'un physique + note `sound`

**Files:**
- Modify: `designer/js/inspector.js` (`currentSel` l.135-145 ; `renderComp` l.564-587 — props section l.589-616)

> DOM → vérif navigateur.

- [ ] **Step 1 : `currentSel` reconnaît `physical`**

Dans `currentSel` (l.136), ajouter la branche `physical` **avant** le test `comp` placement-dépendant :
```js
  const currentSel = () => {
    const s = selection.get();
    if (s && s.kind === 'physical') return { ref: s.ref, physical: true };
    if (!s || s.kind !== 'comp') return null;
    const pl = model.state.pages?.[s.page]?.place?.[s.index];
    if (!pl) return null;
    return { placeIndex: s.index, page: s.page, ref: pl.ref };
  };
```
(`comp()` = `model.state.components[sel.ref]` résout alors le led_ring/sound ; `place()` → `null` car `sel.page` indéfini. Le dispatch `render()` route donc vers `renderComp` via `c = comp()`.)

- [ ] **Step 2 : Note `sound` + ne pas afficher de section « Propriétés » vide**

Dans `renderComp`, juste après `body.appendChild(head);` (l.587), ajouter la note pour `sound` :
```js
    body.appendChild(head);
    if (c.type === 'sound') note(body, t('device.note_sound'));
```
Puis garder la section « Propriétés » **uniquement si** le type a des `compFields` (évite une section vide pour `sound`). Englober la création/append de `propSec` (l.589-616) :
```js
    if (COMPONENTS[c.type].compFields.length) {
      const { sec: propSec, body: propBody } = section(t('inspector.sec.props'));
      const rows = {};
      for (const [key, label, kind, enableWhen] of COMPONENTS[c.type].compFields) {
        /* … corps inchangé … */
      }
      body.appendChild(propSec);
      const syncEnabled = () => { /* … inchangé … */ };
      syncEnabled();
      body.addEventListener('change', syncEnabled);
    }
```
> Attention : `syncEnabled` et son `body.addEventListener('change', …)` passent **à l'intérieur** du `if` (ils dépendent de `rows`). Le reste de `renderComp` (`renderExtras`, bouton device-visible) est inchangé et reste après.

- [ ] **Step 3 : Vérifier la suite node**

Run: `cd designer && node --test`
Expected: PASS (aucun test node sur l'inspecteur ; rien ne doit casser).

- [ ] **Step 4 : Vérif navigateur**

- Clic sur `led` (led_ring) dans l'arbre → inspecteur : en-tête `led_ring · led`, section **Propriétés** avec Couleur / Luminosité / Mode / Période (Période grisée hors spinner/blink/breathe), section **Valeur mock**. Pas d'œil d'en-tête, pas de bouton « cacher sur device ».
- Clic sur `buzz` (sound) → inspecteur : en-tête `sound · buzz`, **note** « déclenché via /update … », **pas** de section « Propriétés » vide.
- Éditer le mode/couleur/luminosité du led_ring committe (visible dans l'undo/redo).
- Sélectionner un physique puis un composant placé d'une page → l'inspecteur bascule correctement (pas de figement).
- Console : 0 erreur.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/inspector.js
git commit -m "feat(designer): inspecteur — édition d'un physique sélectionné (+ note sound)"
```

---

## Task 6 : Inspecteur — port de l'aperçu de l'anneau LED

**Files:**
- Modify: `designer/js/inspector.js` (imports ; closure var raf ; `render` annulation ; `renderComp` cas `led_ring` après `renderExtras`)

> Reprend la logique de `device-panel.js` (mini-anneau + bouton ▶ animé). DOM → vérif navigateur.

- [ ] **Step 1 : Importer les helpers d'aperçu**

En tête de `inspector.js`, ajouter (à côté des autres imports) :
```js
import { paintRing, ledFrame, ledFrameAt } from './led-ring-preview.js';
```
(`getMock` est déjà importé — utilisé par `renderExtras`.)

- [ ] **Step 2 : Déclarer le raf et l'annuler à chaque rebuild**

Dans `createInspector`, près des autres `let` (à côté de `sel`/`placementInputs`) :
```js
  let ledPreviewRaf = null;   // requestAnimationFrame de l'aperçu LED animé, ou null
  const stopLedPreview = () => { if (ledPreviewRaf) { cancelAnimationFrame(ledPreviewRaf); ledPreviewRaf = null; } };
```
Dans `render()`, à l'endroit où l'on stoppe déjà `_aimgPreviewTimer` (l.668), ajouter :
```js
    stopLedPreview();   // un aperçu en cours pointerait un nœud bientôt détaché
```

- [ ] **Step 3 : Rendre le mini-anneau + bouton ▶ pour le led_ring**

Dans `renderComp`, **après** `renderExtras(body, c);` (l.631), ajouter le bloc :
```js
    if (c.type === 'led_ring') {
      const ref = sel.ref;                                   // figé au rendu (cf. invariant inspecteur)
      const liveComp = () => model.state.components[ref] || c;
      const mini = document.createElement('div'); mini.className = 'led-ring-mini';
      paintRing(mini, ledFrame(liveComp(), getMock(ref, 'led_ring')));
      body.appendChild(mini);

      const play = document.createElement('button'); play.className = 'src-add'; play.textContent = t('device.preview');
      play.addEventListener('click', () => {
        if (ledPreviewRaf) { stopLedPreview(); play.textContent = t('device.preview'); paintRing(mini, ledFrame(liveComp(), getMock(ref, 'led_ring'))); return; }
        play.textContent = t('device.preview_stop');
        const loop = () => { paintRing(mini, ledFrameAt(liveComp(), getMock(ref, 'led_ring'), performance.now())); ledPreviewRaf = requestAnimationFrame(loop); };
        loop();
      });
      body.appendChild(play);

      // Repeint le mini (frame statique) sur tout 'change' de l'inspecteur (mode/couleur/luminosité/valeur mock),
      // sauf pendant l'animation ▶. Sans rebuild → reste à jour même quand le garde-focus bloque render().
      body.addEventListener('change', () => { if (!ledPreviewRaf) paintRing(mini, ledFrame(liveComp(), getMock(ref, 'led_ring'))); });
    }
```

- [ ] **Step 4 : Vérifier la suite node**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 5 : Vérif navigateur**

- Sélectionner `led` → mini-anneau peint sous les sections ; **▶ Aperçu** lance l'animation (anneau qui tourne/respire selon le mode), re-clic (⏸) l'arrête.
- Changer Mode/Couleur/Luminosité ou la Valeur mock → le mini-anneau se met à jour (hors animation).
- Sélectionner un autre composant pendant l'animation → l'animation s'arrête proprement (pas d'erreur « nœud détaché », `cancelAnimationFrame` au rebuild). Console : 0 erreur.

- [ ] **Step 6 : Commit**

```bash
git add designer/js/inspector.js
git commit -m "feat(designer): inspecteur — port de l'aperçu de l'anneau LED (mini + ▶)"
```

---

## Task 7 : Retrait du panneau Device + tiroir « Sources » unique + i18n

**Files:**
- Modify: `designer/js/app.js` (import l.19 + appel l.247)
- Rewrite: `designer/js/drawer.js`
- Modify: `designer/index.html` (bloc tiroir l.82-100 ; tooltip toggle l.42)
- Modify: `designer/i18n/en.js` + `designer/i18n/fr.json`
- Delete: `designer/js/device-panel.js`
- Modify: `designer/tests/device.test.js` (retrait du test `createDevicePanel`)

> Après les Tasks 4-6, les physiques sont pleinement gérés via arbre + inspecteur ; le panneau Device est désormais redondant.

- [ ] **Step 1 : `app.js` — retirer `createDevicePanel`**

Supprimer l'import (l.19) :
```js
import { createDevicePanel } from './device-panel.js';
```
et l'appel (l.247, + son commentaire l.245-246) :
```js
  // Panneau Device : composants physiques (led_ring/sound) édités hors pages (sorties globales).
  // L'aperçu de l'anneau LED vit dans le mini-aperçu du panneau Device (le liseré du canvas a été retiré).
  createDevicePanel($('device'), model);
```

- [ ] **Step 2 : Réécrire `drawer.js` (panneau Sources unique, sans onglets)**

Remplacer tout `designer/js/drawer.js` par :
```js
// Tiroir « Sources » : slide-over latéral droit hébergeant le panneau des sources pull (#sources,
// monté par app.js). Géré ici : ouverture/fermeture (bouton toolbar, ✕, Échap, clic backdrop).
// Câblage DOM, vérifié navigateur (aucune logique pure → pas de test node, cf. convention projet).
export function createDrawer(root, { toggleBtn, onOpen }) {
  const backdrop = root.querySelector('.drawer-backdrop');
  const closeBtn = root.querySelector('.drawer-close');
  const open = () => { onOpen && onOpen(); root.hidden = false; };
  const close = () => { root.hidden = true; };
  const toggle = () => { root.hidden ? open() : close(); };

  toggleBtn.onclick = toggle;
  closeBtn.onclick = close;
  backdrop.onclick = close;
  // Échap ferme le tiroir s'il est ouvert (cohabite avec l'Échap global d'app.js).
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });

  return { open, close, toggle };
}
```

- [ ] **Step 3 : `index.html` — tiroir « Sources » sans onglets, sans `#device`**

Remplacer le bloc `<aside id="drawer" …>` (l.82-100) par :
```html
  <aside id="drawer" class="drawer" hidden>
    <div class="drawer-backdrop"></div>
    <div class="drawer-panel" role="dialog" aria-label="Sources" data-i18n-aria-label="drawer.sources.aria">
      <div class="drawer-head">
        <h2 data-i18n="drawer.sources.title">Sources</h2>
        <button class="drawer-close" type="button" data-i18n-title="drawer.close" title="Fermer">✕</button>
      </div>
      <div id="sources-pane" class="drawer-pane">
        <div id="sources" class="sources-panel"></div>
      </div>
    </div>
  </aside>
```
Et mettre à jour le `title` en dur du bouton toggle (l.42) pour cohérence (le `data-i18n-*` reste sur les mêmes clés, dont on change la valeur en Step 4) :
```html
      <button id="drawer-toggle" class="tb-btn" type="button" data-i18n-tip="toolbar.device.tip" data-i18n-title="toolbar.device.title" data-tip="Sources" title="Sources (pull)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4"/></svg></button>
```

- [ ] **Step 4 : i18n — `en.js` (source de vérité)**

Dans `designer/i18n/en.js` :
- `toolbar.device.tip` → `'Sources (pull)'`
- `toolbar.device.title` → `'Pull sources'`
- **Renommer** `drawer.device.aria` → `drawer.sources.aria` (valeur `'Sources'`)
- **Renommer** `drawer.device.title` → `drawer.sources.title` (valeur `'Sources'`)
- **Supprimer** `drawer.tab.outputs` et `drawer.tab.sources`
- **Supprimer** `device.rename_tip` (orpheline après suppression de device-panel.js)
- `inspector.link.device` → `'Open sources →'`
- `inspector.link.device_tip` → `'Pull sources'`
- (conserver `device.note_sound`, `device.preview`, `device.preview_stop` — réutilisées par l'inspecteur)

- [ ] **Step 5 : i18n — `fr.json` (parité stricte)**

Dans `designer/i18n/fr.json`, mêmes opérations :
- `"toolbar.device.tip"` → `"Sources (pull)"`
- `"toolbar.device.title"` → `"Sources pull"`
- **Renommer** `"drawer.device.aria"` → `"drawer.sources.aria"` (`"Sources"`)
- **Renommer** `"drawer.device.title"` → `"drawer.sources.title"` (`"Sources"`)
- **Supprimer** `"drawer.tab.outputs"`, `"drawer.tab.sources"`
- **Supprimer** `"device.rename_tip"`
- `"inspector.link.device"` → `"Ouvrir les sources →"`
- `"inspector.link.device_tip"` → `"Sources pull"`

- [ ] **Step 6 : Supprimer `device-panel.js` et son test**

```bash
git rm designer/js/device-panel.js
```
Dans `designer/tests/device.test.js` : retirer l'import (`import { createDevicePanel } from '../js/device-panel.js';`) et le test `createDevicePanel : createDevicePanel(root, model) — fabrique à 2 paramètres requis` (l.32-35). Garder les 4 tests `formatDeviceStatus`.

- [ ] **Step 7 : Vérifier la suite node + parité i18n**

Run: `cd designer && node --test`
Expected: PASS (plus de référence à device-panel.js ; device.test.js ne garde que `formatDeviceStatus`).

Run (depuis la racine du dépôt) — parité EN/FR :
```bash
node -e "import('./designer/i18n/en.js').then(m=>{const en=m.default;const fr=JSON.parse(require('fs').readFileSync('./designer/i18n/fr.json','utf8'));const ek=Object.keys(en),fk=Object.keys(fr);const a=ek.filter(k=>!fk.includes(k)),b=fk.filter(k=>!ek.includes(k));console.log('EN',ek.length,'FR',fk.length,'EN-only',a,'FR-only',b);})"
```
Expected: `EN-only []  FR-only []` (parité parfaite).

Vérifier qu'aucune clé `t('…')` / `data-i18n*` retirée n'est encore référencée :
```bash
grep -rn "drawer.device.title\|drawer.device.aria\|drawer.tab.outputs\|drawer.tab.sources\|device.rename_tip" designer/ --include="*.js" --include="*.html" | grep -v electron/dist
```
Expected: aucune sortie.

- [ ] **Step 8 : Vérif navigateur (parcours complet EN + FR)**

- Ouvrir le tiroir (bouton toolbar) → **un seul panneau « Sources »**, plus d'onglets, plus de « Sorties physiques ». Les Sources pull fonctionnent (ajout/édition).
- Vue Document de l'inspecteur → le lien ouvre désormais les Sources (libellé « Open sources → » / « Ouvrir les sources → »).
- Arbre : physiques toujours présents sous le Document, éditables dans l'inspecteur (régression-check Tasks 4-6).
- Basculer en FR (Réglages → reload) : tiroir « Sources », libellés FR, **0 clé brute**, **0 erreur console**. Idem EN.

- [ ] **Step 9 : Commit**

```bash
git add designer/js/app.js designer/js/drawer.js designer/index.html designer/i18n/en.js designer/i18n/fr.json designer/tests/device.test.js
git commit -m "feat(designer): supprime le panneau Device — tiroir « Sources » unique (+ i18n)"
```

---

## Vérification finale (après Task 7)

- [ ] `cd designer && node --test` → tout vert (442 d'origine + tests Tasks 1-3, moins le test createDevicePanel retiré).
- [ ] Parité EN/FR = 0 diff (commande Step 7).
- [ ] Parcours navigateur complet EN + FR : physiques sous Document (nom blanc / type grisé), édition inspecteur (led_ring : champs + mini-anneau + ▶ ; sound : note), renommage d'id (double-clic + menu contextuel), pas de drag/œil/suppression, pas de cadre canvas pour un physique, tiroir « Sources » sans onglets, 0 erreur console.
- [ ] `git status` propre ; relire le diff global (`git diff main...HEAD`) avant toute demande de push.

## Notes d'exécution

- **Garde-parité firmware/schéma** : aucune ; `src/`, `lib/`, `schema/`, `render.js` ne doivent pas apparaître dans le diff.
- **`led-ring-preview.js` et `mocks.js`** : conservés, réutilisés par l'inspecteur (ne pas supprimer).
- **`uploadfs`** : hors-scope (pas de flash device ici) ; si déploiement ultérieur, sauvegarder les assets device d'abord (cf. mémoire).
