#!/usr/bin/env bash
# Stage le designer + le schema dans data/ pour l'image LittleFS, afin que le device
# serve l'éditeur à http://<ip>/designer/ (même origin, plus de serveur local ni CORS).
#
# À lancer AVANT `pio run -e esp32s3 -t uploadfs` (ou `./build.sh guition_knob Dialboard --uploadfs`)
# chaque fois que le designer change. `data/designer` et `data/schema` sont des artefacts
# régénérables (gitignorés) ; `data/layout.json` (layout par défaut) est conservé.
#
# Note serveStatic : pour une URL de répertoire, le WebServer cherche `index.htm` (pas `.html`)
# → on copie `index.html` sous le nom `index.htm`.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> Dialboard/

rm -rf data/designer data/schema
mkdir -p data/designer/js data/designer/vendor data/designer/i18n data/schema

cp designer/index.html        data/designer/index.htm
cp designer/style.css         data/designer/
cp designer/js/*.js           data/designer/js/
cp -R designer/vendor/.        data/designer/vendor/
cp -R designer/i18n/.         data/designer/i18n/
cp schema/layout.schema.json  data/schema/

echo "Staged → data/designer (index.htm + js + vendor + style.css), data/schema"
du -sh data/designer data/schema
