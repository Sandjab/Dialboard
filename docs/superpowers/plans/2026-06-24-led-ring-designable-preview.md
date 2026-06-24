# LED ring designable + aperçu live (niveau B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le composant physique `led_ring` pleinement éditable dans le designer (mode/période/valeur d'aperçu, persistés dans le layout) et transformer le liseré décoratif du canvas en un aperçu fidèle des 13 LEDs.

**Architecture:** Le schéma `comp_led_ring` gagne `mode`+`period_ms` ; le firmware initialise l'anneau depuis la config au boot (et `/update` surcharge toujours, via un `parse_led_mode` partagé). Côté designer, un module pur `led-ring-preview.js` calcule l'état des 13 LEDs (statique ou animé) ; il peint le liseré du canvas (statique, calme) et un mini-aperçu animable (▶) dans le panneau Device.

**Tech Stack:** C++/Arduino (firmware, ArduinoJson, Unity natif), JS modules ES (designer, `node --test`), JSON Schema (ajv).

**Spec :** `docs/superpowers/specs/2026-06-24-led-ring-designable-preview-design.md`.

**Branche :** `feat/led-ring-designable-preview` (déjà créée).

**Convention commits :** conventional commits en français ; terminer chaque message par le trailer `Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV`.

**Note de réalisation (7c) :** le canvas reste **calme** (frame statique représentative, jamais d'animation permanente) ; l'animation (spinner/blink/breathe) se joue à la demande via un bouton **▶ Aperçu** dans le panneau Device — motif calqué sur le `▶ Aperçu` existant d'`image_anim` (`inspector.js`). C'est la concrétisation de « animation seulement quand on travaille l'anneau », les composants physiques n'ayant pas d'état « sélectionné » sur le canvas.

---

## Contrats partagés (référence pour toutes les tâches)

- **Modes** : `off | solid | progress | spinner | blink | breathe` (6).
- **Champs persistés** `comp_led_ring` : `color`, `brightness` (0–255, déf. 64), `mode` (déf. `off`), `period_ms` (100–10000, déf. 1000). `value` = **mock designer** (jamais dans le layout).
- **`LED_RING_COUNT = 13`**.
- **`ledFrame(comp, mock)`** → `{ color, alpha, on:bool[13], mode }` (frame statique représentative).
- **`ledFrameAt(comp, mock, nowMs)`** → idem mais animé (spinner/blink/breathe), miroir de `led_ring_comp.cpp`.
- **`paintRing(container, frame)`** → peint 13 `.led-dot` positionnés en cercle.

---

## Task 1 : Schéma — `mode` + `period_ms`

**Files:**
- Modify: `schema/layout.schema.json` (def `comp_led_ring`, ~lignes 173-182)
- Test: `designer/tests/schema.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à la fin de `designer/tests/schema.test.js` :

```js
test('schema : led_ring accepte mode + period_ms', () => {
  const l = base();
  l.components.r = { type: 'led_ring', color: '#FF9F40', brightness: 120, mode: 'breathe', period_ms: 2500 };
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : led_ring rejette un mode inconnu', () => {
  const l = base();
  l.components.r = { type: 'led_ring', mode: 'rainbow' };
  assert.equal(validate(l).valid, false);
});

test('schema : led_ring rejette value (mock, hors layout)', () => {
  const l = base();
  l.components.r = { type: 'led_ring', value: 50 };
  assert.equal(validate(l).valid, false);
});

test('schema : led_ring rejette period_ms hors bornes', () => {
  const l = base();
  l.components.r = { type: 'led_ring', period_ms: 50 };
  assert.equal(validate(l).valid, false);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `led_ring accepte mode + period_ms` échoue (mode/period_ms refusés par `additionalProperties:false`).

- [ ] **Step 3 : Enrichir le schéma**

Dans `schema/layout.schema.json`, remplacer la def `comp_led_ring` par :

```json
    "comp_led_ring": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "properties": {
        "type": { "const": "led_ring" },
        "color": { "$ref": "#/$defs/hexColor", "description": "Couleur par defaut." },
        "brightness": { "type": "integer", "minimum": 0, "maximum": 255, "description": "Luminosite par defaut (defaut 64). Anneau physique 13x WS2812." },
        "mode": { "enum": ["off", "solid", "progress", "spinner", "blink", "breathe"], "description": "Mode de boot (defaut off). Surchargeable a chaud via /update." },
        "period_ms": { "type": "integer", "minimum": 100, "maximum": 10000, "description": "Periode d'animation (spinner/blink/breathe), ms. Defaut 1000." }
      }
    },
```

- [ ] **Step 4 : Relancer les tests, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS (tous, y compris « le registre couvre exactement les types du schema »).

- [ ] **Step 5 : Commit**

```bash
git add schema/layout.schema.json designer/tests/schema.test.js
git commit -m "feat(schema): led_ring — mode + period_ms persistés" -m "Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

## Task 2 : Firmware — `parse_led_mode` partagé

**Files:**
- Modify: `src/dashboard.cpp` (ajout helper ~après `parse_line_dash` l.69 ; refactor `apply_led_ring` l.306-318)
- Test: `test/test_core/test_main.cpp` (le test `test_update_led_ring_mode_color_value` existant doit rester vert)

- [ ] **Step 1 : Ajouter le helper partagé**

Dans `src/dashboard.cpp`, juste après la fonction `parse_line_dash` (fin vers la ligne 69) :

```cpp
static LedMode parse_led_mode(const char* s, LedMode def) {
    if (!s)                       return def;
    if (!strcmp(s, "off"))        return LED_OFF;
    if (!strcmp(s, "solid"))      return LED_SOLID;
    if (!strcmp(s, "progress"))   return LED_PROGRESS;
    if (!strcmp(s, "spinner"))    return LED_SPINNER;
    if (!strcmp(s, "blink"))      return LED_BLINK;
    if (!strcmp(s, "breathe"))    return LED_BREATHE;
    return def;
}
```

- [ ] **Step 2 : Refactorer `apply_led_ring` pour l'utiliser (comportement /update inchangé)**

Remplacer la fonction `apply_led_ring` (l.306-318) par :

```cpp
static void apply_led_ring(Component& c, JsonVariantConst v) {
    if (v["mode"].is<const char*>())  c.led_mode  = parse_led_mode(v["mode"], c.led_mode);
    if (v["color"].is<const char*>()) c.led_color = parse_hex_color(v["color"], c.led_color);
    c.led_value      = v["value"]      | c.led_value;
    c.led_brightness = v["brightness"] | c.led_brightness_cfg;
    c.led_period_ms  = v["period_ms"]  | (c.led_period_ms ? c.led_period_ms : 1000);
}
```

- [ ] **Step 3 : Lancer les tests natifs, vérifier la non-régression**

Run: `pio test -e native`
Expected: PASS — en particulier `test_update_led_ring_mode_color_value` (mode `progress`→`LED_PROGRESS`, color, value, period_ms) reste vert : le refactor préserve la sémantique /update.

- [ ] **Step 4 : Commit**

```bash
git add src/dashboard.cpp
git commit -m "refactor(dashboard): parse_led_mode partagé (config + /update)" -m "Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

## Task 3 : Firmware — la config pilote l'anneau au boot

**Files:**
- Modify: `src/dashboard.cpp` (boucle de parse de `dash_set_layout`, après le bloc `if (c.type == COMP_ICON)` l.192, avant `t.comp_count++` l.193)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter dans `test/test_core/test_main.cpp`, juste après `test_update_led_ring_mode_color_value` (~l.352) :

```cpp
void test_led_ring_config_drives_boot(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"r\":{\"type\":\"led_ring\",\"color\":\"#FF9F40\","
                    "\"brightness\":120,\"mode\":\"breathe\",\"period_ms\":2500}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "r");
    TEST_ASSERT_EQUAL_INT(LED_BREATHE, d.components[i].led_mode);
    TEST_ASSERT_EQUAL_HEX32(0xFF9F40, d.components[i].led_color);
    TEST_ASSERT_EQUAL_UINT8(120, d.components[i].led_brightness);
    TEST_ASSERT_EQUAL_UINT16(2500, d.components[i].led_period_ms);
}

void test_led_ring_config_defaults_off(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"r\":{\"type\":\"led_ring\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "r");
    TEST_ASSERT_EQUAL_INT(LED_OFF, d.components[i].led_mode);     // défaut : éteint au boot
    TEST_ASSERT_EQUAL_UINT16(1000, d.components[i].led_period_ms);
}
```

Et enregistrer les deux tests dans `main()` (près de `RUN_TEST(test_update_led_ring_mode_color_value);` ~l.982) :

```cpp
    RUN_TEST(test_led_ring_config_drives_boot);
    RUN_TEST(test_led_ring_config_defaults_off);
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pio test -e native`
Expected: FAIL — `test_led_ring_config_drives_boot` échoue (au boot `led_mode`=`LED_OFF`, `led_color`=0, `led_period_ms`=0 : la config n'est pas encore adoptée).

- [ ] **Step 3 : Adopter la config au parse**

Dans `src/dashboard.cpp`, insérer **après** le bloc `if (c.type == COMP_ICON) { … }` (fermante l.192) et **avant** `t.comp_count++;` (l.193) :

```cpp
        if (c.type == COMP_LED_RING) {                    // config -> état initial du driver (boot vivant)
            c.led_color      = c.color;                   // (sinon le driver retombe sur blanc tant qu'aucun /update)
            c.led_brightness = c.led_brightness_cfg;
            c.led_mode       = parse_led_mode(o["mode"], LED_OFF);
            c.led_period_ms  = o["period_ms"] | 1000;
            c.led_value      = 0;                         // progress part de 0 jusqu'au 1er /update
        }
```

- [ ] **Step 4 : Relancer, vérifier le succès**

Run: `pio test -e native`
Expected: PASS — les deux nouveaux tests + tous les anciens.

- [ ] **Step 5 : Vérifier que le firmware compile (cible réelle)**

Run: `pio run -e esp32s3`
Expected: build OK (le driver `led_ring_comp.cpp` lit déjà `led_mode/led_color/led_period_ms` ; aucun changement requis côté driver).

- [ ] **Step 6 : Commit**

```bash
git add src/dashboard.cpp test/test_core/test_main.cpp
git commit -m "feat(dashboard): led_ring piloté par la config au boot" -m "Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

## Task 4 : Designer — registre `led_ring` + `LED_MODES` + mock

**Files:**
- Modify: `designer/js/registry.js` (export `LED_MODES` ; def `led_ring` l.170-179)
- Modify: `designer/js/render.js` (objet `MOCKS` l.9-17)
- Test: `designer/tests/registry.test.js`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `designer/tests/registry.test.js` :

```js
test('registre : led_ring expose mode/period_ms + value (mock), défaut mode off', () => {
  const cf = COMPONENTS.led_ring.compFields;
  const keys = cf.map(f => f[0]);
  for (const k of ['color', 'brightness', 'mode', 'period_ms']) {
    assert.ok(keys.includes(k), `led_ring : ${k} manquant`);
  }
  const period = cf.find(f => f[0] === 'period_ms');
  assert.equal(typeof period[3], 'function', 'period_ms doit porter un enableWhen (4e élément)');
  assert.equal(period[3]({ mode: 'spinner' }), true);
  assert.equal(period[3]({ mode: 'solid' }), false);
  assert.deepEqual(COMPONENTS.led_ring.mockFields, [['value', 'Valeur % (aperçu)']]);
  assert.equal(COMPONENTS.led_ring.defaults().mode, 'off');
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL (`led_ring.compFields` n'a ni `mode` ni `period_ms` ; `defaults().mode` indéfini).

- [ ] **Step 3 : Ajouter `LED_MODES` et enrichir `led_ring`**

Dans `designer/js/registry.js`, ajouter en tête (après les imports) :

```js
// Modes de l'anneau LED physique (value firmware → libellé FR). Partagé designer/firmware via le schéma.
export const LED_MODES = [
  ['off', 'Éteint'], ['solid', 'Plein'], ['progress', 'Progression'],
  ['spinner', 'Rotation'], ['blink', 'Clignotant'], ['breathe', 'Respiration'],
];
```

Puis remplacer l'entrée `led_ring` (l.170-179) par :

```js
  led_ring: {
    label: 'LED ring',
    defaults: () => ({ type: 'led_ring', color: '#FFFFFF', brightness: 64, mode: 'off' }),
    makePlacement: (id) => ({ ref: id }),
    centered: false, physical: true, singleton: true,
    compFields: [
      ['color', 'Couleur', 'color'],
      ['brightness', 'Luminosité (0-255)', 'num'],
      ['mode', 'Mode', 'ledmode'],
      ['period_ms', 'Période (ms)', 'num', c => ['spinner', 'blink', 'breathe'].includes(c.mode)],
    ],
    placeFields: [],
    mockFields: [['value', 'Valeur % (aperçu)']],
    build: null,   // physique : édité dans le panneau « Device », l'aperçu passe par led-ring-preview.js
  },
```

- [ ] **Step 4 : Ajouter le mock par défaut**

Dans `designer/js/render.js`, dans l'objet `MOCKS` (l.9-17), ajouter la ligne `led` voisine :

```js
  led:     { value: 1 },
  led_ring:{ value: 50 },
  icon:    { value: 0 }
```

- [ ] **Step 5 : Relancer, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add designer/js/registry.js designer/js/render.js designer/tests/registry.test.js
git commit -m "feat(designer): registre led_ring — mode/period_ms/value + LED_MODES" -m "Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

## Task 5 : Designer — module d'aperçu `led-ring-preview.js` (pur + peintre)

**Files:**
- Create: `designer/js/led-ring-preview.js`
- Create: `designer/tests/led-ring-preview.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `designer/tests/led-ring-preview.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledFrame, ledFrameAt, LED_RING_COUNT } from '../js/led-ring-preview.js';

const lit = f => f.on.filter(Boolean).length;

test('ledFrame : off → 0 LED', () => {
  assert.equal(lit(ledFrame({ mode: 'off' })), 0);
});
test('ledFrame : solid → 13 LEDs', () => {
  assert.equal(lit(ledFrame({ mode: 'solid' })), LED_RING_COUNT);
});
test('ledFrame : progress 62% → 8/13 (round)', () => {
  assert.equal(lit(ledFrame({ mode: 'progress' }, { value: 62 })), 8);
});
test('ledFrame : progress borné 0..100', () => {
  assert.equal(lit(ledFrame({ mode: 'progress' }, { value: 999 })), LED_RING_COUNT);
  assert.equal(lit(ledFrame({ mode: 'progress' }, { value: -5 })), 0);
});
test('ledFrame : spinner → 1 tête', () => {
  assert.equal(lit(ledFrame({ mode: 'spinner' })), 1);
});
test('ledFrame : brightness → alpha (0..1)', () => {
  assert.equal(ledFrame({ mode: 'solid', brightness: 255 }).alpha, 1);
  assert.equal(ledFrame({ mode: 'solid', brightness: 0 }).alpha, 0);
});
test('ledFrame : couleur par défaut blanche', () => {
  assert.equal(ledFrame({ mode: 'solid' }).color, '#FFFFFF');
});
test('ledFrameAt : spinner avance dans le temps (miroir firmware)', () => {
  const c = { mode: 'spinner', period_ms: 1300 };
  const f0 = ledFrameAt(c, {}, 0);
  const fMid = ledFrameAt(c, {}, 650);
  assert.equal(lit(f0), 1);
  assert.equal(lit(fMid), 1);
  assert.notDeepEqual(f0.on, fMid.on);
});
test('ledFrameAt : blink éteint à la moitié de la période', () => {
  const c = { mode: 'blink', period_ms: 1000 };
  assert.equal(lit(ledFrameAt(c, {}, 100)), LED_RING_COUNT);  // 1re moitié = on
  assert.equal(lit(ledFrameAt(c, {}, 600)), 0);               // 2e moitié = off
});
test('ledFrameAt : breathe à mi-période ~ pleine intensité', () => {
  const c = { mode: 'breathe', period_ms: 1000, brightness: 255 };
  const a = ledFrameAt(c, {}, 500).alpha;   // 0.5*(1-cos(pi)) = 1
  assert.ok(a > 0.99, `alpha ${a}`);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — module `../js/led-ring-preview.js` introuvable (ERR_MODULE_NOT_FOUND).

- [ ] **Step 3 : Créer le module**

Créer `designer/js/led-ring-preview.js` :

```js
// Aperçu de l'anneau LED physique (13 WS2812). Fonctions PURES (ledFrame/ledFrameAt, testées node) +
// peintre DOM (paintRing) + brancheur canvas (createLedRingPreview). Miroir de src/led_ring_comp.cpp :
// progress = round(value%*13) ; spinner = tête now/(period/N)%N ; blink duty 50% ; breathe 0.5*(1-cos).
import { getMock } from './mocks.js';

export const LED_RING_COUNT = 13;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Frame statique représentative : ce que montrent les LEDs « au repos » pour ce mode.
export function ledFrame(comp, mock = {}) {
  const N = LED_RING_COUNT;
  const color = comp?.color || '#FFFFFF';
  const alpha = clamp(comp?.brightness ?? 64, 0, 255) / 255;
  const mode = comp?.mode || 'off';
  const on = new Array(N).fill(false);
  if (mode === 'solid' || mode === 'blink' || mode === 'breathe') on.fill(true);
  else if (mode === 'progress') {
    const lit = Math.round(clamp(mock.value ?? 0, 0, 100) / 100 * N);
    for (let i = 0; i < lit; i++) on[i] = true;
  } else if (mode === 'spinner') on[0] = true;
  // off → tout éteint
  return { color, alpha, on, mode };
}

// Frame ANIMÉE à l'instant nowMs (pour le bouton ▶ Aperçu). Surcharge ledFrame pour les modes animés.
export function ledFrameAt(comp, mock, nowMs) {
  const f = ledFrame(comp, mock);
  const N = LED_RING_COUNT;
  const period = Math.max(1, comp?.period_ms ?? 1000);
  if (f.mode === 'spinner') {
    const head = Math.floor(nowMs / (period / N)) % N;
    f.on = f.on.map((_, i) => i === head);
  } else if (f.mode === 'blink') {
    const onNow = (nowMs % period) < period / 2;
    f.on = f.on.map(() => onNow);
  } else if (f.mode === 'breathe') {
    const ph = (nowMs % period) / period;
    f.alpha = f.alpha * 0.5 * (1 - Math.cos(ph * 2 * Math.PI));
  }
  return f;
}

// Peint 13 pastilles positionnées en cercle dans `container`. Idempotent (remplace le contenu).
// Taille des pastilles : via CSS (selon le conteneur .led-ring-canvas / .led-ring-mini).
export function paintRing(container, frame) {
  const { color, alpha, on } = frame;
  const N = LED_RING_COUNT, R = 49;   // rayon en % du conteneur
  container.replaceChildren();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI - Math.PI / 2;   // départ en haut
    const dot = document.createElement('span');
    dot.className = 'led-dot' + (on[i] ? ' on' : '');
    dot.style.left = (50 + R * Math.cos(a)) + '%';
    dot.style.top  = (50 + R * Math.sin(a)) + '%';
    if (on[i]) { dot.style.background = color; dot.style.opacity = String(alpha); dot.style.boxShadow = `0 0 6px ${color}`; }
    container.appendChild(dot);
  }
}

// Trouve le led_ring singleton dans l'état, ou null.
export function findLedRing(state) {
  const comps = state.components || {};
  const id = Object.keys(comps).find(k => comps[k].type === 'led_ring');
  return id ? { id, comp: comps[id] } : null;
}

// Brancheur du liseré du canvas : repeint (frame STATIQUE) à chaque changement du modèle. Exposé `render`
// pour rafraîchir aussi sur une édition de mock (appelé par le panneau Device). Sans led_ring → anneau éteint.
export function createLedRingPreview({ host }, model) {
  function render() {
    const r = findLedRing(model.state);
    paintRing(host, r ? ledFrame(r.comp, getMock(r.id, 'led_ring')) : ledFrame({ mode: 'off' }));
  }
  model.subscribe(render);
  render();
  return { render };
}
```

- [ ] **Step 4 : Relancer, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS (les pures `ledFrame`/`ledFrameAt` ; `paintRing`/`createLedRingPreview` non exercés en node, OK car le DOM n'est touché qu'à l'appel).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/led-ring-preview.js designer/tests/led-ring-preview.test.js
git commit -m "feat(designer): module led-ring-preview (frames purs + peintre)" -m "Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

## Task 6 : Designer — panneau Device (select mode, mock value, mini-aperçu ▶)

**Files:**
- Modify: `designer/js/device-panel.js` (réécriture complète)
- Test: `designer/tests/device.test.js` (vérifie l'import et le contrat ; le rendu DOM reste vérifié au navigateur)

Le panneau Device gagne : un `<select>` pour `mode` (kind `ledmode`), le **grisage** `enableWhen` (période), les `mockFields` (valeur d'aperçu, non persistée), et un **mini-aperçu** avec bouton **▶ Aperçu**.

- [ ] **Step 1 : Réécrire `device-panel.js`**

Remplacer **tout** le contenu de `designer/js/device-panel.js` par :

```js
// Panneau « Device » : édite les composants physiques (sorties globales : led_ring, sound), HORS pages.
// Ils vivent dans `components` sans placement ; le firmware les pilote globalement. Calqué sur
// sources.js (cards, commit sur 'change', garde-focus). Réutilise les classes CSS src-*.
// led_ring : select de mode, période grisée hors modes animés, valeur d'aperçu (mock, non persistée),
// mini-aperçu des 13 LEDs + bouton ▶ Aperçu (animation à la demande — canvas calme par défaut).
import { COMPONENTS, LED_MODES } from './registry.js';
import { setComponentProp } from './mutations.js';
import { getMock, setMock } from './mocks.js';
import { physicalTypes, physicalComponentIds, addPhysicalComponent, removeComponent, canAddType } from './physical.js';
import { paintRing, ledFrame, ledFrameAt } from './led-ring-preview.js';

function fieldInput(kind, value, onChange) {
  if (kind === 'ledmode') {
    const sel = document.createElement('select');
    for (const [val, txt] of LED_MODES) {
      const o = document.createElement('option'); o.value = val; o.textContent = txt;
      if (val === (value ?? LED_MODES[0][0])) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }
  const el = document.createElement('input');
  if (kind === 'color') {
    el.type = 'color'; el.value = value || '#FFFFFF';
    el.addEventListener('change', () => onChange(el.value.toUpperCase()));
  } else if (kind === 'num') {
    el.type = 'number'; el.value = value ?? '';
    el.addEventListener('change', () => onChange(el.value === '' ? '' : Number(el.value)));
  } else {
    el.type = 'text'; el.value = value ?? '';
    el.addEventListener('change', () => onChange(el.value));
  }
  return el;
}

function labelled(text, input) {
  const l = document.createElement('label'); l.className = 'src-field';
  const s = document.createElement('span'); s.textContent = text;
  l.appendChild(s); l.appendChild(input);
  return l;
}

export function createDevicePanel(root, model, { onPreview } = {}) {
  let previewRaf = null;
  const stopPreview = () => { if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = null; } };

  function render() {
    // Garde-focus : ne sauter le re-render QUE pendant l'édition d'un CHAMP (input/select/textarea).
    const ae = document.activeElement;
    if (ae && root.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    stopPreview();                         // une animation en cours pointerait un nœud bientôt détaché
    root.replaceChildren();
    const comps = model.state.components || {};

    for (const id of physicalComponentIds(model.state)) {
      const c = comps[id];
      const def = COMPONENTS[c.type];
      const card = document.createElement('div'); card.className = 'src-card';

      const head = document.createElement('div'); head.className = 'src-head';
      const title = document.createElement('span'); title.className = 'src-title';
      title.textContent = `${id} · ${def.label}`;
      const del = document.createElement('button'); del.className = 'src-del'; del.textContent = 'Supprimer';
      del.addEventListener('click', () => model.commit(s => removeComponent(s, id)));
      head.appendChild(title); head.appendChild(del);
      card.appendChild(head);

      const rows = [];                       // pour le grisage enableWhen
      for (const [key, label, kind, enableWhen] of (def.compFields || [])) {
        const row = labelled(label, fieldInput(kind, c[key], v => model.commit(s => setComponentProp(s, id, key, v))));
        rows.push({ row, enableWhen });
        card.appendChild(row);
      }
      const syncEnabled = () => {
        const cc = model.state.components[id]; if (!cc) return;
        for (const { row, enableWhen } of rows) {
          if (!enableWhen) continue;
          const ok = enableWhen(cc);
          row.classList.toggle('disabled', !ok);
          const f = row.querySelector('input, select'); if (f) f.disabled = !ok;
        }
      };
      syncEnabled();
      card.addEventListener('change', syncEnabled);   // changer le mode réévalue la période

      // --- led_ring : valeur d'aperçu (mock) + mini-aperçu animable ---
      if (def.mockFields?.length || c.type === 'led_ring') {
        for (const [key, label] of (def.mockFields || [])) {
          const m = getMock(id, c.type);
          card.appendChild(labelled(label, fieldInput('num', m[key], v => {
            setMock(id, { [key]: v === '' ? 0 : v });
            render();          // re-peint le mini-aperçu (frame statique)
            onPreview?.();     // re-peint le liseré du canvas
          })));
        }
      }
      if (c.type === 'led_ring') {
        const mini = document.createElement('div'); mini.className = 'led-ring-mini';
        paintRing(mini, ledFrame(c, getMock(id, 'led_ring')));
        card.appendChild(mini);

        const play = document.createElement('button'); play.className = 'src-add'; play.textContent = '▶ Aperçu';
        play.addEventListener('click', () => {
          if (previewRaf) { stopPreview(); play.textContent = '▶ Aperçu'; paintRing(mini, ledFrame(c, getMock(id, 'led_ring'))); return; }
          play.textContent = '⏸ Aperçu';
          const loop = () => { paintRing(mini, ledFrameAt(c, getMock(id, 'led_ring'), performance.now())); previewRaf = requestAnimationFrame(loop); };
          loop();
        });
        card.appendChild(play);
      }

      root.appendChild(card);
    }

    for (const type of physicalTypes()) {
      const add = document.createElement('button'); add.className = 'src-add';
      add.textContent = '+ ' + COMPONENTS[type].label;
      add.disabled = !canAddType(model.state, type);
      add.addEventListener('click', () => model.commit(s => addPhysicalComponent(s, type)));
      root.appendChild(add);
    }
  }

  model.subscribe(render);
  render();
  return { render };
}
```

- [ ] **Step 2 : Adapter/ajouter le test de contrat**

Vérifier d'abord l'existant : `Read designer/tests/device.test.js`. S'il instancie `createDevicePanel(root, model)` sans 3e arg, l'API reste compatible (`onPreview` optionnel). Ajouter ce test (DOM léger via le même style que les tests existants du dossier ; s'il n'y a pas de DOM mock, garder un test d'API pur) :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevicePanel } from '../js/device-panel.js';

test('device-panel : createDevicePanel est une factory tolérant onPreview absent', () => {
  assert.equal(typeof createDevicePanel, 'function');
  // 3e argument optionnel : la signature accepte un objet { onPreview } ou rien.
  assert.equal(createDevicePanel.length, 2);   // root, model requis ; opts par défaut
});
```

> Si `device.test.js` existant teste déjà le rendu avec un DOM simulé, suivre ce pattern plutôt que le test d'API ci-dessus et y ajouter un cas « led_ring rend un select de mode + un .led-ring-mini ». Ne pas inventer de mock DOM si le dossier n'en a pas.

- [ ] **Step 3 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS (import résolu, contrat respecté).

- [ ] **Step 4 : Commit**

```bash
git add designer/js/device-panel.js designer/tests/device.test.js
git commit -m "feat(designer): panneau Device — mode/période/valeur led_ring + mini-aperçu ▶" -m "Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

## Task 7 : Designer — liseré du canvas (HTML + CSS + wiring app.js)

**Files:**
- Modify: `designer/index.html` (hôte d'aperçu dans `#stage-wrap`, ~l.58-61)
- Modify: `designer/style.css` (retrait `.stage-wrap::before` l.196-205 ; styles `.led-ring-canvas`/`.led-ring-mini`/`.led-dot`)
- Modify: `designer/js/app.js` (import + montage `createLedRingPreview` ; `buildUpdatePayload`)

- [ ] **Step 1 : Ajouter l'hôte d'aperçu dans le canvas**

Dans `designer/index.html`, remplacer le bloc `#stage-wrap` (l.58-61) par :

```html
      <div id="stage-wrap" class="stage-wrap">
        <div id="led-ring" class="led-ring-canvas" aria-hidden="true"></div>
        <div id="stage" class="stage">
          <div class="screen-circle"></div>
        </div>
      </div>
```

- [ ] **Step 2 : Remplacer le liseré statique par les styles des pastilles**

Dans `designer/style.css`, **supprimer** le bloc `.stage-wrap::before { … }` (l.196-205, commentaire « Anneau décoratif » inclus) et le **remplacer** par :

```css
/* Aperçu live de l'anneau LED (13 pastilles) — derrière le disque, pointer-events:none pour préserver
   l'invariant « clic dans le vide (fond ou liseré) → désélection » (app.js pointerdown). */
.led-ring-canvas {
  position: absolute; inset: -10px; border-radius: 50%;
  pointer-events: none; z-index: 0;
}
.led-ring-canvas .led-dot {
  position: absolute; width: calc(11px * var(--zoom, 1)); height: calc(11px * var(--zoom, 1));
  border-radius: 50%; transform: translate(-50%, -50%); background: #23232b;
}
/* Mini-aperçu du panneau Device (taille fixe). */
.led-ring-mini {
  position: relative; width: 132px; height: 132px; margin: 10px auto 4px;
  border-radius: 50%; background: #000; box-shadow: 0 0 0 1px #2a2a33 inset;
}
.led-ring-mini .led-dot {
  position: absolute; width: 10px; height: 10px;
  border-radius: 50%; transform: translate(-50%, -50%); background: #23232b;
}
```

- [ ] **Step 3 : Câbler le module dans app.js**

Dans `designer/js/app.js` :

(a) Ajouter l'import près des autres (après l.11 `import { createCanvas }…`) :

```js
import { createLedRingPreview } from './led-ring-preview.js';
```

(b) Monter l'aperçu et le passer au panneau Device. Remplacer la ligne `createDevicePanel($('device'), model);` (l.179) par :

```js
  // Aperçu live de l'anneau LED dans le liseré du canvas (frame statique ; animation à la demande
  // via le ▶ Aperçu du panneau Device). Le panneau Device le rafraîchit sur édition de la valeur mock.
  const ledRingPreview = createLedRingPreview({ host: $('led-ring') }, model);
  createDevicePanel($('device'), model, { onPreview: ledRingPreview.render });
```

(c) Permettre au bouton « Valeurs » de pousser l'anneau au device (test live). Dans `buildUpdatePayload` (l.30-39), remplacer le commentaire caduc et ajouter la branche `led_ring`. Le corps devient :

```js
function buildUpdatePayload(state) {
  const out = {};
  for (const [id, c] of Object.entries(state.components || {})) {
    const m = getMock(id, c.type);
    if (c.type === 'readout' || c.type === 'bar' || c.type === 'meter' || c.type === 'led') out[id] = m.value ?? 0;
    else if (c.type === 'ring') { out[id] = { pct: m.value ?? 0 }; if (c.countdown && m.reset_in_s != null) out[id].reset_in_s = m.reset_in_s; }
    else if (c.type === 'chart') { const h = m.hist || []; if (h.length) out[id] = h[h.length - 1]; }
    else if (c.type === 'led_ring') out[id] = { mode: c.mode || 'off', color: c.color || '#FFFFFF', brightness: c.brightness ?? 64, period_ms: c.period_ms ?? 1000, value: m.value ?? 0 };
  }
  return out;
}
```

- [ ] **Step 4 : Vérifier les tests node (non régressés)**

Run: `cd designer && node --test`
Expected: PASS (aucun test ne dépend du DOM de `app.js`/`index.html`/CSS).

- [ ] **Step 5 : Vérification navigateur (servir en no-store + events pointer réels)**

Servir le designer depuis la racine du repo (le schéma est sous `../schema`), sur un port libre **≠ 8000** :

```bash
cd /Users/jean-paulgavini/Documents/Dev/Dialboard && python3 -m http.server 8765 --bind 127.0.0.1
```

Ouvrir `http://127.0.0.1:8765/designer/`. Vérifier :
1. Au chargement (layout par défaut, led_ring présent) : 13 pastilles autour du disque ; mode `off` → pastilles grisées.
2. Ouvrir le tiroir Device → carte « led_ring » : `Couleur`, `Luminosité`, `Mode` (select), `Période` **grisée** ; passer Mode à `progress` → la période reste grisée, régler `Valeur % (aperçu)` → N pastilles s'allument sur le canvas ET le mini-aperçu.
3. Mode `spinner`/`blink`/`breathe` → `Période` **activée** ; cliquer **▶ Aperçu** → le mini-aperçu s'anime ; le canvas reste **statique** (calme).
4. Cliquer dans le liseré (zone des pastilles) avec un composant sélectionné → **désélection** (invariant préservé).
5. Couleur/luminosité du led_ring → reflétées sur les pastilles allumées.

Arrêter le serveur après vérification (Ctrl-C).

- [ ] **Step 6 : Commit**

```bash
git add designer/index.html designer/style.css designer/js/app.js
git commit -m "feat(designer): liseré du canvas = aperçu live des 13 LEDs" -m "Claude-Session: https://claude.ai/code/session_01J38sSW7eNcaq4tNnpZhYCV"
```

---

## Task 8 : Vérification de parité (optionnelle, device réel)

**Files:** aucun (vérification).

- [ ] **Step 1 : Build + flash firmware**

Run:
```bash
pio run -e esp32s3 -t upload
bash tools/stage_fs.sh && pio run -e esp32s3 -t uploadfs
```
(Rappel mémoire : `uploadfs` réécrit tout le LittleFS — sauvegarder d'éventuels assets device avant.)

- [ ] **Step 2 : Pousser un layout led_ring depuis le designer**

Dans le designer (Device URL = IP du device) : régler led_ring `mode=breathe`, `color=#FF9F40`, `brightness=120`, `period_ms=2500` → bouton **Pousser**. Rebooter le device.
Expected: l'anneau **respire en ambre dès le boot** (sans /update) — la config pilote l'anneau. L'aperçu du canvas correspond au rendu physique.

- [ ] **Step 3 : Vérifier la surcharge /update**

Bouton **Valeurs** (ou `POST /update {"<id>":{"mode":"spinner"}}`).
Expected: l'anneau passe en rotation → `/update` surcharge toujours la config de boot.

---

## Self-review (rempli par l'auteur du plan)

- **Couverture spec** :
  - §1 Schéma → Task 1. §2 Firmware (parse_led_mode + boot) → Tasks 2-3. §3 Designer édition → Tasks 4, 6. §4 Aperçu canvas → Tasks 5, 7. §5 Mini-aperçu Device [7d] → Task 6. Tests → intégrés à chaque task (node + native). Invariant désélection → Task 7 Step 2/Step 5.4. Hors-scope C → non touché. ✓
  - Ajout au-delà de la spec : `led_ring` dans `buildUpdatePayload` (Task 7c) — permet de tester l'anneau sur le device réel ; cohérent avec « édition complète ». Faible coût.
- **Placeholders** : aucun — code complet à chaque step ; commandes + sorties attendues explicites.
- **Cohérence des types** : `ledFrame`/`ledFrameAt`/`paintRing`/`findLedRing`/`createLedRingPreview` définis en Task 5, consommés identiquement en Tasks 6-7. `LED_MODES` défini Task 4, importé Task 6. Kind `ledmode` produit par le registre (Task 4) et géré par `fieldInput` (Task 6). `onPreview` injecté Task 7, consommé Task 6.
- **Réalisation 7c** : animation via ▶ (pas « auto à la sélection ») — documentée en tête de plan ; à confirmer à l'exécution si l'utilisateur préfère l'auto-animation.
