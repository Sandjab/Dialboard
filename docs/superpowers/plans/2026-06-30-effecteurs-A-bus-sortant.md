# Effecteurs — Plan A : bus sortant & lecture (firmware) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Doter le firmware de la plomberie de communication des effecteurs — origine d'écriture du contexte (UI vs externe), `sinks[]` (push HTTP réactif, miroir de `sources[]`), et `GET /context` — sans aucun composant effecteur encore (Plan B) ni designer (Plan C).

**Architecture:** Le `Context` devient un bus bidirectionnel. Une écriture d'**origine UI** (`dash_ctx_write_ui_*`) écrit la var **et arme** les `sinks` qui l'observent ; les écritures externes (`dash_set_context`, pull) n'arment rien → coupe la boucle. Une tâche `push_task` (cœur 0, calquée sur `net_pull`) tire les sinks armés après un **débounce de traîne**, en réutilisant secrets `$nom` et un corps templaté `{{var}}`. La logique pure (débounce, templating, filtre de lecture) est isolée dans des modules **natifs-testables** (`sink.cpp`, `context.cpp`) ; seule la glue HTTP (`net_push.cpp`, handler `api.cpp`) reste non-testable en natif (comme `net_pull.cpp`).

**Tech Stack:** C++/Arduino, ArduinoJson, ESP32 WebServer/HTTPClient, FreeRTOS, Unity (env:native PlatformIO). JSON Schema draft-07.

**Branche :** travailler sur une branche dédiée (p. ex. `feat/effecteurs-bus-sortant`), pas directement sur `main`.

**Périmètre :** Plan **A** sur 3 (A bus sortant & lecture → B effecteurs firmware → C designer). Couvre les §4.1, §4.2, §4.3, §4.5 du spec `docs/superpowers/specs/2026-06-30-composants-effecteurs-design.md`. **Hors périmètre :** les 5 composants effecteurs (§4.4 → Plan B), le designer (§5 → Plan C).

---

## File Structure

| Fichier | Rôle | Natif-testable |
|---------|------|----------------|
| `src/config.h` (modif) | Bornes `MAX_SINKS` / `MAX_HEADERS_PER_SINK` / `SINK_BODY_LEN`. | n/a |
| `src/dashboard.h` (modif) | `enum SinkMethod`, `struct SinkHeader`, `struct Sink`, champs `sinks[]`/`sink_count` du `Dashboard`, décls `dash_ctx_write_ui_*`. | n/a |
| `src/dashboard.cpp` (modif) | Parse `sinks[]` dans `dash_set_layout` ; `dash_ctx_write_ui_num/str` + armement. | ✅ (déjà dans `build_src_filter`) |
| `src/sink.h` / `src/sink.cpp` (créer) | Logique pure des sinks : `sink_should_fire` (débounce), `sink_render_body` (templating). | ✅ (à ajouter au filtre natif) |
| `src/context.h` / `src/context.cpp` (modif) | `ctx_to_json` (sérialisation + filtre `?vars=`). | ✅ (déjà dans le filtre natif) |
| `src/net_push.h` / `src/net_push.cpp` (créer) | Tâche `push_task` (glue HTTP, miroir de `net_pull`). | ❌ (Arduino/HTTP — build-only) |
| `src/api.cpp` (modif) | Handler `GET /context`. | ❌ (WebServer — build-only) |
| `src/main.cpp` (modif) | Démarre `net_push_begin`. | ❌ (build-only) |
| `platformio.ini` (modif) | Ajoute `+<sink.cpp>` au `build_src_filter` natif. | n/a |
| `schema/layout.schema.json` (modif) | Propriété top-level `sinks` + `$defs/sink`. | ✅ (`node --test` designer) |
| `test/test_core/test_main.cpp` (modif) | Tests Unity natifs. | ✅ |

**Commandes de vérif :**
- Tests natifs : `pio test -e native` (lance toute la suite Unity).
- Build firmware : `pio run -e esp32s3`.
- Tests designer (schéma) : `cd designer && node --test`.

> Note RAM : `Sink sinks[MAX_SINKS]` agrandit le `static Dashboard t` de `dash_set_layout` (~5 Ko) et le `g_dash` global. C'est de la RAM statique (hors pile), conforme au commentaire existant « keep off the loop-task stack ». Surveiller le `RAM:` du build esp32s3.

---

### Task 1 : Bornes config + struct `Sink` + champs `Dashboard` (préparation)

**Files:**
- Modify: `src/config.h` (après la ligne `#define MAX_VARS_PER_SOURCE 6`)
- Modify: `src/dashboard.h` (après `struct Source { … };` ~ l.132 ; dans `struct Dashboard` ~ l.146 ; décls ~ l.156)

Changement de structures uniquement → vérification par **compilation** (pas de test unitaire).

- [ ] **Step 1 : Ajouter les bornes dans `config.h`**

Après `#define MAX_VARS_PER_SOURCE 6` :

```c
#define MAX_SINKS              6
#define MAX_HEADERS_PER_SINK   4
#define SINK_BODY_LEN          192
```

- [ ] **Step 2 : Ajouter `SinkMethod`, `SinkHeader`, `Sink` dans `dashboard.h`**

Juste après la définition de `struct Source { … };` :

```c
enum SinkMethod : uint8_t { SINK_POST = 0, SINK_PUT, SINK_GET };

struct SinkHeader { char name[HEADER_NAME_LEN]; char value[HEADER_VAL_LEN]; };  // value: littéral ou "$secret"

struct Sink {
    char        name[ID_LEN];           // libellé (miroir de Source.name)
    char        watch[ID_LEN];          // var observée ; son écriture UI arme ce sink
    SinkMethod  method;                 // POST par défaut
    char        url[URL_LEN];
    SinkHeader  headers[MAX_HEADERS_PER_SINK];
    int         header_count;
    char        body[SINK_BODY_LEN];    // gabarit ("" => corps par défaut {"<watch>": <val>})
    uint32_t    debounce_ms;
    // --- runtime (rempli par push_task en Plan A, armé par l'UI en Plan B) ---
    uint32_t    pending_since;          // 0 = non armé ; sinon millis() de la dernière écriture UI
    int         last_status;            // dernier code HTTP, <=0 sur erreur transport
    uint32_t    err_count;
    uint32_t    fired_at;               // millis() du dernier tir réussi
};
```

- [ ] **Step 3 : Ajouter `sinks[]` / `sink_count` au `Dashboard`**

Dans `struct Dashboard`, après `int source_count;` :

```c
    Sink      sinks[MAX_SINKS];
    int       sink_count;
```

- [ ] **Step 4 : Déclarer les écritures d'origine UI**

Après `void dash_set_context(Dashboard* d, const char* json, uint32_t now);` :

```c
// Écriture du contexte d'ORIGINE UI (effecteur) : écrit la var ET arme les sinks qui l'observent.
void dash_ctx_write_ui_num(Dashboard* d, const char* var, double v, uint32_t now);
void dash_ctx_write_ui_str(Dashboard* d, const char* var, const char* v, uint32_t now);
```

- [ ] **Step 5 : Compiler (le code des fonctions viendra en Task 2/5 ; ici on vérifie juste que les structs compilent)**

Comme `dash_ctx_write_ui_*` est seulement déclarée (pas appelée), le firmware compile.

Run: `pio run -e esp32s3`
Expected: SUCCESS (surveiller la ligne `RAM:` — légère hausse attendue).

Run: `pio test -e native`
Expected: PASS (suite inchangée ; la struct `Dashboard` plus grosse compile).

- [ ] **Step 6 : Commit**

```bash
git add src/config.h src/dashboard.h
git commit -m "feat(sink): struct Sink + bornes config + champs Dashboard"
```

---

### Task 2 : Parser `sinks[]` dans `dash_set_layout`

**Files:**
- Test: `test/test_core/test_main.cpp` (nouveaux tests + RUN_TEST)
- Modify: `src/dashboard.cpp` (bloc de parse après la boucle `sources`, avant `t.active_page = 0;` ~ l.282)

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter près des tests de sources (vers la ligne `test_no_sources_is_zero`) :

```c
// --- parse des sinks (push P-A) ---
static const char* LAYOUT_SINKS =
  "{\"sinks\":[{"
    "\"name\":\"Lampe\",\"watch\":\"lamp\",\"method\":\"PUT\","
    "\"url\":\"http://ha.local/api/states/light.salon\","
    "\"headers\":{\"Authorization\":\"$ha_token\"},"
    "\"debounce_ms\":300,"
    "\"body\":{\"state\":\"{{lamp}}\"}}],"
  "\"components\":{},\"pages\":[]}";

void test_sinks_parse_counts(void) {
    Dashboard d{}; char err[80];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_SINKS, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(1, d.sink_count);
    TEST_ASSERT_EQUAL_STRING("Lampe", d.sinks[0].name);
    TEST_ASSERT_EQUAL_STRING("lamp",  d.sinks[0].watch);
    TEST_ASSERT_EQUAL_STRING("http://ha.local/api/states/light.salon", d.sinks[0].url);
    TEST_ASSERT_EQUAL_INT(SINK_PUT, d.sinks[0].method);
    TEST_ASSERT_EQUAL_UINT32(300, d.sinks[0].debounce_ms);
}
void test_sinks_headers_and_body(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINKS, err, sizeof(err));
    TEST_ASSERT_EQUAL_INT(1, d.sinks[0].header_count);
    TEST_ASSERT_EQUAL_STRING("Authorization", d.sinks[0].headers[0].name);
    TEST_ASSERT_EQUAL_STRING("$ha_token",     d.sinks[0].headers[0].value);
    TEST_ASSERT_EQUAL_STRING("{\"state\":\"{{lamp}}\"}", d.sinks[0].body);  // gabarit re-sérialisé
}
void test_sinks_method_defaults_post(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"sinks\":[{\"watch\":\"x\",\"url\":\"http://h/\"}],\"components\":{},\"pages\":[]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(SINK_POST, d.sinks[0].method);
    TEST_ASSERT_EQUAL_STRING("", d.sinks[0].body);    // body absent -> "" (corps par défaut au fire)
}
void test_sinks_url_required(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"sinks\":[{\"watch\":\"x\"}],\"components\":{},\"pages\":[]}";
    TEST_ASSERT_FALSE(dash_set_layout(&d, L, err, sizeof(err)));   // url manquante -> rejet
}
void test_sinks_watch_required(void) {
    Dashboard d{}; char err[80];
    const char* L = "{\"sinks\":[{\"url\":\"http://h/\"}],\"components\":{},\"pages\":[]}";
    TEST_ASSERT_FALSE(dash_set_layout(&d, L, err, sizeof(err)));   // watch manquant -> rejet
}
void test_no_sinks_is_zero(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_OK, err, sizeof(err));   // layout sans 'sinks'
    TEST_ASSERT_EQUAL_INT(0, d.sink_count);             // rétro-compat
}
```

Ajouter dans le runner (avant `return UNITY_END();`) :

```c
    RUN_TEST(test_sinks_parse_counts);
    RUN_TEST(test_sinks_headers_and_body);
    RUN_TEST(test_sinks_method_defaults_post);
    RUN_TEST(test_sinks_url_required);
    RUN_TEST(test_sinks_watch_required);
    RUN_TEST(test_no_sinks_is_zero);
```

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `pio test -e native`
Expected: FAIL — `test_sinks_parse_counts` etc. échouent (`sink_count` reste 0, `url_required`/`watch_required` ne rejettent pas) car le parse n'existe pas encore.

- [ ] **Step 3 : Implémenter le parse**

Dans `src/dashboard.cpp`, juste après la boucle `for (JsonObjectConst so : srcs) { … }` (fin du parse des sources, avant `t.active_page = 0;`) :

```c
    JsonArrayConst snks = doc["sinks"].as<JsonArrayConst>();
    for (JsonObjectConst sk : snks) {
        if (t.sink_count >= MAX_SINKS) { snprintf(err, errn, "trop de sinks"); return false; }
        Sink& s = t.sinks[t.sink_count];
        strlcpy(s.name,  sk["name"]  | "", sizeof(s.name));
        strlcpy(s.watch, sk["watch"] | "", sizeof(s.watch));
        strlcpy(s.url,   sk["url"]   | "", sizeof(s.url));
        if (s.url[0]   == '\0') { snprintf(err, errn, "sink '%s' sans url", s.name);   return false; }
        if (s.watch[0] == '\0') { snprintf(err, errn, "sink '%s' sans watch", s.name); return false; }
        const char* m = sk["method"] | "POST";
        s.method = (strcmp(m, "PUT") == 0) ? SINK_PUT : (strcmp(m, "GET") == 0) ? SINK_GET : SINK_POST;
        s.debounce_ms = sk["debounce_ms"] | 0;
        for (JsonPairConst h : sk["headers"].as<JsonObjectConst>()) {
            if (s.header_count >= MAX_HEADERS_PER_SINK) break;
            strlcpy(s.headers[s.header_count].name,  h.key().c_str(), sizeof(s.headers[0].name));
            strlcpy(s.headers[s.header_count].value, h.value() | "",  sizeof(s.headers[0].value));
            s.header_count++;
        }
        if (!sk["body"].isNull()) serializeJson(sk["body"], s.body, sizeof(s.body));  // gabarit -> texte
        t.sink_count++;
    }
```

> `serializeJson` est déjà utilisé/inclus dans `dashboard.cpp`. `t` est zéro-initialisé (`memset` en tête de `dash_set_layout`) → `body`/`header_count`/`pending_since` partent à zéro.

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `pio test -e native`
Expected: PASS (toute la suite, dont les 6 nouveaux tests).

- [ ] **Step 5 : Commit**

```bash
git add src/dashboard.cpp test/test_core/test_main.cpp
git commit -m "feat(sink): parse sinks[] dans dash_set_layout (miroir des sources)"
```

---

### Task 3 : `sink_should_fire` (débounce de traîne) — module `sink.cpp`

**Files:**
- Create: `src/sink.h`, `src/sink.cpp`
- Modify: `platformio.ini:32` (ajouter `+<sink.cpp>` au filtre natif)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter dans `test_main.cpp` (et `#include "sink.h"` en tête, près des autres includes) :

```c
void test_sink_should_fire_debounce(void) {
    // pending_since=0 -> jamais
    TEST_ASSERT_FALSE(sink_should_fire(0, 1000, 300));
    // armé à t=1000, débounce 300 : pas encore à t=1200, oui à t=1300
    TEST_ASSERT_FALSE(sink_should_fire(1000, 1200, 300));
    TEST_ASSERT_TRUE (sink_should_fire(1000, 1300, 300));
    // débounce 0 -> dès que armé
    TEST_ASSERT_TRUE (sink_should_fire(1000, 1000, 0));
}
```

Ajouter `RUN_TEST(test_sink_should_fire_debounce);` au runner.

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `pio test -e native`
Expected: FAIL — erreur de **link** `undefined reference to sink_should_fire` (et `sink.h` introuvable tant qu'il n'existe pas → ajouter le fichier d'abord fait passer l'erreur à un link error).

- [ ] **Step 3 : Créer `src/sink.h`**

```c
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "context.h"

// Débounce de traîne : vrai si armé (pending_since != 0) ET au moins debounce_ms écoulé depuis.
bool sink_should_fire(uint32_t pending_since, uint32_t now, uint32_t debounce_ms);
```

- [ ] **Step 4 : Créer `src/sink.cpp`**

```c
#include "sink.h"

bool sink_should_fire(uint32_t pending_since, uint32_t now, uint32_t debounce_ms) {
    if (pending_since == 0) return false;
    return (now - pending_since) >= debounce_ms;   // arithmétique uint32 (wrap), comme net_pull
}
```

- [ ] **Step 5 : Ajouter `sink.cpp` au build natif**

Dans `platformio.ini`, ligne `build_src_filter` de `[env:native]`, ajouter `+<sink.cpp>` :

```ini
build_src_filter = -<*> +<dashboard.cpp> +<format.cpp> +<color.cpp> +<nav_logic.cpp> +<context.cpp> +<asset_path.cpp> +<sink.cpp>
```

- [ ] **Step 6 : Lancer pour vérifier le succès**

Run: `pio test -e native`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add src/sink.h src/sink.cpp platformio.ini test/test_core/test_main.cpp
git commit -m "feat(sink): sink_should_fire (debounce de traine) + module natif-testable"
```

---

### Task 4 : `sink_render_body` (templating `{{var}}` + corps par défaut)

**Files:**
- Modify: `src/sink.h`, `src/sink.cpp`
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1 : Écrire les tests qui échouent**

```c
void test_sink_body_default(void) {
    Context c{}; ctx_set_num(&c, "lamp", 1, 0);
    char out[128];
    sink_render_body("", "lamp", &c, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"lamp\":1}", out);     // corps par défaut, typé number
}
void test_sink_body_default_str(void) {
    Context c{}; ctx_set_str(&c, "mode", "eco", 0);
    char out[128];
    sink_render_body("", "mode", &c, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"mode\":\"eco\"}", out);   // string échappée par ArduinoJson
}
void test_sink_body_template_num_quoted(void) {
    Context c{}; ctx_set_num(&c, "lamp", 42, 0);
    char out[128];
    sink_render_body("{\"state\":\"{{lamp}}\"}", "lamp", &c, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"state\":\"42\"}", out);   // guillemets du gabarit -> string "42"
}
void test_sink_body_template_num_raw(void) {
    Context c{}; ctx_set_num(&c, "lamp", 42, 0);
    char out[128];
    sink_render_body("{\"v\":{{lamp}}}", "lamp", &c, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"v\":42}", out);           // sans guillemets -> number brut
}
void test_sink_body_template_missing_var(void) {
    Context c{};
    char out[128];
    sink_render_body("{\"v\":\"{{absent}}\"}", "absent", &c, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"v\":\"\"}", out);         // var inconnue -> texte vide
}
```

Ajouter les `RUN_TEST(...)` correspondants.

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `pio test -e native`
Expected: FAIL — link error `undefined reference to sink_render_body`.

- [ ] **Step 3 : Déclarer dans `src/sink.h`**

Après la déclaration de `sink_should_fire` :

```c
// Construit le corps HTTP du sink dans out (taille n).
//   tmpl == "" : corps par défaut {"<watch>": <valeur de watch>} (typé via ArduinoJson).
//   sinon      : macro textuelle — chaque {{nom}} est remplacé par le TEXTE de la var
//                (number: entier si entier, sinon %g ; string: caractères bruts).
//                L'auteur du gabarit met les guillemets s'il veut une string JSON.
void sink_render_body(const char* tmpl, const char* watch, const Context* ctx, char* out, size_t n);
```

- [ ] **Step 4 : Implémenter dans `src/sink.cpp`**

Ajouter les includes en tête (`#include <ArduinoJson.h>`, `#include <string.h>`, `#include <stdio.h>`) puis :

```c
// Formate une CtxVar en texte sans guillemets : entier si entier, sinon %g ; string brute.
static void var_text(const CtxVar& v, char* out, size_t n) {
    if (v.type == CTX_STR) { strlcpy(out, v.str, n); return; }
    double d = v.num;
    if (d == (double)(long)d) snprintf(out, n, "%ld", (long)d);
    else                      snprintf(out, n, "%g", d);
}

void sink_render_body(const char* tmpl, const char* watch, const Context* ctx, char* out, size_t n) {
    if (!tmpl || tmpl[0] == '\0') {                 // corps par défaut, typé
        JsonDocument doc;
        int i = ctx_find(ctx, watch);
        if (i < 0)                              doc[watch] = nullptr;
        else if (ctx->vars[i].type == CTX_STR)  doc[watch] = ctx->vars[i].str;
        else                                    doc[watch] = ctx->vars[i].num;
        serializeJson(doc, out, n);
        return;
    }
    size_t o = 0;                                   // macro textuelle {{nom}}
    for (const char* p = tmpl; *p && o + 1 < n; ) {
        if (p[0] == '{' && p[1] == '{') {
            const char* end = strstr(p + 2, "}}");
            if (end) {
                char name[ID_LEN]; size_t k = 0;
                for (const char* q = p + 2; q < end && k < sizeof(name) - 1; q++) name[k++] = *q;
                name[k] = '\0';
                int vi = ctx_find(ctx, name);
                char val[TEXT_LEN] = "";
                if (vi >= 0) var_text(ctx->vars[vi], val, sizeof(val));
                for (const char* s = val; *s && o + 1 < n; s++) out[o++] = *s;
                p = end + 2;
                continue;
            }
        }
        out[o++] = *p++;
    }
    out[o] = '\0';
}
```

> `ID_LEN`/`TEXT_LEN` viennent de `config.h` (inclus via `context.h`). `ctx_find`/`ctx_set_num`/`ctx_set_str` sont déjà déclarés dans `context.h`.

- [ ] **Step 5 : Lancer pour vérifier le succès**

Run: `pio test -e native`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add src/sink.h src/sink.cpp test/test_core/test_main.cpp
git commit -m "feat(sink): sink_render_body (gabarit {{var}} + corps par defaut type)"
```

---

### Task 5 : Origine d'écriture — `dash_ctx_write_ui_*` arme les sinks

**Files:**
- Modify: `src/dashboard.cpp` (près de `dash_set_context`)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1 : Écrire les tests qui échouent**

```c
// LAYOUT avec un sink observant "lamp" (débounce 0)
static const char* LAYOUT_SINK_LAMP =
  "{\"sinks\":[{\"watch\":\"lamp\",\"url\":\"http://h/\"}],\"components\":{},\"pages\":[]}";

void test_ui_write_arms_sink(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_LAMP, err, sizeof(err));
    TEST_ASSERT_EQUAL_UINT32(0, d.sinks[0].pending_since);   // non armé au départ
    dash_ctx_write_ui_num(&d, "lamp", 1, 5000);
    TEST_ASSERT_EQUAL_UINT32(5000, d.sinks[0].pending_since);          // armé
    TEST_ASSERT_EQUAL_INT(1, (int)d.ctx.vars[ctx_find(&d.ctx,"lamp")].num);  // var écrite
}
void test_external_write_does_not_arm(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_LAMP, err, sizeof(err));
    dash_set_context(&d, "{\"lamp\":1}", 5000);             // écriture EXTERNE
    TEST_ASSERT_EQUAL_UINT32(0, d.sinks[0].pending_since);  // n'arme PAS -> pas de boucle
}
void test_ui_write_arms_only_matching_watch(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d, LAYOUT_SINK_LAMP, err, sizeof(err));
    dash_ctx_write_ui_num(&d, "volume", 30, 5000);          // var non observée
    TEST_ASSERT_EQUAL_UINT32(0, d.sinks[0].pending_since);  // sink "lamp" pas armé
}
```

Ajouter les `RUN_TEST(...)`.

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `pio test -e native`
Expected: FAIL — link error `undefined reference to dash_ctx_write_ui_num` (déclarée en Task 1, jamais définie).

- [ ] **Step 3 : Implémenter dans `src/dashboard.cpp`**

Juste après la fonction `dash_set_context` :

```c
// Arme (pending_since = now) chaque sink dont watch == var. now==0 -> 1 (0 = "non armé").
static void arm_sinks(Dashboard* d, const char* var, uint32_t now) {
    for (int i = 0; i < d->sink_count; i++)
        if (strncmp(d->sinks[i].watch, var, ID_LEN) == 0)
            d->sinks[i].pending_since = now ? now : 1;
}
void dash_ctx_write_ui_num(Dashboard* d, const char* var, double v, uint32_t now) {
    if (ctx_set_num(&d->ctx, var, v, now)) arm_sinks(d, var, now);
}
void dash_ctx_write_ui_str(Dashboard* d, const char* var, const char* v, uint32_t now) {
    if (ctx_set_str(&d->ctx, var, v, now)) arm_sinks(d, var, now);
}
```

> `strncmp` / `<string.h>` : déjà inclus dans `dashboard.cpp`. `ctx_set_num/str` renvoient `false` si le contexte est plein → on n'arme pas dans ce cas (cohérent).

- [ ] **Step 4 : Lancer pour vérifier le succès**

Run: `pio test -e native`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/dashboard.cpp test/test_core/test_main.cpp
git commit -m "feat(sink): dash_ctx_write_ui_* arme les sinks (origine UI) — coupe la boucle"
```

---

### Task 6 : `ctx_to_json` (sérialisation + filtre `?vars=`)

**Files:**
- Modify: `src/context.h`, `src/context.cpp`
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1 : Écrire les tests qui échouent**

```c
void test_ctx_to_json_all(void) {
    Context c{}; ctx_set_num(&c, "lamp", 1, 0); ctx_set_num(&c, "volume", 42, 0);
    char out[256];
    ctx_to_json(&c, nullptr, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"lamp\":1,\"volume\":42}", out);   // ArduinoJson préserve l'ordre d'insertion
}
void test_ctx_to_json_filter(void) {
    Context c{}; ctx_set_num(&c, "lamp", 1, 0); ctx_set_num(&c, "volume", 42, 0);
    char out[256];
    ctx_to_json(&c, "volume", out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"volume\":42}", out);              // sous-ensemble
}
void test_ctx_to_json_filter_multi(void) {
    Context c{}; ctx_set_num(&c, "a", 1, 0); ctx_set_num(&c, "b", 2, 0); ctx_set_num(&c, "c", 3, 0);
    char out[256];
    ctx_to_json(&c, "a,c", out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"a\":1,\"c\":3}", out);
}
void test_ctx_to_json_str(void) {
    Context c{}; ctx_set_str(&c, "host", "srv1", 0);
    char out[256];
    ctx_to_json(&c, nullptr, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"host\":\"srv1\"}", out);
}
```

Ajouter les `RUN_TEST(...)`.

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `pio test -e native`
Expected: FAIL — link error `undefined reference to ctx_to_json`.

- [ ] **Step 3 : Déclarer dans `src/context.h`**

Après `JsonVariantConst ctx_extract_pointer(...)` :

```c
// Sérialise le contexte en {"nom":valeur,...} dans out (taille n). filter_csv != NULL =>
// ne garde que les noms listés (CSV "a,b,c", tokens exacts). NULL => tout le contexte.
void ctx_to_json(const Context* c, const char* filter_csv, char* out, size_t n);
```

- [ ] **Step 4 : Implémenter dans `src/context.cpp`**

```c
// Vrai si name figure dans le CSV "a,b,c" (correspondance de token exacte).
static bool csv_has(const char* csv, const char* name) {
    size_t len = strlen(name);
    for (const char* p = csv; *p; ) {
        const char* comma = strchr(p, ',');
        size_t tok = comma ? (size_t)(comma - p) : strlen(p);
        if (tok == len && strncmp(p, name, len) == 0) return true;
        if (!comma) break;
        p = comma + 1;
    }
    return false;
}

void ctx_to_json(const Context* c, const char* filter_csv, char* out, size_t n) {
    JsonDocument doc;
    for (int i = 0; i < c->count; i++) {
        const CtxVar& v = c->vars[i];
        if (filter_csv && !csv_has(filter_csv, v.name)) continue;
        if (v.type == CTX_STR) doc[v.name] = v.str;
        else                   doc[v.name] = v.num;
    }
    serializeJson(doc, out, n);
}
```

> `<string.h>`/`<stdlib.h>` et `ArduinoJson.h` (via `context.h`) sont déjà inclus dans `context.cpp`.

- [ ] **Step 5 : Lancer pour vérifier le succès**

Run: `pio test -e native`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add src/context.h src/context.cpp test/test_core/test_main.cpp
git commit -m "feat(context): ctx_to_json (serialisation + filtre ?vars=)"
```

---

### Task 7 : Handler `GET /context` (firmware — build-only)

**Files:**
- Modify: `src/api.cpp` (ajouter `#include "context.h"`, un handler, une route)

Non testable en natif (WebServer). Vérif = **build** + smoke-test `curl` manuel (noté).

- [ ] **Step 1 : Ajouter l'include**

En tête de `src/api.cpp`, avec les autres includes projet :

```c
#include "context.h"
```

- [ ] **Step 2 : Écrire le handler**

Près de `h_set_context` :

```c
static void h_get_context() {
    String filter = S->hasArg("vars") ? S->arg("vars") : String();
    char out[2048];                                  // 32 vars max * ~60 o
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    ctx_to_json(&D->ctx, filter.length() ? filter.c_str() : nullptr, out, sizeof(out));
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
    String body = out; body += "\n";
    S->send(200, "application/json", body);
}
```

- [ ] **Step 3 : Enregistrer la route**

Dans `api_register`, à côté de `server.on("/context", HTTP_POST, h_set_context);` :

```c
    server.on("/context", HTTP_GET, h_get_context);
```

- [ ] **Step 4 : Vérifier le build**

Run: `pio run -e esp32s3`
Expected: SUCCESS.

- [ ] **Step 5 : Smoke-test manuel (après flash, optionnel à ce stade)**

```bash
# Sur un device flashé avec un contexte non vide (via POST /context) :
curl -s http://dialboard.local/context
curl -s 'http://dialboard.local/context?vars=lamp'
```
Expected: JSON `{"...":...}` ; le 2e filtré sur `lamp`. (Vérif device complète repoussée à l'intégration Plan B.)

- [ ] **Step 6 : Commit**

```bash
git add src/api.cpp
git commit -m "feat(api): GET /context (lecture du bus + filtre ?vars=)"
```

---

### Task 8 : Tâche `push_task` (glue HTTP — build-only, miroir de `net_pull`)

**Files:**
- Create: `src/net_push.h`, `src/net_push.cpp`
- Modify: `src/main.cpp` (include + `net_push_begin` + commentaire mutex)

Non testable en natif (HTTPClient/WiFi/FreeRTOS) — comme `net_pull.cpp`. La logique pure (débounce, corps) est déjà couverte par Tasks 3/4. Vérif = **build** + intégration device (notée).

- [ ] **Step 1 : Créer `src/net_push.h`**

```c
#pragma once
#include "dashboard.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

// Démarre la tâche de push réactif (cœur 0) : tire les sinks armés après leur débounce.
void net_push_begin(Dashboard* d, SemaphoreHandle_t mutex);
```

- [ ] **Step 2 : Créer `src/net_push.cpp`**

```c
#include "net_push.h"
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <string.h>
#include "config.h"
#include "context.h"
#include "sink.h"
#include "secret_store.h"

static Dashboard*        s_d   = nullptr;
static SemaphoreHandle_t s_mtx = nullptr;
static inline void lock()   { if (s_mtx) xSemaphoreTake(s_mtx, portMAX_DELAY); }
static inline void unlock() { if (s_mtx) xSemaphoreGive(s_mtx); }

// Résout "$nom" via le store de secrets ; sinon copie la valeur littérale. (Identique à net_pull.)
static void resolve_header(const char* in, char* out, size_t n) {
    if (in[0] == '$') { if (!secret_store_get(in + 1, out, n) && n) out[0] = '\0'; return; }
    strlcpy(out, in, n);
}

// Snapshot local pour relâcher le mutex pendant le HTTP (long).
struct SinkJob {
    uint8_t method;
    char    url[URL_LEN];
    char    hname[MAX_HEADERS_PER_SINK][HEADER_NAME_LEN];
    char    hval [MAX_HEADERS_PER_SINK][HEADER_VAL_LEN];
    int     header_count;
    char    body[SINK_BODY_LEN + TEXT_LEN];     // marge pour la substitution {{var}}
};

static void fire_one(int idx) {
    SinkJob job;
    // 1) snapshot config + secrets + rendu du corps, sous mutex
    lock();
    Sink& s = s_d->sinks[idx];
    job.method = s.method;
    strlcpy(job.url, s.url, sizeof(job.url));
    job.header_count = s.header_count;
    for (int i = 0; i < s.header_count; i++) {
        strlcpy(job.hname[i], s.headers[i].name, HEADER_NAME_LEN);
        resolve_header(s.headers[i].value, job.hval[i], HEADER_VAL_LEN);
    }
    sink_render_body(s.body, s.watch, &s_d->ctx, job.body, sizeof(job.body));
    s.pending_since = 0;                         // désarme AVANT le tir (un nouvel UI write ré-armera)
    unlock();

    // 2) HTTP hors mutex
    bool https = strncmp(job.url, "https", 5) == 0;
    WiFiClientSecure tls;
    WiFiClient       tcp;
    HTTPClient http;
    bool begun = https ? (tls.setInsecure(), http.begin(tls, job.url)) : http.begin(tcp, job.url);
    if (!begun) { lock(); s_d->sinks[idx].last_status = -1; s_d->sinks[idx].err_count++; unlock(); return; }
    http.addHeader("Content-Type", "application/json");
    for (int i = 0; i < job.header_count; i++)
        if (job.hval[i][0]) http.addHeader(job.hname[i], job.hval[i]);
    int code = job.method == SINK_GET ? http.GET()
             : job.method == SINK_PUT ? http.PUT(String(job.body))
             :                          http.POST(String(job.body));
    http.end();

    // 3) statut sous mutex
    lock();
    s_d->sinks[idx].last_status = code;
    if (code <= 0) s_d->sinks[idx].err_count++;
    else           s_d->sinks[idx].fired_at = millis();
    unlock();
}

static void push_task(void*) {
    for (;;) {
        if (WiFi.status() == WL_CONNECTED) {
            int n; lock(); n = s_d->sink_count; unlock();
            uint32_t now = millis();
            for (int i = 0; i < n; i++) {
                uint32_t pending, deb;
                lock(); pending = s_d->sinks[i].pending_since; deb = s_d->sinks[i].debounce_ms; unlock();
                if (sink_should_fire(pending, now, deb)) fire_one(i);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(100));     // réactif (100 ms) : le débounce vit dans le sink
    }
}

void net_push_begin(Dashboard* d, SemaphoreHandle_t mutex) {
    s_d = d; s_mtx = mutex;
    // Cœur 0 (PRO_CPU), comme net_pull. Pile 16 KB pour le handshake TLS mbedtls (HTTPS).
    xTaskCreatePinnedToCore(push_task, "push", 16384, nullptr, 1, nullptr, 0);
}
```

> `secret_store_get(name, out, n) -> bool` et le patron snapshot/lock sont calqués sur `net_pull.cpp`. La logique testable (`sink_should_fire`, `sink_render_body`) est déjà couverte (Tasks 3/4).

- [ ] **Step 3 : Démarrer la tâche dans `main.cpp`**

Ajouter l'include avec les autres :

```c
#include "net_push.h"
```

Dans `start_services()`, juste après `net_pull_begin(&g_dash, g_ctx_mutex);` :

```c
    net_push_begin(&g_dash, g_ctx_mutex);   // push réactif des sinks (même garde `started`)
```

Mettre à jour le commentaire de `g_ctx_mutex` (l.24) : `… g_dash.ctx / g_dash.sources / g_dash.sinks`.

- [ ] **Step 4 : Vérifier le build**

Run: `pio run -e esp32s3`
Expected: SUCCESS (`net_push.cpp` auto-compilé pour esp32s3).

- [ ] **Step 5 : Note d'intégration device (à exécuter quand un effecteur existera, Plan B)**

Le `push_task` ne tire que sur `pending_since != 0`, posé uniquement par `dash_ctx_write_ui_*` (aucun appelant en Plan A). Test bout-en-bout = Plan B (un effecteur écrit la var). Smoke-test possible dès maintenant en armant via un effecteur factice ou en intégration Plan B.

- [ ] **Step 6 : Commit**

```bash
git add src/net_push.h src/net_push.cpp src/main.cpp
git commit -m "feat(sink): push_task reactif (glue HTTP, miroir de net_pull)"
```

---

### Task 9 : Schéma — `sinks` top-level + `$defs/sink`

**Files:**
- Modify: `schema/layout.schema.json`

- [ ] **Step 1 : Ajouter la propriété `sinks` au top-level**

Dans `properties`, juste après le bloc `"sources": { … }` :

```json
    "sinks": {
      "type": "array",
      "description": "Push reseau reactif (miroir de sources). Chaque sink observe une var et POST/PUT/GET son url quand une ecriture d'ORIGINE UI (effecteur) la modifie. Debounce de traine via debounce_ms. SECRETS via $nom dans headers.",
      "maxItems": 6,
      "items": { "$ref": "#/$defs/sink" }
    }
```

- [ ] **Step 2 : Ajouter `$defs/sink`**

Dans `$defs`, à côté de `"source": { … }` :

```json
    "sink": {
      "type": "object",
      "required": ["watch", "url"],
      "additionalProperties": false,
      "description": "Une sortie HTTP reactive (1 sink = 1 var observee -> 1 url). url et watch requis (le firmware rejette sinon).",
      "properties": {
        "name": { "$ref": "#/$defs/display", "description": "Libelle (apparait dans GET /status)." },
        "watch": { "$ref": "#/$defs/id", "description": "Var de contexte observee ; son ecriture UI arme ce sink." },
        "method": { "enum": ["POST", "PUT", "GET"], "description": "Methode HTTP. Defaut POST." },
        "url": { "type": "string", "description": "URL HTTP(S) cible." },
        "headers": {
          "type": "object",
          "description": "En-tetes HTTP. Une valeur \"$nom\" reference un secret (resolu au fire).",
          "additionalProperties": { "type": "string" }
        },
        "debounce_ms": { "type": "integer", "minimum": 0, "description": "Coalesce les ecritures : tir debounce_ms apres la derniere modif. Defaut 0 (immediat). Slider/arc : ex. 300." },
        "body": { "description": "Gabarit du corps (objet/valeur JSON). {{var}} substitue depuis le contexte (macro textuelle ; mettre des guillemets pour une string). Absent => {\"<watch>\": <valeur>}." }
      }
    }
```

> `maxItems: 6` = `MAX_SINKS`. Le top-level a déjà `additionalProperties:false` ; ajouter `sinks` à `properties` l'autorise.

- [ ] **Step 3 : Vérifier que le schéma reste valide et que le designer ne casse pas**

Run: `cd designer && node --test`
Expected: PASS (le schéma est du JSON valide ; aucun composant designer ne dépend encore de `sinks` — ils arrivent au Plan C). Si un test charge le schéma, il doit continuer à le parser.

- [ ] **Step 4 : Commit**

```bash
git add schema/layout.schema.json
git commit -m "feat(schema): sinks top-level + \$defs/sink (push reactif)"
```

---

## Self-Review

**1. Couverture du spec :**
- §4.1 Origine d'écriture → Task 5 (`dash_ctx_write_ui_*` arme ; externe n'arme pas). ✅
- §4.2 `sinks[]` : struct → T1 ; parse → T2 ; `push_task` → T8 ; débounce → T3 ; templating `{{var}}`/secrets → T4/T8 ; bornes config → T1. ✅
- §4.3 `GET /context` (+`?vars=`) → T6 (logique) + T7 (handler). ✅
- §4.5 Schéma `sinks` → T9. ✅
- §4.4 effecteurs, §5 designer → **hors périmètre Plan A** (Plans B/C). Cohérent avec le découpage acté.

**2. Placeholders :** aucun « TBD/TODO ». Les notes d'intégration device (T7/T8 smoke-tests, Plan B) sont des **renvois de périmètre assumés**, pas des trous — la logique pure est testée en natif (T3/T4/T5/T6).

**3. Cohérence des types/signatures :**
- `Sink` (T1) ↔ parse (T2) ↔ armement (T5) ↔ `push_task` (T8) : `name`/`watch`/`method`(`SinkMethod`)/`url`/`headers`/`body`/`debounce_ms`/`pending_since` identiques partout.
- `sink_should_fire(uint32_t,uint32_t,uint32_t)` (T3) appelée à l'identique en T8.
- `sink_render_body(const char*,const char*,const Context*,char*,size_t)` (T4) appelée à l'identique en T8.
- `dash_ctx_write_ui_num/str` déclarées T1, définies T5 — signatures alignées.
- `ctx_to_json(const Context*,const char*,char*,size_t)` déclarée/définie T6, appelée T7.
- `SINK_BODY_LEN`/`MAX_SINKS`/`MAX_HEADERS_PER_SINK` (T1) réutilisées T2/T8/T9 (`maxItems:6`).

**4. Risques tracés** (du spec) : débounce de traîne (`pending_since` rafraîchi par chaque UI write — T5/T8) ; échappement des strings dans le templating textuel (limite assumée, corps par défaut typé via ArduinoJson) ; conflit reflet/drag (Plan B) ; pile TLS 16 KB (T8, comme net_pull).
