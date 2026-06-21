# LED — rendu réaliste + attributs de look — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le composant `led` réaliste (dôme, glow, reflet spéculaire, bezel) et configurable par 4 booléens, avec parité designer↔device best-effort.

**Architecture :** Designer et firmware sont des tâches **séparées** (les 4 booléens sont des *propriétés* additives de `comp_led`, pas un nouveau type → aucun couplage des deux suites de conformité, contrairement au led de base). Designer : `buildLed` réécrit avec dégradé radial CSS + reflet (enfant DOM) + glow/bezel, piloté par les booléens. Firmware : `lv_led` stylé (dôme via `bg_grad` radial recolorié par luminance, glow via shadow, bezel via bordure) + objet enfant spéculaire ; dégradés complexes activés.

**Tech Stack :** JS modules (designer, `node:test`), JSON Schema, C++/Arduino + LVGL 9.5 (`lv_led`, `lv_grad_radial_init`, `lv_obj_set_style_bg_grad`), PlatformIO (`native` + `esp32s3`).

**Constantes maison (figées, du playground — utilisées des DEUX côtés) :**
`lightX=38, lightY=30 (%)` · dôme : centre éclairci +62 %, bord assombri +24 % · glow : flou 20px, spread 5px, opacité 1.0 (+ halo large) · spéculaire : Ø 24 %, opacité 0.62 · bezel : 8px · éteint : assombri 69 % · reflet verre éteint : opacité 0.12.

**Faits vérifiés (source LVGL 9.5) :**
- `lv_obj_set_style_bg_grad(obj, const lv_grad_dsc_t*, sel)` **stocke le pointeur** → le descripteur doit persister : stockage **statique par composant** (comme `s_meter_section_style[idx]` dans `view.cpp`).
- `lv_grad_radial_init(dsc, cx, cy, to_x, to_y, extend)` : centre + point sur le cercle final (rayon). `cx/cy` acceptent `lv_pct()`.
- `lv_led` (`lv_led.c`) recolorie `bg_grad.stops[0/1].color` selon leur **luminance** → la teinte vient de `lv_led_set_color`, le gradient ne donne que le profil clair→sombre ; et il module shadow/border par la brightness (glow auto-éteint).
- Éteint : `lv_led_off()` → brightness MIN=80/255 ≈ 31 % ≈ l'assombrissement 69 % du designer. Pas de contournement.

---

## Task 1 : Designer — rendu réaliste + 4 booléens

Réécrit `buildLed` (dôme/glow/spéculaire/bezel/éteint, pilotés par booléens), ajoute les attributs au schéma et à l'inspecteur. Commit vert sous `node --test` ; firmware inchangé (tolère les nouvelles clés).

**Files:**
- Modify: `schema/layout.schema.json` (4 booléens dans `comp_led`)
- Modify: `designer/js/render.js` (constantes `LED`, helpers couleur, `buildLed` réécrit)
- Modify: `designer/js/registry.js` (compFields : glow/bezel/specular/off_glass + defaults)
- Modify: `designer/style.css` (`.w-led`, `.w-led-spec`)
- Modify: `designer/tests/schema.test.js` (cas booléens)

- [ ] **Step 1 : Test schéma — booléens de look valides + booléen inconnu rejeté**

Dans `designer/tests/schema.test.js`, ajouter :

```js
test('schema : led avec booléens de look valide', () => {
  const l = { components: { l1: { type: 'led', glow: true, bezel: false, specular: true, off_glass: false } },
             pages: [{ name: 'P', place: [{ ref: 'l1' }] }] };
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : booléen de look inconnu sur un led rejeté', () => {
  const l = { components: { l1: { type: 'led', sparkle: true } },
             pages: [{ name: 'P', place: [{ ref: 'l1' }] }] };
  assert.equal(validate(l).valid, false);
});
```

- [ ] **Step 2 : Lancer la suite designer — vérifier l'échec**

Run: `cd designer && node --test`
Expected: ÉCHEC — le 1er test échoue (`glow`/`bezel`/`specular`/`off_glass` absents du schéma → `additionalProperties:false` les rejette).

- [ ] **Step 3 : Ajouter les 4 booléens au schéma**

Dans `schema/layout.schema.json`, `comp_led.properties`, après `thresholds` :

```json
        "thresholds": {
          "type": "array",
          "description": "Couleur allumee selon la valeur (1er seuil ou value < limite, sinon color).",
          "items": { "$ref": "#/$defs/threshold" }
        },
        "glow": { "type": "boolean", "description": "Halo externe a l'allumage. Defaut true." },
        "bezel": { "type": "boolean", "description": "Anneau encastre (boitier). Defaut true." },
        "specular": { "type": "boolean", "description": "Reflet speculaire (point brillant). Defaut true." },
        "off_glass": { "type": "boolean", "description": "Garder un faible reflet de verre quand eteint (sous-option de specular). Defaut true." }
```

- [ ] **Step 4 : Constantes + helpers couleur dans render.js**

Dans `designer/js/render.js`, après le bloc `MOCKS` (ou en tête des helpers), ajouter :

```js
// Constantes maison du rendu LED réaliste (réglées au playground ; cf. spec led-look-realiste).
// Les booléens du composant (glow/bezel/specular/off_glass) activent chaque effet ; ces nombres
// sont figés et partagés avec le firmware pour la parité.
const LED = {
  lightX: 38, lightY: 30, highlight: 62, edgeDark: 24,
  glowBlur: 20, glowSpread: 5, glowAlpha: 1.0,
  specSize: 24, specAlpha: 0.62, rimDepth: 8,
  offDark: 69, offSpecAlpha: 0.12,
};
const LED_WHITE = [255, 255, 255], LED_BLACK = [0, 0, 0];
function ledHexRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function ledMix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
function ledRgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
```

- [ ] **Step 5 : Réécrire `buildLed`**

Dans `designer/js/render.js`, remplacer la fonction `buildLed` existante par :

```js
// led : voyant réaliste. Corps en dégradé radial (dôme) ; couleur = seuil sinon color ; éteint
// (assombri, sans glow) sous off_below. Effets pilotés par booléens (défaut true). Miroir best-effort
// de lv_led stylé (view.cpp build_led/sync_led). Constantes figées = objet LED.
export function buildLed(comp, placement, mock = MOCKS.led) {
  const size = placement.size || 24;
  const lit  = ledLit(mock.value, comp.off_below ?? 1);
  const colHex = pickThresholdColor(comp.thresholds, mock.value, comp.color || '#22C55E');
  const color = ledHexRgb(colHex);
  const glow = comp.glow ?? true, bezel = comp.bezel ?? true;
  const specular = comp.specular ?? true, offGlass = comp.off_glass ?? true;

  const n = document.createElement('div');
  n.className = 'w w-led';
  n.style.width = size + 'px';
  n.style.height = size + 'px';

  // Corps : dôme radial (centre éclairci, bord assombri), éclairé depuis lightX/lightY.
  const center = lit ? ledMix(color, LED_WHITE, LED.highlight / 100) : ledMix(ledMix(color, LED_BLACK, LED.offDark / 100), LED_WHITE, 0.07);
  const mid    = lit ? color : ledMix(color, LED_BLACK, LED.offDark / 100);
  const edge   = lit ? ledMix(color, LED_BLACK, LED.edgeDark / 100) : ledMix(mid, LED_BLACK, 0.28);
  n.style.background = `radial-gradient(circle at ${LED.lightX}% ${LED.lightY}%, ${ledRgb(center)} 0%, ${ledRgb(mid)} 50%, ${ledRgb(edge)} 100%)`;

  // Ombres : glow externe (allumé) + bezel encastré (interne) + contour.
  const sh = [];
  if (glow && lit) {
    const blur = LED.glowBlur, spr = LED.glowSpread, a = LED.glowAlpha;
    sh.push(`0 0 ${blur}px ${spr}px rgba(${color[0]},${color[1]},${color[2]},${a})`);
    sh.push(`0 0 ${blur * 2}px ${Math.round(spr * 1.5)}px rgba(${color[0]},${color[1]},${color[2]},${a * 0.4})`);
  }
  if (bezel) {
    const d = LED.rimDepth;
    sh.push(`inset 0 0 ${d}px rgba(0,0,0,.55)`);
    sh.push(`inset 0 ${Math.max(1, Math.round(d / 3))}px ${Math.round(d / 2)}px rgba(0,0,0,.45)`);
    sh.push(`inset 0 -1px 1px rgba(255,255,255,.12)`);
  }
  sh.push(`0 0 0 1px rgba(0,0,0,.45)`);
  n.style.boxShadow = sh.join(', ');

  // Reflet spéculaire (enfant) : allumé → specAlpha ; éteint → offSpecAlpha si off_glass, sinon absent.
  const showSpec = specular && (lit ? LED.specAlpha > 0 : (offGlass && LED.offSpecAlpha > 0));
  if (showSpec) {
    const a = lit ? LED.specAlpha : LED.offSpecAlpha;
    const sp = document.createElement('div');
    sp.className = 'w-led-spec';
    const sz = size * LED.specSize / 100;
    sp.style.width = sz + 'px';
    sp.style.height = sz + 'px';
    sp.style.left = (size * LED.lightX / 100 - sz / 2) + 'px';
    sp.style.top  = (size * LED.lightY / 100 - sz / 2) + 'px';
    sp.style.background = `radial-gradient(circle at 50% 50%, rgba(255,255,255,${a}) 0%, rgba(255,255,255,${a * 0.35}) 38%, rgba(255,255,255,0) 70%)`;
    n.appendChild(sp);
  }
  return n;
}
```

- [ ] **Step 6 : Inspecteur — exposer les 4 booléens + defaults**

Dans `designer/js/registry.js`, remplacer l'entrée `led` par :

```js
  led: {
    label: 'LED',
    defaults: () => ({ type: 'led', color: '#22C55E', off_below: 1, glow: true, bezel: true, specular: true, off_glass: true }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), size: 24 }),
    centered: false, physical: false,
    compFields: [['color', 'Couleur', 'color'], ['off_below', 'Éteint sous', 'num'],
                 ['glow', 'Glow', 'bool'], ['bezel', 'Bezel', 'bool'],
                 ['specular', 'Reflet', 'bool'], ['off_glass', 'Reflet éteint', 'bool'],
                 ['bind', 'Variable (pull)', 'asciitext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'], ['size', 'Diamètre', 'num']],
    mockFields: [['value', 'Valeur (aperçu)']],
    build: (comp, pl, mock) => buildLed(comp, pl, mock),
  },
```

- [ ] **Step 7 : CSS — conteneur + reflet**

Dans `designer/style.css`, remplacer le bloc `.w-led` existant par :

```css
/* led : voyant réaliste. Corps/ombres posés inline par buildLed ; le reflet est un enfant. */
.w-led { position: absolute; border-radius: 50%; }
.w-led-spec { position: absolute; border-radius: 50%; pointer-events: none; }
```

(Note : `.w-led--off` n'est plus utilisé — l'état éteint est rendu par le dégradé du corps. Le retirer s'il subsiste.)

- [ ] **Step 8 : Suite designer verte**

Run: `cd designer && node --test`
Expected: PASS — dont les 2 nouveaux tests schéma, `ledLit` inchangé, conformité registre↔schéma.

- [ ] **Step 9 : Vérif navigateur (harness existant)**

Servir le repo (port libre, pas 8000) et ouvrir `playgrounds/led-harness.html` (il utilise le vrai `buildLed`). Confirmer : dôme, glow allumé, reflet, éteint sombre. Puis arrêter le serveur.

```bash
python3 -m http.server 8137 --bind 127.0.0.1 &
# http://127.0.0.1:8137/playgrounds/led-harness.html  → screenshot
# lsof -ti :8137 | xargs kill
```

Expected : les pastilles sont nettement plus réalistes (dôme + reflet + glow) qu'avant.

- [ ] **Step 10 : Commit**

```bash
git add schema/layout.schema.json designer/js/render.js designer/js/registry.js designer/style.css designer/tests/schema.test.js
git commit -m "designer: rendu led réaliste + booléens glow/bezel/specular/off_glass

Claude-Session: https://claude.ai/code/session_012QBMYnsJCr9dAm4e27UhhB"
```

---

## Task 2 : Firmware — données (struct, parse, conf gradients)

Ajoute les 4 booléens au modèle firmware et active les dégradés complexes. Pas de changement de rendu encore. Commit vert sous `pio test -e native` + compile.

**Files:**
- Modify: `src/dashboard.h` (`Component` : 4 bool)
- Modify: `src/dashboard.cpp` (parse des 4 bool)
- Modify: `src/lv_conf.h` (`LV_USE_DRAW_SW_COMPLEX_GRADIENTS`)
- Modify: `test/test_core/test_main.cpp` (parse des booléens : présent + défaut)

- [ ] **Step 1 : Test natif — parse des booléens (présent / défaut true)**

Dans `test/test_core/test_main.cpp`, ajouter :

```c
static const char* LAYOUT_LED_LOOK =
    "{\"components\":{"
    "\"a\":{\"type\":\"led\",\"glow\":false,\"bezel\":false,\"specular\":false,\"off_glass\":false},"
    "\"b\":{\"type\":\"led\"}},"
    "\"pages\":[{\"name\":\"P\",\"place\":[{\"ref\":\"a\"},{\"ref\":\"b\"}]}]}";

void test_led_look_flags(void) {
    Dashboard d{}; char err[128];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_LED_LOOK, err, sizeof(err)));
    // a : tout désactivé explicitement
    TEST_ASSERT_FALSE(d.components[0].led_glow);
    TEST_ASSERT_FALSE(d.components[0].led_bezel);
    TEST_ASSERT_FALSE(d.components[0].led_specular);
    TEST_ASSERT_FALSE(d.components[0].led_off_glass);
    // b : défauts (true)
    TEST_ASSERT_TRUE(d.components[1].led_glow);
    TEST_ASSERT_TRUE(d.components[1].led_bezel);
    TEST_ASSERT_TRUE(d.components[1].led_specular);
    TEST_ASSERT_TRUE(d.components[1].led_off_glass);
}
```

Enregistrer dans `main()` : `RUN_TEST(test_led_look_flags);`

- [ ] **Step 2 : Lancer les tests natifs — vérifier l'échec**

Run: `pio test -e native`
Expected: ÉCHEC de compilation — `led_glow`/`led_bezel`/`led_specular`/`led_off_glass` absents de `Component`.

- [ ] **Step 3 : Champs dans `Component`**

Dans `src/dashboard.h`, `struct Component`, à côté de `int32_t off_below;` :

```c
    bool     led_glow, led_bezel, led_specular, led_off_glass;   // led : effets de look (defaut true)
```

- [ ] **Step 4 : Parse des 4 booléens (défaut true)**

Dans `src/dashboard.cpp`, après `c.off_below = o["off_below"] | 1;` :

```cpp
        c.led_glow      = o["glow"]      | true;
        c.led_bezel     = o["bezel"]     | true;
        c.led_specular  = o["specular"]  | true;
        c.led_off_glass = o["off_glass"] | true;
```

- [ ] **Step 5 : Activer les dégradés complexes**

Dans `src/lv_conf.h`, dans la section « Widgets extra » (après `LV_USE_LED 1`) :

```c
// Dégradés radiaux/coniques (dôme + reflet du led réaliste)
#define LV_USE_DRAW_SW_COMPLEX_GRADIENTS 1
```

- [ ] **Step 6 : Tests natifs verts + compile**

Run: `pio test -e native`
Expected: PASS — dont `test_led_look_flags`.

Run: `pio run -e esp32s3`
Expected: SUCCESS (gradients complexes compilés).

- [ ] **Step 7 : Commit**

```bash
git add src/dashboard.h src/dashboard.cpp src/lv_conf.h test/test_core/test_main.cpp
git commit -m "firmware: led — parse booléens de look + active dégradés complexes

Claude-Session: https://claude.ai/code/session_012QBMYnsJCr9dAm4e27UhhB"
```

---

## Task 3 : Firmware — rendu réaliste (`lv_led` stylé + reflet enfant)

Réécrit `build_led`/`sync_led` : dôme (bg_grad radial), glow (shadow), bezel (bordure), reflet (objet enfant). Non testable au natif (LVGL/HW) → vérifié par compilation + relecture ; tuning visuel en Task 4. Commit après compile verte.

**Files:**
- Modify: `src/view.cpp` (storage statique gradients, `build_led`, `sync_led`)

- [ ] **Step 1 : Storage statique des descripteurs de gradient**

Dans `src/view.cpp`, près des statiques de `meter` (`s_meter_section_style[...]`), ajouter :

```cpp
// led : descripteurs de gradient persistants (lv_obj_set_style_bg_grad stocke le pointeur).
static lv_grad_dsc_t s_led_dome_grad[MAX_COMPONENTS];
static lv_grad_dsc_t s_led_spec_grad[MAX_COMPONENTS];
```

- [ ] **Step 2 : Réécrire `build_led`**

Dans `src/view.cpp`, remplacer `build_led` par :

```cpp
// led : voyant réaliste. Dôme = bg_grad radial recolorié par luminance (lv_led) ; glow = shadow
// (auto-atténué par brightness) ; bezel = bordure ; reflet = objet enfant (sub1). Constantes maison
// alignées sur buildLed (designer). Valeurs de départ à ajuster sur device (Task 4).
static void build_led(lv_obj_t* parent, Component& c, Placement& q,
                      lv_obj_t** main, lv_obj_t** sub1, lv_obj_t**) {
    lv_obj_t* led = lv_led_create(parent);
    int sz = q.size ? q.size : 24;
    lv_obj_set_size(led, sz, sz);
    int idx = q.comp_index;

    // Dôme : gradient radial (centre 38%/30%). Stops = profil de luminance (clair centre -> mi-sombre
    // bord) ; lv_led applique la teinte (lv_led_set_color) et module par la brightness.
    if (idx >= 0 && idx < MAX_COMPONENTS) {
        lv_grad_dsc_t* g = &s_led_dome_grad[idx];
        lv_grad_radial_init(g, lv_pct(38), lv_pct(30), lv_pct(100), lv_pct(100), LV_GRAD_EXTEND_PAD);
        lv_color_t cols[2] = { lv_color_white(), lv_color_hex(0x6E6E6E) };
        uint8_t fr[2] = { 0, 255 };
        lv_grad_init_stops(g, cols, NULL, fr, 2);
        lv_obj_set_style_bg_grad(led, g, LV_PART_MAIN);
    }

    lv_led_set_color(led, lv_color_hex(threshold_color(c.thresholds, c.threshold_count, c.value, c.color)));

    // Glow : shadow blanc (recoloré en teinte par lv_led, atténué par brightness). 0 si désactivé.
    if (c.led_glow) {
        lv_obj_set_style_shadow_width(led, 20, LV_PART_MAIN);
        lv_obj_set_style_shadow_spread(led, 5, LV_PART_MAIN);
        lv_obj_set_style_shadow_color(led, lv_color_white(), LV_PART_MAIN);
    } else {
        lv_obj_set_style_shadow_width(led, 0, LV_PART_MAIN);
    }

    // Bezel : bordure sombre encastrée.
    if (c.led_bezel) {
        lv_obj_set_style_border_width(led, 2, LV_PART_MAIN);
        lv_obj_set_style_border_color(led, lv_color_hex(0x000000), LV_PART_MAIN);
        lv_obj_set_style_border_opa(led, LV_OPA_40, LV_PART_MAIN);
    } else {
        lv_obj_set_style_border_width(led, 0, LV_PART_MAIN);
    }

    if (led_is_lit(c.value, c.off_below)) lv_led_on(led); else lv_led_off(led);
    lv_obj_align(led, ALIGN_MAP[q.anchor], q.dx, q.dy);
    *main = led;

    // Reflet spéculaire : objet enfant décoratif (Ø 24 %, point lumineux 38%/30%).
    if (c.led_specular && idx >= 0 && idx < MAX_COMPONENTS) {
        int ssz = sz * 24 / 100; if (ssz < 2) ssz = 2;
        lv_obj_t* sp = lv_obj_create(led);
        lv_obj_remove_style_all(sp);
        lv_obj_set_size(sp, ssz, ssz);
        lv_obj_set_pos(sp, sz * 38 / 100 - ssz / 2, sz * 30 / 100 - ssz / 2);
        lv_obj_set_style_radius(sp, LV_RADIUS_CIRCLE, 0);
        lv_obj_remove_flag(sp, LV_OBJ_FLAG_CLICKABLE);
        lv_grad_dsc_t* sg = &s_led_spec_grad[idx];
        lv_grad_radial_init(sg, lv_pct(50), lv_pct(50), lv_pct(100), lv_pct(100), LV_GRAD_EXTEND_PAD);
        lv_color_t scol[2] = { lv_color_white(), lv_color_white() };
        lv_opa_t   sopa[2] = { LV_OPA_COVER, LV_OPA_TRANSP };
        uint8_t    sfr[2]  = { 0, 255 };
        lv_grad_init_stops(sg, scol, sopa, sfr, 2);
        lv_obj_set_style_bg_grad(sp, sg, LV_PART_MAIN);
        lv_obj_set_style_bg_opa(sp, LV_OPA_COVER, LV_PART_MAIN);
        *sub1 = sp;
    } else {
        *sub1 = nullptr;
    }
}
```

- [ ] **Step 3 : Réécrire `sync_led` (couleur + état + opacité reflet)**

Dans `src/view.cpp`, remplacer `sync_led` par :

```cpp
static void sync_led(Component& c, Placement&, lv_obj_t* w, lv_obj_t* sub1, lv_obj_t*) {
    bool lit = led_is_lit(c.value, c.off_below);
    lv_led_set_color(w, lv_color_hex(threshold_color(c.thresholds, c.threshold_count, c.value, c.color)));
    if (lit) lv_led_on(w); else lv_led_off(w);
    // Reflet : visible allumé ; éteint, faible si off_glass, sinon masqué. (opacité ≈ constantes 0.62 / 0.12)
    if (sub1) {
        if (lit) { lv_obj_remove_flag(sub1, LV_OBJ_FLAG_HIDDEN); lv_obj_set_style_opa(sub1, 158, 0); }       // ~0.62
        else if (c.led_off_glass) { lv_obj_remove_flag(sub1, LV_OBJ_FLAG_HIDDEN); lv_obj_set_style_opa(sub1, 31, 0); } // ~0.12
        else lv_obj_add_flag(sub1, LV_OBJ_FLAG_HIDDEN);
    }
}
```

- [ ] **Step 4 : Compiler**

Run: `pio run -e esp32s3`
Expected: SUCCESS. Si une signature LVGL diffère (ex. `lv_grad_radial_init` args, `lv_obj_remove_flag` nommage), corriger d'après l'erreur exacte du compilateur et les headers (`src/misc/lv_grad.h`, `src/core/lv_obj.h`) — ne pas inventer.

- [ ] **Step 5 : Commit**

```bash
git add src/view.cpp
git commit -m "firmware: rendu led réaliste (dôme radial, glow, bezel, reflet enfant)

Claude-Session: https://claude.ai/code/session_012QBMYnsJCr9dAm4e27UhhB"
```

---

## Task 4 : Parité visuelle + tuning device

Vérifie le rendu et ajuste les constantes pour rapprocher device et designer. Le rendu firmware n'étant pas testable hors HW, c'est ici qu'on le valide réellement.

**Files:** Possibly modify `src/view.cpp` (valeurs de dôme/glow/reflet) et/ou `designer/js/render.js` (constantes `LED`) pour converger.

- [ ] **Step 1 : Screenshots designer (effets on/off)**

Servir le repo, ouvrir `playgrounds/led-harness.html` (ou le designer avec un LED placé), capturer allumé/éteint et un cas chaque booléen désactivé. Confirmer le rendu attendu côté designer.

- [ ] **Step 2 : Flash device + observation (sur demande utilisateur)**

```bash
bash tools/stage_fs.sh
pio run -e esp32s3 -t upload
pio run -e esp32s3 -t uploadfs   # ⚠ efface les assets device : sauvegarder avant (cf. mémoire)
```

Pousser une valeur via `POST /update` et comparer le voyant à l'aperçu designer (dôme, glow, reflet, éteint).

- [ ] **Step 3 : Ajuster les constantes pour converger**

Si écart : ajuster les stops de luminance du dôme (`s_led_dome_grad` cols), `shadow_width/spread`, taille/opacité du reflet côté firmware, et/ou les constantes `LED` côté designer, jusqu'à parité best-effort acceptable. Documenter tout écart résiduel assumé.

- [ ] **Step 4 : Commit (si ajustement)**

```bash
git add src/view.cpp designer/js/render.js
git commit -m "led : ajuste les constantes de rendu pour la parité designer↔device

Claude-Session: https://claude.ai/code/session_012QBMYnsJCr9dAm4e27UhhB"
```

---

## Notes de portée

- **Pas de couplage inter-suites** : les booléens sont des propriétés additives → designer (Task 1) et firmware (Tasks 2-3) sont des commits indépendants, chacun vert sur sa suite.
- **Parité best-effort assumée** : chemins de rendu différents (CSS vs lv_led recolorié). Task 4 converge ; un écart résiduel est documenté, pas masqué.
- **Risque connu** : le rendu firmware (Task 3) repose sur des hypothèses LVGL (lv_led honore un `bg_grad` radial 2 stops ; recolorisation par luminance) vérifiées en source mais non exécutées hors HW. La compilation valide les signatures ; la fidélité visuelle se valide en Task 4 (flash). Honnête : les valeurs de Task 3 sont un point de départ, pas un rendu pixel-garanti.
- **Push** : commits locaux jusqu'à demande explicite.
