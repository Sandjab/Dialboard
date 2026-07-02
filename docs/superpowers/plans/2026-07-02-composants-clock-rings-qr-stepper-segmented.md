# Plan d'implémentation — 5 composants : clock, rings, qr, stepper, segmented

> **Pour agents d'exécution :** SOUS-SKILL REQUIS : utiliser `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans` pour implémenter ce plan tâche par tâche. Les étapes utilisent des cases (`- [ ]`) pour le suivi.

**Goal :** Ajouter 5 types de composants (clock, rings, qr, stepper, segmented) au firmware ET au designer, en version minimale, avec parité de rendu et tests des deux côtés.

**Architecture :** Chaque type se branche via les points d'extension existants. Firmware : enum `CompType` + `COMP_NAMES[]` + vtable `VIEW[]` (build/sync) + vtable `APPLY[]` + switch `context_apply`, gardés par `static_assert`. Designer : `oneOf` du schéma + `$def comp_*` + `buildX` (render.js) + entrée `COMPONENTS` (registry.js) + icône + `FAMILY`. Logique pure (heure→angles, clamp, index, géométrie) extraite dans des modules `.h/.cpp` sans LVGL, testés en natif ; leurs jumeaux JS déjà présents/testés côté designer.

**Tech Stack :** C++/Arduino, LVGL 9.5 (`lv_arc`, `lv_line`, `lv_scale`, `lv_buttonmatrix`, `lv_qrcode`), ESP32-S3 ; designer = modules ES + ajv ; tests Unity (`env:native`) + `node --test`. NTP via `configTzTime`. Encodeur QR : qrcodegen (Nayuki, MIT) — C bundlé LVGL + port JS vendorisé.

**Conventions de commit :** chaque tâche finit par un commit ; message en français ; terminer par `Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4`. Ne PAS pousser (push sur demande explicite uniquement).

**Points d'extension firmware (rappel, 5 ancres gardées par `static_assert`) :**
1. `src/dashboard.h` enum `CompType` (insérer avant `COMP_COUNT`).
2. `src/dashboard.cpp` `COMP_NAMES[]` (~L29-41).
3. `src/view.cpp` vtable `VIEW[]` (~L661-683) + fonctions `build_*`/`sync_*`.
4. `src/dashboard.cpp` vtable `APPLY[]` (~L459-481).
5. `src/dashboard.cpp` switch `context_apply` (~L567-626).

**Points d'extension designer (4 fichiers + i18n) :**
1. `schema/layout.schema.json` (`oneOf` ~L106-127 + `$def comp_*`).
2. `designer/js/render.js` (`buildX` + `MOCKS`).
3. `designer/js/registry.js` (import + entrée `COMPONENTS`).
4. `designer/js/icons.js` (`PATHS`) + `designer/js/canvas-zones.js` (`FAMILY`).
5. `designer/js/inspector.js` (seulement si nouveau `kind`/`SELECTS`/éditeur bespoke).
6. `designer/i18n/en.js` + `designer/i18n/fr.json`.

**Ordre d'exécution :** Phase 0 (infra partagée) d'abord. Ensuite les phases 1→5 sont **indépendantes** (chacune livre un composant testable). Phase 6 = parité i18n + build/test/stage global.

**Commandes de vérification globales :**
- Firmware : `pio run -e esp32s3`
- Tests natifs : `pio test -e native`
- Tests designer : `cd designer && node --test`

---

## Phase 0 — Infra partagée

### Task 0.1 : Constantes de configuration

**Files:**
- Modify: `src/config.h` (ajouter les constantes ; grep `MAX_ROLLER` / `ID_LEN` pour situer le bloc de constantes)

- [ ] **Step 1 : Ajouter les constantes**

Ajouter dans `src/config.h`, à côté des autres `#define` de limites :

```cpp
#define TZ_LEN          48    // chaîne TZ POSIX (ex. "CET-1CEST,M3.5.0,M10.5.0")
#define MAX_RING_TRACKS 3     // pistes concentriques d'un composant rings
#define MAX_SEG_OPTS    4     // segments d'un contrôle segmented
```

- [ ] **Step 2 : Commit**

```bash
git add src/config.h
git commit -m "feat(config): constantes tz/rings/segmented

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 0.2 : Champ racine `tz` (schéma + stockage firmware + NTP)

**Files:**
- Modify: `schema/layout.schema.json` (propriétés racine ~L9-18)
- Modify: `src/dashboard.h` (struct `Dashboard` — grep `struct Dashboard`)
- Modify: `src/dashboard.cpp` (parse racine — grep `background` pour trouver le bloc qui lit title/background/nav)
- Modify: `src/main.cpp` (`start_services` L28-38 + include)
- Test: `designer/tests/schema.test.js` (un layout avec `tz` valide)

- [ ] **Step 1 : Schéma — déclarer `tz` (sinon `additionalProperties:false` le rejette)**

Dans `schema/layout.schema.json`, propriétés racine, après le bloc `"nav"` (avant `"components"`) :

```json
    "tz": { "type": "string", "description": "Fuseau POSIX (configTzTime) pour le composant clock. Defaut \"UTC0\". Ex. \"CET-1CEST,M3.5.0,M10.5.0\" (Paris)." },
```

- [ ] **Step 2 : Test schéma — un layout minimal avec `tz` passe**

Dans `designer/tests/schema.test.js`, ajouter (adapter au helper de validation déjà importé dans le fichier — grep `validate` / `compile` en tête) :

```js
test('schema: tz racine accepté', () => {
  const layout = { tz: 'UTC0', components: { a: { type: 'label' } }, pages: [{ place: [] }] };
  const { ok } = validateLayout(layout);   // utiliser le helper existant du fichier
  assert.equal(ok, true);
});
```

- [ ] **Step 3 : Lancer le test → échoue si le helper diffère ; sinon passe**

Run: `cd designer && node --test tests/schema.test.js`
Expected: PASS (le schéma accepte `tz`). Si le nom du helper diffère, aligner sur celui du fichier.

- [ ] **Step 4 : Firmware — stocker `tz` dans `Dashboard`**

Dans `src/dashboard.h`, struct `Dashboard`, ajouter le champ (à côté des autres champs racine) :

```cpp
    char tz[TZ_LEN];   // fuseau POSIX pour clock (defaut "UTC0")
```

- [ ] **Step 5 : Firmware — parser `tz` (défaut "UTC0")**

Dans `src/dashboard.cpp`, dans le bloc de parse racine (là où `background`/`nav` sont lus — grep `background`), ajouter :

```cpp
    strlcpy(d->tz, doc["tz"] | "UTC0", sizeof(d->tz));
```

- [ ] **Step 6 : Firmware — NTP dans `start_services`**

En tête de `src/main.cpp`, ajouter `#include <time.h>` (aucun autre include time.h dans le projet). Dans `start_services()` (L28-38), après `net_push_begin(...)` :

```cpp
    configTzTime(g_dash.tz, "pool.ntp.org", "time.nist.gov");   // heure device pour le composant clock ; non bloquant
```

- [ ] **Step 7 : Compiler**

Run: `pio run -e esp32s3`
Expected: SUCCESS.

- [ ] **Step 8 : Commit**

```bash
git add schema/layout.schema.json src/dashboard.h src/dashboard.cpp src/main.cpp designer/tests/schema.test.js
git commit -m "feat(tz): champ racine tz + NTP (configTzTime) au demarrage services

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 0.3 : Activer les widgets LVGL (QRCODE, BUTTONMATRIX)

**Files:**
- Modify: `src/lv_conf.h` (bloc widgets ~L20-25)

- [ ] **Step 1 : Ajouter les flags**

Dans `src/lv_conf.h`, dans le bloc `// Widgets "extra"` :

```cpp
#define LV_USE_QRCODE          1   // composant qr
#define LV_USE_BUTTONMATRIX    1   // composant segmented (ON par défaut, déclaré explicitement)
```

- [ ] **Step 2 : Compiler (vérifie que QRCODE tire bien ses dépendances)**

Run: `pio run -e esp32s3`
Expected: SUCCESS.

- [ ] **Step 3 : Commit**

```bash
git add src/lv_conf.h
git commit -m "build(lvgl): active LV_USE_QRCODE et LV_USE_BUTTONMATRIX

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 0.4 : Vendoriser l'encodeur QR JS (qrcodegen Nayuki, ESM)

**Files:**
- Create: `designer/vendor/qrcodegen.js` (port JS ESM de Nayuki, MIT)
- Create: `designer/js/qr.js` (wrapper : paramètres figés identiques à `lv_qrcode.c`)
- Test: `designer/tests/qr.test.js`

- [ ] **Step 1 : Récupérer le port JS de Nayuki et l'exposer en ESM**

Télécharger le fichier officiel (MIT) `qrcodegen.js`/`.ts` de Project Nayuki (https://www.nayuki.io/page/qr-code-generator-library) dans `designer/vendor/qrcodegen.js`. Il doit exposer la classe `QrCode` avec `QrCode.encodeBinary(bytes, ecl)`, `QrCode.Ecc.MEDIUM`, `.size`, `.getModule(x,y)`. **Convention du repo : module ES** (comme `ajv.min.js` qui finit par `export{...as default}`). Si le fichier de Nayuki est en IIFE global, l'adapter en ajoutant en fin de fichier :

```js
export { qrcodegen as default };
```

(ou `export const QrCode = qrcodegen.QrCode;` selon la forme). Aucune balise `<script>` — import ES uniquement.

- [ ] **Step 2 : Wrapper `qr.js` — mêmes paramètres que le firmware**

`lv_qrcode.c` fige : ECC = MEDIUM, `minVersion=maxVersion=getMinFitVersion(MEDIUM,len)`, `mask=AUTO`, `boostEcl=true`, encodage **binaire** (`encodeBinary` sur les octets), quiet-zone activable. Reproduire exactement :

```js
// designer/js/qr.js — jumeau JS du rendu lv_qrcode (paramètres figés côté firmware)
import qrcodegen from '../vendor/qrcodegen.js';
const { QrCode } = qrcodegen;

// Renvoie { size, get(x,y) } pour un texte donné, en MEDIUM (comme lv_qrcode).
export function qrModules(text) {
  const bytes = Array.from(new TextEncoder().encode(text ?? ''));
  const qr = QrCode.encodeBinary(bytes, QrCode.Ecc.MEDIUM);   // boostEcl=true, mask AUTO par défaut chez Nayuki
  return { size: qr.size, get: (x, y) => qr.getModule(x, y) };
}
```

- [ ] **Step 3 : Test node — déterminisme + taille de version connue**

`designer/tests/qr.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrModules } from '../js/qr.js';

test('qrModules : déterministe pour un même texte', () => {
  const a = qrModules('http://dialboard.local');
  const b = qrModules('http://dialboard.local');
  assert.equal(a.size, b.size);
  assert.equal(a.get(0, 0), b.get(0, 0));   // finder pattern coin haut-gauche = module noir
  assert.equal(a.get(0, 0), true);
});

test('qrModules : version croît avec la longueur', () => {
  const court = qrModules('hi').size;
  const long = qrModules('x'.repeat(200)).size;
  assert.ok(long > court);
});
```

- [ ] **Step 4 : Lancer**

Run: `cd designer && node --test tests/qr.test.js`
Expected: PASS (ajuster l'API si le port de Nayuki nomme différemment ; garder ECC MEDIUM).

- [ ] **Step 5 : Commit**

```bash
git add designer/vendor/qrcodegen.js designer/js/qr.js designer/tests/qr.test.js
git commit -m "vendor(qr): encodeur qrcodegen (Nayuki, MIT) + wrapper qrModules (parité lv_qrcode)

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

## Phase 1 — `clock` (affichage, famille *data*, heure device via NTP)

### Task 1.1 : Logique pure des aiguilles (module natif + test)

**Files:**
- Create: `src/clock_geom.h`, `src/clock_geom.cpp`
- Modify: `platformio.ini` (filtre `[env:native]` L32 : `+<clock_geom.cpp>`)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1 : Écrire le test d'abord**

Dans `test/test_core/test_main.cpp` : include en tête `#include "clock_geom.h"`, puis ajouter les tests :

```cpp
void test_clock_angles_noon(void) {
    float h, m, s; clock_hand_angles(12, 0, 0, &h, &m, &s);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, h);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, m);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, s);
}
void test_clock_angles_quarter(void) {
    float h, m, s; clock_hand_angles(3, 0, 0, &h, &m, &s);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 90.0f, h);   // 3h → 90°
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, m);
}
void test_clock_angles_half_past(void) {
    float h, m, s; clock_hand_angles(6, 30, 0, &h, &m, &s);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 195.0f, h);  // 6h30 → 6.5*30
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 180.0f, m);
}
void test_clock_digital(void) {
    char buf[16];
    clock_format_digital(9, 5, 7, false, buf, sizeof(buf));
    TEST_ASSERT_EQUAL_STRING("09:05", buf);
    clock_format_digital(9, 5, 7, true, buf, sizeof(buf));
    TEST_ASSERT_EQUAL_STRING("09:05:07", buf);
}
```

Et enregistrer dans `main()` (bloc `RUN_TEST`) :

```cpp
    RUN_TEST(test_clock_angles_noon);
    RUN_TEST(test_clock_angles_quarter);
    RUN_TEST(test_clock_angles_half_past);
    RUN_TEST(test_clock_digital);
```

- [ ] **Step 2 : Lancer → échec compilation (module absent)**

Run: `pio test -e native`
Expected: FAIL (clock_geom.h introuvable / symboles non définis).

- [ ] **Step 3 : Écrire `clock_geom.h`**

```cpp
#pragma once
#include <stddef.h>

// Angles en degrés horaires depuis 12h (0=haut). Pures, sans LVGL.
void clock_hand_angles(int h, int m, int s, float* deg_h, float* deg_m, float* deg_s);
// "HH:MM" ou "HH:MM:SS" si with_seconds. Zéro-paddé.
void clock_format_digital(int h, int m, int s, bool with_seconds, char* out, size_t n);
```

- [ ] **Step 4 : Écrire `clock_geom.cpp`**

```cpp
#include "clock_geom.h"
#include <stdio.h>

void clock_hand_angles(int h, int m, int s, float* deg_h, float* deg_m, float* deg_s) {
    float mm = m + s / 60.0f;
    float hh = (h % 12) + mm / 60.0f;
    if (deg_h) *deg_h = hh * 30.0f;          // 360/12
    if (deg_m) *deg_m = mm * 6.0f;           // 360/60
    if (deg_s) *deg_s = s * 6.0f;
}

void clock_format_digital(int h, int m, int s, bool with_seconds, char* out, size_t n) {
    if (with_seconds) snprintf(out, n, "%02d:%02d:%02d", h, m, s);
    else              snprintf(out, n, "%02d:%02d", h, m);
}
```

- [ ] **Step 5 : Ajouter au filtre natif**

Dans `platformio.ini`, `[env:native]` `build_src_filter`, ajouter `+<clock_geom.cpp>`.

- [ ] **Step 6 : Lancer → passe**

Run: `pio test -e native`
Expected: PASS (tous les RUN_TEST, dont les 4 nouveaux).

- [ ] **Step 7 : Commit**

```bash
git add src/clock_geom.h src/clock_geom.cpp platformio.ini test/test_core/test_main.cpp
git commit -m "feat(clock): logique pure aiguilles + format digital (+tests natifs)

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 1.2 : Firmware — type `clock`, rendu, tick

**Files:**
- Modify: `src/dashboard.h` (enum + champs Component)
- Modify: `src/dashboard.cpp` (`COMP_NAMES`, `APPLY`, parse, `dash_tick_clock`)
- Modify: `src/view.cpp` (`build_clock`, `sync_clock`, `VIEW[]`, points persistants)
- Modify: `src/main.cpp` (tick 1 s)

- [ ] **Step 1 : Enum + champs Component**

`src/dashboard.h` : dans `enum CompType`, insérer `COMP_CLOCK` **avant `COMP_COUNT`**. Dans `struct Component`, ajouter :

```cpp
    bool clock_analog;    // true=cadran, false=digital (défaut true)
    bool show_seconds;
    bool show_date;
```

Déclarer le tick en bas de `dashboard.h` (près de `dash_tick_countdown`) :

```cpp
void dash_tick_clock(Dashboard* d);   // marque les composants clock dirty (à appeler chaque seconde)
```

- [ ] **Step 2 : `COMP_NAMES` + `APPLY` + parse + tick**

`src/dashboard.cpp` :
- `COMP_NAMES[]` : ajouter `{ "clock", COMP_CLOCK },`.
- `APPLY[]` : ajouter `/* COMP_CLOCK */ nullptr,` (heure = device, pas de push-by-id).
- Parse (bloc config par type, à côté de `COMP_ICON`) :

```cpp
    if (c.type == COMP_CLOCK) {
        c.clock_analog = (strcmp(o["mode"] | "analog", "digital") != 0);
        c.show_seconds = o["show_seconds"] | false;
        c.show_date    = o["show_date"] | false;
    }
```

- Tick (près de `dash_tick_countdown`) :

```cpp
void dash_tick_clock(Dashboard* d) {
    for (int i = 0; i < d->component_count; i++) {
        if (d->components[i].type != COMP_CLOCK) continue;
        d->components[i].dirty = true;
        d->values_dirty = true;
    }
}
```

*(Adapter `component_count`/le champ de comptage au nom réel — grep `component_count` dans dashboard.h.)*

- [ ] **Step 3 : `build_clock` + `sync_clock` + points persistants (view.cpp)**

En tête de `view.cpp`, près de `s_meter_section_style`, ajouter le stockage persistant des points d'aiguilles (LVGL garde le POINTEUR passé à `lv_line_set_points`) :

```cpp
static lv_point_precise_t s_clock_pts[MAX_COMPONENTS][3][2];   // [comp][hour/min/sec][2 points]
```

`build_clock` (le composant analogique utilise `main`=conteneur, enfants = ticks + aiguilles ; digital = `main`=label) :

```cpp
static void build_clock(lv_obj_t* parent, Component& c, Placement& q,
                        lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    if (!c.clock_analog) {                                   // DIGITAL
        lv_obj_t* l = lv_label_create(parent);
        lv_obj_set_style_text_font(l, get_font(c.font_family, c.font, c.bold, c.italic), 0);
        lv_obj_set_style_text_color(l, lv_color_hex(c.color), 0);
        lv_label_set_text(l, "--:--");
        lv_obj_align(l, ALIGN_MAP[q.anchor], q.dx, q.dy);
        *main = l;
        return;
    }
    // ANALOG : conteneur transparent + 12 ticks + 3 aiguilles (lv_line)
    int r = q.radius ? q.radius : 80;
    lv_obj_t* box = lv_obj_create(parent);
    lv_obj_remove_style_all(box);
    lv_obj_set_size(box, r * 2, r * 2);
    lv_obj_center(box);
    lv_obj_clear_flag(box, LV_OBJ_FLAG_SCROLLABLE);
    // Ticks : 12 traits fins (statiques, pas de sync)
    for (int i = 0; i < 12; i++) { /* dessin ticks — cf. NOTE ci-dessous */ }
    // Aiguilles : heure(0), minute(1), seconde(2 si show_seconds)
    int idx = q.comp_index;
    int nlines = c.show_seconds ? 3 : 2;
    for (int k = 0; k < nlines; k++) {
        lv_obj_t* ln = lv_line_create(box);
        lv_obj_set_style_line_width(ln, k == 0 ? 6 : (k == 1 ? 4 : 2), 0);
        lv_obj_set_style_line_color(ln, lv_color_hex(k == 2 ? 0x38BDF8 : c.color), 0);
        lv_obj_set_style_line_rounded(ln, true, 0);
        if (idx >= 0 && idx < MAX_COMPONENTS) {
            s_clock_pts[idx][k][0] = (lv_point_precise_t){ (lv_value_precise_t)r, (lv_value_precise_t)r };
            s_clock_pts[idx][k][1] = (lv_point_precise_t){ (lv_value_precise_t)r, (lv_value_precise_t)r };
            lv_line_set_points(ln, s_clock_pts[idx][k], 2);
        }
    }
    *main = box;
}
```

> **NOTE (à vérifier via Context7 `/websites/lvgl_io_open`) :** signature exacte de `lv_line_set_points` en 9.5 (`lv_point_precise_t` vs `lv_point_t`) et le fait que LVGL conserve le pointeur (d'où `s_clock_pts` statique). Dessin des ticks : lignes courtes de `r*0.9` à `r*0.98` sur 12 angles (réutiliser `clock_hand_angles`-style ou une boucle `angle=i*30`). Garder simple : 4 ticks cardinaux suffisent en minimal si les 12 posent souci de place.

`sync_clock` (recalcule depuis l'heure device à chaque tick) :

```cpp
static void sync_clock(Component& c, Placement& q, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    time_t now = time(nullptr);
    struct tm tm; localtime_r(&now, &tm);
    bool synced = (now > 1700000000);   // heure NTP obtenue ? (sinon 1970)
    if (!c.clock_analog) {              // DIGITAL
        if (!synced) { lv_label_set_text(w, "--:--"); return; }
        char buf[24];
        clock_format_digital(tm.tm_hour, tm.tm_min, tm.tm_sec, c.show_seconds, buf, sizeof(buf));
        lv_label_set_text(w, buf);
        return;
    }
    if (!synced) return;
    int r = q.radius ? q.radius : 80;
    int idx = q.comp_index;
    if (idx < 0 || idx >= MAX_COMPONENTS) return;
    float ah, am, as; clock_hand_angles(tm.tm_hour, tm.tm_min, tm.tm_sec, &ah, &am, &as);
    const float DEG2RAD = 3.14159265f / 180.0f;
    struct { float deg; float len; int k; } hands[3] = {
        { ah, r * 0.5f, 0 }, { am, r * 0.72f, 1 }, { as, r * 0.8f, 2 },
    };
    int nlines = c.show_seconds ? 3 : 2;
    int child0 = lv_obj_get_child_count(w) - nlines;   // aiguilles = derniers enfants (ticks avant)
    for (int j = 0; j < nlines; j++) {
        float rad = hands[j].deg * DEG2RAD;
        s_clock_pts[idx][j][1].x = (lv_value_precise_t)(r + hands[j].len * sinf(rad));
        s_clock_pts[idx][j][1].y = (lv_value_precise_t)(r - hands[j].len * cosf(rad));
        lv_obj_t* ln = lv_obj_get_child(w, child0 + j);
        if (ln) lv_line_set_points(ln, s_clock_pts[idx][j], 2);   // re-set : force le refresh
    }
}
```

> **NOTE :** ajouter `#include <time.h>` et `#include <math.h>` en tête de `view.cpp` s'ils manquent. Vérifier que ré-appeler `lv_line_set_points` avec le même pointeur (contenu muté) invalide bien le rendu ; sinon `lv_obj_invalidate(ln)`.

Enregistrer dans `VIEW[]` : `/* COMP_CLOCK */ { build_clock, sync_clock },`.

- [ ] **Step 4 : Tick 1 s dans `loop()`**

`src/main.cpp`, dans `loop()`, à côté du bloc `last_sec` du countdown :

```cpp
    static uint32_t last_clock = 0;
    if (now_ms - last_clock >= 1000) { last_clock = now_ms; dash_tick_clock(&g_dash); }
```

- [ ] **Step 5 : Compiler**

Run: `pio run -e esp32s3`
Expected: SUCCESS (les `static_assert` VIEW/APPLY/NAMES passent).

- [ ] **Step 6 : Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/view.cpp src/main.cpp
git commit -m "feat(clock): firmware — type clock analog/digital, tick 1s, heure NTP

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 1.3 : Designer — `clock` (schéma, rendu, registre, inspecteur, i18n)

**Files:**
- Modify: `schema/layout.schema.json` (`oneOf` + `$def comp_clock`)
- Modify: `designer/js/render.js` (`buildClock` + `MOCKS.clock`)
- Modify: `designer/js/registry.js` (import + entrée)
- Modify: `designer/js/icons.js` (`PATHS.clock`)
- Modify: `designer/js/canvas-zones.js` (`FAMILY.clock`)
- Modify: `designer/js/inspector.js` (`SELECTS.clockmode`)
- Modify: `designer/i18n/en.js`, `designer/i18n/fr.json`
- Test: `designer/tests/render.test.js`, `designer/tests/registry.test.js` (déjà générique)

- [ ] **Step 1 : Schéma — `$def comp_clock` + entrée `oneOf`**

Dans `oneOf` (~L106-127) ajouter `{ "$ref": "#/$defs/comp_clock" },`. Définir le `$def` (à côté des autres `comp_*`) :

```json
    "comp_clock": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "description": "Affichage : horloge (heure du device via NTP). Aucun bind. mode analog|digital.",
      "properties": {
        "type": { "const": "clock" },
        "visible": { "type": "boolean" },
        "mode": { "enum": ["analog", "digital"], "description": "Cadran (analog) ou texte HH:MM (digital). Defaut analog." },
        "show_seconds": { "type": "boolean", "description": "Affiche les secondes. Defaut false." },
        "show_date": { "type": "boolean", "description": "Affiche la date. Defaut false." },
        "color": { "$ref": "#/$defs/hexColor" },
        "font": { "$ref": "#/$defs/font" },
        "font_family": { "$ref": "#/$defs/fontFamily" },
        "bold": { "type": "boolean" },
        "italic": { "type": "boolean" }
      }
    },
```

- [ ] **Step 2 : Test de rendu (écrire avant le builder)**

Dans `designer/tests/render.test.js`, importer `buildClock` puis :

```js
test('buildClock: analog → svg avec aiguilles ; digital → texte HH:MM', () => {
  const analog = render.buildClock({ type: 'clock', mode: 'analog', color: '#FFFFFF' }, { radius: 80 });
  assert.equal(analog.querySelectorAll('line').length >= 2, true);   // ≥ 2 aiguilles
  const digital = render.buildClock({ type: 'clock', mode: 'digital' }, {});
  assert.match(digital.textContent, /\d\d:\d\d/);
});
```

- [ ] **Step 3 : `buildClock` (render.js) — cadran d'exemple 10:10**

Ajouter dans `designer/js/render.js` (après `buildRoller`) et l'entrée `MOCKS` :

```js
// MOCKS : pas de valeur poussée pour clock (heure synthétique d'aperçu)
// buildClock rend une heure figée 10:10:36 (parité d'ALLURE, pas de sync live).
export function buildClock(comp, placement = {}) {
  if (comp.mode === 'digital') {
    const n = document.createElement('div');
    n.className = 'w w-clock';
    n.style.font = font(comp.font_family, comp.bold, comp.italic, pickFontPx(comp.font ?? 28));
    n.style.color = comp.color || '#FFFFFF';
    n.textContent = comp.show_seconds ? '10:10:36' : '10:10';
    return n;
  }
  const r = placement.radius || 80, size = r * 2;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.classList.add('w', 'w-clock');
  const col = comp.color || '#FFFFFF';
  const hand = (deg, len, w, c) => {
    const rad = deg * Math.PI / 180;
    const p = document.createElementNS(SVGNS, 'line');
    p.setAttribute('x1', r); p.setAttribute('y1', r);
    p.setAttribute('x2', (r + len * Math.sin(rad)).toFixed(1));
    p.setAttribute('y2', (r - len * Math.cos(rad)).toFixed(1));
    p.setAttribute('stroke', c); p.setAttribute('stroke-width', w); p.setAttribute('stroke-linecap', 'round');
    svg.appendChild(p);
  };
  // 4 ticks cardinaux
  [0, 90, 180, 270].forEach(deg => hand(deg, r * 0.08, 3, '#3a4a63'));   // court, depuis le bord — approx
  hand(305, r * 0.5, 6, col);   // heure ~10:10
  hand(60,  r * 0.72, 4, col);  // minute
  if (comp.show_seconds) hand(216, r * 0.8, 2, '#38BDF8');
  return svg;
}
```

> Réutiliser `SVGNS`, `font`, `pickFontPx` déjà définis dans render.js.

- [ ] **Step 4 : `registry.js` — import + entrée `COMPONENTS.clock`**

Ajouter `buildClock` à l'import depuis `./render.js`. Entrée :

```js
  clock: {
    label: 'comp.clock',
    defaults: () => ({ type: 'clock', mode: 'analog', color: '#FFFFFF' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), radius: 80 }),
    centered: false, physical: false,
    compFields: [['mode', 'field.clock_mode', 'clockmode'], ['show_seconds', 'field.show_seconds', 'bool'],
                 ['show_date', 'field.show_date', 'bool'], ['color', 'field.color', 'color'],
                 ['font', 'field.font', 'font'], ['font_family', 'field.font_family', 'fontfamily']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['radius', 'field.radius', 'num', 80]],
    mockFields: [],
    build: (comp, pl) => buildClock(comp, pl),
  },
```

- [ ] **Step 5 : Icône + famille + select**

- `designer/js/icons.js` `PATHS` : `clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',`
- `designer/js/canvas-zones.js` `FAMILY` : ajouter `clock: 'data',`
- `designer/js/inspector.js` `SELECTS` : ajouter `clockmode: [['analog', 'select.clockmode.analog'], ['digital', 'select.clockmode.digital']],`

- [ ] **Step 6 : i18n (EN + FR, clés identiques)**

`designer/i18n/en.js` : `'comp.clock': 'Clock',` + `'field.clock_mode': 'Mode',` `'field.show_seconds': 'Seconds',` `'field.show_date': 'Date',` + `'select.clockmode.analog': 'Analog',` `'select.clockmode.digital': 'Digital',`
`designer/i18n/fr.json` (mêmes clés) : `"comp.clock": "Horloge",` `"field.clock_mode": "Mode",` `"field.show_seconds": "Secondes",` `"field.show_date": "Date",` `"select.clockmode.analog": "Analogique",` `"select.clockmode.digital": "Numérique",`

- [ ] **Step 7 : Lancer les tests designer**

Run: `cd designer && node --test`
Expected: PASS (dont `registry.test.js` qui vérifie clés registre == types schéma == icônes, et le test `buildClock`).

- [ ] **Step 8 : Commit**

```bash
git add schema/layout.schema.json designer/js/render.js designer/js/registry.js designer/js/icons.js designer/js/canvas-zones.js designer/js/inspector.js designer/i18n/en.js designer/i18n/fr.json designer/tests/render.test.js
git commit -m "feat(clock): designer — schema, buildClock, registre, inspecteur, i18n

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

## Phase 2 — `rings` (affichage, famille *data*, 1-3 pistes concentriques)

### Task 2.1 : Logique pure rayon de piste (natif + test)

**Files:**
- Create: `src/ring_geom.h`, `src/ring_geom.cpp`
- Modify: `platformio.ini` (`+<ring_geom.cpp>`)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1 : Test d'abord**

`#include "ring_geom.h"` en tête de `test_main.cpp`, puis :

```cpp
void test_ring_track_radius(void) {
    // outer=90, thickness=16, gap entre pistes=4 → piste 0 centrée à 90-8=82
    TEST_ASSERT_EQUAL_INT(82, ring_track_radius(0, 90, 16, 4));
    TEST_ASSERT_EQUAL_INT(62, ring_track_radius(1, 90, 16, 4));   // -(16+4)
    TEST_ASSERT_EQUAL_INT(42, ring_track_radius(2, 90, 16, 4));
}
```

Enregistrer `RUN_TEST(test_ring_track_radius);`.

- [ ] **Step 2 : Lancer → échec**

Run: `pio test -e native`
Expected: FAIL (module absent).

- [ ] **Step 3 : `ring_geom.h` + `.cpp`**

```cpp
// ring_geom.h
#pragma once
// Rayon (au centre de la bande) de la piste `index` (0 = extérieure). Pur.
int ring_track_radius(int index, int outer_radius, int thickness, int gap);
```
```cpp
// ring_geom.cpp
#include "ring_geom.h"
int ring_track_radius(int index, int outer_radius, int thickness, int gap) {
    return outer_radius - thickness / 2 - index * (thickness + gap);
}
```

- [ ] **Step 4 : Filtre natif + lancer → passe**

Ajouter `+<ring_geom.cpp>` à `platformio.ini`. Run: `pio test -e native` → PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/ring_geom.h src/ring_geom.cpp platformio.ini test/test_core/test_main.cpp
git commit -m "feat(rings): logique pure rayon de piste (+test natif)

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 2.2 : Firmware — type `rings`, pistes, push tableau + binds

**Files:**
- Modify: `src/dashboard.h` (enum + struct `RingTrack` + `Component`)
- Modify: `src/dashboard.cpp` (`COMP_NAMES`, `APPLY`=`apply_rings`, `context_apply`, parse)
- Modify: `src/view.cpp` (`build_rings`, `sync_rings`, `VIEW[]`)

- [ ] **Step 1 : Struct `RingTrack` + champs Component + enum**

`src/dashboard.h` : `COMP_RINGS` avant `COMP_COUNT`. Ajouter :

```cpp
struct RingTrack { char bind[ID_LEN]; int vmin, vmax; uint32_t color; int32_t value; };
```

dans `struct Component` :

```cpp
    RingTrack tracks[MAX_RING_TRACKS];
    int       track_count;
```

- [ ] **Step 2 : Parse (dashboard.cpp)**

Bloc config par type :

```cpp
    if (c.type == COMP_RINGS) {
        JsonArrayConst arr = o["tracks"].as<JsonArrayConst>();
        c.track_count = 0;
        for (JsonObjectConst t : arr) {
            if (c.track_count >= MAX_RING_TRACKS) break;
            RingTrack& rt = c.tracks[c.track_count++];
            strlcpy(rt.bind, t["bind"] | "", sizeof(rt.bind));
            rt.vmin = t["min"] | 0;
            rt.vmax = t["max"] | 100;
            rt.color = parse_color(t["color"] | "#38BDF8");   // grep le helper de couleur réel
            rt.value = rt.vmin;
        }
    }
```

- [ ] **Step 3 : `apply_rings` + `APPLY[]` + `context_apply`**

`apply_rings` (push-by-id : tableau `[v0,v1,v2]`) :

```cpp
static void apply_rings(Component& c, JsonVariantConst v) {
    JsonArrayConst arr = v.is<JsonArrayConst>() ? v.as<JsonArrayConst>() : v["tracks"].as<JsonArrayConst>();
    int i = 0;
    for (JsonVariantConst e : arr) { if (i >= c.track_count) break; c.tracks[i++].value = e.as<int>(); }
}
```

`APPLY[]` : `/* COMP_RINGS */ apply_rings,`.

`context_apply` (switch) : lire chaque bind de piste dans le contexte :

```cpp
        case COMP_RINGS:
            for (int t = 0; t < c.track_count; t++) {
                double val;
                if (c.tracks[t].bind[0] && ctx_get_num(&d->ctx, c.tracks[t].bind, &val))
                    c.tracks[t].value = (int32_t)val;
            }
            break;
```

> Aligner `ctx_get_num` sur le vrai lecteur du blackboard (grep dans `context.h` : le nom exact de la fonction que `context_apply` utilise déjà pour ring/bar).

- [ ] **Step 4 : `build_rings` + `sync_rings` (view.cpp)**

```cpp
static void build_rings(lv_obj_t* parent, Component& c, Placement& q,
                        lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    int outer = q.radius ? q.radius : 90;
    int th = q.thickness ? q.thickness : 14;
    lv_obj_t* box = lv_obj_create(parent);
    lv_obj_remove_style_all(box);
    lv_obj_set_size(box, outer * 2, outer * 2);
    lv_obj_center(box);
    lv_obj_clear_flag(box, LV_OBJ_FLAG_SCROLLABLE);
    for (int t = 0; t < c.track_count; t++) {
        int r = ring_track_radius(t, outer, th, 4);
        lv_obj_t* arc = lv_arc_create(box);
        lv_obj_set_size(arc, r * 2, r * 2);
        lv_obj_center(arc);
        lv_obj_remove_style(arc, NULL, LV_PART_KNOB);
        lv_obj_clear_flag(arc, LV_OBJ_FLAG_CLICKABLE);
        lv_arc_set_bg_angles(arc, 90, 90 + 359);   // anneau quasi complet ; ajuster si gap voulu
        lv_arc_set_range(arc, c.tracks[t].vmin, c.tracks[t].vmax);
        lv_obj_set_style_arc_width(arc, th, LV_PART_MAIN);
        lv_obj_set_style_arc_width(arc, th, LV_PART_INDICATOR);
        lv_obj_set_style_arc_color(arc, lv_color_hex(0x1F2937), LV_PART_MAIN);
        lv_obj_set_style_arc_color(arc, lv_color_hex(c.tracks[t].color), LV_PART_INDICATOR);
        lv_obj_set_style_pad_all(arc, 0, LV_PART_MAIN);
        lv_obj_set_style_arc_rounded(arc, true, LV_PART_INDICATOR);
    }
    *main = box;
}

static void sync_rings(Component& c, Placement&, lv_obj_t* box, lv_obj_t*, lv_obj_t*) {
    for (int t = 0; t < c.track_count && t < (int)lv_obj_get_child_count(box); t++)
        lv_arc_set_value(lv_obj_get_child(box, t), c.tracks[t].value);
}
```

`VIEW[]` : `/* COMP_RINGS */ { build_rings, sync_rings },`.

- [ ] **Step 5 : Compiler**

Run: `pio run -e esp32s3`
Expected: SUCCESS.

- [ ] **Step 6 : Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/view.cpp
git commit -m "feat(rings): firmware — pistes concentriques, push tableau + binds

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 2.3 : Designer — `rings` (schéma, rendu, registre, éditeur de pistes, i18n)

**Files:**
- Modify: `schema/layout.schema.json` (`oneOf` + `$def comp_rings` + `$def ring_track`)
- Modify: `designer/js/render.js` (`buildRings` + `MOCKS.rings`)
- Modify: `designer/js/registry.js`, `designer/js/icons.js`, `designer/js/canvas-zones.js`
- Modify: `designer/js/inspector.js` (éditeur bespoke `tracks`)
- Modify: `designer/i18n/en.js`, `fr.json`
- Test: `designer/tests/render.test.js`

- [ ] **Step 1 : Schéma**

`oneOf` : `{ "$ref": "#/$defs/comp_rings" },`. `$defs` :

```json
    "ring_track": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "bind": { "$ref": "#/$defs/id", "description": "Variable lue (pull/context) pour cette piste." },
        "min": { "type": "number", "description": "Defaut 0." },
        "max": { "type": "number", "description": "Defaut 100." },
        "color": { "$ref": "#/$defs/hexColor" }
      }
    },
    "comp_rings": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "description": "Affichage : 1-3 anneaux concentriques. Push par ID : {\"id\":[v0,v1,v2]}. Chaque piste a un bind optionnel (pull).",
      "properties": {
        "type": { "const": "rings" },
        "visible": { "type": "boolean" },
        "tracks": { "type": "array", "maxItems": 3, "items": { "$ref": "#/$defs/ring_track" } }
      }
    },
```

- [ ] **Step 2 : Test de rendu (avant builder)**

```js
test('buildRings: un arc par piste', () => {
  const el = render.buildRings(
    { type: 'rings', tracks: [{ color: '#34D399' }, { color: '#38BDF8' }] },
    { radius: 90 }, { values: [70, 40] });
  assert.equal(el.querySelectorAll('path.rings-ind').length, 2);
});
```

- [ ] **Step 3 : `buildRings` (render.js)**

Réutilise `arcPath`/`ringPaths` déjà présents. Version simple (anneau quasi complet par piste) :

```js
export const _RINGS_MOCK = { values: [72, 55, 40] };
export function buildRings(comp, placement = {}, mock = _RINGS_MOCK) {
  const outer = placement.radius || 90, th = placement.thickness || 14, size = outer * 2;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.classList.add('w', 'w-rings');
  const tracks = Array.isArray(comp.tracks) ? comp.tracks : [];
  tracks.forEach((tk, i) => {
    const r = outer - th / 2 - i * (th + 4);
    const frac = Math.max(0, Math.min(1, ((mock.values?.[i] ?? 0) - (tk.min ?? 0)) / ((tk.max ?? 100) - (tk.min ?? 0) || 1)));
    const track = arcPath(outer, outer, r, 90, 359);           // fond
    const ind = arcPath(outer, outer, r, 90, 359 * frac);      // indicateur
    const mk = (cls, d, stroke) => {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('class', cls); p.setAttribute('d', d);
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', th); p.setAttribute('stroke-linecap', 'round');
      svg.appendChild(p);
    };
    mk('rings-track', track, '#1F2937');
    mk('rings-ind', ind, tk.color || '#38BDF8');
  });
  return svg;
}
```

- [ ] **Step 4 : `registry.js`**

Import `buildRings`. Entrée :

```js
  rings: {
    label: 'comp.rings',
    defaults: () => ({ type: 'rings', tracks: [{ min: 0, max: 100, color: '#34D399' }] }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), radius: 90, thickness: 14 }),
    centered: true, physical: false,
    compFields: [['tracks', 'field.tracks', 'tracks']],
    placeFields: [['radius', 'field.radius', 'num', 90], ['thickness', 'field.thickness', 'num', 14],
                  ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num']],
    mockFields: [],
    build: (comp, pl) => buildRings(comp, pl),
  },
```

- [ ] **Step 5 : Icône + famille**

- `icons.js` : `rings: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/>',`
- `canvas-zones.js` `FAMILY` : `rings: 'data',`

- [ ] **Step 6 : Éditeur de pistes (inspector.js, bespoke `kind:'tracks'`)**

Dans la boucle `compFields` de `renderComp`, ajouter la branche (comme `if (kind === 'options')`) :

```js
        if (kind === 'tracks') { propBody.appendChild(tracksField(label, c)); continue; }
```

Et définir `tracksField` (patron calqué sur la section seuils `renderExtras:214-237` — liste éditable, bouton +, max 3) :

```js
  function tracksField(label, c) {
    const ref = sel.ref;
    const wrap = document.createElement('div'); wrap.className = 'insp-tracks';
    const tracks = Array.isArray(c.tracks) ? c.tracks : [];
    tracks.forEach((tk, i) => {
      const row = document.createElement('div'); row.className = 'insp-row';
      const bind = makeInput('idtext', tk.bind ?? '', v => model.commit(s => { setTrackProp(s, ref, i, 'bind', v); }));
      const min = makeInput('num', tk.min ?? '', v => model.commit(s => { setTrackProp(s, ref, i, 'min', v); }, { coalesce: 'num' }));
      const max = makeInput('num', tk.max ?? '', v => model.commit(s => { setTrackProp(s, ref, i, 'max', v); }, { coalesce: 'num' }));
      const col = makeInput('color', tk.color ?? '#38BDF8', v => model.commit(s => { setTrackProp(s, ref, i, 'color', v); }));
      const del = document.createElement('button'); del.textContent = '×';
      del.addEventListener('click', () => model.commit(s => removeTrack(s, ref, i)));
      row.append(bind, min, max, col, del); wrap.appendChild(row);
    });
    if (tracks.length < 3) {
      const add = document.createElement('button'); add.textContent = t('inspector.btn.add_track');
      add.addEventListener('click', () => model.commit(s => addTrack(s, ref)));
      wrap.appendChild(add);
    }
    return wrap;
  }
```

Ajouter les mutations `setTrackProp/addTrack/removeTrack` dans `designer/js/mutations.js` (grep `setComponentProp` pour le patron) et les tester dans `designer/tests/mutations.test.js` :

```js
// mutations.js
export function setTrackProp(state, ref, i, key, v) {
  const c = state.components[ref]; if (!c.tracks) c.tracks = [];
  if (v === '' || v == null) delete c.tracks[i][key]; else c.tracks[i][key] = v;
}
export function addTrack(state, ref) {
  const c = state.components[ref]; c.tracks = c.tracks || [];
  if (c.tracks.length < 3) c.tracks.push({ min: 0, max: 100, color: '#38BDF8' });
}
export function removeTrack(state, ref, i) {
  const c = state.components[ref]; if (Array.isArray(c.tracks)) c.tracks.splice(i, 1);
}
```

- [ ] **Step 7 : i18n**

EN : `'comp.rings': 'Rings',` `'field.tracks': 'Tracks',` `'inspector.btn.add_track': '+ Track',`
FR : `"comp.rings": "Anneaux",` `"field.tracks": "Pistes",` `"inspector.btn.add_track": "+ Piste",`

- [ ] **Step 8 : Lancer les tests**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 9 : Commit**

```bash
git add schema/layout.schema.json designer/js/render.js designer/js/registry.js designer/js/icons.js designer/js/canvas-zones.js designer/js/inspector.js designer/js/mutations.js designer/i18n/en.js designer/i18n/fr.json designer/tests/
git commit -m "feat(rings): designer — schema, buildRings, editeur de pistes, i18n

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

## Phase 3 — `qr` (affichage, famille *rich*, ECC MEDIUM)

### Task 3.1 : Firmware — type `qr`

**Files:**
- Modify: `src/dashboard.h` (enum ; `qr` réutilise `c.vstr` pour le texte + `c.color`/`c.fill`)
- Modify: `src/dashboard.cpp` (`COMP_NAMES`, `apply_qr`, `context_apply`, parse défaut texte)
- Modify: `src/view.cpp` (`build_qr`, `sync_qr`, `VIEW[]`)

- [ ] **Step 1 : Enum + parse**

`COMP_QR` avant `COMP_COUNT`. `COMP_NAMES` : `{ "qr", COMP_QR },`. Parse (texte initial dans `vstr`, couleurs dark/light via `color`/`fill`) :

```cpp
    if (c.type == COMP_QR) {
        strlcpy(c.vstr, o["text"] | "", sizeof(c.vstr));   // vide → URL device calculée au build
    }
```

- [ ] **Step 2 : `apply_qr` + `APPLY[]` + `context_apply`**

```cpp
static void apply_qr(Component& c, JsonVariantConst v) {
    JsonVariantConst out;
    if (value_present(v, out) && out.is<const char*>()) strlcpy(c.vstr, out.as<const char*>(), sizeof(c.vstr));
}
```

`APPLY[]` : `/* COMP_QR */ apply_qr,`. `context_apply` : `case COMP_QR:` lit le bind string dans `vstr` (mirrorer `apply_label`/le cas string existant — grep comment `readout`/`label` lisent une string du ctx).

- [ ] **Step 3 : `build_qr` + `sync_qr` (view.cpp)**

Signatures depuis `lv_qrcode.h` (vérifiées) : `lv_qrcode_create`, `lv_qrcode_set_size`, `lv_qrcode_set_dark_color`, `lv_qrcode_set_light_color`, `lv_qrcode_update(obj, data, len)`.

```cpp
static void qr_effective_text(Component& c, char* out, size_t n) {
    if (c.vstr[0]) strlcpy(out, c.vstr, n);
    else snprintf(out, n, "http://%s.local", MDNS_HOST);   // URL device par défaut
}
static void build_qr(lv_obj_t* parent, Component& c, Placement& q,
                     lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* qr = lv_qrcode_create(parent);
    int sz = q.size ? q.size : (q.width ? q.width : 140);
    lv_qrcode_set_size(qr, sz);
    lv_qrcode_set_dark_color(qr, lv_color_hex(c.color ? c.color : 0x05070D));
    lv_qrcode_set_light_color(qr, lv_color_hex(c.fill_set ? c.fill : 0xE8EEF7));
    char txt[TEXT_LEN]; qr_effective_text(c, txt, sizeof(txt));
    lv_qrcode_update(qr, txt, strlen(txt));
    lv_obj_align(qr, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = qr;
}
static void sync_qr(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    char txt[TEXT_LEN]; qr_effective_text(c, txt, sizeof(txt));
    lv_qrcode_update(w, txt, strlen(txt));
}
```

`VIEW[]` : `/* COMP_QR */ { build_qr, sync_qr },`. Vérifier que `MDNS_HOST` est bien la macro du host mDNS (grep dans `config.h`/`main.cpp`).

- [ ] **Step 4 : Compiler**

Run: `pio run -e esp32s3`
Expected: SUCCESS (LV_USE_QRCODE actif depuis Task 0.3).

- [ ] **Step 5 : Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/view.cpp
git commit -m "feat(qr): firmware — lv_qrcode, texte via bind/text, URL device par defaut

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 3.2 : Designer — `qr` (schéma, rendu via qrModules, registre, i18n)

**Files:**
- Modify: `schema/layout.schema.json`
- Modify: `designer/js/render.js` (`buildQr`)
- Modify: `designer/js/registry.js`, `icons.js`, `canvas-zones.js`
- Modify: `designer/i18n/en.js`, `fr.json`
- Test: `designer/tests/render.test.js`

- [ ] **Step 1 : Schéma**

`oneOf` : `{ "$ref": "#/$defs/comp_qr" },`. `$def` :

```json
    "comp_qr": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "description": "Affichage : QR code (ECC MEDIUM, comme lv_qrcode). text vide = URL device.",
      "properties": {
        "type": { "const": "qr" },
        "visible": { "type": "boolean" },
        "bind": { "$ref": "#/$defs/id", "description": "Variable (string) lue pour remplacer text." },
        "text": { "$ref": "#/$defs/display", "description": "Texte encodé. Vide = URL du device." },
        "color": { "$ref": "#/$defs/hexColor", "description": "Modules sombres (défaut #05070D)." }
      }
    },
```

- [ ] **Step 2 : Test de rendu (avant builder)**

```js
test('buildQr: dessine une grille de modules (svg non vide)', () => {
  const el = render.buildQr({ type: 'qr', text: 'http://dialboard.local' }, { size: 140 });
  assert.ok(el.querySelectorAll('rect').length > 10);   // modules noirs
});
```

- [ ] **Step 3 : `buildQr` (render.js) — via `qrModules`**

```js
import { qrModules } from './qr.js';   // en tête de render.js
...
export function buildQr(comp, placement = {}) {
  const size = placement.size || placement.width || 140;
  const text = comp.text || 'http://dialboard.local';
  const { size: n, get } = qrModules(text);
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
  svg.classList.add('w', 'w-qr');
  const bg = document.createElementNS(SVGNS, 'rect');
  bg.setAttribute('width', n); bg.setAttribute('height', n);
  bg.setAttribute('fill', '#E8EEF7'); svg.appendChild(bg);
  const dark = comp.color || '#05070D';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!get(x, y)) continue;
    const r = document.createElementNS(SVGNS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y);
    r.setAttribute('width', 1); r.setAttribute('height', 1); r.setAttribute('fill', dark);
    svg.appendChild(r);
  }
  return svg;
}
```

- [ ] **Step 4 : `registry.js` + icône + famille**

```js
  qr: {
    label: 'comp.qr',
    defaults: () => ({ type: 'qr', text: '' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), size: 140 }),
    centered: false, physical: false,
    compFields: [['bind', 'field.bind', 'idtext'], ['text', 'field.text', 'latintext'], ['color', 'field.color', 'color']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['size', 'field.size', 'num', 140]],
    mockFields: [],
    build: (comp, pl) => buildQr(comp, pl),
  },
```

- `icons.js` : `qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M20 20v.01"/>',`
- `canvas-zones.js` `FAMILY` : `qr: 'rich',`

- [ ] **Step 5 : i18n**

EN : `'comp.qr': 'QR code',` (réutilise `field.text`, `field.bind`, `field.color`, `field.size` s'ils existent — sinon ajouter `'field.size': 'Size',`).
FR : `"comp.qr": "QR code",` (+ `"field.size": "Taille",` si absent).

- [ ] **Step 6 : Lancer**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add schema/layout.schema.json designer/js/render.js designer/js/registry.js designer/js/icons.js designer/js/canvas-zones.js designer/i18n/en.js designer/i18n/fr.json designer/tests/render.test.js
git commit -m "feat(qr): designer — schema, buildQr via qrModules (parité MEDIUM), i18n

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

## Phase 4 — `stepper` (effecteur, famille *effectors*, source)

### Task 4.1 : Logique pure clamp (natif + test)

**Files:**
- Create: `src/stepper_logic.h`, `src/stepper_logic.cpp`
- Modify: `platformio.ini` (`+<stepper_logic.cpp>`)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1 : Test d'abord**

```cpp
void test_stepper_step(void) {
    TEST_ASSERT_EQUAL_INT(25, stepper_step(20, +1, 5, 0, 100));   // +step(5)
    TEST_ASSERT_EQUAL_INT(0,  stepper_step(3,  -1, 5, 0, 100));   // clamp bas
    TEST_ASSERT_EQUAL_INT(100, stepper_step(98, +1, 5, 0, 100));  // clamp haut
    TEST_ASSERT_EQUAL_INT(21, stepper_step(20, +1, 0, 0, 100));   // step<=0 → 1
}
```

`RUN_TEST(test_stepper_step);` + `#include "stepper_logic.h"`.

- [ ] **Step 2 : Lancer → échec** — `pio test -e native` → FAIL.

- [ ] **Step 3 : Module**

```cpp
// stepper_logic.h
#pragma once
int stepper_step(int value, int dir, int step, int vmin, int vmax);   // dir = +1 / -1
```
```cpp
// stepper_logic.cpp
#include "stepper_logic.h"
int stepper_step(int value, int dir, int step, int vmin, int vmax) {
    int s = step > 0 ? step : 1;
    int v = value + dir * s;
    if (v < vmin) v = vmin;
    if (v > vmax) v = vmax;
    return v;
}
```

- [ ] **Step 4 : Filtre + lancer → passe** — `+<stepper_logic.cpp>`, `pio test -e native` → PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/stepper_logic.h src/stepper_logic.cpp platformio.ini test/test_core/test_main.cpp
git commit -m "feat(stepper): logique pure step+clamp (+test natif)

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 4.2 : Firmware — effecteur `stepper`

**Files:**
- Modify: `src/dashboard.h` (enum ; réutilise `vmin/vmax/step/value/bind/color/unit`)
- Modify: `src/dashboard.cpp` (`COMP_NAMES`, `APPLY`=nullptr, `context_apply` groupé)
- Modify: `src/view.cpp` (`build_stepper`, `sync_stepper`, 2 event_cb, `VIEW[]`)

- [ ] **Step 1 : Enum + COMP_NAMES + APPLY + context_apply**

`COMP_STEPPER` avant `COMP_COUNT`. `COMP_NAMES` : `{ "stepper", COMP_STEPPER },`. `APPLY[]` : `/* COMP_STEPPER */ nullptr,` (effecteur). `context_apply` : ajouter `case COMP_STEPPER:` au groupe `SLIDER/ARC/ROLLER` (lecture var→`c.value`).

- [ ] **Step 2 : `build_stepper` + `sync_stepper` + event_cb (view.cpp)**

Forward decl (près L547-551) : `static void stepper_minus_cb(lv_event_t* e); static void stepper_plus_cb(lv_event_t* e);`

```cpp
static void stepper_label_text(Component& c, char* out, size_t n) {
    if (c.unit[0]) snprintf(out, n, "%d%s", (int)c.value, c.unit);
    else           snprintf(out, n, "%d", (int)c.value);
}
static void build_stepper(lv_obj_t* parent, Component& c, Placement& q,
                          lv_obj_t** main, lv_obj_t** sub1, lv_obj_t**) {
    lv_obj_t* box = lv_obj_create(parent);
    lv_obj_remove_style_all(box);
    lv_obj_set_size(box, q.width ? q.width : 200, q.height ? q.height : 80);
    lv_obj_set_flex_flow(box, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(box, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_align(box, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_obj_t* minus = lv_button_create(box);
    lv_obj_set_user_data(minus, &c);
    lv_obj_add_event_cb(minus, stepper_minus_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* ml = lv_label_create(minus); lv_label_set_text(ml, "-");
    lv_obj_t* val = lv_label_create(box);
    lv_obj_set_style_text_font(val, get_font(c.font_family, c.font, c.bold, c.italic), 0);
    lv_obj_set_style_text_color(val, lv_color_hex(c.color), 0);
    char b[24]; stepper_label_text(c, b, sizeof(b)); lv_label_set_text(val, b);
    lv_obj_t* plus = lv_button_create(box);
    lv_obj_set_user_data(plus, &c);
    lv_obj_add_event_cb(plus, stepper_plus_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* pl = lv_label_create(plus); lv_label_set_text(pl, "+");
    *main = box;
    *sub1 = val;   // le label central (sync)
}
static void sync_stepper(Component& c, Placement&, lv_obj_t*, lv_obj_t* val, lv_obj_t*) {
    if (val) { char b[24]; stepper_label_text(c, b, sizeof(b)); lv_label_set_text(val, b); }
}
```

Les event_cb (dans la zone `s_dash`, patron slider/arc) :

```cpp
static void stepper_apply(Component* c, int dir) {
    if (!c || !s_dash) return;
    c->value = stepper_step(c->value, dir, c->step, c->vmin, c->vmax);
    if (c->bind[0]) {
        if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
        dash_ctx_write_ui_num(s_dash, c->bind, (double)c->value, millis());
        if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
    }
    c->dirty = true; s_dash->values_dirty = true;   // met à jour le label central
}
static void stepper_minus_cb(lv_event_t* e) { stepper_apply((Component*)lv_obj_get_user_data(lv_event_get_target_obj(e)), -1); }
static void stepper_plus_cb(lv_event_t* e)  { stepper_apply((Component*)lv_obj_get_user_data(lv_event_get_target_obj(e)), +1); }
```

`VIEW[]` : `/* COMP_STEPPER */ { build_stepper, sync_stepper },`.

> **NOTE :** `lv_button_create` = `lv_btn_create` selon la version — vérifier le nom en LVGL 9.5 (Context7). `c.step` doit être lu au parse (grep : slider lit déjà `step` pour tous via le parse générique — sinon ajouter la lecture).

- [ ] **Step 3 : Compiler** — `pio run -e esp32s3` → SUCCESS.

- [ ] **Step 4 : Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/view.cpp
git commit -m "feat(stepper): firmware — effecteur +/- (push consigne sur le bus)

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 4.3 : Designer — `stepper`

**Files:**
- Modify: `schema/layout.schema.json`, `render.js`, `registry.js`, `icons.js`, `canvas-zones.js`, i18n
- Test: `designer/tests/render.test.js`

- [ ] **Step 1 : Schéma**

`oneOf` : `{ "$ref": "#/$defs/comp_stepper" },`. `$def` :

```json
    "comp_stepper": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "description": "Effecteur : incrément +/- ; écrit bind = valeur (origine UI).",
      "properties": {
        "type": { "const": "stepper" },
        "visible": { "type": "boolean" },
        "bind": { "$ref": "#/$defs/id", "description": "Variable écrite (origine UI)." },
        "min": { "type": "number" }, "max": { "type": "number" },
        "step": { "type": "integer", "description": "Pas (défaut 1)." },
        "unit": { "$ref": "#/$defs/display" },
        "color": { "$ref": "#/$defs/hexColor" }
      }
    },
```

- [ ] **Step 2 : Test de rendu (avant builder)**

```js
test('buildStepper: deux boutons + valeur', () => {
  const el = render.buildStepper({ type: 'stepper', unit: '°' }, {}, { value: 21 });
  assert.match(el.textContent, /21/);
  assert.equal(el.querySelectorAll('.w-step-btn').length, 2);
});
```

- [ ] **Step 3 : `buildStepper` (render.js) + `MOCKS.stepper`**

```js
// MOCKS.stepper: { value: 21 }
export function buildStepper(comp, placement = {}, mock = { value: 21 }) {
  const wrap = document.createElement('div');
  wrap.className = 'w w-stepper';
  const mk = (txt) => { const b = document.createElement('div'); b.className = 'w-step-btn'; b.textContent = txt; return b; };
  const val = document.createElement('div'); val.className = 'w-step-val';
  val.style.font = font(comp.font_family, comp.bold, comp.italic, pickFontPx(comp.font ?? 32));
  val.style.color = comp.color || '#FFFFFF';
  val.textContent = `${mock.value}${comp.unit || ''}`;
  wrap.append(mk('−'), val, mk('+'));
  return wrap;
}
```

- [ ] **Step 4 : `registry.js` + icône + famille**

```js
  stepper: {
    label: 'comp.stepper',
    defaults: () => ({ type: 'stepper', min: 0, max: 100, step: 1, color: '#FFFFFF' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), width: 200, height: 80 }),
    centered: false, physical: false,
    compFields: [['bind', 'field.bind', 'idtext'], ['min', 'field.min', 'num'], ['max', 'field.max', 'num'],
                 ['step', 'field.step', 'num'], ['unit', 'field.unit', 'latintext'], ['color', 'field.color', 'color']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['width', 'field.width', 'num', 200], ['height', 'field.height', 'num', 80]],
    mockFields: [['value', 'field.mock_value']],
    build: (comp, pl, mock) => buildStepper(comp, pl, mock),
  },
```

- `icons.js` : `stepper: '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 12h2M15 11v2M14 12h2"/>',`
- `canvas-zones.js` `FAMILY` : `stepper: 'effectors',`

- [ ] **Step 5 : i18n** — EN `'comp.stepper': 'Stepper',` FR `"comp.stepper": "Incrément"`. (`field.min/max/step/unit/bind/color` existent déjà.)

- [ ] **Step 6 : Lancer** — `cd designer && node --test` → PASS.

- [ ] **Step 7 : Commit**

```bash
git add schema/layout.schema.json designer/js/render.js designer/js/registry.js designer/js/icons.js designer/js/canvas-zones.js designer/i18n/en.js designer/i18n/fr.json designer/tests/render.test.js
git commit -m "feat(stepper): designer — schema, buildStepper, registre, i18n

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

## Phase 5 — `segmented` (effecteur, famille *effectors*, écrit un index)

### Task 5.1 : Logique pure index (natif + test)

**Files:**
- Create: `src/segmented_logic.h`, `src/segmented_logic.cpp`
- Modify: `platformio.ini`
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1 : Test d'abord**

```cpp
void test_segmented_clamp(void) {
    TEST_ASSERT_EQUAL_INT(0, segmented_clamp(-1, 3));
    TEST_ASSERT_EQUAL_INT(2, segmented_clamp(5, 3));
    TEST_ASSERT_EQUAL_INT(1, segmented_clamp(1, 3));
    TEST_ASSERT_EQUAL_INT(0, segmented_clamp(0, 0));   // aucune option
}
```

`RUN_TEST(test_segmented_clamp);` + include.

- [ ] **Step 2 : Lancer → échec** — `pio test -e native` → FAIL.

- [ ] **Step 3 : Module**

```cpp
// segmented_logic.h
#pragma once
int segmented_clamp(int index, int count);
```
```cpp
// segmented_logic.cpp
#include "segmented_logic.h"
int segmented_clamp(int index, int count) {
    if (count <= 0) return 0;
    if (index < 0) return 0;
    if (index >= count) return count - 1;
    return index;
}
```

- [ ] **Step 4 : Filtre + lancer → passe** — `+<segmented_logic.cpp>`, `pio test -e native` → PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/segmented_logic.h src/segmented_logic.cpp platformio.ini test/test_core/test_main.cpp
git commit -m "feat(segmented): logique pure clamp d'index (+test natif)

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 5.2 : Firmware — effecteur `segmented` (lv_buttonmatrix)

**Files:**
- Modify: `src/dashboard.h` (enum ; réutilise `roller_options` + `value` = index)
- Modify: `src/dashboard.cpp` (`COMP_NAMES`, `APPLY`=nullptr, `context_apply` groupé, parse `options`)
- Modify: `src/view.cpp` (`build_segmented`, `sync_segmented`, event_cb, map persistante, `VIEW[]`)

- [ ] **Step 1 : Enum + COMP_NAMES + APPLY + context_apply + parse**

`COMP_SEGMENTED` avant `COMP_COUNT`. `COMP_NAMES` : `{ "segmented", COMP_SEGMENTED },`. `APPLY[]` : `/* COMP_SEGMENTED */ nullptr,`. `context_apply` : ajouter `case COMP_SEGMENTED:` au groupe effecteurs (var→`c.value`=index). Parse : réutiliser le parse d'`options` du roller (grep `roller_options` dans dashboard.cpp — appliquer le même bloc quand `c.type == COMP_SEGMENTED`).

- [ ] **Step 2 : `build_segmented` + `sync_segmented` + event_cb + map persistante (view.cpp)**

`lv_buttonmatrix` exige un `const char* map[]` persistant (LVGL garde le pointeur). Stockage statique par composant, pointant dans `c.roller_options` (segments séparés par `\n`, comme le roller). Ajouter en tête view.cpp :

```cpp
static char        s_seg_buf[MAX_COMPONENTS][ROLLER_OPTS_LEN];        // copie mutable (on découpe en place)
static const char* s_seg_map[MAX_COMPONENTS][MAX_SEG_OPTS + 1];       // map buttonmatrix ("" final)
```

```cpp
static int seg_build_map(int idx, const char* options) {
    strlcpy(s_seg_buf[idx], options, ROLLER_OPTS_LEN);
    int n = 0; char* p = s_seg_buf[idx];
    s_seg_map[idx][n++] = p;
    for (; *p && n <= MAX_SEG_OPTS; p++) {
        if (*p == '\n') { *p = '\0'; if (n < MAX_SEG_OPTS) s_seg_map[idx][n++] = p + 1; }
    }
    s_seg_map[idx][n] = "";     // sentinelle fin de map
    return n;
}
static void build_segmented(lv_obj_t* parent, Component& c, Placement& q,
                            lv_obj_t** main, lv_obj_t**, lv_obj_t**) {
    lv_obj_t* bm = lv_buttonmatrix_create(parent);
    int idx = q.comp_index;
    int n = (idx >= 0 && idx < MAX_COMPONENTS) ? seg_build_map(idx, c.roller_options) : 0;
    if (n > 0) lv_buttonmatrix_set_map(bm, s_seg_map[idx]);
    lv_buttonmatrix_set_one_checked(bm, true);
    for (int i = 0; i < n; i++) lv_buttonmatrix_set_button_ctrl(bm, i, LV_BUTTONMATRIX_CTRL_CHECKABLE);
    int sel = segmented_clamp(c.value, n);
    if (n > 0) lv_buttonmatrix_set_button_ctrl(bm, sel, LV_BUTTONMATRIX_CTRL_CHECKED);
    lv_obj_set_size(bm, q.width ? q.width : 240, q.height ? q.height : 56);
    lv_obj_align(bm, ALIGN_MAP[q.anchor], q.dx, q.dy);
    lv_obj_set_user_data(bm, &c);
    lv_obj_add_event_cb(bm, segmented_event_cb, LV_EVENT_VALUE_CHANGED, nullptr);
    *main = bm;
}
static void sync_segmented(Component& c, Placement&, lv_obj_t* w, lv_obj_t*, lv_obj_t*) {
    if (lv_obj_has_state(w, LV_STATE_PRESSED)) { defer_sync(c); return; }
    uint32_t n = lv_buttonmatrix_get_button_count(w);
    int sel = segmented_clamp(c.value, (int)n);
    if (n) lv_buttonmatrix_set_button_ctrl(w, sel, LV_BUTTONMATRIX_CTRL_CHECKED);
}
```

event_cb (zone s_dash) + forward decl :

```cpp
static void segmented_event_cb(lv_event_t* e) {
    lv_obj_t* w = lv_event_get_target_obj(e);
    Component* c = (Component*)lv_obj_get_user_data(w);
    if (!c || !s_dash || !c->bind[0]) return;
    uint32_t id = lv_buttonmatrix_get_selected_button(w);
    if (id == LV_BUTTONMATRIX_BUTTON_NONE) return;
    c->value = (int32_t)id;
    if (g_ctx_mutex) xSemaphoreTake(g_ctx_mutex, portMAX_DELAY);
    dash_ctx_write_ui_num(s_dash, c->bind, (double)id, millis());
    if (g_ctx_mutex) xSemaphoreGive(g_ctx_mutex);
}
```

`VIEW[]` : `/* COMP_SEGMENTED */ { build_segmented, sync_segmented },`.

> **NOTE (Context7 `/websites/lvgl_io_open`) :** vérifier les noms LVGL 9.5 : `lv_buttonmatrix_set_button_ctrl` / `lv_buttonmatrix_get_selected_button` / `LV_BUTTONMATRIX_CTRL_CHECKABLE|CHECKED` / `LV_BUTTONMATRIX_BUTTON_NONE`. En 8.x c'était `lv_btnmatrix_*` / `LV_BTNMATRIX_*`. Adapter au vocabulaire réel de la 9.5 embarquée.

- [ ] **Step 3 : Compiler** — `pio run -e esp32s3` → SUCCESS.

- [ ] **Step 4 : Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/view.cpp
git commit -m "feat(segmented): firmware — lv_buttonmatrix single-checked, ecrit l'index

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 5.3 : Designer — `segmented`

**Files:**
- Modify: `schema/layout.schema.json`, `render.js`, `registry.js`, `icons.js`, `canvas-zones.js`, i18n
- Test: `designer/tests/render.test.js`

- [ ] **Step 1 : Schéma**

`oneOf` : `{ "$ref": "#/$defs/comp_segmented" },`. `$def` (réutilise le patron `options` du roller, max 4) :

```json
    "comp_segmented": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "options"],
      "description": "Effecteur : contrôle segmenté (choix exclusif) ; écrit bind = index sélectionné.",
      "properties": {
        "type": { "const": "segmented" },
        "visible": { "type": "boolean" },
        "bind": { "$ref": "#/$defs/id", "description": "Variable écrite (index)." },
        "options": { "type": "array", "items": { "$ref": "#/$defs/display" }, "minItems": 2, "maxItems": 4 }
      }
    },
```

- [ ] **Step 2 : Test de rendu (avant builder)**

```js
test('buildSegmented: un segment par option, un seul sélectionné', () => {
  const el = render.buildSegmented({ type: 'segmented', options: ['Jour', 'Nuit', 'Auto'] }, {}, { value: 2 });
  assert.equal(el.querySelectorAll('.w-seg-opt').length, 3);
  assert.equal(el.querySelectorAll('.w-seg-opt.selected').length, 1);
});
```

- [ ] **Step 3 : `buildSegmented` (render.js) + `MOCKS.segmented`**

```js
// MOCKS.segmented: { value: 0 }
export function buildSegmented(comp, placement = {}, mock = { value: 0 }) {
  const opts = Array.isArray(comp.options) ? comp.options : [];
  const wrap = document.createElement('div');
  wrap.className = 'w w-segmented';
  if (placement.width) wrap.style.width = placement.width + 'px';
  const sel = Math.max(0, Math.min(opts.length - 1, mock.value | 0));
  opts.forEach((o, i) => {
    const d = document.createElement('div');
    d.className = 'w-seg-opt' + (i === sel ? ' selected' : '');
    d.textContent = o;
    wrap.appendChild(d);
  });
  return wrap;
}
```

- [ ] **Step 4 : `registry.js` + icône + famille (patron roller pour `options`)**

```js
  segmented: {
    label: 'comp.segmented',
    defaults: () => ({ type: 'segmented', options: ['A', 'B'] }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), width: 240 }),
    centered: false, physical: false,
    compFields: [['bind', 'field.bind', 'idtext'], ['options', 'field.options', 'options']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['width', 'field.width', 'num', 240]],
    mockFields: [['value', 'field.mock_value']],
    build: (comp, pl, mock) => buildSegmented(comp, pl, mock),
  },
```

- `icons.js` : `segmented: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M9 8v8M15 8v8"/>',`
- `canvas-zones.js` `FAMILY` : `segmented: 'effectors',`

> `kind:'options'` réutilise l'éditeur textarea du roller (`optionsField`) tel quel — vérifier que l'avertissement `ROLLER_OPTS` reste pertinent (ou ajouter un plafond 4 segments côté `refreshWarn` si voulu ; minimal : laisser).

- [ ] **Step 5 : i18n** — EN `'comp.segmented': 'Segmented',` FR `"comp.segmented": "Segmenté"`. (`field.options`, `field.bind` existent.)

- [ ] **Step 6 : Lancer** — `cd designer && node --test` → PASS.

- [ ] **Step 7 : Commit**

```bash
git add schema/layout.schema.json designer/js/render.js designer/js/registry.js designer/js/icons.js designer/js/canvas-zones.js designer/i18n/en.js designer/i18n/fr.json designer/tests/render.test.js
git commit -m "feat(segmented): designer — schema, buildSegmented, registre, i18n

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

## Phase 6 — Parité i18n + intégration finale

### Task 6.1 : Test de parité i18n EN=FR (nouveau garde-fou)

**Files:**
- Create: `designer/tests/i18n-parity.test.js`

- [ ] **Step 1 : Écrire le test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import EN from '../i18n/en.js';
import { missingKeys } from '../js/i18n.js';

const FR = JSON.parse(readFileSync(new URL('../i18n/fr.json', import.meta.url)));

test('i18n: aucune clé EN absente de FR', () => {
  assert.deepEqual(missingKeys(EN, FR), []);
});
test('i18n: aucune clé FR absente de EN', () => {
  assert.deepEqual(missingKeys(FR, EN), []);
});
```

- [ ] **Step 2 : Lancer**

Run: `cd designer && node --test tests/i18n-parity.test.js`
Expected: PASS.
**Si des écarts PRÉEXISTANTS apparaissent** (clés déjà désynchronisées avant ce lot) : les combler (probablement une poignée) et le noter dans le message de commit. Si l'écart est large et hors sujet, restreindre l'assertion aux préfixes des 5 nouveaux composants (`comp.clock|rings|qr|stepper|segmented`, `field.clock_mode|show_seconds|show_date|tracks|size`, `select.clockmode.*`, `inspector.btn.add_track`) et signaler la dette séparément — **ne pas élargir le périmètre en silence**.

- [ ] **Step 3 : Commit**

```bash
git add designer/tests/i18n-parity.test.js designer/i18n/
git commit -m "test(i18n): garde-fou de parité EN=FR (missingKeys)

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

### Task 6.2 : Vérification globale + stage LittleFS

**Files:** aucun (vérification)

- [ ] **Step 1 : Suite complète**

```bash
pio test -e native
cd designer && node --test
cd .. && pio run -e esp32s3
```
Expected : natif 100 % PASS (dont clock/ring/stepper/segmented geom), designer 100 % PASS (dont buildClock/Rings/Qr/Stepper/Segmented + registry + i18n-parity), firmware SUCCESS.

- [ ] **Step 2 : Stager l'image LittleFS (designer + schéma à jour)**

```bash
bash tools/stage_fs.sh
```
Expected : `data/designer/` et `data/schema/` mis à jour (dont `vendor/qrcodegen.js`, `js/qr.js`, les 5 nouveaux builders). Vérifier qu'aucun secret n'est stagé.

- [ ] **Step 3 : Commit final (data stagée si versionnée — sinon rien)**

```bash
git status
# si data/ contient des fichiers suivis modifiés :
git add data/ && git commit -m "chore(fs): stage designer avec les 5 nouveaux composants

Claude-Session: https://claude.ai/code/session_01Y449MPE8fJa7fT8KUGcAp4"
```

---

## Vérification on-device (hors plan automatisé — nécessite le HW)

Après `pio run -e esp32s3 -t upload` + `pio run -e esp32s3 -t uploadfs` (⚠ `uploadfs` efface les assets device — sauvegarder avant) :
- `clock` : cadran analogique tourne, digital affiche l'heure locale (après synchro NTP) ; `--:--` avant synchro.
- `rings` : `POST /update {"<id>":[70,50,30]}` remplit les 3 pistes.
- `qr` : scannable au téléphone → ouvre l'URL device ; changement via `POST /update {"<id>":"..."}`.
- `stepper` : taps +/− bornent et poussent la consigne (sink si watch configuré).
- `segmented` : sélection exclusive, pousse l'index (sink).

---

## Auto-revue du plan (writing-plans)

**Couverture spec :** clock (P1) ✓ · rings (P2) ✓ · qr (P3, ECC MEDIUM — raffinement noté) ✓ · stepper (P4) ✓ · segmented (P5) ✓ · tz racine + NTP (Task 0.2) ✓ · lv_conf (0.3) ✓ · encodeur QR jumeau (0.4) ✓ · tests natif+node (chaque phase) ✓ · i18n EN=FR (6.1) ✓.

**Raffinements vs spec (à répercuter dans le doc de spec) :** (1) `qr.ecc` retiré (lv_qrcode fige MEDIUM). (2) `rings` poussé par tableau `{"id":[…]}` (push-by-id), binds par piste pour le pull. (3) parité i18n = test créé (n'existait pas).

**Cohérence de types :** `COMP_CLOCK/RINGS/QR/STEPPER/SEGMENTED` insérés avant `COMP_COUNT` ; noms `COMP_NAMES` = `clock/rings/qr/stepper/segmented` = `type.const` du schéma = clés `COMPONENTS` (imposé par `registry.test.js`). Modules purs : `clock_hand_angles`/`clock_format_digital`, `ring_track_radius`, `stepper_step`, `segmented_clamp`, `qrModules` — noms identiques entre définition, test et appelant.

**Notes de vérification LVGL 9.5 restantes (Context7 `/websites/lvgl_io_open`) :** `lv_line_set_points` (persistance pointeur, `lv_point_precise_t`) ; `lv_button_create` vs `lv_btn_create` ; famille `lv_buttonmatrix_*` (noms 9.5 vs `lv_btnmatrix_*` 8.x). Ces points sont écrits avec le code attendu + note — à confirmer au premier build de chaque tâche.
