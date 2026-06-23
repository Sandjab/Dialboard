# Carousel de vignettes de pages — design

> Spec validée le 2026-06-23. Source de cadrage : brainstorming (décisions ci-dessous),
> look retenu validé sur maquette.
> Prochaine étape : plan d'implémentation (writing-plans).

## Motivation

Le designer gagne une **bande de vignettes de pages** sous le hero disque, dans la colonne
canvas. Chaque vignette est un **aperçu live miniature** de la page (rendu réel, pas une
capture). Elle offre une **navigation visuelle rapide** entre pages et reflète la nav
**horizontale** du device (swipes latéraux ; haut/bas réservés, `src/view.cpp:595`). Elle
**complète** l'arbre des calques (qui reste la vue structurelle pages+composants), sans le
remplacer — l'arbre avait déjà absorbé l'ancien `nav#pages` lors de la refonte IHM
(`designer/js/app.js:153`).

## Contexte technique vérifié (live source, 2026-06-23)

- **Dispatch de rendu centralisé** : le canvas construit chaque widget via
  `COMPONENTS[comp.type].build(comp, pl, getMock(pl.ref, comp.type))` (`designer/js/canvas.js:75`).
  `COMPONENTS` (`designer/js/registry.js`) porte aussi `.centered` et `.physical`. Les builders
  sont **purs et déjà exportés** (`designer/js/render.js:183-606` : `buildLabel`/`buildReadout`/
  `buildBar`/`buildRing`/`buildChart`/`buildMeter`/`buildImage`/`buildImageAnim`/`buildLed`/
  `buildRect`/`buildCircle`/`buildLine`/`buildIcon`). → **réutilisables tels quels** pour une
  miniature, sans extraction.
- **Positionnement** : `position()` (`canvas.js:78-92`) applique `placeAt(anchor, dx, dy, w, h)`
  (`designer/js/geometry.js`), avec cas `centered` (anneau : centré sur le rayon). Même règle
  réutilisable pour la miniature.
- **Mutations pages déjà présentes** (`designer/js/mutations.js`, importées par `tree.js:6`) :
  `addPage`, `duplicatePage`, `removePage`, `reorderPages`, `renamePage`, `movePlacementToPage`.
- **Menu contextuel déjà séparé** : `contextMenuItems(selection, state, { hasClipboard })`
  + `openMenu(x, y)` (`designer/js/tree.js:460-474`). Construction des items distincte de
  l'affichage → **extractible** vers un module partagé.
- **Sélection partagée** : `createSelection`/`setSelection` (`designer/js/selection.js`),
  `goPage` (défini dans `app.js`, déjà passé au canvas et à l'arbre). Le carousel emprunte le
  **même chemin** que l'arbre pour changer de page.
- **Re-render par abonnement** : canvas et arbre s'abonnent au modèle (`model.subscribe`) ;
  toute mutation déclenche un re-render. Le carousel suivra ce pattern → une seule source de
  vérité (le modèle).
- **Limite firmware dure** : `MAX_PAGES = 8` (`src/config.h:3`, tableau fixe
  `Page pages[MAX_PAGES]` `src/dashboard.h:127`), mirroir designer `LIM.pages = 8`
  (`designer/js/validate.js:27`). Au-delà, le layout est tronqué/rejeté au push.
- **Cibles DOM** : `#canvas-col`, `#stage-wrap`, `#stage` (`designer/index.html:49-56`).

## Décisions de cadrage (brainstorming, validées)

1. **Rôle = navigation visuelle rapide**, complément de l'arbre (pas un remplacement).
2. **Vignettes en rendu live** (réutilisent les builders ; toujours synchro avec l'édition,
   indépendantes du device). Pas de capture `/screenshot`.
3. **Interactions** : clic → page active ; **drag** → réordonner ; **clic-droit** → menu
   (Renommer / Dupliquer / Supprimer / Monter / Descendre) ; **« + page »** en fin de bande.
   Renommage **inline** (cohérent avec F2 de l'arbre).
4. **Présence = bande fixe**, toujours visible (même à une page).
5. **Défilement par flèches ◀ ▶**, déclenché par le **débordement de largeur** (pas par un
   plafond de vignettes). Flèches **grisées** quand tout est visible ou à une extrémité.
6. **Look A — disques device** : mini-disques ronds (~64-72 px) + **nom de page dessous** ;
   la vignette **active est agrandie de 10 %** (`scale(1.10)`) avec **halo violet** et nom en
   clair/gras. Cohérent avec le hero (écran rond, accent `--accent`).
7. **Architecture additive (approche A)** : nouveau module, l'arbre **inchangé** ; logique
   partagée (mutations + menu), pas de duplication.

## Architecture & modules

- **Nouveau** `designer/js/carousel.js` →
  `createCarousel({ host }, model, { selection, setSelection, goPage })`.
  S'abonne au modèle ; rend la bande ; câble clic / drag / menu / « + page ».
- **Nouveau** `designer/js/contextmenu.js` : on y déplace `contextMenuItems` + `openMenu`
  (extraits de `tree.js`, refactor non destructif). `tree.js` **et** `carousel.js` l'importent.
  *(Le menu pages réutilise les mêmes items que l'arbre ; Monter/Descendre y sont ajoutés.)*
- **`render.js`** gagne `buildPageStatic(page, comps, mockFor)` : rend une page entière en
  read-only dans un mini-stage 360×360 (mêmes builders via `COMPONENTS[type].build` + même
  positionnement `placeAt`/`centered` que le canvas), **sans** preview live, events, ni
  poignées. Le carousel scale ce mini-stage (`transform: scale(d/360)`) et le clippe en rond.
  Composants `physical` ignorés (comme `canvas.render`). Décision laissée au plan : factoriser
  la boucle build+positionnement depuis `canvas.js` **ou** la réimplémenter en read-only
  (~15 lignes) — contrainte : **zéro duplication des builders**.
- **`app.js`** instancie `createCarousel` (host = nouvel élément dans `#canvas-col` sous
  `#stage-wrap`) et lui passe `selection`/`setSelection`/`goPage` déjà disponibles.
- **`mutations.js`** : inchangé (réutilisé).

## Interactions & comportements

- **Clic** vignette i → `goPage(i)` + `setSelection({ kind:'page', page:i })` (chemin identique
  à l'arbre, `tree.js:260-263`).
- **Drag** d'une vignette → `reorderPages` (réutilise la mutation ; marqueurs de dépôt
  before/after comme l'arbre, `tree.js:290-301`).
- **Clic-droit** vignette → `openMenu` partagé, items pages (Renommer inline / Dupliquer /
  Supprimer (grisé si une seule page) / Monter / Descendre).
- **« + page »** : emplacement après la dernière vignette → `addPage` ; **désactivé à 8 pages**.
- **Flèches ◀ ▶** : défilent la bande (scroll programmatique) ; **grisées** si pas de
  débordement, ou à l'extrémité atteinte.
- **Renommage inline** : double-clic / item menu → champ de saisie dans la légende (mêmes
  gardes de doublon de nom que l'arbre).

## Synchronisation (flux de données)

`carousel.js` s'abonne à `model.subscribe(render)`. Toute mutation — déclenchée depuis le
carousel, l'arbre, le canvas ou l'inspecteur — re-render la bande. La page active vient de la
sélection partagée ; la vignette correspondante reçoit l'état actif (+10 % + halo). Aucune
logique métier dupliquée : le carousel n'est qu'une **vue** de plus sur le même modèle.

## États & cas limites

- **Une seule page** : bande visible (choix), une vignette + « + page ».
- **8 pages** : « + page » grisé.
- **Débordement largeur** : flèches actives ; sinon grisées. La colonne canvas s'étant
  rétrécie (docks élargis à 250/270), le débordement arrive dès ~6-8 vignettes selon le viewport.
- **Ref/type inconnu dans une page** : ignoré au rendu (la validation le signale déjà), comme
  `canvas.render` (`canvas.js:106-108`).
- **`visible:false`** : composant grisé dans la miniature (cohérent canvas) ou simplement rendu
  tel quel — détail tranché au plan (faible enjeu en miniature).

## Look & style

- Bande dans `#canvas-col`, sous `#stage-wrap`. Disques `--bg`/noir, bord `--line`.
- **Active** : `transform: scale(1.10)`, bord `--accent`, `box-shadow` halo violet (cohérent
  `.stage.drop-active`). Nom actif en `--ink`/600, inactifs en `--muted`.
- Flèches : boutons ronds ghost (réutilisent le style `button` existant) ; état grisé
  `opacity:.32`.
- « + page » : disque en pointillé (affordance d'ajout), même diamètre.
- Dépendance au **problème DA #1 (scroll vertical)** : la bande doit rester **ancrée** sous le
  disque. Idéalement `#canvas-col` devient un flex column où la zone disque scrolle (overflow
  interne) et la bande est `flex:none` en bas. La correction de #1 et cet ancrage sont à mener
  de pair ; à défaut, la bande vit en bas de `#canvas-col` (v1 acceptable).

## Performance

Re-render complet des vignettes à chaque mutation (simple, comme l'arbre). Borne réelle :
≤ 8 pages × ≤ 12 placements = peu de nœuds. Si une lenteur apparaît (mesurée, pas supposée),
optimisation possible : ne re-rendre que la/les vignette(s) impactée(s) en diffant l'index muté.
On commence simple.

## Tests

- **node --test** (`designer/tests/`) :
  - `render.test.js` : `buildPageStatic` — nombre de nœuds attendu pour une page donnée,
    composant `physical` ignoré, positionnement centré vs `placeAt`.
  - menu partagé : `contextMenuItems` renvoie les bons items pour une sélection `page`
    (dont Monter/Descendre, et Supprimer grisé à une seule page).
  - non-régression `mutations` (addPage/reorderPages/removePage/renamePage) — déjà couverts
    (`mutations.test.js`), à étendre si le carousel introduit un chemin nouveau.
- **Vérif navigateur** (snapshots envoyés) : fidélité vignette ↔ canvas, surlignage actif
  (+10 % + halo), « + page » grisé à 8, drag qui réordonne, flèches grisées/actives, menu
  contextuel.

## Hors-scope

- **Dépasser 8 pages** : chantier firmware (RAM, tableaux fixes `dashboard.h`) — décision
  distincte (backlog).
- **Capture device dans les vignettes** : rendu live uniquement (v1).
- **Correction du scroll vertical #1** : sujet DA séparé ; le carousel est conçu pour s'y
  intégrer (ancrage de la bande).
- **Repli manuel du carousel** : écarté (présence fixe choisie).
- **Réorganisation des composants depuis le carousel** : reste dans l'arbre/canvas.
