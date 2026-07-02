# Effecteurs C2 — producteurs designer slider/arc/roller + momentary — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au designer WYSIWYG les producteurs des effecteurs `slider`/`arc`/`roller` (rendus par le firmware depuis B2) et le champ `momentary` du `button`, en parité stricte avec le firmware, sans toucher au firmware.

**Architecture:** On applique le gabarit de la tranche C (PR #25) : rendu canvas dans `render.js`, incrément couplé schéma+registre+icônes+i18n (verrouillé par `registry.test.js`), puis inspecteur. Les `kind` d'inspecteur `orient`/`arcmode`/`bool`/`color`/`num`/`idtext` existent déjà ; seule pièce bespoke neuve : l'éditeur `options` du roller (textarea). L'arc réutilise le rendu SVG du ring (invariant pointer-events).

**Tech Stack:** JS modules ES (designer), tests `node --test`, JSON Schema (Ajv côté designer), C++/LVGL côté firmware (non modifié).

**Spec:** `docs/superpowers/specs/2026-07-01-effecteurs-C2-designer-slider-arc-roller-momentary-design.md`

---

## Contexte de parité (source de vérité — ne pas ré-inventer)

Clés JSON lues par le firmware (vérifiées sur source vive) :
- **slider** (`dashboard.cpp:137-139,166,183`, `view.cpp:585-596`) : `min`(→vmin, déf 0), `max`(→vmax, déf 100), `step`(int, déf 0 = pas de quantif), `orientation`(`horizontal`|`vertical`), `color`(indicateur, déf `#FFFFFF`), `bind`. Placement `width`(déf 200)/`height`(déf 16)/`anchor`/`dx`/`dy`.
- **arc** (`dashboard.cpp:169-170`, `view.cpp:602-617`) : `min`/`max`/`step` (comme slider), `mode`(`normal`|`symmetrical`|`reverse`), `rounded`(bool, déf true), `color`(indicateur), `bind`. Géométrie en **placement** : `radius`(0→diamètre 160), `thickness`(déf 16), `gap_deg`(déf 70), `start_angle`(déf 0). Piste MAIN gris `#1F2937` fixe.
- **roller** (`dashboard.cpp:253-264`, `view.cpp:623-632`) : `options`(array de chaînes, jointes `\n`), `rows`(int, déf 3, borné `[1, MAX_ROLLER_ROWS=7]`), `bind`(écrit l'index). Placement `width`(auto si absent).
- **button** (`dashboard.cpp:239-251`) : champ ajouté `momentary`(bool, déf false). `false`=set (écrit `value`, reflet radio) ; `true`=impulsion.

Constantes firmware : `MAX_ROLLER_ROWS = 7`, `ROLLER_OPTS_LEN = 160` (`src/config.h:15-16`).

Le `$defs/placement` du schéma accepte **déjà** `radius`/`thickness`/`gap_deg`/`start_angle` (utilisés par le ring) → **aucun ajout placement** pour l'arc (`schema/layout.schema.json:436-451`).

---

## File Structure

| Fichier | Rôle | Tâche |
|---|---|---|
| `designer/js/render.js` | +`buildSlider`/`buildArc`/`buildRoller`, +entrées `MOCKS` | T1 |
| `designer/style.css` | +CSS `.w-slider`/`.w-arc`/`.w-roller` (+invariant pointer-events arc) | T1 |
| `schema/layout.schema.json` | +`$defs` `comp_slider`/`comp_arc`/`comp_roller` + refs `oneOf` | T2 |
| `designer/js/registry.js` | +3 entrées `COMPONENTS` (imports builders) | T2 |
| `designer/js/icons.js` | +3 `PATHS` (slider/arc/roller) | T2 |
| `designer/i18n/en.js` + `fr.json` | +clés `comp.*`/`field.*`/tooltips + relabel `field.value` | T2 |
| `designer/js/inspector.js` | +`parseOptions`/`optionsField` (roller) + dispatch + tooltip momentary | T3 |
| `designer/tests/registry.test.js` | assertions des 3 nouveaux types | T2 |
| `designer/tests/schema.test.js` | round-trip par composant | T2 |
| `designer/tests/inspector.test.js` (ou render) | test `parseOptions` | T3 |

---

## Task 1: Rendu canvas (render.js + CSS)

Ajoute les 3 builders (aperçu WYSIWYG) et leurs styles. Rendu non testable unitairement (DOM) → tests « smoke » (fonction exportée) comme `buildSwitch`/`buildButton` ; le comportement visuel est vérifié en T4 (navigateur).

**Files:**
- Modify: `designer/js/render.js` (MOCKS `render.js:9-18` ; ajouter les builders après `buildButton` `render.js:654-666`)
- Modify: `designer/style.css` (après `.w-button-label` `style.css:312` ; bloc pointer-events après `style.css:323`)
- Test: `designer/tests/render.test.js` (créer si absent, sinon y ajouter)

- [ ] **Step 1: Écrire le test smoke (les 3 builders sont exportés et rendent un Node)**

Vérifier d'abord si `designer/tests/render.test.js` existe (`ls designer/tests/`). S'il existe, y ajouter ce bloc ; sinon le créer avec l'en-tête d'import des autres tests (`import { test } from 'node:test'; import assert from 'node:assert/strict';`). Le rendu DOM exige un `document` : les autres tests du designer tournent en `node --test` sans DOM, donc **ne pas** instancier le DOM ici — tester seulement l'export et la signature.

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as render from '../js/render.js';

test('render : buildSlider/buildArc/buildRoller exportés', () => {
  assert.equal(typeof render.buildSlider, 'function');
  assert.equal(typeof render.buildArc, 'function');
  assert.equal(typeof render.buildRoller, 'function');
});

test('render : MOCKS a slider/arc/roller', () => {
  assert.ok('slider' in render.MOCKS);
  assert.ok('arc' in render.MOCKS);
  assert.ok('roller' in render.MOCKS);
});
```

- [ ] **Step 2: Lancer le test — il échoue**

Run: `cd designer && node --test tests/render.test.js`
Expected: FAIL (`buildSlider` is not a function / `MOCKS` sans `slider`).

- [ ] **Step 3: Ajouter les entrées MOCKS**

Dans `designer/js/render.js`, l'objet `MOCKS` (`render.js:9-18`) — ajouter 3 entrées avant la `}` de fermeture (après `icon: { value: 0 }`, en ajoutant une virgule) :

```javascript
  icon:    { value: 0 },
  slider:  { value: 50 },
  arc:     { value: 50 },
  roller:  { value: 0 }
```

- [ ] **Step 4: Ajouter buildSlider**

Après `buildButton` (fin `render.js:666`), ajouter. `barFill` (`render.js:48`) donne la fraction 0..1 clampée ; `font`/`pickFontPx` déjà importés dans le fichier.

```javascript
// slider : piste + indicateur (couleur) + knob, à la position d'aperçu. Orientation h/v (pas de swap
// W/H : le firmware oriente le widget dans la boîte width×height telle quelle, view.cpp:588-591).
export function buildSlider(comp, placement = {}, mock = MOCKS.slider) {
  const w = placement.width || 200, h = placement.height || 16;
  const vert = comp.orientation === 'vertical';
  const wrap = document.createElement('div');
  wrap.className = 'w w-slider';
  wrap.style.width = w + 'px';
  wrap.style.height = h + 'px';
  const track = document.createElement('div');
  track.className = 'w-slider-track';
  const ind = document.createElement('div');
  ind.className = 'w-slider-ind';
  ind.style.background = comp.color || '#38BDF8';
  const frac = barFill(mock.value, comp.min ?? 0, comp.max ?? 100);   // 0..1
  const knob = document.createElement('div');
  knob.className = 'w-slider-knob';
  const kd = vert ? w : h;                          // knob = épaisseur de la piste
  knob.style.width = kd + 'px';
  knob.style.height = kd + 'px';
  if (vert) {                                       // remplit depuis le bas
    ind.style.left = '0'; ind.style.width = '100%';
    ind.style.bottom = '0'; ind.style.height = (frac * 100) + '%';
    knob.style.left = '50%';
    knob.style.bottom = `calc(${frac * 100}% - ${kd / 2}px)`;
    knob.style.transform = 'translateX(-50%)';
  } else {                                          // remplit depuis la gauche
    ind.style.top = '0'; ind.style.height = '100%';
    ind.style.left = '0'; ind.style.width = (frac * 100) + '%';
    knob.style.top = '50%';
    knob.style.left = `calc(${frac * 100}% - ${kd / 2}px)`;
    knob.style.transform = 'translateY(-50%)';
  }
  track.appendChild(ind);
  wrap.appendChild(track);
  wrap.appendChild(knob);
  return wrap;
}
```

- [ ] **Step 5: Ajouter buildArc**

Miroir de `buildRing` (`render.js:251-311`) **sans** centre ni cap (l'arc est un effecteur pur : piste + indicateur). Réutilise `ringPaths`/`SVGNS` (déjà dans le fichier). **Limite assumée** : comme `buildRing`, `ringPaths` ne prend pas `start_angle` → l'ouverture est rendue en bas quel que soit `start_angle` (parité de rendu imparfaite identique au ring ; `start_angle` reste éditable/exporté). Ajouter après `buildSlider` :

```javascript
// arc : effecteur circulaire. Réutilise ringPaths (piste + indicateur) ; pas de centre/cap (≠ ring).
// Piste MAIN gris #1F2937 (view.cpp:613), indicateur comp.color. Invariant pointer-events : seuls les
// paths peints captent le clic (CSS .w-arc) → un clic au centre vide désélectionne.
export function buildArc(comp, placement = {}, mock = MOCKS.arc) {
  const r = placement.radius || 80;
  const th = placement.thickness || 16;
  const gap = placement.gap_deg ?? 70;
  const size = r * 2;
  const wrap = document.createElement('div');
  wrap.className = 'w w-arc';
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const { track, indicator } = ringPaths(r, th, gap, mock.value, comp.min ?? 0, comp.max ?? 100, comp.mode || 'normal');
  const cap = (comp.rounded ?? true) ? 'round' : 'butt';
  const mk = (cls, d, stroke) => {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('class', cls);
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', th);
    p.setAttribute('stroke-linecap', cap);
    return p;
  };
  svg.appendChild(mk('arc-track', track, '#1F2937'));
  svg.appendChild(mk('arc-ind', indicator, comp.color || '#38BDF8'));
  wrap.appendChild(svg);
  return wrap;
}
```

- [ ] **Step 6: Ajouter buildRoller**

Aperçu : colonne d'options, la sélectionnée (index d'aperçu) surlignée. Ajouter après `buildArc` :

```javascript
// roller : colonne d'options, la sélectionnée (index d'aperçu) surlignée. width via placement (auto sinon).
// L'aperçu montre toutes les options seedées ; le firmware n'en montre que `rows` (limite d'aperçu assumée).
export function buildRoller(comp, placement = {}, mock = MOCKS.roller) {
  const opts = Array.isArray(comp.options) ? comp.options : [];
  const wrap = document.createElement('div');
  wrap.className = 'w w-roller';
  if (placement.width) wrap.style.width = placement.width + 'px';
  const sel = Math.max(0, Math.min(opts.length - 1, mock.value | 0));
  const list = document.createElement('div');
  list.className = 'w-roller-list';
  opts.forEach((o, i) => {
    const d = document.createElement('div');
    d.className = 'w-roller-opt' + (i === sel ? ' w-roller-opt--sel' : '');
    d.textContent = o;
    list.appendChild(d);
  });
  wrap.appendChild(list);
  return wrap;
}
```

- [ ] **Step 7: Ajouter le CSS**

Dans `designer/style.css`, après `.w-button-label` (`style.css:312`), ajouter :

```css
.w-slider-track { position: absolute; inset: 0; background: #1F2937; border-radius: 999px; overflow: hidden; }
.w-slider-ind { position: absolute; border-radius: 999px; }
.w-slider-knob { position: absolute; border-radius: 50%; background: #FFFFFF; box-shadow: 0 0 2px rgba(0,0,0,.4); }
.w-arc svg { display: block; }
.w-roller { box-sizing: border-box; background: #1F2937; border-radius: 6px; overflow: hidden; }
.w-roller-list { display: flex; flex-direction: column; }
.w-roller-opt { padding: 2px 12px; color: #9AA0AA; text-align: center; line-height: 1.5; }
.w-roller-opt--sel { color: #FFFFFF; background: #374151; }
```

Puis, après le bloc pointer-events du ring (`.w-ring .ring-track, ... { pointer-events: auto; }`, `style.css:322-323`), ajouter le miroir pour l'arc (le `<svg>` couvre tout le disque → sans ça, un clic au centre vide sélectionnerait l'arc au lieu de désélectionner) :

```css
.w-arc, .w-arc svg { pointer-events: none; }
.w-arc .arc-track, .w-arc .arc-ind, .w-arc .handle { pointer-events: auto; }
```

- [ ] **Step 8: Lancer le test — il passe**

Run: `cd designer && node --test tests/render.test.js`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add designer/js/render.js designer/style.css designer/tests/render.test.js
git commit -m "feat(effecteurs): C2 rendu canvas slider/arc/roller (render.js + CSS)

buildSlider/buildArc/buildRoller + entrées MOCKS. Arc réutilise ringPaths
(piste #1F2937 + indicateur color), pointer-events limités aux parties
peintes (parité invariant ring). 100 % designer, firmware intact.

Claude-Session: https://claude.ai/code/session_01C4QuFHWUNdTQU8D6kwRwF1"
```

---

## Task 2: Schéma + registre + icônes + i18n (incrément couplé parité)

Le test `registry.test.js` impose `Object.keys(COMPONENTS)` == types du schéma → schéma **et** registre dans le même commit. i18n et icônes couplés (comme la tranche C, `55208fe`).

**Files:**
- Modify: `schema/layout.schema.json` (`oneOf` `:107-123` ; nouveaux `$defs` après `comp_button` `:413-420`)
- Modify: `designer/js/registry.js` (import `:11` ; entrées après `button` `:171`)
- Modify: `designer/js/icons.js` (`PATHS` `:8-38`)
- Modify: `designer/i18n/en.js` + `designer/i18n/fr.json`
- Test: `designer/tests/registry.test.js`, `designer/tests/schema.test.js`

- [ ] **Step 1: Écrire les tests (registre + schéma round-trip)**

Dans `designer/tests/registry.test.js`, ajouter (après les tests switch/button `:176-199`) :

```javascript
test('registre : slider/arc/roller présents, non physiques', () => {
  for (const t of ['slider', 'arc', 'roller']) {
    assert.ok(COMPONENTS[t], `${t} absent du registre`);
    assert.equal(COMPONENTS[t].physical, false);
    assert.equal(COMPONENTS[t].defaults().type, t);
  }
});

test('registre : compFields attendus (parité firmware)', () => {
  assert.deepEqual(COMPONENTS.slider.compFields.map(f => f[0]), ['bind', 'min', 'max', 'step', 'orientation', 'color']);
  assert.deepEqual(COMPONENTS.arc.compFields.map(f => f[0]), ['bind', 'min', 'max', 'step', 'mode', 'rounded', 'color']);
  assert.deepEqual(COMPONENTS.roller.compFields.map(f => f[0]), ['bind', 'options', 'rows']);
  assert.ok(COMPONENTS.button.compFields.some(f => f[0] === 'momentary' && f[2] === 'bool'));
});

test('registre : roller.options via kind bespoke "options"', () => {
  assert.equal(COMPONENTS.roller.compFields.find(f => f[0] === 'options')[2], 'options');
  assert.deepEqual(COMPONENTS.roller.defaults().options, ['OFF', 'ON']);
});

test('registre : slider/arc émettent les tailles/géométrie au placement', () => {
  const sl = COMPONENTS.slider.makePlacement('s1', 180, 180);
  assert.equal(sl.width, 200); assert.equal(sl.height, 16);
  const ar = COMPONENTS.arc.makePlacement('a1', 180, 180);
  assert.equal(ar.radius, 80); assert.equal(ar.thickness, 16); assert.equal(ar.gap_deg, 70);
});
```

Dans `designer/tests/schema.test.js` (suivre le style des tests round-trip existants — `validate(layout).valid`), ajouter :

```javascript
test('schema : comp_slider valide (minimal + complet)', () => {
  const min = { components: { s: { type: 'slider' } } };
  const full = { components: { s: { type: 'slider', bind: 'vol', min: 0, max: 10, step: 2, orientation: 'vertical', color: '#38BDF8' } } };
  assert.equal(validate(min).valid, true);
  assert.equal(validate(full).valid, true);
});
test('schema : comp_arc valide + mode/rounded', () => {
  const full = { components: { a: { type: 'arc', bind: 'dim', min: 0, max: 100, step: 5, mode: 'symmetrical', rounded: false, color: '#38BDF8' } } };
  assert.equal(validate(full).valid, true);
});
test('schema : comp_roller exige options', () => {
  const ok = { components: { r: { type: 'roller', options: ['OFF', 'ON'], rows: 3, bind: 'src' } } };
  const noOpts = { components: { r: { type: 'roller', rows: 3 } } };
  assert.equal(validate(ok).valid, true);
  assert.equal(validate(noOpts).valid, false);
});
test('schema : enums invalides rejetés', () => {
  const badOrient = { components: { s: { type: 'slider', orientation: 'diagonal' } } };
  const badMode = { components: { a: { type: 'arc', mode: 'wild' } } };
  assert.equal(validate(badOrient).valid, false);
  assert.equal(validate(badMode).valid, false);
});
test('schema : additionalProperties inconnu rejeté (slider)', () => {
  const bad = { components: { s: { type: 'slider', bogus: 1 } } };
  assert.equal(validate(bad).valid, false);
});
```

- [ ] **Step 2: Lancer les tests — ils échouent**

Run: `cd designer && node --test tests/registry.test.js tests/schema.test.js`
Expected: FAIL (registre sans slider/arc/roller ; schéma sans `comp_slider`… ; le test de parité stricte `registre == schema` échoue aussi).

- [ ] **Step 3: Ajouter les `$defs` au schéma + refs `oneOf`**

Dans `schema/layout.schema.json`, ajouter 3 refs dans `$defs/component.oneOf` (après `{ "$ref": "#/$defs/comp_button" }`, `:123` — ajouter une virgule) :

```json
        { "$ref": "#/$defs/comp_button" },
        { "$ref": "#/$defs/comp_slider" },
        { "$ref": "#/$defs/comp_arc" },
        { "$ref": "#/$defs/comp_roller" }
```

Puis ajouter les 3 `$defs` après le bloc `comp_button` (après sa `}` fermante, `:420`) :

```json
    "comp_slider": {
      "type": "object", "additionalProperties": false, "required": ["type"],
      "description": "Effecteur : curseur linéaire (lv_slider). Écrit bind = valeur (quantifiée si step>0) au glissement (origine UI → arme les sinks). Place via width/height/anchor/dx/dy (défaut 200×16).",
      "properties": {
        "type": { "const": "slider" },
        "visible": { "type": "boolean" },
        "bind": { "$ref": "#/$defs/id", "description": "Variable écrite au glissement (origine UI)." },
        "min": { "type": "number", "description": "Borne basse (défaut 0)." },
        "max": { "type": "number", "description": "Borne haute (défaut 100)." },
        "step": { "type": "integer", "description": "Pas de quantification. <=0 = valeur brute (défaut 0)." },
        "orientation": { "enum": ["horizontal", "vertical"], "description": "Sens du curseur (défaut horizontal)." },
        "color": { "$ref": "#/$defs/hexColor", "description": "Couleur de l'indicateur (défaut #FFFFFF)." }
      }
    },
    "comp_arc": {
      "type": "object", "additionalProperties": false, "required": ["type"],
      "description": "Effecteur : cadran circulaire (lv_arc). Écrit bind = valeur (quantifiée si step>0) au tournoiement. Géométrie via placement radius/thickness/gap_deg/start_angle (comme le ring). Piste grise, indicateur coloré.",
      "properties": {
        "type": { "const": "arc" },
        "visible": { "type": "boolean" },
        "bind": { "$ref": "#/$defs/id", "description": "Variable écrite au tournoiement (origine UI)." },
        "min": { "type": "number", "description": "Borne basse (défaut 0)." },
        "max": { "type": "number", "description": "Borne haute (défaut 100)." },
        "step": { "type": "integer", "description": "Pas de quantification. <=0 = valeur brute (défaut 0)." },
        "mode": { "enum": ["normal", "symmetrical", "reverse"], "description": "Sens de remplissage (défaut normal)." },
        "rounded": { "type": "boolean", "description": "Extrémités arrondies (défaut true)." },
        "color": { "$ref": "#/$defs/hexColor", "description": "Couleur de l'indicateur (défaut #FFFFFF)." }
      }
    },
    "comp_roller": {
      "type": "object", "additionalProperties": false, "required": ["type", "options"],
      "description": "Effecteur : molette de sélection (lv_roller). Écrit bind = index sélectionné (numérique) au défilement. Place via width/anchor/dx/dy (hauteur auto = rows lignes).",
      "properties": {
        "type": { "const": "roller" },
        "visible": { "type": "boolean" },
        "bind": { "$ref": "#/$defs/id", "description": "Variable écrite à la sélection (index numérique)." },
        "options": { "type": "array", "items": { "$ref": "#/$defs/display" }, "minItems": 1, "description": "Libellés des options (une par ligne dans l'éditeur)." },
        "rows": { "type": "integer", "minimum": 1, "maximum": 7, "description": "Rangées visibles (défaut 3, max MAX_ROLLER_ROWS)." }
      }
    },
```

Note : `maximum: 7` = valeur littérale de `MAX_ROLLER_ROWS` (`src/config.h:16`). Si cette constante change côté firmware, ajuster ici.

- [ ] **Step 4: Ajouter les icônes**

Dans `designer/js/icons.js`, dans l'objet `PATHS` (après `button:`, `:38`), ajouter (SVG monochrome `currentColor`, viewBox 24) :

```javascript
  slider: '<line x1="3" y1="12" x2="21" y2="12"/>' +
          '<circle cx="14" cy="12" r="3" fill="currentColor" stroke="none"/>',
  arc:    '<path d="M4 16 A 9 9 0 1 1 20 16" fill="none"/>' +
          '<circle cx="20" cy="16" r="2.2" fill="currentColor" stroke="none"/>',
  roller: '<rect x="5" y="4" width="14" height="16" rx="2"/>' +
          '<line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/>' +
          '<polyline points="9 7 12 5.5 15 7" fill="none"/>',
```

- [ ] **Step 5: Ajouter les entrées registre**

Dans `designer/js/registry.js`, étendre l'import de `render.js` (`:11`) avec les 3 builders :

```javascript
import { buildLabel, buildReadout, buildBar, buildRing, buildChart, buildMeter, buildImage, buildImageAnim, buildLed, buildRect, buildCircle, buildLine, buildIcon, buildSwitch, buildButton, buildSlider, buildArc, buildRoller } from './render.js';
```

Ajouter le champ `momentary` au `button` (`:166`) — insérer après `value` :

```javascript
    compFields: [['text', 'field.text', 'latintext'], ['value', 'field.value', 'value'], ['momentary', 'field.momentary', 'bool'], ['bind', 'field.bind', 'idtext']],
```

Insérer les 3 entrées **juste après** le `button` (après sa `},` `:171`), pour regrouper les effecteurs dans l'ordre du registre :

```javascript
  slider: {
    label: 'comp.slider',
    defaults: () => ({ type: 'slider', min: 0, max: 100, color: '#38BDF8' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), width: 200, height: 16 }),
    centered: false, physical: false,
    compFields: [['bind', 'field.bind', 'idtext'], ['min', 'field.min', 'num'], ['max', 'field.max', 'num'],
                 ['step', 'field.step', 'num'], ['orientation', 'field.orientation', 'orient'], ['color', 'field.color', 'color']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['width', 'field.width', 'num', 200], ['height', 'field.height', 'num', 16]],  // 4e = défaut firmware (view.cpp:588)
    mockFields: [['value', 'field.mock_value']],
    build: (comp, pl, mock) => buildSlider(comp, pl, mock),
  },
  arc: {
    label: 'comp.arc',
    defaults: () => ({ type: 'arc', min: 0, max: 100, color: '#38BDF8' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), radius: 80, thickness: 16, gap_deg: 70 }),
    centered: false, physical: false,
    compFields: [['bind', 'field.bind', 'idtext'], ['min', 'field.min', 'num'], ['max', 'field.max', 'num'],
                 ['step', 'field.step', 'num'], ['mode', 'field.mode', 'arcmode'], ['rounded', 'field.rounded', 'bool'], ['color', 'field.color', 'color']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['radius', 'field.radius', 'num'], ['thickness', 'field.thickness', 'num'], ['gap_deg', 'field.gap_deg', 'num'], ['start_angle', 'field.start_angle', 'num']],
    mockFields: [['value', 'field.mock_value']],
    build: (comp, pl, mock) => buildArc(comp, pl, mock),
  },
  roller: {
    label: 'comp.roller',
    defaults: () => ({ type: 'roller', options: ['OFF', 'ON'], rows: 3 }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), width: 120 }),
    centered: false, physical: false,
    compFields: [['bind', 'field.bind', 'idtext'], ['options', 'field.options', 'options'], ['rows', 'field.rows', 'num']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['width', 'field.width', 'num', 120]],
    mockFields: [['value', 'field.mock_value']],
    build: (comp, pl, mock) => buildRoller(comp, pl, mock),
  },
```

- [ ] **Step 6: Ajouter les clés i18n (EN + FR)**

Dans `designer/i18n/en.js` — ajouter (les clés `field.min`/`max`/`color`/`orientation`/`mode`/`rounded`/`radius`/`thickness`/`gap_deg`/`start_angle`/`width`/`height`/`bind`/`mock_value` et `select.orient.*`/`select.arcmode.*` **existent déjà** via bar/ring/line ; n'ajouter que les manquantes) :

```javascript
  'comp.slider': 'Slider',
  'comp.arc': 'Arc',
  'comp.roller': 'Roller',
  'field.step': 'Step',
  'field.options': 'Options',
  'field.rows': 'Rows',
  'field.momentary': 'Momentary',
  'inspector.tip.value_mode': 'Set: written on tap (radio reflect). Momentary: pulse then reset.',
```

Et **modifier** la clé existante `field.value` (aujourd'hui `'Value (set)'`) en `'Value'` (label neutre : le sens set/momentary est porté par l'infobulle).

Dans `designer/i18n/fr.json` — ajouter les traductions correspondantes et modifier `field.value` :

```json
  "comp.slider": "Slider",
  "comp.arc": "Arc",
  "comp.roller": "Roller",
  "field.step": "Pas",
  "field.options": "Options",
  "field.rows": "Rangées",
  "field.momentary": "Momentané",
  "field.value": "Valeur",
  "inspector.tip.value_mode": "Set : écrit au tap (reflet radio). Momentané : impulsion puis reset.",
```

(`field.value` FR passe de `"Valeur (set)"` à `"Valeur"`.)

- [ ] **Step 7: Lancer les tests + parité i18n**

Run: `cd designer && node --test`
Expected: PASS (registry + schema, dont le test de parité stricte registre==schéma).

Run (depuis la racine) le one-liner de parité i18n :
```bash
node -e "import('./designer/i18n/en.js').then(m=>{const en=m.default;const fr=JSON.parse(require('fs').readFileSync('./designer/i18n/fr.json','utf8'));const ek=Object.keys(en),fk=Object.keys(fr);console.log('EN',ek.length,'FR',fk.length,'EN-only',ek.filter(k=>!fk.includes(k)),'FR-only',fk.filter(k=>!ek.includes(k)));})"
```
Expected: `EN n FR n EN-only [] FR-only []` (compteurs égaux).

- [ ] **Step 8: Commit**

```bash
git add schema/layout.schema.json designer/js/registry.js designer/js/icons.js designer/i18n/en.js designer/i18n/fr.json designer/tests/registry.test.js designer/tests/schema.test.js
git commit -m "feat(effecteurs): C2 schéma+registre+icônes+i18n slider/arc/roller + momentary

Incrément couplé parité (registry.test.js reste vert) : 3 \$defs
comp_slider/arc/roller + refs oneOf, 3 entrées registre (effecteurs
regroupés après button), champ momentary du button, icônes, i18n EN+FR
(field.value relabellé neutre). roller options = kind bespoke (T3).

Claude-Session: https://claude.ai/code/session_01C4QuFHWUNdTQU8D6kwRwF1"
```

---

## Task 3: Inspecteur — éditeur `options` (roller) + tooltip momentary

`momentary`/`orientation`/`mode`/`step`/`color` passent déjà par les kinds génériques (`bool`/`orient`/`arcmode`/`num`/`color`) dès leur déclaration en T2 — **rien à faire pour eux ici**. Seul neuf : le kind bespoke `options` (textarea) + l'infobulle du label `value`.

**Files:**
- Modify: `designer/js/inspector.js` (helper `parseOptions` près du haut ; `optionsField` près de `valueField` `:429-448` ; dispatch dans `renderComp` `:626` ; tooltip dans `valueField`)
- Test: `designer/tests/inspector.test.js` (créer si absent) — teste `parseOptions` (fonction pure exportée)

- [ ] **Step 1: Écrire le test de parseOptions**

Créer (ou compléter) `designer/tests/inspector.test.js` :

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions } from '../js/inspector.js';

test('parseOptions : une option par ligne, vides retirées', () => {
  assert.deepEqual(parseOptions('OFF\nLOW\nHIGH'), ['OFF', 'LOW', 'HIGH']);
  assert.deepEqual(parseOptions('  OFF \n\n  ON\n'), ['OFF', 'ON']);   // trim + lignes vides ignorées
  assert.deepEqual(parseOptions(''), []);
  assert.deepEqual(parseOptions('   \n  '), []);
});
```

- [ ] **Step 2: Lancer le test — il échoue**

Run: `cd designer && node --test tests/inspector.test.js`
Expected: FAIL (`parseOptions` is not exported).

- [ ] **Step 3: Exporter `parseOptions` (fonction pure)**

Dans `designer/js/inspector.js`, près des autres helpers de haut de module (ex. après `nonId` `:29`), ajouter :

```javascript
// Découpe le texte de l'éditeur d'options du roller (une par ligne) → tableau, lignes vides retirées.
// Miroir du join '\n' firmware (dashboard.cpp:255-259). Exportée pour test.
export function parseOptions(text) {
  return (text ?? '').split('\n').map(s => s.trim()).filter(Boolean);
}
```

- [ ] **Step 4: Lancer le test — il passe**

Run: `cd designer && node --test tests/inspector.test.js`
Expected: PASS.

- [ ] **Step 5: Ajouter `optionsField` (bespoke) + brancher le dispatch**

Dans `designer/js/inspector.js`, ajouter `optionsField` juste après `valueField` (`:448`). Modèle : `valueField`/`fillField` (ref figée, commit sur `change`, avertissement rouge `.insp-warn` si vide — comme le body JSON invalide des sinks) :

```javascript
  // Éditeur « Options » du roller : textarea, une option par ligne (miroir du join '\n' firmware).
  // Commit sur 'change' → tableau (lignes vides retirées) ; vide → avertissement rouge + PAS de commit.
  // ref figée au rendu (invariant inspecteur : le 'change' peut partir après un changement de sélection).
  function optionsField(label, c) {
    const ref = sel.ref;
    const row = document.createElement('div'); row.className = 'insp-row';
    const span = document.createElement('span'); span.className = 'insp-label'; span.textContent = t(label);
    row.appendChild(span);
    const ta = document.createElement('textarea');
    ta.className = 'insp-options';
    ta.rows = 4;
    ta.value = Array.isArray(c.options) ? c.options.join('\n') : '';
    const warn = document.createElement('span'); warn.className = 'insp-warn';
    warn.textContent = t('inspector.warn.options_empty');
    warn.style.display = 'none';
    ta.addEventListener('change', () => {
      const opts = parseOptions(ta.value);
      if (!opts.length) { warn.style.display = ''; return; }   // vide : avertir, pas de commit
      warn.style.display = 'none';
      model.commit(s => setComponentProp(s, ref, 'options', opts));
    });
    row.append(ta, warn);
    return row;
  }
```

Brancher le dispatch dans `renderComp` — après la ligne `value` (`:626`), ajouter :

```javascript
        if (kind === 'options') { propBody.appendChild(optionsField(label, c)); continue; }   // roller : liste bespoke
```

- [ ] **Step 6: Ajouter le tooltip sur le label de `valueField`**

Dans `valueField` (`:429-448`), après la création du `span` (`span.textContent = t(label);`), ajouter l'infobulle set/momentary :

```javascript
    span.title = t('inspector.tip.value_mode');
```

- [ ] **Step 7: Ajouter les clés i18n de T3 (EN + FR) + CSS**

Dans `designer/i18n/en.js` : `'inspector.warn.options_empty': 'At least one option required',`
Dans `designer/i18n/fr.json` : `"inspector.warn.options_empty": "Au moins une option requise",`

Dans `designer/style.css`, après le bloc `.src-field textarea` (ajouté en tranche C) ou près de `.insp-row`, garantir la pleine largeur du textarea d'options :

```css
.insp-options { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; }
```

- [ ] **Step 8: Lancer toute la suite + parité i18n**

Run: `cd designer && node --test`
Expected: PASS (tous, dont `parseOptions` et la parité registre==schéma).

Run le one-liner de parité i18n (cf. T2 Step 7) : `EN-only []` et `FR-only []`.

- [ ] **Step 9: Commit**

```bash
git add designer/js/inspector.js designer/i18n/en.js designer/i18n/fr.json designer/style.css designer/tests/inspector.test.js
git commit -m "feat(effecteurs): C2 inspecteur — éditeur options (roller) + tooltip momentary

optionsField bespoke (textarea, une par ligne, vide→avertissement rouge,
pas de commit) via parseOptions pure testée. Infobulle set/momentary sur
le label Valeur. momentary/orientation/mode/step passent par les kinds
génériques existants.

Claude-Session: https://claude.ai/code/session_01C4QuFHWUNdTQU8D6kwRwF1"
```

---

## Task 4: Vérification finale + QA navigateur

Aucun code de production ici : on prouve la parité et la non-régression.

**Files:** aucun (vérification). QA via serveur no-store (cf. mémoire `designer-verif-navigateur`).

- [ ] **Step 1: Suite designer complète**

Run: `cd designer && node --test`
Expected: tous verts (compter les tests ; noter le total). Le test de parité stricte registre==schéma passe.

- [ ] **Step 2: Sanity firmware (non modifié)**

Run: `pio test -e native` puis `pio run -e esp32s3`
Expected: natif inchangé vs `main` ; esp32s3 SUCCESS. Vérifier `git diff main -- src/ lib/ platformio.ini` = **vide** (invariant « zéro firmware »).

- [ ] **Step 3: Parité i18n**

Run le one-liner (cf. T2 Step 7). Expected: compteurs EN==FR, 0 orpheline.

- [ ] **Step 4: QA navigateur (EN + FR)**

Servir en no-store depuis la racine (port ≠ 8000, cf. mémoire `test-server-hygiene`), piloter avec de vrais events pointer. Vérifier :
- **palette** : slider/arc/roller glissables ; icônes distinctes. **Noter la répartition réelle par quadrant** (la distribution mécanique de `canvas-zones.js` équilibre l'ordre du registre sur 4 zones ; avec +3 composants, les 5 effecteurs peuvent déborder du quadrant « special » vers « shapes » — cf. Risques). Non bloquant.
- **placement + rendu** : slider 200×16 (orientation h puis v), arc en cadran (piste grise + indicateur coloré), roller à plusieurs options avec sélection surlignée.
- **inspecteur** : éditer tous les champs (min/max/step/orientation/mode/rounded/color/rows) ; **button momentary** (case) + label « Valeur » neutre + infobulle ; **options roller** (textarea → array ; vider → avertissement rouge `var(--err)` + PAS de commit ; ré-remplir → commit).
- **désélection** : cliquer au **centre d'un arc** (zone vide du disque) **désélectionne** (invariant pointer-events).
- **validation** : un layout contenant slider+arc+roller+button momentary → **✓ valid** (validateur réel).
- **console** : 0 erreur ; **FR** intégral (Slider/Arc/Roller, Pas, Options, Rangées, Momentané, Valeur).

- [ ] **Step 5: Revue holistique + nettoyage**

Relire le diff complet (`git diff main`) contre la spec §3 (parité champ par champ). Arrêter les serveurs de test, supprimer les captures QA. Consigner l'état dans `docs/_internal/HANDOFF.md` + mémoire `effecteurs-plan.md` (C2 livré).

- [ ] **Step 6: Décision de finalisation**

Proposer à l'utilisateur : PR (comme tranche C) ou itération. Ne pas pousser sans demande explicite (cf. CLAUDE.md). `uploadfs` du designer à jour = étape de déploiement séparée (⚠ efface les assets device).

---

## Risques & pièges (rappel)

- **Répartition palette** : `canvas-zones.js::distribute()` répartit l'ordre du registre en 4 quadrants équilibrés. Avec 18 composants non-physiques, les tailles sont [5,5,4,4] → switch/button/slider/arc tombent dans « special », **roller déborde dans « shapes »**. Les libellés de famille sont déjà approximatifs (note de maintenance existante). **Écart assumé vs le design** (« quadrant special ») : cosmétique, non bloquant ; un ré-alignement des libellés/ordre est une passe séparée hors parité.
- **`start_angle` non rendu** dans l'aperçu arc (comme le ring : `ringPaths` ne le prend pas) — éditable/exporté mais ouverture toujours en bas. Limite de parité de rendu identique au ring existant.
- **Invariant pointer-events arc** : sans le bloc CSS `.w-arc { pointer-events: none }` + `.arc-track/.arc-ind { auto }`, le `<svg>` capterait tout le disque → clic au centre ne désélectionne pas. Vérifié en T4 Step 4.
- **`optionsField` — invariants inspecteur** : `ref` figée au rendu, commit sur `change`, blur avant changement de sélection (géré par `inspector.select`). Vide → avertissement, pas de commit (jamais `options: []` committé).
- **Slider orientation ≠ bar** : le bar échange W/H (`setBarOrientation`, condition `c.type === 'bar'`) ; le slider passe par le commit générique → pas de swap (parité firmware `view.cpp:588-591`).
- **`step` entier** : firmware `o["step"]|0` int, schéma `integer` ; le kind `num` peut émettre un flottant → le validateur signalera un non-entier (comportement toléré, cf. Minor tranche C).
