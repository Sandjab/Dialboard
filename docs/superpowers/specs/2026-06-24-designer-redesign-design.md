# Redesign visuel du designer Dialboard — Design

> Date : 2026-06-24 · Branche : `feat/designer-redesign`
> Issu d'un brainstorm à partir d'une maquette externe (`~/Downloads/Dialboardtest.html`) et d'un playground itératif (`dialboard-designer-playground.html`).

## Objectif

Refondre **l'apparence et la disposition** du designer web (le *chrome* de l'éditeur), en s'inspirant d'une maquette « noir chaud + ambre », **sans toucher au moteur de rendu de parité ni au firmware**. Le rendu des composants *dans le disque* reste identique au pixel près (parité firmware préservée).

## Contexte

La maquette de référence décrit en réalité un **éditeur LVGL générique** (écran unique 240×240, vocabulaire `lv_label`/`LV_ALIGN_*`, widgets interactifs Button/Slider/Switch, bouton *Preview*, *breadcrumbs*, export LVGL). Dialboard est un dashboard **config-driven** : 360×360 rond, pages multiples, composants curatés en **lecture** (valeurs poussées via `POST /update` ou tirées via *sources pull*), anneau RGB physique. On reprend donc **la peau** (couleurs, densité, langage visuel) et on **remappe le contenu** sur le vrai vocabulaire Dialboard.

## Décisions verrouillées (issues de l'échange)

- **Palette de couleurs** : reprise **verbatim** des tokens de la maquette (voir §3).
- **Polices** : jeu **« Atelier »** — `Space Grotesk` (display) / `Inter` (UI) / `JetBrains Mono` (mono).
- **Taille de base** : **× 1,15** (115 %) par rapport à la maquette — figée (`--scale: 1.15`), pas de réglage runtime.
- **Disposition** : 4 colonnes — palette icône `44px` · calques `220px` · canvas `1fr` · inspecteur `300px`.
- **Champs drag** : **oui**, tous les champs numériques deviennent glissables (clic-glisser horizontal = ±valeur ; clic simple = édition texte).
- **Affordance Source** : le champ `bind` (« Variable (pull) ») est **élevé** en rangée « Source » `⛓` visuellement distincte (comportement texte inchangé).

## 1. Périmètre

**Touché (chrome de l'éditeur uniquement) :**
- `designer/index.html` — structure DOM (toolbar, grille 4 colonnes, conteneurs).
- `designer/style.css` — thème complet (tokens, composants, layout).
- Modules produisant le chrome : la toolbar (`app.js`), `palette.js`, `tree.js`, `inspector.js`, `statusbar.js`, `console.js`, `drawer.js`.
- **Nouveau** : un helper `numeric-drag` (glisser sur un champ numérique), réutilisable par l'inspecteur.

**Intact (non touché) :**
- `designer/js/render.js` — **moteur de parité** : rend les composants dans le disque comme le firmware. Aucun changement de style d'éditeur n'y touche.
- Firmware (`src/`, `lib/`), `schema/layout.schema.json`. **Zéro diff attendu** côté device.

**Seul ajout fonctionnel** : les champs drag. Le reste est thème + réagencement (markup/CSS).

## 2. Disposition

Rangées (de haut en bas) :
1. **Toolbar** (`--tb-h`, 42px) — voir §4.
2. **Body** — grille 4 colonnes : `44px 220px 1fr 300px` (largeurs en variables CSS, comme l'existant `--dock-w`/`--insp-w`). Chaque colonne **scrolle indépendamment** (`overflow` par colonne) → règle le défaut « le scroll vertical global masque le canvas » identifié en critique DA.
3. **Console** repliable (pleine largeur) — conservée, restylée au thème.
4. **Status bar** (`--status-h`, 24px) — voir §6.

Hors-flux :
- **Drawer Device** : slide-over latéral droit, ouvert par le bouton **⚙** de la toolbar. Conservé (onglets *Sorties physiques* / *Sources pull*), restylé.
- **Overlay capture écran** : modal. Conservé, restylé.

## 3. Thème & tokens

Tokens de couleur **verbatim** :

```
--bg:#0E0E0E; --panel:#161616; --panel-2:#1F1F1F; --panel-3:#252525; --input:#0A0A0A; --canvas:#131313;
--border:#2A2A2A; --border-2:#3A3A3A;
--accent:#FF9F40; --accent-hover:#FFB84D; --accent-dim:rgba(255,159,64,.10); --accent-soft:rgba(255,159,64,.18);
--text:#F4F1E8; --text-dim:#A8A29E; --text-mute:#6B6864; --text-label:#BFBAB0;
--ok:#6FCF97; --warn:#E6B450; --err:#E06C5A;
```

Polices (jeu Atelier) :
```
--f-display:"Space Grotesk", sans-serif;
--f-ui:"Inter", -apple-system, sans-serif;
--f-mono:"JetBrains Mono", ui-monospace, monospace;
```
Embarquées dans LittleFS (offline sur le device) — à vendoriser dans `designer/vendor/fonts/` (woff2), comme Montserrat aujourd'hui. **Pas de dépendance Google Fonts à l'exécution.**

Tailles : `--scale:1.15` ; tokens en `calc(base × var(--scale))` — base maquette `--fs:11px`, `--fs-title:10px`, `--fs-val:11px`, `--row-h:24px` (soit effectif ≈ 12,7 / 11,5 / 12,7 / 27,6 px). `--radius:2px`.

Convention d'usage (comme la maquette) : **mono en capitales espacées** pour les en-têtes de colonnes/sections et la status bar ; **display** pour la marque, le nom du composant sélectionné et les valeurs numériques d'affichage ; **UI** pour le reste.

## 4. Toolbar iconographique

Marque (anneau + « DIALBOARD » mono espacé) puis groupes séparés par des filets verticaux :
- **Fichier** : Nouveau · Importer JSON · Exporter JSON.
- **Historique** : Annuler · Rétablir.
- **Device** : Charger (`GET /layout`) · Pousser (`POST /layout`) · Valeurs test (`POST /update`) · Statut (`GET /status`) · Capture écran (`GET /screenshot`).
- **⚙ Device** : ouvre le drawer.
- À droite : **champ URL device** + **pastille** `● <ip>` / `○ non vérifié`.

Boutons **icône + tooltip** (le libellé vit dans le tooltip). **Écartés** : bouton *Preview* (le canvas est déjà le WYSIWYG ; le « live » = Pousser/Valeurs test/Capture), *breadcrumb* (remplacé par `nom de page · n/total` dans le coin du canvas).

## 5. Palette (icône) + Calques

- **Palette** (44px) : bande verticale d'icônes, **sans libellé permanent** (tooltips au survol), regroupée par familles (Données / Image / Formes) via mini-séparateurs + capsules mono. Composants réels : `label`, `readout` (Lecture), `bar`, `ring` (Anneau), `chart` (Graphe), `meter` (Jauge), `led`, `icon`, `image`, `image_anim`, `rect`, `circle`, `line`.
- **Calques** (220px) : arbre Document → pages → composants (z-order inversé), œil de visibilité, type en mono. Fonctions et comportements existants (drag&drop, rename, menu contextuel) **conservés** — seul le style change.

## 6. Canvas, status bar

- **Canvas** : fond atelier sombre + grille discrète ; disque **360×360** centré avec **anneau RGB physique** rendu autour du biseau (signature Dialboard, absente de la maquette) ; **carousel** de vignettes de pages en bas (conservé) ; contrôle de **zoom** en bas-droite (display-only, comme aujourd'hui). Coin haut-gauche : `nom de page · n/total`.
- **Status bar** : `● PRÊT` · contexte de sélection · verdict de validation **cliquable** (→ console Problèmes) · zoom · `LVGL 9.5` · pastille device. Reprend les fonctions actuelles, redensifiées en mono.

## 7. Inspecteur (point sensible)

- En-tête `Composant · <Type>` + **id** (contextuel : Document / Page / Composant comme aujourd'hui).
- **Sections repliables** (Identité, Géométrie, puis sections par type, Style).
- **Champs drag** (nouveau) : tout champ numérique (`num`). Clic-glisser horizontal = incrément ; **clic simple = édition texte** ; barre ambre à gauche comme signe d'affordance ; x/y colorés (rouge/vert).
- **Affordance « Source » `⛓`** : rangée dédiée pour `bind` ; comportement texte libre inchangé.

**Invariants à NE PAS régresser** (cf. `CLAUDE.md` « invariants inspecteur/canvas ») :
- Commit sur `change`, pas par frappe (couleur : aperçu live `input` hors modèle, commit `change` ; champ vidé → clé supprimée).
- Les closures de commit **figent `sel.ref` au rendu**.
- `inspector.select` fait `blur()` du champ focalisé **avant** de changer `sel`.
- Champs numériques : **commits coalescés par session** (`model.commit(_, {coalesce})` + `breakCoalesce()` au blur). → **Une session de drag = une seule entrée d'undo** (même garantie que flèches/spinner aujourd'hui ; le relâché du drag déclenche `breakCoalesce()`).
- Anneau : `pointer-events` limités aux parties peintes.

## Explicitement hors scope / écarté

- **De la maquette** : bouton *Preview*, breadcrumbs, vocabulaire LVGL brut, widgets interactifs (Button/Slider/Switch/Container), export LVGL, format 240×240.
- **Reporté** : docks **redimensionnables** (Lot 2 carousel, séparateurs + persistance `localStorage`) ; passe DA typo avancée au-delà du jeu choisi ; tout changement firmware/parité.

## Critères de succès (vérification)

- `cd designer && node --test` **vert** (fonctions pures inchangées ; aucune régression de logique).
- **Parité navigateur** (Playwright) : rendu fidèle du disque + anneau ; sélection arbre↔canvas ; **champ drag = une seule entrée d'undo** ; pastille Source ; sections repliables ; console/drawer/overlay fonctionnels.
- Invariants inspecteur/canvas ci-dessus **non régressés** (vérif ciblée : couleur commit-on-change, blur-before-select, ref figée, anneau hit-test).
- **`git diff` montre zéro changement** sous `src/`, `lib/`, `schema/`, et `designer/js/render.js`.

## Risques

- **Câblage des champs drag** sur la coalescence d'undo : c'est le seul vrai risque comportemental. Mitigation : réutiliser le mécanisme `commit({coalesce})`/`breakCoalesce()` déjà éprouvé pour les flèches/spinner.
- **Densité 115 % + largeurs fixes** : vérifier que les libellés d'inspecteur et l'arbre ne tronquent pas exagérément ; ajuster la colonne label si besoin (cosmétique).
