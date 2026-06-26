# Physiques permanents (led_ring + sound) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Traiter `led_ring` et `sound` comme des sorties **permanentes** du device (toujours présentes, jamais ajoutées ni supprimées, un seul de chaque pilotage utile), au lieu de composants optionnels ajoutables/supprimables dans le tiroir Device.

**Architecture:** 100 % designer. Une fonction pure `ensurePhysicals(state)` garantit la présence d'un `led_ring` et d'un `sound` à chaque entrée d'un layout dans le modèle (boot / import fichier / GET /layout device). Le tiroir Device perd ses boutons « + … » et « Supprimer » et gagne le renommage inline de l'id (calqué sur `tree.js`). Les helpers d'ajout/suppression devenus orphelins sont retirés. **Aucun changement firmware / schéma / `render.js`** (un `sound` non déclenché est silencieux, un `led_ring` en `off` est éteint → zéro régression device).

**Tech Stack:** JS modules ES (designer), tests `node --test` (cœur pur), vérif navigateur Playwright (DOM). LVGL/firmware non touchés.

**Spec source :** `docs/superpowers/specs/2026-06-25-physiques-permanents-design.md` (design validé en brainstorm — ne pas re-discuter).

---

## Ancrages vérifiés (état du code au moment d'écrire ce plan)

- `default-layout.js:11-12` contient **déjà** `led: { type: "led_ring" }` et `buzz: { type: "sound" }`.
- `registry.js:176-200` : `led_ring` = `physical:true, singleton:true`, `defaults: () => ({ type:'led_ring', color:'#FFFFFF', brightness:64, mode:'off' })` ; `sound` = `physical:true` (PAS singleton), `defaults: () => ({ type:'sound' })`, `compFields:[]`.
- `physical.js` : `addPhysicalComponent`/`canAddType`/`removeComponent` ont pour **unique appelant de production** `device-panel.js` (lignes 68, 128, 129) — ils deviennent **orphelins** après la Task 3. `canAddType` est le **seul lecteur** du flag `singleton` (les autres occurrences de « singleton » sont des commentaires).
- `mutations.js:261` : `renameComponent(state, oldId, newId)` → `false` si oldId absent / newId vide / identique / **déjà pris** (garde d'unicité), `true` si renommé.
- `tree.js:72-97` : patron de renommage inline d'id de composant (input `.tree-rename`, garde d'unicité + `showToast`, Enter/Escape/blur).
- `app.js` : `stripPhysicalPlacements` est appelé en **3 points** : boot `app.js:63` (`if (saved)`), import fichier `app.js:189` (`onLoad`), GET /layout device `app.js:332`.
- Baseline tests : `cd designer && node --test` → **365 / 365**.

## File Structure

| Fichier | Rôle | Changement |
|---|---|---|
| `designer/js/physical.js` | Helpers physiques purs | **+** `ensurePhysicals` ; **−** `addPhysicalComponent`, `canAddType`, `removeComponent` |
| `designer/js/registry.js` | Métadonnées par type | **+** champ `defaultId` (`led` / `buzz`) sur `led_ring` et `sound` |
| `designer/js/app.js` | Câblage boot / I/O | **+** appel `ensurePhysicals` aux 3 points où `stripPhysicalPlacements` est appelé |
| `designer/js/device-panel.js` | Tiroir Device (UI) | **−** boutons « + … » / « Supprimer » ; **+** renommage inline d'id ; **+** note `sound` ; imports ajustés |
| `designer/style.css` | Styles | **+** règle `.src-note` |
| `designer/tests/physical.test.js` | Tests purs | **+** 5 tests `ensurePhysicals` ; **−** tests des helpers retirés ; réécriture du setup de `physicalComponentIds` |

**Décisions sur les 2 points laissés ouverts par la spec :**
- **(a) Sort de `removeComponent`/`canAddType`/`addPhysicalComponent`** → **supprimés** (orphelins après Task 3 ; aucun appelant hors device-panel/tests). `ensurePhysicals` remplace fonctionnellement `addPhysicalComponent`.
- **(b) Flag `singleton` de `led_ring`** → **conservé** comme documentation d'invariant (redondant mais exact ; les commentaires de `led-ring-preview.js`/`physical.js` y réfèrent). Le retirer serait du churn registre sans gain. Un commentaire sera ajouté pour signaler qu'il n'est plus *lu* (l'unicité est désormais structurelle via `ensurePhysicals` + retrait de l'UI d'ajout).

**Écart assumé vs lettre de la spec (à valider) :** la spec liste « boot + import » (et le Flux « boot / import / Nouveau »). Ce plan appelle aussi `ensurePhysicals` au **3ᵉ point** où `stripPhysicalPlacements` existe déjà : **GET /layout device** (`app.js:332`). Raison : `ensurePhysicals` et `stripPhysicalPlacements` forment une **paire de migration** ; les désynchroniser laisserait un layout device sans physiques afficher **0 carte** dans le tiroir. Coût nul (no-op si déjà présents). Voir Task 2.

---

## Task 1 : `ensurePhysicals` (fonction pure) + `defaultId` registre

**Files:**
- Modify: `designer/js/registry.js:176-200` (ajout `defaultId`)
- Modify: `designer/js/physical.js` (ajout `ensurePhysicals`)
- Test: `designer/tests/physical.test.js` (ajout import + 5 tests)

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `designer/tests/physical.test.js`, ajouter `ensurePhysicals` à l'import existant :

```js
import {
  isPhysicalType, physicalTypes, physicalComponentIds,
  addPhysicalComponent, removeComponent, stripPhysicalPlacements, canAddType,
  ensurePhysicals
} from '../js/physical.js';
```

Et **ajouter à la fin du fichier** ces 5 tests :

```js
test('ensurePhysicals : injecte led_ring(off) et sound(buzz) si absents', () => {
  const s = { components: {}, pages: [] };
  ensurePhysicals(s);
  assert.equal(s.components.led?.type, 'led_ring');
  assert.equal(s.components.led?.mode, 'off');           // neutre par défaut
  assert.equal(s.components.buzz?.type, 'sound');
});

test('ensurePhysicals : pas de doublon si le type est déjà présent', () => {
  const s = { components: { myled: { type: 'led_ring', mode: 'solid' }, b: { type: 'sound' } }, pages: [] };
  ensurePhysicals(s);
  assert.equal(Object.values(s.components).filter(c => c.type === 'led_ring').length, 1);
  assert.equal(Object.values(s.components).filter(c => c.type === 'sound').length, 1);
});

test('ensurePhysicals : préserve un led_ring déjà configuré (ne réinitialise pas)', () => {
  const s = { components: { myled: { type: 'led_ring', mode: 'solid', color: '#FF0000' } }, pages: [] };
  ensurePhysicals(s);
  assert.equal(s.components.myled.mode, 'solid');
  assert.equal(s.components.myled.color, '#FF0000');
});

test('ensurePhysicals : id par défaut déjà pris par autre chose → dé-dup', () => {
  const s = { components: { led: { type: 'label', text: 'X' } }, pages: [] };   // 'led' occupé par un label
  ensurePhysicals(s);
  const ringId = Object.keys(s.components).find(k => s.components[k].type === 'led_ring');
  assert.ok(ringId && ringId !== 'led', `id ring attendu != 'led', reçu ${ringId}`);
  assert.equal(s.components.led.type, 'label');           // le label 'led' est intact
});

test('ensurePhysicals : idempotent', () => {
  const s = { components: {}, pages: [] };
  ensurePhysicals(s); ensurePhysicals(s);
  assert.equal(Object.values(s.components).filter(c => c.type === 'led_ring').length, 1);
  assert.equal(Object.values(s.components).filter(c => c.type === 'sound').length, 1);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd designer && node --test`
Expected: ÉCHEC au chargement de `tests/physical.test.js` — `SyntaxError: The requested module '../js/physical.js' does not provide an export named 'ensurePhysicals'`.

- [ ] **Step 3 : Ajouter `defaultId` au registre**

Dans `designer/js/registry.js`, entrée `led_ring` (l.176-190) — ajouter `defaultId: 'led'` :

```js
  led_ring: {
    label: 'LED ring',
    defaultId: 'led',
    defaults: () => ({ type: 'led_ring', color: '#FFFFFF', brightness: 64, mode: 'off' }),
    makePlacement: (id) => ({ ref: id }),
    centered: false, physical: true, singleton: true,   // singleton : invariant documentaire (plus lu — unicité assurée par ensurePhysicals + retrait de l'UI d'ajout)
```

Entrée `sound` (l.191-200) — ajouter `defaultId: 'buzz'` :

```js
  sound: {
    label: 'Son',
    defaultId: 'buzz',
    defaults: () => ({ type: 'sound' }),
    makePlacement: (id) => ({ ref: id }),
    centered: false, physical: true,
```

- [ ] **Step 4 : Implémenter `ensurePhysicals`**

Dans `designer/js/physical.js`, ajouter en fin de fichier (après `canAddType`) :

```js
// Migration : garantit la présence d'UN composant de chaque type physique (led_ring, sound).
// Si aucun composant d'un type n'existe, en injecte un avec l'id par défaut du registre (led / buzz),
// ou un id dé-dupliqué <type><n> si cet id est déjà pris par autre chose. Idempotent.
// Legacy multi-sound : laissé tel quel (un sound existe déjà → no-op, pas de collapse).
export function ensurePhysicals(state) {
  state.components ||= {};
  for (const type of physicalTypes()) {
    if (Object.values(state.components).some(c => c.type === type)) continue;
    let id = COMPONENTS[type].defaultId;
    if (state.components[id]) id = uniqueId(state, type);   // id par défaut pris par autre chose → fallback
    addComponent(state, id, COMPONENTS[type].defaults());
  }
}
```

(`physicalTypes`, `COMPONENTS`, `uniqueId`, `addComponent` sont déjà en portée dans `physical.js`.)

- [ ] **Step 5 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS — **370 / 370** (365 + 5 nouveaux), `fail 0`.

- [ ] **Step 6 : Commit**

```bash
git add designer/js/physical.js designer/js/registry.js designer/tests/physical.test.js
git commit -m "feat(designer): ensurePhysicals — garantit led_ring + sound (physiques permanents)"
```

---

## Task 2 : Câbler `ensurePhysicals` dans `app.js` (boot / import / device-load)

**Files:**
- Modify: `designer/js/app.js:20` (import), `:63` (boot), `:189` (import fichier), `:332` (GET /layout)

> Pas de test unitaire node (câblage applicatif, pas de harnais DOM/app). Vérification : non-régression `node --test` + vérif navigateur (Task 5). Le cœur `ensurePhysicals` est déjà testé (Task 1).

- [ ] **Step 1 : Étendre l'import**

`designer/js/app.js:20` — de :

```js
import { stripPhysicalPlacements } from './physical.js';
```

à :

```js
import { stripPhysicalPlacements, ensurePhysicals } from './physical.js';
```

- [ ] **Step 2 : Boot (`app.js:63`)**

De :

```js
  if (saved) stripPhysicalPlacements(saved);   // migration : physiques jamais attachés à une page
```

à :

```js
  if (saved) { stripPhysicalPlacements(saved); ensurePhysicals(saved); }   // migration : physiques jamais placés + toujours présents
```

(Cas « aucun layout autosauvé » : `createModel(undefined)` charge `DEFAULT_LAYOUT`, qui contient déjà `led`+`buzz` → rien à injecter.)

- [ ] **Step 3 : Import fichier (`onLoad`, `app.js:189`)**

De :

```js
    onLoad: () => { model.commit(s => stripPhysicalPlacements(s)); canvas.setPage(0); tree.render(); }
```

à :

```js
    onLoad: () => { model.commit(s => { stripPhysicalPlacements(s); ensurePhysicals(s); }); canvas.setPage(0); tree.render(); }
```

- [ ] **Step 4 : GET /layout device (`app.js:332`)**

De :

```js
      stripPhysicalPlacements(lay);            // migration avant chargement dans le modèle
```

à :

```js
      stripPhysicalPlacements(lay); ensurePhysicals(lay);   // migration avant chargement dans le modèle
```

- [ ] **Step 5 : Non-régression**

Run: `cd designer && node --test`
Expected: PASS — **370 / 370**, `fail 0` (app.js n'a pas de test ; on confirme l'absence de régression du cœur).

- [ ] **Step 6 : Commit**

```bash
git add designer/js/app.js
git commit -m "feat(designer): injecte les physiques au chargement (boot/import/device)"
```

---

## Task 3 : Tiroir Device — cartes permanentes (retrait +/Supprimer, renommage inline, note sound)

**Files:**
- Modify: `designer/js/device-panel.js` (imports, `renamingId`, en-tête de carte, note sound, retrait de la boucle « + … », commentaire garde-focus)
- Modify: `designer/style.css` (après `.src-add`, l.398 : règle `.src-note`)

> Pas de harnais DOM dans la suite node (cf. `device.test.js` qui ne teste que le contrat d'API). Vérification fonctionnelle en Task 5 (navigateur). `renameComponent` est déjà testé côté `mutations`.

- [ ] **Step 1 : Ajuster les imports (`device-panel.js:6-10`)**

De :

```js
import { COMPONENTS, LED_MODES } from './registry.js';
import { setComponentProp } from './mutations.js';
import { getMock, setMock } from './mocks.js';
import { physicalTypes, physicalComponentIds, addPhysicalComponent, removeComponent, canAddType } from './physical.js';
import { paintRing, ledFrame, ledFrameAt } from './led-ring-preview.js';
```

à :

```js
import { COMPONENTS, LED_MODES } from './registry.js';
import { setComponentProp, renameComponent } from './mutations.js';
import { getMock, setMock } from './mocks.js';
import { physicalComponentIds } from './physical.js';
import { paintRing, ledFrame, ledFrameAt } from './led-ring-preview.js';
import { showToast } from './toast.js';
```

- [ ] **Step 2 : État de renommage + commentaire garde-focus**

Dans `createDevicePanel`, sous `let previewRaf = null;` (l.45), ajouter :

```js
  let renamingId = null;   // id de la carte physique en renommage inline, ou null
```

Et mettre à jour le commentaire garde-focus (l.50-51), désormais sans boutons Ajouter/Supprimer :

```js
    // Garde-focus : ne sauter le re-render QUE pendant l'édition d'un CHAMP (input/select/textarea).
    // Un bouton focalisé (▶ Aperçu) ne doit PAS bloquer le rebuild.
```

- [ ] **Step 3 : En-tête de carte — renommage inline au lieu de titre + Supprimer**

Remplacer le bloc d'en-tête actuel (`device-panel.js:64-70`) :

```js
      const head = document.createElement('div'); head.className = 'src-head';
      const title = document.createElement('span'); title.className = 'src-title';
      title.textContent = `${id} · ${def.label}`;
      const del = document.createElement('button'); del.className = 'src-del'; del.textContent = 'Supprimer';
      del.addEventListener('click', () => model.commit(s => removeComponent(s, id)));
      head.appendChild(title); head.appendChild(del);
      card.appendChild(head);
```

par :

```js
      const head = document.createElement('div'); head.className = 'src-head';
      if (renamingId === id) {
        // Renommage inline de l'id (sert au routage /update). Calqué sur tree.js:72-97, MAIS tout passe
        // par le blur : à ce moment le focus a quitté l'input → le garde-focus de render() ne bloque plus.
        const inp = document.createElement('input'); inp.className = 'tree-rename'; inp.value = id;
        const orig = id;
        let cancelled = false;
        const finish = () => {
          if (renamingId !== id) return;
          const nid = inp.value.trim();
          if (cancelled || !nid || nid === orig) { renamingId = null; render(); return; }        // vide/identique/Échap → annule
          if (model.state.components?.[nid]) { showToast(`L'id « ${nid} » est déjà pris`); renamingId = null; render(); return; }
          renamingId = null;
          model.commit(s => renameComponent(s, orig, nid));   // → subscribe → render()
        };
        inp.addEventListener('input', () => {
          const v = inp.value.trim();
          inp.classList.toggle('invalid', !!v && v !== orig && !!model.state.components?.[v]);
        });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancelled = true; inp.blur(); }
        });
        inp.addEventListener('blur', finish);
        head.appendChild(inp);
        queueMicrotask(() => { inp.focus(); inp.select(); });
      } else {
        const title = document.createElement('span'); title.className = 'src-title';
        title.textContent = `${id} · ${def.label}`;
        title.title = 'Double-cliquer pour renommer l’id';
        title.addEventListener('dblclick', () => { renamingId = id; render(); });
        head.appendChild(title);
      }
      card.appendChild(head);
      if (c.type === 'sound') {
        const note = document.createElement('div'); note.className = 'src-note';
        note.textContent = 'Déclenché via /update : {tone, ms} ou {name: ok|alert|error}';
        card.appendChild(note);
      }
```

- [ ] **Step 4 : Retirer la boucle des boutons « + … »**

Supprimer entièrement le bloc `device-panel.js:125-131` :

```js
    for (const type of physicalTypes()) {
      const add = document.createElement('button'); add.className = 'src-add';
      add.textContent = '+ ' + COMPONENTS[type].label;
      add.disabled = !canAddType(model.state, type);
      add.addEventListener('click', () => model.commit(s => addPhysicalComponent(s, type)));
      root.appendChild(add);
    }
```

(La boucle `for (const id of physicalComponentIds(model.state))` qui rend les cartes reste inchangée.)

- [ ] **Step 5 : CSS — règle `.src-note`**

Dans `designer/style.css`, après `.src-add` (l.398), ajouter :

```css
.src-note { color: var(--muted); font-size: 12px; line-height: 1.4; }
```

- [ ] **Step 6 : Non-régression**

Run: `cd designer && node --test`
Expected: PASS — **370 / 370**, `fail 0` (le contrat `createDevicePanel.length === 2` de `device.test.js` reste vrai : `onPreview` est toujours un 3ᵉ paramètre à valeur par défaut).

- [ ] **Step 7 : Commit**

```bash
git add designer/js/device-panel.js designer/style.css
git commit -m "feat(designer): tiroir Device — cartes physiques permanentes (renommage id, sans +/Supprimer)"
```

---

## Task 4 : Retirer les helpers orphelins + nettoyer leurs tests

**Files:**
- Modify: `designer/js/physical.js` (retrait de `addPhysicalComponent`, `removeComponent`, `canAddType`)
- Modify: `designer/tests/physical.test.js` (retrait des tests morts, réécriture du setup de `physicalComponentIds`)

> Ordre : APRÈS la Task 3 (sinon `device-panel.js` importerait des fonctions inexistantes).

- [ ] **Step 1 : Retirer les 3 fonctions de `physical.js`**

Supprimer les blocs suivants de `designer/js/physical.js` :

`addPhysicalComponent` (l.20-25) :

```js
// Ajoute un composant physique global : entrée dans `components`, AUCUN placement. Retourne l'id.
export function addPhysicalComponent(state, type) {
  const id = uniqueId(state, type);
  addComponent(state, id, COMPONENTS[type].defaults());
  return id;
}
```

`removeComponent` (l.27-33) :

```js
// Supprime un composant de `components` ET retire tout placement le référençant sur toutes les pages.
export function removeComponent(state, id) {
  if (state.components) delete state.components[id];
  for (const page of state.pages || []) {
    if (page.place) page.place = page.place.filter(pl => pl.ref !== id);
  }
}
```

`canAddType` (l.43-47) :

```js
// Cardinalité : un type marqué `singleton` (ex. led_ring) ne peut exister qu'en un exemplaire.
export function canAddType(state, type) {
  if (!COMPONENTS[type]?.singleton) return true;
  return !Object.values(state.components || {}).some(c => c.type === type);
}
```

Conserver `import { uniqueId, addComponent } from './mutations.js';` (les deux restent utilisés par `ensurePhysicals`).

- [ ] **Step 2 : Nettoyer `physical.test.js`**

Mettre l'import à l'état final (retrait des 3 noms supprimés) :

```js
import {
  isPhysicalType, physicalTypes, physicalComponentIds,
  stripPhysicalPlacements, ensurePhysicals
} from '../js/physical.js';
```

Supprimer le helper `fresh()` (devenu inutilisé) et les 5 tests morts : `addPhysicalComponent : ajoute dans components SANS placement`, `addPhysicalComponent : id unique par type`, `removeComponent : purge components + placements sur toutes les pages`, `canAddType : led_ring singleton (true puis false)`, `canAddType : sound 0..N (toujours true)`.

Réécrire le test `physicalComponentIds` (qui utilisait `addPhysicalComponent`) en setup direct :

```js
test('physicalComponentIds : ne renvoie que les physiques', () => {
  const s = { components: { titre: { type: 'label' }, led: { type: 'led_ring' } }, pages: [] };
  assert.deepEqual(physicalComponentIds(s), ['led']);   // 'titre' (label) exclu
});
```

Conserver tels quels : `isPhysicalType …`, `physicalTypes …`, les deux `stripPhysicalPlacements …`, et les 5 tests `ensurePhysicals` (ajoutés Task 1).

- [ ] **Step 3 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS — **365 / 365** (370 − 5 tests morts retirés), `fail 0`.

- [ ] **Step 4 : Vérifier qu'aucun import orphelin ne subsiste**

Run: `cd designer && grep -rn "addPhysicalComponent\|canAddType\|removeComponent" js/`
Expected: aucune ligne (les 3 symboles ont disparu du code de production).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/physical.js designer/tests/physical.test.js
git commit -m "refactor(designer): retire les helpers d'ajout/suppression physiques (orphelins)"
```

---

## Task 5 : Vérification navigateur (Playwright, autonome)

**Files:** aucun (vérification). Captures éventuelles dans `.playwright-mcp/` (à ne pas committer).

> Procédure projet (mémoire `designer-verif-navigateur`) : servir **no-store depuis la racine du repo**, port **≠ 8000**, démarrer le serveur **avant** la 1ʳᵉ ouverture, naviguer vers `/designer/index.html`, piloter avec de **vrais** events pointer, **arrêter le serveur à la fin**.

- [ ] **Step 1 : Servir le designer (no-store, racine, port ≠ 8000)**

Petit serveur python no-store (`Cache-Control: no-store`), `directory=` = racine du repo, port ex. 8765. Le démarrer en tâche de fond.

- [ ] **Step 2 : Boot propre + 2 cartes permanentes**

Naviguer `http://127.0.0.1:8765/designer/index.html`. Ouvrir le tiroir Device (lien « Ouvrir la plomberie (Device) → » de l'inspecteur Document, ou l'icône Device).
Vérifier (console **0 erreur**) :
- exactement **2 cartes** : `led · LED ring` et `buzz · Son` ;
- **aucun** bouton « + LED ring » / « + Son » ni « Supprimer » ;
- la carte `led` a Couleur / Luminosité / Mode (**Éteint** par défaut) / Période (grisée) / Valeur % / mini-aperçu / ▶ Aperçu ;
- la carte `buzz` n'a **pas** de réglage, mais la **note** « Déclenché via /update … ».

- [ ] **Step 3 : Renommage d'id avec garde d'unicité**

Double-cliquer le titre `buzz · Son` → input. Saisir `klaxon` + Enter → la carte devient `klaxon · Son` ; vérifier dans le state (`localStorage 'rt-designer-layout'`) que la clé `buzz` est devenue `klaxon`.
Double-cliquer `led · LED ring`, saisir `klaxon` (déjà pris) + Enter → **toast « déjà pris »**, l'id reste `led`. Tester **Échap** en cours d'édition → annulation, id inchangé.

- [ ] **Step 4 : Migration d'un layout sans physiques (import)**

Dans la console : injecter un layout minimal **sans** led_ring ni sound, p.ex.
`localStorage.setItem('rt-designer-layout', JSON.stringify({ components: { t: { type:'label', text:'Hi' } }, pages:[{ name:'P', place:[{ ref:'t', anchor:'CENTER' }] }] }))` puis recharger.
Vérifier qu'au boot les **2 cartes** `led` + `buzz` **réapparaissent** (injectées par `ensurePhysicals`), et que le canvas n'a pas régressé.

- [ ] **Step 5 : Arrêter le serveur + nettoyer**

Tuer le serveur de test (vérifier le port libéré). Nettoyer toute capture/`localStorage` de test. **Ne rien committer** d'artefact de vérif.

- [ ] **Step 6 (optionnel) : Capture pour validation utilisateur**

Envoyer une capture du tiroir Device (2 cartes permanentes) à l'utilisateur — le verdict visuel final lui revient.

---

## Self-Review (relecture à froid vs spec)

**1. Couverture spec :**
- « led_ring + sound permanents, un seul, jamais ajoutés/supprimés » → Task 3 (retrait +/Supprimer) + Task 1/2 (`ensurePhysicals` garantit la présence). ✅
- « led_ring `off` par défaut / sound `buzz` » → `registry.defaults` (déjà) + `defaultId` (Task 1). ✅
- « 2 ids renommables, mécanisme inline calqué sur tree.js » → Task 3 Step 3. ✅
- « Migration `ensurePhysicals` pure, appelée au chargement » → Task 1 (pure + tests) + Task 2 (câblage). ✅ — **avec écart assumé** : 3 points d'appel au lieu de 2 (ajout GET /layout device), justifié plus haut. **À confirmer par l'utilisateur/relecture spec.**
- « Note sound `/update {tone,ms}|{name}` » → Task 3 Step 3. ✅
- « Legacy multi-sound laissé tel quel » → `ensurePhysicals` no-op si ≥1 sound existe (test « pas de doublon »). ✅
- « 100 % designer, firmware/schéma/render.js intacts » → aucun fichier hors `designer/`. ✅
- « Tests `ensurePhysicals` (injecte/pas de doublon/préserve/dé-dup/idempotent) » → Task 1, 5 tests. ✅
- 2 points ouverts spec → tranchés (helpers supprimés ; `singleton` conservé documentaire). ✅

**2. Placeholders :** aucun — chaque étape porte le code réel et la commande + sortie attendue.

**3. Cohérence des types/signatures :** `ensurePhysicals(state)` (1 arg, mute en place, comme `stripPhysicalPlacements`) appelé identiquement aux 3 sites ; `renameComponent(state, oldId, newId)` conforme à `mutations.js:261` ; `physicalComponentIds`/`physicalTypes`/`COMPONENTS[type].defaults()`/`uniqueId`/`addComponent` inchangés ; `defaultId` lu uniquement par `ensurePhysicals`.

**Garde anti-régression transverse :** `git diff --name-only main...HEAD -- src lib schema designer/js/render.js` doit rester **vide** sur toute la branche (invariant « 100 % designer »).
