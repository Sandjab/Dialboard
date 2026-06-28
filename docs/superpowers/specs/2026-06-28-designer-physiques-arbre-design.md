# Sorties physiques comme composants statiques du Document (dans l'arbre)

- **Date** : 2026-06-28
- **Branche** : `feat/designer-physiques-arbre`
- **Statut** : design validé (brainstorm en conversation), spec à relire avant plan d'implémentation
- **Scope** : 100 % designer. Le firmware, le schéma et `render.js` restent intacts.

## Problème

Les composants **physiques** (`led_ring`, `sound`) — sorties globales permanentes, sans placement —
sont édités dans un **panneau séparé** : le tiroir Device, onglet « Sorties physiques »
(`device-panel.js`). Le tiroir a deux onglets : « Sorties physiques » et « Sources pull ».

Ce panneau dédié est une surface UI distincte pour deux composants qui sont, sur le fond, des
composants du **document** comme les autres (ils vivent dans `state.components`). L'objectif : les
présenter comme **composants statiques du Document dans l'arbre des calques**, et les éditer dans
l'**inspecteur** comme tout autre composant — en supprimant le panneau séparé.

## État vérifié (source de vérité)

### Arbre (`tree.js`)
- `treeModel(state)` ne lit que les `place[]` de chaque page → les physiques (sans placement)
  **n'apparaissent jamais** dans l'arbre. Structure rendue : `{ title, pages:[{ index, name,
  components }] }`.
- `render()` pose un nœud **Document** (`tree-doc`) **non dépliable** (caractère `⚙` décoratif,
  pas de twist actif), puis les pages (chacune dépliable, avec ses `compRow`).
- `compRow` : icône (`iconFor(type)`) + nom/type (cf. commit `a29657f` : nom en `.tree-label`
  blanc, type en `.tree-ref` grisé), œil de visibilité, drag & drop (reorder/move), renommage
  inline d'id (double-clic → `renameComponent`), menu contextuel (`contextMenuItems`).

### Sélection (`selection.js`, pur testé)
- Formes : `{kind:'doc'}` | `{kind:'page', page}` | `{kind:'comp', page, index}` | `null`.
- `sameSelection`, `isSelectionValid`, `placementSelection` discriminent sur `kind`.
- `placementSelection(sel, activePage)` renvoie déjà `null` pour tout `kind !== 'comp'`.

### Inspecteur (`inspector.js`)
- `currentSel()` : `s.kind !== 'comp'` → `null` ; sinon **exige un placement**
  (`pages[s.page].place[s.index]`) → `{ placeIndex, page, ref }`. Un physique (sans placement)
  donne donc `null` aujourd'hui → rien ne s'affiche.
- `render()` : `c = comp()` → `renderComp` ; sinon `doc`/`page`/`renderEmpty`.
- `renderComp` **gère déjà les types physiques** : gardes `!COMPONENTS[c.type].physical` (pas
  d'œil d'en-tête, pas de bouton « cacher sur device »), itère `compFields`, appelle
  `renderExtras`. Ce code est aujourd'hui **inatteignable** (un physique n'est jamais sélectionné).
- `renderExtras` : `placeFields` (sautés si vides), seuils/états (selon type), `mockFields`
  (valeur mock). **N'inclut PAS** l'aperçu visuel de l'anneau LED.
- Vue Document (`renderDoc`) : lien `inspector.link.device` → `openDrawer()` (ouvre le tiroir).

### Registre (`registry.js`)
- `led_ring` : `physical:true, singleton:true`, `defaultId:'led'`, defaults
  `{color:'#FFFFFF', brightness:64, mode:'off'}`, `compFields` = couleur/luminosité/mode/période
  (période grisée hors `spinner|blink|breathe`), `placeFields:[]`, `mockFields:[['value',…]]`.
- `sound` : `physical:true`, `defaultId:'buzz'`, defaults `{type:'sound'}`, `compFields:[]`,
  `placeFields:[]`, `mockFields:[]`.
- `iconFor` fournit déjà des icônes `led_ring` et `sound` (`icons.js`).

### Panneau Device (`device-panel.js`) — à supprimer
- Pour chaque `physicalComponentIds(state)` : carte `.src-card`, titre `${id} · ${label}`
  renommable (double-clic → `renameComponent`), `compFields`, note pour `sound`
  (`device.note_sound`), valeur mock, **mini-anneau** (`paintRing`/`ledFrame`) + bouton **▶ aperçu
  animé** (`ledFrameAt` + `requestAnimationFrame`, `stopPreview` au rebuild).
- Helpers d'aperçu : `led-ring-preview.js` (`paintRing`, `ledFrame`, `ledFrameAt`) et `mocks.js`
  (`getMock`/`setMock`) — **réutilisables**, conservés.

### Tiroir (`drawer.js`, `index.html`)
- `drawer.js` gère 2 onglets (`device`/`sources`), panneaux `#device-pane`/`#sources-pane`,
  `setTab('device')` par défaut.
- `index.html` : tiroir intitulé « Device », `.drawer-tabs` (2 boutons), `#device` (monté par
  `createDevicePanel`) et `#sources`.
- Toolbar : bouton `drawer-toggle` (tooltip « sorties physiques / sources »).

### Helpers physiques (`physical.js`, purs testés)
- `physicalComponentIds(state)`, `isPhysicalType`, `physicalTypes`, `ensurePhysicals`,
  `stripPhysicalPlacements`, `pruneOrphans`. **Suffisants**, pas de changement requis.

## Décisions (brainstorm)

1. **Emplacement** : les physiques sont **enfants du nœud Document** dans l'arbre (au-dessus des
   pages). Le nœud Document devient **dépliable**, **déplié par défaut**.
2. **Édition** : sélectionner un physique dans l'arbre l'édite dans l'**inspecteur**, avec
   **parité complète** — y compris le **mini-anneau** et le **bouton ▶ aperçu animé** (portés
   depuis `device-panel.js`).
3. **Tiroir** : l'onglet « Sorties physiques » est **retiré** ; plus de barre d'onglets ; le tiroir
   devient un **panneau unique « Sources »**.
4. **Comportements des physiques dans l'arbre** : **pas de drag, pas d'œil, pas de suppression**
   (permanents, sans placement). **Renommage** d'id : double-clic (inline) + menu contextuel
   **« Renommer » seulement**.
5. **Hors-scope** : aucun changement firmware/schéma ; pas de multi-buzzer ; pas de nouvelle config
   `sound`.

## Architecture & modules

### `js/selection.js`
- Nouvelle forme : `{ kind:'physical', ref }` (composant global ; ni `page` ni `index`).
- `sameSelection` : `if (a.kind === 'physical') return a.ref === b.ref;`.
- `isSelectionValid` : `if (sel.kind === 'physical') return !!state.components?.[sel.ref];`.
- `placementSelection` : **inchangé** (`kind !== 'comp'` → `null`) → le canvas ne surligne rien.
- Mettre à jour le bloc de commentaire des formes de sélection.

### `js/tree.js`
- `treeModel` : ajouter `physicals: physicalComponentIds(state).map(ref => ({ ref,
  type: comps[ref].type, label: t(COMPONENTS[type].label) }))` au retour (hors `pages`).
- Nœud **Document dépliable** : remplacer le `⚙` décoratif par un vrai twist (▾/▸,
  `stopPropagation` sur le twist = plier/déplier ; clic sur le reste = `setSelection({kind:'doc'})`).
  Nouvel état `expandedDoc` (défaut **true**).
- Nouvelle `physicalRow(phys, sel)` : icône (`iconFor`) + nom (`ref`, `.tree-label`) + type
  (`label`, `.tree-ref`). `selected` si `sel.kind==='physical' && sel.ref===phys.ref`. Clic →
  `setSelection({kind:'physical', ref})`. Double-clic → renommage inline (réutilise la logique de
  `compRow` : `renameComponent`, `isValidId`, garde d'unicité, toast). Menu contextuel : items
  `[{id:'rename'}]` (cf. `contextmenu.js`). **Pas** de `draggable`, **pas** d'œil, **pas** de delete.
- `render()` : sous le nœud Document, si `expandedDoc`, rendre les `physicalRow` (avant les pages).
- `selection.subscribe` : `if (sel.kind==='physical') expandedDoc = true` (sélection depuis
  l'inspecteur/Échap re-déplie le Document).
- `beginRename` / `runMenu` : gérer `kind:'physical'` (renommage inline ; pas d'autre action).

### `js/contextmenu.js`
- `contextMenuItems` : `if (sel.kind === 'physical') return [{ id:'rename', label:t('ctx.rename_id') }];`.

### `js/inspector.js`
- `currentSel()` : ajouter, avant le test `comp` placement-dépendant —
  `if (s.kind === 'physical') return { ref: s.ref, physical: true };` (sans `page`/`placeIndex`).
- `comp()`/`place()` : inchangés (`place()` → `null` car `sel.page` indéfini).
- `renderComp` : pour `sound` (compFields vides), afficher la **note** `device.note_sound` sous
  l'en-tête (parité avec l'ancien panneau).
- **Aperçu LED** (port depuis `device-panel.js`) : dans `renderComp` (ou `renderExtras`), cas
  `c.type === 'led_ring'` → mini-anneau (`paintRing`/`ledFrame`) + bouton **▶** (`ledFrameAt` +
  `requestAnimationFrame`). Gérer un `ledPreviewRaf` annulé **au début de `render()`** (même
  discipline que `_aimgPreviewTimer`) pour ne pas animer un nœud détaché. `updateMini` sur `change`
  (mode/couleur/luminosité/valeur mock) et garde-focus respecté.
- `renderDoc` : le lien `openDrawer` cible désormais les Sources (relibellé, cf. i18n).

### `js/app.js`
- Retirer l'import et l'appel `createDevicePanel($('device'), model)`.

### `js/drawer.js`
- Supprimer la logique d'onglets (un seul panneau Sources) ; plus de `setTab('device')`. Garder
  `open()`/`close()` et le montage de `#sources`.

### `index.html`
- Tiroir : titre « Device » → « Sources » (`drawer.sources.title`), retirer `.drawer-tabs`,
  retirer `#device-pane`/`#device`. Conserver `#sources`.
- Toolbar : tooltip du `drawer-toggle` → « Sources ».

### `js/device-panel.js`
- **Supprimé** (logique LED portée dans l'inspecteur ; helpers `led-ring-preview.js`/`mocks.js`
  conservés et réutilisés).

## i18n (parité EN ↔ FR à tenir)

- **Réutilisés** (usage déplacé vers l'inspecteur) : `device.note_sound`, `device.preview`,
  `device.preview_stop`, `device.rename_tip` (ou équivalents `inspector.*` si renommage souhaité —
  tranché au plan, par défaut : réutiliser tels quels pour minimiser le churn).
- **Retirés/renommés** : `drawer.device.title` → `drawer.sources.title` ;
  `drawer.tab.outputs`/`drawer.tab.sources` (plus d'onglets) ; `inspector.link.device*` →
  libellé « Sources » ; tooltip `toolbar.device.*` du drawer-toggle.
- Toute clé `t('…')` statique doit exister au catalogue ; **EN (`en.js`) et FR (`fr.json`)
  strictement alignés** (script de parité du projet).

## Flux

```
arbre : ⚙ Document (dépliable, déplié par défaut)
          ◉ led    led_ring   ─ clic ─▶ sélection {kind:'physical', ref:'led'}
          ♪ buzz   sound                     │
        ▸ Page 1                              ▼
        ▸ Page 2                       inspecteur renderComp (parité + aperçu LED)

tiroir : panneau unique « Sources » (plus d'onglets, plus de #device)
```

## Parité & firmware

- **100 % designer.** `src/`, `lib/`, `schema/`, `render.js` **intacts**.
- `led_ring`/`sound` restent globaux sans placement → **aucune régression device**.

## Tests & vérifs

- `node --test` :
  - `selection.js` : `sameSelection`/`isSelectionValid` pour `{kind:'physical', ref}` (égalité par
    ref ; validité = composant présent) ; `placementSelection` renvoie `null` pour un physique.
  - `tree.js` (`treeModel`) : les physiques sont dans `physicals` (par ref) et **jamais** dans
    `pages[].components` ; ordre/contenu (ref + type + label).
  - `contextmenu.js` (`contextMenuItems`) : `physical` → un seul item `rename`.
- Vérif **navigateur** (DOM ; no-store + vrais events pointer, cf. mémoire) :
  - Document déplié par défaut ; `led`/`buzz` listés sous le Document avec icône, nom en tête,
    type grisé.
  - Clic → inspecteur (led_ring : champs + mini-anneau + ▶ aperçu animé fonctionnel ; sound : note).
  - Renommage d'id (double-clic + menu contextuel) avec garde d'unicité/toast ; le routage `/update`
    suit le nouvel id.
  - Pas de drag/œil/suppression sur les physiques ; un physique sélectionné ne dessine **aucun**
    cadre sur le canvas.
  - Tiroir = panneau « Sources » unique (plus d'onglets, plus de « Sorties physiques »).
  - EN + FR : 0 clé brute, 0 erreur console.

## Hors-scope

- Toute évolution firmware/schéma.
- Donner une configuration au `sound` (reste un déclencheur pur via `/update`).
- Multi-buzzer via l'UI.
