# Formes de base (`rect` / `circle` / `line`) — design

> Spec validée le 2026-06-22. Source de cadrage : brainstorming (décisions ci-dessous).
> Prochaine étape : plan d'implémentation (writing-plans).

## Motivation

La palette gagne trois primitives **décoratives** pour structurer un dashboard :
rectangles (cartes, cadres, fonds de zone), cercles (pastilles, repères) et droites
(séparateurs). Aucune donnée : pas de `bind`, pas de push de valeur — ce sont des
ornements posés et stylés dans le designer. Elles complètent les afficheurs existants
sans introduire de canal entrant/sortant.

## Contexte technique vérifié (live source, 2026-06-22)

- **Projet en LVGL 9.5** (`platformio.ini`, cf. `CLAUDE.md`). Pas de widget « forme »
  dédié : LVGL sert les formes via du style.
- **Rect/cercle = `lv_obj` stylé** : `bg_color` + `bg_opa` (opa 0 ⇒ pas de fond),
  `border_width`/`border_color`/`border_opa`, `radius` (px ; `LV_RADIUS_CIRCLE` =
  pilule/cercle quand l'objet est carré). `lv_obj` est toujours disponible (pas de flag).
- **Droite = widget `lv_line`** : `lv_line_set_points`, styles `line_width`,
  `line_color`, `line_opa`, `line_rounded`, et `line_dash_width`/`line_dash_gap`.
  Nécessite `LV_USE_LINE`.
- **Limites LVGL confirmées (Context7, 9.5)** :
  - Les **bordures d'`lv_obj` sont toujours pleines** — il n'existe pas de style
    « bordure pointillée ». Le pointillé n'existe que pour `lv_line`.
  - `line_dash_*` ne s'affiche **que sur les lignes horizontales ou verticales**.
  - Pas de vraie ellipse : `radius` est plafonné à la moitié du petit côté
    (rect large + radius max ⇒ stade/pilule, pas ellipse).
- **`lv_line` ne copie pas son tableau de points** : il garde le pointeur. Le tableau
  doit donc vivre aussi longtemps que l'objet (à stocker côté struct, cf. câblage).
  En v9 les points sont des `lv_point_precise_t`.
- Firmware **table-driven** : table nom→enum + parser à champs plats sur `Component`
  (`src/dashboard.{h,cpp}`), table `{build, sync}` indexée par `CompType` (`src/view.cpp`,
  l. 462-472). Designer **registry-driven** : `designer/js/registry.js` (un test de
  conformité vérifie que ses clés == les types du schéma).

## Décisions de cadrage (brainstorming, validées)

1. **Droites = séparateurs H/V** pour cette itération (orientation + longueur +
   épaisseur, ancrés comme les autres composants). Le pointillé marche donc toujours.
   Le modèle « 2 points libres » (diagonales) est explicitement reporté.
2. **3 types distincts** : `rect` (largeur/hauteur + rayon de coin, couvre coins
   arrondis et pilule), `circle` (un seul champ diamètre), `line`. Redondance
   rect/cercle assumée pour coller au modèle mental.
3. **Contours pleins sur les figures** : pas de contour pointillé sur rect/cercle
   (non servi par LVGL ; le bricoler en assemblant des `lv_line` serait coûteux/fragile
   sur ESP32). Le pointillé reste réservé aux droites.
4. **`radius` (rayon de coin du rect) vit dans `placement`** (géométrie), comme
   `width`/`height` — réinterprété par type, à l'image de l'anneau qui réinterprète
   déjà `radius`.
5. **Pointillé = présets** `solid` / `dashed` / `dotted` (enum), pas deux nombres bruts.
6. **Statique + `visible` seulement** : montrable/masquable à chaud via `/update`
   (cohérent avec tous les composants), mais ni couleur ni géométrie dynamiques.

## Modèle de données (schéma)

Trois `$defs` (`comp_rect`, `comp_circle`, `comp_line`) ajoutés à `component.oneOf`.
Tous portent `type` + `visible` (comme les autres). Aucun `bind`.

**`comp_rect` / `comp_circle`** (mêmes champs de style) :

| Champ | Type | Défaut | Rôle |
|---|---|---|---|
| `type` | `"rect"` / `"circle"` | — | discriminant |
| `visible` | bool | `true` | `LV_OBJ_FLAG_HIDDEN` au rendu ; révélable via `/update` |
| `fill` | hexColor | **absent ⇒ pas de fond** | couleur de remplissage (`bg_color`, `bg_opa` 255) |
| `border_color` | hexColor | `#FFFFFF` | couleur du contour (ignorée si `border_width` 0) |
| `border_width` | int ≥ 0 | `0` ⇒ **pas de contour** | épaisseur du contour en px |

« Contour seul » = `fill` absent + `border_width` > 0. « Plein sans contour » =
`fill` présent + `border_width` 0.

**`comp_line`** :

| Champ | Type | Défaut | Rôle |
|---|---|---|---|
| `type` | `"line"` | — | discriminant |
| `visible` | bool | `true` | idem |
| `color` | hexColor | `#FFFFFF` | couleur du trait (`line_color`) |
| `orientation` | enum `horizontal`\|`vertical` | `horizontal` | sens du séparateur (réutilise `bar.orientation`) |
| `dash` | enum `solid`\|`dashed`\|`dotted` | `solid` | présets → `line_dash_width`/`line_dash_gap` |
| `rounded` | bool | `false` | bouts arrondis (`line_rounded`) |

Présets `dash` (valeurs px figées au plan) : `solid` ⇒ 0/0 ; `dashed` ⇒ trait long /
écart moyen ; `dotted` ⇒ trait court / écart court (rendu rond si `rounded`).

## Géométrie (placement)

Aucune clé de géométrie neuve — réutilisation des clés `placement` existantes,
réinterprétées par type (le firmware les lit déjà ainsi : `size` est LED-only,
`radius`/`thickness` sont ring-only, `width`/`height` varient par type).

| Type | Clés `placement` utilisées |
|---|---|
| `rect` | `anchor`, `dx`, `dy`, `width`, `height`, `radius` (rayon de coin, déf. 0) |
| `circle` | `anchor`, `dx`, `dy`, `size` (diamètre) |
| `line` | `anchor`, `dx`, `dy`, `width` (longueur), `thickness` (épaisseur) |

`orientation` (H/V) de la droite est porté **sur le composant** (table `comp_line`
ci-dessus), pas sur le placement — comme `bar.orientation` — pour que l'inspecteur le
présente avec les autres réglages de style. La longueur (`width`) reste dans le
placement (modifiable par page), comme pour `bar`.

## Logique firmware

Aucune logique d'état : les trois formes ont `sync = nullptr` dans la table
`{build, sync}` (statiques, comme `image`). Le seul comportement runtime est `visible`
(déjà géré génériquement par le moteur via `LV_OBJ_FLAG_HIDDEN`).

- **`build_rect` / `build_circle`** : `lv_obj_create(parent)`, `lv_obj_set_size`
  (circle : `size`×`size`), `lv_obj_set_style_radius` (circle : `LV_RADIUS_CIRCLE` ;
  rect : `radius`), `bg_color`/`bg_opa` (0 si `fill` absent), `border_width`/
  `border_color`. Désactiver le scroll/clic (`LV_OBJ_FLAG_SCROLLABLE` off) pour un
  ornement inerte.
- **`build_line`** : `lv_line_create(parent)`, calcul des **2 points** depuis
  l'orientation + longueur (H : (0,0)→(width,0) ; V : (0,0)→(0,width)), `lv_line_set_points`,
  styles `line_width`(=`thickness`)/`line_color`/`line_dash_*`/`line_rounded`.
  **Le tableau de 2 `lv_point_precise_t` doit persister** : le stocker dans la struct
  associée à l'objet (p. ex. dans le `Placement`/`Component` côté firmware), pas en
  variable locale.

## Rendu designer (`render.js`) — parité

- **`buildRect`** : `<div>` à `width`/`height`, `background` = `fill` (ou transparent),
  `border` = `border_width`px solid `border_color`, `border-radius` = `radius`px.
- **`buildCircle`** : idem en `size`×`size`, `border-radius: 50%`.
- **`buildLine`** : `<div>` fin ; trait via `border-top` (H) / `border-left` (V) de
  style `solid`/`dashed`/`dotted` mappé sur `dash`, épaisseur `thickness`, couleur
  `color` ; `border-radius` si `rounded`. Le rendu CSS `dashed`/`dotted` approche le
  pointillé LVGL (parité « suffisante » — l'exactitude des longueurs de tirets n'est
  pas un invariant, seul l'aspect général l'est).

## Câblage (par couche)

- **`schema/layout.schema.json`** : `$defs/comp_rect`, `comp_circle`, `comp_line` +
  3 entrées dans `component.oneOf`. Pas de nouvelle clé `placement` (réutilisation).
- **`designer/js/registry.js`** : 3 entrées (`defaults`, `makePlacement`, `compFields`,
  `placeFields`, `build`) ; `physical:false`, `centered:false`. Import des `build*`.
- **`designer/js/render.js`** : `buildRect`/`buildCircle`/`buildLine`.
- **`designer/js/inspector.js`** : un seul nouvel éditeur **`dash`** (select enum,
  sur le modèle de `barmode`/`orient`/`arcmode`). Le reste réutilise `color`/`num`/
  `bool`/`orient`. Le champ `fill` utilise l'éditeur `color` (vidé ⇒ clé supprimée ⇒
  pas de fond, cf. convention « champ vidé = défaut »).
- **`designer/js/canvas.js`** : poignées de redimensionnement — `rect` réutilise les
  multi-poignées (déjà en place pour bar/chart/image) ; `circle` = une poignée
  (diamètre) ; `line` = une poignée de longueur sur son axe.
- **`designer/js/icons.js`** : 3 glyphes (rect, cercle, droite), style maison.
- **`src/dashboard.h`** : `COMP_RECT`/`COMP_CIRCLE`/`COMP_LINE` dans `CompType`
  (avant `COMP_COUNT`) ; champs neufs sur la struct composant (`fill`(+flag présent),
  `border_color`, `border_width`, `dash`, `rounded`) ; stockage persistant des points
  de ligne.
- **`src/dashboard.cpp`** : 3 entrées dans la table nom→type ; parsing des champs de
  forme (gardé par type) ; `orientation` réutilisé (déjà parsé pour `bar`).
- **`src/view.cpp`** : `build_rect`/`build_circle`/`build_line` + entrées (`sync` =
  `nullptr`) dans la table `{build, sync}`.
- **`src/lv_conf.h`** : `#define LV_USE_LINE 1` (convention « lister les widgets extra
  utilisés », cf. `LV_USE_LED`). `lv_obj` ne demande aucun flag.

## Tests

- **`cd designer && node --test`** : la conformité registry↔schéma (`tests/registry.test.js`)
  couvre l'ajout des 3 types ; ajouter des cas de validation `rect`/`circle`/`line`
  bien/mal formés.
- **`pio test -e native`** : un layout avec les 3 formes parse ; les champs de style et
  la géométrie sont lus correctement (et `fill` absent ⇒ pas de fond).
- **Vérif navigateur** : parité d'aperçu des 3 formes (fond/contour/rayon, présets de
  pointillé, bouts arrondis) ; redimensionnement au canvas.
- **e2e device** en fin de parcours (le pointillé H/V s'affiche, le contour reste plein).

## Hors-scope (volontaire)

- **Droites diagonales / modèle 2-points** : reporté (décision 1).
- **Contour pointillé sur rect/cercle** : non servi par LVGL (décision 3).
- **Ellipse libre** : non servie par `lv_obj` (radius plafonné).
- **Dégradé de fond, opacité partielle** : YAGNI ; extensions faciles plus tard
  (`bg_grad`/`bg_opa` existent déjà côté LVGL).
- **Couleur/géométrie poussables via `/update`** : statique + `visible` seulement
  (décision 6). Le rect/cercle « voyant d'état » à couleur dynamique reste une
  extension possible ultérieure.
