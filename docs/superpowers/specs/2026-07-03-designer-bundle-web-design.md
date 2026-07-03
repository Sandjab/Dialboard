# Design — Export/Import `.dboard` en web (persistance designer, levier A)

Date : 2026-07-03
Statut : validé (design), en attente du plan d'implémentation.

## Contexte

Côté designer, la persistance actuelle est asymétrique :

- **Layout** : autosauvé dans `localStorage` à chaque modification (`app.js:75`), restauré au reload.
- **Octets des images** (bg / img / aimg) : vivent dans des `Map` en mémoire
  (`_cache` dans `bg-image.js`, `image-asset.js`, `image-anim-asset.js`), **vidées au reload**.
  Au rechargement, le designer les re-télécharge depuis le **device** via `rehydrate()`.

Conséquence : l'export web (bouton Export, `file-io.js`) produit un `layout.json` **nu** — il
référence des clés d'images mais ne contient pas leurs octets. Déplacer un design avec ses images
vers une autre machine/navigateur, sans device joignable, perd les images.

Un format autonome existe déjà : **`.dboard`** (`bundle.js`) —
`{ version:1, layout, assets:{ bg|image|aimg : { key: base64 } } }`, avec `encodeBundle`/`decodeBundle`
**purs et testés en node**, plus `collectAssets` / `applyAssets` / `serializeBundle` / `loadBundle`
(browser, touchent les caches). **Mais ce format n'est câblé qu'au mode Electron**
(`window.desktop.saveBundle` / `openBundle`, `app.js:206-242`). En navigateur, `window.desktop` est
absent → le bundle autonome est **codé mais inaccessible au web**.

## Objectif

Exposer l'export/import du bundle `.dboard` dans l'UI **web** du designer, en réutilisant le code
existant (`serializeBundle` / `loadBundle`). Résultat : un fichier unique portable (layout + images),
indépendant du device.

Hors périmètre (YAGNI, cf. section dédiée) : persistance des octets à travers un reload
(IndexedDB, « levier B ») ; boutons adaptatifs ; suivi « dirty » des assets.

## Décisions de cadrage

- **Q1 — Boutons : ajouter une 2ᵉ paire, garder `layout.json`.** Les boutons Export/Import JSON
  existants restent inchangés (le `layout.json` nu est délibéré : lisible, diffable, et
  `data/layout.json` est la source committée lue par le firmware). On **ajoute** une paire
  Export/Import `.dboard`.
- **Q2 — Octets manquants à l'export : avertir mais exporter quand même.** Si des clés référencées
  par le layout n'ont pas d'octets en cache, un toast d'avertissement liste le nombre manquant
  (fail-loud), et l'export se fait malgré tout (bundle partiel). Pas de blocage.
- **Q3 — Import → device : aucun travail supplémentaire (vérifié dans le code).** Le handler de Push
  (`app.js:437-452`) ré-uploade **tous** les assets référencés présents en cache (pas de suivi
  « dirty »). `loadBundle` → `applyAssets` peuple ces caches ; donc importer un `.dboard` puis Push
  porte les images au device sans code additionnel.

## Architecture

Nouveau module `designer/js/bundle-io.js`, **miroir de `file-io.js`**, exportant
`bindBundleIO(...)`. Raison du module séparé plutôt que d'étendre `file-io.js` : ce dernier est cadré
« filet `layout.json` indépendant du device » ; y injecter la logique bundle+assets brouillerait son
unique responsabilité. Un sibling de même forme respecte le découpage mono-fonction du codebase.

Le format `.dboard` web est **identique** à celui d'Electron (mêmes `serializeBundle` / `loadBundle`)
→ un bundle sauvé dans l'app desktop s'ouvre en web et inversement.

## Composants

### 1. UI (`designer/index.html`)

Dans le groupe toolbar « Fichier local » existant (actuellement `#export` / `#import` / `#import-file`,
lignes 22-26), ajouter :

- bouton **`#export-bundle`** — Export `.dboard` ;
- bouton **`#import-bundle`** — Import `.dboard` ;
- input **`#import-bundle-file`** — `<input type="file" accept=".dboard,application/json" hidden>`.

Icônes distinctes de l'export/import JSON (glyphe « paquet/boîte » pour signifier « avec assets »),
avec `data-tip`, `title`, et attributs `data-i18n-tip` / `data-i18n-title`.

Boutons **toujours visibles**, y compris sous Electron (ils fonctionnent aussi là ; les masquer
ajouterait une branche pour peu de gain — le menu natif Fichier reste disponible en parallèle).

### 2. Module `designer/js/bundle-io.js`

`bindBundleIO(model, { exportBtn, importBtn, importInput, onLoad } = {})` :

- **Export** (`exportBtn` click) :
  1. `assets = collectAssets(model)` ;
  2. `miss = missingKeys(model.state, assets)` (cf. §3) ; si non vide → toast d'avertissement
     `toast.bundle_missing_assets` avec le total manquant ;
  3. `text = encodeBundle(model.toJSON(), assets)` (équivaut à `serializeBundle` mais réutilise
     `assets` déjà collecté, pour ne pas re-scanner les caches) ;
  4. Blob `application/json` → download `layout.dboard` (même patron que `file-io.js`) ;
  5. `logs.logActivity(t('activity.bundle_exported'))`.
- **Import** (`importInput` change) :
  1. lire le fichier (`file.text()`) ;
  2. `loadBundle(model, text)` (throw si invalide → toast `toast.import_failed`, comme `file-io.js`) ;
  3. `onLoad?.()` (même callback que l'import JSON : reset page active + arbre) ;
  4. `logs.logActivity(t('activity.bundle_imported'))` ;
  5. `importInput.value = ''` (réautorise la réimportation du même fichier).

Câblage dans `app.js`, à côté de `bindFileIO` (~ligne 200), réutilisant le même `onLoad`.

### 3. Détection des octets manquants (pur, testable node)

Nouveau helper exporté par `designer/js/bundle.js` :

```
missingKeys(state, assets) -> { bg: string[], image: string[], aimg: string[] }
```

Retourne, par type, les clés **référencées** par le layout (`referencedKeys` / `referencedImageKeys`
/ `referencedAimgKeys`, déjà importées dans `bundle.js`) **absentes** de l'objet `assets` collecté.
Logique purement de comparaison de clés → **testée en `node --test`**, conforme à la convention
« logique pure testée en node, DOM browser-verified ».

### 4. i18n (`designer/i18n/fr.json` et `designer/i18n/en.js`)

Nouvelles clés (mêmes espaces de noms que l'existant) :

- `toolbar.export_bundle.tip`, `toolbar.export_bundle.title`
- `toolbar.import_bundle.tip`, `toolbar.import_bundle.title`
- `activity.bundle_exported`, `activity.bundle_imported`
- `toast.bundle_missing_assets` (avec paramètre `{n}`)

Réutilise `toast.import_failed` et `bundle.invalid` (déjà présents).

## Flux de données

```
Export : model ──collectAssets──> assets (caches)
                 └─ missingKeys(state, assets) ──(si >0)──> toast avertissement
         encodeBundle(model.toJSON(), assets) ──> Blob .dboard ──> download

Import : fichier .dboard ──loadBundle──> decodeBundle
                                          ├─ model.loadJSON(layout)
                                          └─ applyAssets ──> ré-hydrate les caches
         (Push ultérieur : app.js re-uploade les caches au device — inchangé)
```

## Gestion d'erreurs

- **Import d'un fichier invalide** : `decodeBundle` throw (`bundle.invalid`) → capturé → toast
  `toast.import_failed` (même comportement que `file-io.js` pour un JSON illisible).
- **Octets manquants à l'export** : jamais bloquant ; toast d'avertissement + export partiel (Q2).
- **`importInput.value = ''`** en `finally` pour permettre la réimportation du même fichier.

## Tests

- **node (`node --test`)** : `missingKeys` (ajouté à `designer/tests/bundle.test.js`) — layout
  référençant des clés présentes/absentes de `assets` → arrays attendus par type ; cas vide.
  (`encodeBundle`/`decodeBundle` déjà couverts dans ce fichier.)
- **Navigateur (browser-verified, cf. convention)** :
  1. round-trip export `.dboard` → ré-import → aperçus d'images identiques ;
  2. avertissement octets manquants (layout avec clé non mise en cache → toast, export quand même) ;
  3. compat : bundle produit en web ouvert par le flux Electron et inversement (si accès desktop).

## Hors périmètre (YAGNI)

- **Levier B — persistance des octets en IndexedDB** à travers un reload : problème distinct
  (édition offline sans device). Reporté ; à ouvrir séparément si le besoin se confirme.
- **Boutons adaptatifs** (un seul couple qui choisit `.json` ou `.dboard`) : écarté en Q1 (comportement
  « magique », types de fichiers mélangés).
- **Suivi « dirty » des assets au push** : non nécessaire (le push ré-uploade déjà tout le cache).

## Fichiers touchés

| Fichier | Nature |
|---|---|
| `designer/js/bundle-io.js` | **nouveau** — `bindBundleIO` |
| `designer/js/bundle.js` | + `missingKeys(state, assets)` (export pur) |
| `designer/index.html` | + 2 boutons + 1 input dans le groupe « Fichier local » |
| `designer/js/app.js` | + appel `bindBundleIO(...)` près de `bindFileIO` |
| `designer/i18n/fr.json`, `designer/i18n/en.js` | + clés toolbar/activity/toast |
| `designer/tests/bundle.test.js` | + test node de `missingKeys` (fichier existant) |
