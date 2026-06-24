# Redesign visuel du designer Dialboard — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre l'apparence et la disposition du designer web (chrome de l'éditeur) selon le thème « noir chaud + ambre / polices Atelier », sans toucher au moteur de parité (`render.js`), au firmware ni au schéma.

**Architecture:** Réskin par couches. (1) On **réaffecte** les variables CSS existantes (`--bg`, `--accent`, etc.) vers la palette ambre verbatim + polices embarquées + échelle ×1,15. (2) On restructure `index.html` en grille 4 colonnes (palette icône / calques / canvas / inspecteur) et on transforme la toolbar en groupes d'icônes (ids et câblage `app.js` **inchangés**). (3) On greffe un helper *numeric-drag* sur les champs `'num'` de `inspector.js`, branché sur la coalescence d'undo existante. Le reste est du CSS sur les classes déjà générées par les modules.

**Tech Stack:** HTML/CSS/JS vanilla (modules ES), Node test runner (`node --test`), vérif navigateur Playwright/Chromium. Polices Google embarquées en `.woff2` (offline, comme Montserrat).

**Référence de style (source de vérité visuelle) :** `docs/_internal/playgrounds/designer-redesign.html` (validé avec l'utilisateur ; gitignoré mais présent sur disque). À ouvrir au navigateur pour diffing pendant l'implémentation.

**Spec :** `docs/superpowers/specs/2026-06-24-designer-redesign-design.md`.

---

## Conventions de vérification (valables pour tout le plan)

- **Régression logique** : `cd designer && node --test` doit rester **vert** à chaque commit (les fonctions pures ne sont pas touchées ; c'est un garde-fou anti-régression, pas une cible de nouveaux tests). Invocation **sans argument** (cf. CLAUDE.md).
- **Vérif visuelle / DOM** : les changements de ce plan sont CSS/DOM → **non testables en node**. La vérif est **navigateur** : servir **depuis la racine du repo** (`app.js` fait `fetch('../schema/layout.schema.json')` → servir depuis `designer/` casse le boot) en **no-store** (cache des modules ES), p. ex. :
  ```bash
  cd /Users/jean-paulgavini/Documents/Dev/Dialboard
  python3 -m http.server 8779 --bind 127.0.0.1   # NE PAS utiliser le port 8000 (réservé utilisateur)
  # ouvrir http://127.0.0.1:8779/designer/  (recharger en no-store : DevTools « Disable cache »)
  ```
  Arrêter le serveur en fin de session.
- **Garde-parité (à chaque commit)** : `git diff --name-only main -- src lib schema designer/js/render.js` doit être **vide**. Ces fichiers ne doivent JAMAIS apparaître dans un commit de ce plan.
- **Invariants inspecteur/canvas à ne pas régresser** (cf. CLAUDE.md « Designer — invariants ») : commit couleur sur `change` (pas par frappe) + champ vidé → clé supprimée ; closures de commit figées au rendu ; `inspector.select` blur avant changement de `sel` ; champs numériques coalescés par session + `breakCoalesce()` au blur ; anneau `pointer-events` sur parties peintes seulement.

---

## Task 1 : Embarquer les polices Atelier (woff2 + @font-face)

**Files:**
- Create: `designer/vendor/fonts/space-grotesk-500.woff2`, `inter-400.woff2`, `inter-500.woff2`, `inter-600.woff2`, `jetbrains-mono-400.woff2`, `jetbrains-mono-500.woff2`
- Modify: `designer/style.css` (bloc `@font-face`, autour de la ligne 119)

- [ ] **Step 1 : Récupérer les URLs woff2 latin depuis le CSS Google déjà téléchargé**

Le fichier `~/Downloads/Dialboardtest_files/css2` contient les `@font-face` (avec `src: url(https://fonts.gstatic.com/...woff2)`) des 3 familles. Extraire les URLs du **subset latin** :

```bash
grep -B3 'unicode-range.*U+0000' ~/Downloads/Dialboardtest_files/css2 | grep -oE "https://[^)]+woff2"
```
Expected : une liste d'URLs gstatic (une par poids/famille).

- [ ] **Step 2 : Télécharger les 6 poids nécessaires dans `vendor/fonts/`**

Pour chaque famille/poids requis, repérer l'URL latin correspondante (les `@font-face` du css2 sont groupés par famille avec `font-weight: <n>`) et la télécharger sous le nom canonique. Exemple de forme (adapter les URLs réelles trouvées au Step 1) :

```bash
cd /Users/jean-paulgavini/Documents/Dev/Dialboard/designer/vendor/fonts
curl -sL "<url Space Grotesk 500 latin>"  -o space-grotesk-500.woff2
curl -sL "<url Inter 400 latin>"          -o inter-400.woff2
curl -sL "<url Inter 500 latin>"          -o inter-500.woff2
curl -sL "<url Inter 600 latin>"          -o inter-600.woff2
curl -sL "<url JetBrains Mono 400 latin>" -o jetbrains-mono-400.woff2
curl -sL "<url JetBrains Mono 500 latin>" -o jetbrains-mono-500.woff2
ls -la
```
Expected : 6 fichiers `.woff2` non vides (quelques dizaines de Ko chacun). Si une URL latin manque pour un poids, prendre le subset `latin-ext` (couvre le latin).

- [ ] **Step 3 : Déclarer les @font-face dans `style.css`**

Juste après le bloc `@font-face` Montserrat existant (≈ ligne 124), ajouter :

```css
@font-face { font-family: 'Space Grotesk'; src: url('vendor/fonts/space-grotesk-500.woff2') format('woff2'); font-weight: 500; font-display: swap; }
@font-face { font-family: 'Inter'; src: url('vendor/fonts/inter-400.woff2') format('woff2'); font-weight: 400; font-display: swap; }
@font-face { font-family: 'Inter'; src: url('vendor/fonts/inter-500.woff2') format('woff2'); font-weight: 500; font-display: swap; }
@font-face { font-family: 'Inter'; src: url('vendor/fonts/inter-600.woff2') format('woff2'); font-weight: 600; font-display: swap; }
@font-face { font-family: 'JetBrains Mono'; src: url('vendor/fonts/jetbrains-mono-400.woff2') format('woff2'); font-weight: 400; font-display: swap; }
@font-face { font-family: 'JetBrains Mono'; src: url('vendor/fonts/jetbrains-mono-500.woff2') format('woff2'); font-weight: 500; font-display: swap; }
```

- [ ] **Step 4 : Vérif navigateur (polices chargées hors-ligne)**

Servir depuis la racine (cf. conventions), ouvrir `/designer/`, DevTools › Network : filtrer `woff2` → les 6 fichiers chargent en **200 depuis `vendor/fonts/`** (aucune requête `fonts.gstatic.com`). `node --test` reste vert.

Expected : 6 woff2 servis localement, zéro requête réseau externe.

- [ ] **Step 5 : Commit**

```bash
cd /Users/jean-paulgavini/Documents/Dev/Dialboard
git add designer/vendor/fonts designer/style.css
git commit -m "feat(designer): embarque les polices Atelier (Space Grotesk/Inter/JetBrains Mono)"
```

---

## Task 2 : Thème — réaffecter les tokens vers la palette ambre + échelle ×1,15

**Files:**
- Modify: `designer/style.css:1-25` (bloc `:root`)

**Principe :** on **garde les noms de variables existants** (utilisés partout, y compris affordances canvas) et on **change leurs valeurs**. On **ajoute** les tokens manquants de la maquette (`--accent-soft`, `--accent-dim`, `--accent-hover`, `--panel-3`, `--input`, `--border-2`, `--text-dim`, `--text-mute`, `--text-label`). On introduit `--scale: 1.15`.

- [ ] **Step 1 : Remplacer le bloc `:root`**

Remplacer les lignes 1-25 de `style.css` par :

```css
:root {
  /* Palette « noir chaud + ambre » — reprise verbatim de la maquette (designer-redesign.html).
     Les noms historiques (--bg/--panel/--line/--ink/--muted/--accent/--info/--ok/--warn/--err)
     sont conservés : ils pilotent aussi les affordances d'édition du canvas (sélection/poignées/
     guides), qui passent donc en ambre. Le rendu des composants reste en couleurs de parité (en dur). */
  --bg: #0E0E0E;
  --panel: #161616;
  --panel-2: #1F1F1F;
  --panel-3: #252525;
  --input: #0A0A0A;
  --canvas: #131313;
  --line: #2A2A2A;            /* ex --line (bordures) */
  --border-2: #3A3A3A;
  --ink: #F4F1E8;             /* texte principal (off-white) */
  --muted: #6B6864;           /* texte atténué */
  --text-dim: #A8A29E;
  --text-label: #BFBAB0;
  --accent: #FF9F40;          /* primaire + sélection (ambre) */
  --accent-strong: #FF9F40;   /* fond bouton primaire */
  --accent-hover: #FFB84D;
  --accent-dim: rgba(255,159,64,.10);
  --accent-soft: rgba(255,159,64,.18);
  --info: #38bdf8;            /* info device (inchangé) */
  --ok: #6FCF97;
  --warn: #E6B450;
  --err: #E06C5A;

  --font-ui: 'Inter', system-ui, sans-serif;
  --font-display: 'Space Grotesk', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  --scale: 1.15;             /* échelle de densité du chrome (figée, pas de réglage runtime) */

  --pal-w: 44px;             /* colonne palette icône */
  --layers-w: 220px;         /* colonne calques */
  --insp-w: 300px;           /* colonne inspecteur */
}
```

- [ ] **Step 2 : Vérif navigateur (recoloration)**

Recharger `/designer/` (no-store). Attendu : tout le chrome passe en noir chaud + ambre ; la **sélection d'un widget** sur le canvas s'affiche en **ambre** (outline/poignées/guides) ; les composants gardent leurs vraies couleurs. `node --test` vert. `git diff` ne montre que `style.css`.

- [ ] **Step 3 : Commit**

```bash
git add designer/style.css
git commit -m "feat(designer): thème ambre (réaffecte les tokens, échelle 1.15)"
```

---

## Task 3 : Disposition 4 colonnes + grille body

**Files:**
- Modify: `designer/index.html` (le `<main>`, ≈ lignes 44-58)
- Modify: `designer/style.css` (`main`, `.dock-left`, `#layers`, `.col`)

- [ ] **Step 1 : Séparer palette et calques en 2 colonnes de premier niveau**

Dans `index.html`, remplacer le `<div class="dock-left">…</div>` (qui empile `#palette` et `#layers`) par les deux `<aside>` directement enfants de `<main>` :

```html
  <main>
    <aside id="palette" class="col col-palette"></aside>
    <aside id="layers" class="col col-layers"></aside>
    <section id="canvas-col" class="col">
      <div id="stage-wrap" class="stage-wrap">
        <div id="stage" class="stage"><div class="screen-circle"></div></div>
      </div>
      <div id="carousel" class="carousel"></div>
    </section>
    <aside id="inspector" class="col"></aside>
  </main>
```
(On retire les `<h2>` injectés en dur : les en-têtes de colonne seront stylés via les modules ; conserver le `<h2>` que chaque module écrit déjà.)

- [ ] **Step 2 : Grille body 4 colonnes**

Dans `style.css`, remplacer la règle `main { … }` (ligne 44) et `.dock-left`/`#layers` (50-51) par :

```css
main { display: grid; grid-template-columns: var(--pal-w) var(--layers-w) 1fr var(--insp-w);
  gap: 0; padding: 0; min-height: 0; }
main > .col { border-radius: 0; border: 0; border-right: 1px solid var(--line); overflow: auto; min-height: 0; }
main > .col:last-child { border-right: 0; }
#layers { min-height: 0; }                 /* scrolle dans sa colonne */
.col-palette { background: var(--bg); padding: 6px 0; overflow: hidden auto; }
```
(Supprimer les anciennes règles `.dock-left` et le `#layers { max-height: 60vh }`.)

- [ ] **Step 3 : Vérif navigateur**

Recharger. Attendu : 4 colonnes distinctes (bande étroite palette à gauche, calques, canvas centré, inspecteur) ; chaque colonne scrolle indépendamment ; le canvas reste centré avec son carousel dessous. Sélection arbre↔canvas toujours fonctionnelle. `node --test` vert.

- [ ] **Step 4 : Commit**

```bash
git add designer/index.html designer/style.css
git commit -m "feat(designer): disposition 4 colonnes (palette / calques / canvas / inspecteur)"
```

---

## Task 4 : Toolbar iconographique (ids et câblage inchangés)

**Files:**
- Modify: `designer/index.html` (le `<header>`, ≈ lignes 12-42)
- Modify: `designer/style.css` (`header`, `.hgroup`, `button`)

**Principe :** on **garde tous les ids** (`#undo #redo #base #load #push #values #statusbtn #capture #export #import #drawer-toggle #dev-pill`) → `app.js` se câble dessus sans changement. On remplace le **texte** des boutons par des **SVG + tooltip** (`title`), on regroupe par familles, on remplace le `<h1>` par une marque (anneau + nom mono).

- [ ] **Step 1 : Remplacer le contenu du `<header>`**

Reprendre la structure de la toolbar du playground de référence (`.tb-brand`, `.tb-group`, `.tb-btn` + SVG + `data-tip`), en **réappliquant les ids existants** sur les boutons. Chaque bouton garde son `id` et son `title`/`data-tip` (= ancien libellé). Le `<input id="base">` et la pastille `#dev-pill` restent. Conserver `#import-file` (hidden). Exemple de groupe (Historique) :

```html
<div class="hgroup">
  <button id="undo" class="tb-btn" data-tip="Annuler (Ctrl+Z)" disabled>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7h8a3 3 0 010 6H6M3 7l3-3M3 7l3 3"/></svg>
  </button>
  <button id="redo" class="tb-btn" data-tip="Rétablir" disabled>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 7H5a3 3 0 000 6h5M13 7l-3-3M13 7l-3 3"/></svg>
  </button>
</div>
```
Reproduire pour les groupes Fichier (`#export`/`#import`), Device (`#load`/`#push`/`#values`/`#statusbtn`/`#capture`), et ⚙ (`#drawer-toggle`). Garder le champ `#base` (URL device) et `#dev-pill` à droite (après un `.grow`). Copier les SVG depuis le playground. **Ne pas** ajouter de bouton Preview ni de breadcrumb.

- [ ] **Step 2 : Styles toolbar**

Porter dans `style.css` les règles `header`/`.hgroup`/`.tb-btn`/`.tb-btn[data-tip]:hover::after`/`.tb-brand*` du playground (adapter le sélecteur racine `.tb` → `header`). Garder `.dev-pill` (déjà présent) ; ajuster sa couleur au thème si besoin. Le bouton primaire (`#push`) garde `.primary` → style ambre plein.

- [ ] **Step 3 : Vérif navigateur (fonctionnel + visuel)**

Recharger. Attendu : toolbar compacte en icônes, tooltips au survol, marque à gauche, champ URL + pastille à droite. **Tous les boutons fonctionnent toujours** (clic Undo/Redo, Charger, Pousser, ⚙ ouvre le tiroir, etc.) puisque les ids sont préservés. `node --test` vert.

- [ ] **Step 4 : Commit**

```bash
git add designer/index.html designer/style.css
git commit -m "feat(designer): toolbar iconographique (groupes + tooltips, câblage inchangé)"
```

---

## Task 5 : Palette en bande d'icônes (libellé → tooltip)

**Files:**
- Modify: `designer/js/palette.js` (rendu des items)
- Modify: `designer/style.css` (`.palette-*`)

- [ ] **Step 1 : Mettre le libellé en tooltip, retirer le texte permanent**

Dans `palette.js`, là où chaque `.palette-item` est créé (svg + `<span>label`), ajouter `item.title = label;` (tooltip natif) et **ne plus ajouter le `<span>` de libellé** (ou le marquer pour masquage CSS). Conserver `draggable="true"`, `data-type`, et toute la logique de drag (inchangée). Retirer/masquer aussi `.palette-hint` (la bande icône n'a pas la place du texte d'aide).

- [ ] **Step 2 : Styles bande icône**

Remplacer les règles `.palette-list`/`.palette-item`/`.palette-icon`/`.palette-hint` (style.css 244-257) par l'équivalent « bande » du playground (`.palette` + `.pal-item` 36×36, tooltip latéral `::after`, `.pal-sep`). Mapper les classes : soit renommer dans `palette.js` (`palette-item`→`pal-item`), soit appliquer le style maquette directement sur `.palette-item`/`.palette-list`. **Choix retenu : garder les classes `palette-*` existantes** et leur appliquer le style bande (moins de churn JS). Items en colonne unique centrée (largeur 44px), icône 18px, libellé via `title`.

- [ ] **Step 3 : Vérif navigateur**

Recharger. Attendu : palette = bande verticale d'icônes (44px), tooltip = nom du composant au survol, **drag d'un type vers le canvas crée toujours le composant** (logique intacte). `node --test` vert.

- [ ] **Step 4 : Commit**

```bash
git add designer/js/palette.js designer/style.css
git commit -m "feat(designer): palette en bande d'icônes (libellés en tooltip)"
```

---

## Task 6 : Champs numériques à glisser (numeric-drag) — le point sensible

**Files:**
- Create: `designer/js/numdrag.js` (fonction PURE `numDragValue`)
- Create: `designer/tests/numdrag.test.js`
- Modify: `designer/js/inspector.js` (import `numDragValue` + helper DOM `attachNumDrag` + appel dans `makeInput` kind `'num'`, ≈ lignes 37-71 ; `model` est déjà importé dans ce module)
- Modify: `designer/style.css` (`.insp-row input[type="number"]`)

**Principe :** on isole l'arithmétique en fonction **pure** (`numDragValue`, testée en `node`, convention maison) et on garde le DOM dans `inspector.js`. Le helper se greffe sur l'`<input type="number">`. Glissé horizontal > seuil → calcule la valeur via `numDragValue` et appelle l'`onChange` applicatif (qui committe déjà avec `{coalesce:'num'}`) → **une session de drag = une seule entrée d'undo**. Au relâché → `model.breakCoalesce()` (clôt la session, exactement comme le `focusout` ligne 113). Sous le seuil → **clic** → édition texte normale (aucun commit).

- [ ] **Step 1 : Écrire le test (échouant) de la fonction pure**

Créer `designer/tests/numdrag.test.js` :

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numDragValue } from '../js/numdrag.js';

test('numDragValue : 1px = 1 unité', () => {
  assert.equal(numDragValue(60, 0, false), 60);
  assert.equal(numDragValue(60, 5, false), 65);
  assert.equal(numDragValue(60, -8, false), 52);
});
test('numDragValue : Shift = pas de 10', () => {
  assert.equal(numDragValue(60, 3, true), 90);     // 3px × 10
  assert.equal(numDragValue(60, -2, true), 40);
});
test('numDragValue : arrondit le delta fractionnaire', () => {
  assert.equal(numDragValue(0, 2.6, false), 3);
  assert.equal(numDragValue(0, 2.4, false), 2);
});
test('numDragValue : base non numérique traitée comme 0', () => {
  assert.equal(numDragValue(NaN, 4, false), 4);
});
```

- [ ] **Step 2 : Lancer les tests → vérifier l'échec**

Run : `cd designer && node --test`
Expected : ÉCHEC sur `numdrag.test.js` (« Cannot find module '../js/numdrag.js' » ou export manquant).

- [ ] **Step 3 : Implémenter la fonction pure minimale**

Créer `designer/js/numdrag.js` :

```javascript
// Valeur d'un champ numérique sous glisser-horizontal : 1px = 1 unité (×10 avec Shift), delta arrondi.
// Pur (testé node) ; le DOM est dans inspector.js (attachNumDrag).
export function numDragValue(startVal, dxPx, shift) {
  const base = Number.isFinite(startVal) ? startVal : 0;
  const step = shift ? 10 : 1;
  return base + Math.round(dxPx) * step;
}
```

- [ ] **Step 4 : Lancer les tests → vérifier le succès**

Run : `cd designer && node --test`
Expected : tout vert (y compris `numdrag.test.js`).

- [ ] **Step 5 : Helper DOM `attachNumDrag` dans `inspector.js`**

Ajouter l'import en tête : `import { numDragValue } from './numdrag.js';`
Puis, au niveau module (avant `makeInput`) :

```javascript
// Glisser-horizontal sur un champ numérique = ±valeur (façon Blender). Sous 3px = clic (édition texte).
// Pendant le glissé : onChange à chaque pas (commits coalescés via {coalesce:'num'} côté appelant) ;
// au relâché : breakCoalesce() pour clore la session d'undo (parité avec le focusout des champs num).
function attachNumDrag(el, onChange) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startVal = Number(el.value) || 0;
    let moved = false;
    const move = ev => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;   // seuil : laisse passer le clic-pour-éditer
      moved = true;
      ev.preventDefault();
      const v = numDragValue(startVal, dx, ev.shiftKey);
      el.value = String(v);
      onChange(v);                               // commit coalescé (l'appelant passe {coalesce:'num'})
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) model.breakCoalesce();          // clôt la session = 1 entrée d'undo
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}
```

- [ ] **Step 6 : Brancher le helper sur le champ `'num'` de `makeInput`**

Dans `makeInput`, la branche `kind === 'num'` (lignes 57-60). Après le listener `change` existant, ajouter l'appel au helper en lui passant le **même** `onChange` applicatif :

```javascript
  } else if (kind === 'num') {
    el = document.createElement('input'); el.type = 'number'; el.value = value ?? '';
    if (placeholder != null) el.placeholder = String(placeholder);
    el.addEventListener('change', () => onChange(el.value === '' ? '' : Number(el.value)));
    attachNumDrag(el, v => onChange(v));   // ← NOUVEAU : glissé = ±valeur, commits coalescés
  }
```
(L'`onChange` reçu par `makeInput` est le callback applicatif qui fait `model.commit(..., {coalesce:'num'})` — cf. inspector.js:130/542. Le helper l'appelle avec un nombre, donc la coalescence joue déjà.)

- [ ] **Step 7 : Style d'affordance (barre ambre + curseur ew-resize)**

Dans `style.css`, ajouter :

```css
/* Champs numériques : affordance "drag" (barre ambre à gauche + curseur ew-resize). */
.insp-row input[type="number"] { cursor: ew-resize; border-left: 3px solid var(--accent); }
.insp-row input[type="number"]:focus { cursor: text; }
```

- [ ] **Step 8 : Vérif navigateur — drag = 1 undo (invariant critique)**

Servir depuis la racine. Sélectionner un composant, ouvrir l'inspecteur. Tester :
1. **Glisser** sur un champ numérique (p. ex. position dx, ou width) → la valeur change en live, le composant bouge sur le canvas. **Relâcher**, puis **Ctrl+Z une seule fois** → la valeur revient à l'état AVANT le drag (pas pas-à-pas). ✅ = invariant coalescence respecté.
2. **Clic simple** (sans bouger) sur le même champ puis taper au clavier → édition texte normale, commit au blur. ✅
3. Changer de sélection, rejouer : pas de commit sur le mauvais composant (closures figées au rendu). ✅
`node --test` vert ; `git diff` ne montre que `numdrag.js`, `numdrag.test.js`, `inspector.js`, `style.css`.

- [ ] **Step 9 : Commit**

```bash
git add designer/js/numdrag.js designer/tests/numdrag.test.js designer/js/inspector.js designer/style.css
git commit -m "feat(designer): champs numériques à glisser (1 session = 1 undo)"
```

---

## Task 7 : Inspecteur — affordance « Source » + en-tête contextuel restylé

**Files:**
- Modify: `designer/js/inspector.js` (rendu de la ligne `bind` « Variable (pull) »)
- Modify: `designer/style.css` (`.insp-head`, `.insp-row`, nouvelle classe `.insp-source`)

- [ ] **Step 1 : Distinguer visuellement la ligne `bind`**

Dans `inspector.js`, repérer la génération du champ `bind` (label « Variable (pull) », `kind 'asciitext'`, présent dans les `compFields` de `registry.js`). Marquer sa ligne d'une classe dédiée pour le style « Source » : sur la `fieldRow` correspondant à `key === 'bind'`, ajouter `row.classList.add('insp-source')` (ou passer une option à `fieldRow`). Préfixer le libellé d'un picto chaîne `⛓` (texte, pas d'asset). **Comportement texte inchangé** (toujours `asciitext`, même commit).

- [ ] **Step 2 : Styles**

Porter le style de l'en-tête contextuel (`.insp-head` : type en mono ambre + nom en display) et de la rangée Source depuis le playground :

```css
.insp-source .insp-label { color: var(--accent); }
.insp-source input { border-left: 3px solid var(--accent-soft); }
```
(Affiner au diff visuel avec le playground.)

- [ ] **Step 3 : Vérif navigateur**

Recharger. Attendu : la ligne « Source ⛓ » se distingue dans l'inspecteur ; éditer la variable committe comme avant. En-tête `Composant · <Type>` lisible. `node --test` vert.

- [ ] **Step 4 : Commit**

```bash
git add designer/js/inspector.js designer/style.css
git commit -m "feat(designer): inspecteur — affordance Source + en-tête contextuel"
```

---

## Task 8 : Sections repliables de l'inspecteur

**Files:**
- Modify: `designer/js/inspector.js` (regrouper les rangées en sections `<div class="section">` avec en-tête cliquable)
- Modify: `designer/style.css` (`.section`, `.section-h`, `.section-b`, `.caret`)

**Principe :** purement **structurel** — on enveloppe les rangées existantes dans des conteneurs de section avec un en-tête qui bascule `.collapsed`. La génération des champs (makeInput, commit, coalesce) est **inchangée** : on ne fait que les répartir dans des sections. Sections suggérées : *Identité*, *Géométrie* (placement), *<Type>* (champs spécifiques), *Style*. Pour limiter le risque, regrouper a minima (p. ex. *Géométrie* = placement, *Propriétés* = compFields) plutôt qu'un re-séquençage fin.

- [ ] **Step 1 : Helper de section**

Dans `inspector.js`, ajouter un helper qui crée une section repliable et y verse des rangées :

```javascript
function section(title, collapsed = false) {
  const sec = document.createElement('div'); sec.className = 'section' + (collapsed ? ' collapsed' : '');
  const h = document.createElement('div'); h.className = 'section-h';
  const car = document.createElement('span'); car.className = 'caret'; car.textContent = '▾';
  h.appendChild(car); h.append(' ' + title);
  const body = document.createElement('div'); body.className = 'section-b';
  h.addEventListener('click', () => sec.classList.toggle('collapsed'));
  sec.appendChild(h); sec.appendChild(body);
  return { sec, body };
}
```

- [ ] **Step 2 : Verser les rangées existantes dans des sections**

Là où les rangées de composant sont actuellement `body.appendChild(row)` (rendu Composant), créer les sections et appendre dans `section(...).body` au lieu du body racine, puis appendre les `.sec` au conteneur. Conserver l'ordre et **tous** les `fieldRow`/inputs tels quels. Replier *Style* par défaut (`section('Style', true)`).

- [ ] **Step 3 : Styles**

Porter `.section`/`.section-h`/`.section-b`/`.caret` + `.section.collapsed` du playground.

- [ ] **Step 4 : Vérif navigateur**

Recharger. Attendu : inspecteur en sections repliables ; cliquer un en-tête plie/déplie ; **tous les champs fonctionnent** (drag, couleur live, commit, undo) ; changement de sélection OK. `node --test` vert.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/inspector.js designer/style.css
git commit -m "feat(designer): inspecteur en sections repliables"
```

---

## Task 9 : Restyler le reste du chrome (calques, status bar, console, tiroir, overlay, carousel) + anneau décoratif

**Files:**
- Modify: `designer/style.css` (classes `.tree-*`, `.statusbar`/`.sb-*`, `.console-*`, `.drawer-*`, `.shot-*`, `.carousel`/`.caro-*`, `#canvas-col`, `.stage`)

**Principe :** **CSS uniquement** — les modules génèrent déjà ces classes (cf. cartographie). On aligne couleurs/typo/densité sur le thème et le playground. Aucune logique touchée.

- [ ] **Step 1 : Calques (arbre)** — porter le look `.tree-row`/`.tree-row.selected` (barre ambre à gauche, type en mono) du playground sur les classes `.tree-*` existantes ; garder `.tree-icon`, `.tree-ref`, `.tree-actions`, états drag `.drop-*`.

- [ ] **Step 2 : Status bar + console** — passer `.statusbar`/`.sb-*` et `.console-*` en mono compacte (capitales espacées), verdict de validation cliquable conservé (`.sb-valid.sb-ok/-warn/-err`), onglets console `.console-tab.active` en ambre.

- [ ] **Step 3 : Tiroir Device + overlay capture** — restyler `.drawer-*` (slide-over, onglets `.drawer-tab.active` ambre) et `.shot-*` au thème. Comportement (`hidden`) inchangé.

- [ ] **Step 4 : Carousel + canvas** — adapter `.caro-*` (anneau actif via `box-shadow` ambre — **garder box-shadow, pas border**, cf. invariant carousel), `#canvas-col` (halo ambre au lieu de violet), grille de fond optionnelle du canvas.

- [ ] **Step 5 : Anneau décoratif autour du disque** — ajouter un anneau ambre/segments autour de `.stage` **sans perturber la math de zoom** : via un pseudo-élément sur `.stage-wrap` (qui porte déjà la taille zoomée) ou un élément frère derrière `.stage`. Décoratif et statique. (Un anneau **reflétant le `led_ring`** configuré est **hors scope** — noté pour plus tard.)

```css
/* Anneau décoratif (signature device) — sur le wrap, derrière le disque ; ne capte pas le pointeur. */
.stage-wrap { position: relative; }
.stage-wrap::before {
  content: ""; position: absolute; inset: -10px; border-radius: 50%; pointer-events: none; z-index: 0;
  background: conic-gradient(from 220deg, var(--accent) 0 40deg, var(--line) 40deg 150deg,
              var(--ok) 150deg 175deg, var(--line) 175deg 330deg, var(--accent) 330deg 360deg);
  -webkit-mask: radial-gradient(circle, transparent calc(50% - 4px), #000 calc(50% - 4px));
          mask: radial-gradient(circle, transparent calc(50% - 4px), #000 calc(50% - 4px));
  opacity: .85;
}
.stage { z-index: 1; }
```

- [ ] **Step 6 : Vérif navigateur (passe complète)** — recharger ; parcourir : arbre (sélection, drag, menu contextuel, œil), status bar (validation cliquable → console), console (Problèmes/Source/Copier), tiroir (⚙ ouvre, onglets, Échap ferme), capture (overlay), carousel (clic page, +page, flèches, halo centré). **Vérifier l'invariant anneau** : un clic au centre du disque (zone vide) **désélectionne** (l'anneau ne capte que ses parties peintes). `node --test` vert.

- [ ] **Step 7 : Commit**

```bash
git add designer/style.css
git commit -m "feat(designer): restyle calques/statusbar/console/tiroir/overlay/carousel + anneau décoratif"
```

---

## Task 10 : Vérification finale (parité, invariants, garde firmware)

**Files:** aucun (vérification).

- [ ] **Step 1 : Tests logiques** — `cd designer && node --test` → **tout vert** (aucune régression de fonction pure).

- [ ] **Step 2 : Garde-parité** — depuis la racine :
```bash
git diff --name-only main -- src lib schema designer/js/render.js
```
Expected : **sortie vide** (zéro fichier firmware/parité touché sur toute la branche).

- [ ] **Step 3 : Parité navigateur (Playwright/Chromium, sans intervention)** — servir depuis la racine en no-store ; pour ≥3 layouts variés (dont l'`default-layout` et un riche en composants) : le rendu du disque est **identique** à `main` (capturer avant/après). Vérifier explicitement les invariants : (a) couleur committée sur `change`, champ vidé → clé supprimée ; (b) **drag numérique = 1 undo** ; (c) blur-avant-changement de sélection (éditer A puis cliquer B : l'édition part sur A, pas B) ; (d) anneau hit-test (clic centre vide = désélection). Envoyer les captures.

- [ ] **Step 4 : Réflexe `uploadfs`** — NE PAS flasher dans le cadre de ce plan. Noter pour l'utilisateur : le designer **embarqué** ne sera à jour qu'après `bash tools/stage_fs.sh` + `pio run -e esp32s3 -t uploadfs` — et **`uploadfs` efface les assets device** (sauvegarder avant). Hors scope d'implémentation.

- [ ] **Step 5 : Mettre à jour le HANDOFF** — consigner l'état (branche, ce qui est fait/vérifié, reste : décision merge/PR, e2e on-device) dans `docs/_internal/HANDOFF.md`.

- [ ] **Step 6 : Commit final / récap** — s'assurer que l'arbre est propre (hors artefacts non suivis connus), récapituler les commits de la branche.

---

## Couverture spec → tâches (auto-revue)

| Exigence spec | Tâche |
|---|---|
| Palette ambre verbatim | T2 |
| Polices Atelier embarquées (offline) | T1 |
| Échelle ×1,15 | T2 |
| Disposition 4 colonnes | T3 |
| Toolbar iconographique, pas de Preview/breadcrumb | T4 |
| Palette icône + tooltips | T5 |
| Champs drag (1 session = 1 undo) | T6 |
| Affordance Source ⛓ | T7 |
| Sections repliables | T8 |
| Status bar / console / tiroir / overlay / carousel restylés | T9 |
| Anneau (décoratif ; live = hors scope) | T9 |
| `render.js` / firmware / schéma intacts | garde-parité à chaque tâche + T10 |
| Invariants inspecteur/canvas non régressés | T6, T8, T9, T10 |

**Note d'altitude :** ce plan est un réskin (CSS/DOM) ; l'essentiel n'est pas testable en `node` → la vérif repose sur le navigateur + `node --test` comme garde anti-régression + le garde-parité `git diff`. Seul **vrai** ajout de code : le helper numeric-drag (T6).
