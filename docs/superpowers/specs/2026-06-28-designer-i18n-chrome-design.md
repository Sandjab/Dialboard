# WS-1 — i18n du chrome du designer (design)

> Sous-projet **WS-1** de l'effort d'internationalisation du designer.
> Prérequis posé par **WS-2** (contrat charset IDs vs libellés, mergé `cb70061` / PR #18) :
> spec `docs/superpowers/specs/2026-06-28-designer-charset-ids-vs-libelles-design.md`.

## Contexte

Le designer (`designer/`, éditeur WYSIWYG en modules ES, + app Electron dans `designer/electron/`)
est aujourd'hui **entièrement en français**. Inventaire : **~500 chaînes UI-facing**, **aucune
centralisation** — ~90 % en littéraux JS dispersés dans 20+ fichiers, ~10 % en HTML statique
(`index.html` : `data-tip`, `title`, `placeholder`, `<h2>`). Seuls noyaux déjà factorisés :
`FR_TYPE` (humanize.js) et `LED_MODES` (registry.js, partagé firmware via schéma).

Objectif WS-1 : **anglais par défaut**, **packs de langue additionnels** chargeables, **choix dans
les Settings**. Le designer reste pleinement utilisable en français (le FR devient le premier pack).

## Principe

- **Anglais = langue de base**, intégrée au bundle (source de vérité + fallback garanti).
- **Les autres langues = packs `.json`** découverts via un **manifeste** `i18n/index.json`,
  fetchés à la demande. Mécanisme **identique** dans les 3 environnements de service
  (web servi par PC, app Electron, designer embarqué servi par le device).
- **Catalogue plat à clés namespacées** ; une fonction `t(key, params?)` à fallback en cascade.
- **Changement de langue ⇒ reload de la page** (le layout est auto-persisté en localStorage, rien
  n'est perdu).
- **Infra d'abord, prouvée sur un pilote**, puis extraction par lots du reste.

## Décisions verrouillées (brainstorm)

1. **Système ouvert** de packs de langue (pas figé à EN/FR).
2. **EN intégré au bundle** (import statique, jamais fetché) ; FR & autres = packs `.json` fetchés.
3. **Découverte par manifeste** `i18n/index.json` (uniforme web/Electron/device). Pas de scan fs,
   pas d'UI d'upload, pas de localStorage-import en v1 (le manifeste suffit).
4. **Catalogue plat à clés à points** (`'toast.page_added'`), pas d'arborescence imbriquée.
5. **Changement de langue ⇒ `location.reload()`** (pas de switch à chaud).
6. **EN strict par défaut** au premier lancement (pas de détection `navigator.language`).
7. **Périmètre WS-1 = infra complète + pilote validé end-to-end** ; les ~450 chaînes restantes =
   lots d'extraction suivants, même mécanique.

## Architecture

### Disposition des fichiers

```
designer/i18n/
  en.js          catalogue EN : module ES, `export default { 'cle': 'texte', … }`.
                 SOURCE DE VÉRITÉ. Importé statiquement par le moteur ⇒ fallback garanti
                 même sans réseau / fichiers.
  index.json     manifeste des packs additionnels :
                 [ { "code": "fr", "name": "Français", "file": "fr.json" } ]
  fr.json        pack FR (= le français actuel, ré-encodé en clés). Fetché à la demande.
designer/js/i18n.js   moteur : t(), chargement de langue, scan HTML statique.
```

- `i18n/` est servi en statique partout ; fetch **relatif à `index.html`** (`fetch('i18n/<code>.json')`)
  ⇒ un seul chemin marche en web (`./i18n/…`), device (`/designer/i18n/…`) et Electron (`app://…/i18n/…`).
- `tools/stage_fs.sh` stagera **tout** `designer/i18n/` dans `data/` (comme `designer/`+`schema/`) pour
  le device. Poids attendu d'un pack ≈ quelques dizaines de Ko (négligeable pour LittleFS). ⚠️ `en.js`
  **doit** être stagé : il n'y a **pas de bundler**, c'est un **module ES importé** par `js/i18n.js`
  (`import EN from '../i18n/en.js'`) → absent du device, l'import donne un 404 et le moteur ne charge
  pas. « Intégré au bundle » = importé statiquement (jamais fetché comme un pack), pas « absent du disque ».

### Catalogue plat, clés namespacées

```js
// designer/i18n/en.js
export default {
  'toast.page_added':  'Page added',
  'comp.bar.label':    'Bar',
  'inspector.color':   'Color',
  'default.comp.text': 'Text',   // namespace 'default.*' = CONTENU injecté dans le layout (cf. Validation)
  // …
}
```

Le **namespace** (préfixe avant le premier `.`) organise sans imbrication. Convention de namespaces
(à figer au plan, indicative) : `toolbar.*`, `panel.*`, `inspector.*`, `comp.*` (labels de types),
`field.*` (libellés de champs), `select.*` (options de selects), `led.*` (modes), `toast.*`,
`status.*`, `console.*`, `confirm.*`, `validate.*` / `humanize.*`, `device.*`, `settings.*`,
`menu.*` (Electron), **`default.*`** (contenu par défaut des composants — soumis à Latin-1).

### `t(key, params?)` — moteur

```
t('toast.page_renamed', { name: 'Accueil' })
  1. résolution :  current[key] ?? EN[key] ?? key      // jamais d'écran vide : au pire la clé brute
  2. interpolation : remplace chaque {x} par params.x
```

- `current` = catalogue de la langue active : `EN` si langue = `en`, sinon le pack `.json` chargé.
- Le `?? EN[key]` assure le **fallback par clé** : une clé absente d'un pack incomplet retombe sur
  l'anglais (jamais sur du vide). Le `?? key` est le filet ultime (clé jamais définie nulle part).
- Interpolation **minimale** par placeholders nommés `{name}`, `{n}`. Pas de moteur de pluriel
  lourd : les rares pluriels (`X erreur(s)`) se traitent par clés distinctes, ou un helper
  `plural(n, singKey, plurKey)` si nécessaire — **à fixer au plan**.

### Chargement au boot (`i18n.js`)

1. Lire la langue choisie depuis les settings persistés (`rt-designer-settings`, store existant ;
   défaut `'en'`).
2. `'en'` ⇒ `current = EN`. Sinon `fetch('i18n/<code>.json')` ⇒ `current = pack` (échec de fetch ⇒
   fallback EN + entrée journal ; jamais de plantage).
3. Appliquer : `applyStaticI18n(document)` (HTML statique) ; le chrome JS est rendu par les modules
   qui appellent `t()` à chaque `render()` (résolution **au render**, pas capturée au boot).

## Application

### 1. HTML statique (`index.html`)

Attributs marqueurs scannés une fois au boot, le texte FR restant **en fallback de dernier recours** :

```html
<h2 data-i18n="panel.layers">Calques</h2>
<button data-i18n="toolbar.export" data-i18n-title="toolbar.export.tip">Exporter JSON</button>
<input data-i18n-placeholder="device.url.ph" placeholder="http://192.168.1.35">
```

`applyStaticI18n(root)` parcourt `[data-i18n]` (→ `textContent`), `[data-i18n-title]` (→ `title`),
`[data-i18n-placeholder]` (→ `placeholder`), `[data-i18n-tip]` (→ `data-tip`, l'attribut maison de
tooltip), et écrit via `t()`.

### 2. JS dynamique

Chaque littéral UI-facing devient `t('…')`. La résolution se fait **au render** (les modules
re-render via `render()`), cohérent avec le reload. Interpolation pour les messages variables
(`t('toast.page_renamed', { name })`, `t('validate.too_many_components', { n, max })`).

### 3. Sélecteur de langue (Settings)

- Au boot / à l'ouverture de Settings : `fetch('i18n/index.json')` peuple un `<select>` =
  **English** (intégré, toujours en tête) + chaque pack du manifeste, affiché par son `name` natif
  (« Français »). Manifeste introuvable/illisible ⇒ EN seul + journal.
- `change` ⇒ écrire la langue dans `rt-designer-settings` ⇒ **`location.reload()`**.
- Indicateur de complétude **optionnel** : à la sélection, signaler « pack FR : 480/500 clés
  (20 → anglais) » en comparant `Object.keys(pack)` à `Object.keys(EN)` (utile pour les packs tiers).

## Validation des packs — lien WS-2 (Latin-1)

Deux natures de chaînes dans le catalogue :

- **Chrome du designer** (la grande majorité) : rendu par le **navigateur** ⇒ **tout Unicode autorisé**.
- **Contenu par défaut** des composants (namespace **`default.*`**, ex. `default.comp.text` =
  `Text`/`Texte`) : valeurs **injectées dans le layout** et **rendues par le device** ⇒ **doivent
  rester Latin-1** (`^[\x20-\x7E\xA0-\xFF]*$`, le plafond posé par WS-2, = ce que les fontes du
  device rendent).

Au chargement d'un pack, `i18n.js` valide Latin-1 **sur les seules clés `default.*`**. Violation ⇒
**fail loud gracieux** : la clé fautive retombe sur l'anglais (Latin-1 garanti) + avertissement/journal
nommant la clé. Le reste du pack s'applique normalement (on ne rejette pas tout le pack pour une clé —
le chrome reste traduit). C'est la « contrainte induite » que WS-2 demandait de porter ici.

## Intégration Electron (menus natifs)

- `main.js` (process principal, CommonJS) **n'importe pas** le catalogue.
- Le **renderer** (qui possède `t()`) pousse les ~8 libellés de menu **déjà traduits** au main **via
  IPC** au boot (`preload.js` expose un canal ; `window.desktop` existe déjà). Le main (re)construit
  le menu **Fichier** avec ces libellés.
- Au reload (changement de langue), le renderer renvoie les nouveaux libellés ⇒ menu reconstruit.
  **Une seule source de catalogue** (le renderer), pas de duplication de la logique de fallback.

## Pilote v1 + lots suivants

Le pilote couvre **les 3 mécanismes** (HTML statique, JS dynamique, Electron) pour prouver l'infra :

| Zone | ~Chaînes | Ce que ça prouve |
|---|---|---|
| `index.html` (chrome statique complet) | ~50 | scan `data-i18n` / title / placeholder / data-tip |
| Toasts + barre de statut (`app.js`, `statusbar.js`) | ~33 | `t()` en flux JS dynamique + interpolation |
| Settings (`settings.js`) | ~20 | `t()` + héberge le **sélecteur de langue** |
| Menus Electron (`main.js`, `preload.js`) | ~8 | l'intégration IPC |

≈ **110 chaînes**. Infra prouvée ⇒ **lots suivants** (même mécanique, chacun son cycle léger
extraction → EN + `fr.json` → tests) : registry (~200), humanize/validate (~60), inspecteur (~30),
sources/device-panel/console/tree/carousel (~50).

> **Note sur `default.*` en pilote** : le pilote est du **chrome** pur (aucun contenu par défaut de
> composant). La **capacité** de validation Latin-1 de `default.*` fait donc partie de l'infra (moteur
> + `i18n.test.js` avec clés `default.*` synthétiques), mais le **peuplement réel** des clés `default.*`
> (mappées depuis `defaults()` du registre) arrive au **lot registry**, où `defaults()` appellera `t()`.

## Traduction

L'agent produit le **catalogue EN** (en traduisant le FR actuel) + le **pack `fr.json`** (= le
français existant ré-encodé en clés). L'utilisateur valide la qualité de l'anglais. Le FR reste la
« vérité » de départ (c'est l'UI actuelle).

## Tests (`node --test` du designer)

Le moteur est du code pur ⇒ testable hors DOM :

- **`i18n.test.js`** :
  - `t()` : lookup direct ; clé manquante dans le pack → fallback EN ; clé absente partout → clé
    brute ; interpolation `{x}` (un et plusieurs placeholders).
  - **Validation Latin-1** : accepte les accents (`Météo`, `°C`), rejette emoji/CJK — **sur `default.*`
    uniquement** ; une clé de chrome non-Latin-1 est acceptée.
  - **Complétude** : toute clé d'un pack existe dans EN ; le catalogue EN couvre toutes les clés
    émises par la zone pilote (test de non-régression d'extraction).
- **`applyStaticI18n`** : test de contrat sur le parcours d'attributs (fragment DOM minimal ou
  vérification du mapping attribut→propriété) — harnais exact **à fixer au plan**.
- Garde anti-régression : `cd designer && node --test` reste vert.

## Vérification (manuelle, fin de pilote)

- **Navigateur** : boot EN par défaut ; bascule FR → reload → chrome FR ; pack tronqué → clés
  manquantes affichées en EN ; pack avec `default.*` non-Latin-1 → avertissement + fallback EN ;
  menu Electron dans la langue choisie.
- **Parité device** : déjà acquise (WS-2 — `Météo`/`°C` rendus net). Reconfirmer qu'un
  `default.comp.text` localisé poussé au device s'affiche net (pas de tofu).

## Scope & parité

- **100 % designer** : `designer/` + `designer/electron/`. **Firmware/schéma intacts**
  (`src`/`lib`/`schema`/`designer/js/render.js`). Garde-parité au plan :
  `git diff --name-only main -- src lib schema designer/js/render.js` doit rester **vide**.
- Le contenu par défaut localisé n'écrit que des valeurs **Latin-1** légitimes dans le layout
  (garanti par la validation `default.*`) ⇒ parité de rendu préservée.

## Hors-scope v1

- Extraction des **~450 chaînes restantes** (registry, humanize/validate, inspecteur, sources,
  device-panel, console, tree, carousel) → **lots suivants**.
- **UI d'upload de pack** / **scan fs réel en Electron** / **import localStorage** — le manifeste
  suffit (réexaminable plus tard si un besoin réel d'ajout dynamique émerge).
- **Détection auto** de la langue du navigateur (`navigator.language`) — EN strict par défaut.
- **Pluralisation avancée** (CLDR) — placeholders + clés/helper simples suffisent.
- Élargissement du subset de fontes au-delà de Latin-1 — indépendant (cf. WS-2).
