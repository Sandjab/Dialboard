# Effecteurs B1 — button (set) + switch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter les deux premiers composants **effecteurs** (saisie tactile) — `switch` (toggle) et `button` mode `set` (latch) — qui écrivent dans le contexte (origine UI, arme les sinks) et reflètent la valeur courante via `bind`, animant ainsi la couche A (sinks) livrée au Plan A et permettant la 1ʳᵉ vérif on-device.

**Architecture :** On mirrore le pipeline d'un composant afficheur (enum `CompType` → table `COMP_NAMES` → struct `Component` → parse dans `dash_set_layout` → vtable `VIEW[]` `build`/`sync` → reflet via `context_apply`). Nouveauté : les effecteurs sont les **premiers composants interactifs** → callbacks LVGL (`lv_obj_add_event_cb`) qui, sur le thread UI (cœur 1), prennent `g_ctx_mutex` (bloquant, comme les handlers API) et appellent `dash_ctx_write_ui_num/str` (livré en Plan A : écrit + arme les sinks). Le reflet réutilise `context_apply` (~100 ms, sous mutex) → `c.value` + `dirty` → `view_sync`. Le `switch` réutilise `value` (0/1) ; le `button` ajoute deux champs config (`set_value`/`set_is_num`) et réutilise `value` comme état actif (reflet radio = surbrillance si `ctx == value`).

**Tech Stack :** C++/Arduino, LVGL 9.5, ArduinoJson. Tests natifs Unity (`env:native`, sans HW/LVGL — couvre parse + reflet). Rendu LVGL validé par compilation `esp32s3` (non natif-testable, comme les afficheurs). Schéma JSON validé par les tests designer (`node --test`).

**Périmètre & déviations assumées (vs spec `docs/superpowers/specs/2026-06-30-composants-effecteurs-design.md`) :**
- B1 = `switch` + `button` mode `set` uniquement. **`momentary` (impulsion + reset) reporté à B2** (évite la course de timing reset↔fire du sink dans la 1ʳᵉ tranche). `slider`/`arc`/`roller` aussi en B2 (drag + débounce + règle anti-conflit reflet/drag).
- **Styling minimal en B1** : button/switch rendus avec le style LVGL par défaut (le `set`/checked du thème distingue l'actif). Pas de couleur de fond custom (le défaut `color=0xFFFFFF` ferait un fond blanc illisible). Le label du button utilise `font`/`font_family`/`bold`/`italic`, texte blanc fixe. Le styling fin est différé.
- `bind` est **requis** pour un effecteur (sinon il n'écrit nulle part) — contrairement aux afficheurs où il est optionnel.

---

## File Structure

| Fichier | Responsabilité | Nature du changement |
|---|---|---|
| `src/dashboard.h` | enum `CompType`, struct `Component` | +`COMP_SWITCH`/`COMP_BUTTON` ; +champs button `set_value`/`set_is_num` |
| `src/dashboard.cpp` | table `COMP_NAMES`, parse, `context_apply` | +noms ; +parse `value` du button ; +cases reflet switch/button |
| `src/view.cpp` | rendu LVGL + callbacks | +`build_*`/`sync_*`/`*_event_cb` switch/button ; +lignes `VIEW[]` ; +extern mutex ; rename `s_dash_for_gesture`→`s_dash` |
| `schema/layout.schema.json` | contrat layout | +`comp_switch`/`comp_button` (oneOf + $defs) |
| `test/test_core/test_main.cpp` | tests natifs | +tests parse + reflet (5) |
| `data/layout-effecteurs-test.json` (scratchpad) | layout de vérif on-device | nouveau (non committé) |

**Invariant à respecter (view.cpp) :** `static_assert(sizeof(VIEW)/sizeof(VIEW[0]) == COMP_COUNT)`. Toute valeur ajoutée à `enum CompType` **doit** avoir sa ligne dans `VIEW[]`. Pour garder **tous les builds verts à chaque commit**, les Tasks 1 et 2 ajoutent une ligne `VIEW[]` provisoire `{ nullptr, nullptr }` (composant non rendu, sauté par le moteur) ; la Task 3 la remplace par le vrai `build`/`sync`.

---

### Task 1: Switch — type + reflet (cœur natif)

**Files:**
- Modify: `src/dashboard.h` (enum `CompType`)
- Modify: `src/dashboard.cpp` (`COMP_NAMES`, `context_apply`)
- Modify: `src/view.cpp` (ligne `VIEW[]` provisoire)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1: Écrire les tests natifs (rouge)**

Dans `test/test_core/test_main.cpp`, ajouter ces deux tests à côté des tests `context_apply` existants (après `test_ctxapply_bar_value`, vers la ligne 869). Le helper `bound_layout(type, extra)` existe déjà (l.840) et fabrique un composant `x` avec `bind:"v"`.

```c
void test_switch_parsed(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"s\":{\"type\":\"switch\",\"bind\":\"lamp\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "s");
    TEST_ASSERT_EQUAL_INT(COMP_SWITCH, d.components[i].type);
    TEST_ASSERT_EQUAL_STRING("lamp", d.components[i].bind);
}
void test_ctxapply_switch_reflects(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("switch", ""), err, sizeof(err));
    int i = dash_find(&d, "x");
    dash_set_context(&d, "{\"v\":1}", 1); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(1, d.components[i].value);
    TEST_ASSERT_TRUE(d.components[i].dirty);
    dash_set_context(&d, "{\"v\":0}", 2); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(0, d.components[i].value);
}
```

Ajouter les `RUN_TEST` dans le runner (vers la ligne 1237, près des `RUN_TEST(test_ctxapply_*)`) :

```c
    RUN_TEST(test_switch_parsed);
    RUN_TEST(test_ctxapply_switch_reflects);
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `pio test -e native`
Expected: FAIL — `COMP_SWITCH` non déclaré (erreur de compilation `'COMP_SWITCH' was not declared`).

- [ ] **Step 3: Ajouter la valeur d'enum**

Dans `src/dashboard.h:7`, ajouter `COMP_SWITCH` **avant** `COMP_COUNT` :

```c
enum CompType { COMP_NONE, COMP_LABEL, COMP_READOUT, COMP_BAR, COMP_RING, COMP_LED_RING, COMP_SOUND, COMP_CHART, COMP_METER, COMP_IMAGE, COMP_IMAGE_ANIM, COMP_LED, COMP_RECT, COMP_CIRCLE, COMP_LINE, COMP_ICON, COMP_SWITCH, COMP_COUNT };
```

- [ ] **Step 4: Enregistrer le nom dans `COMP_NAMES`**

Dans `src/dashboard.cpp` (table `COMP_NAMES[]`, vers la ligne 27-34), ajouter après l'entrée `{ "icon", COMP_ICON }` :

```c
    { "switch", COMP_SWITCH },
```

- [ ] **Step 5: Ajouter le case de reflet dans `context_apply`**

Dans `src/dashboard.cpp`, fonction `context_apply` (vers la ligne 500-538), ajouter ce `case` **avant** `default: break;` :

```c
            case COMP_SWITCH:                           // effecteur : reflete l'etat on/off depuis le ctx
                if (v.type == CTX_NUM) {
                    int32_t nv = (v.num != 0) ? 1 : 0;
                    if (c.value != nv) { c.value = nv; changed = true; }
                }
                break;
```

- [ ] **Step 6: Garder `esp32s3` compilable — ligne `VIEW[]` provisoire**

Dans `src/view.cpp`, table `VIEW[]` (vers la ligne 563), ajouter après la ligne `/* COMP_ICON */` :

```c
    /* COMP_SWITCH   */ { nullptr, nullptr },   // rendu ajoute en Task 3
```

- [ ] **Step 7: Lancer les tests natifs → vert**

Run: `pio test -e native`
Expected: PASS — tous les tests, dont `test_switch_parsed` et `test_ctxapply_switch_reflects`.

- [ ] **Step 8: Vérifier que le firmware compile encore**

Run: `pio run -e esp32s3`
Expected: `[SUCCESS]` (le `static_assert` de `VIEW[]` est satisfait ; le switch ne se rend pas encore, c'est voulu).

- [ ] **Step 9: Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/view.cpp test/test_core/test_main.cpp
git commit -m "feat(switch): type COMP_SWITCH + reflet context_apply (cœur natif)

Claude-Session: https://claude.ai/code/session_017hhk3fuJASRkpuHhH8cCcv"
```

---

### Task 2: Button (set) — type + champs + parse value + reflet radio (cœur natif)

**Files:**
- Modify: `src/dashboard.h` (enum `CompType`, struct `Component`)
- Modify: `src/dashboard.cpp` (`COMP_NAMES`, parse, `context_apply`)
- Modify: `src/view.cpp` (ligne `VIEW[]` provisoire)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1: Écrire les tests natifs (rouge)**

Dans `test/test_core/test_main.cpp`, à la suite des tests de la Task 1 :

```c
void test_button_parsed_num(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"b\":{\"type\":\"button\",\"bind\":\"scene\",\"value\":2,\"text\":\"Film\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "b");
    TEST_ASSERT_EQUAL_INT(COMP_BUTTON, d.components[i].type);
    TEST_ASSERT_EQUAL_STRING("scene", d.components[i].bind);
    TEST_ASSERT_TRUE(d.components[i].set_is_num);
    TEST_ASSERT_EQUAL_STRING("2", d.components[i].set_value);
    TEST_ASSERT_EQUAL_STRING("Film", d.components[i].text);
}
void test_button_parsed_str(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"b\":{\"type\":\"button\",\"bind\":\"mode\",\"value\":\"movie\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "b");
    TEST_ASSERT_FALSE(d.components[i].set_is_num);
    TEST_ASSERT_EQUAL_STRING("movie", d.components[i].set_value);
}
void test_ctxapply_button_radio(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("button", ",\"value\":2"), err, sizeof(err));
    int i = dash_find(&d, "x");
    dash_set_context(&d, "{\"v\":2}", 1); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(1, d.components[i].value);     // ctx == value -> actif
    dash_set_context(&d, "{\"v\":3}", 2); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(0, d.components[i].value);     // ctx != value -> inactif
}
void test_ctxapply_button_radio_str(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("button", ",\"value\":\"movie\""), err, sizeof(err));
    int i = dash_find(&d, "x");
    dash_set_context(&d, "{\"v\":\"movie\"}", 1); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(1, d.components[i].value);
    dash_set_context(&d, "{\"v\":\"music\"}", 2); context_apply(&d);
    TEST_ASSERT_EQUAL_INT(0, d.components[i].value);
}
```

Ajouter les `RUN_TEST` près de ceux de la Task 1 :

```c
    RUN_TEST(test_button_parsed_num);
    RUN_TEST(test_button_parsed_str);
    RUN_TEST(test_ctxapply_button_radio);
    RUN_TEST(test_ctxapply_button_radio_str);
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `pio test -e native`
Expected: FAIL — `COMP_BUTTON` / `set_is_num` / `set_value` non déclarés.

- [ ] **Step 3: Ajouter la valeur d'enum**

Dans `src/dashboard.h:7`, ajouter `COMP_BUTTON` après `COMP_SWITCH` (toujours avant `COMP_COUNT`) :

```c
enum CompType { COMP_NONE, COMP_LABEL, COMP_READOUT, COMP_BAR, COMP_RING, COMP_LED_RING, COMP_SOUND, COMP_CHART, COMP_METER, COMP_IMAGE, COMP_IMAGE_ANIM, COMP_LED, COMP_RECT, COMP_CIRCLE, COMP_LINE, COMP_ICON, COMP_SWITCH, COMP_BUTTON, COMP_COUNT };
```

- [ ] **Step 4: Ajouter les champs config du button à la struct**

Dans `src/dashboard.h`, struct `Component`, après le bloc `icon` (vers la ligne 84, juste avant le commentaire `// --- etat (modifie par /update) ---`) :

```c
    // button (effecteur set) : valeur ecrite dans bind au tap
    char     set_value[TEXT_LEN];   // valeur a ecrire, forme canonique string ; nombre si set_is_num
    bool     set_is_num;            // true => set_value represente un nombre (write_ui_num), sinon string
```

- [ ] **Step 5: Enregistrer le nom dans `COMP_NAMES`**

Dans `src/dashboard.cpp`, table `COMP_NAMES[]`, après l'entrée `{ "switch", COMP_SWITCH }` ajoutée en Task 1 :

```c
    { "button", COMP_BUTTON },
```

- [ ] **Step 6: Parser `value` du button**

Dans `src/dashboard.cpp`, fonction `dash_set_layout`, dans la boucle des composants, ajouter ce bloc après le bloc `if (c.type == COMP_LED_RING) { ... }` (vers la ligne 230) et **avant** `t.comp_count++;` :

```c
        if (c.type == COMP_BUTTON) {                    // value (num|str) ecrite au tap (origine UI)
            JsonVariantConst bv = o["value"];
            c.set_is_num = bv.is<float>() || bv.is<int>();
            if (c.set_is_num) {
                double n = bv.as<double>();
                if (n == (double)(long)n) snprintf(c.set_value, sizeof(c.set_value), "%ld", (long)n);
                else                      snprintf(c.set_value, sizeof(c.set_value), "%g", n);
            } else {
                strlcpy(c.set_value, bv.is<const char*>() ? bv.as<const char*>() : "", sizeof(c.set_value));
            }
        }
```

- [ ] **Step 7: Ajouter le case de reflet radio dans `context_apply`**

Dans `src/dashboard.cpp`, `context_apply`, après le `case COMP_SWITCH:` (Task 1) et avant `default:` :

```c
            case COMP_BUTTON: {                         // effecteur set : actif (radio) si ctx == set_value
                int32_t nv = 0;
                if (c.set_is_num) { if (v.type == CTX_NUM && v.num == atof(c.set_value)) nv = 1; }
                else              { if (v.type == CTX_STR && strncmp(v.str, c.set_value, TEXT_LEN) == 0) nv = 1; }
                if (c.value != nv) { c.value = nv; changed = true; }
                break;
            }
```

Note : `atof` vient de `<stdlib.h>`. Vérifier l'include en tête de `src/dashboard.cpp` ; l'ajouter (`#include <stdlib.h>`) s'il manque (l'étape de build le confirmera).

- [ ] **Step 8: Garder `esp32s3` compilable — ligne `VIEW[]` provisoire**

Dans `src/view.cpp`, table `VIEW[]`, après la ligne `/* COMP_SWITCH */` (Task 1) :

```c
    /* COMP_BUTTON   */ { nullptr, nullptr },   // rendu ajoute en Task 3
```

- [ ] **Step 9: Lancer les tests natifs → vert**

Run: `pio test -e native`
Expected: PASS — dont les 4 nouveaux tests button.

- [ ] **Step 10: Vérifier que le firmware compile encore**

Run: `pio run -e esp32s3`
Expected: `[SUCCESS]`.

- [ ] **Step 11: Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/view.cpp test/test_core/test_main.cpp
git commit -m "feat(button): type COMP_BUTTON + parse value + reflet radio (cœur natif)

Claude-Session: https://claude.ai/code/session_017hhk3fuJASRkpuHhH8cCcv"
```

---

### Task 3: Rendu LVGL + callbacks tactiles (firmware)

**Files:**
- Modify: `src/view.cpp` (includes/extern, rename `s_dash`, callbacks, `build_*`/`sync_*`, remplace les 2 lignes `VIEW[]`)

Cette task n'a pas de test natif (le rendu LVGL n'est pas compilé en `env:native`, comme les afficheurs) ; elle est validée par la **compilation `esp32s3`**.

- [ ] **Step 1: Includes + accès au mutex et à `dash_ctx_write_ui_*`**

En tête de `src/view.cpp`, après les includes existants (vers la ligne 13), ajouter :

```c
#include <Arduino.h>                 // millis()
#include <stdlib.h>                  // atof()
#include "freertos/semphr.h"
#include "dashboard.h"               // dash_ctx_write_ui_num/str (deja tire via view.h, explicite ici)

extern SemaphoreHandle_t g_ctx_mutex;   // defini dans main.cpp, sérialise l'accès au contexte
```

- [ ] **Step 2: Renommer `s_dash_for_gesture` → `s_dash` (statique partagé par tous les callbacks UI)**

Dans `src/view.cpp`, le `Dashboard*` statique posé à chaque rebuild sert désormais aussi aux callbacks d'effecteurs. Remplacer les 4 occurrences :

- Déclaration (vers la ligne 570) :
```c
// Dashboard actif courant : partagé par le callback de geste (nav) ET les callbacks d'effecteurs
// (button/switch). Reposé à chaque view_rebuild. L'écran persiste à travers les rebuilds.
static Dashboard* s_dash = nullptr;
```
- Dans `gesture_cb` (vers les lignes 573, 576, 577) : remplacer `s_dash_for_gesture` par `s_dash` (3 usages).
- Dans `view_rebuild` (vers la ligne 781) : `s_dash = d;`

- [ ] **Step 3: Ajouter les callbacks d'événements**

Dans `src/view.cpp`, juste après `gesture_cb` (vers la ligne 578), ajouter :

```c
// Effecteurs : écriture d'origine UI. Tournent sur le thread UI (cœur 1, dans lv_timer_handler) ;
// prennent g_ctx_mutex en BLOQUANT (le mutex n'est jamais tenu pendant un HTTP -> attente brève)
// pour garantir l'écriture, puis dash_ctx_write_ui_* (écrit le ctx + arme les sinks observant la var).
static void switch_event_cb(lv_event_t* e) {
    lv_obj_t* w = lv_event_get_target_obj(e);
    Component* c = (Component*)lv_obj_get_user_data(w);
    if (!c || !s_dash) return;
    bool on = lv_obj_has_state(w, LV_STATE_CHECKED);
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    dash_ctx_write_ui_num(s_dash, c->bind, on ? 1 : 0, millis());
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
}
static void button_event_cb(lv_event_t* e) {
    lv_obj_t* w = lv_event_get_target_obj(e);
    Component* c = (Component*)lv_obj_get_user_data(w);
    if (!c || !s_dash) return;
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    if (c->set_is_num) dash_ctx_write_ui_num(s_dash, c->bind, atof(c->set_value), millis());
    else               dash_ctx_write_ui_str(s_dash, c->bind, c->set_value, millis());
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
}
```

- [ ] **Step 4: Ajouter `build_switch` / `sync_switch`**

Dans `src/view.cpp`, à côté des autres `build_*`/`sync_*` (après `sync_ring` ou tout autre groupe build/sync, avant la table `VIEW[]`). Le `user_data` pointe le `Component` (stable jusqu'au prochain rebuild, qui ré-assigne) ; style LVGL par défaut (le checked du thème montre l'état on).

```c
static void build_switch(lv_obj_t* parent, Component& c, Placement& q,
                         lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* sw = lv_switch_create(parent);
    if (q.width || q.height) lv_obj_set_size(sw, q.width ? q.width : 60, q.height ? q.height : 30);
    lv_obj_align(sw, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_obj_set_user_data(sw, &c);
    lv_obj_add_event_cb(sw, switch_event_cb, LV_EVENT_VALUE_CHANGED, nullptr);
    *main = sw;
}
static void sync_switch(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    if (c.value) lv_obj_add_state(w, LV_STATE_CHECKED);     // reflet (lv_obj_add_state n'émet pas VALUE_CHANGED)
    else         lv_obj_remove_state(w, LV_STATE_CHECKED);
}
```

- [ ] **Step 5: Ajouter `build_button` / `sync_button`**

Juste après `build_switch`/`sync_switch`. Label enfant dans `sub1` (suivi par `view_sync` pour le flag visible). Style par défaut LVGL ; le checked du thème distingue l'actif (reflet radio).

```c
static void build_button(lv_obj_t* parent, Component& c, Placement& q,
                         lv_obj_t** main, lv_obj_t** sub1, lv_obj_t**) {
    lv_obj_t* b = lv_button_create(parent);
    if (q.width || q.height) lv_obj_set_size(b, q.width ? q.width : 100, q.height ? q.height : 44);
    lv_obj_align(b, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_obj_set_user_data(b, &c);
    lv_obj_add_event_cb(b, button_event_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* lbl = lv_label_create(b);
    lv_obj_set_style_text_font(lbl, get_font(c.font_family, c.font, c.bold, c.italic), 0);
    lv_obj_set_style_text_color(lbl, lv_color_hex(0xFFFFFF), 0);
    lv_label_set_text(lbl, c.text);
    lv_obj_center(lbl);
    *main = b;
    *sub1 = lbl;
}
static void sync_button(Component& c, Placement&, lv_obj_t* w, lv_obj_t* sub1, lv_obj_t*) {
    if (c.value) lv_obj_add_state(w, LV_STATE_CHECKED);     // reflet radio : surbrillance si ctx == value
    else         lv_obj_remove_state(w, LV_STATE_CHECKED);
    if (sub1) lv_label_set_text(sub1, c.text);              // libellé pilotable via /update text
}
```

- [ ] **Step 6: Remplacer les lignes `VIEW[]` provisoires par les vrais pointeurs**

Dans `src/view.cpp`, table `VIEW[]`, remplacer les deux lignes `{ nullptr, nullptr }` ajoutées en Tasks 1-2 :

```c
    /* COMP_SWITCH   */ { build_switch, sync_switch },
    /* COMP_BUTTON   */ { build_button, sync_button },
```

- [ ] **Step 7: Compiler le firmware**

Run: `pio run -e esp32s3`
Expected: `[SUCCESS]`. (Si erreur `lv_event_get_target_obj` introuvable : confirmer via `grep -rn lv_event_get_target_obj .pio/libdeps/esp32s3/lvgl/src/core/lv_obj_event.h` — la signature `lv_obj_t* lv_event_get_target_obj(lv_event_t*)` existe en LVGL 9.5.)

- [ ] **Step 8: Re-vérifier les tests natifs (non régressés)**

Run: `pio test -e native`
Expected: PASS (inchangé — view.cpp hors build natif).

- [ ] **Step 9: Commit**

```bash
git add src/view.cpp
git commit -m "feat(effecteurs): rendu LVGL + callbacks tactiles button/switch (écriture UI)

Claude-Session: https://claude.ai/code/session_017hhk3fuJASRkpuHhH8cCcv"
```

---

### Task 4: Schéma + layout de test

**Files:**
- Modify: `schema/layout.schema.json` (oneOf + $defs)
- Create: `data/layout-effecteurs-test.json` (scratchpad de vérif, **non committé**)

- [ ] **Step 1: Ajouter les références au `oneOf` du composant**

Dans `schema/layout.schema.json`, `$defs.component.oneOf` (vers la ligne 106-122), ajouter après `{ "$ref": "#/$defs/comp_icon" }` (penser à la virgule sur la ligne `comp_icon`) :

```json
        { "$ref": "#/$defs/comp_switch" },
        { "$ref": "#/$defs/comp_button" }
```

- [ ] **Step 2: Ajouter les définitions `comp_switch` / `comp_button`**

Dans `$defs`, après la définition `comp_icon` (et avant `"sink"`, vers la ligne 451) :

```json
    "comp_switch": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "bind"],
      "properties": {
        "type": { "const": "switch" },
        "visible": { "type": "boolean", "description": "Affiche le composant (defaut true)." },
        "bind": { "$ref": "#/$defs/id", "description": "Variable du contexte ecrite a l'interaction (0/1, origine UI) et refletee." }
      }
    },
    "comp_button": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "bind"],
      "properties": {
        "type": { "const": "button" },
        "visible": { "type": "boolean", "description": "Affiche le composant (defaut true)." },
        "bind": { "$ref": "#/$defs/id", "description": "Variable du contexte ecrite au tap (origine UI) et refletee (radio)." },
        "value": { "type": ["number", "string"], "description": "Valeur ecrite dans bind au tap (mode set/latch). Number ou string." },
        "text": { "$ref": "#/$defs/display", "description": "Libelle du bouton." },
        "font": { "$ref": "#/$defs/font" },
        "font_family": { "$ref": "#/$defs/fontFamily" },
        "bold": { "type": "boolean" },
        "italic": { "type": "boolean" }
      }
    },
```

- [ ] **Step 3: Valider le schéma via les tests designer**

Run: `cd designer && node --test`
Expected: PASS (le schéma est chargé/validé par les tests ; aucun n'échoue → JSON du schéma bien formé). Revenir ensuite à la racine : `cd ..`.

- [ ] **Step 4: Écrire un layout de test schema-valide (vérif on-device)**

Créer `data/layout-effecteurs-test.json`. Il contient : un `switch` (bind `lamp`), un `button` set (bind `mode`, value `"movie"`), un `readout` qui affiche `lamp` (preuve du reflet par le contexte), et un `sink` qui observe `lamp`. **Remplacer `URL_DU_SERVEUR_DE_TEST`** par l'endpoint d'observation à l'étape de vérif (Task 5).

```json
{
  "title": "B1 effecteurs",
  "background": "#0B0B0F",
  "sinks": [
    { "name": "lamp-sink", "watch": "lamp", "method": "POST",
      "url": "URL_DU_SERVEUR_DE_TEST", "debounce_ms": 0,
      "body": { "lamp": "{{lamp}}" } }
  ],
  "components": {
    "sw":  { "type": "switch", "bind": "lamp" },
    "btn": { "type": "button", "bind": "mode", "value": "movie", "text": "Film" },
    "ro":  { "type": "readout", "bind": "lamp", "label": "lamp" }
  },
  "pages": [
    { "name": "p", "place": [
      { "ref": "sw",  "anchor": "TOP_MID",    "dy": 90 },
      { "ref": "btn", "anchor": "CENTER",     "width": 120, "height": 50 },
      { "ref": "ro",  "anchor": "BOTTOM_MID", "dy": -90 }
    ]}
  ]
}
```

- [ ] **Step 5: Commit (schéma uniquement — le layout de test reste hors git)**

```bash
git add schema/layout.schema.json
git commit -m "feat(schema): comp_switch + comp_button (effecteurs B1)

Claude-Session: https://claude.ai/code/session_017hhk3fuJASRkpuHhH8cCcv"
```

---

### Task 5: Vérif on-device (1ʳᵉ activation réelle de la couche A)

**But :** prouver bout-en-bout, sur le device, le modèle effecteur→sink : tap écrit la var (origine UI) → l'afficheur `bind` reflète → le sink **POST** (secret résolu) → **anti-boucle** (une écriture EXTERNAL n'arme pas le sink). Aucun test automatisé — vérif manuelle avec l'utilisateur.

**Préalable (mémoire `uploadfs-efface-assets-device`) :** un `pio run -e esp32s3 -t upload` (firmware seul) **ne touche pas** le LittleFS → les assets device sont préservés. On **n'utilise pas** `uploadfs` ici. Le layout de test est poussé à chaud via `POST /layout` (pas via l'image FS).

- [ ] **Step 1: Lancer un serveur de réception local pour le sink**

Lancer un petit serveur HTTP qui logge les requêtes reçues, sur un port **autre que 8000** (mémoire `test-server-hygiene`), accessible depuis le LAN. Récupérer son URL (`http://<ip-du-poste>:<port>/`). Mettre cette URL dans `data/layout-effecteurs-test.json` (clé `sinks[0].url`). **Arrêter ce serveur en fin de vérif.**

- [ ] **Step 2: Flasher le firmware (sans toucher au FS)**

Run: `pio run -e esp32s3 -t upload`
Expected: upload OK. (Gotcha port série : si « No serial data received » → c'est le casque Bluetooth auto-détecté, relancer pour viser `/dev/cu.usbmodem*`.) Le device garde son layout courant jusqu'au POST suivant.

- [ ] **Step 3: Pousser le layout de test à chaud**

Run: `curl -X POST http://dialboard.local/layout -H 'Content-Type: application/json' --data-binary @data/layout-effecteurs-test.json`
Expected: `{"ok":true}`. L'écran affiche le switch, le bouton « Film » et le readout `lamp`.

- [ ] **Step 4: Vérifier l'écriture UI + le reflet (cohérence interne)**

Au doigt sur le device : basculer le switch ON. Puis :
Run: `curl http://dialboard.local/context`
Expected: `{"lamp":1}` (le tap a écrit la var). Le readout `lamp` à l'écran affiche `lamp 1`. Basculer OFF → `GET /context` montre `lamp:0`, readout `lamp 0`.

- [ ] **Step 5: Vérifier le tir du sink (push réactif)**

Après un toggle ON, observer le serveur de réception (Step 1) : il reçoit **un** `POST` avec le corps `{"lamp":1}` (`debounce_ms:0` → tir au tick suivant). Puis :
Run: `curl http://dialboard.local/status`
Expected: l'entrée `sinks[]` `lamp-sink` montre `last_status` = code HTTP du serveur (ex. 200) et un `fired_at` non nul.

- [ ] **Step 6: Vérifier l'anti-boucle (écriture EXTERNAL n'arme pas)**

Noter le `fired_at` courant du sink (`GET /status`). Écrire la var en EXTERNAL :
Run: `curl -X POST http://dialboard.local/context -H 'Content-Type: application/json' -d '{"lamp":1}'`
Expected: le serveur de réception **ne reçoit aucun** nouveau POST, et `GET /status` montre `fired_at` **inchangé** (l'écriture EXTERNAL met à jour l'affichage mais **n'arme pas** le sink). Le switch à l'écran reflète bien `lamp:1` (reflet sans boucle).

- [ ] **Step 7: Vérifier le button set + reflet radio**

Tap le bouton « Film ». `GET /context` → `{"mode":"movie", ...}`. Le bouton apparaît en état actif (surbrillance checked). Écrire `POST /context {"mode":"music"}` → le bouton repasse inactif (reflet radio, sans tir puisque aucun sink n'observe `mode`).

- [ ] **Step 8: Arrêter le serveur de réception et consigner**

Arrêter le serveur du Step 1. Consigner le résultat (OK / écarts) ; mettre à jour `docs/_internal/HANDOFF.md` et la mémoire `effecteurs-plan.md` (B1 livré, couche A vérifiée on-device). Pas de commit de code à cette étape (vérif uniquement).

---

## Self-Review

**Couverture spec (§4.4) :** `switch` (VALUE_CHANGED → bind=on?1:0, reflet) ✔ Task 1+3 ; `button` set (CLICKED → bind=value, reflet radio) ✔ Task 2+3 ; parité parser + schéma (oneOf + $defs strict) ✔ Task 2+4 ; interaction = callbacks LVGL sur thread UI prenant `g_ctx_mutex` ✔ Task 3. **Hors B1 (assumé)** : `momentary`, `slider`, `arc`, `roller`, règle anti-conflit reflet/drag → B2. Critères de succès §8 (1,2,3 partiel — switch/button, 4) couverts par Task 5 ; §8.5 (builds verts + parité) par Tasks 1-4 ; §8.6 (pas de régression nav/afficheurs) garanti par `static_assert VIEW` + tests natifs non régressés.

**Placeholders :** aucun — code complet à chaque étape, sauf l'URL du serveur de réception (Task 4/5) qui est par nature un paramètre d'environnement renseigné à la vérif.

**Cohérence des types :** `COMP_SWITCH`/`COMP_BUTTON` ajoutés à l'enum (Tasks 1/2) ET à `VIEW[]` (provisoire Tasks 1/2 → réel Task 3) → `static_assert` toujours satisfait, tous les builds verts à chaque commit. `set_value`/`set_is_num` définis (Task 2 struct) puis utilisés au parse (Task 2), au reflet (Task 2 `context_apply`) et au callback (Task 3 `button_event_cb`) — noms identiques partout. `s_dash` renommé en une fois (Task 3) avec ses 4 occurrences. `dash_ctx_write_ui_num/str` : signature `(Dashboard*, const char*, double|const char*, uint32_t)` respectée.
