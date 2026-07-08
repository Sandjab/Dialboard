# Composant `state` — scènes animées (brique 2)

> Design doc. Statut : **approuvé** (brainstorm 2026-07-08, compagnon visuel). Brique **2** du
> composant `state`. La brique **1** (`docs/superpowers/specs/2026-07-07-composant-etat-visuel-design.md`)
> a livré la fondation : valeur → visuel **statique** (glyphe MDI **ou** image bitmap), sélection hybride
> exact/range + défaut. Cette brique ajoute un **3ᵉ kind de visuel** : `scene` = animation composée
> data-driven, sélectionnable par un cas **ou** le défaut, réutilisant tel quel le mécanisme de sélection.

## 1. Objectif

Permettre à un cas du composant `state` d'afficher, au lieu d'un glyphe/image figé, une **scène animée** :
plusieurs glyphes MDI superposés et animés (rotation, translation en boucle, pulsation, oscillation,
clignotement). Cas d'usage moteur : un écran météo dont la condition renvoyée par l'API sélectionne
`sunny` (soleil rayonnant), `rain` (gouttes qui tombent), `storm` (éclair qui clignote)… ; et des
indicateurs d'état génériques (chargement, alerte, cloche, battement).

**Décision de fond (brainstorm)** : les scènes viennent d'un **catalogue figé** livré avec le firmware —
l'utilisateur en **choisit** une (comme il choisit une icône MDI), il n'en **compose** pas. Un compositeur
de scènes libre data-driven a été explicitement **écarté** (§7) : hors de proportion pour un besoin fini
et connu, et risque de scènes cassées. `icon`, `image`, et les kinds glyphe/image de `state` restent
**inchangés**.

## 2. Périmètre

**Dans le périmètre** :
- Nouveau **kind de visuel** `scene` dans `StateCase` (pas un nouveau composant).
- **Catalogue v1** de 9 scènes : `sunny`, `rain`, `snow`, `storm`, `wind`, `spinner`, `alert`, `bell`, `beat`.
- Réglages par cas : **couleur principale** (`color`, optionnelle) + **taille** (`size`, px).
- Un **mini-moteur d'animation** firmware piloté par une **table de scènes figée en dur**, tenue en
  **miroir C ↔ JS** (parité designer).
- Rendu firmware (LVGL 9.5) + designer (canvas **animé en direct** + picker + preview) + schéma + tests.

**Hors périmètre (→ éventuelles briques futures, cycles séparés)** :
- **Composition libre** de scènes par l'utilisateur (le « compositeur » écarté).
- **Cross-fade / transition** entre deux scènes au changement de cas (swap dur, cf. §5).
- **Vitesse réglable** par cas (figée par scène, cf. §11).
- Contrôle **play/stop on-device** (une scène joue en continu tant que son cas est le visuel actif).
- Frame-packs bitmap et vrai SVG on-device (déjà écartés brique 1).
- Ajout de scènes **sans recompiler** (conséquence assumée du catalogue figé).

## 3. Modèle de données (schéma)

Un cas `scene` (même forme pour un `default` de type scène) :
```json
{ "key": "Rain", "scene": "rain", "color": "#3B82F6", "size": 120 }
```

- **Inférence du kind par champ**, priorité **`scene` > `src` > `symbol`** (prolonge l'inférence
  existante `src`/`symbol` de la brique 1 ; toujours **sans `oneOf`**).
- `scene` : **nom** du catalogue (enum du schéma). Résolu en **index** à l'ingestion, exactement comme les
  symboles MDI via `icon_symbol_index` (cf. `parse_state_visual`).
- `color` : **couleur principale** optionnelle. Défaut = valeur **curée par scène** (cf. §4). Une scène
  décide **quelle(s) couche(s)** suivent `color` et lesquelles sont des **accents fixes** (ex. l'éclair
  jaune de `storm` reste jaune quelle que soit `color`).
- `size` : **côté** de la boîte carrée de la scène, en px (**défaut 120**). Les couches se placent en
  **coordonnées relatives** (0..100) mises à l'échelle de `size`.
- **Limites** : le kind `scene` s'inscrit dans les limites existantes du composant (`MAX_STATE_CASES=16`
  par composant, `MAX_STATE_CASES_TOTAL=64` sur le pool partagé). Aucune nouvelle limite exposée à
  l'utilisateur ; la profondeur des scènes (nombre de couches) est bornée **en interne** par la table.

## 4. Architecture interne — mini-moteur + table de scènes figée

C'est le cœur du design. Une **table de scènes en dur** décrit chaque scène du catalogue, et un **moteur
générique** l'interprète (build + animation). La table est data-driven **en interne** mais **figée dans le
binaire** : on garde les avantages du catalogue (qualité garantie, léger, pas d'éditeur, pas de scènes
cassées) tout en **factorisant** le code (une seule logique de rendu pour les 9 scènes, pas 9 fonctions
ad hoc).

Structure logique (noms de champs indicatifs, à préciser au plan) :
```
Scene  = { SceneLayer layers[]; }
SceneLayer = {
  uint16_t symbol;        // glyphe MDI (index ICON_GLYPHS)
  float    x, y;          // position relative 0..100 (mise à l'échelle par `size`)
  float    scale_rel;     // taille relative de la couche
  ColorRole role;         // PRINCIPAL (suit `color`) | ACCENT (couleur fixe ci-dessous)
  uint32_t  accent_rgb;   // couleur si role == ACCENT
  AnimKind  anim;         // STATIC | ROTATE | TRANSLATE_LOOP | DRIFT | PULSE | SWING | FLASH
  AnimParams params;      // période (ms), amplitude, phase/délai, sens…
}
```

**Vocabulaire d'animation** (fini, couvre exactement les 9 scènes cochées) :

| AnimKind | Effet | Propriété LVGL animée | Scènes |
|---|---|---|---|
| `STATIC` | couche fixe | — | nuage de rain/snow/storm |
| `ROTATE` | rotation continue | `transform_rotation` ⚠ | sunny (rayons), spinner |
| `TRANSLATE_LOOP` | translation cyclique + fondu aux extrémités | `translate_y`, `opa` | rain, snow (chute) |
| `DRIFT` | va-et-vient doux | `translate_x` | wind (nuage) |
| `PULSE` | échelle + opacité | `transform_scale` ⚠, `opa` | alert, beat |
| `SWING` | oscillation, pivot décalé | `transform_rotation` ⚠ | bell |
| `FLASH` | opacité en créneau | `opa` | storm (éclair) |

⚠ = repose sur **rotation/échelle** d'un `lv_label` — **risque technique nº 1** (§12).

**Catalogue v1** (composition indicative, réglages fins des positions/amplitudes au moment de
l'implémentation, validés au navigateur) :

| Scène | Couches | Couleur principale (défaut) |
|---|---|---|
| `sunny` | disque `STATIC` + rayons `ROTATE` | ambre `#F5A623` |
| `rain` | nuage `STATIC` (accent gris) + N gouttes `TRANSLATE_LOOP` (principal) | bleu `#3B82F6` |
| `snow` | nuage `STATIC` (accent gris) + N flocons `TRANSLATE_LOOP` (principal) | bleu clair `#93B4D8` |
| `storm` | nuage `STATIC` (principal) + éclair `FLASH` (accent jaune fixe) | gris `#8892A0` |
| `wind` | nuage `DRIFT` | gris `#8892A0` |
| `spinner` | arc/points `ROTATE` | accent thème `#6C7BF2` |
| `alert` | triangle+point `PULSE` | rouge `#EF4444` |
| `bell` | cloche `SWING` | ambre `#F5A623` |
| `beat` | cœur `PULSE` | rose `#EC4899` |

**Parité C ↔ JS** : la table est décrite **une fois par langage** (tableau C côté firmware, objet JS côté
designer) et un **test de parité** vérifie l'égalité structurelle (mêmes scènes, mêmes couches, mêmes
params) — même principe que le test registre↔schéma existant. La **fonction de frame** (§5/§6) est
elle aussi mirroir exact entre C et JS, comme `state_resolve`/`resolveState` et `ledFrameAt`.

## 5. Rendu firmware & cycle de vie (LVGL)

- **Discriminant du kind** : la brique 1 encode le kind par `bool has_src` (2 kinds). On le **remplace par
  un `enum kind {GLYPH, IMAGE, SCENE}`** dans `StateCase` (petit refactor ciblé de brique 1 : déclaration
  `dashboard.h`, `parse_state_visual`, `state_make_child`, `sync_state`). Choix retenu vs un 2ᵉ bool
  `has_scene` : plus lisible pour 3 états mutuellement exclusifs.
- **`state_make_child`** gagne une **3ᵉ branche** `SCENE` : le conteneur transparent héberge alors **N
  enfants** (un `lv_label` glyphe par couche) au lieu d'un seul, construits depuis la table (position ×
  `size`, couleur selon `role`/`color`).
- **Changement de cas** = **swap dur** : `lv_obj_clean(cont)` + reconstruction du bon kind (identique à la
  bascule glyphe↔image de la brique 1). Pas de cross-fade.
- **Animation par tick logiciel**, **calqué sur `led_ring`** (animation par `now_ms`), **et non `lv_anim`**.
  Justification : `lv_anim` impose d'annuler (`lv_anim_del`) **toutes** les anims avant toute destruction
  d'objet (`lv_obj_clean`, `view_rebuild`) sous peine de **use-after-free** — c'est le piège identifié
  dans le code (transition de page = seul usage de `lv_anim`, protégé par `page_anim_settle`). Un tick qui
  **recalcule les transforms** à chaque frame n'a **rien à annuler** : au swap/rebuild les enfants sont
  détruits normalement.
- **`dash_tick_scene(now_ms)`** : itère les `COMP_STATE` dont le **visuel actif est une scène**, applique
  la fonction de frame à chaque couche (transform/opa). Appelé à ~30 fps depuis `main.cpp`, à côté de
  `led_ring_tick` / `dash_tick_aimg`.
- **Sélection inchangée** : `state_resolve` ignore le kind du visuel — une scène est un cas comme un autre.
  `context_apply`/`apply_state` inchangés (le kind ne dépend pas de la valeur reçue).

## 6. Designer

- **Canvas animé en direct** (décision brainstorm) : `render.js buildState` gagne la branche `scene` — rend
  le conteneur + N couches (glyphes `<i class="mdi">`, réutilise `buildIcon`) et lance une boucle
  `requestAnimationFrame` appliquant la **même fonction de frame** que le firmware (parité, modèle
  `ledFrameAt`). Une seule scène s'anime à la fois par composant `state` (le cas résolu) → léger.
  Nettoyage du rAF avant tout rebuild (cf. précédent `_aimgPreviewTimer`/`ledPreviewRaf`).
- **Inspecteur** : l'éditeur de visuel bespoke (`visualEditor`) gagne un **3ᵉ mode « scène »** dans sa
  bascule glyphe|image|**scène**. En mode scène :
  - un **picker de scènes** = grille de **vignettes animées** cliquables (réutilise le pattern du picker
    MDI `openIconPicker` : overlay, grille, sélection),
  - un champ **couleur** (couleur principale ; mêmes invariants de commit que la brique 1 : aperçu live sur
    `input`, commit sur `change`, `ref` figée),
  - un champ **taille** (num, coalescence des commits).
  - La bascule de mode **supprime les champs des autres kinds** (comme aujourd'hui `delete symbol/color`
    ↔ `delete src/w/h`), en ajoutant `delete scene/size`.
- **`registry.js`** : `state` inchangé côté palette ; `buildState` gère le nouveau kind.
- **Schéma** : ajout de `scene` (enum des noms) + `size` (integer) à `$defs/state_case` ; `additionalProperties:false`
  conservé.
- **i18n EN/FR** + palette pour le mode scène, le picker, les libellés de scènes.

## 7. Isolation / unité

Le kind `scene` reste **une unité value-out** claire : entrée = (cas sélectionné, `color`, `size`, `now_ms`),
sortie = un ensemble de couches transformées. Son seul couplage est la **table de scènes** (partagée) et la
réutilisation du rendu de glyphe de `icon`. La **fonction de frame** est **pure** (état = `now_ms` + params
figés), donc testable et mirroir-able isolément — exactement comme `state_resolve` et le résolveur designer.

## 8. Tests

- **Natif (Unity)** : parsing d'un cas `scene` dans `dash_set_layout` (nom→index, `color`, `size`, kind
  `SCENE`) ; `state_resolve` **inchangé** (une scène est un cas ordinaire — non régressé). **Parité de la
  table de scènes C↔JS** (mêmes scènes/couches/params) et **parité de la fonction de frame** (positions,
  angles, opacités à `t` donné, à tolérance près).
- **Designer (node)** : logique de **frame pure** extraite (celle que `render.js` consomme) ; parité
  `$defs/state_case` ↔ registre ; la table de scènes JS ↔ table C (le test de parité peut vivre côté node
  en lisant une représentation commune, à décider au plan).
- **Browser-verified** : picker de scènes (grille animée, sélection), **canvas animé en direct**, bascule
  de kind **glyphe↔image↔scène**, réglage couleur/taille, mode exact vs range avec des cas scène.
- **On-device** : un `state` météo piloté par une condition (string, `exact`) sélectionnant `sunny`/`rain`,
  et un piloté par un code (nombre, `range`) ; vérif du bon rendu **animé** + de la bascule vers un cas
  glyphe/image. (⚠ `uploadfs` efface les assets — cf. mémoire `uploadfs-efface-assets-device`.)

## 9. Insertion dans le code (repères, non normatif)

- Firmware : `StateCase` + `enum kind` (`src/dashboard.h`) ; `parse_state_visual` + parsing du bloc
  `COMP_STATE` (`src/dashboard.cpp`) ; `state_make_child`/`build_state`/`sync_state` (`src/view.cpp`) ;
  nouveau `dash_tick_scene` (`src/dashboard.cpp`) branché dans `src/main.cpp` près de `led_ring_tick` ;
  table de scènes + fonction de frame (nouveau module, ex. `src/scenes.{h,cpp}`, fonction de frame **pure**
  testable en `env:native`).
- Designer : `render.js` (`buildState` + boucle rAF + fonction de frame + table de scènes JS) ;
  `inspector.js` (`visualEditor` 3ᵉ mode + picker de scènes) ; `mutations.js` ; `schema/layout.schema.json`
  (`$defs/state_case`) ; i18n.

## 10. Sélection de scène (rappel) — inchangée

`scene` ne change **rien** à la sémantique de sélection de la brique 1 : `state_resolve(match, cases, …)`
choisit un cas selon la valeur (exact string/num ou range) ; le **kind** du visuel de ce cas (glyphe /
image / scène) est **orthogonal** à la sélection. Une scène ne « lit » pas la valeur ; elle joue en boucle
tant qu'elle est le visuel actif.

## 11. Décisions figées (résolution des points du brainstorm)

- Source des scènes = **catalogue figé** (vs compositeur libre) — esprit « catalogue » du projet (comme les
  469 icônes), YAGNI, qualité garantie.
- Couleur = **principale réglable + accents fixes par scène** (un seul champ `color`).
- Vitesse = **figée par scène** (pas de réglage exposé) — un champ de moins, cohérence visuelle.
- Taille = **champ `size` unique en px** (défaut 120), couches en coordonnées relatives.
- Aperçu designer = **canvas animé en direct** (vs statique + bouton play).
- Animation firmware = **tick logiciel type `led_ring`** (vs `lv_anim`) — évite le piège `lv_anim_del`.
- Discriminant du kind = **`enum kind {GLYPH, IMAGE, SCENE}`** (petit refactor de brique 1) vs 2ᵉ bool.

## 12. Risques & mitigations

- **Risque nº 1 — transformations (rotation/échelle) d'un `lv_label` en LVGL 9.5.** `translate` et `opa` sur
  un label sont sûrs. Pour la rotation/échelle : les **docs LVGL 9.5 confirment** que
  `transform_rotation` / `transform_scale` s'appliquent à **tout widget** (pas seulement les images), via
  une **layer rendue** intermédiaire (`lv_obj_set_style_transform_rotation`/`_scale`/`_pivot_*`). **L'API
  est donc supportée** pour un glyphe. Le risque résiduel n'est plus l'existence mais la **qualité de rendu
  et le coût de la layer transformée à ~30 fps sur ESP32-S3** (mémoire de la layer + interpolation).
  Impacte `ROTATE` (sunny, spinner), `SWING` (bell), `PULSE` (alert, beat).
  **Mitigation** : un **spike on-device** (dernière tâche du plan, device requis) valide qualité + fps ;
  **non bloquant** pour le développement (les scènes se codent avec `transform_*`, le repli ne change ni le
  modèle ni l'API). **Repli si la qualité/perf déçoit** : rejouer ces effets en **translation + opacité**
  seules (ex. rayons du soleil / points du spinner en **cascade d'opacité** plutôt qu'en rotation ; `PULSE`
  en fondu) — le vocabulaire `AnimKind` absorbe le repli scène par scène.
- **Risque nº 2 — coût CPU du tick à 30 fps.** Borné : une seule scène active par composant `state`, peu de
  composants ; `led_ring_tick` fait déjà tourner du calcul à 30 fps. À surveiller au spike.
- **Risque nº 3 — dérive de parité C↔JS de la table.** Mitigé par le **test de parité** dédié (§8) qui
  échoue si les deux tables divergent.

## 13. Self-review (rempli à la rédaction)

- **Placeholders** : catalogue v1 chiffré (9 scènes nommées) ; `size` défaut 120 ; `AnimKind` énuméré ;
  couleurs principales par défaut chiffrées. Positions/amplitudes exactes des couches = réglage
  d'implémentation (validé au navigateur), volontairement non figées ici.
- **Cohérence** : `scene` prolonge l'inférence par champ de la brique 1 (priorité `scene>src>symbol`) de
  façon cohérente entre schéma, firmware (`enum kind`) et designer ; la sélection (`state_resolve`) est
  explicitement inchangée et orthogonale au kind.
- **Ambiguïté levée** : scène = **catalogue figé** (pas de composition) ; couleur = **une** principale +
  accents fixes ; animation = **tick logiciel** (pas `lv_anim`) ; swap de cas = **dur** (pas de cross-fade).
- **Scope** : focalisé sur l'ajout d'un kind `scene` à `state` ; compositeur libre, cross-fade, vitesse
  réglable et play/stop explicitement différés (§2). Le modèle (table figée + vocabulaire `AnimKind`)
  absorbe le repli du risque nº 1 sans refonte.
