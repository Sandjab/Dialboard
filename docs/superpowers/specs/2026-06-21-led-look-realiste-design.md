# LED — rendu réaliste + attributs de look — design

> Spec validée le 2026-06-21 (suite du composant `led` de base). Prochaine étape : plan.

## Motivation

Le `led` de base rend un disque plat + halo simple. On veut un voyant **réaliste**
(dôme bombé, glow, reflet spéculaire, bezel) et **configurable par LED** via des
booléens, avec **parité designer↔device** (exigée par `CLAUDE.md`). Les valeurs
numériques du look sont des **constantes maison** (réglées dans le playground) ; chaque
effet a un **booléen** pour l'activer.

## Décisions de cadrage

1. **4 attributs booléens par LED** (défaut `true` = look réaliste ; on désactive pour une
   LED plus sobre) : `glow`, `bezel`, `specular`, `off_glass` (ce dernier = garder un
   reflet de verre quand éteint ; sous-option de `specular`).
2. **Toujours appliqués** (pas de toggle) : le **dôme** (corps en dégradé) et le **rendu
   éteint** — une LED a toujours un corps et un état éteint.
3. **Dégradés radiaux activés sur le device** : `LV_USE_DRAW_SW_COMPLEX_GRADIENTS 1`
   (`src/lv_conf.h`) → dôme centré + reflet doux fidèles. Marge dispo (Flash 26,6 %).
4. **Spéculaire firmware = objet enfant** dessiné au-dessus de la LED (lv_led ne sait pas
   le faire nativement).

## Constantes maison (figées)

| Effet | Constantes |
|---|---|
| Dôme | lumière 38%/30% ; centre éclairci +62 % (vers blanc) ; bord assombri +24 % (vers noir) |
| Glow (allumé) | flou 20px, diffusion 5px, opacité 1.0, + halo large plus diffus |
| Spéculaire | Ø 24 % de la LED, opacité 0.62 (allumé) |
| Bezel | profondeur 8px |
| Éteint | corps assombri 69 % (teinte gardée) |
| Reflet verre éteint | opacité 0.12 |

## Attributs ajoutés (schéma `comp_led`)

Quatre booléens, `default true` côté firmware/registry :

| Attribut | Type | Défaut | Rôle |
|---|---|---|---|
| `glow` | boolean | true | halo externe à l'allumage |
| `bezel` | boolean | true | anneau encastré |
| `specular` | boolean | true | reflet spéculaire |
| `off_glass` | boolean | true | garder le reflet (faible) quand éteint |

(Existant inchangé : `color`, `off_below`, `thresholds`, `bind`, `size`.)

## Rendu designer (`buildLed`, render.js + .w-led)

Réécriture de `buildLed` pour reproduire les constantes ci-dessus, conditionnées par les
booléens du composant :
- **Corps** : `radial-gradient` (centre 38%/30%, centre éclairci, bord assombri) — toujours.
- **Glow** (si `glow`) : double `box-shadow` (proche 20/5px opacité 1.0 + halo large diffus),
  uniquement à l'allumage.
- **Spéculaire** (si `specular`) : pastille radiale blanche (Ø 24 %, opacité 0.62) au point
  lumineux ; à l'éteint, opacité 0.12 si `off_glass`, sinon masquée.
- **Bezel** (si `bezel`) : ombres internes (profondeur 8px) + contour.
- **Éteint** : corps assombri 69 % en gardant la teinte, pas de glow — toujours.
Les valeurs sont des constantes du module (pas des champs). Couleur allumée = seuil
(`pickThresholdColor`) sinon `color`. État (allumé/éteint) = `ledLit(value, off_below)`.

## Rendu firmware (`lv_led` enrichi, view.cpp)

- **Dôme** : `lv_obj_set_style_bg_grad()` avec un `lv_grad_dsc_t` **radial** (centre 38%/30%,
  2 stops : centre haute-luminance, bord basse-luminance). `lv_led` recolorie ces stops
  selon leur **luminance** dans la teinte de la LED + module par la brightness → dôme dans
  la bonne couleur, auto-atténué à l'éteint. Toujours appliqué.
- **Glow** (si `glow`) : `shadow_width`/`shadow_spread`/`shadow_color` du style ; `lv_led`
  l'atténue déjà par la luminosité (glow seulement allumé). Si `!glow` : shadow_width 0.
- **Bezel** (si `bezel`) : `border_width`/`border_color` du style.
- **Spéculaire** (si `specular`) : **objet enfant** (`lv_obj`) au-dessus de la LED, petit
  cercle au point lumineux, `bg_grad` radial blanc→transparent (opacité 0.62). Handle stocké
  dans `sub1` de la vtable, synchronisé par `sync_led`. À l'éteint : opacité 0.12 si
  `off_glass`, sinon `hidden`. Si `!specular` : pas d'enfant.
- **Éteint** : `lv_led_off()` (brightness MIN=80 ≈ 31 % de la couleur) — coïncide avec
  l'assombrissement 69 % du designer (garde 31 %). Pas de contournement nécessaire.
- **Conf** : `#define LV_USE_DRAW_SW_COMPLEX_GRADIENTS 1` dans `src/lv_conf.h`.

## Parité (best-effort, assumée)

- **Dôme** : device recolorie par luminance (chemin différent du CSS) → dôme fidèle en
  direction/hue, pas pixel-identique. Acceptable.
- **Spéculaire** : radial des deux côtés (gradients complexes activés) → proche.
- **Éteint** : naturellement aligné (~31 % des deux côtés).
- **Glow** : profil d'atténuation lv_led ≠ box-shadow CSS exact, mais halo équivalent.

## Tests

- **Designer** (`node --test`) : schéma — un `led` avec les 4 booléens valide ; booléen
  inconnu rejeté (`additionalProperties:false`). Conformité registre↔schéma déjà couverte.
  `ledLit` inchangé.
- **Firmware** (`pio test -e native`) : parse des 4 booléens (présents → valeur, absents →
  défaut true). `test_schema_types_all_resolve` reste vert. Build `esp32s3` compile (gradients
  complexes activés).
- **Visuel** : playground/harness + screenshot designer (allumé/éteint × effets on/off) ;
  flash device sur demande pour vérifier la parité réelle.

## Hors-scope

- Pas de réglage numérique par LED (constantes figées — décidé).
- Pas de clignotement/animation, pas de libellé intégré, pas de canal sortant.
- `thresholds` reste en JSON avancé (convention ring/meter).

## Risques / à confirmer en implémentation

- Mapping exact des stops radiaux pour que la recolorisation par luminance de `lv_led`
  rende le dôme voulu (centre clair → bord sombre). À ajuster visuellement.
- Centre du gradient radial (`focal`/`center` du `lv_grad_dsc_t`) en coordonnées locales de
  la LED (38%/30% de `size`). API `lv_grad` radiale à câbler précisément dans le plan.
- L'objet enfant spéculaire doit suivre la LED (même parent, position relative) et ne pas
  capter les events (purement décoratif).
