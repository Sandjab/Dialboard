# Composant `led` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un type de composant `led` (voyant lumineux) à Dialboard : sa couleur suit la valeur poussée via les seuils, et il s'éteint sous `off_below`.

**Architecture :** Tout réutilise l'existant : `threshold_color`/`pickThresholdColor` pour la couleur, les tables positionnelles (`APPLY`/`VIEW`) côté firmware, les `MOCKS` côté designer, `lv_led` (LVGL 9.5) pour le rendu device.

**Pourquoi un seul commit pour le câblage du type (Task 1).** Le schéma `schema/layout.schema.json` est partagé par DEUX tests de conformité : `registry.test.js` (designer : `Object.keys(COMPONENTS)` == types du schéma) et `test_schema_types_all_resolve` (firmware natif : chaque type du `oneOf` doit résoudre via `COMP_NAMES`). Ajouter `led` au schéma sans mettre à jour LES DEUX résolveurs rend l'une des suites rouge. Donc schéma + registry (designer) + `COMP_NAMES` + tables firmware basculent dans le **même commit**. Les étapes restent bite-sized ; seul le commit est unique. Task 2 (visuel) est purement additive.

**Tech Stack :** JS modules (designer, `node:test`), JSON Schema draft-07, C++/Arduino + LVGL 9.5 (`lv_led`), PlatformIO (`native` Unity + `esp32s3`).

**Rappels de contexte (vérifiés en source) :**
- Projet en **LVGL 9.5** (`lv_led` dispo ; `LV_USE_LED` défaut 1). Les notes « 8.4 » de `CLAUDE.md`/`HANDOFF` sont périmées (hors-scope).
- `threshold_color(t, n, value, base)` (`src/color.cpp:13`) : 1er seuil où `value < limite`, sinon `base`. Miroir JS `pickThresholdColor` (`designer/js/render.js:33`).
- `apply_bar`/`apply_meter` = `c.value = v.as<int>();` → `apply_led` identique.
- Table nom→enum = `COMP_NAMES` (`src/dashboard.cpp:28`). Tables `APPLY`/`VIEW` positionnelles avec `static_assert(... == COMP_COUNT)` : on **append** `COMP_LED` en fin d'enum et la ligne led en fin de chaque table → aucune réindexation.
- Les `thresholds` ne sont **pas** un champ d'inspecteur (ring/meter ne les exposent pas) : édités via « JSON avancé ». Le `led` suit cette convention.

---

## Task 1 : Implémenter le type `led` (designer + firmware, un commit cohérent)

Câble le type de bout en bout. Deux phases TDD (designer, puis firmware) ; un seul commit final quand les DEUX suites sont vertes et que le firmware compile.

**Files:**
- Modify: `schema/layout.schema.json` (`$defs/comp_led`, entrée `oneOf`, `size` sur `placement`)
- Modify: `designer/js/render.js` (`ledLit`, `buildLed`, `MOCKS.led`)
- Modify: `designer/js/registry.js` (entrée `led`, import `buildLed`)
- Modify: `designer/js/icons.js` (glyphe `led`)
- Modify: `designer/style.css` (`.w-led`)
- Modify: `designer/tests/schema.test.js` (cas led)
- Modify: `designer/tests/render.test.js` (cas `ledLit`)
- Modify: `src/dashboard.h` (`COMP_LED`, `Component.off_below`, `Placement.size`)
- Modify: `src/color.h` + `src/color.cpp` (`led_is_lit`)
- Modify: `src/dashboard.cpp` (`COMP_NAMES`, parse, `apply_led`, `APPLY`, `context_apply`)
- Modify: `src/view.cpp` (`build_led`, `sync_led`, `VIEW`)
- Modify: `src/lv_conf.h` (`LV_USE_LED`)
- Modify: `test/test_core/test_main.cpp` (tests natifs : `led_is_lit` + parse led)

### Phase A — Designer (TDD)

- [ ] **Step 1 : Tests schéma + `ledLit` (rouge attendu)**

Dans `designer/tests/schema.test.js`, ajouter :

```js
test('schema : composant led valide (off_below + thresholds + bind)', () => {
  const l = { components: { l1: { type: 'led', color: '#22C55E', off_below: 1,
             thresholds: [[1, '#EF4444']], bind: 'online' } },
             pages: [{ name: 'P', place: [{ ref: 'l1', anchor: 'CENTER', size: 24 }] }] };
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : propriete inconnue sur un led est rejetee', () => {
  const l = { components: { l1: { type: 'led', glow: true } },
             pages: [{ name: 'P', place: [{ ref: 'l1' }] }] };
  assert.equal(validate(l).valid, false);
});
```

Dans `designer/tests/render.test.js`, ajouter `ledLit` à l'import depuis `../js/render.js`, puis :

```js
test('ledLit : allumé si value >= off_below (limite incluse)', () => {
  assert.equal(ledLit(0, 1), false);
  assert.equal(ledLit(1, 1), true);   // limite incluse
  assert.equal(ledLit(5, 1), true);
  assert.equal(ledLit(0, 0), true);   // off_below 0 → toujours allumé
});
```

- [ ] **Step 2 : Lancer la suite designer — vérifier l'échec**

Run: `cd designer && node --test`
Expected: ÉCHEC — tests schema led (type absent du `oneOf`), test `ledLit` (fonction absente), ET conformité `le registre couvre exactement les types du schema` (registry sans led).

- [ ] **Step 3 : Schéma — `comp_led` + `size` sur placement**

Dans `schema/layout.schema.json`, ajouter à `component.oneOf` (après `comp_image_anim`) :

```json
        { "$ref": "#/$defs/comp_image_anim" },
        { "$ref": "#/$defs/comp_led" }
```

Ajouter le `$def` (après le bloc `comp_image_anim`, avant `page`) :

```json
    "comp_led": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "description": "Voyant lumineux (lv_led). value < off_below = eteint, sinon allume. Couleur allumee = threshold_color(value) sinon color. Place via anchor/dx/dy + size (diametre).",
      "properties": {
        "type": { "const": "led" },
        "bind": { "$ref": "#/$defs/ascii", "description": "Nom d'une variable du contexte (pull). Present = lit la variable au lieu d'etre pousse par id. Absent = push par id (defaut)." },
        "color": { "$ref": "#/$defs/hexColor", "description": "Couleur allumee quand aucun seuil ne matche. Defaut #22C55E." },
        "off_below": { "type": "number", "description": "value < off_below = eteint ; sinon allume. Defaut 1 (0 = eteint, >=1 = allume)." },
        "thresholds": {
          "type": "array",
          "description": "Couleur allumee selon la valeur (1er seuil ou value < limite, sinon color).",
          "items": { "$ref": "#/$defs/threshold" }
        }
      }
    },
```

Ajouter `size` aux `properties` de `placement` (après `start_angle`) :

```json
        "start_angle": { "type": "integer", "description": "Oriente l'ouverture : offset en degres, horaire, depuis le bas. 0=bas, 90=gauche, 180=haut, 270=droite. Defaut 0." },
        "size": { "type": "integer", "minimum": 1, "maximum": 360, "description": "Diametre du voyant (led), en px. Defaut 24." }
```

- [ ] **Step 4 : `render.js` — `ledLit`, `buildLed`, `MOCKS.led`**

Étendre `MOCKS` :

```js
  meter:   { value: 60 },
  led:     { value: 1 }
```

Helper pur (après `pickThresholdColor`) :

```js
// led : allumé si value >= off_below, sinon éteint. Miroir firmware led_is_lit (color.cpp).
export function ledLit(value, offBelow = 1) {
  return value >= offBelow;
}
```

Builder DOM (à la fin du fichier) :

```js
// led : voyant lumineux. Couleur = seuil (sinon color) ; éteint (sombre, sans halo) sous off_below.
// Miroir best-effort de lv_led (view.cpp build_led/sync_led) : halo ≈ glow de lv_led.
export function buildLed(comp, placement, mock = MOCKS.led) {
  const size = placement.size || 24;
  const lit  = ledLit(mock.value, comp.off_below ?? 1);
  const col  = pickThresholdColor(comp.thresholds, mock.value, comp.color || '#22C55E');
  const n = document.createElement('div');
  n.className = 'w w-led' + (lit ? '' : ' w-led--off');
  n.style.width  = size + 'px';
  n.style.height = size + 'px';
  n.style.background = col;
  if (lit) n.style.boxShadow = `0 0 ${Math.round(size * 0.5)}px ${col}`;
  return n;
}
```

- [ ] **Step 5 : `registry.js` — entrée `led`**

Ajouter `buildLed` à l'import depuis `./render.js` :

```js
import { buildLabel, buildReadout, buildBar, buildRing, buildChart, buildMeter, buildImage, buildImageAnim, buildLed } from './render.js';
```

Ajouter l'entrée (après le bloc `image_anim`, avant `led_ring`) :

```js
  led: {
    label: 'LED',
    defaults: () => ({ type: 'led', color: '#22C55E', off_below: 1 }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), size: 24 }),
    centered: false, physical: false,
    compFields: [['color', 'Couleur', 'color'], ['off_below', 'Éteint sous', 'num'], ['bind', 'Variable (pull)', 'asciitext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'], ['size', 'Diamètre', 'num']],
    mockFields: [['value', 'Valeur (aperçu)']],
    build: (comp, pl, mock) => buildLed(comp, pl, mock),
  },
```

- [ ] **Step 6 : `icons.js` — glyphe `led`**

Dans `PATHS` (après `meter`, avant `image`) :

```js
  led:      '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/>', // point plein + halo
```

- [ ] **Step 7 : `style.css` — `.w-led`**

Ajouter à côté des autres styles `.w-*` :

```css
/* led : voyant rond. Couleur/halo posés inline par buildLed ; éteint = sombre, sans halo. */
.w-led { border-radius: 50%; }
.w-led--off { opacity: .25; box-shadow: none; }
```

- [ ] **Step 8 : Suite designer verte**

Run: `cd designer && node --test`
Expected: PASS — tous, dont schema led, `ledLit`, et conformité registre↔schéma.

### Phase B — Firmware (TDD)

- [ ] **Step 9 : Tests natifs `led_is_lit` + parse led (rouge attendu)**

Dans `test/test_core/test_main.cpp`, ajouter les fonctions (à côté des `test_threshold_*`) :

```c
void test_led_is_lit_boundary(void) {
    TEST_ASSERT_FALSE(led_is_lit(0, 1));
    TEST_ASSERT_TRUE (led_is_lit(1, 1));   // limite incluse
    TEST_ASSERT_TRUE (led_is_lit(5, 1));
    TEST_ASSERT_TRUE (led_is_lit(0, 0));   // off_below 0 -> toujours allume
}

static const char* LAYOUT_LED =
    "{\"components\":{\"d\":{\"type\":\"led\",\"color\":\"#22C55E\",\"off_below\":3,"
    "\"thresholds\":[[1,\"#EF4444\"]]}},"
    "\"pages\":[{\"name\":\"P\",\"place\":[{\"ref\":\"d\",\"anchor\":\"CENTER\",\"size\":40}]}]}";

void test_led_parse(void) {
    Dashboard d{}; char err[128];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_LED, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(COMP_LED, d.components[0].type);
    TEST_ASSERT_EQUAL_INT(3, d.components[0].off_below);
    TEST_ASSERT_EQUAL_HEX32(0x22C55E, d.components[0].color);
    TEST_ASSERT_EQUAL_INT(1, d.components[0].threshold_count);
    TEST_ASSERT_EQUAL_INT(40, d.pages[0].places[0].size);
}
```

Enregistrer dans `main()` (à côté des `RUN_TEST(test_threshold_*)`, vers la ligne 682+) :

```c
    RUN_TEST(test_led_is_lit_boundary);
    RUN_TEST(test_led_parse);
```

- [ ] **Step 10 : Lancer les tests natifs — vérifier l'échec**

Run: `pio test -e native`
Expected: ÉCHEC de compilation — `led_is_lit` non déclaré, `COMP_LED` inexistant. Attendu.

- [ ] **Step 11 : `led_is_lit` (pur)**

Dans `src/color.h`, après la déclaration de `threshold_color` :

```c
// led : allume si value >= off_below (sinon eteint). Pur, miroir designer ledLit.
bool led_is_lit(int32_t value, int32_t off_below);
```

`src/color.h` inclut déjà `<stdint.h>` ; ajouter `#include <stdbool.h>` en tête s'il manque (pour `bool` en C).

Dans `src/color.cpp`, après `threshold_color` :

```c
bool led_is_lit(int32_t value, int32_t off_below) {
    return value >= off_below;
}
```

- [ ] **Step 12 : `dashboard.h` — enum, `off_below`, `Placement.size`**

Enum (append avant `COMP_COUNT`) :

```c
enum CompType { COMP_NONE, COMP_LABEL, COMP_READOUT, COMP_BAR, COMP_RING, COMP_LED_RING, COMP_SOUND, COMP_CHART, COMP_METER, COMP_IMAGE, COMP_IMAGE_ANIM, COMP_LED, COMP_COUNT };
```

`struct Component`, à côté de `vmin, vmax` :

```c
    int32_t  off_below;              // led : value < off_below -> eteint (defaut 1)
```

`struct Placement`, étendre la ligne `radius, thickness, gap_deg, start_angle` :

```c
    int16_t radius, thickness, gap_deg, start_angle, size;
```

- [ ] **Step 13 : `dashboard.cpp` — `COMP_NAMES`, parse, `apply_led`, `APPLY`, `context_apply`**

Ajouter la paire à `COMP_NAMES` (le tableau se termine par `{ "image_anim", COMP_IMAGE_ANIM },`) :

```cpp
    { "image_anim", COMP_IMAGE_ANIM }, { "led", COMP_LED },
```

Parse de composant (après `c.vmax = o["max"] | 100;`) :

```cpp
        c.off_below   = o["off_below"] | 1;
```

Parse de placement (après la ligne `q.gap_deg = pl["gap_deg"] | 70; q.start_angle = pl["start_angle"] | 0;`) :

```cpp
            q.size        = pl["size"] | 24;
```

Fonction `apply_led` (à côté de `apply_meter`) :

```cpp
static void apply_led(Component& c, JsonVariantConst v) {
    c.value = v.as<int>();                    // scalaire -> etat on/off + couleur de seuil
}
```

Ligne `APPLY` (en dernier, après `apply_image_anim`) :

```cpp
    /* COMP_IMAGE_ANIM */ apply_image_anim,
    /* COMP_LED      */ apply_led,
```

`context_apply` : ajouter `case COMP_LED:` au bloc scalaire `COMP_METER` :

```cpp
            case COMP_METER:                            // scalaire -> aiguille (comme bar)
            case COMP_LED:                              // scalaire -> etat on/off
                if (v.type == CTX_NUM) {
                    int32_t nv = (int32_t)v.num;
                    if (c.value != nv) { c.value = nv; changed = true; }
                }
                break;
```

- [ ] **Step 14 : `view.cpp` — `build_led`, `sync_led`, `VIEW`**

Fonctions (à côté de `build_meter`/`sync_meter`) :

```cpp
static void build_led(lv_obj_t* parent, Component& c, Placement& q,
                      lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* led = lv_led_create(parent);
    int sz = q.size ? q.size : 24;
    lv_obj_set_size(led, sz, sz);
    lv_led_set_color(led, lv_color_hex(threshold_color(c.thresholds, c.threshold_count, c.value, c.color)));
    if (led_is_lit(c.value, c.off_below)) lv_led_on(led); else lv_led_off(led);
    lv_obj_align(led, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = led;
}
static void sync_led(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    lv_led_set_color(w, lv_color_hex(threshold_color(c.thresholds, c.threshold_count, c.value, c.color)));
    if (led_is_lit(c.value, c.off_below)) lv_led_on(w); else lv_led_off(w);
}
```

Ligne `VIEW` (en dernier, après `COMP_IMAGE_ANIM`) :

```cpp
    /* COMP_IMAGE_ANIM */ { build_image_anim, sync_image_anim },
    /* COMP_LED      */ { build_led, sync_led },
```

(`color.h` est déjà inclus dans `view.cpp` — `threshold_color` y sert à `sync_ring` ; `led_is_lit` vient du même header.)

- [ ] **Step 15 : `lv_conf.h` — `LV_USE_LED`**

Dans la section « Widgets extra » :

```c
#define LV_USE_LED             1
```

- [ ] **Step 16 : Tests natifs verts**

Run: `pio test -e native`
Expected: PASS — dont `test_led_is_lit_boundary`, `test_led_parse`, et `test_schema_types_all_resolve` (le type `led` résout désormais via `COMP_NAMES`).

- [ ] **Step 17 : Compiler le firmware**

Run: `pio run -e esp32s3`
Expected: SUCCESS — `static_assert` des tables `APPLY`/`VIEW` OK (taille == `COMP_COUNT`).

### Commit

- [ ] **Step 18 : Vérifier les DEUX suites puis committer**

Run: `cd designer && node --test` (PASS) puis `pio test -e native` (PASS).

```bash
git add schema/layout.schema.json designer/js/render.js designer/js/registry.js designer/js/icons.js designer/style.css designer/tests/schema.test.js designer/tests/render.test.js src/dashboard.h src/color.h src/color.cpp src/dashboard.cpp src/view.cpp src/lv_conf.h test/test_core/test_main.cpp
git commit -m "feat: type led (voyant piloté par seuils + extinction off_below)

Designer (schéma/registry/render/icône) + firmware (lv_led, parse, apply,
view). Réutilise threshold_color et off_below. LVGL 9.5.

Claude-Session: https://claude.ai/code/session_012QBMYnsJCr9dAm4e27UhhB"
```

---

## Task 2 : Vérification de parité + finition visuelle

Confirmer que l'aperçu designer et le device rendent le LED de façon cohérente, et figer le look (taille du halo, aspect éteint). Additif — n'affecte aucune conformité.

**Files:** Possibly modify `designer/style.css` / `designer/js/render.js` (ajustement du halo si nécessaire).

- [ ] **Step 1 : Maquette comparative du look LED (allumé / seuil / éteint)**

Créer une maquette HTML jetable dans `docs/_internal/` (gitignoré) montrant le disque à plusieurs tailles et états (allumé base vert, allumé seuil rouge, éteint), pour valider l'intensité du halo et l'aspect éteint. La présenter à l'utilisateur (SendUserFile) avant de figer.

- [ ] **Step 2 : Screenshot de l'aperçu designer (3 états)**

Servir le repo (port libre, PAS 8000), placer un LED, capturer : value=1 (allumé base), value au-dessus d'un seuil (couleur de seuil), value=0 (éteint).

```bash
python3 -m http.server 8137 --bind 127.0.0.1 &
# screenshots via Playwright (http://127.0.0.1:8137/designer/index.html), puis :
# lsof -ti :8137 | xargs kill
```

Expected : les 3 états sont visuellement distincts et conformes à la maquette validée.

- [ ] **Step 3 : (Optionnel, sur demande) Flash device + vérif réelle**

```bash
bash tools/stage_fs.sh
pio run -e esp32s3 -t upload
pio run -e esp32s3 -t uploadfs   # ⚠ efface les assets device : sauvegarder avant (cf. mémoire)
```

Puis pousser une valeur via `POST /update` et observer le voyant (allumé selon seuil, éteint sous `off_below`).

- [ ] **Step 4 : Commit (si ajustement visuel)**

```bash
git add designer/style.css designer/js/render.js
git commit -m "designer: ajuste le rendu du voyant led (parité device)

Claude-Session: https://claude.ai/code/session_012QBMYnsJCr9dAm4e27UhhB"
```

---

## Notes de portée

- **Hors-scope** (décidé en spec) : libellé intégré, clignotement/animation, canal sortant tactile, correction des notes « 8.4 » périmées dans `CLAUDE.md`/`HANDOFF`.
- **Push** : aucun `git push` dans ce plan — commits locaux jusqu'à demande explicite.
- **`thresholds`** : édités via « JSON avancé » (comme ring/meter), pas via l'inspecteur — volontaire.
