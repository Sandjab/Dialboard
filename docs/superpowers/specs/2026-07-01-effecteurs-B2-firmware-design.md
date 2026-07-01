# Effecteurs — B2 firmware (momentary + slider + arc + roller) — design

> Spec issu d'un brainstorm (2026-07-01). Deuxième tranche verticale des composants **effecteurs**,
> après B1 (switch + button `set`, firmware sur `main`). B2 **résout** les deux points de design que la
> spec socle (`2026-06-30-composants-effecteurs-design.md`, §7) laissait ouverts : la course de timing
> du `momentary` et le conflit reflet↔drag. Tranche **firmware pure** (parité schéma+designer différée
> en Plan C2), sur le gabarit B1.

## 1. Contexte

B1 a posé le pipeline des effecteurs : `CompType` → `COMP_NAMES` → tables `APPLY[]` (dashboard.cpp) /
`VIEW[]` (view.cpp) sous double `static_assert(COMP_COUNT)`, callbacks tactiles via `s_dash` +
`user_data=&c`, écriture d'origine UI par `dash_ctx_write_ui_num/str` (écrit le ctx **et** arme les
sinks observant la var), reflet `bind` via `context_apply` + `sync_*`. Switch et button `set` tournent
on-device.

B2 ajoute les 4 comportements restants du socle v1 (spec socle §4.4), **en une seule tranche** (décidé
avec l'utilisateur) : `momentary` (mode du button) + 3 nouveaux composants `slider` / `arc` / `roller`.

## 2. Décisions du brainstorm B2

| # | Décision | Justification |
|---|----------|---------------|
| 1 | **Une seule tranche** : momentary + slider + arc + roller. | Une seule vérif on-device et un seul cycle de revue ; B1 a de même groupé switch+button. |
| 2 | **`momentary` = capture à l'armement** (pas de reset temporisé). | Le seul modèle **sans hypothèse de timing** : le corps du sink est figé au tap ; correct pour tout `debounce_ms`, sans casser le live-at-fire des sliders. Cf. §4. |
| 3 | **Anti-conflit reflet↔drag = état LVGL `PRESSED`** (pas de fenêtre temporelle). | Natif, colle à la règle spec « widget en édition », last-writer-wins au relâchement, zéro état runtime arbitraire. Cf. §5. |
| 4 | **Tranche firmware pure** (pas de schéma/designer). | Parité couplée au registre designer par le test strict `registry.test.js` → schéma+designer = **Plan C2** (comme switch/button en C). Le firmware parse tolérant. |

## 3. Enum, tables, struct

### 3.1 Types & tables
- **`CompType`** (dashboard.h) : ajouter `COMP_SLIDER`, `COMP_ARC`, `COMP_ROLLER` **avant** `COMP_COUNT`.
  `momentary` **n'est pas** un type : c'est un champ du button.
- **`COMP_NAMES`** (dashboard.cpp) : `"slider"`/`"arc"`/`"roller"`.
- **`APPLY[]`** (dashboard.cpp) : les 3 nouveaux = `nullptr` (effecteurs : pas de push-by-id, reflet via
  `context_apply`, comme `COMP_SWITCH`/`COMP_BUTTON`).
- **`VIEW[]`** (view.cpp) : `{build_slider, sync_slider}`, `{build_arc, sync_arc}`,
  `{build_roller, sync_roller}`. Les deux `static_assert(== COMP_COUNT)` gardent la parité.

### 3.2 Champs du `Component` (dashboard.h)
- **Neufs** : `bool momentary` (button) ; `int32_t step` (slider/arc ; 0 ⇒ défaut 1) ; roller :
  `char roller_options[ROLLER_OPTS_LEN]` (libellés joints par `\n`, Latin-1) + `uint8_t roller_rows`.
- **Réutilisés** (aucun champ neuf) :
  - min/max ⇒ **`vmin`/`vmax`** (`int32_t`, déjà présents).
  - orientation slider ⇒ **`bar_vertical`** (via le parse générique d'orientation ; `line` réutilise
    déjà ce champ, cf. commentaire dashboard.h).
  - géométrie arc ⇒ **`Placement.radius/thickness/gap_deg/start_angle`** (réutilise l'esthétique du ring).
- **config.h** : `#define ROLLER_OPTS_LEN 160`, `#define MAX_ROLLER_ROWS 7` (borne des rangées visibles).

## 4. `momentary` — capture à l'armement

**Problème.** `fire_one` (net_push.cpp) rend le corps du sink **au moment du tir**, sous mutex, ~1 tick
(≤ 250 ms) après l'armement, depuis le contexte **vivant**. Un reset EXTERNAL de la var avant ce tir
enverrait la valeur de repos au lieu de l'impulsion (course reset↔fire).

**Solution : figer le corps rendu au tap, sur le sink.**

- **`Sink`** (dashboard.h) gagne 2 champs runtime : `char captured_body[SINK_BODY_LEN + TEXT_LEN]`
  (même dimension que `SinkJob.body`, marge de substitution incluse) + `bool has_capture`.
- **Core** (`dashboard.cpp`, natif-testable) :
  - `arm_sinks` gagne un paramètre `bool capture`.
    - `capture=false` (write **live**) ⇒ **efface** `has_capture` (garde anti-capture périmée) + arme.
    - `capture=true` (write **pulse**) ⇒ rend le corps **maintenant** (`sink_render_body(s.body, s.watch,
      &d->ctx, s.captured_body, sizeof s.captured_body)`, le ctx valant encore l'impulsion) + pose
      `has_capture` + arme.
  - Nouveau chemin public `dash_ctx_pulse_num(d, var, value, now)` / `dash_ctx_pulse_str(...)` :
    1. `ctx_set(value)` ; si changé ⇒ `arm_sinks(capture=true)`.
    2. `ctx_set(rest)` en EXTERNAL (**n'arme pas**). `rest = 0` (num) / `""` (str).
    - Net : le ctx retombe à `rest` ; `captured_body` fige l'impulsion.
- **`fire_one`** (net_push.cpp) : `if (has_capture) { strlcpy(job.body, captured_body) ; has_capture=false; }`
  **sinon** `sink_render_body(...)` live (inchangé). `url`/`headers`/`method` restent lus **live** sous
  mutex (config statique) ⇒ **pas de course**.
- **`button_event_cb`** (view.cpp) : `if (c->momentary)` ⇒ `dash_ctx_pulse_*` ; sinon chemin `set`
  existant. Toujours sous `g_ctx_mutex` bloquant (patron B1).

**Propriétés.**
- **Ré-tir** : `ctx_set_*` renvoie `true` à **chaque** écriture (sauf contexte plein) — pas seulement au
  changement — donc `dash_ctx_write_ui_*` ré-arme à chaque tap **indépendamment** du reset, y compris pour
  une **même valeur** répétée. Le reset EXTERNAL à `rest` ne sert donc **qu'à la retombée** d'un afficheur
  `bind` (rendu race-free par la capture) : `context_apply` (~100 ms) lit le ctx après coup et le voit à
  `rest` (le flash `value`→`rest` du callback n'est pas observé). Retombée conforme spec socle §4.4.
- **Sans hypothèse de timing** : le corps est figé au tap ; correct pour **tout** `debounce_ms`.
- **N'affecte pas les sliders** : eux n'appellent jamais le chemin pulse ⇒ live-at-fire conservé ⇒
  debounce de traîne (coalescence du drag) intact.
- **Durée de vie de `has_capture`** : entre l'arm-pulse et le tir (vidé au tir). Un write live
  intercalé sur la même var l'efface et ré-arme en live (last-writer-wins ; cas d'un momentary et d'un
  autre effecteur sur la **même** var = rare, sémantique acceptée).

## 5. `slider` / `arc` / `roller` — build / callback / sync

### 5.1 build
- **`build_slider`** : `lv_slider_create` ; `lv_slider_set_range(w, vmin, vmax)` ; orientation via
  `bar_vertical` ; taille depuis `Placement` ; `user_data=&c` ; `add_event_cb(..., LV_EVENT_VALUE_CHANGED)`.
- **`build_arc`** : `lv_arc_create` (mode **input**, l'utilisateur traîne le bouton) ; range `vmin..vmax` ;
  géométrie depuis `Placement.radius/thickness/gap_deg/start_angle` (réutilise le patron ring) ;
  `user_data=&c` ; `add_event_cb(..., LV_EVENT_VALUE_CHANGED)`.
- **`build_roller`** : `lv_roller_create` ; `lv_roller_set_options(w, roller_options, LV_ROLLER_MODE_NORMAL)`
  (déjà joints par `\n`) ; `lv_roller_set_visible_row_count(w, roller_rows)` ; `user_data=&c` ;
  `add_event_cb(..., LV_EVENT_VALUE_CHANGED)`.
- **`step`** : LVGL n'a pas de « step » natif sur slider/arc ⇒ appliqué par **arrondi de la valeur lue**
  dans le callback avant l'écriture UI (`val = vmin + round((val - vmin) / step) * step`, borné). `step ≤ 0`
  ⇒ pas de quantification (granularité 1 native LVGL).

### 5.2 callbacks (écriture UI)
`VALUE_CHANGED` ⇒ `lock(g_ctx_mutex)` → `dash_ctx_write_ui_num(s_dash, c->bind, <val>, millis())` →
`unlock`. Tous **numériques** : slider/arc = `lv_slider_get_value`/`lv_arc_get_value` ; roller =
`lv_roller_get_selected` (**index**). Garde `bind` vide (symétrie B1 / `context_apply`). Écriture
**live** pendant le drag (le debounce de traîne coalesce côté sink).

### 5.3 sync (reflet) — anti-conflit
`sync_slider`/`sync_arc`/`sync_roller` : **garde** `if (lv_obj_has_state(w, LV_STATE_PRESSED)) return;`
(doigt posé ⇒ on ne re-synchronise pas depuis le ctx, on ne casse pas le geste) ; sinon
`lv_slider_set_value`/`lv_arc_set_value`/`lv_roller_set_selected` depuis le ctx (num → int/index).
Edge connu et accepté : l'inertie du roller après relâchement n'est pas couverte par `PRESSED` (rare).

### 5.4 reflet dans `context_apply`
Cases `COMP_SLIDER`/`COMP_ARC`/`COMP_ROLLER` ⇒ posent `c.value` (int) depuis le ctx num (patron `bar`) ;
`sync_*` applique au widget (sous la garde `PRESSED`).

## 6. Réseau / debounce

**Aucun changement firmware.** Le drag écrit en live ⇒ rafraîchit `pending_since` ⇒ coalescence en
**1 POST** après settle via le debounce de traîne existant (`sink_should_fire`). Le défaut
`debounce_ms > 0` pour slider/arc relève des **templates designer (Plan C2)** ; pour la vérif on-device
B2, le layout de test posera un `debounce_ms` explicite (ex. 300).

## 7. Parser (`dash_set_layout`)

Parse `momentary` (button), `step`, orientation (chemin `bar_vertical` générique), roller `options`
(→ joints `\n` dans `roller_options`, borné `ROLLER_OPTS_LEN`) et `rows` (borné `MAX_ROLLER_ROWS`),
min/max (chemin `vmin`/`vmax`). Tolérant aux clés inconnues (comme aujourd'hui). Le schéma strict
(`layout.schema.json`) **n'est pas** touché en B2 (→ C2).

## 8. Tests & vérification

- **Natif** (`pio test -e native`, cœur pur) : capture à l'armement —
  (a) `dash_ctx_pulse_*` arme **et** capture le corps rendu ; (b) le reset intercalé **n'arme pas** ;
  (c) `fire_one`/logique équivalente utilise la capture **puis** la vide ; (d) un write **live** efface
  une capture périmée ; (e) pulses répétés (même valeur) ré-arment. `sink_render_body`/`sink_should_fire`
  déjà couverts (Plan A).
- **Non natif-testable** (comme les afficheurs / B1) : rendu `view.cpp` + callbacks. Couverts par
  `pio run -e esp32s3` (build) + **vérif on-device** : slider/arc drag écrit + reflète **sans
  arrachage**, **1 POST** après settle ; roller scroll → index ; momentary tap → POST de **l'impulsion**
  (capture) + retombée + ré-tir ; un afficheur `bind` sur la même var reste cohérent. Critères spec
  socle §8 (points 2 et 3).

## 9. Hors périmètre B2 (différé)

- **Schéma + designer** des 4 comportements ⇒ **Plan C2** (registre/render/canvas/inspecteur/i18n +
  `comp_slider`/`comp_arc`/`comp_roller` + `momentary` sur button, parité par test strict).
- **Mapping `values[]`** du roller (index → valeur émise) — l'index suffit en v1.
- **Édition à l'encodeur** (modèle focus LVGL).

## 10. Critères de succès (B2)

1. `momentary` : tap ⇒ **1 POST** portant l'**impulsion** (corps figé au tap), var retombée au repos,
   ré-tir possible (même valeur) — quel que soit `debounce_ms`.
2. slider/arc : drag ⇒ écrit la var en live, un afficheur `bind` reflète ; **1 seul POST** après settle
   (debounce) ; une écriture EXTERNAL pendant le drag **n'arrache pas** le doigt (garde `PRESSED`).
3. roller : scroll ⇒ écrit l'**index**, reflet cohérent.
4. `pio test -e native` + `pio run -e esp32s3` au vert ; nav (encodeur = pages) et afficheurs
   existants **non régressés**.
