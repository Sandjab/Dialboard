# Physiques permanents (led_ring + sound)

- **Date** : 2026-06-25
- **Branche** : `feat/designer-physiques-permanents`
- **Statut** : design validé (brainstorm en conversation), spec à relire avant plan d'implémentation
- **Scope** : 100 % designer. Le firmware, le schéma et `render.js` restent intacts.

## Problème

Les composants **physiques** (`led_ring`, `sound`) sont aujourd'hui **ajoutables / supprimables**
dans le tiroir Device, comme s'ils étaient optionnels. Or le matériel correspondant est
**permanent** sur le device (un anneau de 13 LEDs, un buzzer). Ce modèle « ajouter/supprimer pour
décider du pilotage » est artificiel :

- Pour le **led_ring**, « absent du layout » est fonctionnellement quasi équivalent à « présent en
  mode `off` » : au boot les deux donnent un anneau éteint ; un `/update` surcharge dans les deux
  cas. Le mode `off` couvre donc déjà « ne pas piloter l'anneau depuis le layout ». (Seule nuance,
  cas limite : « absent » laisse l'anneau à une source externe sans que le layout y touche ;
  « off » l'éteint activement à chaque `POST /layout`. Cas d'usage rare, abandonné.)
- Pour le **sound**, le composant n'a **aucune configuration** : son seul contenu utile est son
  **id**, qui sert de mapping `id → buzzer` pour le routage `/update`. Sa présence = « ce layout
  expose un buzzer déclenchable ».

Objectif : traiter `led_ring` et `sound` comme des **éléments permanents** du device — toujours
présents, jamais ajoutés ni supprimés, un seul de chaque — pilotés par leur état (`off` pour
l'anneau) plutôt que par leur présence.

## État vérifié (source de vérité)

### Registre / schéma
- `registry.js` : `led_ring` = `physical: true, singleton: true`, defaults `{ color:'#FFFFFF',
  brightness:64, mode:'off' }`, `build:null`. `sound` = `physical: true` (PAS singleton),
  defaults `{ type:'sound' }`, `compFields:[]`.
- `schema/layout.schema.json` : `comp_sound` = `{ type:"sound" }` uniquement — *« Buzzer physique,
  tir unique. Déclenché via /update : {tone,ms} ou {name:ok|alert|error} »*.

### Layout par défaut & firmware
- `default-layout.js` contient **déjà** `led:{type:"led_ring"}` et `buzz:{type:"sound"}`.
- Firmware (démo `view.cpp:86`) : layout par défaut a déjà `led` + `buzz`. `sound_tick`
  (sound_comp.cpp:43) itère les composants et ne joue qu'un `COMP_SOUND` avec `snd_pending` ;
  `apply_sound` (dashboard.cpp:330) est routé **par id**. → un sound permanent non déclenché est
  **silencieux** ; un led_ring permanent en `off` est **éteint**. **Aucun changement firmware.**

### Tiroir Device (`device-panel.js`)
- `physicalComponentIds(state)` → liste les composants physiques ; pour chacun, une carte `.src-card`
  avec titre `${id} · ${label}` **non éditable** + bouton **« Supprimer »** (`removeComponent`).
- En bas, une boucle sur `physicalTypes()` crée les boutons **« + LED » / « + Son »**
  (`addPhysicalComponent`), grisés via `canAddType`.

### Helpers physiques (`physical.js`, purs testés)
- `canAddType`, `addPhysicalComponent`, `removeComponent`, `physicalComponentIds`,
  `physicalTypes`, `stripPhysicalPlacements`, `isPhysicalType`.

### Renommage d'id (réutilisable)
- `renameComponent(state, oldId, newId)` (mutations.js:261) : renomme la clé + tous les
  `place[].ref`, avec garde d'unicité.
- `tree.js` a déjà un **renommage inline** d'id de composant (input `.tree-rename`, double-clic →
  `renameComponent`) à calquer pour les cartes du tiroir Device.

## Décisions (brainstorm)

- **led_ring et sound deviennent permanents** : toujours présents, **un seul** de chaque, jamais
  ajoutés ni supprimés. led_ring en mode `off` par défaut (= neutre). sound d'id `buzz` par défaut.
- **Les deux ids sont renommables** (led + buzz) : les deux servent au routage `/update` ; même
  mécanisme (inline, calqué sur `tree.js`).
- **Retirer** les boutons « + LED » / « + Son » et « Supprimer » des physiques.
- **Migration** : au chargement d'un layout, garantir la présence d'un led_ring et d'un sound ;
  injecter ceux qui manquent (led_ring `off`, sound `buzz`). Layouts legacy avec **plusieurs**
  sound : laissés tels quels (pas de collapse), mais l'UI n'en ajoute plus.
- **Hors-scope** : donner une config au sound, mode « off » du sound (il n'en a pas), changement
  firmware/schéma.

## Architecture & modules

### `js/physical.js`
- Ajout : `ensurePhysicals(state)` **pur** — pour chaque type physique (`led_ring`, `sound` ;
  source = `physicalTypes()`), si **aucun** composant de ce type n'existe, en injecter un avec un
  id par défaut (`led` / `buzz`, dé-dupliqué via `uniqueId` si l'id est déjà pris par autre chose)
  et les `defaults()` du registre. Testé node. (Indépendant du flag `singleton`, que le `sound` n'a
  pas.)
- `canAddType` / `addPhysicalComponent` : **supprimés** (plus aucun appelant). `removeComponent`
  conservé seulement s'il garde un appelant hors-physiques (sinon supprimé). À vérifier au plan.
- Le flag `singleton` de `led_ring` (registry) : conservé (désormais redondant mais cohérent) ou
  retiré — tranché au plan ; sans impact tant qu'il n'y a plus d'ajout.

### `js/device-panel.js`
- Boucle d'affichage des cartes physiques : **inchangée** sur le fond, mais
  - le titre `${id} · ${label}` devient **renommable** (double-clic → input → `renameComponent`,
    garde d'unicité + toast, calqué sur `tree.js`) ;
  - le bouton **« Supprimer » est retiré**.
- La boucle des boutons **« + … » est retirée**.
- Carte **sound** : titre (id renommable) + une **note** « déclenché via /update `{tone,ms}` ou
  `{name}` » (le sound n'a aucun réglage).

### `js/app.js`
- `ensurePhysicals` appelé aux mêmes points que `stripPhysicalPlacements` : **boot** (sur le layout
  restauré/défaut) et **import** (`onLoad`). « Nouveau » recharge `DEFAULT_LAYOUT` (déjà pourvu).

### Migration / compat
- Layout sans led_ring ou sans sound (importé) → `ensurePhysicals` les injecte.
- Layout par défaut & firmware : déjà pourvus → aucun changement visible.

## Flux

```
chargement layout (boot / import / Nouveau)
   └─ stripPhysicalPlacements (existant)
   └─ ensurePhysicals  ─▶ injecte led_ring(off) et/ou sound(buzz) si absents

tiroir Device : 2 cartes permanentes (led_ring + sound), id renommable, sans + / Supprimer
```

## Parité & firmware

- **100 % designer.** `src/`, `lib/`, `schema/`, `render.js` **intacts**.
- Un sound permanent non déclenché est silencieux ; un led_ring `off` est éteint → **aucune
  régression de comportement device**.

## Tests & vérifs

- `node --test` :
  - `ensurePhysicals` : injecte si absent (led_ring/sound), n'ajoute pas de doublon si présent,
    préserve un led_ring déjà configuré, gère un id par défaut déjà pris (dé-dup), idempotent.
  - `renameComponent` : déjà testé (réutilisé).
- DOM (vérif navigateur) : 2 cartes permanentes, pas de bouton + / Supprimer, renommage d'id
  (sound `buzz`→autre, led `led`→autre) avec garde d'unicité, mode `off` du led_ring par défaut,
  import d'un layout sans physiques → cartes réapparaissent.

## Hors-scope

- Donner une configuration au sound (il reste un déclencheur pur via `/update`).
- Toute évolution firmware/schéma.
- Multi-buzzer (plusieurs ids de sound) via l'UI — les legacy multiples sont tolérés mais non créés.
