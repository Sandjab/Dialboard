# Composant `state` — plan d'implémentation (brique 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un composant `state` qui affiche un visuel (glyphe MDI + couleur *ou* image bitmap) choisi parmi N cas selon la valeur bindée/poussée, avec sélection hybride (clé exacte string/nombre *ou* plages numériques) et un visuel par défaut.

**Architecture:** Nouveau type `COMP_STATE`. Cœur logique = fonction pure `state_resolve` (native, miroir exact du résolveur designer `resolveState`) qui rend l'index du cas actif ou `-1` (défaut). Le firmware réutilise **sans les modifier** les briques de rendu de `icon` (glyphe = `lv_label` en `get_icon_font` + `ICON_GLYPHS`) et de `image` (bitmap RGB565A8 en PSRAM) ; l'objet principal est un **conteneur** transparent hébergeant un seul enfant qu'on swappe si le kind change (glyphe↔image). Le designer réutilise le picker MDI (#42) et le picker d'asset image. Le schéma JSON est le contrat partagé, gardé par les tests de parité registre↔schéma et EN↔FR.

**Tech Stack:** C++/Arduino + LVGL 9.5 (firmware) ; JS modules ES + `node --test` (designer) ; JSON Schema ; Unity (tests natifs). Build `pio run -e esp32s3`, tests natifs `pio test -e native`, tests designer `cd designer && node --test`.

---

## Décision à valider avant de commencer (déviation vs spec §4)

La spec §4 note « Schéma : `oneOf` glyphe|image sur le visuel ». **Ce plan n'exprime PAS ce `oneOf` dans le schéma** : `$defs/state_case` liste tous les champs (`key`/`at`/`symbol`/`color`/`src`/`w`/`h`) en `additionalProperties: false`, et l'exclusivité glyphe⊕image est garantie par (a) l'UI de l'inspecteur (bascule glyphe|image), (b) l'inférence firmware (`src` présent → image, sinon glyphe). Raison : un `oneOf` sur le visuel partagé entre `cases` *et* `default`, combiné à `additionalProperties: false`, tombe dans le piège classique JSON-Schema `allOf`+`additionalProperties` (les champs hérités sont rejetés). Pour brique 1, l'inférence par champ suffit et reste cohérente firmware↔designer.

**→ Si tu veux le `oneOf` strict malgré tout, dis-le avant la Tâche 5** ; sinon on part sur l'inférence par champ.

---

## Structure des fichiers touchés

**Firmware :**
- `src/config.h` — `MAX_STATE_CASES` (nouveau, 16).
- `src/dashboard.h` — `enum StateMatch`, `struct StateCase`, champs `state_*` sur `Component`, `COMP_STATE` dans l'enum, decl helpers.
- `src/color.h` / `src/color.cpp` — `state_resolve` (pure, native).
- `src/dashboard.cpp` — mapping `"state"`, parsing dans `dash_set_layout`, `apply_state` + entrée `APPLY[]`, `case COMP_STATE` dans `context_apply`.
- `src/view.cpp` — `state_load_image`, `build_state`, `sync_state`, entrée `VIEW[]`.
- `test/test_core/test_main.cpp` — `test_state_resolve`, `test_state_parsed`, `test_state_context` + `RUN_TEST`.

**Designer :**
- `designer/js/render.js` — `resolveState` (pure), `buildState` (DOM), `MOCKS.state`.
- `designer/js/registry.js` — import `buildState`, entrée `state`.
- `designer/js/inspector.js` — bloc bespoke `state` (table de cas, éditeur de visuel, défaut, select `match`, mock).
- `designer/js/mutations.js` — `setStateCases`, `setStateDefault`, `setStateMatch`.
- `schema/layout.schema.json` — `$defs/comp_state`, `$defs/state_case`, ligne dans `component.oneOf`.
- `designer/i18n/en.js` + `designer/i18n/fr.json` — clés `comp.state`, `field.match`, `inspector.*`.
- `designer/tests/render.test.js` — tests `resolveState`.
- `designer/tests/registry.test.js` — test registre `state`.

**Ordre imposé par les tests/couplages :**
1. `state_resolve` pur + struct (Tâche 1, native-green).
2. Type + modèle + parsing + `apply_state` + entrées de tables (Tâche 2, native-green ; esp32 reste vert via placeholder VIEW).
3. Rendu LVGL (Tâche 3, esp32-green).
4. `context_apply` bind (Tâche 4, native-green).
5. `resolveState` + `buildState` + `MOCKS.state` (Tâche 5, node-green) — **avant** le registre (sinon l'import de `buildState` casse le chargement du module).
6. Schéma + registre + i18n (Tâche 6, node-green : parité registre↔schéma + EN↔FR).
7. Inspecteur bespoke (Tâche 7, browser-verified).
8. Vérif on-device (Tâche 8).

---

## Task 1 : Firmware — `state_resolve` pur + `struct StateCase` + test natif

**Files:**
- Modify: `src/config.h` (après `MAX_ICON_STATES`, ~ligne 6)
- Modify: `src/dashboard.h` (après `struct IconState`, ~ligne 20)
- Modify: `src/color.h` (après la decl `icon_resolve`, ~ligne 12)
- Modify: `src/color.cpp` (ajouter `#include <string.h>` en tête ~ligne 2 ; def après `icon_resolve`, ~ligne 34)
- Test: `test/test_core/test_main.cpp` (près de `test_icon_resolve`, ~ligne 1396 ; `RUN_TEST` ~ligne 1740)

- [ ] **Step 1: Écrire le test qui échoue**

Dans `test/test_core/test_main.cpp`, juste après `test_icon_resolve` (~ligne 1396) :

```cpp
void test_state_resolve(void) {
    // 3 cas glyphe/image ; matcher selon le mode. -1 = defaut.
    StateCase cs[3] = {};
    // exact : cle string "Clear", cle string "Rain", cle numerique 3
    strcpy(cs[0].key_str, "Clear"); cs[0].has_num_key = false;
    strcpy(cs[1].key_str, "Rain");  cs[1].has_num_key = false;
    cs[2].has_num_key = true;       cs[2].key_num = 3;

    // exact + string -> matche la cle string egale
    TEST_ASSERT_EQUAL_INT(0, state_resolve(STATE_EXACT, cs, 3, false, 0, "Clear"));
    TEST_ASSERT_EQUAL_INT(1, state_resolve(STATE_EXACT, cs, 3, false, 0, "Rain"));
    TEST_ASSERT_EQUAL_INT(-1, state_resolve(STATE_EXACT, cs, 3, false, 0, "Snow"));   // aucune -> defaut
    // exact + nombre -> matche la cle numerique egale ; ignore les cles string
    TEST_ASSERT_EQUAL_INT(2, state_resolve(STATE_EXACT, cs, 3, true, 3, ""));
    TEST_ASSERT_EQUAL_INT(-1, state_resolve(STATE_EXACT, cs, 3, true, 9, ""));

    // range : bandes ordonnees, 1er ou num < at ; string -> defaut
    StateCase rg[2] = {};
    rg[0].at = 10; rg[1].at = 20;
    TEST_ASSERT_EQUAL_INT(0, state_resolve(STATE_RANGE, rg, 2, true, 5,  ""));   // 5 < 10
    TEST_ASSERT_EQUAL_INT(1, state_resolve(STATE_RANGE, rg, 2, true, 15, ""));   // 15 < 20
    TEST_ASSERT_EQUAL_INT(-1, state_resolve(STATE_RANGE, rg, 2, true, 25, ""));  // aucune -> defaut
    TEST_ASSERT_EQUAL_INT(-1, state_resolve(STATE_RANGE, rg, 2, false, 0, "x")); // string en range -> defaut

    // doublon : l'ordre departage (1er gagne)
    StateCase dup[2] = {};
    strcpy(dup[0].key_str, "A"); strcpy(dup[1].key_str, "A");
    TEST_ASSERT_EQUAL_INT(0, state_resolve(STATE_EXACT, dup, 2, false, 0, "A"));

    // table vide -> defaut
    TEST_ASSERT_EQUAL_INT(-1, state_resolve(STATE_EXACT, cs, 0, false, 0, "Clear"));
}
```

Enregistrer le test dans `main()`, juste après `RUN_TEST(test_icon_resolve);` (~ligne 1740) :

```cpp
    RUN_TEST(test_state_resolve);
```

- [ ] **Step 2: Lancer le test — vérifier qu'il échoue à la compilation**

Run: `pio test -e native`
Expected: **FAIL** de compilation — `StateCase`, `STATE_EXACT`, `STATE_RANGE`, `state_resolve` non déclarés.

- [ ] **Step 3: Déclarer `MAX_STATE_CASES`**

Dans `src/config.h`, après `#define MAX_ICON_STATES 4` (~ligne 6) :

```cpp
#define MAX_STATE_CASES         16      // state : nb max de cas (garde cote designer, cf. MAX_ICON_STATES)
```

- [ ] **Step 4: Déclarer `enum StateMatch` + `struct StateCase`**

Dans `src/dashboard.h`, juste après `struct IconState { ... };` (~ligne 20) :

```cpp
enum StateMatch { STATE_EXACT = 0, STATE_RANGE = 1 };
// state : un cas = un matcher (exact: key_str|key_num ; range: at) + un visuel (glyphe symbol/color XOR image src/w/h).
// has_src == true -> visuel image ; sinon glyphe. Kind infere par le champ present (comme icon/image).
struct StateCase {
    bool     has_num_key;            // exact : la cle est numerique (key_num) ; sinon string (key_str)
    double   key_num;
    char     key_str[TEXT_LEN];
    float    at;                     // range : borne haute exclusive (num < at)
    bool     has_src;                // true = visuel image ; false = visuel glyphe
    uint16_t symbol;                 // glyphe : index dans ICON_GLYPHS (view.cpp)
    uint32_t color;                  // glyphe : couleur (defaut 0xFFFFFF)
    char     src[ID_LEN];            // image : cle d'asset (/img/<src>.565a)
    int      w, h;                   // image : dimensions RGB565A8
};
```

- [ ] **Step 5: Déclarer `state_resolve`**

Dans `src/color.h`, après la déclaration de `icon_resolve` (~ligne 12) :

```cpp
// state : resout l'index du cas actif pour une valeur (miroir designer resolveState). -1 = defaut.
// exact : compare selon le type de la valeur (has_num -> key_num ; sinon key_str). range : num seul, 1er num < at.
// Pure, sans LVGL (testable en natif).
int state_resolve(uint8_t match, const StateCase* cases, int n, bool has_num, double num, const char* str);
```

- [ ] **Step 6: Implémenter `state_resolve`**

Dans `src/color.cpp` : d'abord ajouter en tête (après `#include <stdlib.h>`, ~ligne 2) :

```cpp
#include <string.h>
```

Puis, après la définition de `icon_resolve` (~ligne 34) :

```cpp
int state_resolve(uint8_t match, const StateCase* cases, int n, bool has_num, double num, const char* str) {
    if (match == STATE_RANGE) {
        if (!has_num) return -1;                             // range = numerique seul ; string -> defaut
        for (int i = 0; i < n; i++) if (num < cases[i].at) return i;
        return -1;
    }
    for (int i = 0; i < n; i++) {                            // exact : 1er match selon le type de la valeur
        if (has_num) { if (cases[i].has_num_key && cases[i].key_num == num) return i; }
        else         { if (!cases[i].has_num_key && strcmp(cases[i].key_str, str) == 0) return i; }
    }
    return -1;
}
```

- [ ] **Step 7: Lancer le test — vérifier qu'il passe**

Run: `pio test -e native`
Expected: **PASS** — `test_state_resolve` vert, tous les autres tests toujours verts.

- [ ] **Step 8: Commit**

```bash
git add src/config.h src/dashboard.h src/color.h src/color.cpp test/test_core/test_main.cpp
git commit -m "feat(state): resolveur pur state_resolve + struct StateCase + test natif"
```

---

## Task 2 : Firmware — type `COMP_STATE`, modèle, parsing, `apply_state` + test natif

> **AMENDEMENT 2026-07-08 (pool partagé — supersède le stockage inline ci-dessous).** Le stockage
> `StateCase state_cases[MAX_STATE_CASES]` **inline dans chaque `Component`** déborde la DRAM esp32
> (`sizeof(StateCase)`=96 o × 16 × `MAX_COMPONENTS`=32 × 2 instances `Dashboard` ≈ +107 KB → `dram0_0_seg`
> overflow de 38904 o). **Correctif retenu (validé) : pool partagé.**
> - `src/config.h` : ajouter `#define MAX_STATE_CASES_TOTAL 64` (pool partagé par tous les composants state).
> - `struct Dashboard` (dashboard.h ~l.208, après `sink_count`) : `StateCase state_pool[MAX_STATE_CASES_TOTAL]; int state_pool_used;`. Le pool est **dans** `Dashboard` → swappé atomiquement par `*d = t;` (dash_set_layout l.390), atomicité préservée.
> - `struct Component` : **remplacer** `StateCase state_cases[MAX_STATE_CASES]` par `int16_t state_cases_off;` (offset dans `state_pool`, valide si `state_case_count>0`). Garder `int state_case_count`, `StateCase state_default` (inline, 1 seul), `state_match`, `state_has_num`, `state_shown_is_img`, `state_shown_src`.
> - Parsing (`dash_set_layout`) : allouer la tranche depuis le scratch parsé (`t.state_pool`), cf. Step 6 amendé.
> - `build_state`/`sync_state` (Task 3) : lire la tranche via `s_dash->state_pool[c.state_cases_off]` (garde `count>0`).
> - Tests (`test_state_parsed`, `test_state_context`) : indexer via `d.state_pool[…off + i]` au lieu de `a.state_cases[i]`.
> - `state_resolve` et `struct StateCase` (Task 1, committés) **inchangés** (le résolveur prend `const StateCase*, int n` → marche sur une tranche du pool).
> - **Note Unity** : `TEST_ASSERT_EQUAL_DOUBLE` est indisponible ici (`UNITY_INCLUDE_DOUBLE` non défini) → utiliser `TEST_ASSERT_EQUAL_FLOAT`.
>
> Les blocs de code ci-dessous montrent la forme **inline d'origine** ; appliquer la variante **pool** décrite dans l'amendement.

**Files:**
- Modify: `src/dashboard.h` (enum `CompType` ~ligne 8 ; champs `Component` près de `icon_states` ~ligne 90)
- Modify: `src/dashboard.cpp` (`COMP_NAMES` ~ligne 35 ; helper + parsing dans `dash_set_layout` près du bloc icon ~ligne 228 ; `apply_state` + `APPLY[]` ~ligne 510)
- Modify: `src/view.cpp` (placeholder `VIEW[]` ~ligne 905 — provisoire, rempli en Tâche 3)
- Test: `test/test_core/test_main.cpp` (près de `test_icon_parsed` ~ligne 1426 ; `RUN_TEST` ~ligne 1741)

- [ ] **Step 1: Écrire le test de parsing qui échoue**

Dans `test/test_core/test_main.cpp`, après `test_icon_parsed` (~ligne 1426) :

```cpp
static const char* LAYOUT_STATE =
  "{\"components\":{"
    "\"s1\":{\"type\":\"state\",\"bind\":\"weather\",\"match\":\"exact\",\"font\":64,"
      "\"default\":{\"symbol\":\"weather-cloudy\",\"color\":\"#9AA0AA\"},"
      "\"cases\":["
        "{\"key\":\"Clear\",\"symbol\":\"weather-sunny\",\"color\":\"#FFC02E\"},"
        "{\"key\":\"Rain\",\"symbol\":\"weather-pouring\"},"
        "{\"key\":3,\"src\":\"abc123\",\"w\":120,\"h\":120}"
      "]},"
    "\"s2\":{\"type\":\"state\",\"match\":\"range\","
      "\"default\":{\"symbol\":\"weather-cloudy\"},"
      "\"cases\":[{\"at\":10,\"symbol\":\"weather-snowy\"}]}},"
  "\"pages\":[{\"name\":\"p\",\"place\":[{\"ref\":\"s1\"},{\"ref\":\"s2\"}]}]}";

void test_state_parsed(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE_MESSAGE(dash_set_layout(&d, LAYOUT_STATE, err, sizeof(err)), err);
    int s1 = dash_find(&d, "s1");
    TEST_ASSERT_TRUE(s1 >= 0);
    const Component& a = d.components[s1];
    TEST_ASSERT_EQUAL_INT(COMP_STATE, a.type);
    TEST_ASSERT_EQUAL_INT(STATE_EXACT, a.state_match);
    TEST_ASSERT_EQUAL_INT(64, a.font);
    TEST_ASSERT_EQUAL_STRING("weather", a.bind);
    // defaut : glyphe weather-cloudy + couleur
    TEST_ASSERT_FALSE(a.state_default.has_src);
    TEST_ASSERT_EQUAL_STRING("weather-cloudy", ICON_SYMBOL_NAMES[a.state_default.symbol]);
    TEST_ASSERT_EQUAL_HEX32(0x9AA0AA, a.state_default.color);
    // 3 cas
    TEST_ASSERT_EQUAL_INT(3, a.state_case_count);
    // cas 0 : cle string, glyphe + couleur
    TEST_ASSERT_FALSE(a.state_cases[0].has_num_key);
    TEST_ASSERT_EQUAL_STRING("Clear", a.state_cases[0].key_str);
    TEST_ASSERT_FALSE(a.state_cases[0].has_src);
    TEST_ASSERT_EQUAL_STRING("weather-sunny", ICON_SYMBOL_NAMES[a.state_cases[0].symbol]);
    TEST_ASSERT_EQUAL_HEX32(0xFFC02E, a.state_cases[0].color);
    // cas 1 : couleur omise -> blanc par defaut
    TEST_ASSERT_EQUAL_HEX32(0xFFFFFF, a.state_cases[1].color);
    // cas 2 : cle numerique, visuel image
    TEST_ASSERT_TRUE(a.state_cases[2].has_num_key);
    TEST_ASSERT_EQUAL_DOUBLE(3.0, a.state_cases[2].key_num);
    TEST_ASSERT_TRUE(a.state_cases[2].has_src);
    TEST_ASSERT_EQUAL_STRING("abc123", a.state_cases[2].src);
    TEST_ASSERT_EQUAL_INT(120, a.state_cases[2].w);
    // s2 : mode range
    int s2 = dash_find(&d, "s2");
    TEST_ASSERT_EQUAL_INT(STATE_RANGE, d.components[s2].state_match);
    TEST_ASSERT_EQUAL_FLOAT(10.0f, d.components[s2].state_cases[0].at);
}
```

Enregistrer dans `main()`, après `RUN_TEST(test_icon_parsed);` (~ligne 1741) :

```cpp
    RUN_TEST(test_state_parsed);
```

- [ ] **Step 2: Lancer le test — vérifier qu'il échoue**

Run: `pio test -e native`
Expected: **FAIL** de compilation — `COMP_STATE` inconnu, champs `state_*` absents de `Component`.

- [ ] **Step 3: Ajouter `COMP_STATE` à l'enum**

Dans `src/dashboard.h`, ligne de l'enum `CompType` (~ligne 8) : insérer `COMP_STATE` **juste avant** `COMP_COUNT` :

```cpp
enum CompType { COMP_NONE, COMP_LABEL, COMP_READOUT, COMP_BAR, COMP_RING, COMP_LED_RING, COMP_SOUND, COMP_CHART, COMP_METER, COMP_IMAGE, COMP_IMAGE_ANIM, COMP_LED, COMP_RECT, COMP_CIRCLE, COMP_LINE, COMP_ICON, COMP_SWITCH, COMP_BUTTON, COMP_SLIDER, COMP_ARC, COMP_ROLLER, COMP_CLOCK, COMP_RINGS, COMP_QR, COMP_STEPPER, COMP_SEGMENTED, COMP_STATE, COMP_COUNT };
```

- [ ] **Step 4: Ajouter les champs `state_*` à `Component`**

Dans `src/dashboard.h`, après le bloc icon (`int icon_state_count;`, ~ligne 90) :

```cpp
    // state : selecteur de visuel pilote par la valeur (cases + defaut) ; match exact|range.
    uint8_t   state_match;                       // STATE_EXACT | STATE_RANGE
    StateCase state_cases[MAX_STATE_CASES];
    int       state_case_count;
    StateCase state_default;                     // visuel si aucun cas ne matche (matcher ignore)
    bool      state_has_num;                     // dernier type recu : true=num (c.value), false=str (c.vstr)
    bool      state_shown_is_img;                // kind du visuel rendu (detecte glyphe<->image au sync)
    char      state_shown_src[ID_LEN];           // src de l'image actuellement chargee (recharge au changement)
```

- [ ] **Step 5: Mapper le nom `"state"` → `COMP_STATE`**

Dans `src/dashboard.cpp`, dans `COMP_NAMES[]` (~ligne 44, après `{ "segmented", COMP_SEGMENTED }`) ajouter :

```cpp
    { "state", COMP_STATE },
```

- [ ] **Step 6: Ajouter le helper de visuel + le parsing du composant**

Dans `src/dashboard.cpp`, au niveau fichier (avant `dash_set_layout`, à côté de `icon_symbol_index` ~ligne 106) :

```cpp
// state : parse le visuel d'un cas/defaut. src valide -> image (w/h) ; sinon glyphe (symbol + couleur, blanc par defaut).
static void parse_state_visual(JsonVariantConst o, StateCase& sc) {
    const char* src = o["src"] | "";
    sc.has_src = bg_key_valid(src);
    if (sc.has_src) {
        strlcpy(sc.src, src, sizeof(sc.src));
        sc.w = o["w"] | 0; sc.h = o["h"] | 0;
        sc.symbol = 0; sc.color = 0xFFFFFF;
    } else {
        sc.src[0] = '\0'; sc.w = sc.h = 0;
        sc.symbol = icon_symbol_index(o["symbol"] | "bell");
        sc.color  = o["color"].is<const char*>() ? parse_hex_color(o["color"], 0xFFFFFF) : 0xFFFFFF;
    }
}
```

Puis, dans `dash_set_layout`, juste après le bloc `if (c.type == COMP_ICON) { ... }` (~ligne 228) :

```cpp
        if (c.type == COMP_STATE) {
            if (!o["font"].is<int>()) c.font = 64;             // state : defaut 64 (glyphes)
            c.state_match = strcmp(o["match"] | "exact", "range") == 0 ? STATE_RANGE : STATE_EXACT;
            parse_state_visual(o["default"], c.state_default);
            JsonArrayConst cs = o["cases"].as<JsonArrayConst>();
            for (JsonObjectConst s : cs) {
                if (c.state_case_count >= MAX_STATE_CASES) break;
                StateCase& sc = c.state_cases[c.state_case_count];
                JsonVariantConst k = s["key"];
                sc.has_num_key = k.is<double>() || k.is<int>();
                sc.key_num     = sc.has_num_key ? (k | 0.0) : 0.0;
                strlcpy(sc.key_str, sc.has_num_key ? "" : (const char*)(s["key"] | ""), sizeof(sc.key_str));
                sc.at          = s["at"] | 0.0f;
                parse_state_visual(s, sc);
                c.state_case_count++;
            }
        }
```

- [ ] **Step 7: Ajouter `apply_state` (push par id) + l'entrée `APPLY[]`**

Dans `src/dashboard.cpp`, près des autres `apply_*` (avant la table `APPLY[]`, ~ligne 483) :

```cpp
// state : num -> value (+ marque type num) ; string -> vstr (+ marque type str). Selection re-resolue au sync.
static void apply_state(Component& c, JsonVariantConst v) {
    JsonVariantConst n;
    if (!value_present(v, n)) return;
    if (n.is<const char*>()) { strlcpy(c.vstr, n.as<const char*>(), sizeof(c.vstr)); c.state_has_num = false; }
    else                     { c.value = n.as<int>(); c.state_has_num = true; }
}
```

Dans `APPLY[]`, après `/* COMP_SEGMENTED */ nullptr,` (~ligne 510) et **avant** l'accolade fermante :

```cpp
    /* COMP_STATE    */ apply_state,
```

- [ ] **Step 8: Ajouter le placeholder `VIEW[]` (provisoire, rempli en Tâche 3)**

Dans `src/view.cpp`, dans `VIEW[]`, après `/* COMP_SEGMENTED */ { build_segmented, sync_segmented },` (~ligne 905) et **avant** l'accolade fermante :

```cpp
    /* COMP_STATE    */ { nullptr,      nullptr      },   // rempli en Tache 3 (build_state/sync_state)
```

Ceci garde `pio run -e esp32s3` compilable (static_assert `VIEW` == `COMP_COUNT`) ; le composant ne rend rien tant que la Tâche 3 n'est pas faite.

- [ ] **Step 9: Lancer les tests natifs — vérifier qu'ils passent**

Run: `pio test -e native`
Expected: **PASS** — `test_state_parsed` vert (la table `APPLY` satisfait son static_assert).

- [ ] **Step 10: Vérifier la compilation firmware (placeholder)**

Run: `pio run -e esp32s3`
Expected: **SUCCESS** de compilation (state invisible, tables synchronisées).

- [ ] **Step 11: Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/view.cpp test/test_core/test_main.cpp
git commit -m "feat(state): type COMP_STATE, modele + parsing + apply_state (push par id)"
```

---

## Task 3 : Firmware — rendu LVGL `build_state`/`sync_state` + image à la demande

**Files:**
- Modify: `src/view.cpp` (helpers + builders près de `build_image` ~ligne 380 et `build_icon` ~ligne 569 ; entrée `VIEW[]` ~ligne 905)

Pas de test natif (LVGL non compilé en natif). Vérification = build esp32 + on-device (Tâche 8).

- [ ] **Step 1: Ajouter le loader d'image à la demande**

Dans `src/view.cpp`, après `img_load_component` (~ligne 1147), ajouter (mais utilisable par `build_state`/`sync_state` — le placer avant eux, ou en prototype en tête ; le plus simple : le définir juste avant `build_state`) :

```cpp
// state : charge /img/<src>.565a en PSRAM pour le composant idx (RGB565A8, w×h). Libere l'ancien buffer d'abord.
// Variante de img_load_component parametree par src/w/h (image du cas actif, chargee a la demande). false si invalide.
static bool state_load_image(int idx, const char* src, int w, int h) {
    if (idx < 0 || idx >= MAX_COMPONENTS) return false;
    if (s_img_buf[idx]) { heap_caps_free(s_img_buf[idx]); s_img_buf[idx] = nullptr; }
    if (!src || !src[0] || w <= 0 || h <= 0) return false;
    size_t need = (size_t)w * h * IMG_PX_BYTES;
    if (need == 0 || need > (size_t)IMG_MAX_BYTES) return false;
    char path[40];
    snprintf(path, sizeof(path), "%s/%s.565a", IMG_DIR, src);
    File f = asset_open_read(path);
    if (!f) return false;
    if ((size_t)f.size() != need) { f.close(); return false; }
    uint8_t* buf = (uint8_t*)heap_caps_malloc(need, MALLOC_CAP_SPIRAM);
    if (!buf) { f.close(); return false; }
    size_t rd = f.read(buf, need);
    f.close();
    if (rd != need) { heap_caps_free(buf); return false; }
    s_img_buf[idx] = buf;
    lv_image_dsc_t& dsc = s_img_dsc[idx];
    memset(&dsc, 0, sizeof(dsc));
    dsc.header.magic  = LV_IMAGE_HEADER_MAGIC;
    dsc.header.cf     = LV_COLOR_FORMAT_RGB565A8;
    dsc.header.stride = w * 2;
    dsc.header.w = w; dsc.header.h = h;
    dsc.data = buf; dsc.data_size = need;
    return true;
}
```

- [ ] **Step 2: Ajouter les helpers de visuel + `build_state`**

Toujours dans `src/view.cpp`, juste après `state_load_image` :

```cpp
// state : (re)cree l'enfant du conteneur selon le visuel resolu — lv_label glyphe (parite build_icon)
// ou lv_image bitmap (parite build_image). Met a jour l'etat de kind/src rendu.
static void state_make_child(lv_obj_t* cont, Component& c, int idx, const StateCase& v) {
    if (v.has_src) {
        lv_obj_t* img = lv_image_create(cont);
        if (state_load_image(idx, v.src, v.w, v.h)) {
            lv_image_set_src(img, &s_img_dsc[idx]);
            strlcpy(c.state_shown_src, v.src, sizeof(c.state_shown_src));
        } else {                                              // asset absent : placeholder borde a w×h
            lv_obj_set_size(img, v.w > 0 ? v.w : 120, v.h > 0 ? v.h : 120);
            lv_obj_set_style_border_width(img, 1, 0);
            lv_obj_set_style_border_color(img, lv_color_hex(0x4B5563), 0);
            lv_obj_set_style_border_opa(img, LV_OPA_COVER, 0);
            c.state_shown_src[0] = '\0';
        }
        lv_obj_center(img);
    } else {
        lv_obj_t* l = lv_label_create(cont);
        lv_obj_set_style_text_font(l, get_icon_font(c.font), 0);
        lv_obj_set_style_text_color(l, lv_color_hex(v.color), 0);
        lv_label_set_text(l, ICON_GLYPHS[v.symbol]);
        lv_obj_center(l);
        c.state_shown_src[0] = '\0';
    }
    c.state_shown_is_img = v.has_src;
}

// state : conteneur transparent hebergeant UN visuel choisi par la valeur (state_resolve). L'enfant est
// swappe au sync si le kind change (glyphe<->image).
static void build_state(lv_obj_t* parent, Component& c, Placement& q,
                        lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* cont = lv_obj_create(parent);
    lv_obj_remove_style_all(cont);                            // conteneur transparent (ni fond, ni bord, ni padding)
    lv_obj_set_size(cont, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    int idx = state_resolve(c.state_match, c.state_cases, c.state_case_count,
                            c.state_has_num, (double)c.value, c.vstr);
    const StateCase& v = (idx < 0) ? c.state_default : c.state_cases[idx];
    state_make_child(cont, c, q.comp_index, v);
    lv_obj_align(cont, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = cont;
}

// state : re-resout a chaque changement de valeur. Kind change -> detruit/recree l'enfant ; sinon maj en place.
static void sync_state(Component& c, Placement& q, lv_obj_t* main, lv_obj_t*, lv_obj_t*) {
    int idx = state_resolve(c.state_match, c.state_cases, c.state_case_count,
                            c.state_has_num, (double)c.value, c.vstr);
    const StateCase& v = (idx < 0) ? c.state_default : c.state_cases[idx];
    lv_obj_t* child = lv_obj_get_child(main, 0);
    if (!child || v.has_src != c.state_shown_is_img) {        // kind change (ou 1er) -> recree l'enfant
        lv_obj_clean(main);
        state_make_child(main, c, q.comp_index, v);
    } else if (v.has_src) {                                   // meme kind image : recharge SI src change
        if (strcmp(c.state_shown_src, v.src) != 0) {
            if (state_load_image(q.comp_index, v.src, v.w, v.h)) {
                lv_image_set_src(child, &s_img_dsc[q.comp_index]);
                strlcpy(c.state_shown_src, v.src, sizeof(c.state_shown_src));
            }
        }
    } else {                                                  // meme kind glyphe : maj texte + couleur en place
        lv_obj_set_style_text_color(child, lv_color_hex(v.color), 0);
        lv_label_set_text(child, ICON_GLYPHS[v.symbol]);
    }
}
```

> Note : `state_make_child`/`build_state`/`sync_state` doivent être définis **après** `state_load_image` et **après** `get_icon_font`/`ICON_GLYPHS` (déjà inclus en tête de `view.cpp`). Les placer juste avant la table `VIEW[]` évite tout souci d'ordre de déclaration.

- [ ] **Step 3: Remplacer le placeholder `VIEW[]`**

Dans `src/view.cpp`, remplacer la ligne placeholder de la Tâche 2 :

```cpp
    /* COMP_STATE    */ { nullptr,      nullptr      },   // rempli en Tache 3 (build_state/sync_state)
```

par :

```cpp
    /* COMP_STATE    */ { build_state,  sync_state   },
```

- [ ] **Step 4: Compiler le firmware**

Run: `pio run -e esp32s3`
Expected: **SUCCESS** — pas d'erreur ; `build_state`/`sync_state` référencés par `VIEW[]`.

- [ ] **Step 5: Re-lancer les tests natifs (non-régression)**

Run: `pio test -e native`
Expected: **PASS** (view.cpp non compilé en natif ; aucun test cassé).

- [ ] **Step 6: Commit**

```bash
git add src/view.cpp
git commit -m "feat(state): rendu LVGL build/sync_state + image cas actif chargee a la demande"
```

---

## Task 4 : Firmware — propagation de la valeur via `context_apply` (bind)

**Files:**
- Modify: `src/dashboard.cpp` (`switch` de `context_apply` ~ligne 613)
- Test: `test/test_core/test_main.cpp` (près de `test_state_parsed` ; `RUN_TEST` après `test_state_parsed`)

- [ ] **Step 1: Écrire le test de propagation qui échoue**

Dans `test/test_core/test_main.cpp`, après `test_state_parsed` :

```cpp
void test_state_context(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE_MESSAGE(dash_set_layout(&d, LAYOUT_STATE, err, sizeof(err)), err);
    int s1 = dash_find(&d, "s1");

    // string "Rain" via le contexte -> vstr = "Rain", type string, dirty
    ctx_set_str(&d.ctx, "weather", "Rain", 1000);
    context_apply(&d);
    TEST_ASSERT_EQUAL_STRING("Rain", d.components[s1].vstr);
    TEST_ASSERT_FALSE(d.components[s1].state_has_num);
    TEST_ASSERT_TRUE(d.components[s1].dirty);
    TEST_ASSERT_EQUAL_INT(1, state_resolve(d.components[s1].state_match, d.components[s1].state_cases,
        d.components[s1].state_case_count, d.components[s1].state_has_num,
        (double)d.components[s1].value, d.components[s1].vstr));   // cas "Rain"

    // nombre 3 via le contexte -> value = 3, type num
    ctx_set_num(&d.ctx, "weather", 3, 2000);
    context_apply(&d);
    TEST_ASSERT_EQUAL_INT(3, d.components[s1].value);
    TEST_ASSERT_TRUE(d.components[s1].state_has_num);
    TEST_ASSERT_EQUAL_INT(2, state_resolve(d.components[s1].state_match, d.components[s1].state_cases,
        d.components[s1].state_case_count, d.components[s1].state_has_num,
        (double)d.components[s1].value, d.components[s1].vstr));   // cas image (key 3)
}
```

> **Avant d'écrire :** vérifier les noms exacts des helpers de contexte utilisés par les autres tests (`ctx_set_str`/`ctx_set_num` ou équivalents). Chercher dans `test/test_core/test_main.cpp` un test existant qui pousse une variable de contexte (p. ex. autour des tests `context`/`readout` bindés) et réutiliser **la même** API. Adapter les deux lignes `ctx_set_*` ci-dessus au nom réel (ne pas inventer).

Enregistrer dans `main()`, après `RUN_TEST(test_state_parsed);` :

```cpp
    RUN_TEST(test_state_context);
```

- [ ] **Step 2: Lancer le test — vérifier qu'il échoue**

Run: `pio test -e native`
Expected: **FAIL** — `context_apply` ne met pas à jour un `COMP_STATE` (tombe dans `default: break;`), les assertions échouent.

- [ ] **Step 3: Ajouter le `case COMP_STATE` dans `context_apply`**

Dans `src/dashboard.cpp`, dans le `switch (c.type)` de `context_apply` (~ligne 613), à côté des autres `case` (p. ex. après `case COMP_QR:`) :

```cpp
            case COMP_STATE:                            // num -> value ; str -> vstr ; retient le type pour le match
                if (v.type == CTX_NUM) {
                    int32_t nv = (int32_t)v.num;
                    if (c.value != nv || !c.state_has_num) { c.value = nv; c.state_has_num = true; changed = true; }
                } else if (v.type == CTX_STR) {
                    if (strncmp(c.vstr, v.str, sizeof(c.vstr)) != 0 || c.state_has_num) {
                        strlcpy(c.vstr, v.str, sizeof(c.vstr)); c.state_has_num = false; changed = true;
                    }
                }
                break;
```

- [ ] **Step 4: Lancer le test — vérifier qu'il passe**

Run: `pio test -e native`
Expected: **PASS** — `test_state_context` vert.

- [ ] **Step 5: Compiler le firmware (non-régression)**

Run: `pio run -e esp32s3`
Expected: **SUCCESS**.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard.cpp test/test_core/test_main.cpp
git commit -m "feat(state): propagation via context_apply (bind num/str) + test natif"
```

---

## Task 5 : Designer — `resolveState` (pur) + `buildState` (DOM) + `MOCKS.state`

**Files:**
- Modify: `designer/js/render.js` (`MOCKS` ~ligne 14 ; `resolveState`/`buildState` près de `resolveIcon`/`buildIcon` ~ligne 591)
- Test: `designer/tests/render.test.js` (import ~ligne 5 ; tests près de ceux de `resolveIcon` ~ligne 180)

- [ ] **Step 1: Écrire les tests `resolveState` qui échouent**

Dans `designer/tests/render.test.js`, ajouter `resolveState` à l'import depuis `../js/render.js` (~ligne 5, à côté de `resolveIcon`) :

```javascript
  resolveIcon, resolveState
```

Puis, après les tests `resolveIcon` (~ligne 180) :

```javascript
test('resolveState : exact string -> index du cas a cle string egale, sinon -1', () => {
  const comp = { match: 'exact', cases: [
    { key: 'Clear', symbol: 'weather-sunny' },
    { key: 'Rain', symbol: 'weather-pouring' },
    { key: 3, src: 'abc' }] };
  assert.equal(resolveState(comp, 'Clear'), 0);
  assert.equal(resolveState(comp, 'Rain'), 1);
  assert.equal(resolveState(comp, 'Snow'), -1);              // aucune -> defaut
});

test('resolveState : exact number -> index du cas a cle numerique egale', () => {
  const comp = { match: 'exact', cases: [
    { key: 'Clear', symbol: 'weather-sunny' },
    { key: 3, src: 'abc' }] };
  assert.equal(resolveState(comp, 3), 1);
  assert.equal(resolveState(comp, 9), -1);
});

test('resolveState : range -> 1er cas ou value < at (numerique seul)', () => {
  const comp = { match: 'range', cases: [{ at: 10 }, { at: 20 }] };
  assert.equal(resolveState(comp, 5), 0);
  assert.equal(resolveState(comp, 15), 1);
  assert.equal(resolveState(comp, 25), -1);
  assert.equal(resolveState(comp, 'x'), -1);                 // string en range -> defaut
});

test('resolveState : doublon -> l ordre departage (1er gagne)', () => {
  const comp = { match: 'exact', cases: [{ key: 'A', symbol: 'x' }, { key: 'A', symbol: 'y' }] };
  assert.equal(resolveState(comp, 'A'), 0);
});

test('resolveState : match par defaut = exact ; cases absent -> -1', () => {
  assert.equal(resolveState({}, 'anything'), -1);
});
```

- [ ] **Step 2: Lancer les tests — vérifier qu'ils échouent**

Run: `cd designer && node --test`
Expected: **FAIL** — `render.js` n'exporte pas `resolveState` (erreur de link du module ES → les tests de `render.test.js` ne chargent pas).

- [ ] **Step 3: Implémenter `resolveState`**

Dans `designer/js/render.js`, juste après `resolveIcon` (~ligne 591) :

```javascript
// Résolveur PUR (miroir firmware state_resolve) : rend l'index du cas actif ou -1 (défaut).
// exact : selon le type de la valeur (number ↔ clé number ; string ↔ clé string). range : numérique seul, 1er value < at.
export function resolveState(comp, value) {
  const cases = comp.cases || [];
  const match = comp.match || 'exact';
  const isNum = typeof value === 'number';
  if (match === 'range') {
    if (!isNum) return -1;                            // range = numérique seul ; string -> défaut
    for (let i = 0; i < cases.length; i++) if (value < cases[i].at) return i;
    return -1;
  }
  for (let i = 0; i < cases.length; i++) {            // exact : 1er match selon le type de la valeur
    const k = cases[i].key;
    if (isNum) { if (typeof k === 'number' && k === value) return i; }
    else       { if (typeof k !== 'number' && String(k) === String(value)) return i; }
  }
  return -1;
}
```

- [ ] **Step 4: Ajouter `MOCKS.state`**

Dans `designer/js/render.js`, dans l'objet `MOCKS` (~ligne 27, après `segmented: { value: 0 }`) — ajouter la virgule sur la ligne précédente si besoin :

```javascript
  state:   { value: 0 }
```

- [ ] **Step 5: Implémenter `buildState` (DOM, parité `buildIcon`/`buildImage`)**

Dans `designer/js/render.js`, juste après `buildIcon` (~ligne 607) :

```javascript
// State : affiche UN visuel (glyphe ou image) choisi par la valeur mock (resolveState). Parité firmware
// build/sync_state : glyphe = <i class="mdi"> (comme buildIcon) ; image = <img> previewUrl (comme buildImage).
export function buildState(comp, mock = MOCKS.state) {
  const idx = resolveState(comp, mock.value);
  const cases = comp.cases || [];
  const vis = idx < 0 ? (comp.default || {}) : cases[idx];
  if (vis.src) {                                       // visuel image (miroir buildImage)
    const wrap = document.createElement('div');
    wrap.className = 'w w-image';
    wrap.style.width  = (vis.w || 120) + 'px';
    wrap.style.height = (vis.h || 120) + 'px';
    const url = previewUrl(vis.src);
    if (url) {
      const img = document.createElement('img');
      img.className = 'w-image-img';
      img.src = url;
      img.style.width = '100%'; img.style.height = '100%';
      img.style.display = 'block'; img.style.objectFit = 'fill';
      wrap.appendChild(img);
    } else {
      wrap.classList.add('w-image--empty');
    }
    return wrap;
  }
  const px = pickFontPx(comp.font ?? 64);              // visuel glyphe (miroir buildIcon)
  const n = document.createElement('div');
  n.className = 'w w-icon';
  n.style.width = px + 'px';
  n.style.height = px + 'px';
  n.style.color = vis.color || '#FFFFFF';
  const i = document.createElement('i');
  i.className = 'mdi';
  i.style.fontSize = px + 'px';
  i.textContent = ICON_CHAR[vis.symbol] || ICON_CHAR.bell || '';
  n.appendChild(i);
  return n;
}
```

- [ ] **Step 6: Lancer les tests — vérifier qu'ils passent**

Run: `cd designer && node --test`
Expected: **PASS** — les 5 tests `resolveState` verts ; aucun autre test cassé. (`buildState` n'est pas testé en node — DOM browser-verified, cf. mémoire `designer-tests-dom-builders`.)

- [ ] **Step 7: Commit**

```bash
git add designer/js/render.js designer/tests/render.test.js
git commit -m "feat(state/designer): resolveState pur + buildState (parite icon/image) + tests node"
```

---

## Task 6 : Designer — schéma `comp_state` + entrée registre + i18n (parité)

**Files:**
- Modify: `schema/layout.schema.json` (`component.oneOf` ~ligne 133 ; nouveaux `$defs/comp_state` + `$defs/state_case` à côté de `comp_icon`/`icon_state` ~ligne 836)
- Modify: `designer/js/registry.js` (import ~ligne 11 ; entrée `state` à côté de `icon`/`image` ~ligne 172)
- Modify: `designer/i18n/en.js` + `designer/i18n/fr.json`
- Test: `designer/tests/registry.test.js` (nouveau test `state` près du test `icon` ~ligne 135)

- [ ] **Step 1: Écrire le test de registre `state` qui échoue**

Dans `designer/tests/registry.test.js`, après le test `icon` (~ligne 135) :

```javascript
test('registre : state déclaré, non physique, defaults exact/font 64/défaut cloudy', () => {
  assert.ok(COMPONENTS.state, 'state absent du registre');
  assert.equal(COMPONENTS.state.physical, false);
  assert.equal(COMPONENTS.state.centered, false);
  const cf = COMPONENTS.state.compFields.map(f => f[0]);
  for (const k of ['font', 'bind']) assert.ok(cf.includes(k), `state : ${k} manquant`);
  const d = COMPONENTS.state.defaults();
  assert.equal(d.type, 'state');
  assert.equal(d.match, 'exact');
  assert.equal(d.font, 64);
  assert.equal(d.default.symbol, 'weather-cloudy');
  assert.deepEqual(d.cases, []);
});
```

- [ ] **Step 2: Lancer les tests — constater l'échec de parité (registre↔schéma) + registre `state`**

Run: `cd designer && node --test`
Expected: **FAIL** — `registry.test.js` : `COMPONENTS.state` absent (nouveau test) **et** la parité registre↔schéma échouera dès que le schéma aura `comp_state` (à l'inverse, si on ajoute le registre d'abord, la parité échoue côté schéma). On ajoute les **deux** côtés dans cette tâche pour finir vert.

- [ ] **Step 3: Ajouter `$defs/state_case` au schéma**

Dans `schema/layout.schema.json`, à côté de `$defs/icon_state` (~ligne 821) :

```json
    "state_case": {
      "type": "object",
      "additionalProperties": false,
      "description": "Un cas de state : matcher (key exact string|nombre ; ou at pour le mode range) + visuel (glyphe symbol/color XOR image src/w/h ; kind infere par le champ present). Sert aussi de forme au visuel 'default' (matcher ignore).",
      "properties": {
        "key": { "type": ["string", "number"], "description": "Cle exacte (mode exact). String -> compare aux valeurs string ; nombre -> aux valeurs numeriques." },
        "at": { "type": "number", "description": "Borne haute exclusive (mode range) : cas choisi si value < at. Cas ordonnes." },
        "symbol": { "$ref": "#/$defs/symbolName", "description": "Glyphe MDI (visuel glyphe). Defaut bell." },
        "color": { "$ref": "#/$defs/hexColor", "description": "Couleur du glyphe. Defaut #FFFFFF." },
        "src": { "$ref": "#/$defs/ascii", "description": "Cle d'asset image (visuel image ; present => image au lieu de glyphe)." },
        "w": { "type": "integer", "minimum": 1, "maximum": 360, "description": "Largeur de l'image (px). Defaut 120." },
        "h": { "type": "integer", "minimum": 1, "maximum": 360, "description": "Hauteur de l'image (px). Defaut 120." }
      }
    },
```

- [ ] **Step 4: Ajouter `$defs/comp_state` au schéma**

Dans `schema/layout.schema.json`, à côté de `$defs/comp_icon` (~ligne 836) :

```json
    "comp_state": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "description": "Selecteur de visuel pilote par la valeur : affiche UN visuel (glyphe MDI ou image bitmap) choisi parmi des cas selon la valeur (bind ou push par id). Matching exact (cle string/nombre) ou range (seuils). default = visuel affiche si aucun cas ne matche (garantit un rendu avant le 1er /update).",
      "properties": {
        "type": { "const": "state" },
        "visible": { "type": "boolean", "description": "Affiche le composant (defaut true). false = cache (LV_OBJ_FLAG_HIDDEN). Pilotable via /update {\"<id>\":{\"visible\":true}}." },
        "bind": { "$ref": "#/$defs/id", "description": "Nom d'une variable du contexte (pull). Present = lit la variable ; absent = push par id (defaut)." },
        "match": { "enum": ["exact", "range"], "description": "Mode de selection. exact = egalite de cle (string ou nombre selon le type de la valeur) ; range = 1er cas ou value < at (numerique seul). Defaut exact." },
        "font": { "$ref": "#/$defs/font", "description": "Taille des glyphes (cas glyphe). Defaut 64." },
        "default": { "$ref": "#/$defs/state_case", "description": "Visuel affiche si aucun cas ne matche (matcher ignore)." },
        "cases": { "type": "array", "items": { "$ref": "#/$defs/state_case" }, "description": "Cas (matcher + visuel), evalues dans l'ordre. Limite firmware MAX_STATE_CASES=16." }
      }
    },
```

- [ ] **Step 5: Enregistrer `comp_state` dans `component.oneOf`**

Dans `schema/layout.schema.json`, dans `$defs.component.oneOf` (~ligne 133), après `{ "$ref": "#/$defs/comp_qr" }` — ajouter la virgule sur la ligne précédente si besoin :

```json
        { "$ref": "#/$defs/comp_state" }
```

- [ ] **Step 6: Importer `buildState` et ajouter l'entrée `state` au registre**

Dans `designer/js/registry.js`, ajouter `buildState` à l'import de `./render.js` (~ligne 11, à côté de `buildIcon`) :

```javascript
buildIcon, buildState,
```

Puis, à côté de l'entrée `icon` (~ligne 172) :

```javascript
  state: {
    label: 'comp.state',
    defaults: () => ({ type: 'state', match: 'exact', font: 64,
      default: { symbol: 'weather-cloudy', color: '#9AA0AA' }, cases: [] }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['font', 'field.font_size', 'font'], ['bind', 'field.bind', 'idtext']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num']],
    mockFields: [],
    build: (comp, _pl, mock) => buildState(comp, mock),
  },
```

> `match`, la table de cas, le visuel par défaut et le mock sont **bespoke** (Tâche 7) — pas dans `compFields`. `mockFields: []` : la valeur d'aperçu de `state` est un champ texte bespoke (num ou string) rendu dans le bloc inspecteur, la section mock générique (kind `num`) ne convient pas.

- [ ] **Step 7: Ajouter les clés i18n (EN + FR, parité stricte)**

Dans `designer/i18n/en.js`, près de `'comp.icon'` (~ligne 179) et des `field.*`/`inspector.*` correspondants, ajouter :

```javascript
  'comp.state': 'State',
  'field.match': 'Match mode',
  'inspector.sec.cases': 'Cases',
  'inspector.sec.state_default': 'Default visual',
  'inspector.opt.exact': 'Exact',
  'inspector.opt.range': 'Range',
  'inspector.opt.glyph': 'Glyph',
  'inspector.opt.image': 'Image',
  'inspector.field.key': 'Key',
  'inspector.field.at': 'Threshold (<)',
  'inspector.btn.add_case': '+ case',
  'inspector.note.state_cases': 'First matching case wins; none → default. Range: numeric, first value < threshold.',
```

Dans `designer/i18n/fr.json`, les **mêmes clés** avec les traductions :

```json
  "comp.state": "État",
  "field.match": "Mode de correspondance",
  "inspector.sec.cases": "Cas",
  "inspector.sec.state_default": "Visuel par défaut",
  "inspector.opt.exact": "Exact",
  "inspector.opt.range": "Plage",
  "inspector.opt.glyph": "Glyphe",
  "inspector.opt.image": "Image",
  "inspector.field.key": "Clé",
  "inspector.field.at": "Seuil (<)",
  "inspector.btn.add_case": "+ cas",
  "inspector.note.state_cases": "1er cas qui matche gagne ; aucun → défaut. Plage : numérique, 1er value < seuil.",
```

> ⚠️ Vérifier l'emplacement exact (regrouper avec les clés voisines `comp.*`, `field.*`, `inspector.*`) et respecter la syntaxe : `en.js` = objet JS (`'clé': 'valeur',`), `fr.json` = JSON (`"clé": "valeur",`), sans virgule finale traînante en JSON. Ne pas laisser de clé orpheline d'un seul côté (test de parité EN↔FR).

- [ ] **Step 8: Lancer tous les tests designer**

Run: `cd designer && node --test`
Expected: **PASS** — parité registre↔schéma OK (`state` des deux côtés), test registre `state` vert, parité i18n EN↔FR verte.

- [ ] **Step 9: Commit**

```bash
git add schema/layout.schema.json designer/js/registry.js designer/i18n/en.js designer/i18n/fr.json designer/tests/registry.test.js
git commit -m "feat(state/designer): schema comp_state + entree registre + i18n (parite)"
```

---

## Task 7 : Designer — inspecteur bespoke (cases, éditeur de visuel, défaut, `match`, mock)

**Files:**
- Modify: `designer/js/mutations.js` (à côté de `setIconStates` ~ligne 116)
- Modify: `designer/js/inspector.js` (bloc bespoke à côté du bloc états `icon` ~ligne 287 ; imports ~ligne 6-11)

Browser-verified (les builders DOM ne sont pas testés en node, cf. mémoire `designer-tests-dom-builders`). Vérification = `node --test` toujours vert (non-régression) + QA navigateur (Step 6). Respecter les **invariants inspecteur/canvas** (CLAUDE.md) : `ref` figée au rendu, commit sur `change`, coalescence num, `blur()`/`clearPreview` au bon moment, closures de commit qui figent `sel.ref`.

- [ ] **Step 1: Ajouter les mutations `setStateCases`/`setStateDefault`/`setStateMatch`**

Dans `designer/js/mutations.js`, après `setIconStates` (~ligne 116) :

```javascript
// state : tableau de cas {key|at, symbol?/color? | src/w/h}. Vide => supprime la cle.
export function setStateCases(state, id, cases) {
  const c = state.components[id];
  if (!c) return;
  if (cases && cases.length) c.cases = cases;
  else delete c.cases;
}
// state : visuel par defaut (glyphe {symbol,color} | image {src,w,h}).
export function setStateDefault(state, id, visual) {
  const c = state.components[id];
  if (!c) return;
  c.default = visual;
}
// state : mode de correspondance ('exact' | 'range').
export function setStateMatch(state, id, match) {
  const c = state.components[id];
  if (!c) return;
  c.match = match;
}
```

- [ ] **Step 2: Vérifier les imports de l'inspecteur**

Dans `designer/js/inspector.js`, s'assurer que sont importés (déjà présents pour la plupart) : `ICON_CHAR`, `openIconPicker`, `imageFileToAsset`, `previewUrl as imagePreviewUrl`, `getMock`, `setMock`, `setComponentProp`, et **ajouter** les nouvelles mutations :

```javascript
import { /* … existant … */ setStateCases, setStateDefault, setStateMatch } from './mutations.js';
```

(Vérifier la ligne d'import de `./mutations.js` ~ligne 3-5 et y ajouter les trois noms. `getMock`/`setMock` viennent de `./mocks.js` ~ligne cf. section mock générique.)

- [ ] **Step 3: Écrire le bloc bespoke `state` dans `render()`**

Dans `designer/js/inspector.js`, juste après le bloc `if (c.type === 'icon') { … }` (~ligne 287), ajouter le bloc suivant. Il rend, dans l'ordre : le select `match`, l'éditeur du visuel par défaut, la table des cas, et le champ mock (valeur d'aperçu).

```javascript
    // --- State : match + cases (matcher + visuel) + visuel par defaut + mock. Invariants : ref figee,
    //     commit sur change, coalescence num, clearPreview avant commit couleur. ---
    if (c.type === 'state') {
      const ref = sel.ref;                                   // figée au rendu (cf. invariant inspecteur)

      // Editeur de visuel reutilisable (bascule glyphe|image). `get`/`set` lisent/ecrivent un objet visuel.
      // onCommit(visual) est appele apres toute modif. `keyRow` (optionnel) = element de matcher a prefixer.
      const visualEditor = (visual, onCommit) => {
        const wrap = document.createElement('div'); wrap.className = 'insp-row insp-state-visual';
        const isImg = () => !!visual.src;
        // Bascule glyphe|image
        const toggle = document.createElement('select'); toggle.className = 'insp-state-kind';
        for (const [val, key] of [['glyph', 'inspector.opt.glyph'], ['image', 'inspector.opt.image']]) {
          const o = document.createElement('option'); o.value = val; o.textContent = t(key); toggle.appendChild(o);
        }
        toggle.value = isImg() ? 'image' : 'glyph';
        const slot = document.createElement('span'); slot.className = 'insp-state-visualslot';
        const renderSlot = () => {
          slot.textContent = '';
          if (isImg()) {
            // Picker d'asset image (reutilise imageFileToAsset ; commit de src/w/h)
            const file = document.createElement('input');
            file.type = 'file'; file.accept = 'image/*'; file.className = 'insp-bg-file';
            file.addEventListener('change', async () => {
              const f = file.files?.[0]; if (!f) return;
              try {
                const { key } = await imageFileToAsset(f, ref, visual.w || 120, visual.h || 120);
                visual.src = key; visual.w = visual.w || 120; visual.h = visual.h || 120;
                delete visual.symbol; delete visual.color;
                onCommit(visual);
              } catch (e) { console.error('state image:', e); }
              file.value = '';
            });
            const pick = document.createElement('button');
            pick.type = 'button'; pick.className = 'insp-iconbtn'; pick.textContent = '📁';
            pick.title = visual.src ? t('inspector.tip.change_image') : t('inspector.tip.pick_image');
            pick.addEventListener('click', () => file.click());
            slot.append(file, pick);
            if (visual.src) {
              const thumb = document.createElement('img'); thumb.className = 'insp-bg-thumb';
              const u = imagePreviewUrl(visual.src);
              if (u) thumb.src = u; else thumb.alt = t('inspector.alt.reload_device');
              slot.appendChild(thumb);
            }
          } else {
            // Picker MDI (reutilise openIconPicker) + couleur
            const symBtn = document.createElement('button');
            symBtn.type = 'button'; symBtn.className = 'insp-iconbtn';
            const g = document.createElement('i'); g.className = 'mdi';
            g.textContent = visual.symbol ? (ICON_CHAR[visual.symbol] || '') : '';
            const nm = document.createElement('span'); nm.className = 'insp-iconbtn-name';
            nm.textContent = visual.symbol || 'bell';
            symBtn.append(g, nm);
            symBtn.addEventListener('click', () => openIconPicker({
              current: visual.symbol || 'bell',
              onPick: name => { if (name) { visual.symbol = name; delete visual.src; delete visual.w; delete visual.h; onCommit(visual); } },
            }));
            const col = document.createElement('input'); col.type = 'color';
            col.value = visual.color || '#FFFFFF';
            col.addEventListener('change', () => { clearPreview?.(); visual.color = col.value.toUpperCase(); onCommit(visual); });
            slot.append(symBtn, col);
          }
        };
        toggle.addEventListener('change', () => {
          if (toggle.value === 'image') { delete visual.symbol; delete visual.color; visual.src = visual.src || ''; visual.w = visual.w || 120; visual.h = visual.h || 120; }
          else { delete visual.src; delete visual.w; delete visual.h; visual.symbol = visual.symbol || 'bell'; }
          renderSlot(); onCommit(visual);
        });
        renderSlot();
        wrap.append(toggle, slot);
        return wrap;
      };

      // 1) Select match (exact|range)
      const { sec: mSec, body: mBody } = section(t('field.match'));
      const matchSel = document.createElement('select'); matchSel.className = 'insp-state-match';
      for (const [val, key] of [['exact', 'inspector.opt.exact'], ['range', 'inspector.opt.range']]) {
        const o = document.createElement('option'); o.value = val; o.textContent = t(key); matchSel.appendChild(o);
      }
      matchSel.value = c.match || 'exact';
      matchSel.addEventListener('change', () => model.commit(s => setStateMatch(s, ref, matchSel.value)));
      mBody.appendChild(fieldRow(t('field.match'), matchSel));
      body.appendChild(mSec);

      // 2) Visuel par defaut
      const { sec: dSec, body: dBody } = section(t('inspector.sec.state_default'));
      const dVisual = { ...(c.default || { symbol: 'weather-cloudy', color: '#9AA0AA' }) };
      dBody.appendChild(visualEditor(dVisual, v => model.commit(s => setStateDefault(s, ref, { ...v }))));
      body.appendChild(dSec);

      // 3) Table des cas
      const { sec: cSec, body: cBody } = section(t('inspector.sec.cases'));
      note(cBody, t('inspector.note.state_cases'));
      const cases = (c.cases || []).map(x => ({ ...x }));
      const commitCases = (opts) => model.commit(s => setStateCases(s, ref, cases.map(x => ({ ...x }))), opts);
      cases.forEach((cas, idx) => {
        const row = document.createElement('div'); row.className = 'insp-row insp-state-case';
        // Matcher : key (exact) ou at (range)
        let matcher;
        if ((c.match || 'exact') === 'range') {
          matcher = makeInput('num', cas.at, v => { cases[idx].at = v === '' ? 0 : v; delete cases[idx].key; commitCases({ coalesce: 'num' }); });
        } else {
          matcher = makeInput('text', cas.key ?? '', v => {
            // Nombre pur -> cle numerique (branche num) ; sinon string.
            const num = v !== '' && !isNaN(Number(v)) ? Number(v) : null;
            cases[idx].key = num != null ? num : v; delete cases[idx].at; commitCases();
          });
        }
        // Editeur de visuel du cas
        const vis = visualEditor(cas, v => { cases[idx] = { ...cases[idx], ...v }; commitCases(); });
        const rm = document.createElement('button'); rm.className = 'insp-th-rm'; rm.textContent = '×';
        rm.addEventListener('click', () => { cases.splice(idx, 1); commitCases(); });
        row.append(matcher, vis, rm);
        cBody.appendChild(row);
      });
      const add = document.createElement('button'); add.className = 'insp-th-add'; add.textContent = t('inspector.btn.add_case');
      add.addEventListener('click', () => { cases.push((c.match || 'exact') === 'range' ? { at: 0, symbol: 'bell' } : { key: '', symbol: 'bell' }); commitCases(); });
      cBody.appendChild(add);
      body.appendChild(cSec);

      // 4) Mock (valeur d'apercu) : texte libre ; nombre pur -> branche num, sinon string (miroir firmware).
      const { sec: mkSec, body: mkBody } = section(t('inspector.sec.mock'), true);
      const m = getMock(ref, 'state');
      const mockInput = makeInput('text', m.value ?? '', v => {
        const num = v !== '' && !isNaN(Number(v)) ? Number(v) : v;
        setMock(ref, { value: num });
        rerenderCanvas && rerenderCanvas();
      });
      mkBody.appendChild(fieldRow(t('field.mock_value'), mockInput));
      body.appendChild(mkSec);
    }
```

> **Notes de style / conformité :**
> - `section(...)`, `note(...)`, `fieldRow(...)`, `makeInput(...)`, `model.commit(...)` : réutiliser les helpers **existants** de `inspector.js` (mêmes signatures que le bloc `icon`). Vérifier `makeInput` accepte le kind `'text'` — sinon utiliser le kind texte réellement disponible (le bloc `icon` n'utilise que `'num'`). Adapter au besoin (Rule 11 : ne pas inventer de kind).
> - `section(title, collapsed?)` : le 2e argument `true` (replié) est utilisé par la section mock générique (~ligne 291) — le réutiliser pour le mock.
> - Le `visualEditor` mute un objet local `visual`/`cas` puis appelle `onCommit` → `model.commit` fige `ref`. C'est l'invariant « closures de commit figent `sel.ref` ».
> - Couleur : `clearPreview?.()` avant d'écrire `visual.color` puis commit (pas d'aperçu live transitoire ici — commit direct sur `change`, suffisant pour brique 1).

- [ ] **Step 4: Lancer les tests designer (non-régression)**

Run: `cd designer && node --test`
Expected: **PASS** — aucun test cassé (le bloc inspecteur est du DOM, non testé en node ; la logique pure reste `resolveState`).

- [ ] **Step 5: Servir le designer et vérifier au navigateur**

Servir en no-store depuis la racine du repo (cf. mémoire `designer-verif-navigateur`), p. ex. sur un port libre ≠ 8000 :

```bash
cd /Users/jean-paulgavini/Documents/Dev/Dialboard && python3 -m http.server 8123 --bind 127.0.0.1
```

Ouvrir `http://127.0.0.1:8123/designer/index.html`. **Toujours arrêter le serveur après (mémoire `test-server-hygiene`).**

- [ ] **Step 6: QA navigateur — checklist (piloter avec de vrais events pointer, pas `.click()`)**

Vérifier :
- Palette : `state` présent ; drag → placement sur le disque ; sélection ouvre l'inspecteur.
- Select `match` : bascule exact↔range ; en `range` le matcher de chaque cas devient un champ seuil `at`, en `exact` un champ `key`.
- Visuel par défaut : bascule glyphe↔image ; picker MDI (glyphe) ; picker d'asset (image) + miniature.
- Table de cas : `+ cas` ajoute une ligne ; `×` supprime ; chaque cas a son matcher + son éditeur de visuel ; un cas glyphe et un cas image coexistent.
- Mock : saisir `Clear` (string) → le canvas montre le glyphe/couleur du cas `Clear` ; saisir `3` (nombre) → montre le cas à clé numérique 3 ; valeur non matchée → le visuel par défaut.
- Bascule de kind au canvas : changer le mock d'un cas glyphe vers un cas image change bien le rendu.
- Undo/redo : ajout/suppression de cas, changement de symbole/couleur → une entrée d'undo cohérente ; les flèches d'un champ num (seuil) = une seule entrée (coalescence).
- Aucune erreur console.

Consigner le résultat dans `docs/_internal/designer-qa-report.md` (comme les autres invariants).

- [ ] **Step 7: Commit**

```bash
git add designer/js/inspector.js designer/js/mutations.js
git commit -m "feat(state/designer): inspecteur bespoke (cases, editeur de visuel, defaut, match, mock)"
```

---

## Task 8 : Vérification on-device (météo pilotée string + code numérique)

**Files:** aucun code ; vérification d'intégration.

⚠️ `uploadfs` **efface** les assets device (mémoire `uploadfs-efface-assets-device`) — sauvegarder les assets device avant flash si besoin. `stage_fs.sh` stage `designer/`+`schema/`+`layout.json` (mémoire).

- [ ] **Step 1: Préparer un layout de démonstration `state`**

Créer un layout avec deux composants `state` : `sky` (météo pilotée par une variable de condition **string**, mode `exact`, cases glyphe + une image), `temp_state` (pilotée par un **code numérique**, mode `range`). S'appuyer sur le designer pour le produire (export layout) ou écrire le JSON à la main conforme au schéma. Uploader une petite image bitmap (via l'inspecteur en glyphe→image) pour au moins un cas.

- [ ] **Step 2: Flasher firmware + FS**

```bash
pio run -e esp32s3 -t upload
bash tools/stage_fs.sh
pio run -e esp32s3 -t uploadfs
```

- [ ] **Step 3: Pousser des valeurs et vérifier le rendu (captures)**

Piloter via `POST /update` (cf. mémoire `verif-on-device-screenshots` : `GET /screenshot` → PNG) et/ou via une variable de contexte bindée :

```bash
# état string (mode exact) : glyphe attendu
curl -s -X POST http://<device-ip>/update -d '{"sky":"Clear"}'
curl -s -X POST http://<device-ip>/update -d '{"sky":"Rain"}'
curl -s -X POST http://<device-ip>/update -d '{"sky":"Snow"}'   # cas image
# code numérique (mode range) : seuils
curl -s -X POST http://<device-ip>/update -d '{"temp_state":5}'
curl -s -X POST http://<device-ip>/update -d '{"temp_state":25}'
```

Vérifier :
- Avant tout `/update` : le **visuel par défaut** s'affiche.
- `sky` : bon glyphe/couleur par condition ; bascule glyphe→**image** pour le cas image (chargement PSRAM à la demande) et retour glyphe sans artefact.
- `temp_state` : bon cas selon la bande `value < at`.
- Parité visuelle avec le designer (glyphe/couleur/taille, image w×h).

- [ ] **Step 4: Checkpoint final**

Confirmer : tests natifs verts (`pio test -e native`), build esp32 vert (`pio run -e esp32s3`), tests designer verts (`cd designer && node --test`), QA navigateur OK (Tâche 7), rendu on-device conforme. Mettre à jour `docs/_internal/HANDOFF.md` (état : brique 1 `state` livrée ; brique 2 `scene`/animations = cycle séparé, cf. spec §2).

---

## Self-review (checklist du rédacteur)

**Couverture de la spec :**
- §4 modèle (`bind`/`match`/`font`/`default`/`cases`, matcher `key`/`at`, visuel `symbol`+`color` XOR `src`+`w`+`h`, `MAX_STATE_CASES`=16) → Tâches 1-2 (firmware), 6 (schéma/registre). ✓
- §5 sémantique `state_resolve` (exact string/num, range, défaut, doublon, string-en-range) → Tâche 1 (firmware) + Tâche 5 (designer), tests miroir. ✓
- §6 propagation (`context_apply` CTX_NUM/CTX_STR, dernier type reçu, push par id) → Tâches 2 (`apply_state`) + 4 (`context_apply`). ✓
- §7 rendu (conteneur + enfant, glyphe réutilise `icon`, image réutilise pipeline `image`, swap au changement de kind, image à la demande) → Tâche 3. ✓
- §8 designer (registre zone « Rich »/près de icon/image, `buildState` miroir, table de cas, éditeur de visuel glyphe|image, picker MDI #42, picker d'asset, éditeur `default`, select `match`, schéma + parité) → Tâches 5-7. ✓
- §10 tests (natif `state_resolve` + parsing ; designer résolution pure + parité registre↔schéma ; browser-verified ; on-device) → Tâches 1,2,4,5,6,7,8. ✓
- §11 décisions figées (nouveau composant dédié, hybride, glyphe+image, défaut obligatoire, images à la demande) → respectées. ✓

**Placeholders :** aucun « TODO/à compléter ». Deux endroits demandent une **vérification de nom d'API existante** avant d'écrire (helpers de contexte `ctx_set_*` en Tâche 4 Step 1 ; kind `'text'`/helpers `section`/`note`/`makeInput` en Tâche 7) — signalés explicitement, avec l'instruction de coller au nom réel (Rule 8 : ne pas inventer d'API).

**Cohérence de types :** `StateCase`/`state_*` (dashboard.h) ↔ `state_resolve(uint8_t,const StateCase*,int,bool,double,const char*)` (color.*) ↔ parsing (dashboard.cpp) ↔ `build_state`/`sync_state` (view.cpp) ↔ `resolveState`/`buildState` (render.js) ↔ `$defs/comp_state`+`state_case` (schéma) : champs `key`/`at`/`symbol`/`color`/`src`/`w`/`h`, modes `exact`/`range`, défaut `weather-cloudy` alignés partout. ✓

**Déviation signalée :** pas de `oneOf` glyphe|image dans le schéma (§4) — décision à valider avant la Tâche 5 (bloc « Décision à valider »). ⚠️
