# Suppression du zoom · Thèmes designer · Fontes configurables — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirer le zoom du canvas, ajouter un choix de thème d'accent au chrome du designer, et rendre les fontes configurables (famille + gras + italique + tailles) avec parité designer ↔ firmware.

**Architecture:** Trois features indépendantes sur la branche `feat/fonts-themes-no-zoom` (worktree `/Users/jean-paulgavini/Documents/Dev/Dialboard-wt-fonts-themes`, basé sur `main`). Le zoom et les thèmes sont designer-only. Les fontes utilisent le moteur **Tiny TTF** de LVGL côté firmware (16 vrais cuts TTF Latin-subset embarqués en flash, rendus à n'importe quelle taille au runtime) et les web-fonts correspondantes côté designer pour la parité.

**Tech Stack:** JS modules ES + `node:test` (designer) ; C++/LVGL 9.5 + Unity `env:native` (firmware) ; JSON Schema (Ajv côté designer) ; `fonttools`/`pyftsubset` (génération de fontes, outil de maintenance).

**Toutes les commandes s'exécutent depuis le worktree :** `cd /Users/jean-paulgavini/Documents/Dev/Dialboard-wt-fonts-themes` sauf indication contraire.

---

## Structure des fichiers

**Modifiés :**
- `designer/index.html` — retrait du `<select id="zoom">` ; icône de marque en `currentColor`.
- `designer/js/app.js` — retrait de la logique de zoom utilisateur.
- `designer/js/statusbar.js` — commentaire zoom.
- `designer/js/settings.js` — réglage `theme` + DOM + application CSS.
- `designer/js/render.js` — `pickFontPx` exact + helper `font(family,bold,italic,px)`.
- `designer/js/inspector.js` — `FONTS` étendu + type de champ `fontfamily`.
- `designer/js/registry.js` — nouveaux champs sur label/readout/bar/ring.
- `designer/style.css` — blocs de thème, `@font-face`, retrait `.sb-zoom`.
- `schema/layout.schema.json` — `font` entier, `$defs/fontFamily`, nouveaux champs.
- `src/lv_conf.h` — `LV_USE_TINY_TTF`.
- `src/dashboard.h` / `src/dashboard.cpp` — champs `font_family`/`bold`/`italic` + parsing.
- `src/view.cpp` — appels `get_font(...)`.
- `CLAUDE.md` — doc fontes.
- Tests : `designer/tests/{settings,schema,render,registry}.test.js`, `test/test_core/test_main.cpp`.

**Créés :**
- `src/fonts.h` / `src/fonts.cpp` — gestionnaire `get_font` + cache.
- `src/fonts/*.c` — 16 tableaux C de TTF (générés).
- `designer/vendor/fonts/*.woff2` — variantes web-fonts manquantes.
- `tools/gen_fonts.py` — génération des arrays C + woff2 (maintenance).
- `tools/fonts/src/*.ttf` — TTF sources Latin (OFL), + fichiers de licence.

---

## Phase 1 — Suppression du zoom (designer-only)

### Task 1.1 : Retirer le zoom

**Files:**
- Modify: `designer/index.html` (bloc `<label class="sb-zoom">` ~lignes 78-83 ; marque ligne 16)
- Modify: `designer/js/app.js:283-303`
- Modify: `designer/js/statusbar.js` (commentaire ligne ~46)
- Modify: `designer/style.css` (règle `.sb-zoom` si présente)

- [ ] **Step 1 : Retirer le markup du zoom dans `index.html`**

Supprimer les lignes du sélecteur de zoom (de `<label class="sb-zoom">Zoom` jusqu'à son `</label>` fermant inclus) et adapter le commentaire ligne 77 (`zoom (display-only) câblé par app.js` → retirer la mention du zoom).

- [ ] **Step 2 : Retirer la logique de zoom dans `app.js`**

Remplacer le bloc `app.js:283-303` par (sans `ZOOM_KEY`/`ZOOM_ALLOWED`/`userZoom`/`zoomSel`) :

```js
  // Échelle d'affichage du canvas = fit (board entier visible dans la colonne). Le board (écran + zones)
  // est scalé d'un bloc → les zones épousent l'écran à toute échelle ; le rect live du #stage (÷360) reste
  // la source du facteur pour le DnD et les interactions (palette/canvas).
  const board = $('board'), boardFit = $('board-fit'), canvasCol = $('canvas-col');
  const applyScale = () => {
    const availW = Math.max(120, canvasCol.clientWidth - 24);
    const availH = Math.max(120, canvasCol.clientHeight - 150);   // réserve pour le titre + le carousel
    const fit = Math.min(availW / BOARD_W, availH / BOARD_H, 1.5);
    const s = Math.max(0.2, fit);
    board.style.transform = `scale(${s})`;
    boardFit.style.width = (BOARD_W * s) + 'px';
    boardFit.style.height = (BOARD_H * s) + 'px';
  };
  new ResizeObserver(applyScale).observe(canvasCol);
  applyScale();
```

- [ ] **Step 3 : Adapter le commentaire de `statusbar.js`**

Retirer/ajuster le commentaire (`statusbar.js:46` et `:57`) qui décrit le `<select id="zoom">` désormais absent.

- [ ] **Step 4 : Retirer la règle CSS `.sb-zoom`**

Run: `grep -n "sb-zoom" designer/style.css`
Si présente, supprimer la règle `.sb-zoom { … }`.

- [ ] **Step 5 : Vérifier que la suite designer reste verte**

Run: `cd designer && node --test`
Expected: PASS (aucun test ne dépend du zoom ; `node --test` doit rester au vert, même nombre de tests).

- [ ] **Step 6 : Vérifier l'absence de référence résiduelle**

Run: `grep -rniE "zoom" designer/index.html designer/js/app.js designer/js/statusbar.js`
Expected: plus aucune mention de `id="zoom"`, `userZoom`, `ZOOM_KEY`, `sb-zoom`. (Les commentaires `zoomScale()` de `canvas.js` restent — c'est l'échelle de fit, voulue.)

- [ ] **Step 7 : Commit**

```bash
git add designer/index.html designer/js/app.js designer/js/statusbar.js designer/style.css
git commit -m "feat(designer): retire le zoom d'affichage du canvas"
```

---

## Phase 2 — Thèmes de l'UI designer (CSS only)

### Task 2.1 : Réglage `theme` (store pur, TDD)

**Files:**
- Modify: `designer/js/settings.js:8-26`
- Test: `designer/tests/settings.test.js`

- [ ] **Step 1 : Écrire les tests (échouent)**

Dans `designer/tests/settings.test.js`, **mettre à jour** le `deepEqual` de `defaultSettings` (ajout `theme: 'amber'`) et ajouter les cas thème :

```js
test('defaultSettings: valeurs de référence', () => {
  assert.deepEqual(defaultSettings(), {
    theme: 'amber',
    ghostOpacity: 0.38, gridShow: false, gridSnap: false, gridStep: 10,
    logActivity: true, logJs: false, logNet: false,
  });
});

test('settings: thème valide conservé', () => {
  for (const t of ['amber', 'green', 'blue', 'violet', 'red', 'yellow']) {
    assert.equal(normalizeSettings({ theme: t }).theme, t);
  }
});

test('settings: thème inconnu → ambre (intent : pas d’accent indéfini)', () => {
  assert.equal(normalizeSettings({ theme: 'turquoise' }).theme, 'amber');
  assert.equal(normalizeSettings({ theme: 42 }).theme, 'amber');
  assert.equal(normalizeSettings({}).theme, 'amber');
});
```

- [ ] **Step 2 : Lancer les tests (échouent)**

Run: `cd designer && node --test tests/settings.test.js`
Expected: FAIL (`theme` absent du retour de `defaultSettings`/`normalizeSettings`).

- [ ] **Step 3 : Implémenter dans `settings.js`**

Ajouter en haut (après `const STEPS`) :

```js
const THEMES = ['amber', 'green', 'blue', 'violet', 'red', 'yellow'];
```

Dans `defaultSettings()`, ajouter `theme: 'amber'` à l'objet retourné. Dans `normalizeSettings()`, ajouter au retour :

```js
    theme: THEMES.includes(r.theme) ? r.theme : d.theme,
```

- [ ] **Step 4 : Lancer les tests (passent)**

Run: `cd designer && node --test tests/settings.test.js`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/settings.js designer/tests/settings.test.js
git commit -m "feat(designer): réglage de thème dans le store (validation)"
```

### Task 2.2 : Application du thème (DOM + CSS)

**Files:**
- Modify: `designer/js/settings.js` (`applyVisualSettings` + `build`)
- Modify: `designer/style.css` (blocs de thème)
- Modify: `designer/index.html:16` (icône de marque)

- [ ] **Step 1 : Appliquer le thème via un attribut sur `:root`**

Dans `settings.js::applyVisualSettings(s)`, ajouter en première ligne :

```js
  document.documentElement.dataset.theme = s.theme;
```

- [ ] **Step 2 : Ajouter le sélecteur de thème dans le tiroir**

Dans `settings.js::build()`, juste après le titre/au début du panneau (avant la ligne « Transparence des invisibles »), insérer :

```js
    // Thème (accent de l'UI designer)
    const themeRow = settingRow('Thème');
    const themeSel = document.createElement('select');
    for (const [val, txt] of [['amber','Ambre'],['green','Vert'],['blue','Bleu'],['violet','Violet'],['red','Rouge'],['yellow','Jaune']]) {
      const o = document.createElement('option'); o.value = val; o.textContent = txt;
      if (val === s.theme) o.selected = true; themeSel.appendChild(o);
    }
    themeSel.onchange = () => setSettings({ theme: themeSel.value });   // commit sur change (cf. invariant input/change)
    themeRow.querySelector('.set-line').appendChild(themeSel);
    pane.appendChild(themeRow);
```

- [ ] **Step 3 : Définir les palettes dans `style.css`**

Juste après le bloc `:root { … }` (qui reste l'ambre par défaut), ajouter :

```css
:root[data-theme="green"]  { --accent:#22C55E; --accent-strong:#22C55E; --accent-hover:#4ADE80; --accent-dim:rgba(34,197,94,.10);  --accent-soft:rgba(34,197,94,.18); }
:root[data-theme="blue"]   { --accent:#3B82F6; --accent-strong:#3B82F6; --accent-hover:#60A5FA; --accent-dim:rgba(59,130,246,.10); --accent-soft:rgba(59,130,246,.18); }
:root[data-theme="violet"] { --accent:#8B5CF6; --accent-strong:#8B5CF6; --accent-hover:#A78BFA; --accent-dim:rgba(139,92,246,.10); --accent-soft:rgba(139,92,246,.18); }
:root[data-theme="red"]    { --accent:#EF4444; --accent-strong:#EF4444; --accent-hover:#F87171; --accent-dim:rgba(239,68,68,.10);  --accent-soft:rgba(239,68,68,.18); }
:root[data-theme="yellow"] { --accent:#EAB308; --accent-strong:#EAB308; --accent-hover:#FACC15; --accent-dim:rgba(234,179,8,.10);  --accent-soft:rgba(234,179,8,.18); }
```

- [ ] **Step 4 : La marque suit le thème**

Dans `index.html:16`, remplacer `stroke="#FF9F40"` par `stroke="currentColor"` (la `.tb-brand` est déjà `color: var(--accent)`).

- [ ] **Step 5 : Vérification navigateur**

Servir le designer en no-store (cf. mémoire `designer-verif-navigateur`) :
Run (background): `cd designer && python3 -m http.server 8055`
Ouvrir `http://localhost:8055/`, ouvrir Réglages, changer le thème → l'accent (sélection, bouton primaire, marque) change ; recharger → le thème persiste. Arrêter le serveur ensuite.

- [ ] **Step 6 : Vérifier la suite designer**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add designer/js/settings.js designer/style.css designer/index.html
git commit -m "feat(designer): thèmes d'accent (ambre + vert/bleu/violet/rouge/jaune)"
```

---

## Phase 3 — Fontes : schéma

### Task 3.1 : `font`/`label_font` → entier (TDD)

**Files:**
- Modify: `schema/layout.schema.json:48-51`
- Test: `designer/tests/schema.test.js`

- [ ] **Step 1 : Écrire les tests (échouent)**

Ajouter dans `designer/tests/schema.test.js` :

```js
test('schema : font accepte une taille hors anciens paliers (Tiny TTF)', () => {
  const l = base();
  l.components.t = { type: 'readout', unit: 'C', font: 24 };
  assert.equal(validate(l).valid, true, JSON.stringify(validate(l).errors));
});

test('schema : font hors domaine 8–120 rejeté', () => {
  const lo = base(); lo.components.t = { type: 'readout', font: 5 };
  assert.equal(validate(lo).valid, false);
  const hi = base(); hi.components.t = { type: 'readout', font: 200 };
  assert.equal(validate(hi).valid, false);
});
```

- [ ] **Step 2 : Lancer (échouent)**

Run: `cd designer && node --test tests/schema.test.js`
Expected: FAIL (l'enum actuel rejette 24, et n'a pas de bornes 8–120).

- [ ] **Step 3 : Implémenter — `$defs/font` entier**

Remplacer le bloc `font` (`schema/layout.schema.json:48-51`) par :

```json
    "font": {
      "type": "integer",
      "minimum": 8,
      "maximum": 120,
      "description": "Taille de police en px. Rendu Tiny TTF (taille exacte, pas d'arrondi). Defaut 20."
    },
```

- [ ] **Step 4 : Lancer (passent) + suite complète**

Run: `cd designer && node --test`
Expected: PASS. Si un ancien test affirmait qu'une valeur de `font` non-palier est rejetée, le mettre à jour (la nouvelle règle est : entier 8–120 accepté).

- [ ] **Step 5 : Commit**

```bash
git add schema/layout.schema.json designer/tests/schema.test.js
git commit -m "feat(schema): font/label_font en entier 8-120 (Tiny TTF)"
```

### Task 3.2 : famille + gras + italique dans le schéma (TDD)

**Files:**
- Modify: `schema/layout.schema.json` (`$defs` + `comp_label`/`comp_readout`/`comp_ring`/`comp_bar`)
- Test: `designer/tests/schema.test.js`

- [ ] **Step 1 : Écrire les tests (échouent)**

```js
test('schema : font_family/bold/italic acceptés sur label/readout/ring', () => {
  const l = base();
  l.components.t = { type: 'label', text: 'x', font_family: 'lora', bold: true, italic: true };
  assert.equal(validate(l).valid, true, JSON.stringify(validate(l).errors));
});

test('schema : famille inconnue rejetée', () => {
  const l = base();
  l.components.t = { type: 'label', text: 'x', font_family: 'comic_sans' };
  assert.equal(validate(l).valid, false);
});

test('schema : bar accepte label_family/label_bold/label_italic', () => {
  const l = base();
  l.components.t = { type: 'bar', label: 'B', label_family: 'inter', label_bold: true, label_italic: false };
  assert.equal(validate(l).valid, true, JSON.stringify(validate(l).errors));
});
```

- [ ] **Step 2 : Lancer (échouent)**

Run: `cd designer && node --test tests/schema.test.js`
Expected: FAIL (`additionalProperties:false` rejette les clés inconnues).

- [ ] **Step 3 : Implémenter — `$defs/fontFamily`**

Après le bloc `$defs/font`, ajouter :

```json
    "fontFamily": {
      "enum": ["montserrat", "jetbrains_mono", "lora", "inter"],
      "description": "Famille de caractères (rendu Tiny TTF). Defaut montserrat."
    },
```

- [ ] **Step 4 : Implémenter — propriétés des composants**

Dans `comp_label.properties` (après `"font"`) et dans `comp_readout.properties` (après `"font"`), ajouter :

```json
        "font_family": { "$ref": "#/$defs/fontFamily" },
        "bold": { "type": "boolean", "description": "Gras (vrai cut). Defaut false." },
        "italic": { "type": "boolean", "description": "Italique (vrai cut). Defaut false." },
```

Idem dans `comp_ring.properties` (après `"font"`, ligne ~157) — mêmes 3 lignes.

Dans `comp_bar.properties` (après `"label_font"`, ligne ~140), ajouter :

```json
        "label_family": { "$ref": "#/$defs/fontFamily", "description": "Famille du libelle. Defaut montserrat." },
        "label_bold": { "type": "boolean", "description": "Libelle en gras. Defaut false." },
        "label_italic": { "type": "boolean", "description": "Libelle en italique. Defaut false." },
```

- [ ] **Step 5 : Lancer (passent) + suite complète**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add schema/layout.schema.json designer/tests/schema.test.js
git commit -m "feat(schema): famille/gras/italique sur label/readout/ring/bar"
```

---

## Phase 4 — Fontes : rendu designer + inspecteur + registre

### Task 4.1 : `pickFontPx` → taille exacte clampée (TDD)

**Files:**
- Modify: `designer/js/render.js:39-46`
- Test: `designer/tests/render.test.js:9-17`

- [ ] **Step 1 : Réécrire le test (échoue)**

Remplacer le test `pickFontPx retombe sur les 5 tailles LVGL` (`render.test.js:9-17`) par :

```js
test('pickFontPx renvoie la taille exacte, clampée à [8,120] (Tiny TTF rend toute taille)', () => {
  assert.equal(pickFontPx(24), 24);
  assert.equal(pickFontPx(72), 72);
  assert.equal(pickFontPx(20), 20);
  assert.equal(pickFontPx(5), 8);     // sous le plancher → 8
  assert.equal(pickFontPx(200), 120); // au-dessus du plafond → 120
  assert.equal(pickFontPx(undefined), 20); // valeur absente → défaut 20
});
```

- [ ] **Step 2 : Lancer (échoue)**

Run: `cd designer && node --test tests/render.test.js`
Expected: FAIL (`pickFontPx(24)` renvoie 20 avec l'ancien palier).

- [ ] **Step 3 : Implémenter**

Remplacer `render.js:39-46` par :

```js
// Taille de police rendue (px). Tiny TTF rend n'importe quelle taille → on renvoie la valeur exacte,
// clampée au domaine schéma [8,120] ; valeur absente → défaut 20 (miroir firmware).
export function pickFontPx(font) {
  const n = Math.round(Number(font));
  if (!Number.isFinite(n)) return 20;
  return Math.max(8, Math.min(120, n));
}
```

- [ ] **Step 4 : Lancer (passe)**

Run: `cd designer && node --test tests/render.test.js`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/render.js designer/tests/render.test.js
git commit -m "feat(designer): pickFontPx rend la taille exacte (Tiny TTF)"
```

### Task 4.2 : helper `font(family,bold,italic,px)` + application (TDD)

**Files:**
- Modify: `designer/js/render.js:179` (+ usages 187, 196, 229, 275)
- Test: `designer/tests/render.test.js`

- [ ] **Step 1 : Écrire le test (échoue)**

Ajouter l'import de `font` à la ligne d'import de `render.test.js` (ajouter `font` à la liste importée depuis `../js/render.js`), puis :

```js
test('font() compose style/graisse/taille/famille CSS', () => {
  assert.equal(font('montserrat', false, false, 20), '20px Montserrat, system-ui, sans-serif');
  assert.equal(font('lora', true, false, 28), "700 28px Lora, system-ui, serif");
  assert.equal(font('jetbrains_mono', false, true, 14), "italic 14px 'JetBrains Mono', ui-monospace, monospace");
  assert.equal(font('inter', true, true, 36), "italic 700 36px Inter, system-ui, sans-serif");
  assert.equal(font('comic', false, false, 20), '20px Montserrat, system-ui, sans-serif'); // famille inconnue → montserrat
});
```

- [ ] **Step 2 : Lancer (échoue)**

Run: `cd designer && node --test tests/render.test.js`
Expected: FAIL (`font` non exporté).

- [ ] **Step 3 : Implémenter le helper**

Remplacer `render.js:179` (`const FONT = px => …`) par :

```js
// Familles → pile CSS (parité Tiny TTF côté device). Famille inconnue → montserrat.
const FONT_STACKS = {
  montserrat:     'Montserrat, system-ui, sans-serif',
  jetbrains_mono: "'JetBrains Mono', ui-monospace, monospace",
  lora:           'Lora, system-ui, serif',
  inter:          'Inter, system-ui, sans-serif',
};
// Raccourci CSS `font` : [italic] [700] <px>px <stack>.
export function font(family, bold, italic, px) {
  const stack = FONT_STACKS[family] || FONT_STACKS.montserrat;
  return `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${px}px ${stack}`;
}
```

- [ ] **Step 4 : Brancher les usages**

- `buildLabel` (`render.js:187`) :
  ```js
  n.style.font = font(comp.font_family, comp.bold, comp.italic, pickFontPx(comp.font ?? 20));
  ```
- `buildReadout` (`render.js:196`) : idem que ci-dessus.
- `buildRing` centre (`render.js:275`) : idem que ci-dessus.
- `buildBar` label (`render.js:229`) : remplacer `lbl.style.fontSize = (comp.label_font || 14) + 'px';` par
  ```js
  lbl.style.font = font(comp.label_family, comp.label_bold, comp.label_italic, pickFontPx(comp.label_font ?? 14));
  ```

- [ ] **Step 5 : Lancer (passe) + suite complète**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add designer/js/render.js designer/tests/render.test.js
git commit -m "feat(designer): rendu police famille/gras/italique (parité Tiny TTF)"
```

### Task 4.3 : Inspecteur — tailles étendues + type `fontfamily`

**Files:**
- Modify: `designer/js/inspector.js:15` (`FONTS`) et `:17-23` (`SELECTS`)

- [ ] **Step 1 : Étendre `FONTS`**

Remplacer `inspector.js:15` par :

```js
const FONTS = [12, 14, 20, 24, 28, 36, 48, 64, 72];
```

- [ ] **Step 2 : Ajouter la famille aux selects à options fixes**

Dans l'objet `SELECTS` (`inspector.js:17-23`), ajouter une entrée :

```js
  fontfamily: [['montserrat', 'Montserrat'], ['jetbrains_mono', 'JetBrains Mono'], ['lora', 'Lora'], ['inter', 'Inter']],
```

(Le chemin générique `SELECTS[kind]` de `makeInput` gère déjà l'affichage et le commit ; valeur par défaut = première option = montserrat.)

- [ ] **Step 3 : Vérifier la suite designer**

Run: `cd designer && node --test`
Expected: PASS (pas de régression ; l'inspecteur DOM est vérifié au navigateur en Task 4.5).

- [ ] **Step 4 : Commit**

```bash
git add designer/js/inspector.js
git commit -m "feat(designer): inspecteur — tailles 12-72 + champ famille de police"
```

### Task 4.4 : Registre — nouveaux champs sur label/readout/bar/ring (TDD)

**Files:**
- Modify: `designer/js/registry.js:27,37,44,47,57-65`
- Test: `designer/tests/registry.test.js`

- [ ] **Step 1 : Écrire le test (échoue)**

Ajouter dans `designer/tests/registry.test.js` :

```js
import { COMPONENTS } from '../js/registry.js';

test('registry : famille/gras/italique exposés sur les composants textuels, pas sur icon', () => {
  const keysOf = t => COMPONENTS[t].compFields.map(f => f[0]);
  for (const t of ['label', 'readout', 'ring']) {
    assert.ok(keysOf(t).includes('font_family'), `${t} doit exposer font_family`);
    assert.ok(keysOf(t).includes('bold'), `${t} doit exposer bold`);
    assert.ok(keysOf(t).includes('italic'), `${t} doit exposer italic`);
  }
  const barKeys = keysOf('bar');
  assert.ok(barKeys.includes('label_family') && barKeys.includes('label_bold') && barKeys.includes('label_italic'));
  // icon : taille seule (glyphe de symbole)
  assert.ok(!keysOf('icon').includes('font_family'), 'icon ne doit pas exposer font_family');
});
```

(Si `registry.test.js` importe déjà `COMPONENTS`, ne pas redoubler l'import.)

- [ ] **Step 2 : Lancer (échoue)**

Run: `cd designer && node --test tests/registry.test.js`
Expected: FAIL.

- [ ] **Step 3 : Implémenter — `compFields`**

- `label` (`registry.js:27`) — insérer après `['font', 'Police', 'font']` :
  ```js
  ['font_family', 'Police (famille)', 'fontfamily'], ['bold', 'Gras', 'bool'], ['italic', 'Italique', 'bool'],
  ```
- `readout` (`registry.js:37`) — même insertion après `['font', 'Police', 'font']`.
- `ring` (`registry.js:61`) — après la ligne `['font', 'Police centre', 'font', c => !!c.center_pct]`, insérer (mêmes conditions d'affichage que le centre) :
  ```js
  ['font_family', 'Famille centre', 'fontfamily', c => !!c.center_pct],
  ['bold', 'Centre gras', 'bool', c => !!c.center_pct],
  ['italic', 'Centre italique', 'bool', c => !!c.center_pct],
  ```
- `bar` (`registry.js:47`) — après `['label_font', 'Police label', 'font']`, insérer :
  ```js
  ['label_family', 'Famille label', 'fontfamily'], ['label_bold', 'Label gras', 'bool'], ['label_italic', 'Label italique', 'bool'],
  ```

(On n'ajoute **pas** ces clés aux `defaults()` : absence = montserrat/false, côté designer comme firmware → JSON minimal.)

- [ ] **Step 4 : Lancer (passe) + suite complète**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/registry.js designer/tests/registry.test.js
git commit -m "feat(designer): registre — famille/gras/italique sur label/readout/bar/ring"
```

### Task 4.5 : Vérification navigateur de l'inspecteur

- [ ] **Step 1 : Vérifier le rendu live**

Run (background): `cd designer && python3 -m http.server 8055`
Ouvrir `http://localhost:8055/`, déposer un `label`, sélectionner-le : l'inspecteur montre Police (12-72), Police (famille), Gras, Italique. Changer la famille → Lora, cocher Gras + Italique → le label du canvas change de fonte/graisse/style en live. Vérifier de même un `readout`, un `bar` (champs label_*), un `ring` avec « Centre % » coché. Arrêter le serveur.

- [ ] **Step 2 : (pas de commit — vérification seule)**

---

## Phase 5 — Fontes : web-fonts du designer (parité)

### Task 5.1 : Vendoriser les variantes manquantes + `@font-face`

**Files:**
- Create: `designer/vendor/fonts/*.woff2` (Lora R/B/I/BI ; Montserrat/JetBrains Mono/Inter B/I/BI)
- Modify: `designer/style.css` (déclarations `@font-face`)

> Les woff2 sont produits par `tools/gen_fonts.py` (Task 7.2) — exécuter cette tâche AVANT, ou produire les woff2 manuellement ici. Latin-subset, ~15-30 Ko pièce.

- [ ] **Step 1 : Générer/placer les woff2**

Cibles (16 fichiers, nommage `<famille>-<style>.woff2`) :
`montserrat-{regular,bold,italic,bolditalic}.woff2`, `jetbrains-mono-{regular,bold,italic,bolditalic}.woff2`, `lora-{regular,bold,italic,bolditalic}.woff2`, `inter-{regular,bold,italic,bolditalic}.woff2`.
(Les `montserrat-500.woff2`/`jetbrains-mono.woff2`/`inter.woff2` existants restent pour le chrome ; on ajoute le jeu complet pour le rendu des composants.)

- [ ] **Step 2 : Déclarer les `@font-face`**

Dans `designer/style.css`, ajouter (4 familles × 4 styles ; `font-display: block` pour éviter un flash sans la fonte) — exemple pour Lora, répéter pour les 4 familles :

```css
@font-face { font-family:'Lora'; font-weight:400; font-style:normal; src:url('vendor/fonts/lora-regular.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Lora'; font-weight:700; font-style:normal; src:url('vendor/fonts/lora-bold.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Lora'; font-weight:400; font-style:italic;  src:url('vendor/fonts/lora-italic.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Lora'; font-weight:700; font-style:italic;  src:url('vendor/fonts/lora-bolditalic.woff2') format('woff2'); font-display:block; }
```

- [ ] **Step 3 : Vérification navigateur (parité famille/style)**

Run (background): `cd designer && python3 -m http.server 8055`
Vérifier qu'un label en Lora gras-italique s'affiche bien avec la vraie fonte (pas un fallback). Onglet réseau : les woff2 se chargent. Arrêter le serveur.

- [ ] **Step 4 : Commit**

```bash
git add designer/vendor/fonts/ designer/style.css
git commit -m "feat(designer): web-fonts 4 familles × 4 styles (@font-face, parité)"
```

---

## Phase 6 — Fontes : parsing firmware (TDD natif)

### Task 6.1 : Champs `font_family`/`bold`/`italic` dans `Comp` + parsing

**Files:**
- Modify: `src/dashboard.h` (struct `Comp`, après `font`/`label_font`)
- Modify: `src/dashboard.cpp` (parsing, ~136-189)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1 : Écrire le test natif (échoue)**

Dans `test/test_core/test_main.cpp`, ajouter un layout et un test. Près des autres `LAYOUT_*`/`RUN_TEST` :

```c
#define LAYOUT_FONTS "{\"components\":{\"l\":{\"type\":\"label\",\"text\":\"x\",\"font\":24,\"font_family\":\"lora\",\"bold\":true,\"italic\":true}},\"pages\":[{\"name\":\"P\",\"place\":[{\"ref\":\"l\",\"anchor\":\"CENTER\"}]}]}"

void test_font_family_parse(void) {
    Dashboard d; char err[128];
    TEST_ASSERT_TRUE(dash_set_layout(&d, LAYOUT_FONTS, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(1, d.comp_count);
    TEST_ASSERT_EQUAL_INT(24, d.comps[0].font);
    TEST_ASSERT_EQUAL_INT(FAMILY_LORA, d.comps[0].font_family);
    TEST_ASSERT_TRUE(d.comps[0].bold);
    TEST_ASSERT_TRUE(d.comps[0].italic);
}

void test_font_family_default(void) {
    Dashboard d; char err[128];
    const char *L = "{\"components\":{\"l\":{\"type\":\"label\",\"text\":\"x\"}},\"pages\":[{\"name\":\"P\",\"place\":[{\"ref\":\"l\",\"anchor\":\"CENTER\"}]}]}";
    TEST_ASSERT_TRUE(dash_set_layout(&d, L, err, sizeof(err)));
    TEST_ASSERT_EQUAL_INT(FAMILY_MONTSERRAT, d.comps[0].font_family);
    TEST_ASSERT_FALSE(d.comps[0].bold);
    TEST_ASSERT_FALSE(d.comps[0].italic);
}
```

Ajouter `RUN_TEST(test_font_family_parse); RUN_TEST(test_font_family_default);` dans `main()` (à côté des autres `RUN_TEST`). Vérifier le nom réel du tableau de composants (`d.comps[...]`) dans `dashboard.h` et l'aligner si différent.

- [ ] **Step 2 : Lancer (échoue à la compilation)**

Run: `pio test -e native`
Expected: FAIL (`FAMILY_LORA`/`font_family` inconnus).

- [ ] **Step 3 : Implémenter — `dashboard.h`**

Ajouter l'enum (avant la struct `Comp`) :

```cpp
enum FontFamily : uint8_t { FAMILY_MONTSERRAT = 0, FAMILY_JETBRAINS_MONO, FAMILY_LORA, FAMILY_INTER };
```

Dans `struct Comp`, après `uint16_t font;` :

```cpp
    uint8_t  font_family;            // famille de police (defaut FAMILY_MONTSERRAT)
    bool     bold;                   // gras (defaut false)
    bool     italic;                 // italique (defaut false)
```

Et après `uint16_t label_font;` (bar) :

```cpp
    uint8_t  label_family;           // bar : famille du libelle (defaut FAMILY_MONTSERRAT)
    bool     label_bold;             // bar : libelle gras
    bool     label_italic;           // bar : libelle italique
```

- [ ] **Step 4 : Implémenter — `dashboard.cpp` (helper + parsing)**

Ajouter un helper (près du haut du fichier) :

```cpp
static uint8_t parse_font_family(const char *s) {
    if (!s) return FAMILY_MONTSERRAT;
    if (!strcmp(s, "jetbrains_mono")) return FAMILY_JETBRAINS_MONO;
    if (!strcmp(s, "lora"))           return FAMILY_LORA;
    if (!strcmp(s, "inter"))          return FAMILY_INTER;
    return FAMILY_MONTSERRAT;
}
```

Là où `c.font = o["font"] | 20;` (~`dashboard.cpp:136`), ajouter :

```cpp
        c.font_family = parse_font_family(o["font_family"] | "montserrat");
        c.bold        = o["bold"]   | false;
        c.italic      = o["italic"] | false;
```

Là où `c.label_font = o["label_font"] | 14;` (~`:138`), ajouter :

```cpp
        c.label_family = parse_font_family(o["label_family"] | "montserrat");
        c.label_bold   = o["label_bold"]   | false;
        c.label_italic = o["label_italic"] | false;
```

- [ ] **Step 5 : Lancer (passe)**

Run: `pio test -e native`
Expected: PASS (tous les tests, dont `test_font_family_parse`/`test_font_family_default`).

- [ ] **Step 6 : Commit**

```bash
git add src/dashboard.h src/dashboard.cpp test/test_core/test_main.cpp
git commit -m "feat(firmware): parsing famille/gras/italique des composants"
```

---

## Phase 7 — Fontes : rendu Tiny TTF firmware (validation device requise)

> ⚠️ Le rendu Tiny TTF réel **n'est pas testable** hors device (pas de LVGL en `env:native`). Ces tâches se vérifient par **build `esp32s3` réussi** puis **flash + observation sur device**. Ne jamais affirmer « vérifié » sans preuve device (Rule 4/12).

### Task 7.1 : Activer Tiny TTF

**Files:**
- Modify: `src/lv_conf.h`

- [ ] **Step 1 : Activer le moteur**

Près des `LV_FONT_MONTSERRAT_*` (qui restent — symboles d'icône, cap, pill), ajouter :

```c
#define LV_USE_TINY_TTF 1
/* Permet lv_tiny_ttf_create_data() (chargement depuis un tableau C en flash). */
#define LV_TINY_TTF_FILE_SUPPORT 0
```

- [ ] **Step 2 : Build sanity**

Run: `pio run -e esp32s3`
Expected: build OK (Tiny TTF compilé, pas encore utilisé).

- [ ] **Step 3 : Commit**

```bash
git add src/lv_conf.h
git commit -m "build(firmware): active LV_USE_TINY_TTF"
```

### Task 7.2 : Générer les 16 TTF (arrays C + woff2)

**Files:**
- Create: `tools/gen_fonts.py`
- Create: `tools/fonts/src/*.ttf` (16 sources Latin OFL) + `tools/fonts/OFL-*.txt`
- Create: `src/fonts/*.c` (générés), `designer/vendor/fonts/*.woff2` (générés)

- [ ] **Step 1 : Récupérer les TTF sources (OFL)**

Télécharger depuis Google Fonts les 16 cuts (Regular/Bold/Italic/BoldItalic) de Montserrat, JetBrains Mono, Lora, Inter dans `tools/fonts/src/` ; y placer les fichiers `OFL.txt` de chaque famille. (Manuel : ces binaires ne sont pas générables par le script.)

- [ ] **Step 2 : Écrire `tools/gen_fonts.py`**

```python
#!/usr/bin/env python3
"""Subset Latin des TTF -> tableaux C (firmware) + woff2 (designer).
Dépendance : fonttools (pip install fonttools brotli). Outil de maintenance ;
les .c/.woff2 produits sont committés pour que le build normal n'exige rien."""
import subprocess, sys, pathlib

SRC = pathlib.Path("tools/fonts/src")
C_OUT = pathlib.Path("src/fonts")
WOFF_OUT = pathlib.Path("designer/vendor/fonts")
# (famille, style) -> nom de base du fichier source TTF (sans extension)
FONTS = {
    ("montserrat","regular"):"Montserrat-Regular", ("montserrat","bold"):"Montserrat-Bold",
    ("montserrat","italic"):"Montserrat-Italic", ("montserrat","bolditalic"):"Montserrat-BoldItalic",
    ("jetbrains_mono","regular"):"JetBrainsMono-Regular", ("jetbrains_mono","bold"):"JetBrainsMono-Bold",
    ("jetbrains_mono","italic"):"JetBrainsMono-Italic", ("jetbrains_mono","bolditalic"):"JetBrainsMono-BoldItalic",
    ("lora","regular"):"Lora-Regular", ("lora","bold"):"Lora-Bold",
    ("lora","italic"):"Lora-Italic", ("lora","bolditalic"):"Lora-BoldItalic",
    ("inter","regular"):"Inter-Regular", ("inter","bold"):"Inter-Bold",
    ("inter","italic"):"Inter-Italic", ("inter","bolditalic"):"Inter-BoldItalic",
}
UNICODES = "U+0020-007F,U+00A0-00FF"  # Latin de base + Latin-1 (couvre l'ASCII requis)

def c_name(fam, style): return f"font_{fam}_{style}"
def woff_name(fam, style): return f"{fam.replace('_','-')}-{style}.woff2"

def subset(src, out, flavor=None):
    args = ["pyftsubset", str(src), f"--unicodes={UNICODES}",
            "--layout-features=kern,liga", f"--output-file={out}"]
    if flavor: args.append(f"--flavor={flavor}")
    subprocess.run(args, check=True)

def emit_c(ttf, fam, style):
    data = pathlib.Path(ttf).read_bytes()
    name = c_name(fam, style)
    lines = [f"// Généré par tools/gen_fonts.py — ne pas éditer.",
             f"#include <stdint.h>",
             f"const unsigned char {name}[] = {{"]
    for i in range(0, len(data), 16):
        lines.append("  " + ",".join(str(b) for b in data[i:i+16]) + ",")
    lines.append("};")
    lines.append(f"const unsigned int {name}_len = {len(data)};")
    (C_OUT / f"{name}.c").write_text("\n".join(lines) + "\n")

def main():
    C_OUT.mkdir(parents=True, exist_ok=True); WOFF_OUT.mkdir(parents=True, exist_ok=True)
    header = ["// Généré par tools/gen_fonts.py — ne pas éditer.", "#pragma once", "#include <stdint.h>",
              'extern "C" {'] if False else ["// Généré par tools/gen_fonts.py — ne pas éditer.", "#pragma once", "#include <stddef.h>"]
    decls = []
    tmp = pathlib.Path("tools/fonts/_subset.ttf")
    for (fam, style), base in FONTS.items():
        src = SRC / f"{base}.ttf"
        if not src.exists(): sys.exit(f"manquant : {src}")
        subset(src, tmp)                       # TTF subset -> array C
        emit_c(tmp, fam, style)
        subset(src, WOFF_OUT / woff_name(fam, style), flavor="woff2")  # woff2 designer
        n = c_name(fam, style)
        decls.append(f"extern const unsigned char {n}[];\nextern const unsigned int {n}_len;")
    tmp.unlink(missing_ok=True)
    (C_OUT / "fonts_data.h").write_text("\n".join(header + [""] + decls) + "\n")
    print(f"OK : {len(FONTS)} fontes -> {C_OUT}/ et {WOFF_OUT}/")

if __name__ == "__main__":
    main()
```

- [ ] **Step 3 : Générer**

Run: `pip install fonttools brotli && python3 tools/gen_fonts.py`
Expected: `OK : 16 fontes -> src/fonts/ et designer/vendor/fonts/` ; 16 `.c` + `src/fonts/fonts_data.h` + 16 woff2.

- [ ] **Step 4 : Vérifier le poids**

Run: `du -sh src/fonts; ls src/fonts/*.c | wc -l`
Expected: total ~1 Mo, 16 fichiers `.c`. (Si > ~3 Mo, resserrer `UNICODES` à `U+0020-007F`.)

- [ ] **Step 5 : Commit**

```bash
git add tools/gen_fonts.py tools/fonts/ src/fonts/ designer/vendor/fonts/
git commit -m "feat(fonts): génération + arrays C (firmware) et woff2 (designer)"
```

### Task 7.3 : Gestionnaire de fontes `get_font`

**Files:**
- Create: `src/fonts.h`, `src/fonts.cpp`

- [ ] **Step 1 : `src/fonts.h`**

```cpp
#pragma once
#include <lvgl.h>
#include <stdint.h>
#include "dashboard.h"   // FontFamily

// Renvoie une fonte Tiny TTF pour (famille, taille px, gras, italique).
// Crée à la demande et met en cache (réutilisation par combinaison). Jamais nullptr
// (repli Montserrat bitmap si la création échoue ou le cache déborde).
const lv_font_t* get_font(uint8_t family, uint16_t px, bool bold, bool italic);
```

- [ ] **Step 2 : `src/fonts.cpp`**

```cpp
#include "fonts.h"
#include "fonts/fonts_data.h"

// 4 familles × 4 styles → (données, longueur). Ordre styles : regular, bold, italic, bolditalic.
struct Ttf { const unsigned char *data; const unsigned int *len; };
static const Ttf TTF[4][4] = {
  { {font_montserrat_regular,&font_montserrat_regular_len},{font_montserrat_bold,&font_montserrat_bold_len},
    {font_montserrat_italic,&font_montserrat_italic_len},{font_montserrat_bolditalic,&font_montserrat_bolditalic_len} },
  { {font_jetbrains_mono_regular,&font_jetbrains_mono_regular_len},{font_jetbrains_mono_bold,&font_jetbrains_mono_bold_len},
    {font_jetbrains_mono_italic,&font_jetbrains_mono_italic_len},{font_jetbrains_mono_bolditalic,&font_jetbrains_mono_bolditalic_len} },
  { {font_lora_regular,&font_lora_regular_len},{font_lora_bold,&font_lora_bold_len},
    {font_lora_italic,&font_lora_italic_len},{font_lora_bolditalic,&font_lora_bolditalic_len} },
  { {font_inter_regular,&font_inter_regular_len},{font_inter_bold,&font_inter_bold_len},
    {font_inter_italic,&font_inter_italic_len},{font_inter_bolditalic,&font_inter_bolditalic_len} },
};

#define FONT_CACHE_MAX 32
struct Entry { uint8_t fam, style; uint16_t px; lv_font_t *font; };
static Entry s_cache[FONT_CACHE_MAX];
static int s_cache_n = 0;

static const lv_font_t* fallback(uint16_t px) {
  if (px >= 48) return &lv_font_montserrat_48;
  if (px >= 36) return &lv_font_montserrat_36;
  if (px >= 28) return &lv_font_montserrat_28;
  if (px >= 20) return &lv_font_montserrat_20;
  return &lv_font_montserrat_14;
}

const lv_font_t* get_font(uint8_t family, uint16_t px, bool bold, bool italic) {
  if (family > 3) family = 0;
  if (px < 8) px = 8; if (px > 120) px = 120;
  uint8_t style = (bold ? 1 : 0) | (italic ? 2 : 0);   // 0 reg, 1 bold, 2 italic, 3 bolditalic
  for (int i = 0; i < s_cache_n; i++)
    if (s_cache[i].fam == family && s_cache[i].style == style && s_cache[i].px == px)
      return s_cache[i].font;
  const Ttf &t = TTF[family][style];
  lv_font_t *f = lv_tiny_ttf_create_data((const void*)t.data, *t.len, px);
  if (!f) return fallback(px);
  if (s_cache_n < FONT_CACHE_MAX) s_cache[s_cache_n++] = { family, style, px, f };
  return f;
}
```

- [ ] **Step 3 : Build**

Run: `pio run -e esp32s3`
Expected: build OK (fonts.cpp compile et lie les arrays).

- [ ] **Step 4 : Commit**

```bash
git add src/fonts.h src/fonts.cpp
git commit -m "feat(firmware): gestionnaire get_font (Tiny TTF + cache)"
```

### Task 7.4 : Brancher `get_font` dans `view.cpp`

**Files:**
- Modify: `src/view.cpp` (include + appels)

- [ ] **Step 1 : Inclure le gestionnaire**

En tête de `view.cpp`, ajouter `#include "fonts.h"`.

- [ ] **Step 2 : Remplacer les `pick_font` du texte**

- label (`view.cpp:193`) : `lv_obj_set_style_text_font(l, get_font(c.font_family, c.font, c.bold, c.italic), 0);`
- readout (la ligne `pick_font(c.font)` du readout) : idem `get_font(c.font_family, c.font, c.bold, c.italic)`.
- ring centre (`view.cpp:179`) : idem `get_font(c.font_family, c.font, c.bold, c.italic)`.
- bar label (`view.cpp:212`) : `lv_obj_set_style_text_font(bl, get_font(c.label_family, c.label_font, c.label_bold, c.label_italic), 0);`
- **icon** (`view.cpp:546`) : **inchangé** (`pick_font` — police de symboles Montserrat bitmap).
- cap d'anneau / pill (`view.cpp:139,161,171`) : **inchangés** (Montserrat bitmap fixe).

- [ ] **Step 3 : Build**

Run: `pio run -e esp32s3`
Expected: build OK.

- [ ] **Step 4 : Commit**

```bash
git add src/view.cpp
git commit -m "feat(firmware): rendu du texte via get_font (famille/gras/italique/taille)"
```

### Task 7.5 : Validation device

- [ ] **Step 1 : Stager l'image LittleFS (woff2 + schéma à jour)**

Run: `bash tools/stage_fs.sh`

- [ ] **Step 2 : Flasher firmware + filesystem**

> ⚠️ `uploadfs` réécrit tout le LittleFS — sauvegarder au préalable les assets device (cf. mémoire `uploadfs-efface-assets-device`).

Run: `pio run -e esp32s3 -t upload && pio run -e esp32s3 -t uploadfs`

- [ ] **Step 3 : Observer sur device (checklist)**

Pousser un layout de test contenant : label en Lora gras-italique 64 px ; readout en JetBrains Mono ; bar avec label en Inter italique ; ring center % en Lora 72. Vérifier sur l'écran :
- chaque famille/graisse/style s'affiche correctement ;
- les grandes tailles (64/72) rendent sans glitch ;
- pas de crash/OOM, latence de MAJ acceptable.
Mesurer la heap libre (log série) avant/après affichage des grandes fontes pour valider la marge PSRAM/cache.

- [ ] **Step 4 : Si OOM/lenteur** — ajuster (au choix) : borner le cache via `lv_tiny_ttf_create_data_ex(..., cache_size)`, router l'allocateur LVGL vers la PSRAM, ou réduire `FONT_CACHE_MAX`. Re-flasher, re-observer. **Documenter le résultat observé (preuve), ne pas affirmer sans mesure.**

- [ ] **Step 5 : Commit (le cas échéant)**

```bash
git add src/fonts.cpp src/lv_conf.h
git commit -m "perf(firmware): réglage cache/alloc Tiny TTF (validé device)"
```

---

## Phase 8 — Documentation + vérification finale + aperçu de merge

### Task 8.1 : Documenter

**Files:**
- Modify: `CLAUDE.md` (section LVGL + build)

- [ ] **Step 1 : Ajouter la note fontes**

Dans `CLAUDE.md`, documenter : Tiny TTF (`LV_USE_TINY_TTF`) pour le texte des composants ; **Montserrat bitmap conservé** pour les symboles d'icône / cap / pill ; génération des fontes via `tools/gen_fonts.py` (subset Latin → arrays C `src/fonts/` + woff2 `designer/vendor/fonts/`) ; dépendance `fonttools` pour la régénération seulement (les `.c`/woff2 sont committés).

- [ ] **Step 2 : Commit**

```bash
git add CLAUDE.md
git commit -m "docs: fontes Tiny TTF + génération (tools/gen_fonts.py)"
```

### Task 8.2 : Vérification finale + aperçu de merge

- [ ] **Step 1 : Suites complètes**

Run: `cd designer && node --test`
Expected: PASS (tous).
Run: `pio test -e native`
Expected: PASS (tous).
Run: `pio run -e esp32s3`
Expected: build OK.

- [ ] **Step 2 : Aperçu des conflits avec la branche Electron (sans rien pousser)**

```bash
git merge --no-commit --no-ff feat/designer-desktop-electron || true
git merge --abort
```
Noter les fichiers en conflit éventuels (probables : `designer/index.html`, `app.js`, `style.css`) pour la résolution au moment du merge réel.

- [ ] **Step 3 : Récapitulatif à l'utilisateur**

Lister : features livrées, preuves (sorties de test/build), ce qui reste **non vérifié hors device** (rendu Tiny TTF — Phase 7.5 à confirmer sur matériel), et l'état du merge. **Push GitHub seulement sur demande explicite.**

---

## Auto-revue (faite à l'écriture)

- **Couverture spec** : zoom (Phase 1) ; thèmes ambre+5 (Phase 2) ; fontes famille/gras/italique/tailles côté schéma (Phase 3), designer (Phases 4-5), firmware (Phases 6-7) ; icône exclue (Task 4.4/7.4) ; parité web-fonts (Phase 5) ; outillage (Task 7.2) ; docs (Task 8.1) ; merge (Task 8.2). ✓
- **Cohérence des noms** : `pickFontPx`, `font(family,bold,italic,px)`, `FONT_STACKS`, `fontfamily` (kind), `font_family`/`bold`/`italic` + `label_family`/`label_bold`/`label_italic` (schéma, registre, firmware), `FAMILY_*`, `get_font`, `font_<fam>_<style>`/`_len` (arrays) — alignés de bout en bout. ✓
- **Pas de placeholder** : chaque step de code montre le code ; les étapes device sont des vérifications explicites (non simulables), pas des « TODO ». ✓
- **Non testable hors device** explicitement isolé en Phase 7 avec garde anti-affirmation. ✓
