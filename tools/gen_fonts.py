#!/usr/bin/env python3
"""Génère les fontes de Dialboard (firmware Tiny TTF + parité designer).

google/fonts ne distribue plus de cuts statiques : on télécharge les fontes VARIABLES
(roman + italique) des 4 familles, on les INSTANCIE en 16 cuts statiques
(Regular/Bold/Italic/BoldItalic = wght 400/700 × roman/italique), on subsette au Latin,
puis on émet :
  - src/fonts/font_<famille>_<style>.c (+ src/fonts/fonts_data.h)  → tableaux C, firmware Tiny TTF
  - designer/vendor/fonts/<famille>-<style>.woff2                  → web-fonts designer (parité)

Outil de MAINTENANCE. Les .c et .woff2 produits sont COMMITTÉS : le build normal n'exige
ni réseau ni fonttools. Dépendances : fonttools + brotli.

  python3 tools/gen_fonts.py
"""
import io, pathlib, urllib.request
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.subset import Subsetter, Options

ROOT     = pathlib.Path(__file__).resolve().parents[1]
C_OUT    = ROOT / "src" / "fonts"
WOFF_OUT = ROOT / "designer" / "vendor" / "fonts"
LIC_OUT  = ROOT / "tools" / "fonts" / "licenses"
BASE     = "https://raw.githubusercontent.com/google/fonts/main/ofl"

# Latin de base (ASCII imprimable) + Latin-1 (assez pour l'ASCII imposé par le schéma).
UNICODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100))

# famille → (chemin roman variable, chemin italique variable, axes fixes à épingler, dossier ofl)
FAMILIES = {
    "montserrat":     ("Montserrat[wght].ttf",       "Montserrat-Italic[wght].ttf",       {}, "montserrat"),
    "jetbrains_mono": ("JetBrainsMono[wght].ttf",     "JetBrainsMono-Italic[wght].ttf",    {}, "jetbrainsmono"),
    "lora":           ("Lora[wght].ttf",              "Lora-Italic[wght].ttf",             {}, "lora"),
    "inter":          ("Inter[opsz,wght].ttf",        "Inter-Italic[opsz,wght].ttf",       {"opsz": 14}, "inter"),
}
# style → (source roman|italic, poids wght)
STYLES = [
    ("regular",    "roman",  400),
    ("bold",       "roman",  700),
    ("italic",     "italic", 400),
    ("bolditalic", "italic", 700),
]

def fetch(path):
    url = f"{BASE}/{path}"
    print(f"  ↓ {url}")
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()

def subset_latin(font):
    opt = Options()
    opt.layout_features = ["kern", "liga", "calt"]   # garde l'essentiel
    opt.glyph_names = False
    opt.recalc_bounds = True
    opt.notdef_outline = True
    ss = Subsetter(options=opt)
    ss.populate(unicodes=UNICODES)
    ss.subset(font)

def instance_bytes(src_bytes, wght, fixed):
    """Charge la variable depuis des octets, épingle wght (+ axes fixes), subsette Latin,
    renvoie les octets TTF statiques."""
    font = TTFont(io.BytesIO(src_bytes))
    instantiateVariableFont(font, {"wght": wght, **fixed}, inplace=True)
    subset_latin(font)
    out = io.BytesIO()
    font.flavor = None
    font.save(out)
    return out.getvalue()

def to_woff2(ttf_bytes, path):
    font = TTFont(io.BytesIO(ttf_bytes))
    font.flavor = "woff2"
    font.save(path)

def emit_c(ttf_bytes, fam, style):
    name = f"font_{fam}_{style}"
    body = [f"// Généré par tools/gen_fonts.py — ne pas éditer.",
            "#include <stddef.h>",
            f"const unsigned char {name}[] = {{"]
    for i in range(0, len(ttf_bytes), 16):
        body.append("  " + ",".join(str(b) for b in ttf_bytes[i:i+16]) + ",")
    body.append("};")
    body.append(f"const unsigned int {name}_len = {len(ttf_bytes)};")
    (C_OUT / f"{name}.c").write_text("\n".join(body) + "\n")
    return name, len(ttf_bytes)

def main():
    for d in (C_OUT, WOFF_OUT, LIC_OUT):
        d.mkdir(parents=True, exist_ok=True)
    decls, total = [], 0
    for fam, (roman_p, italic_p, fixed, ofl) in FAMILIES.items():
        print(f"[{fam}]")
        srcs = {"roman": fetch(f"{ofl}/{roman_p}"), "italic": fetch(f"{ofl}/{italic_p}")}
        try:
            (LIC_OUT / f"{fam}-OFL.txt").write_bytes(fetch(f"{ofl}/OFL.txt"))
        except Exception as e:
            print(f"  ! OFL.txt indisponible ({e})")
        for style, src, wght in STYLES:
            ttf = instance_bytes(srcs[src], wght, fixed)
            name, n = emit_c(ttf, fam, style)
            to_woff2(ttf, WOFF_OUT / f"{fam.replace('_', '-')}-{style}.woff2")
            total += n
            decls.append(f"extern const unsigned char {name}[];\nextern const unsigned int {name}_len;")
            print(f"    {style:11s} {n//1024:4d} Ko")
    header = ["// Généré par tools/gen_fonts.py — ne pas éditer.", "#pragma once", "#include <stddef.h>", "",
              "#ifdef __cplusplus", 'extern "C" {', "#endif", ""]
    footer = ["", "#ifdef __cplusplus", "}", "#endif"]
    (C_OUT / "fonts_data.h").write_text("\n".join(header + decls + footer) + "\n")
    print(f"OK : 16 cuts, {total//1024} Ko de TTF en flash → {C_OUT}/ ; woff2 → {WOFF_OUT}/")

if __name__ == "__main__":
    main()
