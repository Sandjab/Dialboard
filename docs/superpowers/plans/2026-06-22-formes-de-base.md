# Formes de base (rect / circle / line) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter trois composants décoratifs (`rect`, `circle`, `line`) à Dialboard, éditables dans le designer et rendus par le firmware, sans donnée ni binding.

**Architecture:** On suit le pattern table-driven existant. Designer : une entrée dans le registre (`registry.js`) pilote palette/inspecteur/aperçu ; aperçu DOM dans `render.js`. Firmware : un enum `CompType`, une ligne dans la table noms→type (parse) et dans la vtable `{build, sync}` (rendu), `sync=nullptr` (statique). Le schéma JSON est le contrat partagé ; deux tests de conformité (designer + natif) garantissent la parité d'énumération.

**Tech Stack:** JS modules ES (designer, tests `node --test`), C++/Arduino + LVGL 9.5 (firmware, tests Unity `env:native`), JSON Schema draft-07.

**Décisions de conception (verrouillées, cf. spec `docs/superpowers/specs/2026-06-22-formes-de-base-design.md` + raffinements de planification) :**
- Géométrie sur le **placement** (réutilise `width`/`height`/`radius`/`size`/`thickness` déjà présents) ; aucune clé de placement neuve.
- `line` = **séparateur H/V** : `orientation` (composant, réutilise `bar_vertical` parsé génériquement), longueur = `placement.width`, épaisseur = `placement.thickness`.
- `fill` **optionnel** (absent ⇒ pas de fond) ; `border_width` 0 ⇒ pas de contour.
- `dash` = présets `solid`/`dashed`/`dotted` (le pointillé LVGL ne marche que sur lignes H/V — sans objet ici).
- **Pas de poignées de resize canvas** pour les formes en v1 (géométrie via champs num de l'inspecteur ; re-render live). Déviation assumée vs spec (« poignées ») — à reprendre en suivi si voulu.
- `lv_line_set_points` **conserve le pointeur** (vérifié Context7) → tableau de points **persistant** côté `view.cpp` (`s_line_pts[MAX_PAGES][MAX_PLACEMENTS_PER_PAGE][2]`, indexé par page/placement courants).

---

## File Structure

**Schéma (contrat partagé) :**
- Modify: `schema/layout.schema.json` — 3 `$defs` (`comp_rect`, `comp_circle`, `comp_line`) + 3 refs dans `component.oneOf`.

**Designer :**
- Modify: `designer/js/render.js` — `buildRect`, `buildCircle`, `buildLine` (+ `DASH_CSS`).
- Modify: `designer/js/registry.js` — import des builders + 3 entrées `COMPONENTS`.
- Modify: `designer/js/icons.js` — 3 glyphes dans `PATHS`.
- Modify: `designer/js/inspector.js` — éditeur `dash` (table `SELECTS`), champ bespoke `fill` (case + couleur), garde du swap d'orientation (bar uniquement).
- Modify: `designer/tests/registry.test.js` — assertions défauts/champs des 3 types.
- Modify: `designer/tests/validate.test.js` — un layout shapes valide + un invalide.

**Firmware :**
- Modify: `src/dashboard.h` — `COMP_RECT/CIRCLE/LINE` (enum), `enum LineDash`, champs struct (`fill_set`, `fill`, `border_color`, `border_width`, `line_dash`, `line_rounded`).
- Modify: `src/dashboard.cpp` — table `COMP_NAMES` (3), `parse_line_dash`, parsing des champs, `apply_shape` (no-op) ×3 dans `APPLY`.
- Modify: `src/view.cpp` — `build_rect/circle/line`, 3 entrées vtable (`sync=nullptr`), buffer `s_line_pts` + indices `s_cur_page/s_cur_place`.
- Modify: `src/lv_conf.h` — `#define LV_USE_LINE 1`.
- Modify: `test/test_core/test_main.cpp` — `test_shapes_parsed` + enregistrement `RUN_TEST`.

---

## Task 1 : Schéma + registre designer + aperçu + icônes

Tout dans une tâche : le test de conformité `registry.test.js` exige `registre == schéma`, et `registry.js` importe les builders de `render.js` (l'import casse si absents). On garde donc `node --test` vert au commit.

**Files:**
- Modify: `schema/layout.schema.json`
- Modify: `designer/js/render.js`
- Modify: `designer/js/registry.js`
- Modify: `designer/js/icons.js`
- Modify: `designer/tests/registry.test.js`
- Modify: `designer/tests/validate.test.js`

- [ ] **Step 1 : Écrire les tests (designer) qui échouent**

Dans `designer/tests/registry.test.js`, ajouter en fin de fichier :

```js
test('registre : rect/circle/line déclarés, statiques, non physiques', () => {
  for (const t of ['rect', 'circle', 'line']) {
    assert.ok(COMPONENTS[t], `${t} absent du registre`);
    assert.equal(COMPONENTS[t].physical, false);
    assert.equal(COMPONENTS[t].centered, false);
    assert.deepEqual(COMPONENTS[t].mockFields, [], `${t} : pas de mock (statique)`);
  }
});

test('registre : rect/circle exposent fill + contour', () => {
  for (const t of ['rect', 'circle']) {
    const keys = COMPONENTS[t].compFields.map(f => f[0]);
    assert.ok(keys.includes('fill'), `${t} : fill manquant`);
    assert.ok(keys.includes('border_width'), `${t} : border_width manquant`);
    assert.ok(keys.includes('border_color'), `${t} : border_color manquant`);
  }
  // rect : rayon de coin en géométrie (placement) ; circle : diamètre.
  assert.ok(COMPONENTS.rect.placeFields.map(f => f[0]).includes('radius'));
  assert.ok(COMPONENTS.circle.placeFields.map(f => f[0]).includes('size'));
});

test('registre : line expose color/orientation/dash/rounded et longueur/épaisseur', () => {
  const cf = COMPONENTS.line.compFields.map(f => f[0]);
  for (const k of ['color', 'orientation', 'dash', 'rounded']) assert.ok(cf.includes(k), `line : ${k} manquant`);
  const pf = COMPONENTS.line.placeFields.map(f => f[0]);
  assert.ok(pf.includes('width'));      // longueur
  assert.ok(pf.includes('thickness'));  // épaisseur
  assert.equal(COMPONENTS.line.defaults().dash, 'solid');
  assert.equal(COMPONENTS.line.defaults().orientation, 'horizontal');
});
```

Dans `designer/tests/validate.test.js`, ajouter en fin de fichier :

```js
test('layout avec formes (rect/circle/line) est valide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.r1 = { type: 'rect', fill: '#FF0000', border_width: 2, border_color: '#FFFFFF' };
  l.components.c1 = { type: 'circle' };                                   // fill absent = pas de fond, ok
  l.components.l1 = { type: 'line', color: '#FFFFFF', orientation: 'vertical', dash: 'dashed', rounded: true };
  l.pages[0].place.push(
    { ref: 'r1', anchor: 'CENTER', dx: 0, dy: 0, width: 120, height: 60, radius: 8 },
    { ref: 'c1', anchor: 'CENTER', dx: 0, dy: 0, size: 60 },
    { ref: 'l1', anchor: 'CENTER', dx: 0, dy: 0, width: 100, thickness: 2 },
  );
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('propriété inconnue sur une forme → invalide (additionalProperties:false)', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.r1 = { type: 'rect', wat: 1 };
  l.pages[0].place.push({ ref: 'r1', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `COMPONENTS.rect` est `undefined` (registre) ; les imports de `registry.js` peuvent aussi casser à l'étape suivante. (À ce stade, échec attendu sur les nouveaux tests.)

- [ ] **Step 3 : Ajouter les 3 `$defs` au schéma**

Dans `schema/layout.schema.json`, ajouter à `component.oneOf` (après `{ "$ref": "#/$defs/comp_led" }`) :

```json
        { "$ref": "#/$defs/comp_rect" },
        { "$ref": "#/$defs/comp_circle" },
        { "$ref": "#/$defs/comp_line" },
```

Et ajouter ces 3 `$defs` dans l'objet `$defs` (à côté de `comp_led`) :

```json
    "comp_rect": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "description": "Rectangle décoratif (lv_obj stylé). Aucune donnée. Géométrie sur le placement : width/height + radius (rayon de coin). Le contour est toujours plein (LVGL ne pointille pas les bordures d'objet).",
      "properties": {
        "type": { "const": "rect" },
        "visible": { "type": "boolean", "description": "Affiche le composant (defaut true). false = cache (LV_OBJ_FLAG_HIDDEN). Pilotable via /update {\"<id>\":{\"visible\":true}}." },
        "fill": { "$ref": "#/$defs/hexColor", "description": "Couleur de fond (bg_color). Absent = pas de fond (contour seul)." },
        "border_color": { "$ref": "#/$defs/hexColor", "description": "Couleur du contour (border_color). Ignorée si border_width 0. Defaut #FFFFFF." },
        "border_width": { "type": "integer", "minimum": 0, "description": "Épaisseur du contour en px. 0 = pas de contour. Defaut 0." }
      }
    },
    "comp_circle": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "description": "Cercle décoratif (lv_obj carré + radius LV_RADIUS_CIRCLE). Diamètre via placement.size. Mêmes options de fond/contour que rect.",
      "properties": {
        "type": { "const": "circle" },
        "visible": { "type": "boolean", "description": "Affiche le composant (defaut true). false = cache (LV_OBJ_FLAG_HIDDEN). Pilotable via /update." },
        "fill": { "$ref": "#/$defs/hexColor", "description": "Couleur de fond. Absent = pas de fond (contour seul)." },
        "border_color": { "$ref": "#/$defs/hexColor", "description": "Couleur du contour. Ignorée si border_width 0. Defaut #FFFFFF." },
        "border_width": { "type": "integer", "minimum": 0, "description": "Épaisseur du contour en px. 0 = pas de contour. Defaut 0." }
      }
    },
    "comp_line": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "description": "Droite décorative (lv_line) horizontale ou verticale. Longueur = placement.width, épaisseur = placement.thickness. Le pointillé (dash) n'est rendu que sur les lignes H/V — toujours le cas ici.",
      "properties": {
        "type": { "const": "line" },
        "visible": { "type": "boolean", "description": "Affiche le composant (defaut true). false = cache (LV_OBJ_FLAG_HIDDEN). Pilotable via /update." },
        "color": { "$ref": "#/$defs/hexColor", "description": "Couleur du trait (line_color). Defaut #FFFFFF." },
        "orientation": { "enum": ["horizontal", "vertical"], "description": "Sens du séparateur. Defaut horizontal. (réutilise le parsing orientation de bar)" },
        "dash": { "enum": ["solid", "dashed", "dotted"], "description": "Motif du trait (line_dash_width/gap). Defaut solid." },
        "rounded": { "type": "boolean", "description": "Bouts arrondis (line_rounded). Defaut false." }
      }
    },
```

- [ ] **Step 4 : Ajouter les builders d'aperçu dans `render.js`**

Dans `designer/js/render.js`, ajouter après `buildLed` (fin du fichier). `DASH_CSS` mappe les présets sur les styles de bordure CSS (parité « suffisante » : aspect, pas longueurs exactes) :

```js
// --- Formes de base (décoratives, statiques). bg/border CSS ↔ lv_obj ; bordure DANS la box (box-sizing). ---
const DASH_CSS = { solid: 'solid', dashed: 'dashed', dotted: 'dotted' };

export function buildRect(comp, placement) {
  const n = document.createElement('div');
  n.className = 'w w-rect';
  n.style.boxSizing = 'border-box';                       // bordure incluse dans w×h (parité lv_obj)
  n.style.width  = (placement.width  || 120) + 'px';
  n.style.height = (placement.height || 60)  + 'px';
  n.style.background = comp.fill != null ? comp.fill : 'transparent';
  const bw = comp.border_width || 0;
  n.style.border = bw > 0 ? `${bw}px solid ${comp.border_color || '#FFFFFF'}` : 'none';
  n.style.borderRadius = (placement.radius || 0) + 'px';
  return n;
}

export function buildCircle(comp, placement) {
  const n = document.createElement('div');
  n.className = 'w w-circle';
  n.style.boxSizing = 'border-box';
  const d = placement.size || 60;
  n.style.width = d + 'px'; n.style.height = d + 'px';
  n.style.borderRadius = '50%';
  n.style.background = comp.fill != null ? comp.fill : 'transparent';
  const bw = comp.border_width || 0;
  n.style.border = bw > 0 ? `${bw}px solid ${comp.border_color || '#FFFFFF'}` : 'none';
  return n;
}

export function buildLine(comp, placement) {
  const n = document.createElement('div');
  n.className = 'w w-line';
  const len = placement.width || 120;
  const th  = placement.thickness || 2;
  const style = DASH_CSS[comp.dash] || 'solid';
  const color = comp.color || '#FFFFFF';
  if (comp.orientation === 'vertical') {                  // trait = bordure gauche d'une box de largeur 0
    n.style.width = '0'; n.style.height = len + 'px';
    n.style.borderLeft = `${th}px ${style} ${color}`;
  } else {
    n.style.height = '0'; n.style.width = len + 'px';
    n.style.borderTop = `${th}px ${style} ${color}`;
  }
  return n;
}
```

- [ ] **Step 5 : Enregistrer les 3 types dans `registry.js`**

Dans `designer/js/registry.js`, étendre l'import de `render.js` (ligne 7) avec les 3 builders :

```js
import { buildLabel, buildReadout, buildBar, buildRing, buildChart, buildMeter, buildImage, buildImageAnim, buildLed, buildRect, buildCircle, buildLine } from './render.js';
```

Puis ajouter ces 3 entrées dans l'objet `COMPONENTS` (après `led`, avant `led_ring`) :

```js
  rect: {
    label: 'Rectangle',
    defaults: () => ({ type: 'rect', fill: '#38BDF8', border_width: 0, border_color: '#FFFFFF' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), width: 120, height: 60, radius: 0 }),
    centered: false, physical: false,
    compFields: [['fill', 'Fond', 'fill'], ['border_width', 'Épaisseur contour', 'num'],
                 ['border_color', 'Couleur contour', 'color', c => (c.border_width || 0) > 0]],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'],
                  ['width', 'Largeur', 'num', 120], ['height', 'Hauteur', 'num', 60], ['radius', 'Rayon coin', 'num', 0]],
    mockFields: [],
    build: (comp, pl) => buildRect(comp, pl),
  },
  circle: {
    label: 'Cercle',
    defaults: () => ({ type: 'circle', fill: '#38BDF8', border_width: 0, border_color: '#FFFFFF' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), size: 60 }),
    centered: false, physical: false,
    compFields: [['fill', 'Fond', 'fill'], ['border_width', 'Épaisseur contour', 'num'],
                 ['border_color', 'Couleur contour', 'color', c => (c.border_width || 0) > 0]],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'],
                  ['size', 'Diamètre', 'num', 60]],
    mockFields: [],
    build: (comp, pl) => buildCircle(comp, pl),
  },
  line: {
    label: 'Droite',
    defaults: () => ({ type: 'line', color: '#FFFFFF', orientation: 'horizontal', dash: 'solid', rounded: false }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), width: 120, thickness: 2 }),
    centered: false, physical: false,
    compFields: [['color', 'Couleur', 'color'], ['orientation', 'Orientation', 'orient'],
                 ['dash', 'Motif', 'dash'], ['rounded', 'Bouts arrondis', 'bool']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'],
                  ['width', 'Longueur', 'num', 120], ['thickness', 'Épaisseur', 'num', 2]],
    mockFields: [],
    build: (comp, pl) => buildLine(comp, pl),
  },
```

- [ ] **Step 6 : Ajouter les 3 glyphes dans `icons.js`**

Dans `designer/js/icons.js`, ajouter dans `PATHS` (après `sound`, avant l'accolade fermante) :

```js
  rect:     '<rect x="4" y="6" width="16" height="12" rx="2"/>',             // rectangle à coins arrondis
  circle:   '<circle cx="12" cy="12" r="8"/>',                               // cercle
  line:     '<path d="M4 12h16"/>',                                          // trait horizontal
```

- [ ] **Step 7 : Lancer les tests, vérifier le vert**

Run: `cd designer && node --test`
Expected: PASS — conformité registre↔schéma OK (3 types des deux côtés), nouveaux tests registre/validation OK.

- [ ] **Step 8 : Commit**

```bash
git add schema/layout.schema.json designer/js/render.js designer/js/registry.js designer/js/icons.js designer/tests/registry.test.js designer/tests/validate.test.js
git commit -m "formes: schéma + registre/aperçu/icônes designer (rect/circle/line)"
```

---

## Task 2 : Édition dans l'inspecteur (dash + fill + garde orientation)

Édition WYSIWYG : éditeur `dash`, champ `fill` (case « Remplir » + couleur, car `<input type=color>` ne peut pas être vide), et garde du swap Largeur/Hauteur sur changement d'orientation (réservé à `bar` ; une droite ne swappe pas sa géométrie). Pas de test node (DOM) → vérif navigateur.

**Files:**
- Modify: `designer/js/inspector.js`

- [ ] **Step 1 : Ajouter l'éditeur `dash` à la table `SELECTS`**

Dans `designer/js/inspector.js`, étendre `SELECTS` (après `arcmode`) :

```js
  dash:    [['solid', 'Plein'], ['dashed', 'Tirets'], ['dotted', 'Pointillé']],
```

`makeInput` gère déjà tout `SELECTS[kind]` (branche générique) — aucune autre modif pour `dash`.

- [ ] **Step 2 : Ajouter le champ bespoke `fill`**

Dans `designer/js/inspector.js`, ajouter cette fonction juste avant `renderEmpty` :

```js
  // Champ « Fond » d'une forme : case « Remplir » + couleur. Décochée → fill supprimé (= pas de fond,
  // contour seul). Un <input type=color> natif ne peut pas être vide → la case porte l'état présent/absent.
  // Commit sur 'change' (pas d'aperçu live ici, contrairement aux color pickers génériques).
  function fillField(label, c) {
    const ref = sel.ref;                                  // figée au rendu (cf. invariant inspecteur)
    const row = document.createElement('div'); row.className = 'insp-row';
    const span = document.createElement('span'); span.className = 'insp-label'; span.textContent = label;
    row.appendChild(span);
    const on = document.createElement('input'); on.type = 'checkbox'; on.checked = c.fill != null;
    on.title = 'Remplir le fond';
    const col = document.createElement('input'); col.type = 'color'; col.value = c.fill || '#38BDF8';
    col.disabled = c.fill == null;
    on.addEventListener('change', () => {
      col.disabled = !on.checked;   // retour immédiat (le garde-focus de render() saute le rebuild tant que la case a le focus)
      model.commit(s => setComponentProp(s, ref, 'fill', on.checked ? (col.value.toUpperCase()) : null));
    });
    col.addEventListener('change', () => model.commit(s => setComponentProp(s, ref, 'fill', col.value.toUpperCase())));
    row.append(on, col);
    return row;
  }
```

(`setComponentProp(_, _, 'fill', null)` supprime la clé — même mécanisme que le reset d'image `src`.)

- [ ] **Step 3 : Brancher `fill` et garder le swap d'orientation au seul `bar`**

Dans `renderComp`, dans la boucle `for (const [key, label, kind, enableWhen] of COMPONENTS[c.type].compFields)`, ajouter le cas `fill` à côté des autres éditeurs bespoke (après la ligne `image_anim`) :

```js
      if (kind === 'fill') { body.appendChild(fillField(label, c)); continue; }   // forme : fond optionnel
```

Puis, dans le `commit` du même bloc, restreindre le swap au type `bar` (une droite garde sa longueur en changeant d'orientation) :

Remplacer :
```js
        if (key === 'orientation') { model.commit(s => setBarOrientation(s, ref, getActivePage(), placeIndex, v)); return; }
```
par :
```js
        if (key === 'orientation' && c.type === 'bar') { model.commit(s => setBarOrientation(s, ref, getActivePage(), placeIndex, v)); return; }
```

(Pour `line`, `orientation` tombe alors dans le `setComponentProp` générique ci-dessous.)

- [ ] **Step 4 : Vérification navigateur**

Servir le designer en no-store et piloter au pointeur (cf. mémoire `designer-verif-navigateur`).

```bash
cd designer && python3 -c "import http.server,functools; http.server.test(HandlerClass=functools.partial(http.server.SimpleHTTPRequestHandler), port=8765)"
```

Vérifier (capture) :
- Palette : Rectangle / Cercle / Droite apparaissent avec leurs icônes ; déposer chacun sur le canvas.
- Rect : éditer Largeur/Hauteur/Rayon coin (num) → le canvas suit ; case « Remplir » décochée → fond transparent (contour visible si Épaisseur contour > 0) ; recochée → fond revient ; couleur de contour grisée tant que Épaisseur contour = 0.
- Cercle : Diamètre édite la taille ; fill/contour comme rect.
- Droite : Orientation H/V (la longueur ne change pas), Motif Plein/Tirets/Pointillé visibles, Bouts arrondis.
- `Échap` + clic hors composant désélectionnent (cf. mémoire `designer-deselection`).

Arrêter le serveur de test après (cf. mémoire `test-server-hygiene`).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/inspector.js
git commit -m "formes: inspecteur — éditeur dash, champ fill (case + couleur), garde swap orientation (bar)"
```

---

## Task 3 : Firmware (parse + rendu)

**Files:**
- Modify: `src/dashboard.h`
- Modify: `src/dashboard.cpp`
- Modify: `src/view.cpp`
- Modify: `src/lv_conf.h`
- Modify: `test/test_core/test_main.cpp`

- [ ] **Step 1 : Écrire le test natif qui échoue**

Dans `test/test_core/test_main.cpp`, ajouter une constante de layout (près des autres `LAYOUT_*`, p. ex. après `LAYOUT_RING_BOTH`) :

```c
static const char* LAYOUT_SHAPES =
  "{\"components\":{"
    "\"r1\":{\"type\":\"rect\",\"fill\":\"#FF0000\",\"border_width\":3,\"border_color\":\"#00FF00\"},"
    "\"c1\":{\"type\":\"circle\"},"
    "\"l1\":{\"type\":\"line\",\"color\":\"#0000FF\",\"orientation\":\"vertical\",\"dash\":\"dashed\",\"rounded\":true}},"
  "\"pages\":[{\"name\":\"p\",\"place\":["
    "{\"ref\":\"r1\",\"width\":120,\"height\":60,\"radius\":8},"
    "{\"ref\":\"c1\",\"size\":50},"
    "{\"ref\":\"l1\",\"width\":100,\"thickness\":2}]}]}";

void test_shapes_parsed(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE_MESSAGE(dash_set_layout(&d, LAYOUT_SHAPES, err, sizeof(err)), err);
    int ir = dash_find(&d, "r1"), ic = dash_find(&d, "c1"), il = dash_find(&d, "l1");
    TEST_ASSERT_TRUE(ir >= 0 && ic >= 0 && il >= 0);
    // rect : fill présent, contour, type
    TEST_ASSERT_EQUAL_INT(COMP_RECT, d.components[ir].type);
    TEST_ASSERT_TRUE(d.components[ir].fill_set);
    TEST_ASSERT_EQUAL_HEX32(0xFF0000, d.components[ir].fill);
    TEST_ASSERT_EQUAL_INT(3, d.components[ir].border_width);
    TEST_ASSERT_EQUAL_HEX32(0x00FF00, d.components[ir].border_color);
    TEST_ASSERT_EQUAL_INT(8, d.pages[0].places[0].radius);
    // circle : fill absent (pas de fond), diamètre
    TEST_ASSERT_EQUAL_INT(COMP_CIRCLE, d.components[ic].type);
    TEST_ASSERT_FALSE(d.components[ic].fill_set);
    TEST_ASSERT_EQUAL_INT(50, d.pages[0].places[1].size);
    // line : couleur, orientation (bar_vertical), dash, rounded, longueur/épaisseur
    TEST_ASSERT_EQUAL_INT(COMP_LINE, d.components[il].type);
    TEST_ASSERT_EQUAL_HEX32(0x0000FF, d.components[il].color);
    TEST_ASSERT_TRUE(d.components[il].bar_vertical);
    TEST_ASSERT_EQUAL_INT(LINE_DASHED, d.components[il].line_dash);
    TEST_ASSERT_TRUE(d.components[il].line_rounded);
    TEST_ASSERT_EQUAL_INT(100, d.pages[0].places[2].width);
    TEST_ASSERT_EQUAL_INT(2, d.pages[0].places[2].thickness);
}
```

Enregistrer le test dans `main()` (à côté des autres `RUN_TEST`, p. ex. après `RUN_TEST(test_schema_types_all_resolve);`) :

```c
    RUN_TEST(test_shapes_parsed);
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pio test -e native`
Expected: FAIL — `COMP_RECT`/`fill_set`/`LINE_DASHED` non déclarés (la compilation échoue), et `test_schema_types_all_resolve` échouerait aussi (parser sans les 3 types, schéma à jour depuis Task 1).

- [ ] **Step 3 : Étendre l'enum et la struct (`dashboard.h`)**

Dans `src/dashboard.h`, étendre `CompType` (ajouter avant `COMP_COUNT`) :

```c
enum CompType { COMP_NONE, COMP_LABEL, COMP_READOUT, COMP_BAR, COMP_RING, COMP_LED_RING, COMP_SOUND, COMP_CHART, COMP_METER, COMP_IMAGE, COMP_IMAGE_ANIM, COMP_LED, COMP_RECT, COMP_CIRCLE, COMP_LINE, COMP_COUNT };
```

Ajouter l'enum de motif (à côté de `enum LedMode` / `enum BarMode`) :

```c
enum LineDash { LINE_SOLID, LINE_DASHED, LINE_DOTTED };  // line : motif du trait (line_dash_*)
```

Ajouter les champs dans `struct Component` (section config, p. ex. après `aimg_autoplay`) :

```c
    // formes de base (rect/circle/line)
    bool     fill_set;        // rect/circle : fill present (sinon pas de fond)
    uint32_t fill;            // rect/circle : couleur de fond
    uint32_t border_color;    // rect/circle : couleur du contour (defaut 0xFFFFFF)
    int      border_width;    // rect/circle : epaisseur du contour (0 = aucun)
    LineDash line_dash;       // line : motif (plein/tirets/pointille)
    bool     line_rounded;    // line : bouts arrondis (line_rounded). NB: l'orientation reutilise bar_vertical (parse generique)
```

- [ ] **Step 4 : Parsing (`dashboard.cpp`)**

Dans `src/dashboard.cpp`, ajouter les 3 types à `COMP_NAMES` (dans le tableau, après `{ "led", COMP_LED }`) :

```c
    { "rect", COMP_RECT }, { "circle", COMP_CIRCLE }, { "line", COMP_LINE },
```

Ajouter le parseur de motif (à côté de `parse_arc_mode`) :

```c
static LineDash parse_line_dash(const char* s) {
    if (s && !strcmp(s, "dashed")) return LINE_DASHED;
    if (s && !strcmp(s, "dotted")) return LINE_DOTTED;
    return LINE_SOLID;
}
```

Dans `dash_set_layout`, dans le bloc de parsing générique des champs de composant (après la ligne `c.arc_rounded = o["rounded"] | true;`), ajouter :

```c
        c.fill_set     = o["fill"].is<const char*>();
        c.fill         = c.fill_set ? parse_hex_color(o["fill"], 0) : 0;
        c.border_color = parse_hex_color(o["border_color"] | "#FFFFFF", 0xFFFFFF);
        c.border_width = o["border_width"] | 0;
        if (c.border_width < 0) c.border_width = 0;
        c.line_dash    = parse_line_dash(o["dash"] | "solid");
        c.line_rounded = o["rounded"] | false;   // line : defaut false (ring lit aussi "rounded" -> arc_rounded, defaut true)
```

(L'orientation est déjà lue génériquement : `c.bar_vertical = !strcmp(o["orientation"] | "horizontal", "vertical");` — réutilisée par `line`.)

Ajouter un handler `apply` no-op (à côté de `apply_image`) :

```c
static void apply_shape(Component&, JsonVariantConst) {
    // rect/circle/line : statiques, pas de push de valeur. `visible` est gere universellement
    // (dash_apply_update) avant apply_one. Entree de vtable requise (static_assert COMP_COUNT).
}
```

Et 3 lignes dans la table `APPLY[]` (après `/* COMP_LED */ apply_led,`) :

```c
    /* COMP_RECT     */ apply_shape,
    /* COMP_CIRCLE   */ apply_shape,
    /* COMP_LINE     */ apply_shape,
```

- [ ] **Step 5 : Rendu (`view.cpp`) + `lv_conf.h`**

Dans `src/lv_conf.h`, ajouter (à côté de `#define LV_USE_LED 1`) :

```c
#define LV_USE_LINE            1
```

Dans `src/view.cpp`, ajouter le buffer de points persistant + les indices courants près des autres statiques de fichier (après `static lv_obj_t* s_dots = nullptr;`) :

```c
// line : lv_line_set_points conserve le POINTEUR (pas de copie) -> tableau persistant par placement.
// Rempli par build_line ; s_cur_page/s_cur_place sont poses par la boucle de build avant chaque build().
static lv_point_precise_t s_line_pts[MAX_PAGES][MAX_PLACEMENTS_PER_PAGE][2];
static int s_cur_page = 0, s_cur_place = 0;
```

Ajouter les 3 builders (avant la définition de `struct ViewVTable`/`VIEW[]`, p. ex. après `sync_led`) :

```c
// Formes décoratives : lv_obj stylé (rect/circle) ou lv_line (line). Statiques (sync=nullptr).
static void build_rect(lv_obj_t* parent, Component& c, Placement& q,
                       lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* o = lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(o, q.width > 0 ? q.width : 120, q.height > 0 ? q.height : 60);
    lv_obj_set_style_radius(o, q.radius > 0 ? q.radius : 0, LV_PART_MAIN);
    if (c.fill_set) {
        lv_obj_set_style_bg_color(o, lv_color_hex(c.fill), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(o, LV_OPA_COVER, LV_PART_MAIN);
    } else {
        lv_obj_set_style_bg_opa(o, LV_OPA_TRANSP, LV_PART_MAIN);
    }
    if (c.border_width > 0) {
        lv_obj_set_style_border_width(o, c.border_width, LV_PART_MAIN);
        lv_obj_set_style_border_color(o, lv_color_hex(c.border_color), LV_PART_MAIN);
        lv_obj_set_style_border_opa(o, LV_OPA_COVER, LV_PART_MAIN);
    }
    lv_obj_align(o, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = o;
}

static void build_circle(lv_obj_t* parent, Component& c, Placement& q,
                         lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* o = lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE);
    int d = q.size > 0 ? q.size : 60;
    lv_obj_set_size(o, d, d);
    lv_obj_set_style_radius(o, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    if (c.fill_set) {
        lv_obj_set_style_bg_color(o, lv_color_hex(c.fill), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(o, LV_OPA_COVER, LV_PART_MAIN);
    } else {
        lv_obj_set_style_bg_opa(o, LV_OPA_TRANSP, LV_PART_MAIN);
    }
    if (c.border_width > 0) {
        lv_obj_set_style_border_width(o, c.border_width, LV_PART_MAIN);
        lv_obj_set_style_border_color(o, lv_color_hex(c.border_color), LV_PART_MAIN);
        lv_obj_set_style_border_opa(o, LV_OPA_COVER, LV_PART_MAIN);
    }
    lv_obj_align(o, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = o;
}

static void build_line(lv_obj_t* parent, Component& c, Placement& q,
                       lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* o = lv_line_create(parent);
    lv_obj_remove_style_all(o);
    int len = q.width > 0 ? q.width : 80;
    int th  = q.thickness > 0 ? q.thickness : 2;
    lv_point_precise_t* pts = s_line_pts[s_cur_page][s_cur_place];
    pts[0].x = 0; pts[0].y = 0;
    if (c.bar_vertical) { pts[1].x = 0;   pts[1].y = len; lv_obj_set_size(o, th, len); }
    else                { pts[1].x = len; pts[1].y = 0;   lv_obj_set_size(o, len, th); }
    lv_line_set_points(o, pts, 2);
    lv_obj_set_style_line_width(o, th, LV_PART_MAIN);
    lv_obj_set_style_line_color(o, lv_color_hex(c.color), LV_PART_MAIN);
    lv_obj_set_style_line_opa(o, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_line_rounded(o, c.line_rounded, LV_PART_MAIN);
    if (c.line_dash == LINE_DASHED) {
        lv_obj_set_style_line_dash_width(o, 10, LV_PART_MAIN);
        lv_obj_set_style_line_dash_gap(o, 6, LV_PART_MAIN);
    } else if (c.line_dash == LINE_DOTTED) {
        lv_obj_set_style_line_dash_width(o, 2, LV_PART_MAIN);
        lv_obj_set_style_line_dash_gap(o, 4, LV_PART_MAIN);
    }
    lv_obj_align(o, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = o;
}
```

Ajouter 3 entrées dans la table `VIEW[]` (après `/* COMP_LED */ { build_led, sync_led },`) :

```c
    /* COMP_RECT     */ { build_rect,   nullptr },
    /* COMP_CIRCLE   */ { build_circle, nullptr },
    /* COMP_LINE     */ { build_line,   nullptr },
```

Dans la boucle de build (la double boucle `for (int p...) { ... for (int i...) {`), poser les indices courants juste avant l'appel `VIEW[c.type].build(...)` :

```c
            s_cur_page = p; s_cur_place = i;   // pour build_line (points persistants par placement)
            if ((unsigned)c.type < COMP_COUNT && VIEW[c.type].build)
                VIEW[c.type].build(cont, c, q, &s_widget[p][i], &s_sub1[p][i], &s_sub2[p][i]);
```

- [ ] **Step 6 : Lancer les tests natifs, vérifier le vert**

Run: `pio test -e native`
Expected: PASS — `test_shapes_parsed` OK et `test_schema_types_all_resolve` OK (parser couvre les 3 types).

- [ ] **Step 7 : Compiler le firmware (les `static_assert` de table sont vérifiés à la compilation)**

Run: `pio run -e esp32s3`
Expected: build OK (sinon : `APPLY desync` ou `VIEW desync` ⇒ une ligne de table manquante ; ou symbole `lv_line_*` manquant ⇒ `LV_USE_LINE` non posé).

- [ ] **Step 8 : Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/view.cpp src/lv_conf.h test/test_core/test_main.cpp
git commit -m "formes: firmware — parse + rendu rect/circle/line (lv_obj/lv_line), LV_USE_LINE"
```

---

## Task 4 : Vérification de bout en bout

**Files:** aucun (vérification).

- [ ] **Step 1 : Suites complètes vertes**

```bash
cd designer && node --test && cd ..
pio test -e native
pio run -e esp32s3
```
Expected: designer all PASS ; natif all PASS ; build firmware OK.

- [ ] **Step 2 : Parité navigateur (designer)**

Servir en no-store (cf. Task 2 Step 4), construire une page avec les 3 formes dans des variantes :
- rect : plein sans contour ; contour seul (case « Remplir » décochée, Épaisseur contour 4) ; coins arrondis (Rayon 16) ; coins très arrondis → pilule.
- circle : plein ; contour seul.
- line : Plein / Tirets / Pointillé, H et V, Bouts arrondis on/off.
- Empiler un rect sous un label (le descendre en z via l'arbre) → vérifier qu'il sert de fond.
Capturer l'écran. Arrêter le serveur.

- [ ] **Step 3 : e2e device (parité firmware ↔ designer)**

⚠ `uploadfs` **efface les assets images du device** (cf. mémoire `uploadfs-efface-assets-device`) : sauvegarder d'abord les assets utiles (`GET /image?key=` etc.) si le device en contient.

```bash
bash tools/stage_fs.sh
pio run -e esp32s3 -t upload
pio run -e esp32s3 -t uploadfs
```

Pousser un layout contenant les 3 formes (designer → « Pousser au device », ou `tools/push.py`). Vérifier sur l'écran rond :
- rect/cercle : fond et/ou contour, rayon de coin ; cercle bien rond.
- droite : H et V, pointillé visible (rendu LVGL réel), bouts arrondis.
- `POST /update {"<id>":{"visible":false}}` cache la forme ; `true` la réaffiche.
- Comparer côte à côte avec l'aperçu designer (parité « suffisante » attendue : aspect, pas longueurs de tirets exactes).

- [ ] **Step 4 : Mettre à jour le HANDOFF**

Noter dans `docs/_internal/HANDOFF.md` l'ajout des 3 formes (livré + déviation v1 : pas de poignées de resize canvas, géométrie via inspecteur).

```bash
git add docs/_internal/HANDOFF.md
git commit -m "docs: HANDOFF — formes de base livrées (rect/circle/line)"
```

(`docs/_internal/` est gitignoré : ce commit peut être un no-op si rien n'est suivi — dans ce cas, sauter.)

---

## Notes de revue (self-review)

- **Couverture spec** : 3 types ✓ ; fill optionnel ✓ ; contour (couleur/épaisseur) ✓ ; rayon de coin (rect) ✓ ; diamètre (cercle) ✓ ; droite H/V + épaisseur + motif + bouts arrondis ✓ ; statique + `visible` ✓ ; limites LVGL respectées (contour plein, dash H/V) ✓. **Déviation** : pas de poignées de resize canvas (spec les mentionnait) → géométrie via inspecteur en v1, signalée au handoff.
- **Cohérence des types** : `fill_set`/`fill`/`border_color`/`border_width`/`line_dash`/`line_rounded` (struct) ↔ parse ↔ build identiques entre tâches ; `LineDash{LINE_SOLID,LINE_DASHED,LINE_DOTTED}` ; `orientation` ⇒ `bar_vertical` (réutilisé) ; vtable `{build_*, nullptr}`.
- **Pièges adressés** : `lv_line_set_points` ne copie pas → buffer persistant `s_line_pts` ; `LV_USE_LINE` requis ; `static_assert` APPLY/VIEW == COMP_COUNT (3 lignes chacune) ; `<input type=color>` non vidable → champ `fill` à case ; swap d'orientation réservé à `bar`.
