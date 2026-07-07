# Composant `state` — visuel piloté par la valeur (brique 1)

> Design doc. Statut : **approuvé** (brainstorm 2026-07-07). Brique **1** d'un découpage en 2 :
> ici la **fondation** (valeur → visuel *statique*) ; la brique **2** (moteur d'animations composées
> data-driven) fera l'objet d'un cycle spec→plan→impl séparé, et branchera une « scène » comme un
> type de visuel supplémentaire qu'un cas pourra sélectionner.

## 1. Objectif

Un composant qui affiche **un** visuel choisi parmi N **selon la variable bindée**. Le visuel est
soit un **glyphe MDI** (+ couleur, rendu Tiny TTF), soit une **image bitmap** (asset RGB565A8).
Cas d'usage moteur : un écran météo qui montre `weather-sunny` / `weather-pouring` / une image selon
la condition renvoyée par une API (clé string ou code numérique).

Généralise deux mécaniques existantes : les **états** du composant `icon` (valeur → glyphe/couleur par
seuils) et le composant `image` (asset unique), en un **sélecteur de visuels hétérogènes** à matching
hybride. `icon` et `image` restent **inchangés**.

## 2. Périmètre

**Dans le périmètre (brique 1)** :
- Nouveau type de composant `state`.
- Sélection **hybride** : map de clés exactes (string **ou** nombre) **ou** plages numériques (seuils).
- Visuel par cas : **glyphe MDI + couleur** *ou* **image bitmap**. Mixte autorisé (un cas glyphe, un
  autre image, dans le même composant).
- Un visuel **par défaut** (aucun cas ne matche).
- Rendu firmware (LVGL) + designer (rendu WYSIWYG à parité + éditeur + preview) + schéma + tests.

**Hors périmètre (→ brique 2)** :
- Les **animations composées** (scènes multi-glyphes data-driven pilotées par `lv_anim`). La brique 2
  ajoutera un kind de visuel `scene` que les cas et le défaut pourront sélectionner, réutilisant le
  mécanisme de sélection de la brique 1.
- Frame-packs bitmap (écartés au brainstorm : trop lourds en PSRAM/flash).
- Vrai SVG on-device (ThorVG non activé ; les glyphes MDI couvrent le besoin vectoriel).

## 3. Nom

Type = **`state`**. (Distinct des `icon_states` de `icon` : ceux-ci restent internes à `icon` ; le
composant `state` est le sélecteur générique de visuels.)

## 4. Modèle de données (`$defs/comp_state`)

```json
{
  "type": "state",
  "bind": "weather",                 // variable de contexte (pull) ; vide = push par id
  "match": "exact",                  // "exact" | "range"  (défaut "exact")
  "font": 64,                        // taille des cas glyphe (px ; défaut 28 comme icon)
  "default": { "symbol": "weather-cloudy", "color": "#9AA0AA" },
  "cases": [
    { "key": "Clear", "symbol": "weather-sunny",   "color": "#FFC02E" },
    { "key": "Rain",  "symbol": "weather-pouring", "color": "#3B82F6" },
    { "key": "Snow",  "src": "snow_img", "w": 120, "h": 120 }
  ]
}
```

- **Un cas = un matcher + un visuel.**
  - Matcher : `key` (mode `exact` ; string ou nombre) **ou** `at` (mode `range` ; `value < at`).
  - Visuel : `symbol` (+ `color` optionnelle) → **glyphe** ; `src` (+ `w`, `h`) → **image**. Le kind
    est **inféré par le champ présent** (`symbol` xor `src`), comme les états `icon` / le composant
    `image`. (Schéma : `oneOf` glyphe|image sur le visuel.)
- `default` : un **visuel sans matcher** (obligatoire — garantit qu'il y a toujours quelque chose à
  afficher, y compris avant le 1er `/update`).
- **Limite** `MAX_STATE_CASES` (proposé **16**), gardée côté designer comme `MAX_ICON_STATES`.
- `color` par défaut d'un cas glyphe = héritée du thème (blanc), comme `icon`.

## 5. Sémantique de sélection

Fonction **pure** `state_resolve(match, cases[], has_num, num, str) → index de cas | -1(défaut)` :

- **`exact`** : le **type de la valeur entrante** décide la comparaison.
  - valeur **string** (`vstr`) → compare aux `key` **string** des cas (égalité stricte).
  - valeur **numérique** (`value`) → compare aux `key` **numériques** des cas (égalité).
  - 1er cas qui matche (les clés sont censées uniques ; l'ordre départage un doublon). Aucun → défaut.
- **`range`** : **numérique uniquement**. Cas **ordonnés** ; 1er où `value < at` gagne ; aucun → défaut.
  (Une valeur string en mode range ne matche rien → défaut.)

`state_resolve` est **testée en natif** (Unity), miroir exact du résolveur designer (`render.js`),
comme `icon_resolve`.

## 6. Propagation de la valeur (firmware)

Nouveau cas dans `context_apply` (`dashboard.cpp`) pour `COMP_STATE` : lit la `CtxVar` bindée —
`CTX_NUM` → `c.value` (+ marque « valeur numérique ») ; `CTX_STR` → `c.vstr`. Le push par id (`/update`)
suit la même règle (nombre → value, string → vstr). Le composant retient le **dernier type reçu** pour
choisir la branche de match. (Vérifié faisable : le bus de contexte porte déjà `CTX_STR`/`CTX_NUM`.)

## 7. Rendu firmware (LVGL)

- **Objet principal = un conteneur** (`lv_obj`) transparent, dimensionné par le placement, hébergeant
  **un** enfant :
  - cas **glyphe** → un `lv_label` en `get_icon_font(c.font)` + `ICON_GLYPHS[symbol]` + couleur (réutilise
    exactement le rendu de `icon`).
  - cas **image** → un `lv_image` alimenté par le loader d'asset existant du composant `image`
    (`/img/<src>.565a`, RGB565A8, `w`×`h`).
- **`build_state`** : résout le visuel initial (depuis `default`), crée l'enfant du bon kind.
- **`sync_state`** : re-résout à chaque changement de valeur. Si le **kind** du visuel change
  (glyphe↔image) → **détruit l'enfant et recrée** le bon ; sinon **met à jour en place** (texte+couleur
  du glyphe, ou src de l'image).
- **Images à la demande** : on ne charge en PSRAM que l'image du **cas actif** (chargée/libérée au
  changement), **pas les N d'avance** — économie mémoire (le pipeline `image` gère déjà load/free d'un
  asset ; on le pilote par `src` courant).

## 8. Designer

- **`registry.js`** : nouveau type `state` dans la palette (zone « Rich », près de `icon`/`image`).
  `compFields` = `match` (select exact|range), `font`, `bind`. Défauts de placement raisonnables.
- **`render.js buildState`** : miroir firmware — appelle la **logique de résolution pure partagée**
  (extraite pour être testable node, cf. §10) → rend un glyphe (`<i class="mdi">` via `ICON_CHAR`,
  réutilise le rendu de `buildIcon`) ou une image (`previewUrl`, réutilise `buildImage`).
- **`inspector.js`** : une **table de cas** calquée sur la table d'états `icon` (mêmes invariants :
  `ref` figée, commit sur `change`, coalescence num). Chaque ligne :
  - **matcher** : un champ `key` (texte ; nombre accepté) en mode `exact`, ou un champ `at` (num) en
    mode `range` — l'UI bascule selon `match`.
  - **éditeur de visuel** : une bascule **glyphe | image** ; en glyphe → **bouton-picker MDI** (réutilise
    `openIconPicker` de #42) + couleur ; en image → **picker d'asset** (réutilise le champ image existant).
  - bouton supprimer, bouton « + cas ».
  - un éditeur du **`default`** (même éditeur de visuel) + un sélecteur **`match`**.
- **`$defs/comp_state`** dans le schéma + **test de parité** (registre ↔ schéma, comme les autres types).

## 9. États LVGL / objet — précision d'isolation

Le composant est une **unité autonome** : entrée = (valeur num|str, config), sortie = un visuel affiché.
Son seul point de couplage est la réutilisation (sans les modifier) des briques de rendu de `icon`
(glyphe) et `image` (bitmap). La logique de sélection (`state_resolve`) est **pure et sans état**, donc
testable et raisonnable isolément.

## 10. Tests

- **Natif (Unity)** : `state_resolve` — exact string, exact num, range (bandes ordonnées, `value < at`),
  défaut, priorité en cas de doublon, valeur string en mode range → défaut. + parsing `dash_set_layout`
  d'un `state` (cases, default, match) comme `test_icon_parsed`.
- **Designer (node)** : logique de résolution **pure extraite** (la même que `render.js` consomme) ;
  parité `$defs/comp_state` ↔ registre. Les builders DOM restent browser-verified (cf. mémoire
  `designer-tests-dom-builders`).
- **Browser-verified** : table de cas (ajout/suppression, bascule glyphe|image, pickers MDI + asset),
  rendu du canvas selon la valeur mock, bascule de kind glyphe↔image, mode exact vs range.
- **On-device** : un `state` météo piloté par une variable de condition (string) + un piloté par un code
  numérique (range) ; vérif du bon visuel + de la bascule glyphe↔image. (⚠ `uploadfs` efface les assets —
  cf. mémoire `uploadfs-efface-assets-device`.)

## 11. Décisions figées (résolution des points ouverts du brainstorm)

- Structure = **nouveau composant dédié** (vs étendre `icon`) — identité claire, `icon` intact, extensible
  brique 2.
- Sélection = **hybride** (exact map string/nombre **ou** plages), mode par composant.
- Médias brique 1 = **glyphe MDI** + **image bitmap** (frame-packs et vrai SVG écartés).
- Défaut = **visuel explicite obligatoire**.
- Images = **chargées à la demande** (cas actif), pas préchargées.

## 12. Self-review (rempli à la rédaction)

- **Placeholders** : aucun `MAX_STATE_CASES` proposé chiffré (16) ; `font` défaut 28 ; noms de champs
  alignés sur l'existant (`bind`, `symbol`, `color`, `src`/`w`/`h`).
- **Cohérence** : le visuel `{symbol|src}` par inférence de champ est cohérent entre cases et `default`,
  entre schéma, firmware (`build/sync_state`) et designer (`buildState`, éditeur de visuel).
- **Ambiguïté levée** : mode `range` = numérique seul (string→défaut) ; mode `exact` = comparaison selon
  le type de la valeur entrante (string↔`vstr`, nombre↔`value`).
- **Scope** : focalisé brique 1 (statique) ; l'animation (brique 2) est explicitement différée et le
  modèle (`cases`/`default` → visuel) est conçu pour l'accueillir (kind `scene` à venir).
