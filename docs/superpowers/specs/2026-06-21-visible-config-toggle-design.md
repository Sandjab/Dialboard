# Designer — `visible` config-time + toggle device (étape 2)

> Spec de cadrage (brainstorming → plan). Étape 2 de la partition commandes/valeurs.
> Étape 1 (firmware : forme objet `{value|text}` + commande `visible` runtime) est **faite + poussée** (`96d9414`) ;
> note de design étape 1 : `docs/_internal/2026-06-20-push-commandes-valeurs-design.md` (gitignoré).

## Intent

L'étape 1 a livré la commande **runtime** `visible` (`POST /update {"<id>":{"visible":false}}`) : le firmware cache le
composant (`LV_OBJ_FLAG_HIDDEN` sur w+sub1+sub2 dans `view_sync`), mais rien ne le persiste et le designer n'en sait
rien. L'étape 2 ferme la boucle côté **layout** et côté **designer** :

1. **`visible` config-time** : un layout peut déclarer un composant caché par défaut (`"visible": false`), révélable
   à chaud par un push (cas « caché par défaut, révélé par une alarme » — piste B du `BACKLOG.md`).
2. **Affordance designer** : un **œil cliquable** (ouvert/fermé) dans l'inspecteur pilote ce `visible` config ; le
   canvas grise le composant caché ; un **bouton device** distinct pousse `visible` en direct vers le device (test).

Hors scope (volontaire) : `led_ring`/`sound` (non visuels), le mapping `led_ring`≡`mode:off`, le panneau de calques
(arbre pages→composants) et la décision sur les onglets — voir § « Hors scope » + « Forward-compat ».

## Décisions (validées en brainstorming)

- **Approche A — œil universel** : l'œil est rendu **une fois** dans `inspector.js` (en-tête du composant), pas via
  9 entrées `compFields` dupliquées dans `registry.js`. Gaté sur les types visuels.
- **Œil, pas checkbox** : affordance standard de visibilité (Figma/PS/Sketch), et **pré-figure la ligne de calque**
  `[œil] id` — quand l'arbre des calques arrivera, il réutilisera ce même composant œil. Coût quasi nul (même prop
  `visible`, même mutation, même grisé canvas ; seul le rendu inspecteur diffère).
- **Bouton device ≠ œil** : la commande live de test est un **bouton libellé** (« Cacher / Afficher sur le device »),
  pas un 2ᵉ œil — pour ne pas confondre « état persisté du layout » (œil) et « push de test » (bouton).
- **Schéma dénormalisé suivi** : `visible` ajouté à chaque déf visuelle (le schéma répète déjà `bind` ~9 fois, pas de
  base partagée). On NE refactore PAS vers une base commune ici (Rule 11) ; dette latente signalée, pas corrigée.

## Les 5 fronts

### 1. Schéma — `schema/layout.schema.json`
Ajouter à chaque déf **visuelle** (`comp_label`, `comp_readout`, `comp_bar`, `comp_ring`, `comp_chart`, `comp_meter`,
`comp_image`, `comp_image_anim`, `comp_led`) :
```json
"visible": { "type": "boolean", "description": "Affiche le composant (defaut true). false = cache (LV_OBJ_FLAG_HIDDEN au rendu). Revelable a chaud via /update {\"<id>\":{\"visible\":true}}." }
```
**Pas** ajouté à `comp_sound` ni `comp_led_ring` (non visuels). Avec `additionalProperties:false`, le designer
rejettera donc `visible` sur ces deux types → parité garantie (le designer n'en écrira jamais dessus).

### 2. Firmware — `src/dashboard.cpp` (`dash_set_layout`)
Une ligne : `c.visible = true;` → `c.visible = o["visible"] | true;`.
- C'est le franchissement de parité reporté de l'étape 1 — maintenant justifié (schéma + firmware + designer
  connaissent tous `visible`).
- Effet : un layout `visible:false` rend le composant caché **dès le build** (le moteur marque tout `dirty` puis
  `view_sync` applique `HIDDEN` sur w+sub1+sub2 — déjà en place depuis l'étape 1).
- Tolérance : `sound`/`led_ring` pourraient porter `visible` dans un layout (le firmware lit `o["visible"]`), mais
  `view_sync` les saute (`w == nullptr`) → sans effet. Le schéma l'interdit côté producteur.

### 3. Inspecteur — œil (`designer/js/inspector.js`, `style.css`, helper de type)
- Un **œil cliquable** dans l'**en-tête du composant** de l'inspecteur (à côté de l'id/type), rendu pour les types
  visuels uniquement. Helper `hasVisible(type)` = tout sauf `sound`/`led_ring`.
- États : œil **ouvert** = visible (prop absente ou `true`) ; œil **barré/fermé** = `visible:false`.
- Clic → `model.commit(s => setComponentProp(s, ref, 'visible', nextHidden ? false : true))` (écriture **explicite**,
  conforme aux bools existants `rounded`/`pill`). Re-render inspecteur + canvas.
- Respecte les invariants F1/F5 (cf. `CLAUDE.md` « invariants inspecteur/canvas ») : `ref` figée au rendu, blur avant
  changement de sélection — l'œil suit le même garde-fou que les autres commits.

### 4. Canvas — grisé (`designer/js/canvas.js`, `style.css`)
- Dans `render()` (après `buildNode`, ~ligne 111) : `node.classList.toggle('w--hidden', comp.visible === false)`.
- CSS : `.w--hidden { opacity: .35 }` + un petit **badge œil-barré** en coin (lisibilité « ceci est masqué »).
- Le composant **reste sélectionnable et déplaçable** (la classe ne touche que l'opacité ; `pointer-events` intacts) →
  on peut toujours le re-sélectionner et rouvrir l'œil **sans** arbre de calques.

### 5. Bouton device runtime (`designer/js/app.js`, réutilise `device.js#pushValues`)
- Bouton **« Cacher sur le device » / « Afficher sur le device »** affiché quand un composant **visuel** est sélectionné
  ET le device joignable (base URL présente). Placé dans une ligne « Sur le device » **séparée** des champs de config
  de l'inspecteur (action live, pas une édition de layout).
- Action : `pushValues(base, { [id]: { visible: <bool> } })` — réutilise l'API existante (payload mono-clé). **Ne
  modifie pas le layout.**
- Bascule : état local (dernier poussé par id) pour alterner le libellé. 1er clic → `visible:false` (libellé →
  « Afficher ») ; 2ᵉ → `visible:true`. Toast = verdict (convention designer).

## Comportement — contrat clair

| Action | Effet layout (persisté) | Effet device |
|---|---|---|
| Œil inspecteur (fermer) | écrit `visible:false` + grise le canvas | aucun (tant qu'on ne pousse pas le layout) |
| Pousser le layout (`/layout`) | — | composant caché dès le build |
| Bouton « Cacher sur le device » | aucun | push live `{id:{visible:false}}`, transitoire (RAM) |
| `/update {id:{visible:true}}` (alarme externe) | aucun | ré-affiche, même si layout dit `false` |

Œil = **état du layout** ; bouton = **commande de test** ; les deux pilotent la même prop `visible` mais à des couches
différentes (config vs runtime). Le runtime gagne sur le device jusqu'au prochain rechargement de layout.

## Tests

Le harness designer (`node --test`) **n'a pas de DOM** : `render.test.js` teste des **fonctions pures** (math/logique),
jamais la construction DOM de `canvas.js`. La répartition unit-test / vérif-navigateur suit donc cette contrainte
existante (Rule 11).

**Unit-testables :**
- **Natif** (`test/test_core/test_main.cpp`) : layout `{visible:false}` → `c.visible == false` ; `visible` absent →
  `true` ; `visible:true` explicite → `true`.
- **Designer — schéma** (`designer/tests/schema.test.js`) : layout avec `visible:false` **valide** ; `visible` sur
  `sound`/`led_ring` **invalide** (`additionalProperties:false`) ; `visible:"x"` (non booléen) **invalide**.
- **Designer — modèle** (`designer/tests/mutations.test.js`) : `setComponentProp(state, id, 'visible', false)` →
  `state.components[id].visible === false` (la logique de bascule de l'œil) ; `hasVisible(type)` exclut
  `sound`/`led_ring` si on en fait un helper pur.

**Vérif navigateur (DOM, non unit-testable ici) :** rendu de l'œil dans l'inspecteur ; grisé canvas `w--hidden` +
badge ; bouton device (push réseau).

**Vérif on-device finale :** flasher + pousser un layout avec un composant `visible:false`, confirmer qu'il est absent
à l'écran, puis `POST /update {id:{visible:true}}` le révèle (captures avant/après comme à l'étape 1).

## Fichiers touchés

`schema/layout.schema.json` · `src/dashboard.cpp` · `test/test_core/test_main.cpp` ·
`designer/js/{inspector.js, canvas.js, app.js}` (+ helper de type ; `device.js` réutilisé tel quel) ·
`designer/style.css` · `designer/tests/{schema,render|mutations}.test.js`.

## Hors scope (explicite)

- **Panneau de calques / arbre pages→composants** : chantier ultérieur. L'œil de l'en-tête inspecteur est conçu comme
  la **même brique** que la future ligne d'arbre `[œil] id` → migration sans churn d'affordance.
- **Décision sur les onglets** (garder/remplacer par l'arbre) : à trancher avec les calques. Penchant actuel : garder
  les deux (onglets = bascule rapide ; arbre = structure + sélection des éléments cachés/superposés). Ne change rien ici.
- **`led_ring` `visible`≡`mode:off`** : non fait (led_ring exclu, `w == nullptr`).
- **Étape 3** : valeur → contexte (variable implicite par id), `led_ring.value` bindable.

## Décisions tranchées (validées par l'utilisateur)

- **Ré-affichage** : écriture **explicite** `visible:true` (conforme aux bools existants `rounded`/`pill`). On ne
  supprime PAS la clé.
- **Badge canvas** : opacité 35 % **+ badge œil-barré** en coin (lisibilité « ceci est masqué »).
