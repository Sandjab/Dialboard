# Design — Suppression du zoom · Thèmes designer · Fontes configurables

> Branche : `feat/fonts-themes-no-zoom` (worktree dédié, basé sur `main` = `4cae4c1`).
> Date : 2026-06-27.

## Objectif

Trois évolutions indépendantes, livrées sur une même branche :

1. **Supprimer le zoom** d'affichage du canvas (designer-only).
2. **Ajouter un choix de thème** dans les Réglages du designer : ambre (actuel) + vert, bleu, violet, rouge, jaune. Habillage de l'UI designer uniquement (variables CSS d'accent), zéro impact firmware/layout.
3. **Fontes configurables** partout où une taille de police est définissable, en plus de la taille : **choix de la famille**, cases **Gras** et **Italique**, et **tailles additionnelles** — avec **parité de rendu designer ↔ firmware** (invariant CLAUDE.md).

## Décisions actées (avec l'utilisateur)

- Thèmes = **chrome du designer seul** (pas le rendu poussé au device). Le lockup de marque **suit le thème**.
- Fontes firmware = moteur **Tiny TTF** (`LV_USE_TINY_TTF`), **16 vrais cuts** TTF (4 familles × Regular/Bold/Italic/BoldItalic) Latin-subset, embarqués en **tableaux C flash**, rendus à n'importe quelle taille au runtime. Dual-OTA conservé (pas de repartition), **aucune dépendance externe**.
- Familles : **Montserrat** (défaut), **JetBrains Mono**, **Lora**, **Inter**.
- Tailles proposées dans l'inspecteur : **12, 14, 20, 24, 28, 36, 48, 64, 72** (le firmware rend en réalité n'importe quelle taille entière).
- Famille/Gras/Italique appliqués aux composants **textuels** : `label`, `readout`, label de `bar`, centre de `ring`. **`icon` reste taille seule** (c'est un glyphe de symbole rendu par la police de symboles Montserrat bitmap).
- Nom de branche `feat/fonts-themes-no-zoom`.

## Non-objectifs (YAGNI)

- Pas de thème poussé au device / dans le layout.
- Pas de famille/gras/italique sur l'icône.
- Pas de support des accents/non-ASCII (la contrainte ASCII du schéma reste ; Tiny TTF le permettrait techniquement — noté comme évolution future, hors scope).
- Pas de migration des labels internes fixes (pill, cap d'anneau) vers Tiny TTF : ils restent en Montserrat bitmap.

---

## Feature 1 — Suppression du zoom (designer-only)

Le zoom est un sélecteur d'affichage du canvas (`1` / `1.5` / `2`), persisté en `localStorage` (`rt-designer-zoom`). `canvas.js::zoomScale()` **n'est pas** le zoom utilisateur : il mesure l'échelle réelle de rendu (fit-colonne) et reste **nécessaire** au DnD — il est conservé.

Changements :

- `designer/index.html` : retirer le bloc `<label class="sb-zoom"><select id="zoom">…</label>` et le commentaire associé.
- `designer/js/app.js` : retirer `ZOOM_KEY`, `ZOOM_ALLOWED`, `userZoom`, la lecture localStorage, `zoomSel`, `zoomSel.onchange`. `applyScale()` n'utilise plus que `fit` (`const s = Math.max(0.2, fit);`).
- `designer/js/canvas.js` : `zoomScale()` **inchangé** ; maj des commentaires qui parlent de « zoom » s'ils deviennent trompeurs.
- `designer/js/statusbar.js` : maj du commentaire mentionnant le `<select id="zoom">`.
- `designer/style.css` : retirer la règle `.sb-zoom` si présente.

Vérification : le canvas s'ajuste toujours à la colonne ; DnD/placement corrects ; plus de sélecteur de zoom.

---

## Feature 2 — Thèmes de l'UI designer (CSS only)

L'« ambre » est l'accent du chrome (`--accent`, `--accent-strong`, `--accent-hover`, `--accent-dim`, `--accent-soft` dans `designer/style.css`).

Changements :

- `designer/js/settings.js` :
  - `defaultSettings()` : ajouter `theme: 'amber'`.
  - `normalizeSettings()` : valider `theme` contre `THEMES = ['amber','green','blue','violet','red','yellow']` (sinon `'amber'`).
  - `applyVisualSettings()` : `document.documentElement.dataset.theme = s.theme;` (ou retirer l'attribut pour `amber`).
  - DOM du tiroir : une ligne « Thème » avec un `<select>` des 6 thèmes (commit sur `change`, cf. invariant input/change du projet).
- `designer/style.css` : un bloc par thème non-défaut :
  ```css
  :root[data-theme="green"]  { --accent:#22C55E; --accent-strong:#22C55E; --accent-hover:#4ADE80; --accent-dim:rgba(34,197,94,.10);  --accent-soft:rgba(34,197,94,.18); }
  :root[data-theme="blue"]   { --accent:#3B82F6; --accent-strong:#3B82F6; --accent-hover:#60A5FA; --accent-dim:rgba(59,130,246,.10); --accent-soft:rgba(59,130,246,.18); }
  :root[data-theme="violet"] { --accent:#8B5CF6; --accent-strong:#8B5CF6; --accent-hover:#A78BFA; --accent-dim:rgba(139,92,246,.10); --accent-soft:rgba(139,92,246,.18); }
  :root[data-theme="red"]    { --accent:#EF4444; --accent-strong:#EF4444; --accent-hover:#F87171; --accent-dim:rgba(239,68,68,.10);  --accent-soft:rgba(239,68,68,.18); }
  :root[data-theme="yellow"] { --accent:#EAB308; --accent-strong:#EAB308; --accent-hover:#FACC15; --accent-dim:rgba(234,179,8,.10);  --accent-soft:rgba(234,179,8,.18); }
  ```
  (Ambre = valeurs `:root` actuelles, inchangées.)
- `designer/index.html` : icône de marque (ligne ~16) `stroke="#FF9F40"` → `stroke="currentColor"` pour suivre l'accent.

Persisté dans `rt-designer-settings`. Couleurs ci-dessus = valeurs de départ ; ajustables.
*Polish noté :* le bouton `.primary` met du texte `#0e0e0e` sur l'accent ; lisible sur ambre/vert/jaune, à vérifier sur bleu/violet/rouge (plus sombres) — sinon basculer le texte du bouton primaire sur du clair.

---

## Feature 3 — Fontes configurables (Tiny TTF + parité)

### Architecture firmware

- `src/lv_conf.h` : `#define LV_USE_TINY_TTF 1`. **Conserver** `LV_FONT_MONTSERRAT_14/20/28/36/48` (symboles d'icône, cap d'anneau, pill). Éventuel réglage du cache glyphes / allocateur PSRAM à valider sur device.
- `src/fonts/` (nouveau) :
  - 16 tableaux C : `montserrat_{regular,bold,italic,bolditalic}`, `jetbrains_mono_*`, `lora_*`, `inter_*` (Latin-subset). `fonts.h` expose `const uint8_t*` + tailles.
  - **Gestionnaire de fontes** `get_font(family, px, bold, italic) -> const lv_font_t*` : sélectionne le bon array `(family, style)`, crée à la demande via `lv_tiny_ttf_create_data(data, size, px)` et **met en cache** un `lv_font_t*` par combinaison `(family, style, px)` réellement utilisée (cache borné). Remplace `pick_font()` pour le texte.
- `src/dashboard.h` / `src/dashboard.cpp` :
  - `Comp` : ajouter `uint8_t font_family; bool bold; bool italic;` et pour `bar` `uint8_t label_family; bool label_bold; bool label_italic;`.
  - parsing : `font_family` (défaut `montserrat`), `bold`/`italic` (défaut `false`), idem `label_*`.
- `src/view.cpp` :
  - `label`, `readout`, `ring` (centre) : `pick_font(c.font)` → `get_font(c.font_family, c.font, c.bold, c.italic)`.
  - `bar` (label) : utiliser `get_font(c.label_family, c.label_font, c.label_bold, c.label_italic)`.
  - `icon` : **inchangé** (`pick_font` sur Montserrat bitmap — porteur des symboles).

`pick_font()` arrondissait à la taille bitmap disponible ; avec Tiny TTF la taille exacte est rendue (pas d'arrondi). `get_font` clampe au domaine schéma (8–120).

### Schéma (`schema/layout.schema.json`)

- `$defs/font` : `enum [14,20,28,36,48]` → `{ "type":"integer", "minimum":8, "maximum":120 }`, défaut 20. `label_font` suit la même définition.
- nouveau `$defs/fontFamily` : `{ "enum": ["montserrat","jetbrains_mono","lora","inter"] }`, défaut `montserrat`.
- `label`, `readout`, `ring` : ajouter `font_family` (`$ref fontFamily`), `bold` (`boolean`), `italic` (`boolean`).
- `bar` : ajouter `label_family`, `label_bold`, `label_italic`.
- `icon` : inchangé.
- Mettre à jour les descriptions (suppression de la mention « arrondie à la taille disponible »).

### Designer (parité)

- `designer/vendor/fonts/` : ajouter **Lora** (R/B/I/BI) + les variantes **Bold/Italic/BoldItalic** manquantes pour Montserrat / JetBrains Mono / Inter (woff2, Latin-subset, qq centaines de Ko au total) + `@font-face` correspondants dans `style.css`.
- `designer/js/render.js` :
  - `pickFontPx(font)` → renvoie la taille **exacte** clampée `[8,120]` (plus de palier).
  - `FONT` (actuellement `px => \`${px}px Montserrat,…\``) → `font(family, bold, italic, px)` construisant `font-style`/`font-weight`/`font-size`/`font-family` (map famille→CSS family ; `bold?700:400` ; `italic?'italic':'normal'`). Appliqué aux rendus label/readout/ring-centre/bar-label.
- `designer/js/registry.js` : compFields + `defaults()` :
  - `label`, `readout`, `ring` : ajouter `['font_family','Police (famille)','fontfamily']`, `['bold','Gras','bool']`, `['italic','Italique','bool']`.
  - `bar` : ajouter `['label_family','Famille label','fontfamily']`, `['label_bold','Label gras','bool']`, `['label_italic','Label italique','bool']`.
  - défauts : `font_family:'montserrat'` ; `bold`/`italic` non émis quand `false` (suivre la sérialisation booléenne existante).
- `designer/js/inspector.js` :
  - `FONTS = [14,20,28,36,48]` → `[12,14,20,24,28,36,48,64,72]`.
  - nouveau `kind === 'fontfamily'` : `<select>` des 4 familles (libellés lisibles), même chemin de commit que les autres selects.

### Outillage

- `tools/gen_fonts.py` : subset Latin des 16 TTF (via `pyftsubset`/fonttools) + émission des arrays C (`src/fonts/*.c`). **Outil de maintenance** ; les `.c` générés sont **committés** pour que le build normal n'exige pas `fonttools`.
- Sources TTF committées (servent aussi à dériver les woff2 designer).
- `CLAUDE.md` : documenter la génération dans la section build et la dualité « Montserrat bitmap (symboles) vs Montserrat TTF (texte) ».
- `tools/stage_fs.sh` : inchangé (les woff2 sous `designer/vendor/fonts/` et `schema/` sont déjà stagés).

### Tests (TDD)

- **Designer** (`cd designer && node --test`) :
  - `schema.test.js` / `validate.test.js` : `font` entier hors anciens paliers accepté ; `font_family`/`bold`/`italic`/`label_*` valides ; valeurs hors-domaine rejetées.
  - `registry.test.js` : les nouveaux champs sont exposés sur les bons composants ; icône **non** dotée de famille/gras/italique.
  - `render.test.js` : le rendu applique famille→family CSS, `bold`→700, `italic`→italic, taille exacte.
- **Firmware natif** (`pio test -e native`) : parsing `dashboard.cpp` des nouveaux champs (famille/gras/italique + `label_*`), défauts corrects.
- **Non testable hors device** : le rendu Tiny TTF réel (rasterisation, perf, RAM/cache) → **validation device requise** (flash firmware + uploadfs). Sera signalé explicitement, jamais affirmé comme vérifié sans preuve.

---

## Risques & validation device

- **RAM/cache glyphes** Tiny TTF aux grandes tailles (64/72 px) : borner le cache (`lv_tiny_ttf_create_data_ex(cache_size)`), s'appuyer sur la PSRAM ; allocateur LVGL (`LV_MEM_SIZE` = 48 Ko) potentiellement à router vers la PSRAM. À mesurer sur device.
- **Première rasterisation** d'un grand glyphe = quelques ms (puis caché) ; acceptable pour des dashboards à MAJ périodique, à confirmer.
- **Parité** stb_truetype (device) vs navigateur (designer) : « proche », pas pixel-perfect (déjà le contrat du projet).
- **Flash** : ~1 Mo de TTF Latin-subset + firmware 1,7 Mo ≈ 2,7 Mo, large dans le slot OTA de 6,25 Mo. À confirmer après build réel.

## Coordination avec la branche `feat/designer-desktop-electron`

Les deux branches partent de `main`. Conflits possibles uniquement sur les fichiers chrome partagés (`designer/index.html`, `app.js`, `style.css`). À ce jour la branche Electron n'a qu'un doc de plan → aucun conflit actuel. Stratégie : éditions chirurgicales, et **merge à blanc** de prévisualisation avant d'atterrir sur `main` (`git merge --no-commit --no-ff <autre-branche>` puis `--abort`). Push GitHub **seulement sur demande explicite**.
