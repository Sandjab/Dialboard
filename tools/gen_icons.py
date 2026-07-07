#!/usr/bin/env python3
"""Génère la police d'icônes de Dialboard (firmware Tiny TTF + parité designer) depuis
Material Design Icons. Outil de MAINTENANCE : sorties committées, build normal sans réseau.
  python3 tools/gen_icons.py              # génère tout
  python3 tools/gen_icons.py --list-tags  # liste les tags MDI disponibles + counts
"""
import io, json, re, sys, pathlib, urllib.request, collections
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options

MDI_VERSION = "7.4.47"
MAX_ICONS   = 500
ROOT   = pathlib.Path(__file__).resolve().parents[1]
ICONS  = ROOT / "tools" / "icons"
CDN    = "https://cdn.jsdelivr.net/npm"
META_URL = f"{CDN}/@mdi/svg@{MDI_VERSION}/meta.json"
TTF_URL  = f"{CDN}/@mdi/font@{MDI_VERSION}/fonts/materialdesignicons-webfont.ttf"
LIC_URL  = f"{CDN}/@mdi/font@{MDI_VERSION}/LICENSE"

C_OUT    = ROOT / "src" / "fonts"
WOFF_OUT = ROOT / "designer" / "vendor" / "fonts"
DATA_OUT = ROOT / "designer" / "vendor" / "icons"
LIC_OUT  = ROOT / "tools" / "fonts" / "licenses"


def fetch(url):
    print(f"  ↓ {url}")
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def load_meta():
    return json.loads(fetch(META_URL))     # liste d'objets {name, codepoint, aliases, tags}


def read_lines(path):
    if not path.exists():
        return []
    return [l.strip() for l in path.read_text().splitlines()
            if l.strip() and not l.startswith("#")]


def list_tags(meta):
    c = collections.Counter(t for m in meta for t in m.get("tags", []))
    for tag, n in sorted(c.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"{n:5d}  {tag}")


def select_icons(meta):
    """Renvoie une liste ordonnée d'entrées exposées {name, cp, cat, tags}.
    cp = codepoint int ; name = nom EXPOSÉ (nom Dialboard pour un alias)."""
    by_name = {m["name"]: m for m in meta}
    cats  = set(read_lines(ICONS / "categories.txt"))
    extra = read_lines(ICONS / "extra.txt")
    aliases = dict(l.split("=", 1) for l in read_lines(ICONS / "aliases.txt"))

    def entry(exposed_name, mdi):
        m = by_name[mdi]
        return {"name": exposed_name, "cp": int(m["codepoint"], 16),
                "cat": (m.get("tags") or ["Other"])[0], "tags": m.get("tags", [])}

    chosen = {}   # nom exposé -> entrée (dédup)
    for m in meta:                                   # par tag
        if cats & set(m.get("tags", [])):
            chosen.setdefault(m["name"], entry(m["name"], m["name"]))
    for name in extra:                               # explicites (fail-loud)
        if name not in by_name:
            raise SystemExit(f"extra introuvable dans MDI : {name}")
        chosen.setdefault(name, entry(name, name))
    for alias, target in aliases.items():            # legacy (fail-loud)
        if target not in by_name:
            raise SystemExit(f"alias '{alias}' -> cible MDI introuvable : {target}")
        chosen[alias] = entry(alias, target)         # écrase : le nom exposé est le nom Dialboard

    out = sorted(chosen.values(), key=lambda e: e["name"])
    if len(out) > MAX_ICONS:
        raise SystemExit(f"{len(out)} icônes > MAX_ICONS={MAX_ICONS} : réduire categories.txt")
    return out


def subset_ttf(ttf_bytes, codepoints):
    font = TTFont(io.BytesIO(ttf_bytes))
    opt = Options(); opt.glyph_names = False; opt.notdef_outline = True
    opt.layout_features = []                 # icônes : aucune feature OT nécessaire
    ss = Subsetter(options=opt); ss.populate(unicodes=codepoints); ss.subset(font)
    out = io.BytesIO(); font.flavor = None; font.save(out)
    return out.getvalue()


def emit_c(ttf_bytes):
    body = ["// Généré par tools/gen_icons.py — ne pas éditer.", "#include <stddef.h>",
            "const unsigned char font_icons[] = {"]
    for i in range(0, len(ttf_bytes), 16):
        body.append("  " + ",".join(str(b) for b in ttf_bytes[i:i+16]) + ",")
    body += ["};", f"const unsigned int font_icons_len = {len(ttf_bytes)};"]
    (C_OUT / "font_icons.c").write_text("\n".join(body) + "\n")


def append_fonts_data_h():
    """Ajoute la déclaration de font_icons à fonts_data.h (avant le footer extern C)."""
    p = C_OUT / "fonts_data.h"; txt = p.read_text()
    decl = "extern const unsigned char font_icons[];\nextern const unsigned int font_icons_len;\n"
    if "font_icons[]" in txt:
        return
    p.write_text(txt.replace("\n#ifdef __cplusplus\n}\n#endif",
                             "\n" + decl + "\n#ifdef __cplusplus\n}\n#endif"))


def emit_icons_tables(icons):
    names = [e["name"] for e in icons]
    def cstr(s): return '"' + "".join(f"\\x{b:02x}" for b in s.encode("utf-8")) + '"'
    # Header C-safe (icons_gen.c est compilé comme C) : #define + garde extern "C",
    # sur le modèle de fonts_data.h. Inclus côté firmware/tests en C++ (link C).
    h = ["// Généré par tools/gen_icons.py — ne pas éditer.", "#pragma once", "",
         f"#define ICON_SYMBOL_COUNT {len(icons)}", "",
         "#ifdef __cplusplus", 'extern "C" {', "#endif", "",
         "extern const char* const ICON_SYMBOL_NAMES[ICON_SYMBOL_COUNT];",
         "extern const char* const ICON_GLYPHS[ICON_SYMBOL_COUNT];", "",
         "#ifdef __cplusplus", "}", "#endif", ""]
    (C_OUT / "icons_gen.h").write_text("\n".join(h) + "\n")
    c = ['// Généré par tools/gen_icons.py — ne pas éditer.', '#include "icons_gen.h"', "",
         "const char* const ICON_SYMBOL_NAMES[ICON_SYMBOL_COUNT] = {"]
    c += ["  " + ", ".join(f'"{n}"' for n in names[i:i+8]) + "," for i in range(0, len(names), 8)]
    c += ["};", "", "const char* const ICON_GLYPHS[ICON_SYMBOL_COUNT] = {"]
    c += ["  " + ", ".join(cstr(chr(e["cp"])) for e in icons[i:i+8]) + "," for i in range(0, len(icons), 8)]
    c += ["};"]
    (C_OUT / "icons_gen.c").write_text("\n".join(c) + "\n")


def emit_woff2(sub_ttf_bytes):
    font = TTFont(io.BytesIO(sub_ttf_bytes)); font.flavor = "woff2"
    font.save(WOFF_OUT / "mdi.woff2")


def emit_icons_data(icons):
    rows = [{"name": e["name"], "ch": chr(e["cp"]), "cat": e["cat"], "tags": e["tags"]} for e in icons]
    js = ("// Généré par tools/gen_icons.py — ne pas éditer.\n"
          "// {name, ch (glyphe MDI), cat (catégorie), tags[]} ; ch se rend via @font-face 'mdi'.\n"
          "export const ICONS = " + json.dumps(rows, ensure_ascii=False, indent=0) + ";\n")
    (DATA_OUT / "icons-data.js").write_text(js)


def rewrite_schema_enum(icons):
    """Remplace UNIQUEMENT le bloc $defs/symbolName (enum + description), en préservant
    le formatage compact du reste du schéma (diff minimal). Le style multi-ligne (enum à
    6 espaces, items à 8) suit les enums longs existants (`anchor`, `anchorOut`)."""
    p = ROOT / "schema" / "layout.schema.json"
    txt = p.read_text()
    desc = ("Nom de symbole Material Design Icons. Firmware: glyphe Tiny TTF (font_icons) ; "
            "designer: meme glyphe via @font-face 'mdi'. Genere par tools/gen_icons.py.")
    enum_body = ",\n".join(f'        "{e["name"]}"' for e in icons)
    block = ('    "symbolName": {\n'
             '      "enum": [\n'
             f'{enum_body}\n'
             '      ],\n'
             f'      "description": {json.dumps(desc, ensure_ascii=False)}\n'
             '    }')
    new_txt, n = re.subn(r'    "symbolName": \{.*?\n    \}', lambda _: block, txt, flags=re.DOTALL)
    if n != 1:
        raise SystemExit(f"rewrite_schema_enum: {n} bloc(s) symbolName trouvé(s) (attendu 1)")
    json.loads(new_txt)                     # garde-fou : le fichier reste un JSON valide
    p.write_text(new_txt)


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    for d in (C_OUT, WOFF_OUT, DATA_OUT, LIC_OUT):
        d.mkdir(parents=True, exist_ok=True)
    meta = load_meta()
    icons = select_icons(meta)
    print(f"{len(icons)} icônes sélectionnées "
          f"(dont {len(read_lines(ICONS/'aliases.txt'))} alias legacy).")
    ttf = fetch(TTF_URL)
    codepoints = [e["cp"] for e in icons]
    sub = subset_ttf(ttf, codepoints)
    emit_c(sub); append_fonts_data_h(); emit_woff2(sub)
    emit_icons_tables(icons)
    emit_icons_data(icons)
    rewrite_schema_enum(icons)
    (LIC_OUT / "mdi-LICENSE.txt").write_bytes(fetch(LIC_URL))
    print(f"  font_icons.c : {len(sub)//1024} Ko")


if __name__ == "__main__":
    if "--list-tags" in sys.argv:
        list_tags(load_meta()); sys.exit(0)
    main()
