# Designer — refonte IHM (calques · inspecteur contextuel · notifications · zone avancée)

> Spec de cadrage (brainstorming → plan). **Branche dédiée.** Refonte **structurelle** de l'IHM du designer.
> Périmètre : **designer uniquement** (web + tests node). Le **moteur de rendu canvas** (`render.js`, parité firmware)
> et le **firmware** ne sont **PAS** touchés. La **direction artistique** (thème, accent, code couleur des types, typo)
> est **hors scope** — passe dédié ultérieur.
>
> Playgrounds d'exploration (gitignorés) : `docs/_internal/playgrounds/notif-models.html`,
> `docs/_internal/playgrounds/layout-arrangements.html`. Ils illustrent **structure et comportements**, pas les couleurs.

## Intent

L'IHM actuelle (`designer/index.html`) a quatre faiblesses identifiées :

1. **Zone globale « fourre-tout » mal intégrée** — un `<footer>` à trois `<details>` (Device / Sources / JSON) sépare
   visuellement des réglages pourtant centraux.
2. **Notifications primitives et dispersées** — trois canaux concurrents : `#status` (header) pour la progression *et*
   le verdict, `showToast()` en bas, `devbar` pour l'état device. Aucun spinner ; la « progression » est un `…` textuel.
3. **Inspecteur à démarcation floue** — il sert layout + page + composant sélectionné sans séparation claire de ce que
   l'on édite.
4. **Pas de vue de structure** — aucun arbre des pages/composants. Naviguer, réordonner le z-index, retrouver un
   composant masqué/superposé se fait à l'aveugle ou via le canvas.

Cette refonte pense l'IHM **comme un tout** : une disposition « éditeur » assumée, un **arbre des calques** comme
colonne vertébrale, un **inspecteur piloté par la sélection**, et des **notifications unifiées**. Elle ne change ni le
format `layout.json` (sauf mutations internes d'ids) ni le rendu device.

## Décisions (validées en brainstorming)

| # | Décision | Pourquoi |
|---|---|---|
| Contexte | **Desktop large uniquement** (≥ 1280px) | Outil d'édition perso ; pas de contrainte tactile/mobile → 4 zones denses assumées. |
| Disposition | **Arrangement A — « dock classique »** | Familier (Figma/Sketch), palette + calques côte à côte, transition douce depuis l'existant. B (barre d'activité) sur-dimensionné pour 4 panneaux ; C (palette en toolbar) surcharge la barre. |
| Globales | **Hybride** | Params de layout (titre/fond/nav) = nœud **Document** dans l'inspecteur (ils touchent au visuel) ; sorties + sources = **tiroir** séparé (plomberie I/O, logique distincte). |
| Notifications | **Modèle A** (toasts unifiés + spinner) **+ barre d'état + verrou busy** | Un seul foyer d'attention ; le toast « en cours » se *mue* en verdict ; l'état device permanent = pastille toolbar ; une opération en vol **interdit** d'en lancer une autre. |
| Inspecteur | **Contextuel** (Document / Page / Composant) | La **sélection pilote** l'inspecteur → la démarcation disparaît. |
| Arbre | **Remplace les onglets `nav#pages`** ; mono-sélection ; drag = reorder *et* déplacer entre pages ; renommer = l'**id** | Une seule surface de structure ; conventions usuelles. Multi-sélection **différée** (touche inspecteur + mutations groupées). |
| JSON | **Lecture seule + copier** (debug/transparence) ; **validation décrochée** | L'édition brute est un *smell* face à WYSIWYG + arbre + Import/Export. La validation tournait déjà en continu sur le modèle (`json-view.js`) : on la **promeut** dans la barre d'état. |

## Architecture cible — les zones (Arrangement A)

```
┌─ Toolbar ───────────────────────────────────────────────────────────┐
│ ◉ Dialboard   ● 192.168.1.35   ↶ ↷  │ URL Charger Pousser Statut … │ ⚙ Device │
├──────────────┬──────────────────────────────┬───────────────────────┤
│ ▸ Palette    │                              │  Inspecteur            │
│  (repliable) │                              │  [contextuel selon     │
├──────────────┤           Canvas             │   la sélection :       │
│  Calques     │        (écran rond,          │   Document / Page /    │
│  ⚙ Document  │      moteur inchangé)        │   Composant]           │
│  ▾ 1.Accueil │                              │                        │
│      RING …👁 │                              │                        │
│  ▸ 2.Détails │                              │                        │
├──────────────┴──────────────────────────────┴───────────────────────┤
│ Barre d'état : <contexte sélection>      │  ✓ valide · 🔍 zoom        │
├──────────────────────────────────────────────────────────────────────┤
│ (Console repliable, cachée par défaut)  [ Problèmes | Source ]   ▲▼   │
└──────────────────────────────────────────────────────────────────────┘
                                              ⚙ Device → tiroir latéral
                                              [ Sorties physiques | Sources pull ]
```

Découpage en modules à responsabilité unique (chacun testable/compréhensible isolément) :

- **`tree.js`** (neuf) — l'arbre des calques. Lit le modèle, écrit via mutations, pilote la sélection partagée.
- **`inspector.js`** (refondu) — rend la vue Document / Page / Composant selon `selection.kind`.
- **`statusbar.js`** (neuf) — barre du bas : contexte de sélection + validation + zoom ; ouvre la console.
- **`console.js`** (neuf) — panneau bas repliable [Problèmes | Source].
- **`drawer.js`** (neuf) — tiroir latéral [Sorties | Sources], héberge `device-panel.js` / `sources.js`.
- **`toast.js`** (étendu) — pile unifiée + toast à spinner muable en verdict.
- **`selection.js`** (neuf, petit) — source de vérité de la sélection `{kind, page, ref}` + abonnés.

## 1. Arbre des calques — `tree.js` (neuf)

**Structure.** L'arbre **absorbe et remplace** la barre d'onglets `nav#pages` (sélectionner une page dans l'arbre = la
rendre active). Trois niveaux :

```
⚙  Document — <title>                     ← racine, params globaux (inspecteur Document)
▾  1. Accueil                    ✎ ⧉ ✕    ← pages dans l'ordre de navigation (= ordre pages[])
     RING  temp_ring                 👁
     TXT   temp_val                  👁
     LBL   salon_lbl                 👁
     IMG   logo_bg                   🚫    ← visible:false → ligne grisée, œil barré
▸  2. Détails
▸  3. Réglages
```

- **Composants en z-order inversé** : `pages[pi].place` est rendu **renversé** (dernier placement = dessus = en
  premier dans l'arbre).
- **Sélection unique** (`selection.js`) pilote inspecteur + canvas + barre d'état. Esc désélectionne (existant).
- **Œil** = la **même brique** que l'œil d'en-tête inspecteur (conçu pour ça dans le spec `visible-config-toggle`,
  cf. `inspector.js` `hasVisible(type)` + prop `visible`). Toggle → `setComponentProp(s, ref, 'visible', …)`.
- **Affordances (conventions usuelles)** : survol → `✎ renommer / ⧉ dupliquer / ✕ supprimer` ; **clic droit** = menu
  contextuel (mêmes + couper/copier/coller, monter/descendre dans le z-order, déplacer vers une page) ; **clavier**
  déjà câblé (`shortcuts.js` : Cmd+D/C/V, Suppr, Échap) — **ajouter F2 = renommer**.
- **Pas d'œil sur les pages** (la visibilité est une notion de composant ; « page cachée » n'existe pas côté firmware).
- **Pages** : triangle de pliage, drag pour réordonner (réutilise `reorderPages`), rename inline (réutilise
  `renamePage` + garde-doublon existant), `⧉` dupliquer, `✕` supprimer (garde ≥ 1 page), `+ Page` dans l'en-tête.

**Drag & drop.**
- Dans une page → **réordonne le z-index** : nouvelle mutation `reorderPlacement(state, pageIndex, from, to)`.
- Sur un autre nœud page → **déplace** le placement : nouvelle mutation `movePlacementToPage(state, fromPage, placeIndex, toPage)`.
- Copier/coller (existant) reste pour **dupliquer** cross-page ; drag = **déplacer**.

**Invariants à préserver** (cf. `CLAUDE.md` « invariants inspecteur/canvas ») : changer la sélection depuis l'arbre
doit `blur()` un champ inspecteur focalisé **avant** de muter `selection` (garde F1), et les closures de commit figent
`ref` au rendu (garde F5). La sélection partagée centralise ce garde-fou.

## 2. Inspecteur contextuel — `inspector.js` (refondu)

L'inspecteur lit `selection.kind` et rend **une** des trois vues (en-tête explicite = démarcation) :

- **Document** — `title`, `background` (couleur), `nav.wrap` (Boucler/Buter). Lien « Ouvrir la plomberie → » (tiroir).
- **Page** — `name`, fond de page (override couleur, sinon hérite global), image de fond (UI fond de page existante,
  `bg-image.js`).
- **Composant** — l'inspecteur **actuel** (props/géométrie/seuils/aperçu mock + œil d'en-tête + bouton device
  `visible`), inchangé dans son contenu ; seul son **point d'entrée** passe par la sélection.

Le contenu composant existe déjà (registry/compFields) ; la refonte **réorganise l'aiguillage**, elle ne réécrit pas
les éditeurs de champs. Les gardes F1–F5 restent en vigueur.

## 3. Notifications unifiées + verrou busy — `toast.js` (étendu), `app.js`

**Modèle A.** Pile unique de toasts (haut-droite). Un helper `makeToast(text, kind)` où `kind ∈ {progress, ok, err}` ;
un toast `progress` porte un **spinner** et expose `morph(text, kind, autoMs)` → il se transforme en verdict *sur place*
(pas de clignotement, pas de second toast). Actions :

- **Instantanée locale** (export, copie) → toast verdict immédiat.
- **Longue device** (`/layout` load/push, `/screenshot`, `/status`, `/update`) → toast `progress` qui se mue en
  succès/échec.

**Suppression** des canaux concurrents : `#status` (header) disparaît ; `devbar` → **pastille device** dans la toolbar
(état permanent : `● ip` connecté / `○ injoignable`) + résumé (`page x/n · sources …`) en infobulle/barre d'état.

**Verrou de concurrence.** Un état `busy` global : pendant une requête device en vol, **les autres actions device sont
désactivées** (boutons `disabled`, ré-entrée bloquée). Implémentation : un wrapper `withBusy(fn)` dans `app.js` qui
pose/lève `busy`, désactive le groupe device, et empêche le double-lancement. (Les éditions locales — inspecteur,
arbre, undo — **ne sont pas** bloquées : seules les I/O réseau le sont.)

## 4. Barre d'état — `statusbar.js` (neuf)

Toujours visible, deux segments :

- **Gauche — contexte de sélection** (lu sur `selection`) : Document → `N pages · M composants` ; Page →
  `Page « <nom> » (i/n) · M composants` ; Composant → `<type> · <ref> · page <nom> · x… y… · visible|masqué`.
- **Droite — ambiant** : **validation** (`✓ valide` / `✗ N erreurs` / `⚠ N avert.`, **cliquable** → ouvre la console
  Problèmes) + **zoom** (le `<select>` actuel migre ici, display-only).

La pastille device (connexion) vit dans la **toolbar** (modèle A), pas dans la barre d'état → pas de doublon.

## 5. Zone avancée — tiroir Device · console Problèmes/Source · validation

**Tiroir `⚙ Device`** (`drawer.js`, slide-over latéral droit) à deux onglets, réutilise l'existant tel quel :
- **Sorties physiques** — `device-panel.js` / `physical.js` (led_ring, sound).
- **Sources pull** — `sources.js` (add/remove source, url, intervalle).

**Console bas repliable** (`console.js`), **cachée par défaut**, deux onglets :
- **Problèmes** — liste des `errors`/`warnings` de `validate(model.state)` (déjà humanisés). Ouverte au clic sur
  `✗ N erreurs` de la barre d'état (résumé → détail).
- **Source** — `model.toJSON()` en **lecture seule** + bouton **Copier**. Plus de textarea éditable, plus de bouton
  « Appliquer », plus de garde « Modifs JSON non appliquées ».

**Validation décrochée.** `json-view.js` est **scindé** : la partie validation (`runValidation`) alimente désormais la
barre d'état + la console Problèmes (abonnée au modèle, comme aujourd'hui) ; la partie textarea devient la vue Source
lecture seule. `validate.js` est réutilisé inchangé.

## 6. Globales — nœud Document (inspecteur)

Le nœud racine **Document** de l'arbre, sélectionné, montre dans l'inspecteur les params globaux (`title`,
`background`, `nav.wrap`). Cohérent avec la décision hybride : les globales *visuelles* vivent dans l'inspecteur ; la
*plomberie* dans le tiroir.

## Nouvelles mutations — `mutations.js` (pures, testées node)

Dans le moule existant (fonctions pures, tests `node --test`) :

- `reorderPlacement(state, pageIndex, from, to)` — bouge un placement dans `pages[pi].place` (z-order).
- `movePlacementToPage(state, fromPage, placeIndex, toPage)` — retire de `place` source, pousse sur `place` cible (le
  composant reste dans la map `components` globale ; seul le placement migre).
- `renameComponent(state, oldId, newId)` — renomme la **clé** de `components` + **tous** les `place[].ref` qui la
  pointent ; **garde d'unicité** (rejet si `newId` existe). L'id n'est pas poussé comme texte d'affichage → pas de
  contrainte ASCII dessus.

## Modèle de données — points de contact

- `pages[]` ordonné = ordre de navigation device (inchangé). `pages[pi].place[]` ordre = z-index (dernier = dessus).
- `components{}` map id→def, **sans position** ; contient aussi `led_ring`/`sound` (sorties physiques, non placées →
  **n'apparaissent pas** dans l'arbre, vont au tiroir).
- `sources[]` = pull réseau → tiroir.
- **Aucune** clé de schéma ajoutée. Les renommages d'id sont des réécritures internes du même format.

## Tests

Contrainte existante (Rule 11) : `node --test` **sans DOM** → on teste les **fonctions pures**, pas la construction DOM.

**Unit-testables (`designer/tests/mutations.test.js`)** — les 3 nouvelles mutations :
- `reorderPlacement` : ordre attendu après déplacement ; bornes (from/to identiques, hors limites) ; *intent* = le
  z-order rendu suit l'ordre `place[]` (un test qui casse si on inverse la sémantique).
- `movePlacementToPage` : placement retiré de la source, présent sur la cible, `components` intact ; page cible
  inexistante rejetée.
- `renameComponent` : clé map renommée, tous les `ref` mis à jour, collision rejetée, *aucun* `ref` orphelin.

**Vérif navigateur (DOM, non unit-testable ici)** : rendu de l'arbre + z-order inversé ; drag reorder/move ; sélection
arbre↔canvas↔inspecteur (gardes F1/F5) ; inspecteur contextuel (3 vues) ; toasts spinner→verdict ; verrou busy
(double-clic Pousser pendant un push) ; barre d'état (validation cliquable) ; console Problèmes/Source ; tiroir Device.

## Fichiers touchés

**Neufs** : `designer/js/{tree,selection,statusbar,console,drawer}.js`.
**Refondus** : `designer/index.html` (toolbar / dock / barre d'état / console / tiroir ; suppression `nav#pages` et du
`<footer>`) · `designer/js/{app,inspector,json-view,palette,toast}.js` · `designer/style.css` (CSS **structurelle**, pas
la DA) · `designer/js/mutations.js` (+3 mutations) · `designer/js/shortcuts.js` (+F2).
**Migré** : `designer/js/pages.js` — son orchestration (page active, rename, reorder, add/remove) est **réutilisée**
par `tree.js` ; soit `pages.js` devient une couche de mutations sans UI, soit sa logique est absorbée par `tree.js`
(tranché au plan). Ne **pas** dupliquer la source de vérité de la page active (reste dans `canvas.js`).
**Réutilisés tels quels** : `device-panel.js`, `device.js`, `sources.js`, `physical.js`, `bg-image.js`, `validate.js`,
`registry.js`, `render.js`, `canvas.js` (moteur ; intégré à la sélection partagée), `model.js`.
**Tests** : `designer/tests/mutations.test.js` (+ cas).

## Phasage (l'implémentation viendra via writing-plans)

Chaque phase reste navigateur-testable, livrable indépendamment :

1. **Mutations + tests** — `reorderPlacement`, `movePlacementToPage`, `renameComponent` (pur, sans UI).
2. **Sélection partagée** — `selection.js` ; le canvas existant s'y branche (gardes F1/F5 préservés).
3. **Arbre des calques** — `tree.js` + bascule depuis `nav#pages` (retrait des onglets).
4. **Inspecteur contextualisé** — aiguillage Document/Page/Composant sur `selection.kind`.
5. **Notifications + verrou busy** — `toast.js` étendu, `withBusy`, retrait `#status`/`devbar`.
6. **Barre d'état + console + validation décrochée** — `statusbar.js`, `console.js`, scission `json-view.js`.
7. **Tiroir Device** — `drawer.js` héberge device/sources ; retrait du `<footer>`.

## Hors scope (explicite)

- **Direction artistique** — thème clair/sombre, accent, **code couleur des types** (cohérent palette/arbre/canvas),
  typo, densité. Passe **dédié** ultérieur, avec son propre playground de comparaison. Les maquettes sont en sombre
  *pour illustrer*.
- **Multi-sélection** dans l'arbre — différée (touche inspecteur « props communes », mutations groupées, undo coalescé).
- **Édition JSON brute** — supprimée (lecture seule). Toute vraie édition = inspecteur / arbre / Import-Export.
- **Firmware & moteur de rendu** (`render.js`) — intacts.

## Risques / points ouverts

- **Sélection partagée vs gardes F1/F5** : le point le plus délicat. Aujourd'hui la sélection vit dans `canvas.js` ;
  l'externaliser (`selection.js`) doit **préserver** le `blur()`-avant-changement et le `ref` figé au rendu, sinon
  régression connue (éditions au mauvais composant). À vérifier au navigateur avec soin.
- **Bascule onglets→arbre** : `pages.js` orchestre aujourd'hui page active + rename + reorder. La logique migre dans
  `tree.js` (ou `pages.js` est réutilisé comme couche de mutations) — éviter la double source de vérité de la page active
  (elle vit dans `canvas.js` via `getActivePage`/`setPage`, à conserver).
- **Ampleur** : 7 phases, ~5 modules neufs. Chaque phase doit rester **petite et verte** (Rule 4) ; le plan séquencera.
