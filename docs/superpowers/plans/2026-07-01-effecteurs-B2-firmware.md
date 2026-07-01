# Effecteurs B2 firmware (momentary + slider + arc + roller) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au firmware les 4 comportements effecteurs restants — `momentary` (mode du button), `slider`, `arc`, `roller` — avec écriture d'origine UI, reflet `bind`, capture-à-l'armement pour le momentary et anti-conflit reflet↔drag par l'état LVGL `PRESSED`.

**Architecture:** Tranche firmware pure sur le gabarit B1 : nouveaux `COMP_*` dans le pipeline `CompType`→`COMP_NAMES`→`APPLY[]`/`VIEW[]` (double `static_assert(COMP_COUNT)`), parse tolérant dans `dash_set_layout`, reflet via `context_apply`+`sync_*`, écriture UI via `dash_ctx_write_ui_*` (live) et `dash_ctx_pulse_*` (momentary, fige le corps du sink au tap). Le core (parse, capture, reflet, quantification) est **natif-testable** ; le rendu LVGL + callbacks (view.cpp) est esp32-only, build-vérifié + on-device. **Aucun schéma ni designer** (→ Plan C2).

**Tech Stack:** C++/Arduino, LVGL 9.5 (`lv_slider`/`lv_arc`/`lv_roller`), ArduinoJson, Unity (env:native), PlatformIO.

Spec de référence : `docs/superpowers/specs/2026-07-01-effecteurs-B2-firmware-design.md`.

---

## File Structure

- `src/config.h` — MODIFY : bornes `ROLLER_OPTS_LEN`, `MAX_ROLLER_ROWS`.
- `src/dashboard.h` — MODIFY : enum `CompType` (+3), champs `Component` (`momentary`/`step`/`roller_options`/`roller_rows`), champs runtime `Sink` (`captured_body`/`has_capture`), prototypes `dash_ctx_pulse_*` + `slider_quantize`.
- `src/dashboard.cpp` — MODIFY : `COMP_NAMES`, parse (momentary/step/roller), `APPLY[]` (+3 nullptr), `arm_sinks(capture)`, `dash_ctx_pulse_*`, cases `context_apply` (+3), `slider_quantize`, `#include "sink.h"` + `<math.h>`.
- `src/net_push.cpp` — MODIFY : `fire_one` consomme la capture.
- `src/view.cpp` — MODIFY : `build_/sync_` slider/arc/roller, callbacks, branche momentary de `button_event_cb`, `VIEW[]`.
- `test/test_core/test_main.cpp` — MODIFY : tests parse + capture + reflet + quantification + `RUN_TEST`.

---

## Task 1 : Enum, bornes, struct, COMP_NAMES, parse (core natif)

**Files:**
- Modify: `src/config.h`
- Modify: `src/dashboard.h`
- Modify: `src/dashboard.cpp`
- Modify: `src/view.cpp` (placeholders `VIEW[]` pour garder l'esp32 vert)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1: Write the failing test**

Ajouter dans `test/test_core/test_main.cpp`, près de `test_button_parsed_str` (~ligne 907) :

```cpp
void test_slider_parsed(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"s\":{\"type\":\"slider\",\"bind\":\"vol\",\"min\":0,\"max\":10,"
                    "\"step\":2,\"orientation\":\"vertical\"}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "s");
    TEST_ASSERT_EQUAL_INT(COMP_SLIDER, d.components[i].type);
    TEST_ASSERT_EQUAL_STRING("vol", d.components[i].bind);
    TEST_ASSERT_EQUAL_INT(0,  d.components[i].vmin);
    TEST_ASSERT_EQUAL_INT(10, d.components[i].vmax);
    TEST_ASSERT_EQUAL_INT(2,  d.components[i].step);
    TEST_ASSERT_TRUE(d.components[i].bar_vertical);
}
void test_arc_parsed(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"a\":{\"type\":\"arc\",\"bind\":\"dim\",\"min\":0,\"max\":255}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "a");
    TEST_ASSERT_EQUAL_INT(COMP_ARC, d.components[i].type);
    TEST_ASSERT_EQUAL_INT(255, d.components[i].vmax);
}
void test_roller_parsed(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"r\":{\"type\":\"roller\",\"bind\":\"src\","
                    "\"options\":[\"HDMI\",\"TV\",\"AUX\"],\"rows\":5}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "r");
    TEST_ASSERT_EQUAL_INT(COMP_ROLLER, d.components[i].type);
    TEST_ASSERT_EQUAL_STRING("HDMI\nTV\nAUX", d.components[i].roller_options);
    TEST_ASSERT_EQUAL_INT(5, d.components[i].roller_rows);
}
void test_button_momentary_parsed(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"b\":{\"type\":\"button\",\"bind\":\"bell\",\"value\":1,"
                    "\"momentary\":true}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    int i = dash_find(&d, "b");
    TEST_ASSERT_TRUE(d.components[i].momentary);
}
void test_button_set_defaults_not_momentary(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"components\":{\"b\":{\"type\":\"button\",\"bind\":\"scene\",\"value\":2}},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    TEST_ASSERT_FALSE(d.components[dash_find(&d,"b")].momentary);
}
```

Enregistrer, près des `RUN_TEST(test_button_parsed_*)` (~ligne 1298) :

```cpp
    RUN_TEST(test_slider_parsed);
    RUN_TEST(test_arc_parsed);
    RUN_TEST(test_roller_parsed);
    RUN_TEST(test_button_momentary_parsed);
    RUN_TEST(test_button_set_defaults_not_momentary);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pio test -e native`
Expected: FAIL de compilation — `COMP_SLIDER` / `d.components[i].step` / `.momentary` / `.roller_options` non déclarés.

- [ ] **Step 3: Implement**

`src/config.h` — ajouter près de `SINK_BODY_LEN` (~ligne 14) :

```cpp
#define ROLLER_OPTS_LEN        160
#define MAX_ROLLER_ROWS          7
```

`src/dashboard.h` — enum `CompType` (ligne 7), insérer avant `COMP_COUNT` :

```cpp
enum CompType { COMP_NONE, COMP_LABEL, COMP_READOUT, COMP_BAR, COMP_RING, COMP_LED_RING, COMP_SOUND, COMP_CHART, COMP_METER, COMP_IMAGE, COMP_IMAGE_ANIM, COMP_LED, COMP_RECT, COMP_CIRCLE, COMP_LINE, COMP_ICON, COMP_SWITCH, COMP_BUTTON, COMP_SLIDER, COMP_ARC, COMP_ROLLER, COMP_COUNT };
```

`src/dashboard.h` — dans `struct Component`, juste après le bloc button (après `bool set_is_num;`, ~ligne 89) :

```cpp
    // button momentary (impulsion) : true => pulse (capture-à-l'arm) au lieu de set
    bool     momentary;
    // slider/arc : pas de composant neuf ; min/max réutilisent vmin/vmax, orientation slider = bar_vertical
    int32_t  step;                  // slider/arc : pas de quantification si <= 0
    // roller : libellés joints par '\n' + rangées visibles
    char     roller_options[ROLLER_OPTS_LEN];
    uint8_t  roller_rows;
```

`src/dashboard.cpp` — `COMP_NAMES` (~ligne 34), après la ligne `{ "button", COMP_BUTTON },` ajouter :

```cpp
    { "slider", COMP_SLIDER },
    { "arc",    COMP_ARC    },
    { "roller", COMP_ROLLER },
```

`src/dashboard.cpp` — dans `dash_set_layout`, après `c.vmax = o["max"] | 100;` (~ligne 133) ajouter :

```cpp
        c.step        = o["step"] | 0;
```

`src/dashboard.cpp` — dans le bloc `if (c.type == COMP_BUTTON) { … }` (~ligne 233), ajouter en fin de bloc, avant l'accolade fermante :

```cpp
            c.momentary = o["momentary"] | false;
```

`src/dashboard.cpp` — juste après ce bloc button, ajouter le bloc roller :

```cpp
        if (c.type == COMP_ROLLER) {
            size_t ro = 0;
            for (JsonVariantConst ov : o["options"].as<JsonArrayConst>()) {
                const char* opt = ov.is<const char*>() ? ov.as<const char*>() : "";
                if (ro && ro + 1 < sizeof(c.roller_options)) c.roller_options[ro++] = '\n';
                for (const char* p = opt; *p && ro + 1 < sizeof(c.roller_options); p++) c.roller_options[ro++] = *p;
            }
            c.roller_options[ro] = '\0';
            int rows = o["rows"] | 3;
            if (rows < 1) rows = 1;
            if (rows > MAX_ROLLER_ROWS) rows = MAX_ROLLER_ROWS;
            c.roller_rows = (uint8_t)rows;
        }
```

`src/dashboard.cpp` — dans `APPLY[]` (~ligne 457), après `/* COMP_BUTTON */ nullptr,` ajouter :

```cpp
    /* COMP_SLIDER   */ nullptr,             // effecteur : reflet via context_apply
    /* COMP_ARC      */ nullptr,
    /* COMP_ROLLER   */ nullptr,
```

`src/view.cpp` — dans `VIEW[]` (~ligne 609), après `/* COMP_BUTTON */ { build_button, sync_button },` ajouter des placeholders (remplacés en Task 6, gardent l'esp32 buildable) :

```cpp
    /* COMP_SLIDER   */ { nullptr, nullptr },
    /* COMP_ARC      */ { nullptr, nullptr },
    /* COMP_ROLLER   */ { nullptr, nullptr },
```

- [ ] **Step 4: Run tests**

Run: `pio test -e native`
Expected: PASS (les 5 nouveaux tests verts, aucune régression).

- [ ] **Step 5: Build esp32 (parité tables)**

Run: `pio run -e esp32s3`
Expected: SUCCESS (les deux `static_assert(COMP_COUNT)` satisfaits).

- [ ] **Step 6: Commit**

```bash
git add src/config.h src/dashboard.h src/dashboard.cpp src/view.cpp test/test_core/test_main.cpp
git commit -m "feat(effecteurs): B2 — types slider/arc/roller + parse momentary/step/options"
```

---

## Task 2 : Capture-à-l'armement (core natif)

**Files:**
- Modify: `src/dashboard.h` (champs runtime `Sink`, prototypes)
- Modify: `src/dashboard.cpp` (`arm_sinks(capture)`, `dash_ctx_pulse_*`, includes)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1: Write the failing test**

Ajouter près des tests d'armement (~ligne 837, après `test_ui_write_arms_only_matching_watch`) :

```cpp
// --- momentary : capture à l'armement ---
static const char* LAYOUT_SINK_BELL =
  "{\"sinks\":[{\"watch\":\"bell\",\"url\":\"http://h/\",\"body\":{\"v\":\"{{bell}}\"}}],"
  "\"components\":{},\"pages\":[]}";

void test_pulse_arms_and_captures_num(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_BELL, err, sizeof(err));
    dash_ctx_pulse_num(&d, "bell", 1, 5000);
    TEST_ASSERT_EQUAL_UINT32(5000, d.sinks[0].pending_since);              // armé
    TEST_ASSERT_TRUE(d.sinks[0].has_capture);                             // capturé
    TEST_ASSERT_EQUAL_STRING("{\"v\":\"1\"}", d.sinks[0].captured_body);  // impulsion figée
    TEST_ASSERT_EQUAL_INT(0, (int)d.ctx.vars[ctx_find(&d.ctx,"bell")].num); // ctx retombé à 0
}
void test_pulse_captures_and_resets_str(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, "{\"sinks\":[{\"watch\":\"scene\",\"url\":\"http://h/\"}],"
                        "\"components\":{},\"pages\":[]}", err, sizeof(err));
    dash_ctx_pulse_str(&d, "scene", "ring", 7000);
    TEST_ASSERT_TRUE(d.sinks[0].has_capture);
    TEST_ASSERT_EQUAL_STRING("{\"scene\":\"ring\"}", d.sinks[0].captured_body);  // corps défaut typé
    TEST_ASSERT_EQUAL_STRING("", d.ctx.vars[ctx_find(&d.ctx,"scene")].str);      // retombé à ""
}
void test_live_write_clears_stale_capture(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_BELL, err, sizeof(err));
    dash_ctx_pulse_num(&d, "bell", 1, 5000);
    TEST_ASSERT_TRUE(d.sinks[0].has_capture);
    dash_ctx_write_ui_num(&d, "bell", 2, 6000);          // write live sur la même var
    TEST_ASSERT_FALSE(d.sinks[0].has_capture);           // capture effacée
    TEST_ASSERT_EQUAL_UINT32(6000, d.sinks[0].pending_since);
}
void test_pulse_arms_only_matching_watch(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_BELL, err, sizeof(err));
    dash_ctx_pulse_num(&d, "other", 1, 5000);
    TEST_ASSERT_EQUAL_UINT32(0, d.sinks[0].pending_since);
    TEST_ASSERT_FALSE(d.sinks[0].has_capture);
}
void test_repeated_pulse_rearms_same_value(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_BELL, err, sizeof(err));
    dash_ctx_pulse_num(&d, "bell", 1, 5000);
    d.sinks[0].pending_since = 0; d.sinks[0].has_capture = false;   // simule un tir consommé
    dash_ctx_pulse_num(&d, "bell", 1, 8000);                        // même valeur
    TEST_ASSERT_EQUAL_UINT32(8000, d.sinks[0].pending_since);       // ré-armé malgré valeur inchangée
    TEST_ASSERT_TRUE(d.sinks[0].has_capture);
}
```

Enregistrer, près de `RUN_TEST(test_ui_write_arms_only_matching_watch)` (~ligne 1398) :

```cpp
    RUN_TEST(test_pulse_arms_and_captures_num);
    RUN_TEST(test_pulse_captures_and_resets_str);
    RUN_TEST(test_live_write_clears_stale_capture);
    RUN_TEST(test_pulse_arms_only_matching_watch);
    RUN_TEST(test_repeated_pulse_rearms_same_value);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pio test -e native`
Expected: FAIL de compilation — `dash_ctx_pulse_num`/`has_capture`/`captured_body` non déclarés.

- [ ] **Step 3: Implement**

`src/dashboard.h` — dans `struct Sink`, après `uint32_t fired_at;` (~ligne 156, avant `};`) :

```cpp
    // capture à l'armement (momentary) : corps figé au tap, consommé au tir
    char        captured_body[SINK_BODY_LEN + TEXT_LEN];
    bool        has_capture;
```

`src/dashboard.h` — après les prototypes `dash_ctx_write_ui_*` (~ligne 186) :

```cpp
void dash_ctx_pulse_num(Dashboard* d, const char* var, double v, uint32_t now);   // momentary : capture + reset
void dash_ctx_pulse_str(Dashboard* d, const char* var, const char* v, uint32_t now);
```

`src/dashboard.cpp` — en tête, ajouter l'include (`sink_render_body`) près des autres includes :

```cpp
#include "sink.h"
```

`src/dashboard.cpp` — remplacer `arm_sinks` + les writers UI (~lignes 497-507) par :

```cpp
// Arme (pending_since = now) chaque sink dont watch == var. now==0 -> 1 (0 = "non armé").
// capture=true (momentary) : fige le corps rendu maintenant ; capture=false (live) : efface toute capture périmée.
static void arm_sinks(Dashboard* d, const char* var, uint32_t now, bool capture) {
    for (int i = 0; i < d->sink_count; i++)
        if (strncmp(d->sinks[i].watch, var, ID_LEN) == 0) {
            d->sinks[i].pending_since = now ? now : 1;
            if (capture) {
                sink_render_body(d->sinks[i].body, d->sinks[i].watch, &d->ctx,
                                 d->sinks[i].captured_body, sizeof(d->sinks[i].captured_body));
                d->sinks[i].has_capture = true;
            } else {
                d->sinks[i].has_capture = false;
            }
        }
}
void dash_ctx_write_ui_num(Dashboard* d, const char* var, double v, uint32_t now) {
    if (ctx_set_num(&d->ctx, var, v, now)) arm_sinks(d, var, now, false);
}
void dash_ctx_write_ui_str(Dashboard* d, const char* var, const char* v, uint32_t now) {
    if (ctx_set_str(&d->ctx, var, v, now)) arm_sinks(d, var, now, false);
}
// Momentary : écrit l'impulsion (arme + fige le corps), puis reset EXTERNAL (n'arme pas) -> retombée
// d'un afficheur bind. Le ré-tir ne dépend PAS du reset (ctx_set renvoie true à chaque write).
void dash_ctx_pulse_num(Dashboard* d, const char* var, double v, uint32_t now) {
    if (ctx_set_num(&d->ctx, var, v, now)) arm_sinks(d, var, now, true);
    ctx_set_num(&d->ctx, var, 0, now);
}
void dash_ctx_pulse_str(Dashboard* d, const char* var, const char* v, uint32_t now) {
    if (ctx_set_str(&d->ctx, var, v, now)) arm_sinks(d, var, now, true);
    ctx_set_str(&d->ctx, var, "", now);
}
```

- [ ] **Step 4: Run tests**

Run: `pio test -e native`
Expected: PASS (5 nouveaux verts, aucune régression — notamment `test_ui_write_arms_sink` toujours vert).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.h src/dashboard.cpp test/test_core/test_main.cpp
git commit -m "feat(effecteurs): B2 — capture à l'armement (dash_ctx_pulse_*) pour le momentary"
```

---

## Task 3 : `fire_one` consomme la capture (esp32)

**Files:**
- Modify: `src/net_push.cpp`

> `net_push.cpp` (WiFi/HTTP) n'est **pas** dans le build natif → pas de test Unity ; vérifié par le build esp32 et le raisonnement. La logique de capture elle-même est couverte par Task 2.

- [ ] **Step 1: Implement**

`src/net_push.cpp` — dans `fire_one`, remplacer la ligne `sink_render_body(s.body, s.watch, &s_d->ctx, job.body, sizeof(job.body));` (~ligne 46) par :

```cpp
    if (s.has_capture) {                              // momentary : corps figé au tap
        strlcpy(job.body, s.captured_body, sizeof(job.body));
        s.has_capture = false;                        // consommé
    } else {
        sink_render_body(s.body, s.watch, &s_d->ctx, job.body, sizeof(job.body));
    }
```

- [ ] **Step 2: Build esp32**

Run: `pio run -e esp32s3`
Expected: SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add src/net_push.cpp
git commit -m "feat(effecteurs): B2 — fire_one tire le corps capturé (momentary) si présent"
```

---

## Task 4 : Reflet `context_apply` slider/arc/roller (core natif)

**Files:**
- Modify: `src/dashboard.cpp` (cases `context_apply`)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1: Write the failing test**

Ajouter près de `test_ctxapply_bar_value` (~ligne 869) :

```cpp
void test_ctxapply_slider_value(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("slider", ",\"min\":0,\"max\":100"), err, sizeof(err));
    dash_set_context(&d, "{\"v\":42}", 1);
    context_apply(&d);
    int i = dash_find(&d,"x");
    TEST_ASSERT_EQUAL_INT(42, d.components[i].value);
    TEST_ASSERT_TRUE(d.components[i].dirty);
}
void test_ctxapply_arc_value(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("arc", ",\"min\":0,\"max\":255"), err, sizeof(err));
    dash_set_context(&d, "{\"v\":128}", 1);
    context_apply(&d);
    TEST_ASSERT_EQUAL_INT(128, d.components[dash_find(&d,"x")].value);
}
void test_ctxapply_roller_index(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, bound_layout("roller", ",\"options\":[\"A\",\"B\",\"C\"]"), err, sizeof(err));
    dash_set_context(&d, "{\"v\":2}", 1);
    context_apply(&d);
    TEST_ASSERT_EQUAL_INT(2, d.components[dash_find(&d,"x")].value);
}
```

Enregistrer, près de `RUN_TEST(test_ctxapply_bar_value)` (~ligne 1346) :

```cpp
    RUN_TEST(test_ctxapply_slider_value);
    RUN_TEST(test_ctxapply_arc_value);
    RUN_TEST(test_ctxapply_roller_index);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pio test -e native`
Expected: FAIL — `value` reste 0 (aucun case pour slider/arc/roller → `default: break`).

- [ ] **Step 3: Implement**

`src/dashboard.cpp` — dans `context_apply`, ajouter les cases juste avant `case COMP_SWITCH:` (~ligne 554) :

```cpp
            case COMP_SLIDER:
            case COMP_ARC:
            case COMP_ROLLER:                           // effecteur : scalaire -> valeur (index pour roller)
                if (v.type == CTX_NUM) {
                    int32_t nv = (int32_t)v.num;
                    if (c.value != nv) { c.value = nv; changed = true; }
                }
                break;
```

- [ ] **Step 4: Run tests**

Run: `pio test -e native`
Expected: PASS (3 nouveaux verts).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.cpp test/test_core/test_main.cpp
git commit -m "feat(effecteurs): B2 — reflet context_apply slider/arc/roller"
```

---

## Task 5 : Quantification `step` (helper pur, core natif)

**Files:**
- Modify: `src/dashboard.h` (prototype), `src/dashboard.cpp` (impl + `<math.h>`)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1: Write the failing test**

Ajouter près des tests slider (~après `test_slider_parsed`) :

```cpp
void test_slider_quantize_snaps(void) {
    TEST_ASSERT_EQUAL_INT(10, slider_quantize(12, 0, 5));    // 12 -> 10
    TEST_ASSERT_EQUAL_INT(15, slider_quantize(13, 0, 5));    // 13 -> 15
    TEST_ASSERT_EQUAL_INT(20, slider_quantize(22, 10, 5));   // offset vmin : (22-10)/5=2.4 -> 20
}
void test_slider_quantize_off_when_step_zero(void) {
    TEST_ASSERT_EQUAL_INT(42, slider_quantize(42, 0, 0));    // step<=0 -> pas de quantification
    TEST_ASSERT_EQUAL_INT(42, slider_quantize(42, 0, -3));
}
```

Enregistrer, près des `RUN_TEST(test_slider_parsed)` :

```cpp
    RUN_TEST(test_slider_quantize_snaps);
    RUN_TEST(test_slider_quantize_off_when_step_zero);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pio test -e native`
Expected: FAIL de compilation — `slider_quantize` non déclaré.

- [ ] **Step 3: Implement**

`src/dashboard.h` — après les prototypes `dash_ctx_pulse_*` :

```cpp
int32_t slider_quantize(int32_t val, int32_t vmin, int32_t step);   // arrondi au pas ; step<=0 => val
```

`src/dashboard.cpp` — ajouter `#include <math.h>` en tête, et la fonction (près des writers UI) :

```cpp
int32_t slider_quantize(int32_t val, int32_t vmin, int32_t step) {
    if (step <= 0) return val;
    int32_t steps = (int32_t)lround((double)(val - vmin) / step);
    return vmin + steps * step;
}
```

- [ ] **Step 4: Run tests**

Run: `pio test -e native`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.h src/dashboard.cpp test/test_core/test_main.cpp
git commit -m "feat(effecteurs): B2 — quantification step (slider_quantize, helper pur testé)"
```

---

## Task 6 : Rendu LVGL + callbacks (view.cpp, esp32)

**Files:**
- Modify: `src/view.cpp`

> Rendu + callbacks non natif-testables (comme les afficheurs / B1) : vérifiés par le build esp32 puis on-device (Task 7).

- [ ] **Step 1: Déclarations des callbacks**

`src/view.cpp` — près des déclarations `switch_event_cb`/`button_event_cb` (~ligne 547) :

```cpp
static void slider_event_cb(lv_event_t* e);
static void arc_event_cb(lv_event_t* e);
static void roller_event_cb(lv_event_t* e);
```

- [ ] **Step 2: build_/sync_ des 3 widgets**

`src/view.cpp` — après `sync_button` (~ligne 581), ajouter :

```cpp
static void build_slider(lv_obj_t* parent, Component& c, Placement& q,
                         lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* s = lv_slider_create(parent);
    lv_obj_set_size(s, q.width ? q.width : 200, q.height ? q.height : 16);
    lv_slider_set_range(s, c.vmin, c.vmax);
    lv_slider_set_orientation(s, c.bar_vertical ? LV_SLIDER_ORIENTATION_VERTICAL
                                                : LV_SLIDER_ORIENTATION_HORIZONTAL);
    lv_obj_set_style_bg_color(s, lv_color_hex(c.color), LV_PART_INDICATOR);
    lv_obj_align(s, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_obj_set_user_data(s, &c);
    lv_obj_add_event_cb(s, slider_event_cb, LV_EVENT_VALUE_CHANGED, nullptr);
    *main = s;
}
static void sync_slider(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    if (lv_obj_has_state(w, LV_STATE_PRESSED)) return;   // anti-conflit : ne pas arracher le doigt
    lv_slider_set_value(w, c.value, LV_ANIM_OFF);
}
static void build_arc(lv_obj_t* parent, Component& c, Placement& q,
                      lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* a = lv_arc_create(parent);
    int d = q.radius ? q.radius * 2 : 160;
    lv_obj_set_size(a, d, d);
    lv_obj_align(a, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_arc_set_range(a, c.vmin, c.vmax);
    lv_arc_set_bg_angles(a, 90 + q.start_angle + q.gap_deg / 2,
                            90 + q.start_angle - q.gap_deg / 2);
    lv_obj_set_style_arc_width(a, q.thickness, LV_PART_MAIN);
    lv_obj_set_style_arc_width(a, q.thickness, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(a, lv_color_hex(0x1F2937), LV_PART_MAIN);
    lv_obj_set_style_arc_color(a, lv_color_hex(c.color), LV_PART_INDICATOR);
    lv_obj_set_user_data(a, &c);                          // knob conservé (input), CLICKABLE gardé
    lv_obj_add_event_cb(a, arc_event_cb, LV_EVENT_VALUE_CHANGED, nullptr);
    *main = a;
}
static void sync_arc(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    if (lv_obj_has_state(w, LV_STATE_PRESSED)) return;
    lv_arc_set_value(w, c.value);
}
static void build_roller(lv_obj_t* parent, Component& c, Placement& q,
                         lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* r = lv_roller_create(parent);
    lv_roller_set_options(r, c.roller_options, LV_ROLLER_MODE_NORMAL);
    lv_roller_set_visible_row_count(r, c.roller_rows ? c.roller_rows : 3);
    if (q.width) lv_obj_set_width(r, q.width);
    lv_obj_align(r, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_obj_set_user_data(r, &c);
    lv_obj_add_event_cb(r, roller_event_cb, LV_EVENT_VALUE_CHANGED, nullptr);
    *main = r;
}
static void sync_roller(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    if (lv_obj_has_state(w, LV_STATE_PRESSED)) return;
    lv_roller_set_selected(w, (uint16_t)(c.value < 0 ? 0 : c.value), LV_ANIM_OFF);
}
```

- [ ] **Step 3: Callbacks (écriture UI) + branche momentary du button**

`src/view.cpp` — après `button_event_cb` (~ligne 648), ajouter les 3 callbacks :

```cpp
static void slider_event_cb(lv_event_t* e) {
    lv_obj_t* w = lv_event_get_target_obj(e);
    Component* c = (Component*)lv_obj_get_user_data(w);
    if (!c || !s_dash || !c->bind[0]) return;
    int32_t val = slider_quantize(lv_slider_get_value(w), c->vmin, c->step);
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    dash_ctx_write_ui_num(s_dash, c->bind, val, millis());
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
}
static void arc_event_cb(lv_event_t* e) {
    lv_obj_t* w = lv_event_get_target_obj(e);
    Component* c = (Component*)lv_obj_get_user_data(w);
    if (!c || !s_dash || !c->bind[0]) return;
    int32_t val = slider_quantize(lv_arc_get_value(w), c->vmin, c->step);
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    dash_ctx_write_ui_num(s_dash, c->bind, val, millis());
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
}
static void roller_event_cb(lv_event_t* e) {
    lv_obj_t* w = lv_event_get_target_obj(e);
    Component* c = (Component*)lv_obj_get_user_data(w);
    if (!c || !s_dash || !c->bind[0]) return;
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    dash_ctx_write_ui_num(s_dash, c->bind, (double)lv_roller_get_selected(w), millis());
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
}
```

`src/view.cpp` — remplacer le corps de `button_event_cb` (~lignes 644-647) pour brancher le momentary :

```cpp
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    if (c->momentary) {
        if (c->set_is_num) dash_ctx_pulse_num(s_dash, c->bind, c->set_value_num, millis());
        else               dash_ctx_pulse_str(s_dash, c->bind, c->set_value, millis());
    } else {
        if (c->set_is_num) dash_ctx_write_ui_num(s_dash, c->bind, c->set_value_num, millis());
        else               dash_ctx_write_ui_str(s_dash, c->bind, c->set_value, millis());
    }
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
```

- [ ] **Step 4: Brancher `VIEW[]`**

`src/view.cpp` — remplacer les 3 placeholders de `VIEW[]` (Task 1) par :

```cpp
    /* COMP_SLIDER   */ { build_slider, sync_slider },
    /* COMP_ARC      */ { build_arc,    sync_arc    },
    /* COMP_ROLLER   */ { build_roller, sync_roller },
```

- [ ] **Step 5: Build esp32**

Run: `pio run -e esp32s3`
Expected: SUCCESS. En cas d'échec sur `lv_slider_set_orientation` / `LV_SLIDER_ORIENTATION_*`, vérifier l'API LVGL 9.5 (Context7 `/websites/lvgl_io_open`) — `lv_slider` hérite de `lv_bar` ; à défaut, régler l'orientation via `lv_obj_set_style` équivalent du bar. Ajuster puis rebuild.

- [ ] **Step 6: Commit**

```bash
git add src/view.cpp
git commit -m "feat(effecteurs): B2 — rendu LVGL + callbacks slider/arc/roller & momentary"
```

---

## Task 7 : Vérification finale (natif + esp32 + on-device)

**Files:** aucun (vérification).

- [ ] **Step 1: Suite native complète**

Run: `pio test -e native`
Expected: PASS — 148 (B1) + 15 nouveaux = **163/163**.

- [ ] **Step 2: Build esp32**

Run: `pio run -e esp32s3`
Expected: SUCCESS (noter RAM %, Flash %).

- [ ] **Step 3: Flash + layout de test**

⚠️ **Sauvegarder le layout device avant** (`GET /layout` → fichier ; cf. mémoire `uploadfs-efface-assets-device` pour les assets). Le device tourne le build pré-refactor `2d87df4` (HANDOFF) → reflasher est requis de toute façon.

Run: `pio run -e esp32s3 -t upload` (si le port auto-détecte le casque Bose, relancer — cf. HANDOFF gotcha).

Poser via `POST /layout` un layout de test avec : un `slider` (`bind:"vol"`, min/max, `step`), un `arc` (`bind:"dim"`), un `roller` (`bind:"src"`, options), un `button momentary` (`bind:"bell"`, `value:1`, `momentary:true`), un afficheur `readout`/`bar` bound sur chacune, et des `sinks` observant `vol` (`debounce_ms:300`) et `bell` (`debounce_ms:0`). Lancer un récepteur HTTP local (cf. `scratchpad/sink_receiver.py`, port 8899).

- [ ] **Step 4: Checklist on-device (critères spec §10)**

- [ ] **slider drag** : la valeur bound suit le doigt en live ; **1 seul POST** après relâchement (coalescence debounce) ; `step` respecté (valeurs quantifiées).
- [ ] **arc drag** : idem (rond).
- [ ] **anti-conflit** : pendant un drag slider/arc, un `POST /context vol=...` externe **n'arrache pas** le doigt (garde `PRESSED`) ; au relâchement, la valeur externe se reflète.
- [ ] **roller scroll** : sélection → l'**index** est écrit (bound readout affiche l'index) + POST.
- [ ] **momentary tap** : le récepteur reçoit le POST portant **l'impulsion** (corps = `value`, pas la valeur de repos) ; l'afficheur bound retombe au repos ; **re-tap** re-tire (même valeur).
- [ ] nav (swipe = pages) et afficheurs existants **non régressés**.

- [ ] **Step 5: Restaurer le layout device** (via le layout sauvegardé au Step 3, `POST /layout`).

- [ ] **Step 6: Mettre à jour le HANDOFF** (`docs/_internal/HANDOFF.md`) et la mémoire `effecteurs-plan.md` (B2 livré ; reste : producteurs designer C2 + `uploadfs`).

---

## Self-Review (rempli par l'auteur du plan)

- **Couverture spec** : §3 (enum/struct/parse) → T1 ; §4 (capture) → T2+T3 ; §5.1-5.3 (build/callback/sync + PRESSED) → T6 ; §5.4 (context_apply) → T4 ; step §3.2/5.1 → T5+T6 ; §6 (debounce, sans code) → layout de test T7 ; §7 (parser) → T1 ; §8 (tests) → T1-T7 ; §10 (succès) → T7. **Pas de trou.**
- **Placeholders** : aucun `TBD`/`TODO` ; tout le code est concret. Seul point de vérification d'API : `lv_slider_set_orientation` (LVGL 9.5) — étape de build dédiée + repli documenté (T6 Step 5).
- **Cohérence des types** : `dash_ctx_pulse_num/str`, `arm_sinks(…, bool capture)`, `slider_quantize(int32_t,int32_t,int32_t)`, `has_capture`/`captured_body`, `momentary`/`step`/`roller_options`/`roller_rows` — noms identiques entre déclaration (T1/T2/T5) et usage (T4/T6). `COMP_SLIDER/ARC/ROLLER` cohérents enum↔`COMP_NAMES`↔`APPLY[]`↔`VIEW[]`.
