# Composant `icon` (icône / symbole) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un composant `icon` à Dialboard : un `lv_label` rendu en symbole `LV_SYMBOL_*`, dont le glyphe **et** la couleur suivent une valeur poussée via une table d'états unifiée `{at, symbol?, color?}`.

**Architecture:** On suit le pattern table-driven existant (cf. `led`). Designer : une entrée `registry.js` pilote palette/inspecteur/aperçu ; aperçu DOM dans `render.js` (map nom→SVG + résolveur pur `resolveIcon`). Firmware : enum `CompType`, ligne dans la table noms→type (parse) et dans la vtable `{build, sync}` (rendu), résolveur pur `icon_resolve` (testé natif, sans LVGL), mapping nom→index (parse, sans LVGL) et index→glyphe (rendu, LVGL). Le schéma JSON est le contrat partagé ; trois conformités testées (registre↔schéma, enum symbole↔schéma, vtables↔COMP_COUNT) garantissent la parité.

**Tech Stack:** JS modules ES (designer, tests `node --test`), C++/Arduino + LVGL 9.5 (firmware, tests Unity `env:native`), JSON Schema draft-07.

**Décisions de conception (verrouillées, cf. spec `docs/superpowers/specs/2026-06-22-composant-icone-design.md`) :**
- Une **seule valeur scalaire** (push par id ou `bind`) pilote glyphe+couleur via `states`.
- **Table d'états unifiée** : 1ʳᵉ bande où `value < at` gagne ; champ `symbol`/`color` omis ⇒ base ; aucune ⇒ base. Miroir de `threshold_color`.
- **Glyphes built-in** `LV_SYMBOL_*` (gratuits, déjà dans les fontes Montserrat embarquées). Set **curaté 23** (extensible). Pas de fonte custom (hors-scope).
- Wire format = **noms** (`wifi`…). Firmware convertit nom→index **uint8_t** au parse (mémoire). Parité designer = map nom→**SVG** (best-effort, parité « suffisante » assumée comme la LED).
- Placement = `anchor`/`dx`/`dy` ; taille = `font` (défaut **28**). **Pas de poignées de resize** (comme `label`).
- Forme **objet** pour `icon_state` (deux charges optionnelles).
- `MAX_ICON_STATES = 4` (= `MAX_THRESHOLDS`).

---

## File Structure

**Schéma (contrat partagé) :**
- Modify: `schema/layout.schema.json` — `$defs` `symbolName` (enum 23), `icon_state` (objet), `comp_icon` + ref dans `component.oneOf`.

**Designer :**
- Modify: `designer/js/render.js` — `ICON_SVG` (map nom→SVG), `resolveIcon` (pur), `buildIcon`, `MOCKS.icon`.
- Modify: `designer/js/registry.js` — import `buildIcon` + entrée `icon` dans `COMPONENTS`.
- Modify: `designer/js/mutations.js` — `setIconStates` (pure).
- Modify: `designer/js/inspector.js` — `SELECTS.symbol`, section éditeur `states`.
- Modify: `designer/js/icons.js` — 1 glyphe de palette `icon`.
- Modify: `designer/tests/render.test.js` — `resolveIcon` (pur).
- Modify: `designer/tests/registry.test.js` — entrée `icon` + conformité enum symbole↔schéma.
- Modify: `designer/tests/validate.test.js` — layout `icon` valide + invalide.
- Modify: `designer/tests/mutations.test.js` — `setIconStates`.

**Firmware :**
- Modify: `src/config.h` — `MAX_ICON_STATES`.
- Modify: `src/dashboard.h` — `COMP_ICON`, `struct IconState`, `ICON_SYMBOL_COUNT`, champs struct (`icon_symbol`, `icon_states[]`, `icon_state_count`).
- Modify: `src/color.h` / `src/color.cpp` — `icon_resolve` (pur, sans LVGL).
- Modify: `src/dashboard.cpp` — `COMP_NAMES`, `ICON_SYMBOL_NAMES`, `icon_symbol_index`, parse `symbol`/`states`/font 28, `apply_icon`, entrée `APPLY`.
- Modify: `src/view.cpp` — `ICON_GLYPHS` (+ static_assert), `build_icon`, `sync_icon`, entrée `VIEW`.
- Modify: `test/test_core/test_main.cpp` — `test_icon_resolve` (pur) + `test_icon_parsed` + `RUN_TEST`.

`src/lv_conf.h` **inchangé** (`lv_label` natif, symboles déjà dans les fontes).

---

## Task 1 : Schéma + résolveur/aperçu designer + registre + icônes

Le test de conformité `registry.test.js` exige `registre == schéma` et `registry.js` importe `buildIcon` de `render.js` (l'import casse si absent). On garde donc `node --test` vert au commit. Le résolveur `resolveIcon` est le cœur testable (TDD).

**Files:**
- Modify: `schema/layout.schema.json`
- Modify: `designer/js/render.js`
- Modify: `designer/js/registry.js`
- Modify: `designer/js/icons.js`
- Modify: `designer/tests/render.test.js`
- Modify: `designer/tests/registry.test.js`
- Modify: `designer/tests/validate.test.js`

- [ ] **Step 1 : Écrire les tests designer qui échouent**

Dans `designer/tests/render.test.js`, ajouter l'import de `resolveIcon` (étendre l'import existant de `../js/render.js`) puis en fin de fichier :

```js
import { resolveIcon } from '../js/render.js';

test('resolveIcon : sans states -> base (symbol+color)', () => {
  const r = resolveIcon({ symbol: 'wifi', color: '#112233' }, 5);
  assert.deepEqual(r, { symbol: 'wifi', color: '#112233' });
});

test('resolveIcon : défauts bell/#FFFFFF quand base absente', () => {
  assert.deepEqual(resolveIcon({}, 0), { symbol: 'bell', color: '#FFFFFF' });
});

test('resolveIcon : 1re bande où value < at gagne (glyphe + couleur)', () => {
  const comp = { symbol: 'battery_full', color: '#00FF00',
    states: [{ at: 15, symbol: 'battery_empty', color: '#FF0000' },
             { at: 50, symbol: 'battery_2', color: '#FFAA00' }] };
  assert.deepEqual(resolveIcon(comp, 10), { symbol: 'battery_empty', color: '#FF0000' });
  assert.deepEqual(resolveIcon(comp, 30), { symbol: 'battery_2',     color: '#FFAA00' });
  assert.deepEqual(resolveIcon(comp, 90), { symbol: 'battery_full',  color: '#00FF00' }); // aucune -> base
});

test('resolveIcon : champ omis dans une bande retombe sur la base', () => {
  const comp = { symbol: 'wifi', color: '#FFFFFF', states: [{ at: 1, color: '#888888' }] };
  assert.deepEqual(resolveIcon(comp, 0), { symbol: 'wifi', color: '#888888' });   // symbol omis -> base wifi
  const comp2 = { symbol: 'wifi', color: '#FFFFFF', states: [{ at: 1, symbol: 'close' }] };
  assert.deepEqual(resolveIcon(comp2, 0), { symbol: 'close', color: '#FFFFFF' }); // color omis -> base
});
```

Dans `designer/tests/registry.test.js`, ajouter en fin de fichier :

```js
test('registre : icon déclaré, value-driven (mockFields value), non physique', () => {
  assert.ok(COMPONENTS.icon, 'icon absent du registre');
  assert.equal(COMPONENTS.icon.physical, false);
  assert.equal(COMPONENTS.icon.centered, false);
  assert.deepEqual(COMPONENTS.icon.mockFields, [['value', 'Valeur (aperçu)']]);
  const cf = COMPONENTS.icon.compFields.map(f => f[0]);
  for (const k of ['symbol', 'color', 'font', 'bind']) assert.ok(cf.includes(k), `icon : ${k} manquant`);
  const d = COMPONENTS.icon.defaults();
  assert.equal(d.symbol, 'bell');
  assert.equal(d.font, 28);
});

test('conformité : enum symbolName du schéma == clés de ICON_SVG (render.js)', async () => {
  const { ICON_SVG } = await import('../js/render.js');
  const schemaNames = schema.$defs.symbolName.enum.slice().sort();
  const svgNames = Object.keys(ICON_SVG).sort();
  assert.deepEqual(svgNames, schemaNames);
});
```

Dans `designer/tests/validate.test.js`, ajouter en fin de fichier :

```js
test('layout avec icon (base + states) est valide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.i1 = { type: 'icon', symbol: 'wifi', color: '#FFFFFF', font: 28,
    states: [{ at: 1, symbol: 'close', color: '#FF0000' }, { at: 50, color: '#FFAA00' }] };
  l.pages[0].place.push({ ref: 'i1', anchor: 'CENTER', dx: 0, dy: 0 });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('icon : symbole hors enum -> invalide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.i1 = { type: 'icon', symbol: 'rocket' };
  l.pages[0].place.push({ ref: 'i1', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});

test('icon : state sans `at` -> invalide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.i1 = { type: 'icon', states: [{ symbol: 'wifi' }] };
  l.pages[0].place.push({ ref: 'i1', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `resolveIcon` non exporté, `COMPONENTS.icon` undefined, `schema.$defs.symbolName` undefined.

- [ ] **Step 3 : Ajouter les 3 `$defs` au schéma**

Dans `schema/layout.schema.json`, ajouter à `component.oneOf` (après `{ "$ref": "#/$defs/comp_line" }`) :

```json
        { "$ref": "#/$defs/comp_icon" },
```

Ajouter ces 3 `$defs` dans l'objet `$defs` (à côté de `comp_led`) :

```json
    "symbolName": {
      "enum": ["wifi", "bluetooth", "gps", "usb", "battery_empty", "battery_1", "battery_2", "battery_3", "battery_full", "charge", "power", "bell", "warning", "ok", "close", "play", "pause", "stop", "volume_max", "mute", "home", "settings", "refresh"],
      "description": "Nom de symbole LVGL (LV_SYMBOL_*). Firmware: glyphe ; designer: SVG equivalent (parite best-effort)."
    },
    "icon_state": {
      "type": "object",
      "additionalProperties": false,
      "required": ["at"],
      "description": "Bande d'etat : 1re bande ou value < at gagne. symbol/color omis = retombe sur la base.",
      "properties": {
        "at": { "type": "number", "description": "Borne haute exclusive : bande choisie si value < at." },
        "symbol": { "$ref": "#/$defs/symbolName", "description": "Glyphe de la bande. Omis = symbol de base." },
        "color": { "$ref": "#/$defs/hexColor", "description": "Couleur de la bande. Omis = color de base." }
      }
    },
    "comp_icon": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "description": "Icone/symbole (lv_label en police de symboles). Glyphe ET couleur pilotes par la valeur poussee (push par id ou bind) via une table d'etats. Place via anchor/dx/dy ; taille = font (defaut 28).",
      "properties": {
        "type": { "const": "icon" },
        "visible": { "type": "boolean", "description": "Affiche le composant (defaut true). false = cache (LV_OBJ_FLAG_HIDDEN). Pilotable via /update {\"<id>\":{\"visible\":true}}." },
        "bind": { "$ref": "#/$defs/ascii", "description": "Nom d'une variable du contexte (pull). Present = lit la variable au lieu d'etre pousse par id. Absent = push par id (defaut)." },
        "symbol": { "$ref": "#/$defs/symbolName", "description": "Glyphe de base (quand aucune bande de states ne matche). Defaut bell." },
        "color": { "$ref": "#/$defs/hexColor", "description": "Couleur de base (text_color). Defaut #FFFFFF." },
        "font": { "$ref": "#/$defs/font", "description": "Taille du glyphe. Defaut 28." },
        "states": { "type": "array", "items": { "$ref": "#/$defs/icon_state" }, "description": "Table d'etats (glyphe/couleur selon la valeur). Vide = icone statique." }
      }
    },
```

- [ ] **Step 4 : Résolveur + map SVG + builder + mock dans `render.js`**

Dans `designer/js/render.js`, ajouter `icon: { value: 0 }` à l'objet `MOCKS` (après `led: { value: 1 }` — ajouter une virgule à la ligne `led`). Puis ajouter en fin de fichier. L'aperçu monte le SVG via `DOMParser` + `importNode` (pas d'`innerHTML`) ; la couleur est appliquée par `currentColor` (héritée de `n.style.color`) :

```js
// --- Icône / symbole : lv_label en police de symboles (firmware) ; SVG equivalent (designer). ---
// Map nom -> fragment SVG (enfants d'un <svg> viewBox 0 0 24 24). stroke/fill = currentColor (couleur via
// n.style.color). Les cles DOIVENT == enum symbolName du schema (test de conformite registry.test.js).
// Style Feather ; parite "best-effort" (cf. spec). La batterie est parametrique (niveau de remplissage 0..4).
function batterySvg(level) {
  let bars = '';
  for (let i = 0; i < level; i++) bars += `<rect x="${5 + i * 3.1}" y="10" width="2.2" height="4" fill="currentColor" stroke="none"/>`;
  return `<rect x="3" y="9" width="15" height="6" rx="1"/><rect x="19" y="10.5" width="2" height="3" fill="currentColor" stroke="none"/>${bars}`;
}
export const ICON_SVG = {
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
  bluetooth: '<path d="M7 8l10 8-5 4V4l5 4-10 8"/>',
  gps: '<circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 0 0-8-8z"/>',
  usb: '<path d="M10 20V5"/><path d="M7 8l3-3 3 3"/><circle cx="10" cy="20" r="1.5" fill="currentColor" stroke="none"/><path d="M14 12h3v3"/>',
  battery_empty: batterySvg(0),
  battery_1: batterySvg(1),
  battery_2: batterySvg(2),
  battery_3: batterySvg(3),
  battery_full: batterySvg(4),
  charge: '<rect x="3" y="9" width="15" height="6" rx="1"/><rect x="19" y="10.5" width="2" height="3" fill="currentColor" stroke="none"/><path d="M11 9l-2 3h2.5l-2 3"/>',
  power: '<path d="M12 3v8"/><path d="M7.5 6.5a7 7 0 1 0 9 0"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  warning: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
  ok: '<path d="M20 6 9 17l-5-5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/>',
  volume_max: '<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" stroke="none"/><path d="M16 8.5a4 4 0 0 1 0 7"/><path d="M19 5.5a8 8 0 0 1 0 13"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" stroke="none"/><path d="M17 9l5 6M22 9l-5 6"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V20a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 18.3a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.7 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.7h.1A1.6 1.6 0 0 0 8 1V1a2 2 0 0 1 4 0v.1A1.6 1.6 0 0 0 17 2.7a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
};

// Résolveur PUR (miroir firmware icon_resolve) : 1re bande où value < at ; champ omis -> base.
export function resolveIcon(comp, value) {
  let symbol = comp.symbol || 'bell';
  let color = comp.color || '#FFFFFF';
  for (const st of comp.states || []) {
    if (value < st.at) {
      if (st.symbol != null) symbol = st.symbol;
      if (st.color != null) color = st.color;
      break;
    }
  }
  return { symbol, color };
}

export function buildIcon(comp, mock = MOCKS.icon) {
  const { symbol, color } = resolveIcon(comp, mock.value);
  const px = pickFontPx(comp.font ?? 28);
  const n = document.createElement('div');
  n.className = 'w w-icon';
  n.style.width = px + 'px';
  n.style.height = px + 'px';
  n.style.color = color;                                   // currentColor du SVG
  const markup = `<svg xmlns="${SVGNS}" viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_SVG[symbol] || ICON_SVG.bell}</svg>`;
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  n.appendChild(document.importNode(doc.documentElement, true));
  return n;
}
```

- [ ] **Step 5 : Enregistrer `icon` dans `registry.js`**

Dans `designer/js/registry.js`, étendre l'import de `render.js` (ligne 7) avec `buildIcon` :

```js
import { buildLabel, buildReadout, buildBar, buildRing, buildChart, buildMeter, buildImage, buildImageAnim, buildLed, buildRect, buildCircle, buildLine, buildIcon } from './render.js';
```

Puis ajouter cette entrée dans l'objet `COMPONENTS` (après `led`, avant `led_ring`) :

```js
  icon: {
    label: 'Icône',
    defaults: () => ({ type: 'icon', symbol: 'bell', color: '#FFFFFF', font: 28 }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['symbol', 'Symbole', 'symbol'], ['color', 'Couleur', 'color'],
                 ['font', 'Taille', 'font'], ['bind', 'Variable (pull)', 'asciitext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num']],
    mockFields: [['value', 'Valeur (aperçu)']],
    build: (comp, _pl, mock) => buildIcon(comp, mock),
  },
```

- [ ] **Step 6 : Ajouter le glyphe de palette dans `icons.js`**

Dans `designer/js/icons.js`, ajouter dans `PATHS` (à côté des autres, p. ex. après `line`) :

```js
  icon:     '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="9" r="1.6" fill="currentColor" stroke="none"/><path d="M5 18l5-5 3 3 3-4 4 5"/>',
```

- [ ] **Step 7 : Lancer les tests, vérifier le vert**

Run: `cd designer && node --test`
Expected: PASS — conformité registre↔schéma OK, conformité enum symbole↔schéma OK, `resolveIcon` OK, validation `icon` OK.

- [ ] **Step 8 : Commit**

```bash
git add schema/layout.schema.json designer/js/render.js designer/js/registry.js designer/js/icons.js designer/tests/render.test.js designer/tests/registry.test.js designer/tests/validate.test.js
git commit -m "icone: schema + resolveur/apercu/registre/icone designer (resolveIcon + ICON_SVG)"
```

---

## Task 2 : Mutation `setIconStates` + éditeur `states` (inspecteur)

`setIconStates` est pure (TDD node). L'éditeur `states` est DOM (vérif navigateur) : il étend l'éditeur de seuils existant (`inspector.js:134-158`) d'une colonne « glyphe » et rend `symbol`/`color` **optionnels** par bande (omis = base).

**Files:**
- Modify: `designer/js/mutations.js`
- Modify: `designer/tests/mutations.test.js`
- Modify: `designer/js/inspector.js`

- [ ] **Step 1 : Test `setIconStates` qui échoue**

Dans `designer/tests/mutations.test.js`, ajouter l'import si besoin (`setIconStates` depuis `../js/mutations.js`) puis :

```js
test('setIconStates : pose le tableau, vide => supprime la clé', () => {
  const st = { components: { i1: { type: 'icon' } } };
  setIconStates(st, 'i1', [{ at: 1, symbol: 'close' }]);
  assert.deepEqual(st.components.i1.states, [{ at: 1, symbol: 'close' }]);
  setIconStates(st, 'i1', []);
  assert.equal('states' in st.components.i1, false);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `setIconStates` non exporté.

- [ ] **Step 3 : Implémenter `setIconStates`**

Dans `designer/js/mutations.js`, ajouter après `setThresholds` :

```js
// icon states : tableau de {at, symbol?, color?}. Vide => suppression de la clé (icône statique).
export function setIconStates(state, id, states) {
  const c = state.components[id];
  if (!c) return;
  if (states && states.length) c.states = states;
  else delete c.states;
}
```

- [ ] **Step 4 : Lancer, vérifier le vert**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 5 : `SELECTS.symbol` + imports dans `inspector.js`**

Dans `designer/js/inspector.js`, étendre l'import des mutations (ligne 4) avec `setIconStates` :

```js
import { setComponentProp, setPlacementProp, setBarOrientation, setThresholds, setIconStates, removePlacementAndOrphan, setPageBackground, setPageBackgroundImage, setNavWrap, renamePage, pageNameTaken } from './mutations.js';
```

Ajouter l'import de la map SVG (à côté de l'import `COMPONENTS` ligne 9) :

```js
import { ICON_SVG } from './render.js';
```

Dans l'objet `SELECTS` (lignes 15-20), ajouter une entrée `symbol` générée depuis les clés de `ICON_SVG` (le `makeInput` générique `SELECTS[kind]` la rendra en `<select>`) :

```js
  symbol:  Object.keys(ICON_SVG).map(n => [n, n]),
```

- [ ] **Step 6 : Section éditeur `states` dans `renderComp`**

Dans `designer/js/inspector.js`, juste après le bloc des seuils ring/meter/bar (la ligne `body.appendChild(add);` qui ferme le `if (c.type === 'ring' || ...)`, vers la l. 157), ajouter un bloc dédié `icon`. Il construit une copie locale éditable et commit via `setIconStates` ; `symbol`/`color` sont optionnels par bande (option `(base)` / case couleur décochée) :

```js
    // --- États icon (table {at, symbol?, color?} ; 1re bande où valeur < at gagne ; omis = base) ---
    if (c.type === 'icon') {
      sub(body, 'États (glyphe/couleur si valeur < seuil)');
      note(body, 'Vide = icône statique. « (base) » / couleur décochée = retombe sur le symbole/la couleur de base.');
      const ref = sel.ref;                                   // figée au rendu (cf. invariant inspecteur)
      const names = Object.keys(ICON_SVG);
      const st = (c.states || []).map(s => ({ ...s }));       // copie locale éditable
      const commit = () => model.commit(s2 => setIconStates(s2, ref, st.map(e => ({
        at: e.at ?? 0,
        ...(e.symbol ? { symbol: e.symbol } : {}),
        ...(e.color ? { color: e.color } : {}),
      }))));
      st.forEach((e, idx) => {
        const row = document.createElement('div'); row.className = 'insp-row';
        const at = makeInput('num', e.at, v => { st[idx].at = v === '' ? 0 : v; commit(); });   // F2 num
        const symSel = document.createElement('select');
        const base = document.createElement('option'); base.value = ''; base.textContent = '(base)';
        symSel.appendChild(base);
        for (const nm of names) { const o = document.createElement('option'); o.value = nm; o.textContent = nm; if (nm === e.symbol) o.selected = true; symSel.appendChild(o); }
        symSel.addEventListener('change', () => { st[idx].symbol = symSel.value || undefined; commit(); });
        const colOn = document.createElement('input'); colOn.type = 'checkbox'; colOn.checked = e.color != null; colOn.title = 'Forcer une couleur';
        const col = document.createElement('input'); col.type = 'color'; col.value = e.color || '#FF0000'; col.disabled = e.color == null;
        colOn.addEventListener('change', () => { col.disabled = !colOn.checked; st[idx].color = colOn.checked ? col.value.toUpperCase() : undefined; commit(); });
        col.addEventListener('change', () => { st[idx].color = col.value.toUpperCase(); commit(); });
        const rm = document.createElement('button'); rm.className = 'insp-th-rm'; rm.textContent = '×';
        rm.addEventListener('click', () => { st.splice(idx, 1); commit(); });
        row.append(at, symSel, colOn, col, rm);
        body.appendChild(row);
      });
      const add = document.createElement('button'); add.className = 'insp-th-add'; add.textContent = '+ état';
      add.addEventListener('click', () => { st.push({ at: 0, symbol: names[0] }); commit(); });
      body.appendChild(add);
    }
```

(Le base `symbol`/`color`/`font` passent par la boucle `compFields` générique — `symbol` via `SELECTS.symbol`, aucun code dédié.)

- [ ] **Step 7 : Vérification navigateur**

Servir en no-store depuis la **racine du repo** (cf. mémoires `designer-verif-navigateur`, `test-server-hygiene`) — `app.js` fait `fetch('../schema/layout.schema.json')`, donc servir depuis `Dialboard/`, pas `designer/` :

```bash
python3 -c "import http.server,functools; http.server.test(HandlerClass=functools.partial(http.server.SimpleHTTPRequestHandler), port=8766)"
```

Ouvrir `http://127.0.0.1:8766/designer/`. Vérifier (capture) :
- Palette : « Icône » apparaît avec son glyphe ; la déposer → un glyphe (bell) blanc s'affiche au canvas.
- Inspecteur : `Symbole` (select 23 noms) change le glyphe ; `Couleur` le recolore (aperçu live) ; `Taille` (14…48) le redimensionne.
- `Valeur (aperçu)` (mock) : ajouter 2 états (`+ état`) p. ex. `at:1 symbol:close color:rouge` et `at:50 color:orange` ; faire varier la valeur (0 → close rouge ; 30 → bell orange [glyphe base, couleur état] ; 90 → bell blanc [base]). Vérifier que `(base)` dans le select et la case couleur décochée retombent bien sur la base.
- `×` supprime un état ; vider tous les états → icône statique.
- `Échap` + clic hors composant désélectionnent.

Arrêter le serveur après.

- [ ] **Step 8 : Commit**

```bash
git add designer/js/mutations.js designer/js/inspector.js designer/tests/mutations.test.js
git commit -m "icone: inspecteur — setIconStates + editeur de table d'etats (at/symbol/color optionnels)"
```

---

## Task 3 : Firmware (résolveur natif + parse + rendu)

**Files:**
- Modify: `src/config.h`
- Modify: `src/dashboard.h`
- Modify: `src/color.h`
- Modify: `src/color.cpp`
- Modify: `src/dashboard.cpp`
- Modify: `src/view.cpp`
- Modify: `test/test_core/test_main.cpp`

- [ ] **Step 1 : Écrire les tests natifs qui échouent**

Dans `test/test_core/test_main.cpp`, ajouter (près des tests `threshold`/`led`) un test du résolveur pur et un test de parse. Le résolveur travaille sur des **indices** (le firmware convertit nom→index au parse) ; on teste la logique de bande indépendamment des noms :

```c
void test_icon_resolve(void) {
    // base = (sym 2, couleur 0x00FF00). Bandes : <15 -> (sym 0, 0xFF0000) ; <50 -> (couleur 0xFFAA00, sym omis)
    IconState st[2];
    st[0].at = 15; st[0].symbol = 0; st[0].color = 0xFF0000; st[0].has_symbol = true;  st[0].has_color = true;
    st[1].at = 50; st[1].symbol = 0; st[1].color = 0xFFAA00; st[1].has_symbol = false; st[1].has_color = true;
    uint8_t sym; uint32_t col;
    icon_resolve(st, 2, 10, 2, 0x00FF00, &sym, &col);   // <15
    TEST_ASSERT_EQUAL_UINT8(0, sym); TEST_ASSERT_EQUAL_HEX32(0xFF0000, col);
    icon_resolve(st, 2, 30, 2, 0x00FF00, &sym, &col);   // <50 : sym omis -> base 2
    TEST_ASSERT_EQUAL_UINT8(2, sym); TEST_ASSERT_EQUAL_HEX32(0xFFAA00, col);
    icon_resolve(st, 2, 90, 2, 0x00FF00, &sym, &col);   // aucune -> base
    TEST_ASSERT_EQUAL_UINT8(2, sym); TEST_ASSERT_EQUAL_HEX32(0x00FF00, col);
    icon_resolve(st, 0, 90, 5, 0x123456, &sym, &col);   // table vide -> base
    TEST_ASSERT_EQUAL_UINT8(5, sym); TEST_ASSERT_EQUAL_HEX32(0x123456, col);
}

static const char* LAYOUT_ICON =
  "{\"components\":{"
    "\"i1\":{\"type\":\"icon\",\"symbol\":\"wifi\",\"color\":\"#00FF00\",\"font\":36,"
      "\"states\":[{\"at\":1,\"symbol\":\"close\",\"color\":\"#FF0000\"},{\"at\":50,\"color\":\"#FFAA00\"}]},"
    "\"i2\":{\"type\":\"icon\"}},"
  "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"i1\"},{\"ref\":\"i2\"}]}]}";

void test_icon_parsed(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE_MESSAGE(dash_set_layout(&d, LAYOUT_ICON, err, sizeof(err)), err);
    int i1 = dash_find(&d, "i1"), i2 = dash_find(&d, "i2");
    TEST_ASSERT_TRUE(i1 >= 0 && i2 >= 0);
    const Component& a = d.components[i1];
    TEST_ASSERT_EQUAL_INT(COMP_ICON, a.type);
    TEST_ASSERT_EQUAL_HEX32(0x00FF00, a.color);
    TEST_ASSERT_EQUAL_INT(36, a.font);
    TEST_ASSERT_EQUAL_INT(2, a.icon_state_count);
    TEST_ASSERT_EQUAL_FLOAT(1.0f, a.icon_states[0].at);
    TEST_ASSERT_TRUE(a.icon_states[0].has_symbol);
    TEST_ASSERT_TRUE(a.icon_states[0].has_color);
    TEST_ASSERT_EQUAL_HEX32(0xFF0000, a.icon_states[0].color);
    TEST_ASSERT_FALSE(a.icon_states[1].has_symbol);    // 2e bande : color seul
    TEST_ASSERT_TRUE(a.icon_states[1].has_color);
    // i2 : défauts (font 28 specifique icon, base bell, pas d'états)
    TEST_ASSERT_EQUAL_INT(28, d.components[i2].font);
    TEST_ASSERT_EQUAL_INT(0, d.components[i2].icon_state_count);
}
```

Enregistrer dans `main()` (à côté des autres `RUN_TEST`, p. ex. après `RUN_TEST(test_schema_types_all_resolve);`) :

```c
    RUN_TEST(test_icon_resolve);
    RUN_TEST(test_icon_parsed);
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pio test -e native`
Expected: FAIL (compilation) — `IconState`, `icon_resolve`, `COMP_ICON`, `icon_states`/`icon_state_count` non déclarés. `test_schema_types_all_resolve` échouerait aussi (parser sans `icon`, schéma à jour depuis Task 1).

- [ ] **Step 3 : `config.h` + `dashboard.h` (enum, struct, constantes)**

Dans `src/config.h`, ajouter (à côté de `#define MAX_THRESHOLDS 4`) :

```c
#define MAX_ICON_STATES         4
```

Dans `src/dashboard.h`, étendre `CompType` (ajouter `COMP_ICON` avant `COMP_COUNT`) :

```c
enum CompType { COMP_NONE, COMP_LABEL, COMP_READOUT, COMP_BAR, COMP_RING, COMP_LED_RING, COMP_SOUND, COMP_CHART, COMP_METER, COMP_IMAGE, COMP_IMAGE_ANIM, COMP_LED, COMP_RECT, COMP_CIRCLE, COMP_LINE, COMP_ICON, COMP_COUNT };
```

Ajouter, après `struct Threshold { ... };` (ligne 15), la struct d'état + le nombre canonique de symboles (partagé par les deux .cpp pour les `static_assert`) :

```c
struct IconState { float at; uint8_t symbol; uint32_t color; bool has_symbol; bool has_color; };
// Nombre de symboles du set curaté (ICON_SYMBOL_NAMES dans dashboard.cpp == ICON_GLYPHS dans view.cpp).
static constexpr int ICON_SYMBOL_COUNT = 23;
```

Ajouter les champs dans `struct Component`, section config (p. ex. après le bloc « formes de base », l. 62) :

```c
    // icon : glyphe/couleur pilotes par la valeur via une table d'etats
    uint8_t   icon_symbol;                       // index du glyphe de base (-> ICON_GLYPHS dans view.cpp)
    IconState icon_states[MAX_ICON_STATES];
    int       icon_state_count;
```

- [ ] **Step 4 : Résolveur pur (`color.h` / `color.cpp`)**

Dans `src/color.h`, ajouter la déclaration (après `led_is_lit`) :

```c
// icon : resout (glyphe, couleur) pour une valeur. 1re bande ou value < at ; champ omis -> base.
// Miroir de threshold_color ; sans LVGL (testable en natif). symbol = index dans ICON_GLYPHS (view.cpp).
void icon_resolve(const IconState* st, int n, float value, uint8_t base_sym, uint32_t base_col,
                  uint8_t* out_sym, uint32_t* out_col);
```

Dans `src/color.cpp`, ajouter l'implémentation (après `led_is_lit`) :

```c
void icon_resolve(const IconState* st, int n, float value, uint8_t base_sym, uint32_t base_col,
                  uint8_t* out_sym, uint32_t* out_col) {
    uint8_t sym = base_sym; uint32_t col = base_col;
    for (int i = 0; i < n; i++) {
        if (value < st[i].at) {
            if (st[i].has_symbol) sym = st[i].symbol;
            if (st[i].has_color)  col = st[i].color;
            break;
        }
    }
    *out_sym = sym; *out_col = col;
}
```

- [ ] **Step 5 : Parse (`dashboard.cpp`)**

Dans `src/dashboard.cpp`, ajouter `icon` à `COMP_NAMES` (après `{ "line", COMP_LINE }`) :

```c
    { "icon", COMP_ICON },
```

Ajouter, avant `dash_set_layout` (à côté de `parse_line_dash`), la table de noms + le mapping nom→index. **L'ORDRE doit être identique à `ICON_GLYPHS` (view.cpp).** :

```c
// Set curaté de symboles. ORDRE == ICON_GLYPHS (view.cpp) ; les deux indexent par la meme valeur.
static const char* const ICON_SYMBOL_NAMES[ICON_SYMBOL_COUNT] = {
    "wifi", "bluetooth", "gps", "usb",
    "battery_empty", "battery_1", "battery_2", "battery_3", "battery_full",
    "charge", "power", "bell", "warning", "ok", "close",
    "play", "pause", "stop", "volume_max", "mute",
    "home", "settings", "refresh",
};
static_assert(sizeof(ICON_SYMBOL_NAMES) / sizeof(ICON_SYMBOL_NAMES[0]) == ICON_SYMBOL_COUNT,
              "ICON_SYMBOL_NAMES desync avec ICON_SYMBOL_COUNT");
static uint8_t icon_symbol_index(const char* s) {
    if (s) for (int i = 0; i < ICON_SYMBOL_COUNT; i++)
        if (!strcmp(s, ICON_SYMBOL_NAMES[i])) return (uint8_t)i;
    return 0;   // miss (impossible apres validation schema) -> 1er glyphe
}
```

Dans `dash_set_layout`, dans le bloc de parsing générique (après la boucle `thresholds`, l. 160, juste avant `t.comp_count++;`), ajouter le parse `icon` :

```c
        if (c.type == COMP_ICON) {
            if (!o["font"].is<int>()) c.font = 28;                 // icon : defaut 28 (vs 20 generique)
            c.icon_symbol = icon_symbol_index(o["symbol"] | "bell");
            JsonArrayConst ist = o["states"].as<JsonArrayConst>();
            for (JsonObjectConst s : ist) {
                if (c.icon_state_count >= MAX_ICON_STATES) break;
                IconState& is = c.icon_states[c.icon_state_count];
                is.at         = s["at"] | 0.0f;
                is.has_symbol = s["symbol"].is<const char*>();
                is.symbol     = is.has_symbol ? icon_symbol_index(s["symbol"]) : 0;
                is.has_color  = s["color"].is<const char*>();
                is.color      = is.has_color ? parse_hex_color(s["color"], 0xFFFFFF) : 0;
                c.icon_state_count++;
            }
        }
```

Ajouter le handler `apply_icon` (à côté de `apply_led`) :

```c
static void apply_icon(Component& c, JsonVariantConst v) {
    JsonVariantConst n; if (value_present(v, n)) c.value = n.as<int>();   // scalaire -> resolution glyphe+couleur
}
```

Ajouter l'entrée dans la table `APPLY[]` (dernière, après `/* COMP_LINE */ apply_shape,`) :

```c
    /* COMP_ICON     */ apply_icon,
```

- [ ] **Step 6 : Rendu (`view.cpp`)**

Dans `src/view.cpp`, ajouter la table glyphes près des autres statiques de fichier (p. ex. après `pick_font`, l. 64). **L'ORDRE doit être identique à `ICON_SYMBOL_NAMES` (dashboard.cpp).** :

```c
// Glyphes du set icon. ORDRE == ICON_SYMBOL_NAMES (dashboard.cpp) : index commun. Symboles built-in
// (deja dans les fontes Montserrat embarquees) -> aucun flag lv_conf.
static const char* const ICON_GLYPHS[ICON_SYMBOL_COUNT] = {
    LV_SYMBOL_WIFI, LV_SYMBOL_BLUETOOTH, LV_SYMBOL_GPS, LV_SYMBOL_USB,
    LV_SYMBOL_BATTERY_EMPTY, LV_SYMBOL_BATTERY_1, LV_SYMBOL_BATTERY_2, LV_SYMBOL_BATTERY_3, LV_SYMBOL_BATTERY_FULL,
    LV_SYMBOL_CHARGE, LV_SYMBOL_POWER, LV_SYMBOL_BELL, LV_SYMBOL_WARNING, LV_SYMBOL_OK, LV_SYMBOL_CLOSE,
    LV_SYMBOL_PLAY, LV_SYMBOL_PAUSE, LV_SYMBOL_STOP, LV_SYMBOL_VOLUME_MAX, LV_SYMBOL_MUTE,
    LV_SYMBOL_HOME, LV_SYMBOL_SETTINGS, LV_SYMBOL_REFRESH,
};
static_assert(sizeof(ICON_GLYPHS) / sizeof(ICON_GLYPHS[0]) == ICON_SYMBOL_COUNT,
              "ICON_GLYPHS desync avec ICON_SYMBOL_NAMES (dashboard.cpp)");
```

Ajouter les fonctions `build_icon`/`sync_icon` (avant `struct ViewVTable`, p. ex. après `build_line`) :

```c
// Icone : lv_label en police de symboles. Glyphe + couleur resolus depuis la valeur (icon_resolve).
static void build_icon(lv_obj_t* parent, Component& c, Placement& q,
                       lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* l = lv_label_create(parent);
    lv_obj_set_style_text_font(l, pick_font(c.font), 0);
    uint8_t sym; uint32_t col;
    icon_resolve(c.icon_states, c.icon_state_count, (float)c.value, c.icon_symbol, c.color, &sym, &col);
    lv_obj_set_style_text_color(l, lv_color_hex(col), 0);
    lv_label_set_text(l, ICON_GLYPHS[sym]);
    lv_obj_align(l, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = l;
}
static void sync_icon(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    uint8_t sym; uint32_t col;
    icon_resolve(c.icon_states, c.icon_state_count, (float)c.value, c.icon_symbol, c.color, &sym, &col);
    lv_obj_set_style_text_color(w, lv_color_hex(col), 0);
    lv_label_set_text(w, ICON_GLYPHS[sym]);
}
```

Ajouter l'entrée dans la table `VIEW[]` (dernière, après `/* COMP_LINE */ { build_line, nullptr },`) :

```c
    /* COMP_ICON     */ { build_icon, sync_icon },
```

- [ ] **Step 7 : Lancer les tests natifs, vérifier le vert**

Run: `pio test -e native`
Expected: PASS — `test_icon_resolve`, `test_icon_parsed`, `test_schema_types_all_resolve` OK.

- [ ] **Step 8 : Compiler le firmware (`static_assert` de table vérifiés à la compilation)**

Run: `pio run -e esp32s3`
Expected: build OK (sinon : `APPLY desync`/`VIEW desync` ⇒ ligne manquante ; `ICON_GLYPHS desync` ⇒ comptes/ordre divergents).

- [ ] **Step 9 : Commit**

```bash
git add src/config.h src/dashboard.h src/color.h src/color.cpp src/dashboard.cpp src/view.cpp test/test_core/test_main.cpp
git commit -m "icone: firmware — icon_resolve (pur) + parse symbol/states + rendu lv_label/LV_SYMBOL"
```

---

## Task 4 : Vérification de bout en bout

**Files:** aucun (vérification) ; mise à jour HANDOFF.

- [ ] **Step 1 : Suites complètes vertes**

```bash
cd designer && node --test && cd ..
pio test -e native
pio run -e esp32s3
```
Expected: designer all PASS ; natif all PASS ; build firmware OK.

- [ ] **Step 2 : Parité navigateur (designer)**

Servir en no-store depuis la racine (cf. Task 2 Step 7). Construire une page avec :
- une icône statique (bell, blanc, taille 48) ;
- une icône « wifi » avec 1 état `at:1` couleur grise (valeur d'aperçu 0 → gris ; 5 → blanc base) ;
- une icône batterie avec 3 états `at:15 battery_empty rouge`, `at:50 battery_2 orange`, base `battery_full vert` (balayer la valeur d'aperçu 5/30/80 → empty rouge / 2 orange / full vert).
Vérifier que chaque glyphe SVG est lisible (sinon affiner le path dans `ICON_SVG` — parité best-effort). Capturer l'écran. Arrêter le serveur.

- [ ] **Step 3 : e2e device (parité firmware ↔ designer)**

⚠ `uploadfs` **efface les assets images du device** (cf. mémoire `uploadfs-efface-assets-device`) : sauvegarder d'abord les assets utiles (`GET /image?key=` etc.) si le device en contient.

```bash
bash tools/stage_fs.sh
pio run -e esp32s3 -t upload
pio run -e esp32s3 -t uploadfs
```

Pousser un layout avec quelques icônes (designer → « Pousser au device », ou `tools/push.py`). Vérifier sur l'écran rond :
- glyphe et taille corrects (bell/wifi/battery/warning…) ;
- `POST /update {"<id>": <valeur>}` change glyphe **et** couleur selon les états (ex. batterie qui baisse) ;
- `POST /update {"<id>":{"visible":false}}` cache l'icône ; `true` la réaffiche ;
- comparer côte à côte avec l'aperçu designer (parité « suffisante » : même famille visuelle ; le dessin exact du glyphe diffère entre FontAwesome et SVG Feather).

- [ ] **Step 4 : Mettre à jour le HANDOFF**

Noter dans `docs/_internal/HANDOFF.md` l'ajout du composant `icon` (livré ; set curaté 23 symboles extensible ; pas de poignées de resize ; reste e2e device si non fait).

```bash
git add docs/_internal/HANDOFF.md
git commit -m "docs: HANDOFF — composant icon livre"
```

(`docs/_internal/` est gitignoré : commit possiblement no-op — dans ce cas, sauter.)

---

## Notes de revue (self-review)

- **Couverture spec** : type `icon` ✓ ; glyphe+couleur dynamiques via 1 valeur ✓ ; table d'états unifiée `{at, symbol?, color?}` ✓ ; sémantique miroir `threshold_color` (1re bande, fallback base, table vide) ✓ — testée des deux côtés (`resolveIcon` node / `icon_resolve` natif) ; symboles built-in, set curaté 23 ✓ ; wire = noms, firmware index ✓ ; parité SVG best-effort ✓ ; placement anchor/dx/dy + font 28, pas de resize ✓ ; `bind`/push ✓ ; `visible` (géré universellement) ✓ ; `lv_conf.h` inchangé ✓.
- **Cohérence des types** : `IconState{at,symbol,color,has_symbol,has_color}` identique entre dashboard.h / parse / icon_resolve / build_icon / sync_icon / test ; `ICON_SYMBOL_COUNT=23` partagé (dashboard.h) et **static_assert** des deux tables ; ordre `ICON_SYMBOL_NAMES` (dashboard.cpp) == `ICON_GLYPHS` (view.cpp) — invariant signalé en commentaire dans les deux fichiers ; `resolveIcon(comp,value)` (JS, noms) ↔ `icon_resolve(st,n,value,base_sym,base_col,out…)` (C, indices) — mêmes règles ; `setIconStates` ↔ clé `states` ; `MOCKS.icon={value:0}`.
- **Conformités testées** : registre↔schéma (auto) ; **enum symbolName ↔ clés `ICON_SVG`** (nouveau test) ; APPLY/VIEW == COMP_COUNT (static_assert) ; ICON_GLYPHS == ICON_SYMBOL_COUNT (static_assert).
- **Pièges adressés** : `LV_SYMBOL_*` **indisponibles en natif** → mapping nom→index dans dashboard.cpp (sans LVGL), index→glyphe dans view.cpp (LVGL) ; `lv_label_set_text` **copie** la chaîne (pas de souci de durée de vie, contrairement à `lv_line`) ; `font` 28 spécifique icon (override du défaut générique 20) ; couleur de state optionnelle → `<input type=color>` non vidable géré par case à cocher (comme `fillField`) ; symbole de state optionnel → option `(base)` dans le select ; aperçu SVG monté via `DOMParser`+`importNode` (pas d'`innerHTML`) + recolorage par `currentColor` ; closures de commit figent `sel.ref` au rendu (invariant inspecteur).
- **Déviation éventuelle** : si un glyphe `ICON_SVG` rend mal au navigateur (path best-effort), l'affiner en Task 4 Step 2 — la parité visuelle exacte n'est pas un invariant (cf. spec).
```
