# Panneau Settings du designer (v1) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au designer un panneau Settings (tiroir latéral) qui regroupe et persiste des réglages d'édition : transparence des composants invisibles, grille + snap au pas, action « Nouveau » (layout vierge) et « Réinitialiser les réglages ».

**Architecture:** Un module neuf `settings.js` détient un store de préférences pur (défauts + normalisation/clamp) persisté en localStorage, plus le DOM du tiroir (calqué sur `drawer.js`). `applyVisualSettings` pose des variables CSS (`--ghost-opacity`, `--grid-step`) et une classe d'affichage de grille. Le snap-grille est une fonction pure `snapToStep` (geometry.js) insérée aux points drag/resize de `canvas.js`. `app.js` coordonne (init au boot, un seul tiroir ouvert, câblage Nouveau). 100 % designer : firmware/`render.js`/schéma intacts.

**Tech Stack:** JS modules ES (navigateur), tests `node --test` (cœur pur), CSS variables. Spec : `docs/superpowers/specs/2026-06-25-designer-panneau-settings-design.md`.

---

## Structure des fichiers

- **Créer** `designer/js/settings.js` — store de préférences (pur) + `applyVisualSettings` + `createSettings` (DOM du tiroir).
- **Créer** `designer/tests/settings.test.js` — tests du store pur.
- **Modifier** `designer/js/geometry.js` — ajout `snapToStep` (pur).
- **Modifier** `designer/tests/geometry.test.js` — tests `snapToStep`.
- **Modifier** `designer/js/canvas.js` — option `getGridSnap` + snap au drag et au resize générique.
- **Modifier** `designer/js/drawer.js` — hook `onOpen` (additif, pour « un seul tiroir »).
- **Modifier** `designer/index.html` — bouton toolbar `#settings-toggle`, tiroir `#settings-drawer`, overlay `#stage-grid`.
- **Modifier** `designer/style.css` — `--ghost-opacity`, grille, styles du panneau settings.
- **Modifier** `designer/js/app.js` — init settings au boot, montage `createSettings`, coordination tiroirs, `onNewLayout`, `getGridSnap` au canvas.

**Convention tests** (CLAUDE.md) : `cd designer && node --test` **sans argument**. DOM non testé node → vérifié au navigateur (servir en **no-store** depuis la **racine du repo**, cf. spec). Limite v1 assumée : seuls le **placement** (tous composants) et le **resize générique** (bar/chart/rect/image) sont snappés ; le diamètre d'un cercle / la longueur d'une droite ne le sont pas.

---

### Task 1: `snapToStep` (fonction pure de snap au pas)

**Files:**
- Modify: `designer/js/geometry.js`
- Test: `designer/tests/geometry.test.js`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter en bas de `designer/tests/geometry.test.js` (et ajouter `snapToStep` à l'`import` en tête du fichier) :

```js
import { snapToStep } from '../js/geometry.js';   // (ajouter au besoin si import groupé)

test('snapToStep désactivé → identité', () => {
  assert.equal(snapToStep(13, 8, false), 13);
});

test('snapToStep step<=0 → identité (garde-fou)', () => {
  assert.equal(snapToStep(13, 0, true), 13);
});

test('snapToStep arrondit au pas le plus proche', () => {
  assert.equal(snapToStep(11, 8, true), 8);    // 1.375 → 1 → 8
  assert.equal(snapToStep(12, 8, true), 16);   // 1.5 → 2 → 16
  assert.equal(snapToStep(13, 8, true), 16);   // 1.625 → 2 → 16
});

test('snapToStep gère les négatifs', () => {
  assert.equal(snapToStep(-5, 4, true), -4);   // round(-1.25) = -1 → -4
});
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL (`snapToStep is not a function` / export manquant).

- [ ] **Step 3: Implémenter `snapToStep`**

Ajouter à `designer/js/geometry.js` (après `snapPlacement`, vers la ligne 43) :

```js
// Snap au PAS de grille — distinct de snapPlacement (qui snappe aux 9 ANCRES).
// enabled=false ou step<=0 → identité ; sinon arrondi au multiple de step le plus proche.
export function snapToStep(v, step, enabled) {
  if (!enabled || !(step > 0)) return v;
  return Math.round(v / step) * step;
}
```

- [ ] **Step 4: Lancer les tests pour vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS (tous les tests, dont les 4 nouveaux).

- [ ] **Step 5: Commit**

```bash
git add designer/js/geometry.js designer/tests/geometry.test.js
git commit -m "feat(designer): snapToStep — snap au pas de grille (pur, testé)

Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

### Task 2: Store de préférences (`settings.js` — partie pure)

**Files:**
- Create: `designer/js/settings.js`
- Test: `designer/tests/settings.test.js`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `designer/tests/settings.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, normalizeSettings } from '../js/settings.js';

test('defaultSettings: valeurs de référence', () => {
  assert.deepEqual(defaultSettings(), { ghostOpacity: 0.38, gridShow: false, gridSnap: false, gridStep: 8 });
});

test('normalizeSettings: entrée vide/nulle → défauts', () => {
  assert.deepEqual(normalizeSettings(null), defaultSettings());
  assert.deepEqual(normalizeSettings(undefined), defaultSettings());
  assert.deepEqual(normalizeSettings('garbage'), defaultSettings());
});

test('normalizeSettings: clamp opacité hors bornes', () => {
  assert.equal(normalizeSettings({ ghostOpacity: 2 }).ghostOpacity, 1);
  assert.equal(normalizeSettings({ ghostOpacity: -1 }).ghostOpacity, 0);
  assert.equal(normalizeSettings({ ghostOpacity: 'x' }).ghostOpacity, 0.38);
});

test('normalizeSettings: gridStep contraint à {4,8,16}', () => {
  assert.equal(normalizeSettings({ gridStep: 5 }).gridStep, 8);
  assert.equal(normalizeSettings({ gridStep: 16 }).gridStep, 16);
});

test('normalizeSettings: champ partiel mergé sur les défauts', () => {
  const r = normalizeSettings({ gridShow: true });
  assert.equal(r.gridShow, true);
  assert.equal(r.gridSnap, false);
  assert.equal(r.gridStep, 8);
});
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL (`Cannot find module '../js/settings.js'`).

- [ ] **Step 3: Implémenter le store pur**

Créer `designer/js/settings.js` avec **uniquement** le store (le DOM viendra en Task 4) :

```js
// Réglages d'édition du designer : store pur (défauts + normalisation/clamp), persistance
// localStorage, application des variables CSS. Le DOM du tiroir est ajouté en bas (createSettings).
// Pur testé node ; load/save/apply touchent localStorage/DOM (non testés node, cf. convention).
const KEY = 'rt-designer-settings';
const STEPS = [4, 8, 16];

export function defaultSettings() {
  return { ghostOpacity: 0.38, gridShow: false, gridSnap: false, gridStep: 8 };
}

export function normalizeSettings(raw) {
  const d = defaultSettings();
  const r = (raw && typeof raw === 'object') ? raw : {};
  const op = Number(r.ghostOpacity);
  return {
    ghostOpacity: Number.isFinite(op) ? Math.min(1, Math.max(0, op)) : d.ghostOpacity,
    gridShow: typeof r.gridShow === 'boolean' ? r.gridShow : d.gridShow,
    gridSnap: typeof r.gridSnap === 'boolean' ? r.gridSnap : d.gridSnap,
    gridStep: STEPS.includes(r.gridStep) ? r.gridStep : d.gridStep,
  };
}

export function loadSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(KEY))); }
  catch (e) { return defaultSettings(); }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
}
```

- [ ] **Step 4: Lancer les tests pour vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add designer/js/settings.js designer/tests/settings.test.js
git commit -m "feat(designer): store de préférences settings (pur, testé) + load/save localStorage

Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

### Task 3: Markup + CSS (tiroir, bouton, grille, variable d'opacité) + `applyVisualSettings`

**Files:**
- Modify: `designer/index.html`
- Modify: `designer/style.css`
- Modify: `designer/js/settings.js` (ajout `applyVisualSettings`)

> Pas de test node (DOM/CSS). Vérification au navigateur en fin de tâche.

- [ ] **Step 1: Ajouter le bouton toolbar (icône curseurs)**

Dans `designer/index.html`, juste **après** le groupe `<!-- Tiroir Device -->` (le `tb-group` de `#drawer-toggle`) et **avant** `<span class="grow"></span>` :

```html
    <!-- Réglages -->
    <div class="tb-group">
      <button id="settings-toggle" class="tb-btn" type="button" data-tip="Réglages" title="Réglages du designer (transparence, grille, snap…)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h6M11 4h3M2 8h3M8 8h6M2 12h8M13 12h1"/><circle cx="9.5" cy="4" r="1.6"/><circle cx="6.5" cy="8" r="1.6"/><circle cx="11.5" cy="12" r="1.6"/></svg></button>
    </div>
```

- [ ] **Step 2: Ajouter l'overlay grille dans le stage**

Dans `designer/index.html`, dans `#stage`, après `<div class="screen-circle"></div>` :

```html
        <div id="stage" class="stage">
          <div class="screen-circle"></div>
          <div id="stage-grid" aria-hidden="true"></div>
        </div>
```

- [ ] **Step 3: Ajouter le tiroir Settings**

Dans `designer/index.html`, **après** le tiroir Device (`</aside>` qui ferme `#drawer`) et **avant** `<div id="shot-overlay" …>` :

```html
  <aside id="settings-drawer" class="drawer" hidden>
    <div class="drawer-backdrop"></div>
    <div class="drawer-panel" role="dialog" aria-label="Réglages">
      <div class="drawer-head">
        <h2>Réglages</h2>
        <button class="drawer-close" type="button" title="Fermer">✕</button>
      </div>
      <div id="settings-pane" class="drawer-pane">
        <div id="settings" class="settings-panel"></div>
      </div>
    </div>
  </aside>
```

- [ ] **Step 4: CSS — variable d'opacité fantôme**

Dans `designer/style.css`, dans `:root` (après `--accent-soft`), ajouter :

```css
  --ghost-opacity: .38;       /* opacité d'aperçu des composants visible:false (réglable via Settings) */
```

Puis remplacer la règle existante `.w.hidden { opacity: .38; }` (vers la ligne 250) par :

```css
.w.hidden { opacity: var(--ghost-opacity); }
```

- [ ] **Step 5: CSS — grille + panneau settings**

Ajouter à `designer/style.css` (par exemple près des règles `.drawer*`) :

```css
/* Grille d'alignement (overlay dans #stage, scalée avec le zoom ; clip au disque). */
#stage-grid {
  position: absolute; inset: 0; border-radius: 50%; pointer-events: none; display: none;
  background-image:
    linear-gradient(to right, var(--accent-soft) 1px, transparent 1px),
    linear-gradient(to bottom, var(--accent-soft) 1px, transparent 1px);
  background-size: var(--grid-step, 8px) var(--grid-step, 8px);
}
.grid-on #stage-grid { display: block; }

/* Panneau Settings (dans le tiroir, réutilise .drawer*). */
.settings-panel { display: flex; flex-direction: column; gap: 14px; }
.set-row { display: flex; flex-direction: column; gap: 4px; }
.set-row > label { font-size: 11px; color: var(--text-label); }
.set-line { display: flex; align-items: center; gap: 8px; }
.set-line input[type=range] { flex: 1; accent-color: var(--accent); }
.set-val { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); min-width: 30px; text-align: right; }
.set-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; border-top: 1px solid var(--line); padding-top: 12px; }
.set-btn { background: var(--panel-2); border: 1px solid var(--line); color: var(--ink); border-radius: 4px; padding: 7px 10px; cursor: pointer; font-size: 12px; text-align: left; }
.set-btn:hover { border-color: var(--border-2); }
.set-btn.confirm { border-color: var(--warn); color: var(--warn); }
```

- [ ] **Step 6: Ajouter `applyVisualSettings` à `settings.js`**

Ajouter à `designer/js/settings.js` (après `saveSettings`) :

```js
// Applique les réglages VISUELS au DOM : variable d'opacité (racine) + classe/pas de grille (stage).
export function applyVisualSettings(s) {
  document.documentElement.style.setProperty('--ghost-opacity', String(s.ghostOpacity));
  const wrap = document.getElementById('stage-wrap');
  if (wrap) {
    wrap.classList.toggle('grid-on', s.gridShow);
    wrap.style.setProperty('--grid-step', s.gridStep + 'px');
  }
}
```

- [ ] **Step 7: Vérifier le build JS (parse)**

Run: `cd designer && node --check js/settings.js && node --test`
Expected: aucun output de `node --check` (OK) ; tests toujours PASS (rien de cassé).

- [ ] **Step 8: Commit**

```bash
git add designer/index.html designer/style.css designer/js/settings.js
git commit -m "feat(designer): markup tiroir Settings + bouton + overlay grille + applyVisualSettings

Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

### Task 4: `createSettings` (contrôles du tiroir) + hook `onOpen` du drawer

**Files:**
- Modify: `designer/js/settings.js` (ajout `createSettings`)
- Modify: `designer/js/drawer.js` (hook `onOpen`)

> Pas de test node (DOM). Vérification au navigateur après le câblage (Task 6).

- [ ] **Step 1: Hook `onOpen` dans `drawer.js`**

Remplacer dans `designer/js/drawer.js` la signature et les fonctions `open`/`toggle` :

```js
export function createDrawer(root, { toggleBtn, onOpen }) {
```

et

```js
  const open = () => { onOpen && onOpen(); root.hidden = false; };
  const close = () => { root.hidden = true; };
  const toggle = () => { root.hidden ? open() : close(); };
```

(le reste de `createDrawer` inchangé ; `onOpen` n'est appelé qu'à l'ouverture, rétrocompatible.)

- [ ] **Step 2: Ajouter `createSettings` à `settings.js`**

Ajouter en bas de `designer/js/settings.js` :

```js
// --- DOM du tiroir Settings (vérifié au navigateur ; pas de test node, cf. convention). ---
function settingRow(labelText) {
  const row = document.createElement('div'); row.className = 'set-row';
  const label = document.createElement('label'); label.textContent = labelText;
  const line = document.createElement('div'); line.className = 'set-line';
  row.append(label, line);
  return row;
}
function checkbox(checked, onChange) {
  const c = document.createElement('input'); c.type = 'checkbox'; c.checked = checked;
  c.onchange = () => onChange(c.checked);
  return c;
}
// Confirmation inline : 1er clic arme (« Confirmer ? » 3 s), 2e clic exécute. Pas de dialog natif.
function withConfirm(btn, action) {
  const orig = btn.textContent; let armed = false, t = null;
  btn.onclick = () => {
    if (!armed) {
      armed = true; btn.textContent = 'Confirmer ?'; btn.classList.add('confirm');
      t = setTimeout(() => { armed = false; btn.textContent = orig; btn.classList.remove('confirm'); }, 3000);
      return;
    }
    clearTimeout(t); armed = false; btn.textContent = orig; btn.classList.remove('confirm'); action();
  };
}

export function createSettings(root, { toggleBtn, onOpen, getSettings, setSettings, onNewLayout }) {
  const backdrop = root.querySelector('.drawer-backdrop');
  const closeBtn = root.querySelector('.drawer-close');
  const pane = root.querySelector('#settings');

  const open = () => { onOpen && onOpen(); root.hidden = false; };
  const close = () => { root.hidden = true; };
  const toggle = () => { root.hidden ? open() : close(); };
  toggleBtn.onclick = toggle;
  closeBtn.onclick = close;
  backdrop.onclick = close;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });

  function build() {
    const s = getSettings();
    pane.replaceChildren();   // vide le panneau (équivalent sûr de innerHTML='')

    // Transparence des invisibles
    const opRow = settingRow('Transparence des invisibles');
    const op = document.createElement('input');
    op.type = 'range'; op.min = '0'; op.max = '1'; op.step = '0.02'; op.value = String(s.ghostOpacity);
    const opVal = document.createElement('span'); opVal.className = 'set-val'; opVal.textContent = s.ghostOpacity.toFixed(2);
    op.oninput = () => { opVal.textContent = Number(op.value).toFixed(2); setSettings({ ghostOpacity: Number(op.value) }); };
    opRow.querySelector('.set-line').append(op, opVal);
    pane.appendChild(opRow);

    // Afficher la grille
    const gridRow = settingRow('Afficher la grille');
    gridRow.querySelector('.set-line').appendChild(checkbox(s.gridShow, v => setSettings({ gridShow: v })));
    pane.appendChild(gridRow);

    // Aimanter (snap)
    const snapRow = settingRow('Aimanter au pas (snap)');
    snapRow.querySelector('.set-line').appendChild(checkbox(s.gridSnap, v => setSettings({ gridSnap: v })));
    pane.appendChild(snapRow);

    // Pas de la grille
    const stepRow = settingRow('Pas de la grille');
    const step = document.createElement('select');
    for (const v of [4, 8, 16]) {
      const o = document.createElement('option'); o.value = String(v); o.textContent = v + ' px';
      if (v === s.gridStep) o.selected = true; step.appendChild(o);
    }
    step.onchange = () => setSettings({ gridStep: Number(step.value) });
    stepRow.querySelector('.set-line').appendChild(step);
    pane.appendChild(stepRow);

    // Actions
    const actions = document.createElement('div'); actions.className = 'set-actions';
    const neww = document.createElement('button'); neww.className = 'set-btn'; neww.type = 'button'; neww.textContent = 'Nouveau (layout vierge)';
    withConfirm(neww, () => onNewLayout && onNewLayout());
    const reset = document.createElement('button'); reset.className = 'set-btn'; reset.type = 'button'; reset.textContent = 'Réinitialiser les réglages';
    reset.onclick = () => { setSettings(defaultSettings()); build(); };   // reconstruit pour resync les contrôles
    actions.append(neww, reset);
    pane.appendChild(actions);
  }

  build();
  return { open, close, toggle };
}
```

- [ ] **Step 3: Vérifier le parse**

Run: `cd designer && node --check js/settings.js && node --check js/drawer.js && node --test`
Expected: pas d'erreur de parse ; tests PASS.

- [ ] **Step 4: Commit**

```bash
git add designer/js/settings.js designer/js/drawer.js
git commit -m "feat(designer): createSettings (contrôles du tiroir) + hook onOpen du drawer

Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

### Task 5: Snap-grille dans le canvas

**Files:**
- Modify: `designer/js/canvas.js`

> Pas de test node (interaction DOM). Le cœur (`snapToStep`) est déjà testé (Task 1). Vérif navigateur en Task 6.

- [ ] **Step 1: Importer `snapToStep`**

Dans `designer/js/canvas.js`, ajouter `snapToStep` à l'import depuis `./geometry.js` (lignes 3-6) :

```js
import {
  snapPlacement, placeAt, resizeBox, anchorGuide, parentPoint, ANCHORS,
  ringRadiusAt, ringThicknessAt, gapDegAt, cornersOutsideCircle, SCREEN, snapToStep
} from './geometry.js';
```

- [ ] **Step 2: Ajouter l'option `getGridSnap`**

Remplacer la signature de `createCanvas` (ligne 57) :

```js
export function createCanvas({ stage }, model, { selection, setSelection, onLiveMove, getGridSnap = () => ({ snap: false, step: 8 }) } = {}) {
```

- [ ] **Step 3: Snapper le placement pendant le drag**

Dans `onPointerDown`, remplacer la ligne `live = snapPlacement(x, y, w, h, 16);` (ligne 166) par :

```js
      live = snapPlacement(x, y, w, h, 16);
      const gs = getGridSnap();
      if (gs.snap && !live.snapped) {            // pas déjà collé à une ancre
        live.dx = snapToStep(live.dx, gs.step, true);
        live.dy = snapToStep(live.dy, gs.step, true);
      }
```

- [ ] **Step 4: Snapper la taille au resize générique**

Dans `addResizeHandles`, remplacer la ligne `dim = resizeBox(startW, startH, dx, dy, 8);` (ligne 213) par :

```js
          dim = resizeBox(startW, startH, dx, dy, 8);
          const gs = getGridSnap();
          if (gs.snap) {
            dim = {
              width: Math.max(8, snapToStep(dim.width, gs.step, true)),
              height: Math.max(8, snapToStep(dim.height, gs.step, true)),
            };
          }
```

- [ ] **Step 5: Vérifier le parse**

Run: `cd designer && node --check js/canvas.js && node --test`
Expected: pas d'erreur ; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add designer/js/canvas.js
git commit -m "feat(designer): snap-grille au placement (tous) et au resize générique (bar/chart/rect/image)

Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

### Task 6: Câblage `app.js` (boot, montage, coordination, Nouveau)

**Files:**
- Modify: `designer/js/app.js`

> Tâche d'intégration. Vérification au navigateur (étape finale).

- [ ] **Step 1: Imports**

Ajouter en tête de `designer/js/app.js` (avec les autres imports) :

```js
import { loadSettings, saveSettings, normalizeSettings, applyVisualSettings, createSettings } from './settings.js';
import { DEFAULT_LAYOUT } from './default-layout.js';
```

- [ ] **Step 2: Init du store au boot**

Après `model.subscribe(() => { … SAVE_KEY … });` (vers la ligne 63), ajouter :

```js
  // Réglages d'édition (persistés). settingsState est lu par le canvas (snap) et le tiroir.
  let settingsState = loadSettings();
  applyVisualSettings(settingsState);
  const getSettings = () => settingsState;
  const setSettings = (partial) => {
    settingsState = normalizeSettings({ ...settingsState, ...partial });
    saveSettings(settingsState);
    applyVisualSettings(settingsState);
  };
```

- [ ] **Step 3: Passer `getGridSnap` au canvas**

Dans l'appel `createCanvas(...)` (ligne 89), ajouter l'option :

```js
  const canvas = createCanvas({ stage: $('stage') }, model, {
    selection, setSelection,
    onLiveMove: p => inspector.setLivePlacement(p),
    getGridSnap: () => ({ snap: settingsState.gridSnap, step: settingsState.gridStep })
  });
```

- [ ] **Step 4: Coordonner les deux tiroirs + monter Settings**

Remplacer la ligne `const drawer = createDrawer($('drawer'), { toggleBtn: $('drawer-toggle') });` (ligne 186) par :

```js
  const drawer = createDrawer($('drawer'), { toggleBtn: $('drawer-toggle'), onOpen: () => settings.close() });
  const settings = createSettings($('settings-drawer'), {
    toggleBtn: $('settings-toggle'),
    onOpen: () => drawer.close(),                 // un seul tiroir ouvert à la fois
    getSettings, setSettings,
    onNewLayout: () => {                           // layout vierge (undoable : loadJSON snapshot)
      model.loadJSON(JSON.stringify(DEFAULT_LAYOUT));
      canvas.setPage(0); tree.render(); setSelection(null);
    },
  });
```

(`onOpen: () => settings.close()` référence `settings` avant sa déclaration : OK, c'est une closure appelée au clic, comme `openDrawer: () => drawer.open()` ligne 100.)

- [ ] **Step 5: Vérifier le parse + suite de tests**

Run: `cd designer && node --check js/app.js && node --test`
Expected: pas d'erreur de parse ; **tous** les tests PASS.

- [ ] **Step 6: Vérification au navigateur**

Servir en no-store depuis la **racine du repo** (cf. spec/HANDOFF), ouvrir le designer, et vérifier :
1. Le bouton **curseurs** ouvre le tiroir Settings ; ✕/backdrop/**Échap** le ferment.
2. **Un seul tiroir** : ouvrir Settings ferme le tiroir Device, et inversement.
3. **Transparence** : bouger le curseur change l'opacité d'un composant `visible:false` en direct (le rendre invisible via l'œil pour le voir grisé).
4. **Grille** : la case « Afficher la grille » montre/masque la grille ; le select de pas (4/8/16) change l'espacement ; la grille suit le zoom.
5. **Snap** : case « Aimanter » cochée → déplacer un composant aligne `dx/dy` au pas ; redimensionner une barre aligne la taille au pas.
6. **Nouveau** : 1er clic → « Confirmer ? » ; 2e clic → layout vierge (page 0, rien de sélectionné) ; Ctrl+Z restaure.
7. **Réinitialiser les réglages** : remet opacité .38, grille/snap OFF, pas 8 ; les contrôles se resynchronisent.
8. **Persistance** : recharger la page conserve les réglages.

- [ ] **Step 7: Commit**

```bash
git add designer/js/app.js
git commit -m "feat(designer): câblage du panneau Settings (boot, un seul tiroir, snap canvas, Nouveau)

Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

## Self-review (couverture spec)

- **Panneau (tiroir + persistance)** → Task 3 (markup/CSS) + Task 4 (`createSettings`) + Task 6 (montage, `loadSettings`/`saveSettings`). ✓
- **Transparence des invisibles** → Task 3 (`--ghost-opacity`, `.w.hidden`) + Task 4 (curseur) + Task 2 (clamp). ✓
- **Grille + snap au pas** → Task 1 (`snapToStep`) + Task 3 (overlay/CSS) + Task 5 (insertion drag/resize) + Task 4 (toggles + pas). ✓
- **Nouveau / Réinitialiser layout** → Task 4 (`withConfirm`) + Task 6 (`onNewLayout`, `DEFAULT_LAYOUT`). ✓
- **Réinitialiser les réglages** → Task 4 (bouton reset + `build()` resync). ✓
- **Un seul tiroir** → Task 4 (`onOpen`) + Task 6 (câblage croisé). ✓
- **Parité/firmware intacts** → aucune tâche ne touche `src/`, `lib/`, `schema/`, `js/render.js`. ✓

**Cohérence des types/noms** : `snapToStep(v, step, enabled)` (T1, T5) ; store `{ ghostOpacity, gridShow, gridSnap, gridStep }` partout (T2, T4, T6) ; `getGridSnap() → { snap, step }` (T5 défaut, T6 fourniture) ; `createSettings(root, { toggleBtn, onOpen, getSettings, setSettings, onNewLayout })` (T4 def, T6 appel) ; `createDrawer(root, { toggleBtn, onOpen })` (T4 mod, T6 appel). Cohérent.

**Hors-scope (rappel)** : densité/échelle UI, thèmes multiples, garde-fous destructifs (Pousser/Pull/suppression page), smart guides. Limite v1 : circle-diamètre / line-longueur non snappés.
