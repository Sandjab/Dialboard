# Icônes Material Design (Tiny TTF) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les 23 symboles LVGL bitmap du composant `icon` par un catalogue Material Design Icons (~300-500) rendu en Tiny TTF, à parité designer↔firmware, avec un picker recherche/catégories.

**Architecture:** Une **source unique** (`tools/icons/*.txt`) alimente un script de génération (`tools/gen_icons.py`) qui produit *tous* les artefacts : police firmware (`font_icons.c`), tables C (`icons_gen.{h,c}`), webfont designer (`mdi.woff2`), métadonnées picker (`icons-data.js`) et l'enum `$defs/symbolName` du schéma. Le firmware rend le glyphe via une police Tiny TTF dédiée (`get_icon_font`) ; le designer via `@font-face`. Les layouts référencent les icônes **par nom** → compat préservée.

**Tech Stack:** Python 3 + fontTools/brotli (maintenance uniquement, comme `gen_fonts.py`) ; C++/Arduino + LVGL 9.5 Tiny TTF ; JavaScript ES modules (designer) ; Unity (tests natifs) ; node --test (tests designer).

---

## Décisions figées (résolution des points ouverts du spec)

- **Source MDI** (jsdelivr, version épinglée `MDI_VERSION`) :
  - meta : `https://cdn.jsdelivr.net/npm/@mdi/svg@<V>/meta.json` (objets `{name, codepoint (hex str), aliases[], tags[]}`)
  - police : `https://cdn.jsdelivr.net/npm/@mdi/font@<V>/fonts/materialdesignicons-webfont.ttf`
  - licence : `https://cdn.jsdelivr.net/npm/@mdi/font@<V>/LICENSE`
  - `MDI_VERSION` se fixe à l'exécution via `npm view @mdi/font version` (Task A1).
- **Composition du set** : `tools/icons/categories.txt` (tags MDI à inclure, un par ligne) + `tools/icons/extra.txt` (noms MDI explicites en plus) + `tools/icons/aliases.txt` (`nom_dialboard=nom_mdi`). Sélection = (icônes portant un tag ∈ categories) ∪ extra ∪ (cibles d'alias), dédupliquées par nom exposé, triées, plafonnées à `MAX_ICONS=500`. **Fail-loud** si un extra/alias est introuvable dans `meta.json`.
- **Alias legacy** (table candidate, `aliases.txt`, validée par fail-loud) :
  `wifi=wifi`, `bluetooth=bluetooth`, `gps=crosshairs-gps`, `usb=usb`, `battery_empty=battery-outline`, `battery_1=battery-20`, `battery_2=battery-50`, `battery_3=battery-80`, `battery_full=battery`, `charge=battery-charging`, `power=power`, `bell=bell`, `warning=alert`, `ok=check`, `close=close`, `play=play`, `pause=pause`, `stop=stop`, `volume_max=volume-high`, `mute=volume-off`, `home=home`, `settings=cog`, `refresh=refresh`. Un alias dont la cible n'existe pas fait échouer la génération → l'ingénieur corrige la cible via https://pictogrammers.com/library/mdi/.

---

## File Structure

**Créés (écrits à la main) :**
- `tools/gen_icons.py` — pipeline de génération (le livrable principal).
- `tools/icons/categories.txt`, `tools/icons/extra.txt`, `tools/icons/aliases.txt` — la source du set.
- `designer/js/icon-filter.js` — logique **pure** de filtrage du picker (testable node).
- `designer/js/icon-picker.js` — overlay DOM du picker (browser-verified).

**Générés (committés, jamais édités à la main) :**
- `src/fonts/font_icons.c`, `src/fonts/icons_gen.h`, `src/fonts/icons_gen.c`, ajout dans `src/fonts/fonts_data.h`.
- `designer/vendor/fonts/mdi.woff2`, `designer/vendor/icons/icons-data.js`.
- `schema/layout.schema.json` (`$defs/symbolName`).
- `tools/fonts/licenses/mdi-LICENSE.txt`.

**Modifiés (à la main) :**
- `src/fonts.h`, `src/fonts.cpp` (`get_icon_font`).
- `src/view.cpp` (`build_icon`/`sync_icon`, tables → header généré).
- `src/dashboard.h`, `src/dashboard.cpp` (uint16_t, tables → header généré).
- `designer/js/render.js` (`buildIcon` via webfont, suppr. `ICON_SVG`).
- `designer/js/inspector.js` (champ symbol + états → picker).
- `designer/js/registry.js` (type d'éditeur du champ symbol).
- `designer/style.css` (`@font-face` mdi).
- `tools/stage_fs.sh` (stager woff2 + icons-data.js).
- `designer/tests/registry.test.js` (parité contre le set généré).

---

## Phase A — Pipeline de génération

### Task A1 : Squelette `gen_icons.py` + fichiers source

**Files:**
- Create: `tools/gen_icons.py`
- Create: `tools/icons/categories.txt`, `tools/icons/extra.txt`, `tools/icons/aliases.txt`

- [ ] **Step 1: Épingler la version MDI**

Run: `npm view @mdi/font version`
Noter la valeur (ex. `7.4.47`) → elle remplira `MDI_VERSION` au Step 3.

- [ ] **Step 2: Créer les fichiers source**

`tools/icons/aliases.txt` (la table de la section « Décisions figées », une par ligne `nom_dialboard=nom_mdi`).

`tools/icons/extra.txt` — vide au départ (une icône explicite par ligne ; à compléter Task A8).

`tools/icons/categories.txt` — candidats de départ (à confirmer via `--list-tags` en Task A8) :
```
Weather
Home Automation
Battery
Nature
Alert / Error / Warning
Audio
Arrow
Navigation
Device / Tech
Transportation
Emoji / Nature
```

- [ ] **Step 3: Écrire le squelette + le mode `--list-tags`**

```python
#!/usr/bin/env python3
"""Génère la police d'icônes de Dialboard (firmware Tiny TTF + parité designer) depuis
Material Design Icons. Outil de MAINTENANCE : sorties committées, build normal sans réseau.
  python3 tools/gen_icons.py            # génère tout
  python3 tools/gen_icons.py --list-tags  # liste les tags MDI disponibles + counts
"""
import io, json, sys, pathlib, urllib.request, collections
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options

MDI_VERSION = "PASTE_FROM_STEP_1"          # ex. "7.4.47"
MAX_ICONS   = 500
ROOT   = pathlib.Path(__file__).resolve().parents[1]
ICONS  = ROOT / "tools" / "icons"
CDN    = f"https://cdn.jsdelivr.net/npm"
META_URL = f"{CDN}/@mdi/svg@{MDI_VERSION}/meta.json"
TTF_URL  = f"{CDN}/@mdi/font@{MDI_VERSION}/fonts/materialdesignicons-webfont.ttf"
LIC_URL  = f"{CDN}/@mdi/font@{MDI_VERSION}/LICENSE"

def fetch(url):
    print(f"  ↓ {url}")
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()

def load_meta():
    return json.loads(fetch(META_URL))     # liste d'objets {name, codepoint, aliases, tags}

def read_lines(path):
    if not path.exists(): return []
    return [l.strip() for l in path.read_text().splitlines()
            if l.strip() and not l.startswith("#")]

def list_tags(meta):
    c = collections.Counter(t for m in meta for t in m.get("tags", []))
    for tag, n in sorted(c.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"{n:5d}  {tag}")

if __name__ == "__main__":
    if "--list-tags" in sys.argv:
        list_tags(load_meta()); sys.exit(0)
    main()
```

- [ ] **Step 4: Vérifier le mode découverte**

Run: `python3 tools/gen_icons.py --list-tags | head -40`
Expected: liste `count  TagName`. Sert à ajuster `categories.txt` en Task A8. (Nécessite réseau + fontTools : `pip install fonttools brotli`.)

- [ ] **Step 5: Commit**

```bash
git add tools/gen_icons.py tools/icons/
git commit -m "feat(icones): squelette gen_icons.py + fichiers source du set"
```

---

### Task A2 : Sélection du set (fonctions pures) + fail-loud

**Files:**
- Modify: `tools/gen_icons.py`

- [ ] **Step 1: Écrire `select_icons`**

Ajouter avant `main` :

```python
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
                "cat": (m["tags"] or ["Other"])[0], "tags": m.get("tags", [])}

    chosen = {}   # nom exposé -> entrée (dédup)
    for m in meta:                                   # par tag
        if cats & set(m.get("tags", [])):
            chosen.setdefault(m["name"], entry(m["name"], m["name"]))
    for name in extra:                               # explicites (fail-loud)
        if name not in by_name: raise SystemExit(f"extra introuvable dans MDI : {name}")
        chosen.setdefault(name, entry(name, name))
    for alias, target in aliases.items():            # legacy (fail-loud)
        if target not in by_name: raise SystemExit(f"alias '{alias}' -> cible MDI introuvable : {target}")
        chosen[alias] = entry(alias, target)         # écrase : le nom exposé est le nom Dialboard

    out = sorted(chosen.values(), key=lambda e: e["name"])
    if len(out) > MAX_ICONS:
        raise SystemExit(f"{len(out)} icônes > MAX_ICONS={MAX_ICONS} : réduire categories.txt")
    return out
```

- [ ] **Step 2: Écrire `main` (sélection + résumé) provisoire**

```python
def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    meta = load_meta()
    icons = select_icons(meta)
    print(f"{len(icons)} icônes sélectionnées "
          f"(dont {len(read_lines(ICONS/'aliases.txt'))} alias legacy).")
```

- [ ] **Step 3: Vérifier la sélection + fail-loud**

Run: `python3 tools/gen_icons.py`
Expected: `N icônes sélectionnées (dont 23 alias legacy).` avec `N` entre ~300 et 500. Si un alias/extra est faux → `SystemExit` explicite (corriger `aliases.txt`/`extra.txt`).

- [ ] **Step 4: Commit**

```bash
git add tools/gen_icons.py
git commit -m "feat(icones): sélection du set (tags + extras + alias, fail-loud)"
```

---

### Task A3 : Émettre `font_icons.c` + `fonts_data.h`

**Files:**
- Modify: `tools/gen_icons.py`
- Generated: `src/fonts/font_icons.c`, `src/fonts/fonts_data.h` (append)

- [ ] **Step 1: Helpers subset + émission (calqués sur gen_fonts.py)**

```python
C_OUT    = ROOT / "src" / "fonts"
WOFF_OUT = ROOT / "designer" / "vendor" / "fonts"
DATA_OUT = ROOT / "designer" / "vendor" / "icons"
LIC_OUT  = ROOT / "tools" / "fonts" / "licenses"

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
    if "font_icons[]" in txt: return
    p.write_text(txt.replace("\n#ifdef __cplusplus\n}\n#endif",
                             "\n" + decl + "\n#ifdef __cplusplus\n}\n#endif"))
```

- [ ] **Step 2: Brancher dans `main`**

Ajouter à la fin de `main` :
```python
    for d in (C_OUT, WOFF_OUT, DATA_OUT, LIC_OUT): d.mkdir(parents=True, exist_ok=True)
    ttf = fetch(TTF_URL)
    codepoints = [e["cp"] for e in icons]
    sub = subset_ttf(ttf, codepoints)
    emit_c(sub); append_fonts_data_h()
    (LIC_OUT / "mdi-LICENSE.txt").write_bytes(fetch(LIC_URL))
    print(f"  font_icons.c : {len(sub)//1024} Ko")
```

- [ ] **Step 3: Générer + vérifier**

Run: `python3 tools/gen_icons.py`
Expected: `font_icons.c : NN Ko` (dizaines à ~250 Ko). `git status` montre `src/fonts/font_icons.c` (nouveau) + `fonts_data.h` modifié (bloc `font_icons`).

- [ ] **Step 4: Commit**

```bash
git add tools/gen_icons.py src/fonts/font_icons.c src/fonts/fonts_data.h
git commit -m "feat(icones): subset TTF MDI -> font_icons.c"
```

---

### Task A4 : Émettre `icons_gen.h` + `icons_gen.c` (tables firmware)

**Files:**
- Modify: `tools/gen_icons.py`
- Generated: `src/fonts/icons_gen.h`, `src/fonts/icons_gen.c`

- [ ] **Step 1: Émission des tables C (noms + glyphes UTF-8)**

```python
def emit_icons_tables(icons):
    names = [e["name"] for e in icons]
    def cstr(s): return '"' + "".join(f"\\x{b:02x}" for b in s.encode("utf-8")) + '"'
    h = ["// Généré par tools/gen_icons.py — ne pas éditer.", "#pragma once", "#include <stdint.h>", "",
         f"static constexpr int ICON_SYMBOL_COUNT = {len(icons)};",
         "extern const char* const ICON_SYMBOL_NAMES[ICON_SYMBOL_COUNT];",
         "extern const char* const ICON_GLYPHS[ICON_SYMBOL_COUNT];", ""]
    (C_OUT / "icons_gen.h").write_text("\n".join(h) + "\n")
    c = ['// Généré par tools/gen_icons.py — ne pas éditer.', '#include "icons_gen.h"', "",
         "const char* const ICON_SYMBOL_NAMES[ICON_SYMBOL_COUNT] = {"]
    c += ["  " + ", ".join(f'"{n}"' for n in names[i:i+8]) + "," for i in range(0, len(names), 8)]
    c += ["};", "", "const char* const ICON_GLYPHS[ICON_SYMBOL_COUNT] = {"]
    c += ["  " + ", ".join(cstr(chr(e["cp"])) for e in icons[i:i+8]) + "," for i in range(0, len(icons), 8)]
    c += ["};"]
    (C_OUT / "icons_gen.c").write_text("\n".join(c) + "\n")
```

Appeler `emit_icons_tables(icons)` dans `main` (après `emit_c`).

- [ ] **Step 2: Générer + vérifier la compilation isolée**

Run: `python3 tools/gen_icons.py && head -6 src/fonts/icons_gen.h`
Expected: `ICON_SYMBOL_COUNT = N`, deux `extern` ; `icons_gen.c` définit deux tableaux de `N` entrées.

- [ ] **Step 3: Commit**

```bash
git add tools/gen_icons.py src/fonts/icons_gen.h src/fonts/icons_gen.c
git commit -m "feat(icones): tables firmware générées (noms + glyphes UTF-8)"
```

---

### Task A5 : Émettre `mdi.woff2` (parité designer)

**Files:**
- Modify: `tools/gen_icons.py`
- Generated: `designer/vendor/fonts/mdi.woff2`

- [ ] **Step 1: Émission woff2 depuis le TTF déjà subsetté**

```python
def emit_woff2(sub_ttf_bytes):
    font = TTFont(io.BytesIO(sub_ttf_bytes)); font.flavor = "woff2"
    font.save(WOFF_OUT / "mdi.woff2")
```
Dans `main`, après `emit_c(sub)` : `emit_woff2(sub)`.

- [ ] **Step 2: Générer + vérifier**

Run: `python3 tools/gen_icons.py && ls -la designer/vendor/fonts/mdi.woff2`
Expected: fichier présent (quelques dizaines de Ko, < le .c).

- [ ] **Step 3: Commit**

```bash
git add tools/gen_icons.py designer/vendor/fonts/mdi.woff2
git commit -m "feat(icones): webfont mdi.woff2 (parité designer)"
```

---

### Task A6 : Émettre `icons-data.js` (métadonnées picker)

**Files:**
- Modify: `tools/gen_icons.py`
- Generated: `designer/vendor/icons/icons-data.js`

- [ ] **Step 1: Émission des métadonnées (nom, char, catégorie, tags)**

```python
def emit_icons_data(icons):
    rows = [{"name": e["name"], "ch": chr(e["cp"]), "cat": e["cat"], "tags": e["tags"]} for e in icons]
    js = ("// Généré par tools/gen_icons.py — ne pas éditer.\n"
          "// {name, ch (glyphe MDI), cat (catégorie), tags[]} ; ch se rend via @font-face 'mdi'.\n"
          "export const ICONS = " + json.dumps(rows, ensure_ascii=False, indent=0) + ";\n")
    (DATA_OUT / "icons-data.js").write_text(js)
```
Appeler `emit_icons_data(icons)` dans `main`.

- [ ] **Step 2: Générer + vérifier l'import ES**

Run: `python3 tools/gen_icons.py && node -e "import('./designer/vendor/icons/icons-data.js').then(m=>console.log(m.ICONS.length, m.ICONS[0]))"`
Expected: `N { name: '...', ch: '...', cat: '...', tags: [...] }`.

- [ ] **Step 3: Commit**

```bash
git add tools/gen_icons.py designer/vendor/icons/icons-data.js
git commit -m "feat(icones): métadonnées picker icons-data.js"
```

---

### Task A7 : Réécrire l'enum `$defs/symbolName`

**Files:**
- Modify: `tools/gen_icons.py`
- Generated: `schema/layout.schema.json` (`$defs/symbolName`)

- [ ] **Step 1: Réécriture ciblée de l'enum (préserve le reste du JSON)**

```python
def rewrite_schema_enum(icons):
    p = ROOT / "schema" / "layout.schema.json"
    doc = json.loads(p.read_text())
    doc["$defs"]["symbolName"]["enum"] = [e["name"] for e in icons]
    doc["$defs"]["symbolName"]["description"] = (
        "Nom de symbole Material Design Icons. Firmware: glyphe Tiny TTF (font_icons) ; "
        "designer: meme glyphe via @font-face 'mdi'. Genere par tools/gen_icons.py.")
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
```
Appeler `rewrite_schema_enum(icons)` dans `main`.

⚠️ Vérifier après coup que le diff ne touche QUE `$defs/symbolName` (indentation `indent=2` conforme au fichier). Si l'indentation diffère, ajuster `indent` pour un diff minimal.

- [ ] **Step 2: Générer + vérifier le diff**

Run: `python3 tools/gen_icons.py && git diff --stat schema/layout.schema.json && python3 -c "import json;json.load(open('schema/layout.schema.json'))"`
Expected: schéma toujours valide JSON ; diff limité à `symbolName`.

- [ ] **Step 3: Commit**

```bash
git add tools/gen_icons.py schema/layout.schema.json
git commit -m "feat(icones): enum symbolName régénéré (validation stricte)"
```

---

### Task A8 : Finaliser la composition + génération complète

**Files:**
- Modify: `tools/icons/categories.txt`, `tools/icons/extra.txt`, `tools/icons/aliases.txt`

- [ ] **Step 1: Ajuster les catégories aux vrais tags MDI**

Run: `python3 tools/gen_icons.py --list-tags`
Remplacer dans `categories.txt` les libellés candidats par les **tags réels** (copiés depuis la sortie), en visant ~300-450 icônes. Ajouter à `extra.txt` toute icône utile isolée (ex. `thermometer`, `water-percent`, `power-plug`).

- [ ] **Step 2: Génération complète + compte final**

Run: `python3 tools/gen_icons.py`
Expected: `N icônes sélectionnées (dont 23 alias legacy).` avec 300 ≤ N ≤ 500 ; toutes les sorties écrites sans erreur.

- [ ] **Step 3: Vérifier la présence des 23 noms legacy**

Run: `node -e "import('./designer/vendor/icons/icons-data.js').then(m=>{const s=new Set(m.ICONS.map(i=>i.name));for(const n of ['wifi','gps','battery_1','volume_max','settings','ok','close','refresh','mute','warning'])if(!s.has(n))throw n+' manquant'})" && echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit (source + toutes les sorties régénérées)**

```bash
git add tools/icons/ src/fonts/font_icons.c src/fonts/icons_gen.h src/fonts/icons_gen.c \
        src/fonts/fonts_data.h designer/vendor/fonts/mdi.woff2 \
        designer/vendor/icons/icons-data.js schema/layout.schema.json tools/fonts/licenses/mdi-LICENSE.txt
git commit -m "feat(icones): set MDI final généré (~N icônes)"
```

---

## Phase B — Firmware

### Task B1 : Basculer les tables + élargir l'index (uint16_t)

**Files:**
- Modify: `src/dashboard.h` (`IconState.symbol`, `Component.icon_symbol`, `ICON_SYMBOL_COUNT`)
- Modify: `src/dashboard.cpp:101-114` (tables locales → `icons_gen.h`, `icon_symbol_index` → uint16_t)
- Test: `test/test_core/test_dashboard.cpp` (ou fichier de tests natifs icon existant)

- [ ] **Step 1: Écrire le test natif d'abord**

Dans le fichier de tests natifs du cœur (`test/test_core/…`, même env que `pio test -e native`), ajouter :
```cpp
void test_icon_symbol_index_legacy(void) {
    // Les 23 noms legacy résolvent vers un index < ICON_SYMBOL_COUNT (pas le fallback 0 par défaut)
    TEST_ASSERT_TRUE(icon_symbol_index("wifi")  < ICON_SYMBOL_COUNT);
    TEST_ASSERT_TRUE(icon_symbol_index("gps")   < ICON_SYMBOL_COUNT);
    TEST_ASSERT_EQUAL(0, icon_symbol_index("zzz_inconnu"));   // miss -> 0
    // "wifi" existe dans le set -> ne DOIT pas être le fallback silencieux si "wifi" != index 0
    TEST_ASSERT_EQUAL_STRING("wifi", ICON_SYMBOL_NAMES[icon_symbol_index("wifi")]);
}
```
Enregistrer le test dans le `RUN_TEST(...)` du fichier. (Si `icon_symbol_index` n'est pas exposé au test natif, l'exposer via le header du cœur, comme les autres helpers testés.)

- [ ] **Step 2: Lancer → échec (compilation : tables absentes / signature)**

Run: `pio test -e native -f test_core`
Expected: FAIL (build : `ICON_SYMBOL_NAMES` non défini, ou `icon_symbol_index` renvoie encore uint8_t).

- [ ] **Step 3: Modifier `dashboard.h`**

- `#include "fonts/icons_gen.h"` en tête (remplace la constante locale `ICON_SYMBOL_COUNT = 23`, désormais fournie par le header généré — supprimer la ligne locale).
- `struct IconState { float at; uint16_t symbol; uint32_t color; bool has_symbol; bool has_color; };`
- `uint16_t icon_symbol;` (au lieu de `uint8_t`).

- [ ] **Step 4: Modifier `dashboard.cpp`**

- Supprimer la table locale `ICON_SYMBOL_NAMES[...]` (lignes ~101-108) et son `static_assert` (le header généré fait foi).
- `static uint16_t icon_symbol_index(const char* s) { if (s) for (int i=0;i<ICON_SYMBOL_COUNT;i++) if(!strcmp(s,ICON_SYMBOL_NAMES[i])) return (uint16_t)i; return 0; }`
- Les affectations `c.icon_symbol = icon_symbol_index(...)` et `is.symbol = icon_symbol_index(...)` compilent tel quel (uint16_t).

- [ ] **Step 5: Lancer → succès**

Run: `pio test -e native -f test_core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard.h src/dashboard.cpp test/test_core/
git commit -m "feat(icones): tables générées + index icône en uint16_t"
```

---

### Task B2 : `get_icon_font(px)` (Tiny TTF sur font_icons)

**Files:**
- Modify: `src/fonts.h`, `src/fonts.cpp`

- [ ] **Step 1: Déclarer dans `fonts.h`**

```cpp
// Fonte Tiny TTF de la police d'icônes MDI (font_icons), à la taille px. Cache partagé
// avec get_font (entrée « famille icônes » réservée). Repli bitmap si échec.
const lv_font_t* get_icon_font(uint16_t px);
```

- [ ] **Step 2: Implémenter dans `fonts.cpp`**

Ajouter `#include "fonts/fonts_data.h"` (déjà présent). Réserver `family == 4` aux icônes dans le cache existant :
```cpp
const lv_font_t* get_icon_font(uint16_t px) {
  if (px < 8) px = 8; if (px > 120) px = 120;
  const uint8_t fam = 4, style = 0;                 // 4 = famille icônes (hors TTF[4][4])
  for (int i = 0; i < s_cache_n; i++)
    if (s_cache[i].fam == fam && s_cache[i].style == style && s_cache[i].px == px)
      return s_cache[i].font;
  if (s_cache_n >= FONT_CACHE_MAX) return fallback(px);
  lv_font_t *f = lv_tiny_ttf_create_data_ex((const void*)font_icons, font_icons_len, px,
                                            LV_FONT_KERNING_NONE, 0);   // 0 = pas de cache glyphe
  if (!f) return fallback(px);
  s_cache[s_cache_n++] = { fam, style, px, f };
  return f;
}
```

- [ ] **Step 3: Compiler le firmware**

Run: `pio run -e esp32s3`
Expected: SUCCESS (link inclut `font_icons` + `icons_gen.c`).

- [ ] **Step 4: Commit**

```bash
git add src/fonts.h src/fonts.cpp
git commit -m "feat(icones): get_icon_font (Tiny TTF sur font_icons)"
```

---

### Task B3 : Rendu de l'icône via `get_icon_font`

**Files:**
- Modify: `src/view.cpp:93-103` (supprimer `ICON_GLYPHS` local), `:577-593` (`build_icon`/`sync_icon`)

- [ ] **Step 1: Remplacer la table locale par le header généré**

- Supprimer `ICON_GLYPHS[ICON_SYMBOL_COUNT]` local (lignes ~95-101) et son `static_assert`.
- Ajouter `#include "fonts/icons_gen.h"` en tête de `view.cpp` (fournit `ICON_GLYPHS` + `ICON_SYMBOL_COUNT`).

- [ ] **Step 2: Basculer `build_icon`/`sync_icon` sur `get_icon_font`**

Dans `build_icon` : `lv_obj_set_style_text_font(l, get_icon_font(c.font), 0);` (au lieu de `pick_font(c.font)`). `lv_label_set_text(l, ICON_GLYPHS[sym]);` inchangé (les valeurs sont désormais les glyphes MDI UTF-8).
Dans `sync_icon` : idem si la fonte y est (re)posée ; sinon seul `lv_label_set_text(w, ICON_GLYPHS[sym])` reste (valeurs générées).

- [ ] **Step 3: Compiler**

Run: `pio run -e esp32s3`
Expected: SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add src/view.cpp
git commit -m "feat(icones): rendu icône via get_icon_font + glyphes MDI"
```

---

## Phase C — Designer

### Task C1 : `buildIcon` via webfont + `@font-face`

**Files:**
- Modify: `designer/js/render.js` (`ICON_SVG` supprimé, `buildIcon` réécrit)
- Modify: `designer/style.css` (`@font-face` mdi)

- [ ] **Step 1: `@font-face` dans `style.css`**

```css
@font-face { font-family: 'mdi'; src: url('vendor/fonts/mdi.woff2') format('woff2'); font-display: block; }
.w-icon i.mdi { font-family: 'mdi'; font-style: normal; line-height: 1; display: inline-block; }
```

- [ ] **Step 2: Réécrire `buildIcon` (webfont) et supprimer `ICON_SVG`**

```js
import { ICONS } from '../vendor/icons/icons-data.js';
export const ICON_CHAR = Object.fromEntries(ICONS.map(i => [i.name, i.ch]));   // nom -> glyphe

export function buildIcon(comp, mock = MOCKS.icon) {
  const { symbol, color } = resolveIcon(comp, mock.value);
  const px = pickFontPx(comp.font ?? 28);
  const n = document.createElement('div');
  n.className = 'w w-icon';
  n.style.width = px + 'px'; n.style.height = px + 'px'; n.style.color = color;
  const i = document.createElement('i');
  i.className = 'mdi';
  i.style.fontSize = px + 'px';
  i.textContent = ICON_CHAR[symbol] || ICON_CHAR.bell || '';
  n.appendChild(i);
  return n;
}
```
Supprimer la constante `ICON_SVG` (lignes ~581-608). `resolveIcon` inchangé.

- [ ] **Step 3: Vérif import (node ne construit pas le DOM, mais l'import doit résoudre)**

Run: `cd designer && node -e "import('./js/render.js').then(m=>console.log(typeof m.buildIcon, Object.keys(m).includes('ICON_SVG')))"`
Expected: `function false` (buildIcon exporté, ICON_SVG retiré).

- [ ] **Step 4: Commit**

```bash
git add designer/js/render.js designer/style.css
git commit -m "feat(icones): buildIcon via webfont MDI (parité)"
```

---

### Task C2 : Logique pure du filtre picker + test node

**Files:**
- Create: `designer/js/icon-filter.js`
- Create: `designer/tests/icon-filter.test.js`

- [ ] **Step 1: Écrire le test d'abord**

`designer/tests/icon-filter.test.js` :
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterIcons, categoriesOf } from '../js/icon-filter.js';

const SET = [
  { name: 'wifi', cat: 'Network', tags: ['wireless', 'internet'] },
  { name: 'home', cat: 'Home Automation', tags: ['house'] },
  { name: 'home-assistant', cat: 'Brand', tags: ['home'] },
];

test('recherche par nom (sous-chaîne)', () => {
  assert.deepEqual(filterIcons(SET, 'home', null).map(i => i.name), ['home', 'home-assistant']);
});
test('recherche par tag', () => {
  assert.deepEqual(filterIcons(SET, 'internet', null).map(i => i.name), ['wifi']);
});
test('filtre par catégorie', () => {
  assert.deepEqual(filterIcons(SET, '', 'Network').map(i => i.name), ['wifi']);
});
test('recherche + catégorie combinées', () => {
  assert.deepEqual(filterIcons(SET, 'house', 'Home Automation').map(i => i.name), ['home']);
});
test('catégories triées uniques', () => {
  assert.deepEqual(categoriesOf(SET), ['Brand', 'Home Automation', 'Network']);
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd designer && node --test tests/icon-filter.test.js`
Expected: FAIL (`icon-filter.js` absent).

- [ ] **Step 3: Implémenter `icon-filter.js`**

```js
// Logique PURE du picker d'icônes (testable node ; le DOM vit dans icon-picker.js).
export function filterIcons(icons, query, category) {
  const q = (query || '').trim().toLowerCase();
  return icons.filter(i => {
    if (category && i.cat !== category) return false;
    if (!q) return true;
    if (i.name.toLowerCase().includes(q)) return true;
    return (i.tags || []).some(t => t.toLowerCase().includes(q));
  });
}
export function categoriesOf(icons) {
  return [...new Set(icons.map(i => i.cat))].sort();
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd designer && node --test tests/icon-filter.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add designer/js/icon-filter.js designer/tests/icon-filter.test.js
git commit -m "feat(icones): logique pure du filtre picker + tests node"
```

---

### Task C3 : Picker DOM + intégration inspecteur

**Files:**
- Create: `designer/js/icon-picker.js`
- Modify: `designer/js/inspector.js` (champ symbol + états → picker ; retirer les usages `ICON_SVG`)
- Modify: `designer/js/registry.js:167` (type d'éditeur `symbol` → `iconpicker`)

- [ ] **Step 1: `icon-picker.js` (overlay grille filtrable)**

Module exportant `openIconPicker({ current, onPick })` : overlay (motif publish/OTA dialogs), champ recherche + `<select>` de catégories (`categoriesOf`), grille de boutons `<i class="mdi">` (glyphe via `ICON_CHAR`), `filterIcons` sur input. Le clic sur une icône appelle `onPick(name)` et ferme. (DOM = browser-verified ; la logique de filtre est déjà testée en C2.)

- [ ] **Step 2: Brancher dans `inspector.js`**

- Remplacer l'import `ICON_SVG` par `import { ICON_CHAR } from './render.js'` et `import { openIconPicker } from './icon-picker.js'`.
- Retirer l'entrée `symbol:` de `SELECTS` (ligne 25 ; plus un select).
- Rendu du champ `symbol` (type `iconpicker`) : un bouton montrant l'icône courante (`<i class="mdi">` + nom) qui ouvre `openIconPicker` ; `onPick` commit la valeur (mêmes closures figées `sel.ref` que les autres commits — cf. invariants inspecteur).
- Table des **états** (ligne ~245-258) : remplacer le `<select>` par le même bouton-picker (option « base » = valeur vide).

- [ ] **Step 3: Type d'éditeur dans `registry.js`**

`compFields` de `icon` : `['symbol', 'field.symbol', 'iconpicker']` (au lieu de `'symbol'`).

- [ ] **Step 4: Vérif import node (pas de DOM, juste résolution)**

Run: `cd designer && node -e "import('./js/inspector.js').then(()=>console.log('import ok')).catch(e=>{throw e})"`
Expected: `import ok` (aucune référence résiduelle à `ICON_SVG`).

- [ ] **Step 5: Commit**

```bash
git add designer/js/icon-picker.js designer/js/inspector.js designer/js/registry.js
git commit -m "feat(icones): picker d'icônes (recherche + catégories) dans l'inspecteur"
```

---

### Task C4 : Parité (test) + staging embarqué

**Files:**
- Modify: `designer/tests/registry.test.js:149-153`
- Modify: `tools/stage_fs.sh`

- [ ] **Step 1: Réécrire le test de parité contre le set généré**

Remplacer le test « enum symbolName == clés de ICON_SVG » par :
```js
test('conformité : enum symbolName du schéma == noms de icons-data.js', async () => {
  const { ICONS } = await import('../vendor/icons/icons-data.js');
  const schemaNames = schema.$defs.symbolName.enum.slice().sort();
  const dataNames = ICONS.map(i => i.name).sort();
  assert.deepEqual(dataNames, schemaNames);
});
```

- [ ] **Step 2: Lancer la suite designer complète**

Run: `cd designer && node --test`
Expected: PASS (parité + filtre picker ; aucune référence morte à `ICON_SVG`).

- [ ] **Step 3: Stager la webfont + les métadonnées**

Dans `tools/stage_fs.sh`, après la copie `vendor` (déjà `cp -R designer/vendor/. data/designer/vendor/`), vérifier que `vendor/fonts/mdi.woff2` et `vendor/icons/icons-data.js` sont bien inclus (le `cp -R vendor/.` les couvre). Si `icons-data.js` est importé via un chemin relatif absolu au device, confirmer que le chemin résout sous `/designer/vendor/icons/`. Aucune ligne à ajouter si `cp -R vendor/.` couvre les deux ; sinon ajouter les `cp` explicites.

- [ ] **Step 4: Vérifier le staging**

Run: `bash tools/stage_fs.sh && ls data/designer/vendor/fonts/mdi.woff2 data/designer/vendor/icons/icons-data.js`
Expected: les deux fichiers présents dans `data/`.

- [ ] **Step 5: Commit**

```bash
git add designer/tests/registry.test.js tools/stage_fs.sh
git commit -m "feat(icones): parité test contre le set généré + staging embarqué"
```

---

## Phase D — Vérification

### Task D1 : Suites automatisées

- [ ] **Step 1: Tests natifs + designer**

Run: `pio test -e native && cd designer && node --test`
Expected: tout PASS.

- [ ] **Step 2: Build firmware final**

Run: `pio run -e esp32s3`
Expected: SUCCESS ; noter la taille flash (delta vs avant = poids de `font_icons`).

### Task D2 : Browser-verified (designer)

Servir le designer en `no-store` (cf. mémoire `designer-verif-navigateur`) et vérifier au navigateur réel (events pointer réels) :
- [ ] Ouvrir le picker depuis le champ `symbol` d'un composant `icon` : grille rendue, glyphes MDI visibles.
- [ ] Recherche (nom + tag) et filtre catégorie réduisent la grille (`filterIcons`).
- [ ] Choisir une icône met à jour le canvas ; recoloration (champ `color`) et tailles (14/28/64) rendent net.
- [ ] États : ajouter une bande de seuil avec une icône différente ; l'aperçu bascule selon la valeur mock.
- [ ] Un layout existant utilisant `symbol:"wifi"`/`"gps"` s'ouvre sans erreur (compat legacy).

### Task D3 : On-device

Cf. mémoires `verif-on-device-screenshots` et `uploadfs-efface-assets-device` (sauvegarder les assets device avant `uploadfs`).
- [ ] `bash tools/stage_fs.sh && pio run -e esp32s3 -t upload -t uploadfs`
- [ ] Pousser un layout avec plusieurs icônes MDI à tailles variées + une icône à états ; `GET /screenshot` → PNG.
- [ ] Vérifier le rendu net à petite et grande taille + le changement d'état par la valeur.

---

## Self-Review (rempli à la rédaction)

- **Couverture spec** : pipeline (§3) → A1-A8 ; firmware get_icon_font/view/uint16 (§4) → B1-B3 ; designer webfont+picker+stage (§5) → C1-C4 ; contrat/enum (§6) → A7+C4 ; tests (§7) → B1, C2, C4, D ; budget flash (§8, à mesurer) → A3+D1. Points ouverts (§9) → « Décisions figées » + A1/A8.
- **Placeholders** : `MDI_VERSION` = valeur réelle obtenue au Step A1 (commande fournie), pas un TBD ; `categories.txt` candidat confirmé en A8 via `--list-tags` (commande fournie).
- **Cohérence des noms** : `ICON_SYMBOL_NAMES`/`ICON_GLYPHS`/`ICON_SYMBOL_COUNT` (icons_gen), `ICON_CHAR` (render.js), `filterIcons`/`categoriesOf` (icon-filter), `openIconPicker` (icon-picker), `get_icon_font` (fonts) — utilisés de façon identique partout.
