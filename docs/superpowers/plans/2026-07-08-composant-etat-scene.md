# Composant `state` — scènes animées (brique 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un 3ᵉ kind de visuel `scene` (animation composée de glyphes MDI) au composant `state`, choisi dans un **catalogue figé** de 9 scènes, avec parité de rendu designer↔firmware.

**Architecture:** Un module firmware **pur** `scenes.{h,cpp}` porte une **table de scènes figée** + une **fonction de frame pure** `scene_frame_at(scene, t_ms)` (testable en natif, sans LVGL). Le rendu (`view.cpp`) crée N `lv_label` (un par couche) et applique à chaque tick (~30 fps, modèle `led_ring`) l'état de frame (position via `lv_obj_align`, rotation/échelle via `transform_*`, opacité via `opa`). Le designer miroir la table et la fonction de frame en JS (`scenes.js`, modèle `led-ring-preview.js`) et anime le canvas en direct via `requestAnimationFrame`. La sélection du cas (`state_resolve`) est **inchangée** : le kind du visuel est orthogonal à la sélection.

**Tech Stack:** C++/Arduino, LVGL 9.5 (Tiny TTF pour les glyphes MDI), Unity (tests natifs `env:native`), JS modules ES + `node --test` (designer), JSON Schema.

**Spec:** `docs/superpowers/specs/2026-07-08-composant-etat-scene-design.md`.

**Conventions non négociables (rappels) :**
- Tests firmware natifs : `pio test -e native`. Build device : `pio run -e esp32s3`. Tests designer : `cd designer && node --test` (sans argument).
- Un module testable en natif ne doit **PAS inclure LVGL** et doit être ajouté au `build_src_filter` de `[env:native]` dans `platformio.ini` (modèle `color.cpp`).
- Après CHAQUE tâche : le build device (`pio run -e esp32s3`) ET les tests natifs (`pio test -e native`) restent **verts**. Le designer (`node --test`) reste vert après chaque tâche designer.
- Commits fréquents, message conventionnel FR, terminé par le trailer `Claude-Session: https://claude.ai/code/session_01512UvxMoYcTUA7TLJCq3zy`.

---

## File Structure

**Firmware — créés :**
- `src/scenes.h` — enums `SceneAnim`/`SceneRole`, structs `SceneLayer`/`Scene`/`LayerFrame`, `MAX_SCENE_LAYERS`, déclarations `SCENE_CATALOG`, `scene_count`, `scene_name_index`, `scene_layer_color`, `scene_frame_at`.
- `src/scenes.cpp` — la table `SCENE_CATALOG` (9 scènes) + les fonctions pures. **Aucun include LVGL.**

**Firmware — modifiés :**
- `src/dashboard.h` — `StateCase` : `bool has_src` → `uint8_t kind` (`enum StateKind`) ; nouveaux champs `uint8_t scene`, `int size`. `Component` : `state_shown_is_img` → `state_shown_kind` ; nouveau `int state_shown_scene`.
- `src/dashboard.cpp` — `parse_state_visual` (inférence `scene>src>symbol` + `size`) ; `dash_tick_scene`.
- `src/view.cpp` — `state_make_child`/`build_state`/`sync_state` : branche `STATE_SCENE` (N couches + application de frame).
- `src/main.cpp` — appel gaté (33 ms) de `dash_tick_scene`.
- `platformio.ini` — `+<scenes.cpp>` dans `build_src_filter` de `[env:native]`.
- `test/test_core/test_main.cpp` — nouveaux tests + `RUN_TEST(...)`.

**Designer — créés :**
- `designer/js/scenes.js` — table de scènes JS (miroir de `scenes.cpp`) + `SCENE_NAMES`, `sceneFrameAt`, `sceneLayerColor`.
- `designer/js/scene-picker.js` — `openScenePicker({current,onPick})` (calque de `icon-picker.js`, vignettes animées).
- `designer/tests/scenes.test.js` — tests purs de `sceneFrameAt` (miroir des tests natifs) + parité noms.

**Designer — modifiés :**
- `designer/js/render.js` — `buildState` : branche scene (N couches + RAF auto-nettoyant) ; helper `paintSceneFrame`.
- `designer/js/inspector.js` — `visualEditor` : 3ᵉ mode « scène » (picker + couleur + taille).
- `schema/layout.schema.json` — `state_case` : `scene` (`$ref sceneName`) + `size` ; nouveau `$def sceneName`.
- `designer/js/i18n.js` — clés EN/FR (`inspector.opt.scene`, `field.size`, `scenepicker.*`, `scene.<name>`).
- `designer/tests/schema.test.js` — assertion parité `sceneName` (schéma) ↔ `SCENE_NAMES` (`scenes.js`).

**Catalogue v1 (glyphes validés présents dans le jeu de 469) :**

| Scène | Couches (glyphe · anim · rôle) | Couleur principale |
|---|---|---|
| `sunny` | `weather-sunny` · ROTATE lent · principal | `#F5A623` |
| `rain` | `weather-cloudy` · STATIC · accent gris ; 3× `water` · TRANSLATE_LOOP · principal (phases décalées) | `#3B82F6` |
| `snow` | `weather-cloudy` · STATIC · accent gris ; 3× `snowflake` · TRANSLATE_LOOP · principal | `#93B4D8` |
| `storm` | `weather-cloudy` · STATIC · principal ; `lightning-bolt` · FLASH · accent `#F5C518` | `#8892A0` |
| `wind` | `weather-windy` · DRIFT · principal | `#8892A0` |
| `spinner` | `refresh` · ROTATE rapide · principal | `#6C7BF2` |
| `alert` | `alert` · PULSE · principal | `#EF4444` |
| `bell` | `bell-ring` · SWING · principal | `#F5A623` |
| `pulse` | `broadcast` · PULSE · principal | `#22A06B` |

> Note : le jeu de 469 n'inclut **ni cœur ni glyphe « loading »**. `spinner`=`refresh` (icône qui tourne) et `pulse`=`broadcast` (ondes qui pulsent) sont les substituts. Positions/amplitudes ci-dessous = valeurs de départ, à **affiner au navigateur** (Tâche 10).

---

## Task 1: Module `scenes` firmware — catalogue + fonctions pures

**Files:**
- Create: `src/scenes.h`, `src/scenes.cpp`
- Modify: `platformio.ini` (ligne `build_src_filter` de `[env:native]`)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1: Écrire `src/scenes.h`**

```cpp
#pragma once
#include <stdint.h>

// Vocabulaire d'animation d'une couche. Toutes les valeurs de frame sont calculees par
// scene_frame_at() en fonction du temps ; view.cpp applique le resultat (transform/opa/align).
enum SceneAnim : uint8_t {
    SC_STATIC = 0,        // fixe
    SC_ROTATE,            // rotation continue
    SC_TRANSLATE_LOOP,    // translation verticale cyclique + fondu aux extremites
    SC_DRIFT,             // va-et-vient horizontal (sinus)
    SC_PULSE,             // echelle + opacite (0.5*(1-cos))
    SC_SWING,             // oscillation d'angle (sinus)
    SC_FLASH              // opacite en creneau
};

// Role couleur : PRINCIPAL suit la couleur reglable du cas ; ACCENT = couleur fixe.
enum SceneRole : uint8_t { SC_PRINCIPAL = 0, SC_ACCENT = 1 };

// Une couche = un glyphe MDI positionne + anime. Coordonnees relatives 0..100 (mises a
// l'echelle par `size` au rendu). scale_rel = taille du glyphe / size. Table figee (const).
struct SceneLayer {
    const char* symbol;    // nom MDI (resolu en index via icon_symbol_index au rendu)
    float    cx, cy;       // centre en 0..100 (relatif a la boite size x size)
    float    scale_rel;    // taille de police = round(scale_rel * size)
    uint8_t  role;         // SceneRole
    uint32_t accent;       // couleur si role == SC_ACCENT (0xRRGGBB)
    uint8_t  anim;         // SceneAnim
    uint16_t period;       // periode ms (>0)
    float    amp;          // amplitude (deg pour SWING ; fraction 0..100 pour TRANSLATE_LOOP/DRIFT ; facteur pour PULSE)
    uint16_t phase;        // decalage de phase ms (desynchronise les couches)
};

struct Scene { const char* name; const SceneLayer* layers; int count; };

// Etat anime d'une couche a un instant donne (ce que le rendu applique). rgb/symbol sont
// STATIQUES (resolus au build depuis la table + couleur principale), pas dans la frame.
struct LayerFrame {
    float   cx, cy;        // centre anime en 0..100
    int16_t angle_ddeg;    // rotation en 1/10 degre (0..3600), pour transform_rotation
    float   scale;         // facteur d'echelle (1.0 = nominal), pour transform_scale
    uint8_t opa;           // opacite 0..255
};

#define MAX_SCENE_LAYERS 6

extern const Scene SCENE_CATALOG[];
int scene_count();
int scene_name_index(const char* name);                 // -1 si inconnu
uint32_t scene_layer_color(const SceneLayer* l, uint32_t principal);   // principal si role==PRINCIPAL, sinon accent
// Remplit out[0..count) pour la scene `scene_id` a l'instant `t_ms`. Retourne le nb de couches
// (== SCENE_CATALOG[scene_id].count). scene_id invalide -> 0. Pure, sans LVGL. Miroir scenes.js.
int scene_frame_at(int scene_id, uint32_t t_ms, LayerFrame* out);
```

- [ ] **Step 2: Écrire `src/scenes.cpp` (table + fonctions pures)**

```cpp
#include "scenes.h"
#include <math.h>
#include <string.h>

static const float TAU = 6.2831853f;

// ---- Table figee des couches, une par scene ----
static const SceneLayer L_SUNNY[] = {
    { "weather-sunny", 50, 50, 0.90f, SC_PRINCIPAL, 0, SC_ROTATE, 7000, 0, 0 },
};
static const SceneLayer L_RAIN[] = {
    { "weather-cloudy", 50, 38, 0.72f, SC_ACCENT, 0x8892A0, SC_STATIC, 1000, 0, 0 },
    { "water", 34, 66, 0.30f, SC_PRINCIPAL, 0, SC_TRANSLATE_LOOP, 1100, 22, 0 },
    { "water", 50, 66, 0.30f, SC_PRINCIPAL, 0, SC_TRANSLATE_LOOP, 1100, 22, 360 },
    { "water", 66, 66, 0.30f, SC_PRINCIPAL, 0, SC_TRANSLATE_LOOP, 1100, 22, 720 },
};
static const SceneLayer L_SNOW[] = {
    { "weather-cloudy", 50, 38, 0.72f, SC_ACCENT, 0x8892A0, SC_STATIC, 1000, 0, 0 },
    { "snowflake", 34, 66, 0.26f, SC_PRINCIPAL, 0, SC_TRANSLATE_LOOP, 2200, 20, 0 },
    { "snowflake", 50, 66, 0.26f, SC_PRINCIPAL, 0, SC_TRANSLATE_LOOP, 2200, 20, 740 },
    { "snowflake", 66, 66, 0.26f, SC_PRINCIPAL, 0, SC_TRANSLATE_LOOP, 2200, 20, 1480 },
};
static const SceneLayer L_STORM[] = {
    { "weather-cloudy", 50, 38, 0.74f, SC_PRINCIPAL, 0, SC_STATIC, 1000, 0, 0 },
    { "lightning-bolt", 52, 70, 0.42f, SC_ACCENT, 0xF5C518, SC_FLASH, 1800, 0, 0 },
};
static const SceneLayer L_WIND[] = {
    { "weather-windy", 50, 50, 0.82f, SC_PRINCIPAL, 0, SC_DRIFT, 3800, 7, 0 },
};
static const SceneLayer L_SPINNER[] = {
    { "refresh", 50, 50, 0.80f, SC_PRINCIPAL, 0, SC_ROTATE, 1100, 0, 0 },
};
static const SceneLayer L_ALERT[] = {
    { "alert", 50, 50, 0.86f, SC_PRINCIPAL, 0, SC_PULSE, 1400, 0.18f, 0 },
};
static const SceneLayer L_BELL[] = {
    { "bell-ring", 50, 46, 0.84f, SC_PRINCIPAL, 0, SC_SWING, 900, 16, 0 },
};
static const SceneLayer L_PULSE[] = {
    { "broadcast", 50, 50, 0.86f, SC_PRINCIPAL, 0, SC_PULSE, 1100, 0.16f, 0 },
};

#define SCN(n, arr) { n, arr, (int)(sizeof(arr)/sizeof((arr)[0])) }
const Scene SCENE_CATALOG[] = {
    SCN("sunny",   L_SUNNY),   SCN("rain",  L_RAIN),  SCN("snow",    L_SNOW),
    SCN("storm",   L_STORM),   SCN("wind",  L_WIND),  SCN("spinner", L_SPINNER),
    SCN("alert",   L_ALERT),   SCN("bell",  L_BELL),  SCN("pulse",   L_PULSE),
};
#undef SCN

int scene_count() { return (int)(sizeof(SCENE_CATALOG) / sizeof(SCENE_CATALOG[0])); }

int scene_name_index(const char* name) {
    if (!name) return -1;
    for (int i = 0; i < scene_count(); i++)
        if (strcmp(SCENE_CATALOG[i].name, name) == 0) return i;
    return -1;
}

uint32_t scene_layer_color(const SceneLayer* l, uint32_t principal) {
    return l->role == SC_ACCENT ? l->accent : principal;
}

int scene_frame_at(int scene_id, uint32_t t_ms, LayerFrame* out) {
    if (scene_id < 0 || scene_id >= scene_count()) return 0;
    const Scene& s = SCENE_CATALOG[scene_id];
    int n = s.count > MAX_SCENE_LAYERS ? MAX_SCENE_LAYERS : s.count;
    for (int i = 0; i < n; i++) {
        const SceneLayer& L = s.layers[i];
        LayerFrame f; f.cx = L.cx; f.cy = L.cy; f.angle_ddeg = 0; f.scale = 1.0f; f.opa = 255;
        uint16_t per = L.period ? L.period : 1000;
        float ph = (float)((t_ms + L.phase) % per) / (float)per;   // 0..1
        switch (L.anim) {
            case SC_ROTATE:
                f.angle_ddeg = (int16_t)(ph * 3600.0f);
                break;
            case SC_TRANSLATE_LOOP:
                f.cy = L.cy - L.amp + 2.0f * L.amp * ph;            // descend de cy-amp a cy+amp
                f.opa = (uint8_t)(255.0f * (ph < 0.15f ? ph / 0.15f
                                          : ph > 0.85f ? (1.0f - ph) / 0.15f : 1.0f));
                break;
            case SC_DRIFT:
                f.cx = L.cx + L.amp * sinf(TAU * ph);
                break;
            case SC_PULSE: {
                float k = 0.5f * (1.0f - cosf(TAU * ph));           // 0..1
                f.scale = 1.0f + L.amp * k;
                f.opa = (uint8_t)(255.0f * (0.6f + 0.4f * k));
                break;
            }
            case SC_SWING:
                f.angle_ddeg = (int16_t)(L.amp * 10.0f * sinf(TAU * ph));
                break;
            case SC_FLASH:
                f.opa = (ph < 0.10f || (ph > 0.16f && ph < 0.24f)) ? 255 : 45;   // double eclair
                break;
            case SC_STATIC:
            default: break;
        }
        out[i] = f;
    }
    return n;
}
```

- [ ] **Step 3: Ajouter `scenes.cpp` au build natif**

Dans `platformio.ini`, `[env:native]`, ligne `build_src_filter`, ajouter `+<scenes.cpp>` (par ex. juste après `+<color.cpp>`) :

```ini
build_src_filter = -<*> +<dashboard.cpp> +<format.cpp> +<color.cpp> +<scenes.cpp> +<nav_logic.cpp> +<context.cpp> +<asset_path.cpp> +<sink.cpp> +<wifi_list.cpp> +<clock_geom.cpp> +<ring_geom.cpp> +<stepper_logic.cpp> +<segmented_logic.cpp> +<fonts/icons_gen.c>
```

- [ ] **Step 4: Écrire les tests natifs (dans `test/test_core/test_main.cpp`)**

Ajouter `#include "scenes.h"` en tête (après `#include "color.h"`). Ajouter ces fonctions de test (près de `test_state_resolve`) :

```cpp
void test_scene_catalog_sane(void) {
    TEST_ASSERT_EQUAL_INT(9, scene_count());
    // noms uniques + resolubles ; chaque scene a 1..MAX couches ; chaque glyphe existe dans le jeu MDI.
    for (int i = 0; i < scene_count(); i++) {
        const Scene& s = SCENE_CATALOG[i];
        TEST_ASSERT_EQUAL_INT_MESSAGE(i, scene_name_index(s.name), s.name);
        TEST_ASSERT_TRUE(s.count >= 1 && s.count <= MAX_SCENE_LAYERS);
        for (int j = 0; j < s.count; j++) {
            // le glyphe doit exister. icon_symbol_index renvoie 0 (pas -1) sur miss -> comparer le NOM
            // résolu (round-trip) : le test échoue si un nom du catalogue est absent/fauté (Rule 9).
            int gi = icon_symbol_index(s.layers[j].symbol);
            TEST_ASSERT_EQUAL_STRING_MESSAGE(s.layers[j].symbol, ICON_SYMBOL_NAMES[gi], s.layers[j].symbol);
        }
    }
    TEST_ASSERT_EQUAL_INT(-1, scene_name_index("nope"));
    TEST_ASSERT_EQUAL_INT(-1, scene_name_index(nullptr));
}

void test_scene_frame_at(void) {
    LayerFrame f[MAX_SCENE_LAYERS];
    // scene invalide -> 0 couche
    TEST_ASSERT_EQUAL_INT(0, scene_frame_at(-1, 0, f));
    TEST_ASSERT_EQUAL_INT(0, scene_frame_at(999, 0, f));

    int sunny = scene_name_index("sunny");
    // ROTATE : angle 0 a t=0, ~180deg a demi-periode (7000ms -> 3500), periodicite.
    int n = scene_frame_at(sunny, 0, f);
    TEST_ASSERT_EQUAL_INT(1, n);
    TEST_ASSERT_EQUAL_INT(0, f[0].angle_ddeg);
    scene_frame_at(sunny, 3500, f);
    TEST_ASSERT_TRUE(f[0].angle_ddeg > 1700 && f[0].angle_ddeg < 1900);   // ~1800 (180deg)
    LayerFrame a[MAX_SCENE_LAYERS], b[MAX_SCENE_LAYERS];
    scene_frame_at(sunny, 1234, a); scene_frame_at(sunny, 1234 + 7000, b);
    TEST_ASSERT_EQUAL_INT(a[0].angle_ddeg, b[0].angle_ddeg);              // periodique

    // TRANSLATE_LOOP (rain, couches 1..3) : cy varie, opa bornee, phases decalees.
    int rain = scene_name_index("rain");
    n = scene_frame_at(rain, 550, f);
    TEST_ASSERT_EQUAL_INT(4, n);
    TEST_ASSERT_EQUAL_FLOAT(38.0f, f[0].cy);                             // couche 0 STATIC (nuage) fixe
    TEST_ASSERT_TRUE(f[1].opa <= 255);                                   // borne haute (type uint8 garantit >=0)
    TEST_ASSERT_TRUE(f[1].cy != f[2].cy);                               // phases differentes -> positions differentes

    // PULSE (alert) : scale >= 1, opa dans [0,255].
    int alert = scene_name_index("alert");
    scene_frame_at(alert, 700, f);
    TEST_ASSERT_TRUE(f[0].scale >= 1.0f && f[0].scale <= 1.5f);

    // STATIC (storm couche 0) : neutre.
    int storm = scene_name_index("storm");
    scene_frame_at(storm, 999, f);
    TEST_ASSERT_EQUAL_INT(0, f[0].angle_ddeg);
    TEST_ASSERT_EQUAL_FLOAT(1.0f, f[0].scale);
    TEST_ASSERT_EQUAL_INT(255, f[0].opa);
}

void test_scene_layer_color(void) {
    int storm = scene_name_index("storm");
    const Scene& s = SCENE_CATALOG[storm];
    TEST_ASSERT_EQUAL_HEX32(0x3399FF, scene_layer_color(&s.layers[0], 0x3399FF));   // principal -> suit
    TEST_ASSERT_EQUAL_HEX32(0xF5C518, scene_layer_color(&s.layers[1], 0x3399FF));   // accent -> fixe
}
```

Enregistrer les tests dans `main()` (près de `RUN_TEST(test_state_resolve);`) :

```cpp
    RUN_TEST(test_scene_catalog_sane);
    RUN_TEST(test_scene_frame_at);
    RUN_TEST(test_scene_layer_color);
```

> Prérequis : `icon_symbol_index(const char*)` est déjà déclaré (utilisé par `parse_state_visual`, cf. `dashboard.cpp`). Vérifier qu'il est visible dans le test (via `dashboard.h`/`fonts/icons_gen.h`) ; sinon inclure le header qui le déclare.

- [ ] **Step 5: Lancer les tests — vérifier qu'ils passent (nouvelles fonctions compilées et correctes)**

Run: `pio test -e native`
Expected: tous les tests PASS, dont `test_scene_catalog_sane`, `test_scene_frame_at`, `test_scene_layer_color`. (Si un glyphe du catalogue est absent → `test_scene_catalog_sane` échoue avec le nom fautif → le corriger dans `scenes.cpp`.)

- [ ] **Step 6: Vérifier que le build device compile toujours**

Run: `pio run -e esp32s3`
Expected: SUCCESS (scenes.cpp compile aussi pour l'ESP32 ; pas encore référencé par le rendu).

- [ ] **Step 7: Commit**

```bash
git add src/scenes.h src/scenes.cpp platformio.ini test/test_core/test_main.cpp
git commit -m "feat(state/scene): module scenes — catalogue figé + frame_at pure (tests natifs)

Claude-Session: https://claude.ai/code/session_01512UvxMoYcTUA7TLJCq3zy"
```

---

## Task 2: Refactor discriminant `StateCase.has_src` → `enum StateKind`

Refactor pur (2 kinds), pour préparer l'ajout de `SCENE`. Aucun nouveau comportement.

**Files:**
- Modify: `src/dashboard.h` (`enum StateKind`, `StateCase.kind`, `Component.state_shown_kind`)
- Modify: `src/dashboard.cpp` (`parse_state_visual`)
- Modify: `src/view.cpp` (`state_make_child`, `sync_state`)
- Modify: `test/test_core/test_main.cpp` (assertions `has_src` → `kind`)

- [ ] **Step 1: `dashboard.h` — ajouter l'enum et remplacer le champ**

Après `enum StateMatch { ... };`, ajouter :

```cpp
enum StateKind : uint8_t { STATE_GLYPH = 0, STATE_IMAGE = 1, STATE_SCENE = 2 };
```

Dans `struct StateCase`, remplacer `bool has_src;` par :

```cpp
    uint8_t  kind;         // StateKind : glyphe | image | scene (infere par le champ present)
```

Dans `struct Component`, remplacer `bool state_shown_is_img;` par :

```cpp
    uint8_t   state_shown_kind;                  // StateKind du visuel rendu (detecte un changement au sync)
```

- [ ] **Step 2: `dashboard.cpp` — `parse_state_visual` écrit `kind` au lieu de `has_src`**

Remplacer le corps de `parse_state_visual` par (inférence identique, `has_src`→`kind`) :

```cpp
static void parse_state_visual(JsonVariantConst o, StateCase& sc) {
    const char* src = o["src"] | "";
    if (bg_key_valid(src)) {
        sc.kind = STATE_IMAGE;
        strlcpy(sc.src, src, sizeof(sc.src)); sc.w = o["w"] | 0; sc.h = o["h"] | 0;
        sc.symbol = 0; sc.color = 0xFFFFFF;
    } else {
        sc.kind = STATE_GLYPH;
        sc.src[0] = '\0'; sc.w = sc.h = 0;
        sc.symbol = icon_symbol_index(o["symbol"] | "bell");
        sc.color = o["color"].is<const char*>() ? parse_hex_color(o["color"], 0xFFFFFF) : 0xFFFFFF;
    }
}
```

- [ ] **Step 3: `view.cpp` — `state_make_child` et `sync_state` testent `kind`**

Dans `state_make_child`, remplacer `if (v.has_src) {` par `if (v.kind == STATE_IMAGE) {` et, en fin de fonction, `c.state_shown_is_img = v.has_src;` par `c.state_shown_kind = v.kind;`.

Dans `sync_state`, remplacer la condition de recréation et la branche image :

```cpp
    lv_obj_t* child = lv_obj_get_child(main, 0);
    if (!child || v.kind != c.state_shown_kind) {            // kind change (ou 1er) -> clean + recree
        lv_obj_clean(main); state_make_child(main, c, q.comp_index, v);
    } else if (v.kind == STATE_IMAGE) {                      // image : recree SI src change
        if (strcmp(c.state_shown_src, v.src) != 0) { lv_obj_clean(main); state_make_child(main, c, q.comp_index, v); }
    } else {                                                 // glyphe : maj en place
        lv_obj_set_style_text_color(child, lv_color_hex(v.color), 0);
        lv_label_set_text(child, ICON_GLYPHS[v.symbol]);
    }
```

- [ ] **Step 4: `test_main.cpp` — adapter `test_state_parsed`**

Remplacer les assertions `has_src` par `kind` :
- `TEST_ASSERT_FALSE(a.state_default.has_src);` → `TEST_ASSERT_EQUAL_INT(STATE_GLYPH, a.state_default.kind);`
- `TEST_ASSERT_FALSE(ac[0].has_src);` → `TEST_ASSERT_EQUAL_INT(STATE_GLYPH, ac[0].kind);`
- `TEST_ASSERT_TRUE(ac[2].has_src);` → `TEST_ASSERT_EQUAL_INT(STATE_IMAGE, ac[2].kind);`

- [ ] **Step 5: Tests natifs + build device**

Run: `pio test -e native` → Expected: PASS (dont `test_state_parsed`).
Run: `pio run -e esp32s3` → Expected: SUCCESS.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/view.cpp test/test_core/test_main.cpp
git commit -m "refactor(state): discriminant has_src -> enum StateKind (prépare scene)

Claude-Session: https://claude.ai/code/session_01512UvxMoYcTUA7TLJCq3zy"
```

---

## Task 3: `StateCase` gagne le kind `SCENE` + champs `scene`/`size` + parsing

**Files:**
- Modify: `src/dashboard.h` (`StateCase` : `uint8_t scene`, `int size`)
- Modify: `src/dashboard.cpp` (`parse_state_visual` : inférence `scene>src>symbol` + `size`) ; include `scenes.h`
- Modify: `src/view.cpp` (`state_make_child` : cas `STATE_SCENE` minimal, build vert) ; include `scenes.h`
- Modify: `test/test_core/test_main.cpp`

- [ ] **Step 1: `dashboard.h` — champs scène dans `StateCase`**

Dans `struct StateCase`, après les champs image (`int w, h;`), ajouter :

```cpp
    uint8_t  scene;        // scene : index dans SCENE_CATALOG (valide si kind == STATE_SCENE)
    int      size;         // scene : cote de la boite carree en px (defaut 120)
```

- [ ] **Step 2: `dashboard.cpp` — inférence `scene > src > symbol`**

Ajouter `#include "scenes.h"` en tête. Remplacer `parse_state_visual` par la version à 3 branches :

```cpp
static void parse_state_visual(JsonVariantConst o, StateCase& sc) {
    const char* scn = o["scene"] | "";
    int si = scn[0] ? scene_name_index(scn) : -1;
    if (si >= 0) {                                   // visuel scene (prioritaire)
        sc.kind = STATE_SCENE;
        sc.scene = (uint8_t)si;
        sc.size = o["size"].is<int>() ? (int)(o["size"] | 120) : 120;
        sc.src[0] = '\0'; sc.w = sc.h = 0; sc.symbol = 0; sc.color = 0xFFFFFF;
        if (o["color"].is<const char*>()) sc.color = parse_hex_color(o["color"], 0xFFFFFF);
        return;
    }
    const char* src = o["src"] | "";
    if (bg_key_valid(src)) {
        sc.kind = STATE_IMAGE;
        strlcpy(sc.src, src, sizeof(sc.src)); sc.w = o["w"] | 0; sc.h = o["h"] | 0;
        sc.symbol = 0; sc.color = 0xFFFFFF;
    } else {
        sc.kind = STATE_GLYPH;
        sc.src[0] = '\0'; sc.w = sc.h = 0;
        sc.symbol = icon_symbol_index(o["symbol"] | "bell");
        sc.color = o["color"].is<const char*>() ? parse_hex_color(o["color"], 0xFFFFFF) : 0xFFFFFF;
    }
}
```

> Note : pour un cas `scene`, `color` **absente** reste `0xFFFFFF` (blanc). Chaque scène a une couleur principale « idéale » — le **designer** injectera cette couleur par défaut à la création du cas (Task 9), donc le firmware n'a pas besoin de la connaître. Le blanc est un repli sûr si `color` manque.

- [ ] **Step 3: `view.cpp` — `state_make_child` : cas `STATE_SCENE` (rendu minimal statique)**

Ajouter `#include "scenes.h"` en tête. Dans `state_make_child`, transformer le `if/else` (image/glyphe) en gérant les 3 kinds. Rendu scène **minimal** ici (1 glyphe = 1ʳᵉ couche, statique) — juste pour garder le build vert ; le vrai rendu multi-couches animé arrive en Task 4 :

```cpp
static void state_make_child(lv_obj_t* cont, Component& c, int idx, const StateCase& v) {
    if (v.kind == STATE_SCENE) {
        // Rendu minimal (Task 3) : 1re couche statique. Remplace par le rendu N couches en Task 4.
        const Scene& s = SCENE_CATALOG[v.scene];
        int px = (int)(s.layers[0].scale_rel * (v.size ? v.size : 120));
        lv_obj_t* l = lv_label_create(cont);
        lv_obj_set_style_text_font(l, get_icon_font(px), 0);
        lv_obj_set_style_text_color(l, lv_color_hex(scene_layer_color(&s.layers[0], v.color)), 0);
        lv_label_set_text(l, ICON_GLYPHS[icon_symbol_index(s.layers[0].symbol)]);
        lv_obj_center(l);
        c.state_shown_scene = v.scene;
        c.state_shown_src[0] = '\0';
    } else if (v.kind == STATE_IMAGE) {
        lv_obj_set_size(cont, LV_SIZE_CONTENT, LV_SIZE_CONTENT);   // réinitialise la boîte si swap depuis une scène
        lv_obj_t* img = lv_image_create(cont);
        if (state_load_image(idx, v.src, v.w, v.h)) {
            lv_image_set_src(img, &s_img_dsc[idx]);
            strlcpy(c.state_shown_src, v.src, sizeof(c.state_shown_src));
        } else { c.state_shown_src[0] = '\0'; }
        lv_obj_center(img);
    } else {
        lv_obj_set_size(cont, LV_SIZE_CONTENT, LV_SIZE_CONTENT);   // réinitialise la boîte si swap depuis une scène
        if (s_img_buf[idx]) { heap_caps_free(s_img_buf[idx]); s_img_buf[idx] = nullptr; }
        lv_obj_t* l = lv_label_create(cont);
        lv_obj_set_style_text_font(l, get_icon_font(c.font), 0);
        lv_obj_set_style_text_color(l, lv_color_hex(v.color), 0);
        lv_label_set_text(l, ICON_GLYPHS[v.symbol]);
        lv_obj_center(l);
        c.state_shown_src[0] = '\0';
    }
    c.state_shown_kind = v.kind;
}
```

> Ajouter le champ `int state_shown_scene;` dans `struct Component` (`dashboard.h`), à côté de `state_shown_kind` (utilisé dès ici, exploité au sync en Task 4).

- [ ] **Step 4: `test_main.cpp` — parsing d'un cas scène**

Étendre `LAYOUT_STATE` : ajouter un 4ᵉ cas scène à `s1` (`{"key":"Storm","scene":"storm","color":"#8892A0","size":140}`). Puis, dans `test_state_parsed`, après les assertions du cas image (`ac[2]`), ajouter :

```cpp
    TEST_ASSERT_EQUAL_INT(4, a.state_case_count);
    TEST_ASSERT_EQUAL_INT(STATE_SCENE, ac[3].kind);
    TEST_ASSERT_EQUAL_INT(scene_name_index("storm"), ac[3].scene);
    TEST_ASSERT_EQUAL_INT(140, ac[3].size);
    TEST_ASSERT_EQUAL_HEX32(0x8892A0, ac[3].color);
```

> Adapter aussi `TEST_ASSERT_EQUAL_INT(3, a.state_case_count);` → `4`, et l'offset de `s2` (`b.state_cases_off`) : `3` → `4` (les 4 cas de `s1` occupent maintenant `state_pool[0..4]`).

- [ ] **Step 5: Tests natifs + build device**

Run: `pio test -e native` → Expected: PASS (dont `test_state_parsed` étendu).
Run: `pio run -e esp32s3` → Expected: SUCCESS.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/view.cpp test/test_core/test_main.cpp
git commit -m "feat(state/scene): kind SCENE + champs scene/size + parsing (rendu minimal)

Claude-Session: https://claude.ai/code/session_01512UvxMoYcTUA7TLJCq3zy"
```

---

## Task 4: Rendu multi-couches animé (`view.cpp`)

Vrai rendu : N couches + application de la frame. Non testable en natif (LVGL) → vérifié on-device/navigateur plus tard ; ici on garantit **build vert** et cohérence.

**Files:**
- Modify: `src/view.cpp` (`state_make_child` scène = N couches ; `apply_scene_frame` ; `sync_state` branche scène)

- [ ] **Step 1: `view.cpp` — helper `apply_scene_frame` (au-dessus de `state_make_child`)**

```cpp
// Applique l'etat anime d'une scene a l'instant now_ms aux N enfants (labels) deja crees.
// Chaque enfant i <-> couche i. Position via align (cx,cy en 0..100 -> offset du centre),
// rotation/echelle via transform_* (layer rendue LVGL 9), opacite via opa.
static void apply_scene_frame(lv_obj_t* cont, const StateCase& v, uint32_t now_ms) {
    LayerFrame fr[MAX_SCENE_LAYERS];
    int n = scene_frame_at(v.scene, now_ms, fr);
    int size = v.size ? v.size : 120;
    for (int i = 0; i < n; i++) {
        lv_obj_t* l = lv_obj_get_child(cont, i);
        if (!l) break;
        lv_obj_align(l, LV_ALIGN_CENTER, (int)((fr[i].cx - 50.0f) / 100.0f * size),
                                         (int)((fr[i].cy - 50.0f) / 100.0f * size));
        lv_obj_set_style_transform_rotation(l, fr[i].angle_ddeg, 0);
        lv_obj_set_style_transform_scale(l, (int)(fr[i].scale * 256.0f), 0);
        lv_obj_set_style_opa(l, fr[i].opa, 0);
    }
}
```

- [ ] **Step 2: `view.cpp` — `state_make_child` : scène = N couches**

Remplacer la branche `if (v.kind == STATE_SCENE)` (rendu minimal de Task 3) par la création des N couches (police + couleur + pivot statiques ; état initial via `apply_scene_frame` à t=0) :

```cpp
    if (v.kind == STATE_SCENE) {
        const Scene& s = SCENE_CATALOG[v.scene];
        int size = v.size ? v.size : 120;
        lv_obj_set_size(cont, size, size);            // boite carree fixe (couches positionnees en absolu via align)
        int n = s.count > MAX_SCENE_LAYERS ? MAX_SCENE_LAYERS : s.count;
        for (int i = 0; i < n; i++) {
            const SceneLayer& L = s.layers[i];
            int px = (int)(L.scale_rel * size); if (px < 8) px = 8;
            lv_obj_t* l = lv_label_create(cont);
            lv_obj_set_style_text_font(l, get_icon_font(px), 0);
            lv_obj_set_style_text_color(l, lv_color_hex(scene_layer_color(&L, v.color)), 0);
            lv_label_set_text(l, ICON_GLYPHS[icon_symbol_index(L.symbol)]);
            if (L.anim == SC_SWING) {                     // pivot haut-centre pour l'oscillation
                lv_obj_set_style_transform_pivot_x(l, px / 2, 0);
                lv_obj_set_style_transform_pivot_y(l, 0, 0);
            } else {
                lv_obj_set_style_transform_pivot_x(l, px / 2, 0);
                lv_obj_set_style_transform_pivot_y(l, px / 2, 0);
            }
        }
        apply_scene_frame(cont, v, 0);                    // etat initial (t=0)
        c.state_shown_scene = v.scene;
        c.state_shown_src[0] = '\0';
    } else if (v.kind == STATE_IMAGE) {
```

- [ ] **Step 3: `view.cpp` — `sync_state` : branche scène (rebuild si scène change, sinon applique frame)**

Étendre la cascade de `sync_state`. La condition « kind change » recrée déjà ; ajouter : pour un scène **inchangé** (même `scene`), appliquer la frame au temps courant ; si la **scène** change (même kind SCENE mais autre index), recréer :

```cpp
static void sync_state(Component& c, Placement& q, lv_obj_t* main, lv_obj_t*, lv_obj_t*) {
    int n; const StateCase* cases = state_cases_of(c, &n);
    int idx = state_resolve(c.state_match, cases, n, c.state_has_num, (double)c.value, c.vstr);
    const StateCase& v = (idx < 0) ? c.state_default : cases[idx];
    lv_obj_t* child = lv_obj_get_child(main, 0);
    bool scene_changed = (v.kind == STATE_SCENE && c.state_shown_kind == STATE_SCENE && v.scene != c.state_shown_scene);
    if (!child || v.kind != c.state_shown_kind || scene_changed) {   // kind/scene change (ou 1er) -> clean + recree
        lv_obj_clean(main); state_make_child(main, c, q.comp_index, v);
    } else if (v.kind == STATE_SCENE) {                              // meme scene : applique la frame courante
        apply_scene_frame(main, v, (uint32_t)lv_tick_get());
    } else if (v.kind == STATE_IMAGE) {
        if (strcmp(c.state_shown_src, v.src) != 0) { lv_obj_clean(main); state_make_child(main, c, q.comp_index, v); }
    } else {
        lv_obj_set_style_text_color(child, lv_color_hex(v.color), 0);
        lv_label_set_text(child, ICON_GLYPHS[v.symbol]);
    }
}
```

> `lv_tick_get()` fournit l'horloge ms de LVGL (équivalent `millis()`, disponible dans `view.cpp`). C'est le temps passé à `scene_frame_at`, garantissant une animation continue re-synchronisée à chaque tick (Task 5).

- [ ] **Step 4: Build device**

Run: `pio run -e esp32s3`
Expected: SUCCESS. (Vérifier l'absence de warning sur `lv_obj_set_style_transform_scale`/`_rotation`/`_pivot_*` — API LVGL 9.5 confirmée.)

- [ ] **Step 5: Tests natifs (non régressés)**

Run: `pio test -e native` → Expected: PASS (view.cpp non compilé en natif ; ce commit ne touche pas la logique pure).

- [ ] **Step 6: Commit**

```bash
git add src/view.cpp
git commit -m "feat(state/scene): rendu multi-couches + apply_scene_frame (transform/opa)

Claude-Session: https://claude.ai/code/session_01512UvxMoYcTUA7TLJCq3zy"
```

---

### ⚠ Amendement post-revue T4 — invalidation par index de cas (bug `color`/`size`)

La revue de la Tâche 4 a identifié que `sync_state` ne reconstruit la scène que sur changement d'**index de scène** (`v.scene != c.state_shown_scene`), ignorant `color` **et** `size` par cas. Or `color` par cas est un usage central (ex. scène `alert` rouge en critique / ambre en warning, **même** `scene` à chaque cas) : la couleur resterait figée. Correction adoptée (index de cas rendu, plus simple que dupliquer `state_shown_color`/`state_shown_size`) :

- **`src/dashboard.h`** (`Component`) : remplacer `int state_shown_scene;` par `int state_shown_case_idx;` (index du cas rendu ; `-1` = défaut).
- **`src/view.cpp`** :
  - `state_make_child`, branche SCENE : **retirer** `c.state_shown_scene = v.scene;` (l'index de cas est posé par l'appelant).
  - `build_state` : après `state_make_child(...)`, poser `c.state_shown_case_idx = idx;` (l'`idx` résolu au build).
  - `sync_state` : la condition scène devient `v.kind == STATE_SCENE && c.state_shown_kind == STATE_SCENE && idx != c.state_shown_case_idx` → rebuild ; **en fin de fonction**, `c.state_shown_case_idx = idx;`. Ainsi tout changement de **cas rendu** (scene/color/size) recrée le visuel. Les branches **glyphe** (maj couleur+texte en place) et **image** (rebuild si `src` change) restent **inchangées**.
- Nettoyages Minor associés (même commit) : retirer `if (px < 8) px = 8;` (redondant — `get_icon_font` clampe déjà `[8,120]`) et le cast no-op `(uint32_t)lv_tick_get()`.

Gate : `pio run -e esp32s3` SUCCESS + `pio test -e native` 196/196 (view.cpp/dashboard.h non testés en natif ; pas de régression attendue). Vérif visuelle du changement de couleur par cas : Tâche 10 (navigateur) / Tâche 11 (device).

## Task 5: Tick d'animation `dash_tick_scene` + boucle principale

**Files:**
- Modify: `src/dashboard.h` (déclaration `dash_tick_scene`)
- Modify: `src/dashboard.cpp` (`dash_tick_scene`)
- Modify: `src/main.cpp` (appel gaté 33 ms)

- [ ] **Step 1: `dashboard.h` — déclaration**

Près des autres ticks (`void dash_tick_aimg(Dashboard*, uint32_t);`), ajouter :

```cpp
void dash_tick_scene(Dashboard* d, uint32_t now_ms);
```

- [ ] **Step 2: `dashboard.cpp` — marque `dirty` les `state` dont le visuel actif est une scène**

Ajouter (près de `dash_tick_aimg`) :

```cpp
// Anime les composants state dont le visuel ACTIF (cas resolu) est une scene : marque dirty a chaque
// appel (gate ~30 fps dans main). sync_state re-applique la frame au temps courant. Modele led_ring/aimg.
void dash_tick_scene(Dashboard* d, uint32_t now_ms) {
    (void)now_ms;
    for (int i = 0; i < d->comp_count; i++) {
        Component& c = d->components[i];
        if (c.type != COMP_STATE) continue;
        int n; const StateCase* cases;
        if (c.state_cases_off >= 0 && c.state_case_count > 0 &&
            c.state_cases_off + c.state_case_count <= d->state_pool_used) {
            cases = &d->state_pool[c.state_cases_off]; n = c.state_case_count;
        } else { cases = nullptr; n = 0; }
        int idx = state_resolve(c.state_match, cases, n, c.state_has_num, (double)c.value, c.vstr);
        const StateCase& v = (idx < 0) ? c.state_default : (cases ? cases[idx] : c.state_default);
        if (v.kind == STATE_SCENE) { c.dirty = true; d->values_dirty = true; }
    }
}
```

> `state_resolve` est déjà déclaré via `color.h` (inclus par `dashboard.cpp`). La lecture de la tranche du pool réplique la garde de bornes de `state_cases_of` (view.cpp) mais sans LVGL.

- [ ] **Step 3: `main.cpp` — appel gaté à 33 ms (à côté de `led_ring_tick`)**

Dans `loop()`, juste après le bloc `dash_tick_aimg(...)` (l.105) et **avant** `if (g_dash.values_dirty) view_sync(...)`, ajouter un gate propre à la scène (les scènes doivent rafraîchir même si aucune valeur ne change) :

```cpp
    static uint32_t last_scene = 0;
    if (now_ms - last_scene >= 33) { last_scene = now_ms; dash_tick_scene(&g_dash, now_ms); }   // ~30 fps
```

> Placé avant `view_sync` (l.106) pour que le `dirty` posé soit consommé dans la même itération.

- [ ] **Step 4: Build device + tests natifs**

Run: `pio run -e esp32s3` → Expected: SUCCESS.
Run: `pio test -e native` → Expected: PASS (`dash_tick_scene` compile aussi en natif ; pas de test dédié requis — logique triviale d'itération, la logique animée est couverte par `test_scene_frame_at`).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/main.cpp
git commit -m "feat(state/scene): dash_tick_scene ~30fps (marque dirty les state en scène)

Claude-Session: https://claude.ai/code/session_01512UvxMoYcTUA7TLJCq3zy"
```

---

## Task 6: Designer `scenes.js` — table miroir + `sceneFrameAt` pur + tests

**Files:**
- Create: `designer/js/scenes.js`
- Create: `designer/tests/scenes.test.js`

- [ ] **Step 1: Écrire `designer/js/scenes.js` (miroir EXACT de `src/scenes.cpp`)**

```js
// Catalogue de scènes animées — MIROIR de src/scenes.cpp (parité designer↔firmware).
// Toute modification ici doit être répliquée là-bas (et inversement) ; les tests (scenes.test.js
// + tests natifs) et l'enum schéma `sceneName` verrouillent la parité des NOMS et des points de contrôle.
// Anims : static | rotate | translate_loop | drift | pulse | swing | flash. Rôle : principal | accent.

const TAU = 2 * Math.PI;

// L(symbol, cx, cy, scaleRel, role, accent, anim, period, amp, phase)
const L = (symbol, cx, cy, scaleRel, role, accent, anim, period, amp, phase = 0) =>
  ({ symbol, cx, cy, scaleRel, role, accent, anim, period, amp, phase });

export const SCENES = {
  sunny:   { color: '#F5A623', layers: [ L('weather-sunny', 50, 50, 0.90, 'principal', 0, 'rotate', 7000, 0) ] },
  rain:    { color: '#3B82F6', layers: [
    L('weather-cloudy', 50, 38, 0.72, 'accent', '#8892A0', 'static', 1000, 0),
    L('water', 34, 66, 0.30, 'principal', 0, 'translate_loop', 1100, 22, 0),
    L('water', 50, 66, 0.30, 'principal', 0, 'translate_loop', 1100, 22, 360),
    L('water', 66, 66, 0.30, 'principal', 0, 'translate_loop', 1100, 22, 720) ] },
  snow:    { color: '#93B4D8', layers: [
    L('weather-cloudy', 50, 38, 0.72, 'accent', '#8892A0', 'static', 1000, 0),
    L('snowflake', 34, 66, 0.26, 'principal', 0, 'translate_loop', 2200, 20, 0),
    L('snowflake', 50, 66, 0.26, 'principal', 0, 'translate_loop', 2200, 20, 740),
    L('snowflake', 66, 66, 0.26, 'principal', 0, 'translate_loop', 2200, 20, 1480) ] },
  storm:   { color: '#8892A0', layers: [
    L('weather-cloudy', 50, 38, 0.74, 'principal', 0, 'static', 1000, 0),
    L('lightning-bolt', 52, 70, 0.42, 'accent', '#F5C518', 'flash', 1800, 0) ] },
  wind:    { color: '#8892A0', layers: [ L('weather-windy', 50, 50, 0.82, 'principal', 0, 'drift', 3800, 7) ] },
  spinner: { color: '#6C7BF2', layers: [ L('refresh', 50, 50, 0.80, 'principal', 0, 'rotate', 1100, 0) ] },
  alert:   { color: '#EF4444', layers: [ L('alert', 50, 50, 0.86, 'principal', 0, 'pulse', 1400, 0.18) ] },
  bell:    { color: '#F5A623', layers: [ L('bell-ring', 50, 46, 0.84, 'principal', 0, 'swing', 900, 16) ] },
  pulse:   { color: '#22A06B', layers: [ L('broadcast', 50, 50, 0.86, 'principal', 0, 'pulse', 1100, 0.16) ] },
};

// Ordre canonique (== ordre de SCENE_CATALOG côté firmware ; verrouille la parité des index).
export const SCENE_NAMES = ['sunny', 'rain', 'snow', 'storm', 'wind', 'spinner', 'alert', 'bell', 'pulse'];

export function sceneDefaultColor(name) { return SCENES[name]?.color || '#FFFFFF'; }
export function sceneLayerColor(layer, principal) { return layer.role === 'accent' ? layer.accent : principal; }

// Frame PURE (miroir scene_frame_at) : rend un tableau de { cx, cy, angleDdeg, scale, opa } par couche.
// name inconnu -> []. Pure, sans DOM.
export function sceneFrameAt(name, tMs) {
  const s = SCENES[name];
  if (!s) return [];
  return s.layers.map(L => {
    const f = { cx: L.cx, cy: L.cy, angleDdeg: 0, scale: 1, opa: 255 };
    const per = L.period || 1000;
    const ph = ((tMs + L.phase) % per) / per;                 // 0..1
    switch (L.anim) {
      case 'rotate': f.angleDdeg = Math.trunc(ph * 3600); break;
      case 'translate_loop':
        f.cy = L.cy - L.amp + 2 * L.amp * ph;
        f.opa = Math.trunc(255 * (ph < 0.15 ? ph / 0.15 : ph > 0.85 ? (1 - ph) / 0.15 : 1));
        break;
      case 'drift': f.cx = L.cx + L.amp * Math.sin(TAU * ph); break;
      case 'pulse': { const k = 0.5 * (1 - Math.cos(TAU * ph)); f.scale = 1 + L.amp * k; f.opa = Math.round(255 * (0.6 + 0.4 * k)); break; }
      case 'swing': f.angleDdeg = Math.trunc(L.amp * 10 * Math.sin(TAU * ph)); break;
      case 'flash': f.opa = (ph < 0.10 || (ph > 0.16 && ph < 0.24)) ? 255 : 45; break;
      // static -> neutre
    }
    return f;
  });
}
```

- [ ] **Step 2: Écrire `designer/tests/scenes.test.js` (miroir des tests natifs)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, SCENE_NAMES, sceneFrameAt, sceneLayerColor, sceneDefaultColor } from '../js/scenes.js';

test('catalogue : 9 scènes, SCENE_NAMES == clés de SCENES, chaque scène a des couches', () => {
  assert.equal(SCENE_NAMES.length, 9);
  assert.deepEqual([...SCENE_NAMES].sort(), Object.keys(SCENES).sort());
  for (const n of SCENE_NAMES) assert.ok(SCENES[n].layers.length >= 1);
});

test('sceneFrameAt : rotate -> angle 0 à t=0, ~1800 à demi-période, périodique', () => {
  assert.equal(sceneFrameAt('sunny', 0)[0].angleDdeg, 0);
  const half = sceneFrameAt('sunny', 3500)[0].angleDdeg;
  assert.ok(half > 1700 && half < 1900);
  assert.equal(sceneFrameAt('sunny', 1234)[0].angleDdeg, sceneFrameAt('sunny', 1234 + 7000)[0].angleDdeg);
});

test('sceneFrameAt : translate_loop -> cy varie, opa bornée, phases décalées', () => {
  const fr = sceneFrameAt('rain', 550);
  assert.equal(fr.length, 4);
  assert.equal(fr[0].cy, 38);                       // couche statique fixe
  assert.ok(fr[1].opa >= 0 && fr[1].opa <= 255);
  assert.notEqual(fr[1].cy, fr[2].cy);              // phases différentes
});

test('sceneFrameAt : pulse -> scale >= 1, opa dans [0,255]', () => {
  const f = sceneFrameAt('alert', 700)[0];
  assert.ok(f.scale >= 1 && f.scale <= 1.5);
  assert.ok(f.opa >= 0 && f.opa <= 255);
});

test('sceneFrameAt : name inconnu -> []', () => { assert.deepEqual(sceneFrameAt('nope', 0), []); });

test('sceneLayerColor : principal suit, accent fixe', () => {
  const s = SCENES.storm;
  assert.equal(sceneLayerColor(s.layers[0], '#3399FF'), '#3399FF');
  assert.equal(sceneLayerColor(s.layers[1], '#3399FF'), '#F5C518');
  assert.equal(sceneDefaultColor('rain'), '#3B82F6');
});
```

- [ ] **Step 3: Lancer les tests designer**

Run: `cd designer && node --test`
Expected: PASS (dont `tests/scenes.test.js`). Les autres tests inchangés.

- [ ] **Step 4: Commit**

```bash
git add designer/js/scenes.js designer/tests/scenes.test.js
git commit -m "feat(state/scene): designer scenes.js — table miroir + sceneFrameAt (tests node)

Claude-Session: https://claude.ai/code/session_01512UvxMoYcTUA7TLJCq3zy"
```

---

## Task 7: Schéma — `state_case.scene` + `size` + `$def sceneName` + parité

**Files:**
- Modify: `schema/layout.schema.json` (`$defs/sceneName`, `state_case`)
- Modify: `designer/tests/schema.test.js`

- [ ] **Step 1: `schema/layout.schema.json` — ajouter `$def sceneName`**

Près de `symbolName` / `fontFamily`, ajouter (enum = `SCENE_NAMES`) :

```json
    "sceneName": {
      "enum": ["sunny", "rain", "snow", "storm", "wind", "spinner", "alert", "bell", "pulse"],
      "description": "Nom d'une scène animée du catalogue figé (brique 2 du composant state). Firmware: SCENE_CATALOG (scenes.cpp) ; designer: SCENES (scenes.js). Rendu = glyphes MDI animés."
    },
```

- [ ] **Step 2: `schema/layout.schema.json` — `state_case` gagne `scene` + `size`**

Dans `state_case.properties`, ajouter (après `h`) :

```json
        "scene": { "$ref": "#/$defs/sceneName", "description": "Scène animée (visuel scene ; prioritaire sur src/symbol). Present => scene." },
        "size": { "type": "integer", "minimum": 8, "maximum": 360, "description": "Côté de la boîte carrée de la scène (px). Défaut 120." }
```

Et compléter la `description` de `state_case` pour mentionner le 3ᵉ kind : `... visuel (glyphe symbol/color XOR image src/w/h XOR scene scene/size ; kind infere par le champ present, priorite scene>src>symbol).`

- [ ] **Step 3: `designer/tests/schema.test.js` — parité `sceneName` ↔ `SCENE_NAMES`**

Ajouter en tête l'import `import { SCENE_NAMES } from '../js/scenes.js';` puis un test :

```js
test('parité : $defs.sceneName == SCENE_NAMES (scenes.js)', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schema/layout.schema.json', import.meta.url)));
  assert.deepEqual(schema.$defs.sceneName.enum, SCENE_NAMES);   // même liste, même ordre
});
```

> Vérifier que `readFileSync`/`assert`/`test` sont déjà importés dans `schema.test.js` (sinon les ajouter, cf. modèle `registry.test.js`).

- [ ] **Step 4: Tests designer**

Run: `cd designer && node --test`
Expected: PASS (dont la nouvelle parité et `schema.test.js`).

- [ ] **Step 5: Commit**

```bash
git add schema/layout.schema.json designer/tests/schema.test.js
git commit -m "feat(state/scene): schéma state_case.scene/size + \$def sceneName (parité)

Claude-Session: https://claude.ai/code/session_01512UvxMoYcTUA7TLJCq3zy"
```

---

## Task 8: Designer — `buildState` branche scène + RAF animé sur le canvas

**Files:**
- Modify: `designer/js/render.js` (`buildState` : branche scène ; helpers `paintSceneFrame`, `animateScene`)

Browser-verified (rendu DOM ; pas de test node — cf. mémoire `designer-tests-dom-builders`).

- [ ] **Step 1: `render.js` — imports**

Ajouter en tête : `import { SCENES, sceneFrameAt, sceneLayerColor } from './scenes.js';` (et vérifier que `ICON_CHAR` est déjà exporté/visible — il l'est).

- [ ] **Step 2: `render.js` — helpers de rendu scène (au-dessus de `buildState`)**

```js
// Applique une frame de scène aux N couches (spans .w-scene-layer) d'un nœud scène. Miroir de
// apply_scene_frame (view.cpp) : position (cx,cy 0..100 -> % de size), transform rotate/scale, opacité.
function paintSceneFrame(node, name, tMs) {
  const fr = sceneFrameAt(name, tMs);
  const size = node._sceneSize || 120;
  const layers = node.querySelectorAll('.w-scene-layer');
  fr.forEach((f, i) => {
    const el = layers[i]; if (!el) return;
    const dx = (f.cx - 50) / 100 * size, dy = (f.cy - 50) / 100 * size;
    const rot = f.angleDdeg / 10;                       // 1/10 deg -> deg
    el.style.transform = `translate(-50%,-50%) translate(${dx}px,${dy}px) rotate(${rot}deg) scale(${f.scale})`;
    el.style.opacity = String(f.opa / 255);
  });
}

// Boucle rAF auto-nettoyante : anime tant que le nœud est dans le DOM. Un re-render du canvas
// détache l'ancien nœud (isConnected=false) -> la boucle s'arrête d'elle-même. Pas de registre global.
function animateScene(node, name) {
  const loop = () => { if (!node.isConnected) return; paintSceneFrame(node, name, performance.now()); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
```

> Le pivot d'`SC_SWING` : `transform-origin` doit être en haut-centre pour la cloche. On le pose par couche selon l'anim (Step 3). Les autres couches pivotent au centre (défaut du `translate(-50%,-50%)` + `transform-origin:center`).

- [ ] **Step 3: `render.js` — `buildState` : branche scène (avant la branche glyphe)**

Dans `buildState`, après la résolution `const vis = ...`, ajouter la branche scène **avant** `if (vis.src)` (priorité scene>src>glyphe, miroir firmware) :

```js
  if (vis.scene && SCENES[vis.scene]) {                 // visuel scène (miroir buildState firmware)
    const size = Number(vis.size) || 120;
    const wrap = document.createElement('div');
    wrap.className = 'w w-scene';
    wrap.style.width = size + 'px'; wrap.style.height = size + 'px';
    wrap.style.position = 'relative';
    wrap._sceneSize = size;
    const principal = vis.color || SCENES[vis.scene].color || '#FFFFFF';
    SCENES[vis.scene].layers.forEach(L => {
      const el = document.createElement('i');
      el.className = 'mdi w-scene-layer';
      el.textContent = ICON_CHAR[L.symbol] || '';
      el.style.position = 'absolute'; el.style.left = '50%'; el.style.top = '50%';
      el.style.fontSize = Math.round(L.scaleRel * size) + 'px';
      el.style.color = sceneLayerColor(L, principal);
      el.style.transformOrigin = (L.anim === 'swing') ? 'center top' : 'center center';
      wrap.appendChild(el);
    });
    paintSceneFrame(wrap, vis.scene, 0);                // état initial
    animateScene(wrap, vis.scene);                      // anime en direct sur le canvas
    return wrap;
  }
```

- [ ] **Step 4: CSS — nœud scène (dans `designer/style.css`)**

Ajouter une règle minimale (le positionnement absolu est déjà en inline ; s'assurer que `.mdi.w-scene-layer` hérite bien de la police MDI) :

```css
.w-scene { display: block; }
.w-scene-layer { line-height: 1; will-change: transform, opacity; }
```

- [ ] **Step 5: Vérification navigateur**

Servir le designer (cf. mémoire `designer-verif-navigateur` : servir depuis la racine du repo, no-store), ajouter un composant `state`, donner à son `default` un visuel scène (ex. `spinner`) via l'inspecteur (Task 9 requise pour l'UI ; en attendant, injecter à la main dans le JSON un cas `{"scene":"rain"}`). Vérifier : les glyphes s'affichent superposés et **s'animent en continu** sur le canvas ; le changement de valeur mock bascule vers un autre cas et l'ancienne scène s'arrête (nœud détaché). Consigner dans `docs/_internal/designer-qa-report.md`.

- [ ] **Step 6: Tests designer (non régressés)**

Run: `cd designer && node --test` → Expected: PASS (les builders DOM ne sont pas testés en node ; aucune régression sur la logique pure).

- [ ] **Step 7: Commit**

```bash
git add designer/js/render.js designer/style.css
git commit -m "feat(state/scene): designer buildState branche scène + canvas animé (rAF)

Claude-Session: https://claude.ai/code/session_01512UvxMoYcTUA7TLJCq3zy"
```

---

## Task 9: Designer — inspecteur (3ᵉ mode « scène ») + `scene-picker.js` + i18n

**Files:**
- Create: `designer/js/scene-picker.js`
- Modify: `designer/js/inspector.js` (`visualEditor` : mode scène)
- Modify: `designer/js/i18n.js` (clés EN/FR)

Browser-verified.

- [ ] **Step 1: Écrire `designer/js/scene-picker.js` (calque de `icon-picker.js`, vignettes animées)**

```js
// Overlay de sélection de scène : grille de vignettes ANIMÉES (une boucle rAF par vignette, arrêtée
// à la fermeture). Calque de icon-picker.js (singleton, overlay transitoire, Escape/backdrop close).
import { SCENES, SCENE_NAMES, sceneFrameAt, sceneLayerColor } from './scenes.js';
import { ICON_CHAR } from './render.js';
import { t } from './i18n.js';

let _open = null;   // { overlay, onKey, raf }

export function closeScenePicker() {
  if (!_open) return;
  cancelAnimationFrame(_open.raf);
  document.removeEventListener('keydown', _open.onKey);
  _open.overlay.remove();
  _open = null;
}

export function openScenePicker({ current = null, onPick } = {}) {
  closeScenePicker();
  const overlay = document.createElement('div');
  overlay.className = 'shot-overlay iconpick-overlay';
  const box = document.createElement('div'); box.className = 'iconpick-box';
  overlay.appendChild(box);
  const bar = document.createElement('div'); bar.className = 'iconpick-bar';
  const title = document.createElement('span'); title.textContent = t('scenepicker.title');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'iconpick-close'; closeBtn.type = 'button'; closeBtn.textContent = '×';
  bar.append(title, closeBtn); box.appendChild(bar);
  const grid = document.createElement('div'); grid.className = 'iconpick-grid scenepick-grid';
  box.appendChild(grid);

  const pick = name => { closeScenePicker(); onPick?.(name); };
  const nodes = [];   // { name, wrap } pour l'animation
  for (const name of SCENE_NAMES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'iconpick-item' + (name === current ? ' sel' : '');
    b.title = t('scene.' + name);
    const wrap = document.createElement('div'); wrap.className = 'scenepick-thumb'; wrap.style.position = 'relative';
    wrap._sceneSize = 44;
    SCENES[name].layers.forEach(L => {
      const el = document.createElement('i');
      el.className = 'mdi w-scene-layer';
      el.textContent = ICON_CHAR[L.symbol] || '';
      el.style.position = 'absolute'; el.style.left = '50%'; el.style.top = '50%';
      el.style.fontSize = Math.round(L.scaleRel * 44) + 'px';
      el.style.color = sceneLayerColor(L, SCENES[name].color);
      el.style.transformOrigin = (L.anim === 'swing') ? 'center top' : 'center center';
      wrap.appendChild(el);
    });
    const lbl = document.createElement('span'); lbl.className = 'iconpick-name'; lbl.textContent = t('scene.' + name);
    b.append(wrap, lbl);
    b.addEventListener('click', () => pick(name));
    grid.appendChild(b);
    nodes.push({ name, wrap });
  }

  // Anime toutes les vignettes dans une seule boucle rAF (arrêtée à la fermeture via _open.raf).
  const paint = () => {
    for (const { name, wrap } of nodes) {
      const fr = sceneFrameAt(name, performance.now());
      const layers = wrap.querySelectorAll('.w-scene-layer');
      fr.forEach((f, i) => {
        const el = layers[i]; if (!el) return;
        const dx = (f.cx - 50) / 100 * 44, dy = (f.cy - 50) / 100 * 44;
        el.style.transform = `translate(-50%,-50%) translate(${dx}px,${dy}px) rotate(${f.angleDdeg / 10}deg) scale(${f.scale})`;
        el.style.opacity = String(f.opa / 255);
      });
    }
    if (_open) _open.raf = requestAnimationFrame(paint);
  };

  closeBtn.addEventListener('click', () => closeScenePicker());
  overlay.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === overlay) closeScenePicker(); });
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeScenePicker(); } };
  document.addEventListener('keydown', onKey);
  _open = { overlay, onKey, raf: 0 };
  document.body.appendChild(overlay);
  _open.raf = requestAnimationFrame(paint);
}
```

- [ ] **Step 2: `inspector.js` — importer le picker + les scènes**

En tête : `import { openScenePicker } from './scene-picker.js';` et `import { SCENES, sceneDefaultColor } from './scenes.js';`.

- [ ] **Step 3: `inspector.js` — `visualEditor` gagne le mode « scène »**

Dans `visualEditor(visual, onCommit)` (bloc `if (c.type === 'state')`) :

(a) Le sélecteur de kind gagne l'option `scene`. Remplacer la construction du `toggle` :

```js
        const kindOf = () => visual.scene ? 'scene' : (visual.src ? 'image' : 'glyph');
        const toggle = document.createElement('select'); toggle.className = 'insp-state-kind';
        for (const [val, key] of [['glyph', 'inspector.opt.glyph'], ['image', 'inspector.opt.image'], ['scene', 'inspector.opt.scene']]) {
          const o = document.createElement('option'); o.value = val; o.textContent = t(key); toggle.appendChild(o);
        }
        toggle.value = kindOf();
```

(b) `renderSlot()` gagne une branche scène. Ajouter, en tête de `renderSlot`, avant `if (isImg())` (remplacer `if (isImg())` par une cascade) :

```js
        const renderSlot = () => {
          slot.textContent = '';
          if (visual.scene) {                             // --- mode scène ---
            const btn = document.createElement('button');
            btn.type = 'button'; btn.className = 'insp-iconbtn';
            const nm = document.createElement('span'); nm.className = 'insp-iconbtn-name';
            nm.textContent = t('scene.' + visual.scene);
            btn.appendChild(nm);
            btn.addEventListener('click', () => openScenePicker({
              current: visual.scene,
              onPick: name => { if (name) { visual.scene = name; visual.color = visual.color || sceneDefaultColor(name); onCommit(visual); } },
            }));
            const col = document.createElement('input'); col.type = 'color';
            col.value = visual.color || sceneDefaultColor(visual.scene);
            col.addEventListener('change', () => { clearPreview?.(); visual.color = col.value.toUpperCase(); onCommit(visual); });
            const sizeIn = makeInput('num', visual.size ?? 120, v => { visual.size = v === '' ? 120 : v; onCommit(visual); });
            slot.append(btn, col, sizeIn);
            return;
          }
          if (isImg()) {
            /* ... branche image existante inchangée ... */
```

(c) Le `toggle.change` gère le passage vers/depuis scène (mutation exclusive des champs — miroir de l'inférence firmware) :

```js
        toggle.addEventListener('change', () => {
          if (toggle.value === 'scene') {
            delete visual.symbol; delete visual.color; delete visual.src; delete visual.w; delete visual.h;
            visual.scene = visual.scene || 'spinner'; visual.color = sceneDefaultColor(visual.scene); visual.size = visual.size || 120;
          } else if (toggle.value === 'image') {
            delete visual.symbol; delete visual.color; delete visual.scene; delete visual.size;
            visual.src = visual.src || ''; visual.w = visual.w || 120; visual.h = visual.h || 120;
          } else {
            delete visual.src; delete visual.w; delete visual.h; delete visual.scene; delete visual.size;
            visual.symbol = visual.symbol || 'bell';
          }
          renderSlot(); onCommit(visual);
        });
```

> Rappel invariants (cf. CLAUDE.md « Designer — invariants ») : `ref` figée au rendu, commit sur `change`, `clearPreview()` avant commit couleur, `cases[idx]` muté **en place** (ne pas réassigner). Les mutations `setStateCases`/`setStateDefault` stockent l'objet visuel tel quel — **aucune modification requise** dans `mutations.js` (un visuel scène `{scene,color,size}` est un objet comme un autre).

- [ ] **Step 4: `i18n.js` — clés EN/FR**

Ajouter aux tables EN et FR (mêmes clés, valeurs traduites) :
- `inspector.opt.scene` : EN `"Scene"` / FR `"Scène"`
- `field.size` : EN `"Size"` / FR `"Taille"` (si pas déjà présent)
- `scenepicker.title` : EN `"Choose a scene"` / FR `"Choisir une scène"`
- `scene.sunny`…`scene.pulse` (9 clés) : libellés lisibles, ex. EN `{sunny:"Sunny", rain:"Rain", snow:"Snow", storm:"Storm", wind:"Wind", spinner:"Loading", alert:"Alert", bell:"Bell", pulse:"Pulse"}` / FR `{sunny:"Soleil", rain:"Pluie", snow:"Neige", storm:"Orage", wind:"Vent", spinner:"Chargement", alert:"Alerte", bell:"Cloche", pulse:"Pulsation"}`.

> Vérifier via le test de parité i18n existant (`designer/tests/i18n-parity.test.js`) que EN et FR ont exactement les mêmes clés.

- [ ] **Step 5: CSS picker (dans `designer/style.css`)**

```css
.scenepick-grid { grid-template-columns: repeat(3, 1fr); }
.scenepick-thumb { width: 44px; height: 44px; margin: 0 auto 4px; }
```

- [ ] **Step 6: Tests designer + vérification navigateur**

Run: `cd designer && node --test` → Expected: PASS (dont `i18n-parity`).
Navigateur : sélectionner un composant `state`, basculer un cas (et le défaut) en mode « scène », ouvrir le picker (vignettes animées), choisir une scène, régler couleur + taille ; vérifier le rendu animé sur le canvas et la bascule glyphe↔image↔scène. Consigner dans `docs/_internal/designer-qa-report.md`.

- [ ] **Step 7: Commit**

```bash
git add designer/js/scene-picker.js designer/js/inspector.js designer/js/i18n.js designer/style.css
git commit -m "feat(state/scene): inspecteur 3e mode scène + scene-picker + i18n EN/FR

Claude-Session: https://claude.ai/code/session_01512UvxMoYcTUA7TLJCq3zy"
```

---

## Task 10: Vérification d'ensemble (gates + QA navigateur)

**Files:** aucun (vérification). Corrections éventuelles → commits ciblés.

- [ ] **Step 1: Gates firmware**

Run: `pio test -e native` → Expected: PASS (compteur ≥ 196 = 193 + 3 nouveaux de Task 1, plus les extensions).
Run: `pio run -e esp32s3` → Expected: SUCCESS ; noter le % RAM/Flash (comparer aux 73 % de la brique 1 ; alerter si hausse notable due aux layers de transform).

- [ ] **Step 2: Gate designer**

Run: `cd designer && node --test` → Expected: PASS (tous, dont `scenes`, parité `sceneName`/`SCENE_NAMES`, `i18n-parity`).

- [ ] **Step 3: QA navigateur complète**

Servir le designer (racine du repo, no-store). Pour chacune des 9 scènes : l'ajouter comme cas d'un `state`, vérifier le rendu animé et l'affiner (positions/amplitudes de `scenes.js` **et** `scenes.cpp` en miroir si retouche). Vérifier : bascule exact/range avec cas scène, undo/redo (le visuel scène est un objet committé), export/import `.dboard` conserve `scene`/`color`/`size`. Consigner dans `docs/_internal/designer-qa-report.md`.

> ⚠ Toute retouche de valeurs dans `scenes.js` DOIT être répliquée dans `scenes.cpp` (et les points de contrôle des tests ajustés). La parité des **noms** est verrouillée par un test ; la parité des **mouvements** repose sur cette discipline + les tests miroirs.

- [ ] **Step 4: Commit (si retouches)**

```bash
git add -A
git commit -m "chore(state/scene): affinage catalogue (parité js/cpp) + QA navigateur

Claude-Session: https://claude.ai/code/session_01512UvxMoYcTUA7TLJCq3zy"
```

---

## Task 11: Spike qualité/perf on-device + vérification (device requis)

⚠ **Device requis** (Guition JC3636K718). Non bloquant pour le code ; valide le **risque nº 1** (transform de label) et le comportement réel. Cf. mémoires `verif-on-device-screenshots`, `uploadfs-efface-assets-device` (⚠ `uploadfs` efface le LittleFS ; sauvegarder les assets device avant flash).

- [ ] **Step 1: Flasher firmware + FS**

Run: `pio run -e esp32s3 -t upload` puis `bash tools/stage_fs.sh && pio run -e esp32s3 -t uploadfs`.

- [ ] **Step 2: Pousser un layout de test et observer**

Pousser (via `POST /page/layout` ou `tools/push.py`) un layout avec un `state` météo : mode `exact` (bind string) sélectionnant `sunny`/`rain`/`storm`, et un second `state` mode `range` (code numérique) sélectionnant des scènes. `POST /update` pour faire varier la valeur.

- [ ] **Step 3: Valider le risque nº 1**

Observer sur l'écran (captures via `GET /screenshot`) : (a) les scènes **s'animent** (rotation `sunny`/`spinner`, chute `rain`/`snow`, oscillation `bell`, pulse `alert`/`pulse`, flash `storm`, drift `wind`) ; (b) **fluidité** (~30 fps, pas de saccade) ; (c) **qualité** du texte tourné/mis à l'échelle (pas d'artefact grossier) ; (d) RAM stable (pas de fuite au fil des swaps de cas). Vérifier la **bascule** scène↔glyphe↔image sans crash.

- [ ] **Step 4: Si la qualité/perf déçoit → repli**

Basculer scène par scène les couches `rotate`/`swing`/`pulse` vers le repli **translation+opacité** (cf. spec §12) dans `scenes.cpp` **et** `scenes.js` (parité), en gardant l'API `AnimKind` (ex. remplacer `SC_ROTATE` du soleil par des rayons en cascade d'opacité — nécessiterait un glyphe adapté, sinon garder rotate si acceptable). Re-tester.

- [ ] **Step 5: Mettre à jour le HANDOFF**

Consigner le résultat du spike (transform OK/repli) dans `docs/_internal/HANDOFF.md` et cocher la vérif on-device de `state` brique 2.

---

## Self-Review

**1. Spec coverage :**
- §1/§2 objectif, kind scene, catalogue figé → Tasks 1,3,7 ✅
- §3 modèle (scene name→index, color, size, inférence scene>src>symbol) → Tasks 1,3,7 ✅
- §4 mini-moteur + table + vocabulaire AnimKind + catalogue v1 → Tasks 1 (C), 6 (JS) ✅
- §5 enum kind, N couches, swap dur, tick logiciel (pas lv_anim), dash_tick_scene → Tasks 2,3,4,5 ✅
- §6 designer canvas animé + inspecteur 3ᵉ mode + picker → Tasks 8,9 ✅
- §8 tests natif (parse+resolve inchangé+frame) + node (frame pure) + parité noms + browser + on-device → Tasks 1,3,6,7,8,9,10,11 ✅
- §11 décisions figées (couleur principale+accents, vitesse figée, size px, canvas animé, tick logiciel, enum kind) → respectées ✅
- §12 risque nº 1 + spike + repli → Task 11 ✅

**2. Placeholder scan :** catalogue C et JS complets (valeurs réelles) ; tests avec code réel ; commandes exactes. Les positions/amplitudes sont des valeurs de départ **explicitement** affinables (Task 10) — pas des TODO. La substitution `heart`→`broadcast`/`loading`→`refresh` est justifiée (glyphes absents du jeu).

**3. Type consistency :** `enum StateKind {STATE_GLYPH,STATE_IMAGE,STATE_SCENE}`, `StateCase.kind/scene/size`, `Component.state_shown_kind/state_shown_scene`, `SceneAnim`/`SceneRole`/`SceneLayer`/`Scene`/`LayerFrame`, `scene_frame_at`/`scene_name_index`/`scene_layer_color`/`scene_count` (C) ↔ `SCENES`/`SCENE_NAMES`/`sceneFrameAt`/`sceneLayerColor`/`sceneDefaultColor` (JS) — noms cohérents entre toutes les tâches. `apply_scene_frame` (view.cpp) consomme `scene_frame_at` avec la signature déclarée en Task 1.
