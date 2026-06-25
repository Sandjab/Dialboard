# Panneau Settings du designer (v1)

- **Date** : 2026-06-25
- **Branche** : `feat/designer-settings-panel`
- **Statut** : design validé (brainstorm), spec à relire avant plan d'implémentation
- **Scope** : v1 = panneau + transparence des invisibles + grille/snap + Nouveau/Réinit layout + Réinit réglages. Densité UI, thèmes multiples et garde-fous destructifs **hors-scope**.

## Problème

Le designer n'a aujourd'hui **aucun panneau de réglages**. Quelques préférences d'édition
existent mais sont soit figées en dur, soit éparpillées :

- L'aperçu « fantôme » d'un composant `visible:false` est rendu avec une opacité **figée à
  `.38`** (`canvas.js:113` pose la classe `hidden` ; `style.css:250` `.w.hidden { opacity: .38 }`).
  Impossible à ajuster.
- Aucune **grille** ni **magnétisme** pour aligner les composants sur le canvas : le placement
  est libre au pixel.
- Aucun bouton **« Nouveau »** : on ne peut pas repartir d'un layout vierge sans vider le
  localStorage à la main (l'autosave restaure toujours le dernier brouillon).

Objectif : un **panneau Settings** unique (tiroir latéral) qui regroupe ces réglages d'édition,
les **persiste** entre sessions, et ajoute le snap-grille comme aide d'alignement.

## État vérifié (source de vérité)

### Toolbar & tiroir (`index.html`, `js/drawer.js`)
- Toolbar **tout-icônes**, groupée : Fichier local (Export/Import) · Historique (Undo/Redo) ·
  Device (Charger/Pousser/Valeurs/Statut/Capture) · **⚙ tiroir Device** (`#drawer-toggle`) ·
  URL device + pastille à droite. L'**engrenage ⚙ est déjà pris** par le tiroir Device.
- `createDrawer(root, { toggleBtn })` (`drawer.js`) : slide-over droit, `open/close/toggle` via
  `root.hidden`, fermeture ✕/backdrop/**Échap**. Markup `#drawer` dans `index.html`
  (`.drawer-backdrop`, `.drawer-panel`, `.drawer-head`, `.drawer-tabs`).

### Persistance existante (`js/app.js`)
- Autosave du brouillon : `SAVE_KEY` (`app.js:56-63`) — restauré au boot, réécrit à chaque
  `model.subscribe`. Zoom : `ZOOM_KEY` (`app.js:261-263`). URL device : `BASE_KEY`
  (`app.js:270-273`). Clés préfixées `rt-designer-*`.

### Densité / `--scale` (constat qui exclut la densité de la v1)
- `:root` définit `--scale: 1.15` commentée « échelle de densité du chrome, figée ». Mais
  `var(--scale)` n'apparaît **qu'une seule fois** dans `style.css` (`.tb-brand-name`, ligne 45).
  La variable est donc **quasi inerte** : un curseur dessus ne redimensionnerait rien de visible.
  Brancher une vraie densité = refactor CSS étendu (ou hack `zoom`) → **chantier DA, reporté**.

### Placement & snap dans le canvas (`js/canvas.js`)
- Placement : `placeAt(anchor, dx, dy, w, h)` (`geometry.js`). Un **snap aux 9 ancres** existe
  déjà (overlay guide `createGuide`, `canvas.js:19-22`).
- Drag (`onPointerDown`, `canvas.js:149+`) : calcule `live.dx`/`live.dy` en coords device
  (division par l'échelle de zoom `s`), commit au **drop** (`q.dx = live.dx; q.dy = live.dy`).
- Resize : adaptateurs `{start, preview, commit}` via `addResizeHandles` ; tailles calculées par
  `resizeBox(startW, startH, dx, dy, 8)` et `placementResize`, **min 8** (`Math.max(8, …)`).
- `#stage-wrap` contient `#led-ring` (overlay `pointer-events:none`) et `#stage`.

### Layout par défaut (`js/default-layout.js`)
- Source du layout vierge pour l'action « Nouveau ».

## Décisions (brainstorm)

- **Forme** : tiroir latéral, **mêmes mécaniques que le tiroir Device** (slide-over droit,
  backdrop, Échap). Distinct du tiroir Device ; **un seul tiroir ouvert à la fois** (ouvrir l'un
  ferme l'autre).
- **Icône** : **curseurs** (sliders) dans la toolbar — pas l'engrenage, déjà pris par Device.
- **Grille + snap** : grille **affichable** (toggle) + snap **au pas** sur placement ET resize.
  Affichage et snap sont des **toggles indépendants** partageant le même pas. Pas de repères
  inter-composants (smart guides) en v1.
- **Hors-scope explicite** : densité/échelle UI (chantier DA), thèmes multiples (un seul suffit),
  garde-fou Pousser — ce dernier rejoint le futur lot **« garde-fous destructifs »** (Pousser /
  Pull / suppression de page), traité uniformément ailleurs.

### Défauts retenus (réglages)
- **Transparence invisibles** : curseur 0–1, **défaut `.38`** (valeur actuelle → zéro changement
  visuel au boot).
- **Grille** : toggle affichage **OFF** par défaut ; pas ∈ {5, 10, 20} px (coords device),
  **défaut 10**. Les pas sont des **diviseurs de 180** (les ancres parent sont en {0, 180, 360}) →
  un composant snappé tombe **sur les lignes de grille pour toutes les ancres** (sinon, avec 8/16,
  décalage de ~4 px pour les ancres CENTER/MID, car 180 n'est pas multiple de 8/16). Ajustement
  post-implémentation (cf. commit « pas de grille = diviseurs de 180 »).
- **Snap** : toggle **OFF** par défaut (aucune surprise de placement) ; partage le pas de la
  grille ; arrondit même si la grille est masquée.
- **Nouveau / Réinitialiser layout** : **confirmation inline** (le bouton devient « Confirmer ? »
  ~3 s), **pas** de dialog natif. Ce n'est pas le lot « garde-fous » différé.

## Architecture & modules

### `js/settings.js` (neuf)
Partie **pure (testée node)** :
- `defaultSettings()` → `{ ghostOpacity: 0.38, gridShow: false, gridSnap: false, gridStep: 10 }`.
- `normalizeSettings(raw)` : merge sur les défauts + **clamp** (opacité bornée 0–1 ; `gridStep`
  contraint à {5,10,20}, sinon défaut ; toggles coercés en booléens). Tolère un objet partiel ou
  invalide.
- `loadSettings()` / `saveSettings(s)` : localStorage `rt-designer-settings`, JSON corrompu →
  `defaultSettings()` (jamais de throw qui casse le boot).

Partie **DOM** :
- `createSettings(root, { getSettings, setSettings, onNewLayout })` : monte les contrôles dans le
  volet du tiroir (curseur opacité, toggle grille, toggle snap, select pas, bouton « Nouveau »
  avec confirmation inline, bouton « Réinitialiser les réglages »), câble les changements →
  `setSettings(partial)` (persiste + applique en live).
- `applyVisualSettings(s)` : pose `--ghost-opacity` sur `:root` et la classe d'affichage de
  grille + variable de pas sur `#stage-wrap`. Appelée au boot et à chaque changement.

### `js/geometry.js`
- Ajout de `snapValue(v, step, enabled)` **pur** : `enabled && step>0` → `Math.round(v/step)*step`,
  sinon `v`. Testé node.

### `js/canvas.js`
- `createCanvas(..., { getGridSnap })` reçoit un accès lecture à `{ snap, step }`. Le drag et les
  adaptateurs de resize appliquent `snapValue` :
  - drag : `live.dx = snapValue(rawDx, step, snap)` (idem `dy`) ;
  - resize : `w/h` arrondis au pas (le **min 8** reste appliqué après le snap).
- Calque grille : overlay dans `#stage-wrap`, `pointer-events:none` (même invariant que
  `#led-ring`), rendu par CSS (background lignes au pas), togglé par classe.

### `index.html`
- Bouton toolbar `#settings-toggle` (icône curseurs) dans un nouveau `tb-group`.
- Tiroir `#settings-drawer` calqué sur `#drawer`, **sans onglets** (un seul volet `#settings-pane`).

### `style.css`
- `--ghost-opacity: .38` dans `:root` ; `.w.hidden { opacity: var(--ghost-opacity) }`.
- Styles de grille (overlay `#stage-wrap` au pas via variable CSS).
- Styles du tiroir Settings : **réutilise** `.drawer*` ; ajouts mineurs pour les contrôles.

### `js/app.js`
- Au boot : `const settings = normalizeSettings(loadSettings()); applyVisualSettings(settings)`.
- Monte `createSettings(...)` ; `setSettings` met à jour l'état, `saveSettings`, `applyVisualSettings`
  et (pour grille/snap) le canvas relit l'état au prochain geste.
- **Un seul tiroir** : `settings.open()` appelle `deviceDrawer.close()` et réciproquement.
- « Nouveau » : `onNewLayout` → `model.loadJSON(defaultLayout())` → reset page active + sélection
  (l'autosave existant réécrit `SAVE_KEY` via le `subscribe`).

## Flux de données

```
boot ──▶ loadSettings() ─▶ normalizeSettings ─▶ applyVisualSettings(--ghost-opacity, grille)
                                              └▶ canvas lit {snap, step}

réglage modifié ─▶ setSettings(partial) ─▶ saveSettings (localStorage)
                                        └▶ applyVisualSettings (live)
                                        └▶ prochain drag/resize : canvas relit {snap, step}

« Nouveau » ─▶ confirmation inline ─▶ model.loadJSON(default) ─▶ reset vue
« Réinit réglages » ─▶ defaultSettings() ─▶ saveSettings + applyVisualSettings
```

## Parité & firmware

- **100 % designer.** `src/`, `lib/`, `schema/` et `js/render.js` (moteur de parité) **intacts**.
- Le snap n'écrit que des `dx/dy/w/h` **légitimes** (valeurs de layout normales) → le firmware les
  rend à l'identique : **aucune divergence de parité**.
- Grille et opacité fantôme sont des **aides d'édition** : jamais sérialisées dans le layout, ni
  envoyées au device.

## Tests & vérifs

- `node --test` :
  - `snapValue` : arrondi au pas (sens haut/bas), `enabled:false` = identité, `step:0` garde-fou
    (retourne `v`), valeurs négatives.
  - `normalizeSettings` : clamp opacité, `gridStep` invalide → défaut, JSON corrompu/partiel →
    défauts mergés.
- Pas de test DOM (convention projet : DOM pur non testé node).
- Navigateur (no-store) : ouverture/fermeture du tiroir, **un seul tiroir ouvert**, opacité live,
  grille affichée au bon pas, **snap effectif** (placement/resize arrondis), « Nouveau »
  (confirmation inline → layout vierge), « Réinit réglages » (retour aux défauts).

## Hors-scope (reporté)

- Densité / échelle de l'UI (chantier DA : refactor `--scale` ou `zoom`).
- Thèmes multiples (création d'un 2e thème = DA).
- Garde-fous destructifs (Pousser / Pull / suppression de page) → lot uniforme dédié.
- Smart guides (repères d'alignement inter-composants).
