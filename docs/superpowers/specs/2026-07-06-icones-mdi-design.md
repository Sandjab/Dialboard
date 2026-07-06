# Icônes Material Design en Tiny TTF — design

- **Date** : 2026-07-06
- **Statut** : validé (brainstorm), prêt pour le plan
- **Composant touché** : le composant `icon` (firmware + designer + schéma + pipeline de fontes)

## 1. Contexte & objectif

Aujourd'hui le composant `icon` rend un des **23 symboles LVGL built-in** (`LV_SYMBOL_WIFI`,
`BATTERY_*`, `PLAY`…) via un `lv_label` en **police de symboles bitmap** (`pick_font` →
Montserrat, `src/view.cpp`). Deux limites :

- **catalogue fermé** (23 glyphes), impossible à enrichir sans coder de nouveaux `LV_SYMBOL` ;
- **tailles figées** (les Montserrat bitmap n'existent qu'en 14/20/28/36/48 px).

Objectif : élargir la bibliothèque d'icônes à un large catalogue **Material Design Icons (MDI)**,
rendu via l'infrastructure **Tiny TTF** déjà en place pour le texte (`get_font`, `fonts.cpp`) —
donc à **n'importe quelle taille** et recolorable — avec **parité designer↔firmware** et sélection
via un **picker** (recherche + catégories) dans le designer.

Idée inspirée d'ESPHome Designer (qui expose les Material Design Icons), adaptée au modèle
**runtime** de Dialboard (le set embarqué est figé dans la police ; il se régénère via un script,
il ne se compile pas par device comme chez ESPHome).

## 2. Décisions (tranchées au brainstorm)

1. **Un seul système, remplacer + re-mapper.** Tout passe par la police d'icônes Tiny TTF ;
   les 23 symboles actuels sont conservés **par leur nom** pour ne casser aucun layout.
2. **Police = Material Design Icons** (Pictogrammers), TTF statique monochrome (codepoints en
   Private Use Area), licence **Apache-2.0**.
3. **Catalogue ~300-500 icônes**, avec un **picker** designer à recherche + catégories.
4. **Validation stricte** : l'enum `$defs/symbolName` du schéma est **régénéré** avec tous les
   noms (le designer attrape une icône inexistante — fidèle à la philosophie parité/schéma du
   repo).

Principe transverse : **source de vérité unique = une liste de noms MDI committée**, d'où un script
génère tous les artefacts (police firmware, webfont designer, mapping, métadonnées du picker, enum
du schéma). Pas de double-maintenance.

## 3. Pipeline de génération — nouveau `tools/gen_icons.py`

Outil de **maintenance**, sur le modèle de `tools/gen_fonts.py` : les sorties sont **committées**,
le build normal n'exige ni réseau ni `fonttools`. Script **séparé** de `gen_fonts.py`
(responsabilité distincte : police *statique* + codepoints *PUA* + métadonnées, vs texte *variable*
+ Latin), réutilisant ses helpers de subset.

**Entrées :**

- `tools/icons/iconset.txt` — liste de noms MDI, une par ligne, **committée**. Supporte des
  **alias** `nom_dialboard=nom_mdi` (ex. `gps=crosshairs-gps`) pour préserver les 23 noms legacy
  quand le nom MDI diffère.
- Le TTF MDI + `meta.json` téléchargés depuis Pictogrammers à une **version épinglée**
  (reproductibilité).

**Sorties générées :**

| Fichier | Rôle |
|---|---|
| `src/fonts/font_icons.c` (+ `src/fonts/fonts_data.h`) | TTF MDI subsetté, tableau C (firmware) |
| `src/fonts/icons_gen.h` | `ICON_SYMBOL_NAMES[]`, `ICON_CODEPOINTS[]` (uint32_t), `ICON_SYMBOL_COUNT` |
| `designer/vendor/fonts/mdi.woff2` | webfont designer (parité) |
| `designer/vendor/icons/icons-data.js` | `[{name, cp, cat, tags}]` pour le picker |
| `schema/layout.schema.json` (`$defs/symbolName`) | enum régénéré (~300-500 noms) |
| `tools/fonts/licenses/` | licence MDI copiée |

**Robustesse :** un nom absent du `meta.json` MDI provoque une **erreur dure** (fail loud), pas une
icône fantôme. Génération **déterministe** (re-lancer = pas de diff parasite).

## 4. Firmware

- **`get_icon_font(px)`** (`src/fonts.{h,cpp}`) : Tiny TTF sur `font_icons`, branché sur le cache
  existant (une « famille » réservée aux icônes). Recoloration et tailles arbitraires comme le
  texte ; `cache_size=0` (rastérisation d'1 glyphe à la fois — respecte le pool LVGL de 48 Ko).
  Repli bitmap si la création échoue, comme `get_font`.
- **`src/view.cpp`** (`build_icon` / `sync_icon`) : `pick_font(c.font)` → `get_icon_font(c.font)` ;
  `ICON_GLYPHS` (LV_SYMBOL) → chaînes **UTF-8 des codepoints MDI** (issues de `icons_gen.h`). Les
  codepoints PUA (> U+FFFF, ex. U+F0594) sont encodés en UTF-8 4 octets ; `lv_label` les gère.
- **`src/dashboard.h`** : `icon_symbol` et `IconState.symbol` passent de **`uint8_t` à `uint16_t`**
  (index runtime > 255 possible ; **aucun impact sur le format layout**). `ICON_SYMBOL_NAMES` /
  `ICON_GLYPHS` proviennent du header généré `icons_gen.h`. `icon_symbol_index` (nom→index,
  linéaire, appelé une fois par composant au parse) inchangé. La table d'états `icon_states`
  (seuils glyphe/couleur) inchangée.

## 5. Designer

- **`designer/js/render.js` (`buildIcon`)** : rend le glyphe via la **webfont MDI**
  (`@font-face` + codepoint) au lieu de la map `ICON_SVG` faite-main — parité exacte avec le
  firmware (les deux rendent une police).
- **Picker d'icônes** dans l'inspecteur : le champ `symbol` passe d'un `<select>` à un bouton
  ouvrant une **grille filtrable** (recherche par nom/tags + filtre par catégorie), sur le modèle
  des overlays existants (publish / OTA). Données depuis `icons-data.js`.
- **`designer/style.css`** : `@font-face` pour `mdi.woff2`.
- **`tools/stage_fs.sh`** : ajouter `mdi.woff2` **et** `icons-data.js` au staging `data/designer/`
  (copie fichier par fichier → sinon 404 on-device).
- La map `ICON_SVG` (SVG faits-main des 23 symboles) est supprimée.
- ⚠️ **Ne pas toucher `designer/js/icons.js`** : ce sont les icônes de **palette** (une par *type*
  de composant), un système distinct du composant `icon`.

## 6. Contrat & compatibilité

- L'enum `$defs/symbolName` est régénéré (~300-500 noms). Les **23 noms actuels restent valides**
  (directement ou via alias). Les layouts existants qui référencent une icône par nom continuent
  de fonctionner à l'identique.
- `designer/tests/registry.test.js` continue de vérifier que les clés du designer == l'enum du
  schéma, désormais contre le set généré.

## 7. Tests

- **Natif** (`env:native`, Unity) : `icon_symbol_index` — un nom connu, un nom inconnu (→ 0), et
  les 23 noms legacy résolvent bien vers un glyphe.
- **Designer** (`node --test`) : la logique **pure** de filtrage du picker (recherche + catégorie)
  extraite et testée ; le DOM du picker est browser-verified (convention
  `designer-tests-dom-builders` : `node --test` ne construit pas de DOM).
- **Cohérence 3-voies** : noms firmware (`icons_gen.h`) == métadonnées designer (`icons-data.js`)
  == enum schéma — garanti par la génération commune, protégé par un test.
- **Browser-verified** : ouverture/filtre du picker ; rendu, recoloration et tailles arbitraires
  d'une icône sur le canvas.
- **On-device** : rendu réel d'icônes MDI à plusieurs tailles + `icon_states`, vérifié par capture
  écran (`GET /screenshot`).

## 8. Budget flash (estimation, à mesurer)

~300-500 glyphes MDI subsettés ≈ **~100-250 Ko** en flash (app slot de 4 Mo → négligeable). Le
`mdi.woff2` designer (compressé) est plus petit et s'ajoute à l'image LittleFS. **À mesurer au
premier build** ; réduire le set si nécessaire.

## 9. Points ouverts (résolus au plan)

- **Composition exacte** du set ~300-500 : quelles catégories MDI retenir (domotique, télémétrie,
  météo, média, statut, flèches, énergie, nature…).
- **Version MDI** à épingler.
- **Table d'alias** précise pour les 23 noms legacy (lesquels diffèrent d'un nom MDI).

## 10. Hors périmètre (YAGNI)

- Ajout d'icônes au runtime (le set est figé dans la police ; enrichir = régénérer + reflasher).
- Icônes multicolores / animées (le rendu reste monochrome recolorable, comme le texte).
- Refonte des icônes de **palette** (`designer/js/icons.js`), non concernées.
