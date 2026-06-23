# Carousel de vignettes de pages — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une bande de vignettes de pages (rendu live, navigation visuelle rapide) sous le hero disque, complétant l'arbre des calques.

**Architecture:** Approche additive. Nouveau module `carousel.js` (vue de plus sur le même modèle, abonnée à `model` + `selection`, comme l'arbre/canvas). Réutilise les builders du registre via une nouvelle fonction read-only `buildPageStatic` (mini-stage 360×360 scalé). Le menu contextuel est factorisé dans `contextmenu.js`, partagé arbre↔carousel. Aucune logique métier dupliquée : tout passe par `mutations.js` + la sélection partagée.

**Tech Stack:** JS modules ES (designer), `node --test` (cœur pur), vérification navigateur Playwright (DOM). LVGL côté firmware non touché.

**Convention de test du projet (à respecter) :** la **math/logique pure est testée en `node --test`** ; le **rendu DOM est vérifié au navigateur** (cf. `designer/js/render.js:1-3`). Il n'y a **pas de jsdom**. Donc : fonctions pures → TDD node strict ; tâches DOM → critère de vérification navigateur explicite (snapshot + observations) à la place du test node.

**Pré-requis :** être sur la branche `feat/carousel-pages` (le spec y est déjà committé : `docs/superpowers/specs/2026-06-23-carousel-pages-design.md`).

**Lancer les tests :** `cd designer && node --test` (sans argument).

---

## Task 1 : Helpers purs du carousel (`canAddPage`, `arrowState`)

Logique pure, testable sans DOM. Deux décisions d'UI : peut-on ajouter une page (limite firmware), et quelles flèches griser selon le débordement.

**Files:**
- Create: `designer/js/carousel.js`
- Test: `designer/tests/carousel.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

`designer/tests/carousel.test.js` :
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAddPage, arrowState, MAX_PAGES } from '../js/carousel.js';

test('MAX_PAGES = 8 (miroir config.h)', () => {
  assert.equal(MAX_PAGES, 8);
});

test('canAddPage : vrai sous la limite, faux à la limite', () => {
  assert.equal(canAddPage({ pages: [] }), true);
  assert.equal(canAddPage({ pages: Array(7).fill({}) }), true);
  assert.equal(canAddPage({ pages: Array(8).fill({}) }), false);
  assert.equal(canAddPage({ pages: Array(9).fill({}) }), false);
  assert.equal(canAddPage({}), true);            // pas de pages → 0 < 8
});

test('arrowState : flèches grisées selon le débordement', () => {
  // tout visible (pas de débordement) → les deux grisées
  assert.deepEqual(arrowState({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }),
    { left: false, right: false });
  // début de liste, déborde à droite
  assert.deepEqual(arrowState({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 }),
    { left: false, right: true });
  // milieu : les deux actives
  assert.deepEqual(arrowState({ scrollLeft: 100, scrollWidth: 800, clientWidth: 300 }),
    { left: true, right: true });
  // fin de liste : gauche active, droite grisée (tolérance 1px)
  assert.deepEqual(arrowState({ scrollLeft: 500, scrollWidth: 800, clientWidth: 300 }),
    { left: true, right: false });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `carousel.js` n'exporte pas encore `canAddPage`/`arrowState`/`MAX_PAGES` (ou module introuvable).

- [ ] **Step 3 : Implémenter les helpers**

Créer `designer/js/carousel.js` avec, en tête de fichier :
```js
// Carousel de vignettes de pages (sous le hero disque) : navigation visuelle rapide.
// Vue de plus sur le modèle (abonnée model + selection), comme l'arbre/canvas.
// La math/décisions pures sont ici (testées node) ; le rendu DOM est vérifié au navigateur.

// Miroir de src/config.h:3 (#define MAX_PAGES 8) et de designer/js/validate.js:27 (LIM.pages).
export const MAX_PAGES = 8;

// Peut-on encore ajouter une page ? (borne le bouton « + page »)
export function canAddPage(state, max = MAX_PAGES) {
  return (state?.pages?.length ?? 0) < max;
}

// État des flèches de défilement selon la position de scroll de la bande.
// Tolérance d'1px pour absorber les arrondis sub-pixel de scrollWidth/clientWidth.
export function arrowState({ scrollLeft, scrollWidth, clientWidth }) {
  return {
    left: scrollLeft > 0,
    right: scrollLeft + clientWidth < scrollWidth - 1,
  };
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS (tous les tests carousel + non-régression du reste).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/carousel.js designer/tests/carousel.test.js
git commit -m "carousel: helpers purs canAddPage/arrowState + tests"
```

---

## Task 2 : Factoriser le menu contextuel dans `contextmenu.js`

Le rendu du menu (`openMenu`, `tree.js:460-494`) est généralisé en `openContextMenu(x, y, items, onPick)`. `contextMenuItems` (déjà pur, `tree.js:43`) est déplacé dans le même module. L'arbre est recâblé dessus (non-régression). Le carousel s'en servira en Task 8.

**Files:**
- Create: `designer/js/contextmenu.js`
- Modify: `designer/js/tree.js` (importe depuis `contextmenu.js`, remplace son `openMenu` interne)
- Modify: `designer/tests/tree.test.js` (import de `contextMenuItems` depuis `contextmenu.js`)

- [ ] **Step 1 : Mettre à jour le test (import déplacé)**

Dans `designer/tests/tree.test.js`, changer l'import de `contextMenuItems` pour qu'il pointe vers `../js/contextmenu.js` (laisser `reorderTargetIndex` et le reste importés de `../js/tree.js`). Garder les assertions existantes inchangées — elles valident le contrat de `contextMenuItems`.

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `contextmenu.js` n'existe pas / n'exporte pas `contextMenuItems`.

- [ ] **Step 3 : Créer `contextmenu.js`**

Déplacer `contextMenuItems` (corps actuel de `tree.js:43-74`) tel quel dans `designer/js/contextmenu.js`, et ajouter le rendu généralisé extrait de `openMenu` :
```js
// Menu contextuel partagé (arbre des calques ↔ carousel de pages).
// contextMenuItems : pur (items selon la sélection), testé node.
// openContextMenu : rendu DOM du menu flottant, onPick(id, extra) délègue l'action à l'appelant.

export function contextMenuItems(sel, state, { hasClipboard = false } = {}) {
  // … (corps identique à l'actuel tree.js:43-74, déplacé sans changement) …
}

let menuEl = null, onDocDown = null, menuKeyHandler = null;

export function closeContextMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
  if (onDocDown) { document.removeEventListener('pointerdown', onDocDown, true); onDocDown = null; }
  if (menuKeyHandler) { document.removeEventListener('keydown', menuKeyHandler, true); menuKeyHandler = null; }
}

// items: sortie de contextMenuItems. onPick(id, extra) exécute l'action (câblage propre à l'appelant).
export function openContextMenu(x, y, items, onPick) {
  closeContextMenu();
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
        sr.addEventListener('click', ev => { ev.stopPropagation(); closeContextMenu(); onPick(s.id, s); });
        sub.appendChild(sr);
      }
      row.appendChild(sub);
    } else if (!it.disabled) {
      row.addEventListener('click', () => { closeContextMenu(); onPick(it.id, it); });
    }
    menuEl.appendChild(row);
  }
  document.body.appendChild(menuEl);
  menuEl.addEventListener('pointerdown', e => e.stopPropagation());
  const mr = menuEl.getBoundingClientRect();
  if (mr.bottom > window.innerHeight) menuEl.style.top = Math.max(4, window.innerHeight - mr.height - 4) + 'px';
  if (mr.right > window.innerWidth) menuEl.style.left = Math.max(4, window.innerWidth - mr.width - 4) + 'px';
  onDocDown = e => { if (menuEl && !menuEl.contains(e.target)) closeContextMenu(); };
  document.addEventListener('pointerdown', onDocDown, true);
  menuKeyHandler = e => { if (e.key === 'Escape') closeContextMenu(); };
  document.addEventListener('keydown', menuKeyHandler, true);
}
```
*Note : le `onPick` reçoit `(id, extra)`. Pour le sous-menu « Déplacer vers… », `extra` est l'item submenu (`{id:'moveTo', page}`), d'où `onPick(s.id, s)` qui préserve `extra.page` attendu par le runMenu de l'arbre (`tree.js:442`).*

- [ ] **Step 3b : Recâbler `tree.js` sur `contextmenu.js`**

Dans `designer/js/tree.js` :
1. Supprimer la définition locale `contextMenuItems` (43-74) et la fonction `openMenu` (460-494) + ses helpers de fermeture devenus inutiles (`closeMenu`, `onDocDown`, état `menuEl`) **si** ils ne servent qu'au menu.
2. Ajouter en tête : `import { contextMenuItems, openContextMenu, closeContextMenu } from './contextmenu.js';`
3. Aux deux sites d'ouverture (`tree.js:194` et `:320`), remplacer `openMenu(e.clientX, e.clientY)` par :
   ```js
   openContextMenu(e.clientX, e.clientY,
     contextMenuItems(selection.get(), model.state, { hasClipboard: !!getClipboard() }),
     runMenu);
   ```
4. `contextMenuItems` est ré-exporté pour compat éventuelle : `export { contextMenuItems } from './contextmenu.js';` (laisse les autres importeurs intacts).
5. Vérifier que `runMenu(id, extra)` lit toujours `extra.page` pour `moveTo` (inchangé).

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS (tree.test.js via le nouvel import + reste vert).

- [ ] **Step 5 : Vérification navigateur — non-régression du menu de l'arbre**

Servir le designer (serveur no-store, port ≠ 8000), ouvrir, **clic-droit** sur une page et sur un composant dans l'arbre. Observer : le menu s'ouvre, les items corrects, Échap/clic-ailleurs ferme, une action (ex. Dupliquer) fonctionne. Capturer un snapshot.

- [ ] **Step 6 : Commit**

```bash
git add designer/js/contextmenu.js designer/js/tree.js designer/tests/tree.test.js
git commit -m "carousel: factorise le menu contextuel dans contextmenu.js (arbre recâblé)"
```

---

## Task 3 : `buildPageStatic` — rendu read-only d'une page (miniature)

Rend tous les widgets d'une page dans un mini-stage 360×360, sans interactivité, réutilisant `COMPONENTS[type].build` + `placeAt` (mêmes builders que le canvas). Le carousel scalera ce mini-stage. **DOM → vérification navigateur** (pas de test node).

**⚠ Placement : `carousel.js`, PAS `render.js`.** `registry.js` importe déjà les builders de `render.js` (`registry.js:7`) ; mettre `buildPageStatic` (qui importe `registry.js`) dans `render.js` créerait un cycle `render.js ↔ registry.js`. `carousel.js` est un consommateur (comme `canvas.js`) → aucun cycle. `buildPageStatic` n'a d'ailleurs pas besoin de `render.js` : les builders sont obtenus via `COMPONENTS[type].build`.

**Files:**
- Modify: `designer/js/carousel.js` (ajouter `buildPageStatic` + les imports nécessaires)

- [ ] **Step 1 : Implémenter `buildPageStatic`**

Dans `designer/js/carousel.js`, ajouter les imports en tête puis la fonction (les builders viennent du registre, donc on n'importe PAS `render.js`) :
```js
import { COMPONENTS } from './registry.js';
import { placeAt, SCREEN } from './geometry.js';
import { getMock } from './mocks.js';

// Rend une page entière en read-only dans un mini-stage 360×360 (mêmes builders + placement que le
// canvas, sans sélection/poignées/preview). L'appelant (carousel) attache l'élément au DOM puis le
// scale (transform) à la taille de la vignette. Composants `physical` ignorés (cf. canvas.render).
// DOIT être attaché au DOM avant lecture des tailles : le placement non-centré mesure le widget.
export function buildPageStatic(page, comps) {
  const mini = document.createElement('div');
  mini.className = 'mini-stage';
  mini.style.width = SCREEN + 'px';
  mini.style.height = SCREEN + 'px';
  mini.style.position = 'relative';
  const place = page?.place ?? [];
  // Phase 1 : construire + attacher (pour pouvoir mesurer).
  const built = [];
  for (const pl of place) {
    const comp = comps?.[pl.ref];
    if (!comp) continue;                 // ref inconnue : la validation le signale déjà
    const def = COMPONENTS[comp.type];
    if (!def || def.physical) continue;  // type inconnu / sortie physique : pas dessiné sur une page
    const node = def.build(comp, pl, getMock(pl.ref, comp.type));
    mini.appendChild(node);
    built.push({ node, pl, def });
  }
  // Phase 2 : positionner (mesure à l'échelle 1, le carousel scale le conteneur ensuite).
  for (const { node, pl, def } of built) {
    if (def.centered) {
      const r = pl.radius || 80;
      node.style.left = (SCREEN / 2 - r) + 'px';
      node.style.top  = (SCREEN / 2 - r) + 'px';
    } else {
      const rect = node.getBoundingClientRect();
      const { x, y } = placeAt(pl.anchor || 'CENTER', pl.dx || 0, pl.dy || 0, rect.width, rect.height);
      node.style.left = x + 'px';
      node.style.top  = y + 'px';
    }
  }
  return mini;
}
```
*Note d'architecture : la boucle réplique `canvas.render`/`position` (`canvas.js:104-117, 78-92`) en version read-only. La double-maintenance est minime (positionnement seul) ; les builders, eux, ne sont PAS dupliqués (réutilisés via le registre). Si une dérive apparaît, factoriser la boucle dans une fonction partagée que `canvas.render` appelle aussi — hors scope ici.*

- [ ] **Step 2 : Vérification navigateur (différée)**

`buildPageStatic` produit du DOM mesuré → sa vérification visuelle se fait dans la Task 4 (intégré au carousel, où il est attaché + scalé). Marquer ce point : pas de test node (convention projet).

- [ ] **Step 3 : Commit**

```bash
git add designer/js/carousel.js
git commit -m "carousel: buildPageStatic (rendu read-only d'une page, réutilise le registre)"
```

---

## Task 4 : `createCarousel` — bande, vignettes, surlignage actif, clic-navigation + intégration

Cœur de la feature. Construit la bande dans `#canvas-col`, rend une vignette par page (scale du mini-stage), surligne la page active (+10 % + halo), clic → change de page. Abonné `model` + `selection`.

**Files:**
- Modify: `designer/js/carousel.js` (ajouter `createCarousel` sous les helpers)
- Modify: `designer/index.html` (host `#carousel` dans `#canvas-col`, sous `#stage-wrap`)
- Modify: `designer/js/app.js` (instancier le carousel)
- Modify: `designer/style.css` (styles bande/vignette/active)

- [ ] **Step 1 : Host dans `index.html`**

Dans `designer/index.html`, à l'intérieur de `<section id="canvas-col">`, après `</div>` de `#stage-wrap` (ligne ~55) :
```html
      <div id="carousel" class="carousel"><!-- vignettes de pages injectées par carousel.js --></div>
```

- [ ] **Step 2 : `createCarousel` dans `carousel.js`**

Ajouter sous les helpers (Task 1) et sous `buildPageStatic` (Task 3, même fichier) :
```js
const THUMB = 72;   // diamètre d'une vignette (px)

// host : élément #carousel ; deps : sélection partagée + accès page active (comme l'arbre).
export function createCarousel({ host }, model, { selection, setSelection, getActivePage, setPage }) {
  // Construit une vignette (disque) pour la page d'index i.
  function thumb(page, i, active) {
    const cell = document.createElement('div');
    cell.className = 'caro-thumb' + (active ? ' active' : '');
    cell.title = page.name || `Page ${i + 1}`;
    const disk = document.createElement('div');
    disk.className = 'caro-disk';
    const mini = buildPageStatic(page, model.state.components || {});
    disk.appendChild(mini);                       // attaché : buildPageStatic a déjà mesuré/positionné
    mini.style.transformOrigin = 'top left';
    mini.style.transform = `scale(${THUMB / 360})`;
    cell.appendChild(disk);
    const cap = document.createElement('div');
    cap.className = 'caro-cap';
    cap.textContent = page.name || `Page ${i + 1}`;
    cell.appendChild(cap);
    cell.addEventListener('click', () => {
      setPage(i);                                 // active la page (re-render canvas) + vide la sélection
      setSelection({ kind: 'page', page: i });    // puis sélectionne la page (cohérent avec l'arbre)
    });
    return cell;
  }

  function render() {
    host.replaceChildren();
    const pages = model.state.pages || [];
    const act = getActivePage();
    const track = document.createElement('div');
    track.className = 'caro-track';
    pages.forEach((p, i) => track.appendChild(thumb(p, i, i === act)));
    host.appendChild(track);
  }

  model.subscribe(render);        // mutations : structure des pages + édition des composants (miniatures)
  selection.subscribe(render);    // changement de page active / sélection → surlignage
  render();
  if (document.fonts?.ready) document.fonts.ready.then(render);   // fidélité Montserrat (cf. canvas.js)
  return { render };
}
```

- [ ] **Step 3 : Instancier dans `app.js`**

Dans `designer/js/app.js`, après la création de l'arbre (`tree`, ligne ~159), ajouter :
```js
import { createCarousel } from './carousel.js';   // (en tête, avec les autres imports)

// … après `const tree = createTree(...)` :
createCarousel({ host: $('carousel') }, model, {
  selection, setSelection,
  getActivePage: canvas.getActivePage,
  setPage: i => canvas.setPage(i),
});
```

- [ ] **Step 4 : Styles dans `style.css`**

Ajouter à la fin de `designer/style.css` :
```css
/* --- Carousel de vignettes de pages (sous le hero disque) --- */
.carousel { width: 100%; margin-top: 14px; }
.caro-track { display: flex; align-items: flex-end; justify-content: center; gap: 18px;
  overflow: hidden; padding: 10px 2px 2px; }
.caro-thumb { display: flex; flex-direction: column; align-items: center; gap: 7px; cursor: pointer; flex: none; }
.caro-disk { width: 72px; height: 72px; border-radius: 50%; background: #000; border: 1px solid var(--line);
  overflow: hidden; position: relative; transition: transform .12s; }
.caro-thumb.active .caro-disk { transform: scale(1.10); border: 2px solid var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 0 18px rgba(167, 139, 250, .5); }
.caro-cap { font-size: 11.5px; color: var(--muted); max-width: 84px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.caro-thumb.active .caro-cap { color: var(--ink); font-weight: 600; }
.mini-stage { pointer-events: none; }   /* vignette non interactive (clic capté par .caro-thumb) */
```

- [ ] **Step 5 : Vérification navigateur**

Servir le designer (no-store, port ≠ 8000), ouvrir. Observer : une bande sous le disque, une vignette ronde par page reflétant le contenu réel (anneau/labels/barre), la page active agrandie (+10 %) avec halo et nom en clair. **Cliquer** une autre vignette → le canvas change de page ET la vignette active suit. Éditer un composant → la vignette correspondante se met à jour. Capturer un snapshot et l'envoyer.

- [ ] **Step 6 : Commit**

```bash
git add designer/js/carousel.js designer/js/app.js designer/index.html designer/style.css
git commit -m "carousel: bande de vignettes + surlignage actif + clic-navigation"
```

---

## Task 5 : Bouton « + page » (grisé à 8)

**Files:**
- Modify: `designer/js/carousel.js` (ajouter le bouton dans `render`)
- Modify: `designer/style.css` (style `.caro-add`)

- [ ] **Step 1 : Ajouter le bouton dans `render`**

Dans `carousel.js`, importer la mutation et l'ajouter après la boucle des vignettes, dans `render()` :
```js
import { addPage } from './mutations.js';
import { uniquePageName } from './mutations.js';   // si présent ; sinon nom simple (voir note)

// … dans render(), après pages.forEach(...) :
const add = document.createElement('button');
add.className = 'caro-add';
add.textContent = '+';
add.title = 'Ajouter une page';
add.disabled = !canAddPage(model.state);
add.addEventListener('click', () => {
  const name = uniquePageName(model.state, 'Page');   // évite les doublons (cf. arbre)
  let ni = -1;
  model.commit(s => { addPage(s, name); ni = s.pages.length - 1; });
  setPage(ni); setSelection({ kind: 'page', page: ni });
});
track.appendChild(add);
```
*Note : vérifier la signature de `uniquePageName` (importée par `tree.js:6`). Si elle diffère, reprendre exactement l'appel qu'utilise l'arbre pour « + Page » (`tree.js` `addBtn`).*

- [ ] **Step 2 : Style**

Dans `designer/style.css` :
```css
.caro-add { width: 72px; height: 72px; border-radius: 50%; border: 1px dashed #3a3a45;
  color: var(--muted); font-size: 22px; background: transparent; cursor: pointer; flex: none; }
.caro-add:hover:not(:disabled) { border-color: var(--accent); color: var(--ink); }
.caro-add:disabled { opacity: .32; cursor: default; }
```

- [ ] **Step 3 : Vérification navigateur**

Ajouter des pages via le « + » jusqu'à 8 → le bouton se grise à 8 pages ; chaque ajout crée une vignette et active la nouvelle page. Snapshot.

- [ ] **Step 4 : Commit**

```bash
git add designer/js/carousel.js designer/style.css
git commit -m "carousel: bouton + page (grisé à MAX_PAGES)"
```

---

## Task 6 : Flèches de défilement (grisées au repos)

**Files:**
- Modify: `designer/js/carousel.js` (flèches autour de la track + maj de leur état)
- Modify: `designer/style.css` (style `.caro-arrow`)

- [ ] **Step 1 : Structure flèches + logique**

Dans `carousel.js`, envelopper la track de deux boutons et recalculer leur état via `arrowState` (après rendu et au scroll). `render()` construit `[◀, track, ▶]` dans le host :
```js
function render() {
  host.replaceChildren();
  const pages = model.state.pages || [];
  const act = getActivePage();
  const left = document.createElement('button'); left.className = 'caro-arrow'; left.textContent = '◀';
  const right = document.createElement('button'); right.className = 'caro-arrow'; right.textContent = '▶';
  const track = document.createElement('div'); track.className = 'caro-track';
  pages.forEach((p, i) => track.appendChild(thumb(p, i, i === act)));
  // … bouton + page (Task 5) appended to track …
  const syncArrows = () => {
    const s = arrowState({ scrollLeft: track.scrollLeft, scrollWidth: track.scrollWidth, clientWidth: track.clientWidth });
    left.disabled = !s.left; right.disabled = !s.right;
  };
  left.addEventListener('click', () => { track.scrollBy({ left: -track.clientWidth * 0.8, behavior: 'smooth' }); });
  right.addEventListener('click', () => { track.scrollBy({ left:  track.clientWidth * 0.8, behavior: 'smooth' }); });
  track.addEventListener('scroll', syncArrows);
  host.append(left, track, right);
  syncArrows();                                  // état initial (après insertion : tailles connues)
}
```
*La track passe en `overflow-x` masqué (scroll programmatique via les flèches) — voir style.*

- [ ] **Step 2 : Style**

Dans `designer/style.css`, ajuster `.carousel` en flex et styliser les flèches :
```css
.carousel { width: 100%; margin-top: 14px; display: flex; align-items: center; gap: 12px; }
.caro-track { flex: 1; }   /* complète la règle existante (display:flex … overflow:hidden) */
.caro-arrow { flex: none; width: 30px; height: 30px; border-radius: 50%; background: transparent;
  border: 1px solid var(--line); color: var(--muted); font-size: 13px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; }
.caro-arrow:hover:not(:disabled) { border-color: var(--accent); color: var(--ink); }
.caro-arrow:disabled { opacity: .32; cursor: default; }
```

- [ ] **Step 3 : Vérification navigateur**

À 1-2 pages : les deux flèches grisées (pas de débordement). Élargir le nombre de pages (ou réduire la fenêtre) jusqu'au débordement → ▶ s'active ; cliquer fait défiler ; en fin de liste ▶ se grise et ◀ s'active. Snapshot d'un état débordé.

- [ ] **Step 4 : Commit**

```bash
git add designer/js/carousel.js designer/style.css
git commit -m "carousel: flèches de défilement (grisées au débordement via arrowState)"
```

---

## Task 7 : Réordonnancement par glisser-déposer

Drag d'une vignette → `reorderPages(state, from, to)`. Ordre naturel gauche→droite (pas d'inversion comme l'arbre), donc `to` = index de la vignette de dépôt.

**Files:**
- Modify: `designer/js/carousel.js` (HTML5 DnD sur les vignettes)
- Modify: `designer/style.css` (marqueurs de dépôt)

- [ ] **Step 1 : DnD sur les vignettes**

Dans `thumb()`, rendre la cellule draggable et câbler dragstart/dragover/drop. État de drag local au module (`let dragFrom = null;`) :
```js
cell.draggable = true;
cell.addEventListener('dragstart', e => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; });
cell.addEventListener('dragend', () => { dragFrom = null; clearDropMarks(); });
cell.addEventListener('dragover', e => {
  if (dragFrom === null || dragFrom === i) return;
  e.preventDefault();
  clearDropMarks();
  cell.classList.add('caro-drop');
});
cell.addEventListener('drop', e => {
  if (dragFrom === null || dragFrom === i) return;
  e.preventDefault();
  const from = dragFrom, to = i;
  model.commit(s => reorderPages(s, from, to));
  setPage(to); setSelection({ kind: 'page', page: to });
  dragFrom = null;
});
```
Ajouter en tête du module : `import { reorderPages } from './mutations.js';` et un helper :
```js
function clearDropMarks() {
  host.querySelectorAll('.caro-drop').forEach(n => n.classList.remove('caro-drop'));
}
```

- [ ] **Step 2 : Style marqueur de dépôt**

```css
.caro-thumb[draggable="true"] { cursor: grab; }
.caro-thumb.caro-drop .caro-disk { box-shadow: inset 0 0 0 2px var(--accent); }
```

- [ ] **Step 3 : Vérification navigateur**

Glisser une vignette sur une autre → l'ordre des pages change (vérifier dans l'arbre aussi : ordre synchronisé), la page déplacée devient active. Snapshot.

- [ ] **Step 4 : Commit**

```bash
git add designer/js/carousel.js designer/style.css
git commit -m "carousel: réordonnancement des pages par glisser-déposer"
```

---

## Task 8 : Menu contextuel + renommage inline

Clic-droit vignette → `openContextMenu` (Task 2) avec `contextMenuItems` pour la page survolée (Renommer/Dupliquer/Supprimer/Monter/Descendre). Renommage **inline** dans la légende.

**Files:**
- Modify: `designer/js/carousel.js` (clic-droit + runMenu + rename inline)

- [ ] **Step 1 : Clic-droit + actions**

Dans `carousel.js`, importer `import { contextMenuItems, openContextMenu } from './contextmenu.js';` et `import { duplicatePage, removePage, reorderPages, renamePage } from './mutations.js';`.

Dans `thumb()`, ajouter le clic-droit (sélectionner d'abord la page survolée, comme l'arbre) :
```js
cell.addEventListener('contextmenu', e => {
  e.preventDefault();
  setPage(i); setSelection({ kind: 'page', page: i });
  openContextMenu(e.clientX, e.clientY,
    contextMenuItems({ kind: 'page', page: i }, model.state, {}),
    (id) => runMenu(id, i));
});
```

Ajouter la fonction `runMenu(id, pi)` au module (calquée sur `tree.js:446-457`) :
```js
function runMenu(id, pi) {
  const total = () => model.state.pages.length;
  if (id === 'rename')   return beginRename(pi);
  if (id === 'duplicate'){ let ni = -1; model.commit(s => { ni = duplicatePage(s, pi); });
    if (ni >= 0) { setPage(ni); setSelection({ kind: 'page', page: ni }); } return; }
  if (id === 'delete')   { if (total() <= 1) return; model.commit(s => removePage(s, pi));
    setPage(Math.min(pi, model.state.pages.length - 1)); return; }
  if (id === 'moveUp')   { if (pi <= 0) return; model.commit(s => reorderPages(s, pi, pi - 1));
    setPage(pi - 1); setSelection({ kind: 'page', page: pi - 1 }); return; }
  if (id === 'moveDown') { if (pi >= total() - 1) return; model.commit(s => reorderPages(s, pi, pi + 1));
    setPage(pi + 1); setSelection({ kind: 'page', page: pi + 1 }); return; }
}
```

- [ ] **Step 2 : Renommage inline**

Ajouter `let renaming = null;` au module. Dans `render()`, si `renaming === i`, rendre un `<input>` à la place de la légende (mêmes gardes de doublon que l'arbre via `pageNameTaken`/`uniquePageName`). `beginRename(pi)` fait `renaming = pi; render();` et focus. Sur `change`/Entrée : `model.commit(s => renamePage(s, pi, value))` puis `renaming = null`. Reproduire le comportement de l'arbre (`tree.js` `beginRename` + champ `.tree-rename`) en classe `.caro-rename`.

```js
function beginRename(pi) { renaming = pi; render(); }
// dans thumb(), pour la légende :
if (renaming === i) {
  const inp = document.createElement('input'); inp.className = 'caro-rename'; inp.value = page.name || '';
  const commit = () => { const v = inp.value.trim(); renaming = null;
    if (v && v !== page.name) model.commit(s => renamePage(s, i, v)); else render(); };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { renaming = null; render(); } });
  cell.appendChild(inp); queueMicrotask(() => inp.focus());
} else { /* … cap normal … */ }
```
Style : `.caro-rename { width: 84px; font-size: 11.5px; }` (réutilise `input` global).

- [ ] **Step 3 : Vérification navigateur**

Clic-droit vignette → menu complet ; Renommer → champ inline, Entrée valide, doublon bloqué ; Dupliquer/Supprimer/Monter/Descendre fonctionnent et l'arbre reste synchronisé. Snapshot du menu ouvert.

- [ ] **Step 4 : Commit**

```bash
git add designer/js/carousel.js designer/style.css
git commit -m "carousel: menu contextuel + renommage inline (menu partagé)"
```

---

## Task 9 : Vérification d'ensemble + non-régression

**Files:** aucun (vérification).

- [ ] **Step 1 : Tests node complets**

Run: `cd designer && node --test`
Expected: PASS (carousel.test.js, tree.test.js recâblé, et tout le reste).

- [ ] **Step 2 : Vérification navigateur de bout en bout**

Servir, ouvrir, et vérifier en une passe : rendu fidèle des vignettes vs canvas, surlignage actif +10 %, navigation par clic, + page grisé à 8, flèches grisées/actives au débordement, drag-réordonner synchronisé avec l'arbre, menu + renommage. Vérifier aussi que **l'arbre** fonctionne toujours (clic-droit, drag, F2) — non-régression de l'extraction du menu. Capturer 2-3 snapshots et les envoyer.

- [ ] **Step 3 : Commit éventuel d'ajustements**

```bash
git add -A designer/
git commit -m "carousel: ajustements après vérification navigateur"
```

---

## Notes de fin

- **Push & merge** : non inclus (le push n'a lieu que sur demande explicite, cf. `CLAUDE.md`).
- **Dépendance DA #1 (scroll vertical)** : si traité en parallèle, ancrer la bande en bas d'un `#canvas-col` en flex column (zone disque scrollable, bande `flex:none`). Sinon la bande vit en bas du flux (v1 acceptable).
- **Perf** : re-render complet à chaque mutation (≤ 8 × ≤ 12 widgets). Optimiser seulement si une lenteur est *mesurée*.

## Self-review (effectuée)

- **Couverture spec** : rôle navigation (T4), rendu live (T3), look A + actif +10 % (T4), clic/drag/menu/+page (T4-T8), flèches au débordement (T6), présence fixe (T4 CSS), archi additive + menu partagé (T2) + mutations (T5-T8), tests (T1 node + vérifs navigateur). MAX_PAGES (T1/T5). ✔
- **Placeholders** : deux points signalés à vérifier à l'implémentation (signature `uniquePageName`, exactitude de l'appel « +Page » de l'arbre) — pointent vers un symbole existant précis, pas un TBD. Reste : code réel partout.
- **Cohérence des noms** : `setPage`/`getActivePage` (interface canvas vérifiée), `contextMenuItems`/`openContextMenu`/`closeContextMenu` (T2), `buildPageStatic(page, comps)` (T3 défini, T4 appelé), `canAddPage`/`arrowState`/`MAX_PAGES` (T1 défini, T5/T6 utilisés), `reorderPages`/`renamePage`/`duplicatePage`/`removePage`/`addPage` (signatures `mutations.js` vérifiées). ✔
