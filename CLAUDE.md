# Dialboard

Conçois des dashboards dans ton navigateur et pousse-les sur un écran tactile **rond** à quelques dizaines d'euros (Guition JC3636K718, ESP32-S3, 360×360). Dashboard **config-driven** : un layout JSON décrit pages + composants ; un **designer WYSIWYG** (web, embarqué dans le device en LittleFS) édite ce layout sans recompiler ; les valeurs sont **poussées depuis n'importe quelle source HTTP** (`POST /update`).

> **Reprise de travail** : lire d'abord `docs/_internal/HANDOFF.md` (état courant, prochaines étapes, accès device). Dossier `docs/_internal/` gitignoré.

## Structure

```
src/                firmware (C++/Arduino, LVGL 9.5) : dashboard, view, api, net_pull, persist, nav…
lib/
  board_k718/       HAL de la carte (pins, display ST77916, init LVGL, encodeur, anneau RGB) — headers/symboles k718_*
  qspi_panel/       driver panneau QSPI (esp_lcd_sh8601)
  esp_lcd_touch*/   driver tactile CST816 vendorisé (absent du registre PlatformIO)
designer/           éditeur WYSIWYG (JS modules + tests node)
schema/             layout.schema.json (validé côté designer ET firmware)
data/               image LittleFS : layout.json (committé) + designer/+schema/ stagés (gitignorés)
test/               tests natifs du cœur logique (Unity, env:native)
tools/              stage_fs.sh (stage data/), push.py
docs/               manuel HTML (index.html) ; docs/_internal/ = notes de dev (gitignored)
```

## Build / test / flash

```bash
pio run -e esp32s3                 # build firmware
pio test -e native                 # tests du cœur logique (sans HW/LVGL)
cd designer && node --test         # tests du designer (invocation SANS argument)
bash tools/stage_fs.sh             # stage designer/+schema/ -> data/ avant uploadfs
pio run -e esp32s3 -t upload       # flash firmware (port USB auto, pas de device-check)
pio run -e esp32s3 -t uploadfs     # flash l'image LittleFS (designer embarqué + schema + layout)
```

## Conventions

- **App vs board** : l'identité applicative est **Dialboard** ; la couche carte garde une identité **board-spécifique** (`board_k718`, symboles `k718_*`) pour soutenir le portage futur vers d'autres écrans ronds. Ne pas renommer le HAL en « dialboard_* ».
- **Le code démo vendeur fait foi pour les GPIO / séquences d'init** (cf. K718).
- **Designer ↔ firmware** : parité de rendu attendue ; le schéma JSON est la source commune. Les limites firmware (max pages/placements, tailles d'assets) sont gardées côté designer.
- `serveStatic` cherche `index.htm` (pas `.html`) pour le designer embarqué.

## LVGL

Le projet est en **LVGL 9.5** (épinglé dans `platformio.ini`). La migration depuis la 8.4 du code démo vendeur est **faite** : le code utilise `lv_scale` (remplace `lv_meter`), `lv_arclabel`, `lv_image_*` et les gradients `lv_grad_*`. Docs LVGL via Context7 : `/websites/lvgl_io_open` (9.x) — `/websites/lvgl_io_open_8_4` pour l'historique 8.4.

### Fontes (Tiny TTF)

Le **texte** des composants (label, readout, centre d'anneau, légende courbe d'anneau, label de barre) est rendu par **Tiny TTF** (`LV_USE_TINY_TTF`) : `get_font(famille, px, gras, italique)` (`src/fonts.{h,cpp}`) crée/cache une `lv_font_t*` par combinaison via `lv_tiny_ttf_create_data`, à n'importe quelle taille. 4 familles (Montserrat, JetBrains Mono, Lora, Inter) × 4 styles, embarquées en tableaux C dans `src/fonts/*.c`.

**Les Montserrat bitmap (`LV_FONT_MONTSERRAT_*`) restent** : `pick_font()` les sert pour les **glyphes de symbole** (icône), qui n'existent pas dans les TTF réels. Donc deux Montserrat coexistent : bitmap (symboles) et TTF (texte).

Génération (maintenance) : `python3 tools/gen_fonts.py` télécharge les fontes variables google/fonts, les instancie en 16 cuts (wght 400/700 × roman/italique), subset Latin, et émet `src/fonts/*.c` (firmware) **et** `designer/vendor/fonts/*.woff2` (parité designer). Dépend de `fonttools`+`brotli` **uniquement pour régénérer** ; les `.c`/woff2 produits sont committés. Le designer rend en parité via les `@font-face` correspondants (`render.js::font()`).

## Choix délibérés (ne PAS « corriger »)

- `sound` : timeout 0 = pas de coupure auto (voulu).
- Swipes **verticaux** réservés (navigation horizontale entre pages).
- Designer : un **toast** = verdict d'une action ; `#status` = progression. Le renommage d'onglet **bloque** les doublons de nom de page (voulu).

## Designer — invariants inspecteur/canvas (ne pas régresser)

Vérifiés au navigateur (détails : `docs/_internal/designer-qa-report.md`). Faciles à casser involontairement.

- **Commit sur `change`, pas par frappe.** Couleur : aperçu live sur `input` (canvas seul, hors modèle/undo), commit sur `change` ; champ vidé → la clé est **supprimée** (retour au défaut), jamais `''`.
- **Les closures de commit figent `sel.ref` au rendu.** Le `change` du color picker natif est **asynchrone** (il part après un clic ailleurs, quand `sel` a déjà bougé) ; sans figer, la valeur se committe sur le mauvais composant.
- **Changement de sélection : `inspector.select` fait `blur()` du champ focalisé AVANT de changer `sel`.** Sinon le garde-focus de `render()` + le `preventDefault` du canvas laissent l'inspecteur figé sur l'ancien composant (et les éditions partent au mauvais endroit). `canvas.onPointerDown` reprend le nœud vivant après (un commit en attente peut re-render).
- **Champs numériques : commits coalescés par session** (`model.commit(_, {coalesce})` + `breakCoalesce()` au blur) → flèches/spinner = une seule entrée d'undo.
- **Anneau : `pointer-events` limité aux parties peintes.** Le `<svg>` capterait sinon tout le disque → un clic au centre vide ne désélectionnerait pas.

## Push

Préparer les commits en local. Le push vers GitHub n'a lieu **que sur demande explicite** de l'utilisateur (p. ex. « push ») — jamais spontanément. Sur une telle demande, lancer `git push` est autorisé.
