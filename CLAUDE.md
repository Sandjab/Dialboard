# Dialboard

Conçois des dashboards dans ton navigateur et pousse-les sur un écran tactile **rond** à ~15 € (Guition JC3636K718, ESP32-S3, 360×360). Dashboard **config-driven** : un layout JSON décrit pages + composants ; un **designer WYSIWYG** (web, embarqué dans le device en LittleFS) édite ce layout sans recompiler ; les valeurs sont **poussées depuis n'importe quelle source HTTP** (`POST /update`).

> **Reprise de travail** : lire d'abord `docs/_internal/HANDOFF.md` (état courant, prochaines étapes, accès device). Dossier `docs/_internal/` gitignoré.

## Structure

```
src/                firmware (C++/Arduino, LVGL 8.4) : dashboard, view, api, net_pull, persist, nav…
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

Le projet est en **LVGL 8.4** (aligné sur le code démo vendeur). Une **migration vers LVGL 9** est le prochain chantier (elle débloque notamment `lv_arclabel` et `lv_scale`) — détails et audit des ruptures dans `docs/_internal/HANDOFF.md`. Docs LVGL via Context7 : `/websites/lvgl_io_8_4` (8.4) ou `/websites/lvgl_io_open` (9.x).

## Choix délibérés (ne PAS « corriger »)

- `sound` : timeout 0 = pas de coupure auto (voulu).
- Swipes **verticaux** réservés (navigation horizontale entre pages).
- Designer : un **toast** = verdict d'une action ; `#status` = progression. Le renommage d'onglet **bloque** les doublons de nom de page (voulu).

## Push

Préparer les commits en local. Le push vers GitHub n'a lieu **que sur demande explicite** de l'utilisateur (p. ex. « push ») — jamais spontanément. Sur une telle demande, lancer `git push` est autorisé.
