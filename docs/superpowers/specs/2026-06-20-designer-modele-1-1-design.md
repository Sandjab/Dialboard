# Designer — modèle 1:1 (retrait de la Bibliothèque-partage) + copier/coller/dupliquer

> Spec de design. Date : 2026-06-20. Statut : validée (design approuvé), prête pour le plan d'implémentation.
> Périmètre : **uniquement l'interface web du designer** (`designer/`). Zéro changement de schéma ni de firmware.

## 1. Contexte et problème

Le designer expose un panneau **Bibliothèque** (`palette.js`) qui permet de re-poser un composant déjà
défini sur une autre page. Le drop depuis la Bibliothèque crée une **instance partagée** : même `ref`,
même id, même état — pas une copie (`palette.js:1-4,101-104`). Éditer ce composant dans l'inspecteur
modifie donc **toutes** ses occurrences, sur toutes les pages.

Ce mécanisme « symbole/instance » pose trois problèmes :

1. **Cas d'usage minoritaire.** Sur un écran rond qu'on *swipe*, chaque page est un écran distinct ;
   afficher le même widget (même valeur, même style) sur plusieurs pages est rare. Et même ce cas n'a
   pas besoin du partage d'identité : deux composants **indépendants** liés par le même `bind` (variable
   de pull, cf. schéma `comp_*.bind`) affichent déjà la même donnée. Le `ref` partagé n'ajoute que le
   partage du **style/config**, souvent ce qu'on veut *différent* d'une page à l'autre.
2. **Partage silencieux = piège.** L'inspecteur (`inspector.js`) ne signale jamais qu'un composant est
   posé sur plusieurs pages, et n'offre aucun « détacher ». Édition à distance surprenante garantie.
3. **Besoin réel non couvert.** Ce que veut l'utilisateur 9 fois sur 10, c'est « le même widget ailleurs,
   mais **indépendant** » → une **copie**. Or la duplication n'existe nulle part dans le designer.

**Constat décisif :** le partage M:N n'est utilisé dans **aucun** layout réel — dans `data/layout.json`,
`data/layout_test.json` et le layout du device, chaque `ref` est placé exactement une fois. Le partage
est une capacité jamais exploitée.

## 2. Décision

Retirer la Bibliothèque-partage et adopter un **modèle 1:1** : un composant visuel ↔ un placement. Le
mécanisme de réutilisation devient le **copier/coller** (cross-page) + **dupliquer** (sur place), qui
produisent toujours des **copies indépendantes**.

Décisions de cadrage actées :

- **Périmètre du remplaçant** : copier/coller (`Cmd/Ctrl+C`/`V`, cross-page) **et** dupliquer (`Cmd/Ctrl+D`,
  sur place). Copie toujours indépendante.
- **Layouts hérités** : **pas de migration** (YAGNI — aucun layout n'a de partage). Le 1:1 est ce que
  l'éditeur *produit* ; on ne normalise rien à l'import. Pour rester sûr malgré tout, la suppression est
  **défensive** (cf. §4).
- **Approche** : mutations pures dans `mutations.js` (testées sous `node --test`) + câblage DOM dans
  `app.js`, conformément à la séparation existante. (Approches « logique inline » et « fusion
  composant/placement » écartées : non testable / surdimensionnée.)

## 3. Objectifs / non-objectifs

**Objectifs**
- Supprimer la section Bibliothèque et le drop par `text/rt-ref`.
- Ajouter dupliquer (`Cmd/Ctrl+D`) et copier/coller (`Cmd/Ctrl+C`/`V`), copie indépendante, coller cross-page.
- Rendre la suppression défensive (ne supprimer le composant que s'il n'est plus référencé, hors physiques).
- Conserver le format JSON, le schéma et le firmware **inchangés**. Tests `node --test` verts.

**Non-objectifs (hors scope)**
- Pas de migration/normalisation des layouts importés.
- Pas de presse-papier système (presse-papier interne de session suffit).
- Pas de hint de découvrabilité des raccourcis (suite possible).
- Pas de renommage du bouton « Supprimer de la page ».

## 4. Design détaillé

### 4.1 Modèle & invariant
Format inchangé (schéma `components` map + `pages[].place[].ref`). L'éditeur garantit désormais
**1 composant visuel ↔ 1 placement**. Exception permanente : les composants **physiques**
(`sound`, `led_ring` — `def.physical`) restent des composants **sans placement**, édités via le panneau
Device ; la Bibliothèque les excluait déjà (`palette.js:54`).

### 4.2 Mutations (`mutations.js`)
Deux ajouts, la primitive existante conservée.

- **`placeComponentCopy(state, pageIndex, compDef, placement) → newIndex`** — brique commune de
  dupliquer et coller :
  - `newId = uniqueId(state, compDef.type)`
  - `addComponent(state, newId, structuredClone(compDef))`
  - placement de la copie = `structuredClone(placement)`, avec `ref = newId` et offset `dx/dy += 8`
    (unités écran). `dx`/`dy` sont des propriétés valides de **tout** placement (schéma `$defs/placement`),
    donc l'offset est toujours valide ; pour un ring (centré) il est **inerte** → copie concentrique,
    à réajuster via `radius` (cas limite assumé).
  - `addPlacement(state, pageIndex, place)` ; retourne le nouvel index pour sélection.
- **`duplicateComponent(state, pageIndex, placeIndex) → newIndex`** — lit `placement = pages[pageIndex].place[placeIndex]`
  et `compDef = components[placement.ref]`, délègue à `placeComponentCopy`.
- **`removePlacementAndOrphan(state, pageIndex, placeIndex)`** — cascade défensive :
  - lit `ref` du placement visé, retire le placement (réutilise `removePlacement`),
  - supprime `components[ref]` **ssi** plus aucun placement (toutes pages confondues) ne référence `ref`
    **et** le composant n'est pas physique.
  - En 1:1 normal → suppression systématique du composant. Sur un hypothétique `ref` hérité partagé →
    le composant survit tant qu'une autre page l'utilise (zéro casse, sans code de migration).
- **`removePlacement(state, pageIndex, placeIndex)`** — inchangée, conservée comme primitive pure
  (réutilisée par `removePlacementAndOrphan` ; son test `mutations.test.js:128` reste vert).

### 4.3 Presse-papier & raccourcis
- **`shortcuts.js`** — `resolveShortcut` reconnaît en plus :
  - `Cmd/Ctrl+D → 'duplicate'`, `Cmd/Ctrl+C → 'copy'`, `Cmd/Ctrl+V → 'paste'`.
  - La garde existante `editable → null` reste **essentielle** : dans un champ texte (`input`/`textarea`/
    `select`), C/V/D conservent leur comportement natif (copier/coller de texte, etc.).
- **`app.js`** — presse-papier interne (variable de session) :
  - `clipboard = null | { compDef, placement }` (clones, **sans** id).
  - `'copy'` : si sélection → `clipboard = { compDef: clone(components[ref]), placement: clone(placement) }`.
  - `'paste'` : si `clipboard` → `placeComponentCopy(state, pageActive, clipboard.compDef, clipboard.placement)`
    → colle sur la **page active** (= réutilisation cross-page) → sélectionne la copie.
  - `'duplicate'` : si sélection → `duplicateComponent(state, pageActive, placeIndex)` → sélectionne la copie.
  - Remplacer les **deux** appels `removePlacement` par `removePlacementAndOrphan` :
    `app.js:128` (touche Suppr) et `inspector.js:344` (bouton « Supprimer de la page »).
  - Collers multiples → copies superposées (offset fixe, non cumulatif) : acceptable.

### 4.4 Retrait de la Bibliothèque
- **`palette.js`** : supprimer la section Bibliothèque (`libTitle`, `libHint`, `libList`, `renderLibrary`,
  `model.subscribe(renderLibrary)`, l'appel initial) et la branche `text/rt-ref` du `dragover`/`drop`
  (le drop ne gère plus que `text/rt-type` = création). Mettre à jour les commentaires devenus faux
  (`palette.js` en-tête, `app.js:72`, `pages.js:73`).
- **`style.css`** : retirer les classes `.lib-title`, `.lib-list`, `.lib-item`, `.lib-empty`, `.lib-type`.

### 4.5 Tests (`node --test`)
- **`tests/mutations.test.js`** :
  - `placeComponentCopy` : id unique généré ; **copie indépendante** (muter la copie ne touche pas
    l'original) ; offset `dx/dy += 8` ; `ref` de la copie = nouvel id.
  - `duplicateComponent` : crée une copie indépendante depuis un placement existant.
  - `removePlacementAndOrphan` : (a) 1:1 → composant supprimé ; (b) `ref` encore référencé sur une autre
    page → composant **conservé** ; (c) composant physique → conservé.
- **`tests/shortcuts.test.js`** : `Cmd/Ctrl+D/C/V` → `'duplicate'/'copy'/'paste'` ; `null` si `editable`.
- Aucun test existant ne référence la Bibliothèque ni `text/rt-ref` → retrait sans casse.

## 5. Fichiers touchés
- `designer/js/mutations.js` — `placeComponentCopy`, `duplicateComponent`, `removePlacementAndOrphan`.
- `designer/js/shortcuts.js` — duplicate/copy/paste.
- `designer/js/app.js` — presse-papier + câblage + `removePlacementAndOrphan`.
- `designer/js/palette.js` — retrait Bibliothèque + branche `rt-ref`.
- `designer/js/inspector.js` — `removePlacement` → `removePlacementAndOrphan`.
- `designer/style.css` — retrait des classes `.lib-*`.
- `designer/tests/mutations.test.js`, `designer/tests/shortcuts.test.js` — nouveaux tests.
- **Inchangés** : `schema/layout.schema.json`, firmware (`src/`), `designer/js/default-layout.js` (déjà 1:1).

## 6. Critères de succès (vérifiables)
- `cd designer && node --test` : vert, incluant les nouveaux tests.
- Dans le navigateur (designer servi depuis la racine du repo) :
  - La section Bibliothèque a disparu ; la palette ne propose que la création par type.
  - `Cmd/Ctrl+D` duplique le composant sélectionné en une copie indépendante décalée, sélectionnée.
  - `Cmd/Ctrl+C` puis navigation vers une autre page puis `Cmd/Ctrl+V` colle une copie indépendante.
  - Éditer une copie ne modifie pas l'original (et inversement).
  - Supprimer un placement (Suppr ou bouton) retire le composant du JSON (vérifié dans « JSON avancé »).
  - C/V/D dans un champ texte gardent leur comportement natif.
