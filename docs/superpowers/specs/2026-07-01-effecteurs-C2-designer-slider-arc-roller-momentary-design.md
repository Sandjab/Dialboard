# Effecteurs — Tranche C2 : producteurs designer slider/arc/roller + `momentary` (button)

> Spec de design. Date : 2026-07-01. Statut : validée (brainstorm), prête pour le plan d'implémentation.
> Gabarit imposé : tranche C (PR #25, `02323cd`) — switch/button designer + panneau sinks.

## 1. Contexte & objectif

Le firmware sait déjà **parser et rendre** les 4 effecteurs restants du socle v1 :
- `slider` / `arc` / `roller` (livrés en B2, `14d3450`) ;
- le mode `momentary` du `button` (livré en B2 ; le mode `set` l'était en B1).

Le **designer WYSIWYG** ne sait produire que `switch` + `button` mode `set` (tranche C). C2 **referme la parité designer↔firmware** sur tout le socle effecteurs : le designer doit pouvoir créer et configurer ces composants exactement comme le firmware les lit.

**Contrainte structurelle** : le test `designer/tests/registry.test.js` impose `Object.keys(COMPONENTS)` **==** l'ensemble des types du schéma. Un composant ne peut donc entrer que si schéma **et** registre l'ajoutent dans le même incrément. Cette contrainte cadre tout le travail.

## 2. Périmètre

**Dans la tranche (une seule PR)** :
- 3 nouveaux composants designer : `slider`, `arc`, `roller` (schéma + registre + rendu canvas + inspecteur + icônes + i18n).
- 1 nouveau champ du `button` existant : `momentary` (booléen) + ajustement du label de `value`.
- Tests designer (registre + schéma round-trip par composant) + QA navigateur EN/FR.

**100 % designer + schéma. Zéro firmware.** Critère de non-régression : `git diff <base> HEAD -- src/ lib/ platformio.ini` doit être **vide**.

**Hors périmètre (différé, assumé)** :
- Débounce des sinks : vit dans `sink.debounce_ms` (panneau sinks, tranche C), **pas** dans le composant. Rien à ajouter ici.
- Durcissement `Array.isArray` sources+sinks (différé des revues Gemini #24/#25) — passe dédiée symétrique.
- `validate.unbound_bind` : warning cosmétique **non bloquant** qui bruite pour un `bind` d'effecteur (var écrite, souvent absente des `sources`). Connu, non traité ici.
- `uploadfs` pour embarquer le designer à jour sur le device (efface les assets device — cf. mémoire `uploadfs-efface-assets-device`) : opération de déploiement, hors code.

## 3. Parité firmware — source de vérité

Clés JSON **exactes** lues par le firmware (`src/dashboard.cpp`, `src/view.cpp`), vérifiées sur la source vive. Le designer doit produire précisément ces clés/types. `min`/`max`/`step`/`orientation`/`mode`/`rounded`/`color` sont parsés **génériquement** (mêmes clés partagées avec `bar`/`ring`).

### 3.1 `button` (champ ajouté : `momentary`)

| Clé JSON | Type | Défaut | Sémantique |
|---|---|---|---|
| `type` | const | `"button"` | — |
| `text` | string (Latin-1) | `""` | Libellé (déjà géré C) |
| `value` | number\|string | `""` | Cible (set) / valeur d'impulsion (momentary). Type JSON → `set_is_num` (déjà géré C) |
| `bind` | id | `""` | Var écrite au tap (déjà géré C) |
| **`momentary`** | **boolean** | **`false`** | **`false`=set (écrit `value`, reflet radio) ; `true`=impulsion (`value` puis reset externe)** |
| `font`/`font_family`/`bold`/`italic` | — | — | Police (déjà géré C) |

Réf. : `dashboard.cpp:239-251` (`value`, `momentary`), `view.cpp:565-584` (rendu), `dashboard.cpp:705-709` (`pulse` vs `write_ui`).

### 3.2 `slider`

| Clé JSON | Type | Défaut | Sémantique |
|---|---|---|---|
| `type` | const | `"slider"` | — |
| `min` | number | `0` | Borne basse (→ `vmin`) |
| `max` | number | `100` | Borne haute (→ `vmax`) |
| `step` | integer | `0` | `≤0` = pas de quantification ; `>0` = arrondi au multiple (`slider_quantize`, borné `[vmin,vmax]`) |
| `orientation` | enum | `"horizontal"` | `"horizontal"`\|`"vertical"` (→ `bar_vertical`) |
| `color` | hexColor | `#FFFFFF` | Couleur de l'indicateur (`LV_PART_INDICATOR`) |
| `bind` | id | `""` | Var écrite au glissement (origine UI) |
| `visible` | boolean | `true` | (générique, non exposé C2) |

Placement : `width` (défaut **200**), `height` (défaut **16**), `anchor`/`dx`/`dy`. Piste `LV_PART_MAIN` = défaut thème (le firmware ne la colore pas). Réf. : `dashboard.cpp:137-139,166,183`, `view.cpp:585-596`.

### 3.3 `arc`

| Clé JSON (composant) | Type | Défaut | Sémantique |
|---|---|---|---|
| `type` | const | `"arc"` | — |
| `min` / `max` | number | `0` / `100` | Plage (→ `vmin`/`vmax`) |
| `step` | integer | `0` | Quantification (comme slider) |
| `mode` | enum | `"normal"` | `"normal"`\|`"symmetrical"`\|`"reverse"` (→ `arc_mode`) |
| `rounded` | boolean | `true` | Extrémités arrondies (→ `arc_rounded`) |
| `color` | hexColor | `#FFFFFF` | Couleur de l'indicateur |
| `bind` | id | `""` | Var écrite au tournoiement |

| Clé JSON (placement) | Type | Défaut | Sémantique |
|---|---|---|---|
| `radius` | int | `0` → diamètre **160** | Diamètre = `radius*2` (sinon 160) |
| `thickness` | int | `16` | Épaisseur de bande |
| `gap_deg` | int | `70` | Angle d'ouverture |
| `start_angle` | int | `0` | Orientation de l'ouverture. `bg_angles = 90+start_angle ± gap_deg/2` |

**Positionnable** via `anchor`/`dx`/`dy` (le firmware `lv_obj_align` l'arc comme tout composant — contrairement au **ring** designer qui est `centered:true`). Piste `LV_PART_MAIN` = gris fixe `0x1F2937` ; indicateur = `color`. Réf. : `dashboard.cpp:169-170`, `view.cpp:602-617`.

### 3.4 `roller`

| Clé JSON | Type | Défaut | Sémantique |
|---|---|---|---|
| `type` | const | `"roller"` | — |
| `options` | array[string] | *(requis)* | Étiquettes, jointes par `\n` au parse ; le roller écrit l'**index** sélectionné |
| `rows` | integer | `3` | Rangées visibles, borné `[1, MAX_ROLLER_ROWS]` |
| `bind` | id | `""` | Var écrite à la sélection (valeur = index, numérique) |

Placement : `width` optionnel (auto si absent), `anchor`/`dx`/`dy` ; pas de `height` (auto = `rows` × hauteur de ligne). Réf. : `dashboard.cpp:253-264`, `view.cpp:623-632`.

## 4. Schéma (`schema/layout.schema.json`)

Increment couplé au registre (même commit) pour garder `registry.test.js` vert.

- Ajouter 3 refs dans `$defs/component.oneOf` : `comp_slider`, `comp_arc`, `comp_roller`.
- 3 nouveaux `$defs`, chacun `type:"object"`, `additionalProperties:false`, `required:["type"]` :
  - **`comp_slider`** : `type`(const), `visible`(bool), `bind`($ref id), `min`(number), `max`(number), `step`(integer), `orientation`(enum `["horizontal","vertical"]`), `color`($ref hexColor).
  - **`comp_arc`** : idem slider **moins** `orientation`, **plus** `mode`(enum `["normal","symmetrical","reverse"]`), `rounded`(boolean). *(La géométrie radius/thickness/gap_deg/start_angle vit dans le `placement`, déjà défini au schéma pour le ring — vérifier que le `$defs/placement` les accepte ; sinon aucun ajout, ils y sont déjà pour le ring.)*
  - **`comp_roller`** : `type`(const), `visible`(bool), `bind`($ref id), `options`(array d'items `$ref display`, `minItems:1`), `rows`(integer, `minimum:1`, `maximum:` littéral = valeur de `MAX_ROLLER_ROWS` dans `src/config.h`, **à lire au plan**). **`required:["type","options"]`.**

Réutiliser les `$defs` existants (`id`, `hexColor`, `display`). Ne pas créer de nouveau type primitif.

## 5. Registre + icônes (`designer/js/registry.js`, `icons.js`)

3 entrées, structure canonique (10 champs) miroir de switch/button. Quadrant palette **« special »** (à côté de switch/button — les effecteurs forment une famille cohérente).

| Champ | slider | arc | roller |
|---|---|---|---|
| `label` | `comp.slider` | `comp.arc` | `comp.roller` |
| `defaults()` | `{type:'slider', min:0, max:100}` | `{type:'arc', min:0, max:100}` | `{type:'roller', options:['OFF','ON'], rows:3}` |
| `makePlacement` | `{...screenPlacement(id,x,y), width:200, height:16}` | `{...screenPlacement(id,x,y), radius:80, thickness:16, gap_deg:70}` | `{...screenPlacement(id,x,y), width:120}` |
| `centered` | `false` | `false` | `false` |
| `physical` | `false` | `false` | `false` |
| `compFields` | bind, min, max, step, orientation, color | bind, min, max, step, mode, rounded, color | bind, options, rows |
| `placeFields` | anchor, dx, dy, width(200), height(16) | anchor, dx, dy, radius, thickness, gap_deg, start_angle | anchor, dx, dy, width(120) |
| `mockFields` | valeur d'aperçu (cf. §8) | valeur d'aperçu | option sélectionnée |
| `build` | `buildSlider` | `buildArc` | `buildRoller` |

Notes :
- `arc.placeFields` **miroir de `ring`** (`radius`/`thickness`/`gap_deg`/`start_angle`) mais **avec** `anchor`/`dx`/`dy` en plus (arc positionnable ; le ring designer ne les expose pas car `centered:true`).
- `roller.makePlacement` émet une **`width` déterministe** (120) pour un WYSIWYG stable ; la hauteur reste auto (parité : le firmware n'a pas de `height` roller).
- `defaults()` roller seed 2 options non vides (jamais un roller vide à la création).
- 3 icônes SVG monochromes (`icons.js` `PATHS`) : glyphes distincts (barre+knob / arc+knob / liste+chevrons).

## 6. Rendu canvas (`designer/js/render.js` + CSS)

3 builders `build*(comp, placement, mock)` → `<div class="w w-…">`, parité visuelle :

- **`buildSlider`** : piste horizontale/verticale (selon `orientation`) + knob à la position d'aperçu ; indicateur teinté `comp.color`. Taille = placement (défaut 200×16). CSS `.w-slider` / `.w-slider-knob` / `.w-slider-ind`.
- **`buildArc`** : **réutilise le rendu SVG du ring** (`buildRing` : `radius`/`thickness`/`gap_deg`/`start_angle`). Piste MAIN gris `#1F2937`, indicateur `comp.color` rempli jusqu'à la valeur d'aperçu, extrémités arrondies si `rounded`. **Invariant à préserver** (cf. CLAUDE.md « Anneau : pointer-events limités aux parties peintes ») : le `<svg>` ne doit capter que les parties peintes, sinon un clic au centre du disque ne désélectionne pas.
- **`buildRoller`** : colonne d'options (issues de `comp.options`), `rows` visibles, option d'aperçu centrée/surlignée. CSS `.w-roller` / `.w-roller-opt`.

## 7. Inspecteur (`designer/js/inspector.js`)

Champs **génériques** réutilisés (aucun nouvel éditeur sauf 1) via les `kind` existants :
- `num` : min, max, step, rows, width, height, radius, thickness, gap_deg, start_angle ;
- enum/select : orientation, mode (mécanisme des enums existants type `anchor`/`mode`) ;
- `bool` : rounded, **`momentary`** ;
- `color` : color ; `idtext` : bind.

**Une seule pièce bespoke neuve** — `optionsField` (roller) :
- textarea, **une option par ligne** (miroir du join `\n` firmware) ;
- commit sur `change` : découpe en lignes, **retire les lignes vides** → `options` (array) ;
- **si résultat vide → avertissement rouge « options vides » (`var(--err)`) et PAS de commit** (miroir du body JSON invalide des sinks) ;
- `ref` **figée au rendu** (invariant inspecteur : le `change` peut partir après un changement de sélection).

**`momentary`** : simple `bool`. Le label du champ `button.value` passe de `field.value` = « Value (set) » à un libellé **neutre « Valeur »** + infobulle expliquant set (cible, reflet radio) vs momentary (impulsion). Pas d'éditeur adaptatif (décision brainstorm : case à cocher, pas menu Mode).

## 8. Aperçu (mock)

slider/arc/roller portent une valeur d'aperçu (`mockFields`, **hors modèle/undo**, comme les afficheurs bar/ring/readout) pour un rendu canvas lisible :
- slider/arc : position d'aperçu (~50 % de la plage) ;
- roller : index d'option sélectionné (0 par défaut).

Ces valeurs ne sont **jamais** exportées dans le layout JSON (aperçu designer uniquement).

## 9. i18n (`designer/i18n/en.js` + `fr.json`)

Nouvelles clés (EN + FR, parité stricte) :
- `comp.slider` / `comp.arc` / `comp.roller` ;
- `field.min` / `field.max` / `field.step` / `field.orientation` / `field.mode` / `field.rounded` / `field.options` / `field.rows` / `field.momentary` (réutiliser les clés existantes si déjà présentes — `field.radius`/`field.thickness`/`field.gap_deg`/`field.start_angle`/`field.color`/`field.width`/`field.height` viennent du ring/bar) ;
- valeurs d'enum si affichées (orientation, mode) ;
- infobulle `inspector.tip.momentary` ; libellé neutre pour `field.value` (« Valeur » / « Value ») ;
- `default.*` éventuels (options seed).

Vérif : `EN n FR n EN-only [] FR-only []` (one-liner node du HANDOFF). `default.*` reste Latin-1.

## 10. Tests & critères d'acceptation

**Tests designer (`node --test`)** :
- `registry.test.js` : registre couvre les 3 nouveaux types ; assertions par composant (compFields attendus, `physical:false`, tailles émises par `makePlacement`) ; le test de parité stricte reste vert.
- `schema.test.js` : round-trip **minimal** et **complet** par composant ; roller **sans `options` → invalide** ; slider/arc `orientation`/`mode` hors enum → invalide ; `additionalProperties` inconnu → invalide.
- (si utile) test du découpage `optionsField` (textarea → array, lignes vides retirées).

**Sanity firmware** : `pio test -e native` inchangé (firmware non touché) ; `pio run -e esp32s3` SUCCESS.

**Parité i18n** : EN == FR, 0 orpheline.

**QA navigateur (EN + FR, serveur no-store, vrais events pointer — cf. mémoire `designer-verif-navigateur`)** :
- palette : slider/arc/roller dans le quadrant « special », icônes distinctes ;
- placement + rendu : slider 200×16 orientable, arc en cadran (SVG, gris/indicateur coloré), roller à N rangées ;
- inspecteur : édition de tous les champs ; **momentary** (case) sur le button + label « Valeur » neutre + infobulle ; **options roller** (textarea, vide → avertissement rouge + pas de commit, valide → array) ;
- désélection : clic au centre d'un arc vide **désélectionne** (invariant pointer-events) ;
- un layout contenant les 3 composants → **✓ valid** (validateur réel) ;
- 0 erreur console ; FR intégral.

**Critère global** : parité designer↔firmware vérifiée champ par champ contre §3 ; aucun réglage que le firmware rend mais que le designer ne sait pas produire.

## 11. Risques & pièges

- **Piège registre×2** : côté firmware, tout nouveau `COMP_*` doit être dans les 2 tables (`APPLY[]`/`VIEW[]`) — **sans objet ici** (firmware non touché), mais rappelle que le firmware sait déjà rendre ces 3 types.
- **Collision de clé `mode`** : `mode` sert à `bar`/`arc`/`led` avec des enums différents. Chaque `$defs/comp_X` porte son propre enum sous `additionalProperties:false` → pas de conflit.
- **Invariant pointer-events de l'arc** : facile à casser en réutilisant le SVG du ring ; couvert par le test de désélection au centre.
- **Commit sur `change` + `ref` figée** : l'`optionsField` doit respecter les invariants inspecteur (blur avant changement de sélection, ref figée) sous peine d'éditer le mauvais composant.
- **WYSIWYG déterministe** : émettre les tailles au placement (slider 200×16, arc radius 80, roller width 120) ; la hauteur du roller reste auto (limite de parité assumée, le firmware n'a pas de `height` roller).
- **`step` non-entier** : le firmware attend un entier (`o["step"]|0`) ; le schéma type `integer` ; l'inspecteur `num` peut émettre un flottant → borner à l'entier (ou laisser le validateur signaler, cf. Minor tranche C `debounce` sans `step`).
