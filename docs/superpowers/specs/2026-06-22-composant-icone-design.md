# Composant `icon` (icône / symbole) — design

> Spec validée le 2026-06-22. Source de cadrage : brainstorming (décisions ci-dessous).
> Prochaine étape : plan d'implémentation (writing-plans).

## Motivation

La palette gagne un **afficheur de statut** : un glyphe symbole (`LV_SYMBOL_*`) dont le
**dessin** et la **couleur** suivent une valeur poussée. Couvre wifi on/off, niveau de
batterie, cloche d'alerte, état ok/warning/erreur — **sans bitmap ni upload d'asset**.
Techniquement c'est un `lv_label` rendu en police de symboles. Contrairement aux formes
(décoratives, statiques), l'icône est **pilotée par la donnée**, comme `led`/`bar`/`meter`.

## Contexte technique vérifié (live source, 2026-06-22)

- **Projet en LVGL 9.5** (`platformio.ini`, cf. `CLAUDE.md`).
- **Symboles built-in** : `.pio/libdeps/esp32s3/lvgl/src/font/lv_symbol_def.h` définit 61
  macros `LV_SYMBOL_*` (ex. `WIFI`, `BLUETOOTH`, `GPS`, `USB`, `BATTERY_EMPTY/1/2/3/FULL`,
  `CHARGE`, `POWER`, `BELL`, `WARNING`, `OK`, `CLOSE`, `PLAY`, `PAUSE`, `STOP`, `VOLUME_MAX`,
  `MUTE`, `HOME`, `SETTINGS`, `REFRESH`…). Ce sont des **chaînes UTF-8** (codepoints FontAwesome
  en zone privée) **fusionnées dans toutes les fontes Montserrat embarquées** (14/20/28/36/48,
  cf. `src/lv_conf.h`) → **coût flash quasi nul**, aucune fonte à ajouter. (À reconfirmer
  Context7 `/websites/lvgl_io_open` 9.x dans l'implémentation.)
- **`threshold_color(t, n, value, base)`** (`src/color.cpp`) : renvoie la couleur de la
  **première bande où `value < limite`**, sinon `base`. La résolution d'état de l'icône
  **calque exactement** cette règle (une seule itération produit glyphe + couleur).
- **L'inspecteur a déjà un éditeur de seuils répétable** (`designer/js/inspector.js:136-157` :
  lignes `[limite, couleur]`, bouton `+ seuil`, `×`, aperçu live couleur) → modèle direct de
  l'éditeur `states`.
- **Parité designer** : le navigateur n'a pas la fonte FontAwesome de LVGL → chaque nom de
  symbole est mappé vers un **SVG** (style Feather, comme les icônes data-URI déjà utilisées
  dans l'inspecteur, cf. `7c067b3`). Parité « best-effort » assumée (chemins de rendu
  différents mais même famille visuelle, comme la LED).
- Firmware **table-driven** : table nom→enum + parser à champs plats sur `Component`
  (`src/dashboard.{h,cpp}`), table `{build, sync}` indexée par `CompType` (`src/view.cpp`).
  Designer **registry-driven** : `designer/js/registry.js` (test de conformité registry↔schéma).

## Décisions de cadrage (brainstorming, validées)

1. **Glyphe ET couleur dynamiques** (option la plus riche, choisie explicitement). Une **seule
   valeur scalaire** pilote tout (push par id, ou `bind` pour le pull) — pas deux canaux.
2. **Table d'états unifiée** (`states`) : une seule liste ordonnée pilote à la fois le glyphe
   et la couleur. Les deux axes **partagent les mêmes bornes** (limite assumée — voir hors-scope).
3. **Symboles built-in `LV_SYMBOL_*`** pour la v1 ; fonte d'icônes custom = extension future.
4. **Sous-ensemble curaté ~23 symboles** (et non les 61) pour borner le travail de map SVG
   designer + l'enum schéma. Extensible ensuite par simple ajout (firmware : table nom→macro ;
   designer : map nom→SVG ; schéma : enum).
5. **Type schéma = `icon`** ; valeurs de glyphe = **noms** (`wifi`, `battery_full`…), pas des
   codepoints ASCII bruts (lisible, validable, indépendant de l'encodage).
6. **Forme objet pour `icon_state`** (`{at, symbol?, color?}`) plutôt que le tuple `[limite,#hex]`
   des `threshold` : deux charges utiles **optionnelles**, qu'un tuple positionnel ne peut omettre.
7. **Défauts** : `symbol` de base `bell`, `color` de base `#FFFFFF`, `font` `28`.
8. **Pas de redimensionnement au canvas** : la taille est portée par `font` (comme `label`),
   donc aucune poignée de resize.

## Modèle de données (schéma)

Trois ajouts à `schema/layout.schema.json` : `$defs/symbolName` (enum), `$defs/icon_state`
(objet), `$defs/comp_icon` (+ 1 entrée dans `component.oneOf`).

**`comp_icon`** (`additionalProperties:false`, `required:["type"]`) :

| Champ | Type | Défaut | Rôle |
|---|---|---|---|
| `type` | `"icon"` | — | discriminant |
| `visible` | bool | `true` | `LV_OBJ_FLAG_HIDDEN` au rendu ; révélable via `/update` |
| `bind` | `ascii` | absent | nom de variable du contexte (pull) ; absent ⇒ push par id |
| `symbol` | `symbolName` | `bell` | glyphe **de base** (quand aucune bande ne matche) |
| `color` | `hexColor` | `#FFFFFF` | couleur **de base** (`text_color`) |
| `font` | `font` (14/20/28/36/48) | `28` | taille du glyphe |
| `states` | `icon_state[]` | `[]` | table d'états ; vide ⇒ icône statique colorée |

**`icon_state`** (objet, `additionalProperties:false`, `required:["at"]`) :

| Champ | Type | Rôle |
|---|---|---|
| `at` | number (requis) | borne : bande sélectionnée si `value < at` |
| `symbol` | `symbolName` (option.) | glyphe de la bande ; **omis ⇒ retombe sur le `symbol` de base** |
| `color` | `hexColor` (option.) | couleur de la bande ; **omis ⇒ retombe sur le `color` de base** |

**`symbolName`** : `enum` de ~23 noms v1 →
`wifi, bluetooth, gps, usb, battery_empty, battery_1, battery_2, battery_3, battery_full,
charge, power, bell, warning, ok, close, play, pause, stop, volume_max, mute, home, settings,
refresh`. Chacun mappé 1:1 vers un `LV_SYMBOL_*` (firmware) et un SVG (designer).

## Sémantique de résolution (cœur)

À chaque valeur (poussée scalaire, ou lue via `bind`) :

1. Parcourir `states` dans l'ordre ; **première** bande `i` où `value < states[i].at` gagne.
2. La bande gagnante donne `symbol = states[i].symbol || symbol_base` et
   `color = states[i].color || color_base`.
3. **Aucune** bande ne matche (valeur ≥ toutes les bornes) ⇒ `(symbol_base, color_base)`.
4. `states` **vide** ⇒ toujours `(symbol_base, color_base)` (icône statique).

C'est **la règle de `threshold_color`**, étendue pour produire aussi le glyphe en une seule
itération. Conséquence (cohérente avec `led`) : la base s'affiche quand la valeur est **au-dessus
de toutes les bornes** (ou table vide) ; sous la plus petite borne, c'est la première bande.

## Géométrie (placement)

Comme `label` : `anchor`, `dx`, `dy` **seulement**. La taille effective vient de `font` ;
**aucune clé width/height/size** et **aucune poignée de resize** au canvas.

## Logique firmware

- **`build_icon`** : `lv_label_create(parent)`, `lv_label_set_text(label, <glyphe base>)`,
  `lv_obj_set_style_text_font` (selon `font`), `lv_obj_set_style_text_color` (base).
  Scroll/clic désactivés (`LV_OBJ_FLAG_SCROLLABLE` off) — afficheur inerte.
- **`sync_icon`** (value-driven, comme `led`/`bar`) : résout la bande (sémantique ci-dessus) →
  `lv_label_set_text(<glyphe résolu>)` + `lv_obj_set_style_text_color(<couleur résolue>)`.
  Les `LV_SYMBOL_*` étant des **littéraux statiques** (`const char*`), `lv_label_set_text` en
  fait une **copie interne** — pas de souci de durée de vie (contrairement aux points de `lv_line`).
- **Table nom→glyphe** : un mapping `symbolName → const char* LV_SYMBOL_*` (statique).
- **Stockage des états** : un petit tableau fixe sur `Component` (miroir de
  `thresholds[MAX_THRESHOLDS]`), chaque entrée portant `at`, l'index/pointeur de symbole et la
  couleur, **plus des flags de présence** `has_symbol`/`has_color` (pour le fallback base). Le
  symbole de base est aussi stocké (index/pointeur). Dimensionnement exact = détail du plan.
- `lv_conf.h` **inchangé** : `lv_label` est natif et les symboles sont déjà dans les fontes.

## Rendu designer (`render.js`) — parité

- **`buildIcon`** : `<div>` contenant le **SVG** du symbole résolu, dimensionné ≈ `font`px,
  coloré via `fill`/`stroke` = couleur résolue. La résolution de bande est une **fonction pure**
  (mirroir de la sémantique firmware) → **testable node** (glyphe + couleur, fallback base, no-match).
- **Map `symbolName → SVG`** : ~23 entrées style Feather. La **batterie** (`battery_empty/1/2/3/full`)
  = un **SVG paramétrique** (contour + niveau de remplissage proportionnel) plutôt que 5 dessins
  distincts. Les autres ont un équivalent Feather direct (wifi, bluetooth, navigation→gps,
  battery-charging→charge, power, bell, alert-triangle→warning, check→ok, x→close, play, pause,
  square→stop, volume-2→volume_max, volume-x→mute, home, settings, refresh-cw→refresh).

## Inspecteur (`inspector.js`)

- Champs de base : `symbol` (**select** de `symbolName`, sur le modèle des selects `SELECTS`),
  `color` (éditeur `color` existant + aperçu live), `font` (éditeur existant).
- **Éditeur `states`** = extension de l'éditeur de seuils existant : une ligne par état =
  `at` (num, undo coalescé) + `symbol` (select) + `color` (color + aperçu live) + `×` ;
  bouton `+ état`. Mutation dédiée (`setIconStates`, pure, testable) sur le modèle de `setThresholds`.
- **`mockFields`** : une **valeur d'aperçu** (mock, non poussée) pour prévisualiser la bande
  active au canvas (réutilise le mécanisme `getMock`/`setMock` de `bar`/`meter`/`led`).

## Câblage (par couche)

- **`schema/layout.schema.json`** : `$defs` `symbolName`, `icon_state`, `comp_icon` + 1 entrée
  dans `component.oneOf`. Aucune nouvelle clé `placement` (réutilise `anchor`/`dx`/`dy`).
- **`designer/js/registry.js`** : 1 entrée `icon` (`defaults` {symbol:'bell', color:'#FFFFFF',
  font:28, states:[]}, `makePlacement`=anchor/dx/dy, `compFields`, `mockFields`, `build`) ;
  `physical:false`, `centered:false`. Import de `buildIcon`.
- **`designer/js/render.js`** : `buildIcon` + map `symbolName → SVG` + résolveur de bande pur.
- **`designer/js/inspector.js`** : select `symbol`, éditeur `states`, câblage `mockFields`.
- **`designer/js/icons.js`** : 1 glyphe de palette pour le type `icon`.
- **`designer/js/mutations.js`** (ou là où vivent `setThresholds`/`setBarOrientation`) :
  `setIconStates` (pure, testée).
- **`src/dashboard.h`** : `COMP_ICON` dans `CompType` (avant `COMP_COUNT`) ; champs neufs
  (symbole de base, tableau d'états icône + count + flags de présence).
- **`src/dashboard.cpp`** : 1 entrée dans la table nom→type ; parsing `symbol`/`states`/`font`/
  `color` (gardé par type) ; table nom→`LV_SYMBOL_*`. `font` déjà parsé (label/readout).
- **`src/view.cpp`** : `build_icon` + `sync_icon` dans la table `{build, sync}` ; **mettre à jour
  les 2 `static_assert(... == COMP_COUNT)`**.
- **`src/lv_conf.h`** : **inchangé**.

## Tests

- **`cd designer && node --test`** : conformité registry↔schéma (auto) ; validation `icon`
  bien/mal formé (symbole hors enum, `at` manquant, `additionalProperties`) ; **résolveur de
  bande pur** (glyphe + couleur, fallback base sur champ omis, no-match → base, table vide) ;
  `setIconStates`.
- **`pio test -e native`** : parse d'un layout `icon` (symbol de base, états avec/sans
  symbol/color, font, color) lus correctement ; `test_schema_types_all_resolve` (auto).
- **Vérif navigateur (Playwright)** : parité du glyphe rendu, bascule de bande via la valeur
  mock, éditeur `states` (ajout/suppression/édition), aperçu live couleur.
- **e2e device** en fin de parcours : le glyphe **et** la couleur suivent un `POST /update`.

## Hors-scope (volontaire)

- **Fonte d'icônes custom** au-delà des built-in (décision 3) → extension future.
- **Glyphe et couleur pilotés par deux valeurs indépendantes** : une seule valeur, bornes
  partagées (décision 2). Cas « glyphe change à des bornes différentes de la couleur » ⇒ répéter
  le glyphe sur les bandes concernées (redondance mineure assumée).
- **Push direct d'un nom de symbole en string** via `/update` : rejeté (romprait le modèle
  scalaire « une valeur par id »).
- **Rotation / animation du glyphe, taille intermédiaire libre** : YAGNI.
- **Édition de `bind` / contexte** : inchangée (mécanisme pull existant).
