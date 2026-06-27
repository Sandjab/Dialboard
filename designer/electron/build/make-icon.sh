#!/usr/bin/env bash
# Génère icon.icns depuis icon.svg (anneau de la marque). One-shot : relancer si l'icône change.
# Outils : cairosvg (rasterise le SVG en PNG 1024), sips + iconutil (natifs macOS) pour le .icns.
# Sa sortie (icon.icns) est COMMITTÉE → le packaging ne dépend pas de cet outillage au build.
set -euo pipefail
cd "$(dirname "$0")"

SRC=icon.svg
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1) SVG -> PNG maître 1024x1024 (transparence préservée).
if command -v cairosvg >/dev/null 2>&1; then
  cairosvg "$SRC" -W 1024 -H 1024 -o "$WORK/icon_1024.png"
elif command -v magick >/dev/null 2>&1; then
  magick -background none "$SRC" -resize 1024x1024 "$WORK/icon_1024.png"
else
  echo "Aucun rasteriseur SVG (cairosvg ou magick) trouvé." >&2
  exit 1
fi

# 2) PNG maître -> .iconset aux tailles attendues par iconutil (16..512 + @2x).
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
for sz in 16 32 64 128 256 512; do
  sips -z "$sz" "$sz"           "$WORK/icon_1024.png" --out "$ICONSET/icon_${sz}x${sz}.png"     >/dev/null
  d=$((sz * 2))
  sips -z "$d"  "$d"            "$WORK/icon_1024.png" --out "$ICONSET/icon_${sz}x${sz}@2x.png"  >/dev/null
done

# 3) .iconset -> .icns
iconutil -c icns "$ICONSET" -o icon.icns
echo "Écrit : $(pwd)/icon.icns"
