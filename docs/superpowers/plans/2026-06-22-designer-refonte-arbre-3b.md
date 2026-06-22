# Arbre des calques — Phase 3b (affordances avancées) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Doter l'arbre des calques (`tree.js`, MVP livré en Phase 3a) des affordances avancées prévues par la spec §1 : drag & drop (z-order intra-page + déplacement entre pages), menu contextuel clic-droit, F2 = renommer, renommage inline de l'**id** d'un composant, duplication de page, et expansion multi-pages indépendante.

**Architecture :** 100 % designer (web + tests node). On ajoute **une** mutation pure (`duplicatePage`) et un helper de nom, on étend `resolveShortcut` (F2) et on ajoute une fonction pure `contextMenuItems`. Tout le reste est du DOM dans `tree.js` (vérifié navigateur, **pas** de test DOM — convention `CLAUDE.md` : `node --test` SANS DOM). On réutilise les mutations déjà testées (`reorderPlacement`, `movePlacementToPage`, `renameComponent`, `duplicateComponent`, `removePlacementAndOrphan`) et on extrait dans `app.js` les actions composant (copy/cut/paste/duplicate/delete) en un objet réutilisable par l'arbre.

**Tech Stack :** ES modules vanilla, `node --test` (Unity-like), HTML5 drag & drop natif. Pas de framework.

> **Statut d'exécution (2026-06-22) — ✅ EXÉCUTÉ** (subagent-driven, branche `feat/designer-refonte-ihm`, 11 commits, `node --test` 294/294, vérifs Playwright par lot). Écarts vs ce plan, issus des revues : Task 1 — `duplicatePage` préserve aussi `background`/`background_image` de la page (reconstruction par `structuredClone(src)`) ; Task 10 — `openMenu` clampe le menu dans le viewport **et** isole son `pointerdown` (le menu vit hors `#layers`, sinon le listener global « clic ailleurs → désélectionne » vidait la sélection avant le `click`) ; revue finale — fuite du listener Escape du menu corrigée, F2 ignore une sélection Document. Le décompte de tests annoncé tâche par tâche ci-dessous était indicatif (totaux réels : T1 +11 après revue, T2 +2, T3 +10, T8 +7 → 294).

**Invariants à NE PAS régresser** (cf. `CLAUDE.md` « invariants inspecteur/canvas » + Phase 3a) :
- Changer la sélection depuis l'arbre passe par le coordinateur `setSelection` d'`app.js` (garde **F1** : `blur()` du champ inspecteur focalisé avant de muter la sélection). L'arbre ne touche jamais `selection.set` directement.
- Le listener global `pointerdown` d'`app.js` exclut déjà `#layers` (ne pas le casser).
- Mono-sélection : forme `{kind:'doc'|'page'|'comp', page?, index?}` | null ; le `ref` se **dérive**, jamais stocké.
- **z-order inversé dans l'arbre** : `place[]` est rendu renversé (dernier placement = dessus = première ligne). « Monter » dans l'arbre = vers la **fin** de `place[]` ; « Descendre » = vers le **début**.

---

## File Structure

- `designer/js/mutations.js` — **+2** fonctions pures : `uniqueCopyName(state, base)`, `duplicatePage(state, pageIndex)`.
- `designer/tests/mutations.test.js` — **+tests** des deux ci-dessus.
- `designer/js/shortcuts.js` — `resolveShortcut` gère **F2 → `'rename'`**.
- `designer/tests/shortcuts.test.js` — **+tests** F2.
- `designer/js/tree.js` — **+** `contextMenuItems(sel, state, opts)` (pur, exporté pour test) **+** tout le DOM avancé (expansion multi-pages, rename inline id comp, `beginRename()`, dup page, drag & drop, menu contextuel).
- `designer/tests/tree.test.js` — **+tests** de `contextMenuItems`.
- `designer/js/app.js` — extrait les actions composant en objet `compActions` ; passe `compActions`, `getClipboard`, et garde le câblage F2 → `tree.beginRename()`.
- `designer/style.css` — CSS **structurelle** des nouveaux états (drag-over, drop-indicator, menu contextuel, rename id). Pas de DA.

---

## Task 1 : Mutation `duplicatePage` (+ helper de nom) — pur, testé

**Files:**
- Modify: `designer/js/mutations.js` (après `renamePage`/`reorderPages`, section Pages)
- Test: `designer/tests/mutations.test.js`

**Décisions figées :**
- La copie est insérée **juste après** la page source (`splice(pageIndex+1, 0, …)`).
- Chaque placement de la source devient une **copie indépendante** (modèle 1:1, cf. HANDOFF « modèle 1:1 ») : nouvel id via `uniqueId`, `compDef` cloné (`structuredClone`), placement cloné et re-pointé — **sans** offset dx/dy (copie fidèle sur une autre page, ≠ `placeComponentCopy` qui décale).
- Un placement dont le `ref` est orphelin (pas de `compDef`) est copié **tel quel** (ref inchangé) — pas de composant créé ; la validation signalera l'orphelin comme aujourd'hui.
- Nom de la copie : `uniqueCopyName` → `« <base> (copie) »`, puis `« <base> (copie 2) »`… (le nom de page est la cible de `POST /page` → unicité obligatoire, comme `uniquePageName`/`pageNameTaken`).

- [ ] **Step 1 : Écrire les tests (qui échouent)**

Ajouter à la fin de `designer/tests/mutations.test.js`. Importer `uniqueCopyName`, `duplicatePage` dans le bloc `import` en tête (à côté de `renameComponent`).

```javascript
test('uniqueCopyName : base libre → « X (copie) »', () => {
  const s = { pages: [{ name: 'Accueil', place: [] }] };
  assert.equal(uniqueCopyName(s, 'Accueil'), 'Accueil (copie)');
});

test('uniqueCopyName : « X (copie) » pris → « X (copie 2) »', () => {
  const s = { pages: [{ name: 'A', place: [] }, { name: 'A (copie)', place: [] }] };
  assert.equal(uniqueCopyName(s, 'A'), 'A (copie 2)');
});

test('duplicatePage : insère la copie juste après la source et renvoie son index', () => {
  const s = { pages: [{ name: 'P1', place: [] }, { name: 'P2', place: [] }], components: {} };
  const idx = duplicatePage(s, 0);
  assert.equal(idx, 1);
  assert.deepEqual(s.pages.map(p => p.name), ['P1', 'P1 (copie)', 'P2']);
});

test('duplicatePage : composants copiés en ids indépendants (modèle 1:1)', () => {
  const s = {
    pages: [{ name: 'P1', place: [{ ref: 'lbl1', dx: 10, dy: 20 }] }],
    components: { lbl1: { type: 'label', text: 'Salut' } },
  };
  const idx = duplicatePage(s, 0);
  const copyPlace = s.pages[idx].place[0];
  // nouvel id, distinct de l'original
  assert.notEqual(copyPlace.ref, 'lbl1');
  assert.ok(s.components[copyPlace.ref], 'le composant copié existe');
  // placement cloné FIDÈLE (pas d'offset)
  assert.equal(copyPlace.dx, 10);
  assert.equal(copyPlace.dy, 20);
  // indépendance : éditer la copie ne touche pas l'original
  s.components[copyPlace.ref].text = 'Modifié';
  assert.equal(s.components.lbl1.text, 'Salut');
});

test('duplicatePage : la map components d’origine est intacte', () => {
  const s = {
    pages: [{ name: 'P1', place: [{ ref: 'lbl1' }] }],
    components: { lbl1: { type: 'label', text: 'X' } },
  };
  duplicatePage(s, 0);
  assert.ok(s.components.lbl1, 'l’original reste');
});

test('duplicatePage : page sans place → copie vide, pas de throw', () => {
  const s = { pages: [{ name: 'P1' }], components: {} };
  const idx = duplicatePage(s, 0);
  assert.deepEqual(s.pages[idx].place, []);
});

test('duplicatePage : ref orphelin copié tel quel (aucun composant créé)', () => {
  const s = { pages: [{ name: 'P1', place: [{ ref: 'fantome' }] }], components: {} };
  const idx = duplicatePage(s, 0);
  assert.equal(s.pages[idx].place[0].ref, 'fantome');
  assert.equal(Object.keys(s.components).length, 0);
});

test('duplicatePage : index hors borne → no-op (renvoie -1)', () => {
  const s = { pages: [{ name: 'P1', place: [] }], components: {} };
  assert.equal(duplicatePage(s, 5), -1);
  assert.equal(s.pages.length, 1);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `cd designer && node --test 2>&1 | grep -E "fail|not ok" | head`
Expected: échecs « uniqueCopyName is not a function » / « duplicatePage is not a function ».

- [ ] **Step 3 : Implémenter les deux fonctions**

Dans `designer/js/mutations.js`, après `reorderPages` (≈ ligne 180), ajouter :

```javascript
// Nom unique pour une page dupliquée : « <base> (copie) », puis « (copie 2) »… 1er libre. Le nom de
// page est la cible de POST /page → unicité obligatoire (cf. uniquePageName / pageNameTaken).
export function uniqueCopyName(state, base) {
  const used = new Set((state.pages || []).map(p => p.name));
  let name = `${base} (copie)`;
  let n = 2;
  while (used.has(name)) name = `${base} (copie ${n++})`;
  return name;
}

// Duplique une page JUSTE APRÈS la source. Chaque placement devient une copie INDÉPENDANTE (modèle 1:1) :
// nouvel id (uniqueId), compDef cloné, placement cloné re-pointé — SANS offset (copie fidèle, ≠
// placeComponentCopy). Un ref orphelin est copié tel quel (pas de composant créé). Renvoie l'index de la
// nouvelle page, ou -1 si la source est absente.
export function duplicatePage(state, pageIndex) {
  const src = state.pages?.[pageIndex];
  if (!src) return -1;
  const newPage = { name: uniqueCopyName(state, src.name || `Page ${pageIndex + 1}`), place: [] };
  for (const pl of src.place || []) {
    const compDef = state.components?.[pl.ref];
    if (compDef) {
      const id = uniqueId(state, compDef.type);
      addComponent(state, id, structuredClone(compDef));
      newPage.place.push({ ...structuredClone(pl), ref: id });
    } else {
      newPage.place.push(structuredClone(pl));   // orphelin : copié tel quel
    }
  }
  state.pages.splice(pageIndex + 1, 0, newPage);
  return pageIndex + 1;
}
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

Run: `cd designer && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `fail 0`, total = 264 + 8 = **272**.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/mutations.js designer/tests/mutations.test.js
git commit -m "designer: arbre — mutation duplicatePage (copies 1:1) + uniqueCopyName"
```

---

## Task 2 : F2 → `'rename'` dans `resolveShortcut` — pur, testé

**Files:**
- Modify: `designer/js/shortcuts.js`
- Test: `designer/tests/shortcuts.test.js`

**Décision :** F2 (sans contrainte de modificateur ; F2 n'a pas de variante utile) → `'rename'`, sauf focus éditable (comme tous les raccourcis). Le type de retour s'élargit à `… | 'rename'`.

- [ ] **Step 1 : Écrire les tests (qui échouent)**

Ajouter à `designer/tests/shortcuts.test.js` :

```javascript
test('resolveShortcut : F2 (hors champ) → rename', () => {
  assert.equal(resolveShortcut({ key: 'F2', editable: false }), 'rename');
});

test('resolveShortcut : F2 dans un champ éditable → null (rename natif éventuel laissé)', () => {
  assert.equal(resolveShortcut({ key: 'F2', editable: true }), null);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd designer && node --test 2>&1 | grep -E "F2"`
Expected: le 1er test échoue (`rename` ≠ `null`).

- [ ] **Step 3 : Implémenter**

Dans `designer/js/shortcuts.js`, ajouter la ligne F2 avant le `if (!mod && ev.key === 'Escape')` (et mettre à jour le commentaire du type de retour en tête de fonction) :

```javascript
  if (!mod && ev.key === 'F2') return 'rename';
```

Mettre à jour le JSDoc de retour : `… | 'delete' | 'deselect' | 'rename' | null.`

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `cd designer && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `fail 0`, total **274**.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/shortcuts.js designer/tests/shortcuts.test.js
git commit -m "designer: shortcuts — F2 = rename (logique pure testée)"
```

---

## Task 3 : `contextMenuItems` — modèle pur du menu contextuel, testé

**Files:**
- Modify: `designer/js/tree.js` (exporter la fonction pure en tête, à côté de `treeModel`)
- Test: `designer/tests/tree.test.js`

**Décision — forme de retour.** Une liste d'items ; chaque item = `{ id, label, disabled? , submenu? }`. `submenu` (utilisé seulement par `moveToPage`) = liste de `{ id:'moveTo', label:<nom page>, page:<index> }`. `sel` doc ou null → `[]` (pas de menu).

**Actions par type** (cf. spec §1) :
- **comp** : `rename`, `duplicate`, `copy`, `cut`, `paste` (disabled si `!hasClipboard`), `delete`, `raiseZ` (disabled si déjà au sommet = dernier dans `place[]`), `lowerZ` (disabled si au fond = index 0), `moveToPage` (submenu des AUTRES pages ; absent s'il n'y a qu'une page).
- **page** : `rename`, `duplicate`, `delete` (disabled si une seule page), `moveUp` (disabled si index 0), `moveDown` (disabled si dernière page).

- [ ] **Step 1 : Écrire les tests (qui échouent)**

Ajouter à `designer/tests/tree.test.js` (importer `contextMenuItems` à côté de `treeModel`) :

```javascript
const stateFix = () => ({
  pages: [
    { name: 'P1', place: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }] },  // z: a(fond,0) .. c(sommet,2)
    { name: 'P2', place: [] },
  ],
  components: { a: { type: 'label' }, b: { type: 'label' }, c: { type: 'label' } },
});

test('contextMenuItems : doc → vide', () => {
  assert.deepEqual(contextMenuItems({ kind: 'doc' }, stateFix(), {}), []);
});

test('contextMenuItems : null → vide', () => {
  assert.deepEqual(contextMenuItems(null, stateFix(), {}), []);
});

test('contextMenuItems : comp au milieu → toutes les actions, raiseZ/lowerZ actifs', () => {
  const items = contextMenuItems({ kind: 'comp', page: 0, index: 1 }, stateFix(), { hasClipboard: true });
  const ids = items.map(i => i.id);
  for (const id of ['rename', 'duplicate', 'copy', 'cut', 'paste', 'delete', 'raiseZ', 'lowerZ', 'moveToPage'])
    assert.ok(ids.includes(id), `manque ${id}`);
  assert.equal(items.find(i => i.id === 'raiseZ').disabled, false);
  assert.equal(items.find(i => i.id === 'lowerZ').disabled, false);
  assert.equal(items.find(i => i.id === 'paste').disabled, false);
});

test('contextMenuItems : comp au sommet z (dernier place) → raiseZ désactivé', () => {
  const items = contextMenuItems({ kind: 'comp', page: 0, index: 2 }, stateFix(), {});
  assert.equal(items.find(i => i.id === 'raiseZ').disabled, true);
  assert.equal(items.find(i => i.id === 'lowerZ').disabled, false);
});

test('contextMenuItems : comp au fond z (index 0) → lowerZ désactivé', () => {
  const items = contextMenuItems({ kind: 'comp', page: 0, index: 0 }, stateFix(), {});
  assert.equal(items.find(i => i.id === 'lowerZ').disabled, true);
});

test('contextMenuItems : paste désactivé sans presse-papier', () => {
  const items = contextMenuItems({ kind: 'comp', page: 0, index: 0 }, stateFix(), { hasClipboard: false });
  assert.equal(items.find(i => i.id === 'paste').disabled, true);
});

test('contextMenuItems : moveToPage liste les AUTRES pages', () => {
  const items = contextMenuItems({ kind: 'comp', page: 0, index: 0 }, stateFix(), {});
  const sub = items.find(i => i.id === 'moveToPage').submenu;
  assert.deepEqual(sub.map(s => s.page), [1]);     // pas la page 0 (la sienne)
  assert.equal(sub[0].label, 'P2');
});

test('contextMenuItems : comp dans un layout à une seule page → pas de moveToPage', () => {
  const s = { pages: [{ name: 'P1', place: [{ ref: 'a' }] }], components: { a: { type: 'label' } } };
  const items = contextMenuItems({ kind: 'comp', page: 0, index: 0 }, s, {});
  assert.equal(items.find(i => i.id === 'moveToPage'), undefined);
});

test('contextMenuItems : page au milieu → moveUp/moveDown actifs, delete actif', () => {
  const s = { pages: [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }], components: {} };
  const items = contextMenuItems({ kind: 'page', page: 1 }, s, {});
  assert.equal(items.find(i => i.id === 'moveUp').disabled, false);
  assert.equal(items.find(i => i.id === 'moveDown').disabled, false);
  assert.equal(items.find(i => i.id === 'delete').disabled, false);
});

test('contextMenuItems : page unique → delete désactivé', () => {
  const s = { pages: [{ name: 'P1' }], components: {} };
  const items = contextMenuItems({ kind: 'page', page: 0 }, s, {});
  assert.equal(items.find(i => i.id === 'delete').disabled, true);
  assert.equal(items.find(i => i.id === 'moveUp').disabled, true);
  assert.equal(items.find(i => i.id === 'moveDown').disabled, true);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd designer && node --test 2>&1 | grep -E "contextMenuItems" | head`
Expected: échecs « contextMenuItems is not a function ».

- [ ] **Step 3 : Implémenter la fonction pure**

Dans `designer/js/tree.js`, après `treeModel` (≈ ligne 37), ajouter :

```javascript
// Modèle PUR du menu contextuel (testé node ; le rendu DOM + dispatch est ailleurs, vérifié navigateur).
// Items : { id, label, disabled?, submenu? }. doc/null → [] (pas de menu). z-order : raiseZ = vers la FIN de
// place[] (dessus), lowerZ = vers le DÉBUT (fond). moveToPage.submenu = { id:'moveTo', label, page } des AUTRES
// pages (absent si une seule page).
export function contextMenuItems(sel, state, { hasClipboard = false } = {}) {
  if (!sel || sel.kind === 'doc') return [];
  const pages = state?.pages || [];
  if (sel.kind === 'page') {
    return [
      { id: 'rename', label: 'Renommer' },
      { id: 'duplicate', label: 'Dupliquer la page' },
      { id: 'delete', label: 'Supprimer la page', disabled: pages.length <= 1 },
      { id: 'moveUp', label: 'Monter', disabled: sel.page <= 0 },
      { id: 'moveDown', label: 'Descendre', disabled: sel.page >= pages.length - 1 },
    ];
  }
  // comp
  const place = pages[sel.page]?.place || [];
  const items = [
    { id: 'rename', label: 'Renommer (id)' },
    { id: 'duplicate', label: 'Dupliquer' },
    { id: 'copy', label: 'Copier' },
    { id: 'cut', label: 'Couper' },
    { id: 'paste', label: 'Coller', disabled: !hasClipboard },
    { id: 'delete', label: 'Supprimer' },
    { id: 'raiseZ', label: 'Monter (avant-plan)', disabled: sel.index >= place.length - 1 },
    { id: 'lowerZ', label: 'Descendre (arrière-plan)', disabled: sel.index <= 0 },
  ];
  if (pages.length > 1) {
    const submenu = pages
      .map((p, i) => ({ id: 'moveTo', label: p.name || `Page ${i + 1}`, page: i }))
      .filter(s => s.page !== sel.page);
    items.push({ id: 'moveToPage', label: 'Déplacer vers…', submenu });
  }
  return items;
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `cd designer && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `fail 0`, total **285**.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/tree.js designer/tests/tree.test.js
git commit -m "designer: arbre — contextMenuItems (modèle pur du menu contextuel)"
```

---

## Task 4 : Expansion multi-pages indépendante (DOM, vérif navigateur)

**Files:**
- Modify: `designer/js/tree.js` (`createTree`)
- Modify: `designer/style.css` (curseur du triangle)

**Décision :** un `Set` d'index `expanded` dans `createTree`. Une page est dépliée ssi `expanded.has(p.index)`. La page **active** est ajoutée à `expanded` à chaque `setPage` (auto-déplie la page sur laquelle on travaille). Le **triangle** d'une ligne page toggle l'appartenance (on peut donc replier aussi l'active). Au changement de modèle, **clamp défensif** : on retire les index hors borne (`expanded = expanded ∩ [0..n-1]`) pour éviter les pages fantômes. *Compromis documenté* : l'expansion est stockée par **index** ; un reorder de pages peut décaler quelle page est dépliée (cosmétique, l'utilisateur re-toggle) — pas de réindexation fine (YAGNI pour un outil perso).

- [ ] **Step 1 : Introduire l'état `expanded` + wrapper `setPage`**

En tête de `createTree`, à côté de `let renaming = null;` :

```javascript
  const expanded = new Set([getActivePage()]);   // pages dépliées (page active auto-dépliée)
  // setPage du host (canvas) + auto-dépliage de la page qui devient active.
  const goPage = (i) => { expanded.add(i); setPage(i); };
```

Remplacer **tous** les appels `setPage(…)` à l'intérieur de `createTree` par `goPage(…)` (dans `pageRow.click`, `mkAct('↑'/'↓'/'✕')`, `compRow.click`, l'`addBtn`). Le `setPage` brut reste réservé au backstop `clampActive`.

- [ ] **Step 2 : Clamp défensif de `expanded` dans `clampActive`**

Dans `clampActive()`, après le clamp de l'index actif, ajouter :

```javascript
    for (const i of [...expanded]) if (i >= n) expanded.delete(i);
    expanded.add(getActivePage());   // l'active reste toujours dépliée
```

- [ ] **Step 3 : Triangle cliquable + rendu selon `expanded`**

Dans `pageRow`, rendre le triangle cliquable (toggle) **sans** sélectionner la page (stopPropagation). Remplacer la création de `tw` par :

```javascript
    const tw = document.createElement('span'); tw.className = 'tree-twist';
    const isOpen = expanded.has(p.index);
    tw.textContent = isOpen ? '▾' : '▸';
    tw.title = isOpen ? 'Replier' : 'Déplier';
    tw.addEventListener('click', e => {
      e.stopPropagation();
      if (expanded.has(p.index)) expanded.delete(p.index); else expanded.add(p.index);
      render();
    });
```

Et le paramètre `active` de `pageRow` n'est plus le critère de pliage. Dans `render()`, remplacer :

```javascript
    t.pages.forEach(p => {
      tree.appendChild(pageRow(p, p.index === active, sel));
      if (p.index === active) p.components.forEach(c => tree.appendChild(compRow(c, p.index, sel)));
    });
```

par :

```javascript
    t.pages.forEach(p => {
      tree.appendChild(pageRow(p, sel));
      if (expanded.has(p.index)) p.components.forEach(c => tree.appendChild(compRow(c, p.index, sel)));
    });
```

Adapter la signature `pageRow(p, sel)` (retirer le paramètre `active` ; le surlignage « selected » reste piloté par `sel`). Le triangle lit `expanded.has(p.index)` lui-même.

- [ ] **Step 4 : CSS — le triangle est cliquable**

Dans `designer/style.css`, ajouter (près des `.tree-*`) :

```css
.tree-twist { cursor: pointer; user-select: none; width: 1em; display: inline-block; text-align: center; }
.tree-doc .tree-twist { cursor: default; }   /* ⚙ Document : pas de pliage */
```

- [ ] **Step 5 : Régression node + vérif navigateur**

Run: `cd designer && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `fail 0`, total **285** (inchangé — pas de test DOM).

Vérif navigateur (serveur **no-store**, cf. memory `designer-verif-navigateur` ; piloter avec de **vrais events pointer**) :
```bash
cd /Users/jean-paulgavini/Documents/Dev/Dialboard
python3 -c "import http.server,functools; http.server.test(HandlerClass=functools.partial(http.server.SimpleHTTPRequestHandler), port=8781)" &
# ouvrir http://127.0.0.1:8781/designer/ (NE PAS utiliser le port 8000 — réservé utilisateur)
```
Cocher : (a) déplier une page non active → ses composants s'affichent sans changer la page active ; (b) replier ; (c) changer de page active → la nouvelle se déplie auto, les autres expansions restent ; (d) supprimer une page dépliée → pas de fantôme. **Arrêter le serveur** après.

- [ ] **Step 6 : Commit**

```bash
git add designer/js/tree.js designer/style.css
git commit -m "designer: arbre — expansion multi-pages indépendante (Set expanded + triangle cliquable)"
```

---

## Task 5 : Renommage inline de l'**id** d'un composant (DOM, vérif navigateur)

**Files:**
- Modify: `designer/js/tree.js`
- Modify: `designer/style.css`

**Décision :** réutiliser le moule du rename inline des pages, mais sur la ligne **composant**, via `renameComponent` (garde d'unicité = collision avec un id existant → toast + reste en édition, comme le rename de page). Déclencheurs : **double-clic** sur la ligne comp, **F2** (Task 6), **menu contextuel** (Task 10). La sélection reste valide après rename (l'index `place[]` ne bouge pas ; seul le `ref` change, dérivé).

- [ ] **Step 1 : État + helper de rename comp**

En tête de `createTree`, ajouter à côté de `renaming` (qui sert aux pages) un état dédié comp :

```javascript
  let renamingComp = null;   // { page, index } du composant en rename inline, ou null
```

Importer `renameComponent` depuis `./mutations.js` (ajouter à l'import existant).

- [ ] **Step 2 : Mode rename dans `compRow`**

Au tout début de `compRow(c, pageIndex, sel)`, avant la création normale de la ligne, insérer le mode édition :

```javascript
    if (renamingComp && renamingComp.page === pageIndex && renamingComp.index === c.index) {
      const row = document.createElement('div'); row.className = 'tree-row tree-comp';
      const inp = document.createElement('input'); inp.className = 'tree-rename'; inp.value = c.ref;
      const orig = c.ref;
      const tryCommit = () => {
        const id = inp.value.trim();
        if (!id || id === orig) { renamingComp = null; render(); return true; }   // vide/identique → annule
        if (model.state.components?.[id]) { showToast(`L’id « ${id} » est déjà pris`); return false; }
        renamingComp = null;
        model.commit(s => renameComponent(s, orig, id));   // → subscribe → render()
        return true;
      };
      inp.addEventListener('input', () => {
        const v = inp.value.trim();
        inp.classList.toggle('invalid', !!v && v !== orig && !!model.state.components?.[v]);
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); tryCommit(); }
        else if (e.key === 'Escape') { e.preventDefault(); renamingComp = null; render(); }
      });
      inp.addEventListener('blur', () => { if (renamingComp && !tryCommit()) { renamingComp = null; render(); } });
      row.appendChild(inp);
      queueMicrotask(() => { inp.focus(); inp.select(); });
      return row;
    }
```

- [ ] **Step 3 : Double-clic pour lancer le rename**

Dans `compRow`, sur la ligne normale (après le `row.addEventListener('click', …)`), ajouter :

```javascript
    row.addEventListener('dblclick', e => {
      e.preventDefault();
      if (pageIndex !== getActivePage()) goPage(pageIndex);
      setSelection({ kind: 'comp', page: pageIndex, index: c.index });
      renamingComp = { page: pageIndex, index: c.index };
      render();
    });
```

- [ ] **Step 4 : Régression node + vérif navigateur**

Run: `cd designer && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `fail 0`, total **285**.

Vérif navigateur : double-clic sur une ligne comp → champ d'édition de l'id ; saisir un id libre + Entrée → renommé (le `tree-ref` et l'en-tête inspecteur `type · id` reflètent le nouvel id) ; saisir un id **déjà pris** → toast + reste en édition ; Échap → annule. Vérifier qu'après rename la **sélection survit** (inspecteur toujours sur le composant).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/tree.js
git commit -m "designer: arbre — renommage inline de l'id composant (renameComponent, garde collision)"
```

---

## Task 6 : F2 câblé — `tree.beginRename()` + dispatch dans `app.js` (DOM, vérif navigateur)

**Files:**
- Modify: `designer/js/tree.js` (exposer `beginRename`)
- Modify: `designer/js/app.js` (dispatch `'rename'`)

**Décision :** `tree.beginRename()` lit la sélection courante et lance le bon rename inline : `page` → rename inline page (réutilise `renaming`), `comp` → rename inline id (réutilise `renamingComp`), `doc`/null → no-op. `app.js` mappe l'action `'rename'` (Task 2) vers `tree.beginRename()`.

- [ ] **Step 1 : Exposer `beginRename` dans `createTree`**

Avant le `return { render };` final de `createTree`, définir et exporter la méthode :

```javascript
  function beginRename() {
    const sel = selection.get();
    if (!sel) return;
    if (sel.kind === 'page') { goPage(sel.page); renaming = sel.page; render(); }
    else if (sel.kind === 'comp') {
      if (sel.page !== getActivePage()) goPage(sel.page);
      renamingComp = { page: sel.page, index: sel.index };
      render();
    }
  }
```

Changer le retour : `return { render, beginRename };`

- [ ] **Step 2 : Dispatch `'rename'` dans `app.js`**

Dans le handler `keydown` d'`app.js`, après le bloc `if (action === 'redo') …` (et avant `deselect`), ajouter :

```javascript
    if (action === 'rename') {
      if (selection.get() == null) return;
      e.preventDefault();
      tree.beginRename();
      return;
    }
```

(`tree` est déjà dans le scope — `const tree = createTree(…)`.)

- [ ] **Step 3 : Régression node + vérif navigateur**

Run: `cd designer && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `fail 0`, total **285**.

Vérif navigateur : sélectionner une page (clic ligne) → **F2** → rename inline page ; sélectionner un composant (clic canvas OU ligne arbre) → **F2** → rename inline id ; F2 sur Document/rien → aucun effet ; F2 pendant qu'un champ inspecteur a le focus → comportement natif (pas de rename arbre).

- [ ] **Step 4 : Commit**

```bash
git add designer/js/tree.js designer/js/app.js
git commit -m "designer: arbre — F2 déclenche le renommage de la sélection (page/id comp)"
```

---

## Task 7 : Duplication de page depuis l'arbre (DOM, vérif navigateur)

**Files:**
- Modify: `designer/js/tree.js`

**Décision :** ajouter un bouton `⧉` aux contrôles de survol de la ligne page (à côté de `✎ ↑ ↓ ✕`), appelant `duplicatePage` (Task 1) ; après la dup, on bascule sur la nouvelle page et on la sélectionne (cohérent avec `addBtn`).

- [ ] **Step 1 : Importer `duplicatePage`**

Ajouter `duplicatePage` à l'import depuis `./mutations.js` en tête de `tree.js`.

- [ ] **Step 2 : Bouton `⧉` dans `pageRow`**

Dans `pageRow`, après `mkAct('✎', …)` et avant `mkAct('↑', …)`, ajouter :

```javascript
    mkAct('⧉', 'Dupliquer la page', () => {
      let ni = -1;
      model.commit(s => { ni = duplicatePage(s, p.index); });
      if (ni >= 0) { goPage(ni); setSelection({ kind: 'page', page: ni }); }
      render();
    });
```

- [ ] **Step 3 : Régression node + vérif navigateur**

Run: `cd designer && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `fail 0`, total **285**.

Vérif navigateur : survoler une page avec ≥1 composant → `⧉` → une nouvelle page « <nom> (copie) » apparaît **juste après**, devient active+sélectionnée ; ses composants sont des **copies indépendantes** (éditer une copie ne change pas l'original — vérifier via l'inspecteur sur les deux pages) ; undo annule la dup en un coup.

- [ ] **Step 4 : Commit**

```bash
git add designer/js/tree.js
git commit -m "designer: arbre — duplication de page (bouton ⧉, copies 1:1)"
```

---

## Task 8 : Drag & drop des composants — reorder z-order + déplacement entre pages (DOM, vérif navigateur)

**Files:**
- Modify: `designer/js/tree.js`
- Modify: `designer/style.css`

**Décisions figées :**
- HTML5 drag natif (`draggable=true` sur les `compRow`). On stocke la source `{page, index}` dans une variable de closure `dragSrc` (le `dataTransfer` ne survit pas proprement aux échanges intra-app ; une closure est plus fiable et reste locale au module).
- **dragstart sélectionne** la source (mono-sélection : l'élément manipulé devient le sélectionné). Après la mutation, on resélectionne sa **position cible connue** → « la sélection suit l'élément » sans helper de réindexation (cf. note d'architecture du plan).
- **Drop sur une ligne comp de la même page** = reorder z. L'index d'insertion dans `place[]` se calcule depuis la position verticale du curseur vs le milieu de la ligne cible, **en tenant compte de l'inversion** (l'arbre affiche `place[]` renversé). Formule : un drop « au-dessus visuellement » de la ligne d'index display `d` (ref `place[len-1-d]`) vise un z **plus haut**.
- **Drop sur une ligne page (autre page)** = `movePlacementToPage` vers cette page (placement poussé en fin = sommet z), puis `goPage(toPage)` + resélection du dernier index.
- Drop sur la **même** page via une ligne page = no-op (le reorder se fait entre lignes comp).

**Calcul d'index de reorder (intra-page).** Soit `place` la liste réelle ; l'arbre affiche `display = reverse(place)`. Sur un drop relatif à la ligne comp cible d'index réel `tIdx`, « before » (curseur dans la moitié haute) vise le z juste **au-dessus** de la cible. Pour éviter les erreurs de ±1, on calcule l'ordre **display** désiré puis on le retraduit en `place[]` :

```javascript
// from, to = index RÉELS dans place[]. before = curseur dans la moitié haute de la ligne cible.
function reorderTargetIndex(place, fromReal, toReal, before) {
  const n = place.length;
  // index en coordonnées DISPLAY (z-order inversé)
  const dFrom = n - 1 - fromReal;
  let dTo = n - 1 - toReal + (before ? 0 : 1);   // insérer avant/après la cible en display
  if (dTo > dFrom) dTo -= 1;                      // compense le retrait de la source avant réinsertion
  const realTo = n - 1 - dTo;                     // retour en coordonnées place[]
  return Math.max(0, Math.min(n - 1, realTo));
}
```

> Cette fonction est délicate (inversion + compensation du splice). Elle peut être extraite et testée en node si la vérif navigateur révèle des décalages ; pour l'instant on la garde inline et on **valide les 4 cas au navigateur** (déposer en haut, au milieu, en bas, sur soi-même).

- [ ] **Step 1 : Marquer les lignes comp draggables + dragstart**

Dans `compRow` (ligne normale), après le `dblclick` listener :

```javascript
    row.draggable = true;
    row.addEventListener('dragstart', e => {
      if (pageIndex !== getActivePage()) goPage(pageIndex);
      setSelection({ kind: 'comp', page: pageIndex, index: c.index });
      dragSrc = { page: pageIndex, index: c.index };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', c.ref);   // requis par certains navigateurs pour armer le drag
      render();
    });
    row.addEventListener('dragend', () => { dragSrc = null; clearDropMarks(); render(); });
```

Déclarer en tête de `createTree` : `let dragSrc = null;`

- [ ] **Step 2 : dragover/drop sur les lignes comp (reorder intra-page)**

Toujours dans `compRow` (ligne normale) :

```javascript
    row.addEventListener('dragover', e => {
      if (!dragSrc || dragSrc.page !== pageIndex) return;   // reorder seulement dans la même page
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const before = (e.clientY - r.top) < r.height / 2;
      clearDropMarks();
      row.classList.add(before ? 'drop-before' : 'drop-after');
    });
    row.addEventListener('drop', e => {
      if (!dragSrc || dragSrc.page !== pageIndex) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const before = (e.clientY - r.top) < r.height / 2;
      const from = dragSrc.index;
      const place = model.state.pages[pageIndex].place;
      const to = reorderTargetIndex(place, from, c.index, before);
      clearDropMarks();
      if (to !== from) {
        model.commit(s => reorderPlacement(s, pageIndex, from, to));
        setSelection({ kind: 'comp', page: pageIndex, index: to });   // la sélection suit
      }
      dragSrc = null;
    });
```

Importer `reorderPlacement`, `movePlacementToPage` depuis `./mutations.js`.

- [ ] **Step 3 : dragover/drop sur les lignes page (move entre pages)**

Dans `pageRow` (ligne normale), ajouter :

```javascript
    row.addEventListener('dragover', e => {
      if (!dragSrc || dragSrc.page === p.index) return;   // move seulement vers une AUTRE page
      e.preventDefault();
      clearDropMarks();
      row.classList.add('drop-into');
    });
    row.addEventListener('drop', e => {
      if (!dragSrc || dragSrc.page === p.index) return;
      e.preventDefault();
      clearDropMarks();
      const fromPage = dragSrc.page, placeIndex = dragSrc.index, toPage = p.index;
      model.commit(s => movePlacementToPage(s, fromPage, placeIndex, toPage));
      const last = (model.state.pages[toPage].place?.length || 1) - 1;
      goPage(toPage);
      setSelection({ kind: 'comp', page: toPage, index: last });       // suit l'élément sur sa nouvelle page
      dragSrc = null;
    });
```

- [ ] **Step 4 : helper `clearDropMarks` + CSS des marqueurs**

En tête de `createTree`, ajouter :

```javascript
  const clearDropMarks = () => root.querySelectorAll('.drop-before,.drop-after,.drop-into')
    .forEach(n => n.classList.remove('drop-before', 'drop-after', 'drop-into'));
```

Dans `designer/style.css`, ajouter (CSS structurelle, pas de DA) :

```css
.tree-row.drop-before { box-shadow: inset 0 2px 0 0 var(--accent); }
.tree-row.drop-after  { box-shadow: inset 0 -2px 0 0 var(--accent); }
.tree-row.drop-into   { box-shadow: inset 0 0 0 2px var(--accent); }
.tree-row[draggable="true"] { cursor: grab; }
```

- [ ] **Step 5 : Régression node + vérif navigateur (le cœur de la tâche)**

Run: `cd designer && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `fail 0`, total **285**.

Vérif navigateur (page avec ≥3 composants) :
- **Reorder** : glisser une ligne comp au-dessus/en-dessous d'une autre → l'ordre z change (vérifier sur le **canvas** : un widget passe devant/derrière) ; la sélection suit l'élément déplacé ; marqueur `drop-before/after` visible pendant le survol.
- **4 cas** du calcul d'index : déposer tout en haut, au milieu, tout en bas, sur soi-même (no-op). Si décalage → extraire `reorderTargetIndex` en node et tester (cf. note Step 0).
- **Move entre pages** : avoir ≥2 pages, déplier la cible ou non ; glisser un comp sur une **ligne page** → il quitte sa page, apparaît sur la cible (sommet z), la page cible devient active et l'élément reste sélectionné ; l'original a disparu de la source.
- **Undo** : annule reorder/move en un coup.
- Vérifier que le drag dans `#layers` ne déclenche **pas** la désélection globale (listener `pointerdown` d'app.js exclut `#layers`).

- [ ] **Step 6 : Commit**

```bash
git add designer/js/tree.js designer/style.css
git commit -m "designer: arbre — drag & drop composants (reorder z + déplacement entre pages, la sélection suit)"
```

---

## Task 9 : Drag & drop des pages — réordonner (DOM, vérif navigateur)

**Files:**
- Modify: `designer/js/tree.js`

**Décision :** réutiliser `reorderPages` (déjà testé). La cible de drop d'une page est une **autre ligne page** ; on distingue le drag d'un **comp** (Task 8, vise le déplacement entre pages) du drag d'une **page** via le type de `dragSrc` (on ajoute `dragSrcPage`). Avant/après selon la moitié de la ligne. Après reorder, on suit la page (`goPage` + sélection page à sa nouvelle position).

- [ ] **Step 1 : dragstart sur la ligne page**

Dans `pageRow` (ligne normale), ajouter le drag de page (séparé du drop-into des comps) :

```javascript
    row.draggable = true;
    row.addEventListener('dragstart', e => {
      dragSrcPage = p.index;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `page:${p.index}`);
      e.stopPropagation();
    });
    row.addEventListener('dragend', () => { dragSrcPage = null; clearDropMarks(); render(); });
```

Déclarer en tête : `let dragSrcPage = null;`

- [ ] **Step 2 : dragover/drop de page (étendre les handlers de `pageRow`)**

Compléter le `dragover`/`drop` de `pageRow` pour gérer **aussi** le cas page (en plus du `drop-into` des comps de Task 8) :

```javascript
    row.addEventListener('dragover', e => {
      if (dragSrcPage != null && dragSrcPage !== p.index) {   // réordonner des pages
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        clearDropMarks();
        row.classList.add(before ? 'drop-before' : 'drop-after');
      }
    });
    row.addEventListener('drop', e => {
      if (dragSrcPage == null || dragSrcPage === p.index) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const before = (e.clientY - r.top) < r.height / 2;
      let to = p.index + (before ? 0 : 1);
      if (to > dragSrcPage) to -= 1;                           // compense le retrait de la source
      const from = dragSrcPage;
      clearDropMarks();
      if (to !== from) {
        model.commit(s => reorderPages(s, from, to));
        goPage(to);
        setSelection({ kind: 'page', page: to });
      }
      dragSrcPage = null;
    });
```

> Conserver les `dragover`/`drop` du Step 3 de Task 8 (drop-into d'un comp). Les deux jeux de handlers coexistent : ils se distinguent par `dragSrc` (comp) vs `dragSrcPage` (page), mutuellement exclusifs (un seul est non-null par geste).

`reorderPages` est déjà importé (Phase 3a).

- [ ] **Step 3 : Régression node + vérif navigateur**

Run: `cd designer && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `fail 0`, total **285**.

Vérif navigateur (≥3 pages) : glisser une page au-dessus/en-dessous d'une autre → l'ordre de navigation change (vérifier l'ordre des onglets/lignes) ; la page suivie reste active+sélectionnée à sa nouvelle position ; les boutons ↑↓ existants donnent le même résultat ; undo annule en un coup. Vérifier qu'un drag de **comp** sur une page fait toujours un **move** (Task 8), pas un reorder de page.

- [ ] **Step 4 : Commit**

```bash
git add designer/js/tree.js
git commit -m "designer: arbre — drag & drop des pages (reorder ordre de navigation)"
```

---

## Task 10 : Menu contextuel clic-droit (DOM, vérif navigateur)

**Files:**
- Modify: `designer/js/app.js` (extraire `compActions` + passer `compActions`/`getClipboard` à `createTree`)
- Modify: `designer/js/tree.js` (rendu + dispatch du menu, via `contextMenuItems`)
- Modify: `designer/style.css` (style du menu)

**Décision d'architecture :** les actions composant (copy/cut/paste/duplicate/delete/move) existent déjà dans `app.js` (closure keydown) mais opèrent sur `canvas.getSelected()`/`getActivePage()`. Le menu de l'arbre **sélectionne d'abord** la ligne cliquée-droit (bascule page si besoin), donc ces mêmes actions opèrent sur la bonne cible. On **extrait** ces actions en un objet `compActions` réutilisable, on expose `getClipboard()` (pour `hasClipboard`), et `tree.js` les appelle. Les actions z (`raiseZ`/`lowerZ`), `moveTo`, `rename`, `duplicate` (page/comp), `delete` (page) sont gérées dans `tree.js` (mutations déjà importées).

- [ ] **Step 1 : Extraire `compActions` dans `app.js`**

Refactoriser le bloc keydown : sortir la logique copy/paste/duplicate/delete en fonctions nommées dans le scope de `boot()`, **sans changer le comportement** des raccourcis (qui les appellent). Ajouter `cut` (= copy puis delete). Exemple de forme (adapter aux closures existantes `clipboard`, `canvas`, `model`) :

```javascript
  const compActions = {
    copy() {
      const sel = canvas.getSelected();
      if (sel == null) return;
      const pl = model.state.pages?.[canvas.getActivePage()]?.place?.[sel];
      const cd = pl && model.state.components?.[pl.ref];
      if (!cd) return;
      clipboard = { compDef: structuredClone(cd), placement: structuredClone(pl) };
    },
    paste() {
      if (!clipboard) return;
      let ni = -1;
      model.commit(s => { ni = placeComponentCopy(s, canvas.getActivePage(), clipboard.compDef, clipboard.placement); });
      if (ni >= 0) canvas.selectPlacement(ni);
    },
    duplicate() {
      const sel = canvas.getSelected();
      if (sel == null) return;
      let ni = -1;
      model.commit(s => { ni = duplicateComponent(s, canvas.getActivePage(), sel); });
      if (ni >= 0) canvas.selectPlacement(ni);
    },
    remove() {
      const sel = canvas.getSelected();
      if (sel == null) return;
      canvas.selectPlacement(null);
      model.commit(s => removePlacementAndOrphan(s, canvas.getActivePage(), sel));
    },
    cut() { compActions.copy(); compActions.remove(); },
  };
  const getClipboard = () => clipboard;
```

Puis remplacer les corps des branches `copy`/`paste`/`duplicate`/`delete` du keydown par des appels à `compActions.*` (préserver les `e.preventDefault()` et les gardes « rien sélectionné → ne pas consommer la touche »).

- [ ] **Step 2 : Passer `compActions` + `getClipboard` à `createTree`**

```javascript
  const tree = createTree($('layers'), model, {
    selection, setSelection,
    getActivePage: canvas.getActivePage,
    setPage: i => canvas.setPage(i),
    compActions, getClipboard,
  });
```

- [ ] **Step 3 : Rendu + dispatch du menu dans `tree.js`**

Étendre la signature : `createTree(root, model, { selection, setSelection, getActivePage, setPage, compActions = {}, getClipboard = () => null } = {})`.

Ajouter un helper de menu (un seul menu vivant à la fois ; fermé au clic ailleurs / Échap ; **aucune** boîte de dialogue native — cf. consigne globale) :

```javascript
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; document.removeEventListener('pointerdown', onDocDown, true); } }
  function onDocDown(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }

  // Exécute une action de menu sur la sélection COURANTE (la ligne a été sélectionnée à l'ouverture).
  function runMenu(id, extra) {
    const sel = selection.get();
    closeMenu();
    if (!sel) return;
    if (sel.kind === 'comp') {
      const page = sel.page, index = sel.index;
      const place = () => model.state.pages[page].place;
      if (id === 'rename')     return beginRename();
      if (id === 'duplicate')  return compActions.duplicate?.();
      if (id === 'copy')       return compActions.copy?.();
      if (id === 'cut')        return compActions.cut?.();
      if (id === 'paste')      return compActions.paste?.();
      if (id === 'delete')     return compActions.remove?.();
      if (id === 'raiseZ')   { const to = Math.min(index + 1, place().length - 1);
        model.commit(s => reorderPlacement(s, page, index, to)); setSelection({ kind: 'comp', page, index: to }); return; }
      if (id === 'lowerZ')   { const to = Math.max(index - 1, 0);
        model.commit(s => reorderPlacement(s, page, index, to)); setSelection({ kind: 'comp', page, index: to }); return; }
      if (id === 'moveTo')   { const toPage = extra.page;
        model.commit(s => movePlacementToPage(s, page, index, toPage));
        const last = (model.state.pages[toPage].place?.length || 1) - 1;
        goPage(toPage); setSelection({ kind: 'comp', page: toPage, index: last }); return; }
    } else if (sel.kind === 'page') {
      const pi = sel.page, total = () => model.state.pages.length;
      if (id === 'rename')    return beginRename();
      if (id === 'duplicate') { let ni = -1; model.commit(s => { ni = duplicatePage(s, pi); });
        if (ni >= 0) { goPage(ni); setSelection({ kind: 'page', page: ni }); } return; }
      if (id === 'delete')    { if (total() <= 1) return; model.commit(s => removePage(s, pi));
        goPage(Math.min(pi, model.state.pages.length - 1)); render(); return; }
      if (id === 'moveUp')    { if (pi <= 0) return; model.commit(s => reorderPages(s, pi, pi - 1));
        goPage(pi - 1); setSelection({ kind: 'page', page: pi - 1 }); return; }
      if (id === 'moveDown')  { if (pi >= total() - 1) return; model.commit(s => reorderPages(s, pi, pi + 1));
        goPage(pi + 1); setSelection({ kind: 'page', page: pi + 1 }); return; }
    }
  }

  function openMenu(x, y) {
    closeMenu();
    const items = contextMenuItems(selection.get(), model.state, { hasClipboard: !!getClipboard() });
    if (!items.length) return;
    menuEl = document.createElement('div'); menuEl.className = 'tree-menu';
    menuEl.style.left = x + 'px'; menuEl.style.top = y + 'px';
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'tree-menu-item' + (it.disabled ? ' disabled' : '') + (it.submenu ? ' has-sub' : '');
      row.textContent = it.label + (it.submenu ? ' ▸' : '');
      if (it.submenu) {
        const sub = document.createElement('div'); sub.className = 'tree-submenu';
        for (const s of it.submenu) {
          const sr = document.createElement('div'); sr.className = 'tree-menu-item';
          sr.textContent = s.label;
          sr.addEventListener('click', ev => { ev.stopPropagation(); runMenu('moveTo', { page: s.page }); });
          sub.appendChild(sr);
        }
        row.appendChild(sub);
      } else if (!it.disabled) {
        row.addEventListener('click', () => runMenu(it.id));
      }
      menuEl.appendChild(row);
    }
    document.body.appendChild(menuEl);
    document.addEventListener('pointerdown', onDocDown, true);
  }
```

Brancher le `contextmenu` sur les lignes (sélectionner d'abord, puis ouvrir le menu). Dans `compRow` (ligne normale) :

```javascript
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (pageIndex !== getActivePage()) goPage(pageIndex);
      setSelection({ kind: 'comp', page: pageIndex, index: c.index });
      render();
      openMenu(e.clientX, e.clientY);
    });
```

Dans `pageRow` (ligne normale) :

```javascript
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      goPage(p.index);
      setSelection({ kind: 'page', page: p.index });
      render();
      openMenu(e.clientX, e.clientY);
    });
```

Fermer le menu sur Échap : dans `render()` ou à l'init, ajouter une fois `root` n'est pas idéal — préférer un listener document unique posé à l'ouverture. Ajouter dans `openMenu` (après `addEventListener('pointerdown'…)`) un handler clavier :

```javascript
    const onKey = e => { if (e.key === 'Escape') { closeMenu(); document.removeEventListener('keydown', onKey, true); } };
    document.addEventListener('keydown', onKey, true);
```

Importer en tête de `tree.js` : `removePage`, `reorderPages` (déjà là), `reorderPlacement`, `movePlacementToPage`, `duplicatePage`, `renameComponent`, `duplicateComponent`/`removePlacementAndOrphan` **non** nécessaires ici (passent par `compActions`).

- [ ] **Step 4 : CSS du menu**

Dans `designer/style.css` (structurel) :

```css
.tree-menu { position: fixed; z-index: 1000; min-width: 180px; padding: 4px;
  background: #16161c; border: 1px solid #2a2a33; border-radius: 6px; box-shadow: 0 6px 24px rgba(0,0,0,.5); }
.tree-menu-item { position: relative; padding: 5px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.tree-menu-item:hover { background: rgba(167,139,250,.18); }
.tree-menu-item.disabled { opacity: .4; pointer-events: none; }
.tree-submenu { display: none; position: absolute; left: 100%; top: 0; min-width: 160px; padding: 4px;
  background: #16161c; border: 1px solid #2a2a33; border-radius: 6px; box-shadow: 0 6px 24px rgba(0,0,0,.5); }
.tree-menu-item.has-sub:hover > .tree-submenu { display: block; }
```

- [ ] **Step 5 : Régression node + vérif navigateur**

Run: `cd designer && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `fail 0`, total **285** (le refactor `compActions` ne change pas le comportement → pas de nouveau test, mais re-vérifier les raccourcis au navigateur).

Vérif navigateur :
- **Clic droit sur un composant** → menu avec rename/duplicate/copy/cut/paste/delete/raiseZ/lowerZ/Déplacer vers… ; raiseZ désactivé sur le composant du dessus, lowerZ sur celui du fond ; paste grisé tant que le presse-papier est vide.
- Chaque action fait l'effet attendu (vérifier sur canvas/inspecteur) ; « Déplacer vers… » liste les autres pages et déplace ; la sélection suit.
- **Clic droit sur une page** → rename/duplicate/delete/moveUp/moveDown ; delete grisé si une seule page ; bornes grisées.
- Menu se ferme au clic ailleurs et à Échap ; **aucune** boîte de dialogue native ne s'ouvre.
- **Régression raccourcis** : Cmd+C/V/D, Suppr fonctionnent toujours comme avant (le refactor `compActions` est transparent).

- [ ] **Step 6 : Commit**

```bash
git add designer/js/app.js designer/js/tree.js designer/style.css
git commit -m "designer: arbre — menu contextuel clic-droit (actions comp/page via contextMenuItems)"
```

---

## Vérification finale (toute la Phase 3b)

- [ ] `cd designer && node --test` → **fail 0**, total **285** (264 + 21 nouveaux).
- [ ] Vérif navigateur globale (serveur **no-store**, vrais events pointer ; **pas** le port 8000) : enchaîner expansion multi-pages → dup page → rename (dblclic + F2) → drag reorder z → drag move entre pages → drag reorder pages → menu contextuel (comp & page). Vérifier à chaque fois : **F1** (pas d'édition au mauvais composant après changement de sélection), **F5** (color picker → bon composant), undo en un coup, la sélection suit l'élément. **Arrêter le serveur** + fermer l'onglet après.
- [ ] Mettre à jour `docs/_internal/HANDOFF.md` : Phase 3b ✅, prochaine étape = Phase 4 (inspecteur contextuel Document/Page/Composant).

---

## Self-Review (rempli à la rédaction)

**1. Couverture spec §1 (affordances arbre) :**
- drag = reorder z **et** déplacer entre pages → Tasks 8 (comp) + 9 (pages). ✓
- renommer = l'**id** → Task 5 (+ F2 Task 6, + menu Task 10). ✓
- survol → ✎/⧉/✕ : pages ont déjà ✎↑↓✕ (Phase 3a) + ⧉ (Task 7) ; **comp** : pas de boutons de survol (choix : rename/dup/suppr passent par F2 + menu contextuel, conforme au HANDOFF 3b ; évite la surcharge). *Écart assumé vs. « survol » de la spec.*
- clic droit = menu contextuel (couper/copier/coller, monter/descendre z, déplacer vers page) → Task 10. ✓
- F2 = renommer → Tasks 2 + 6. ✓
- pas d'œil sur les pages → inchangé (Phase 3a). ✓
- duplication de page → Tasks 1 + 7. ✓
- expansion multi-pages → Task 4. ✓
- mutations `reorderPlacement`/`movePlacementToPage`/`renameComponent` → déjà testées (Phase 1-2). ✓

**2. Placeholders :** aucun « TODO/à compléter ». Le seul point itératif assumé est `reorderTargetIndex` (Task 8) — code complet fourni + plan d'extraction-test si la vérif navigateur révèle un décalage.

**3. Cohérence des types/noms :** `compActions.{copy,paste,duplicate,remove,cut}` (Task 10) ≡ appels dans le keydown refactoré ; `beginRename` (Task 6) appelé par F2 (app.js) **et** le menu (Task 10) ; `duplicatePage`/`uniqueCopyName` (Task 1) importés par Tasks 7 & 10 ; `contextMenuItems` (Task 3) consommé par Task 10 ; `expanded`/`goPage`/`dragSrc`/`dragSrcPage`/`clearDropMarks`/`menuEl` tous déclarés en tête de `createTree`. Cohérent.

**4. Convention repo :** tests node = fonctions **pures** uniquement (Tasks 1-3) ; tout le DOM = vérif navigateur (Rule 11 / `CLAUDE.md`). Commits fréquents, un par task. Mutations pures dans `mutations.js`. CSS structurelle (pas de DA — hors scope).
