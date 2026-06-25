# LED ring designable + aperçu live (niveau B)

- **Date** : 2026-06-24
- **Branche** : `feat/led-ring-designable-preview`
- **Statut** : design validé (brainstorm), spec à relire avant plan d'implémentation
- **Scope** : niveau B (aperçu fidèle + édition mode/période/valeur persistés). Niveau C hors-scope.

## Problème

L'écran rond du device est entouré de **13 LEDs WS2812** physiques. Le firmware sait déjà
les animer (6 modes), mais cette capacité est **invisible et inéditable** dans le designer :

- Le composant `led_ring` n'expose dans le panneau Device que `color` + `brightness` ;
  `build: null` → il n'est jamais rendu sur le canvas.
- Le schéma `comp_led_ring` ne persiste que `color` + `brightness`. Mode/période/valeur ne
  passent que par `/update` à l'exécution → ~80 % des capacités firmware ne sont pas designables.
- Le canvas affiche un **liseré décoratif** (`.stage-wrap::before`, dégradé conique ambre/vert
  figé) qui *évoque* la couronne LED mais n'a **aucun lien** avec l'état du `led_ring`.

Objectif : faire du liseré un **aperçu WYSIWYG fidèle** des 13 LEDs, et exposer dans le designer
les capacités déjà présentes côté firmware, en **persistant** la config dans le layout.

## État vérifié (source de vérité)

### Matériel (`lib/board_k718/rgb_ring.h`, `k718_pins.h`)
- 13 × WS2812 (GRB) adressables, GPIO 0. Pilotables individuellement (RGB/HSV).
- Luminosité globale 0–255, défaut 64 (garde-fou alim : 13 LEDs plein blanc ≈ 780 mA vs ~500 mA USB).

### Firmware (`src/led_ring_comp.cpp`, tick 33 ms ≈ 30 fps via `main.cpp:108`)
6 modes : `off`, `solid`, `progress` (N LEDs = `value%` des 13), `spinner` (tête tournante,
`period_ms`), `blink` (duty 50 %, `period_ms`), `breathe` (cosinus, `period_ms`).
Paramètres poussés via `/update` (`dashboard.cpp:306-317 apply_led_ring`) : `mode`, `color`,
`value`, `brightness`, `period_ms`.

### Lacune firmware constatée
Le parse de layout (`dashboard.cpp:95-154`) ne peuple pour le `led_ring` que `c.color` (ligne 111)
et `c.led_brightness_cfg` (ligne 143). Le driver lit `c.led_color / c.led_mode / c.led_period_ms`
— champs **uniquement** remplis par `apply_led_ring` (chemin `/update`). Conséquences au boot :
- `led_mode` = 0 = `LED_OFF` → l'anneau démarre **éteint** jusqu'au premier `/update`.
- La `color` configurée n'atteint jamais le driver (qui retombe sur blanc) tant qu'un `/update`
  ne réémet pas la couleur.

### Designer
- `registry.js:170-179 led_ring` : `compFields` = color + brightness ; `singleton: true`,
  `physical: true` ; `build: null`.
- `device-panel.js` édite les composants physiques hors pages.
- `style.css:196-205 .stage-wrap::before` : liseré conique statique, `pointer-events:none`,
  masqué sur la bande de bord, derrière le disque (z-index 0).

## Décisions (brainstorm)

- **Scope** : niveau B (cumulatif sur A). C reporté.
- **Rendu de l'aperçu** : option 1 — **13 pastilles discrètes, animées** (fidèle au matériel ;
  rend `progress` lisible = N sur 13).
- **7a** : `value` = **mock designer-only** (non persisté), cohérent avec `ring`/`bar` dont la
  valeur vient de `/update`.
- **7b** : sans `led_ring` dans le layout → **13 pastilles grisées** (anneau « off »), indice
  qu'on peut en ajouter un. Le liseré décoratif conique actuel est retiré.
- **7c** : animation **seulement quand le `led_ring` est sélectionné** dans le panneau Device ;
  sinon, frame figée représentative (canvas calme au repos).
- **7d** : **oui** — mini-aperçu live aussi dans le panneau Device (utile quand le canvas est
  sur une autre page).

## Design détaillé

### 1. Schéma — `comp_led_ring` enrichi (`schema/layout.schema.json`)

Champs persistés :
- `type` : const `led_ring` (inchangé).
- `color` : hexColor (inchangé).
- `brightness` : entier 0–255, défaut 64 (inchangé).
- `mode` *(nouveau)* : enum `off | solid | progress | spinner | blink | breathe`, défaut `off`
  (compat ascendante : layout existant reste éteint au boot).
- `period_ms` *(nouveau)* : entier, bornes `100..10000`, défaut 1000.

`value` n'est **pas** dans le schéma (mock designer-only, jamais écrit dans le layout).
`additionalProperties:false` conservé.

### 2. Firmware — config vivante au boot (`src/dashboard.cpp`, `src/led_ring_comp.cpp`)

- **Refactor surgical** : extraire le mapping `"solid"→LED_SOLID…` (aujourd'hui inline dans
  `apply_led_ring`) dans une fonction partagée `LedMode parse_led_mode(const char* m, LedMode def)`.
- **Parse de layout** : pour un composant `led_ring`, initialiser les champs runtime depuis la
  config :
  - `led_color   ← parse_hex_color(o["color"], ...)` (réutilise `c.color` déjà parsé).
  - `led_brightness ← c.led_brightness_cfg`.
  - `led_mode    ← parse_led_mode(o["mode"], LED_OFF)`.
  - `led_period_ms ← o["period_ms"] | 1000`.
  - `led_value` laissé à 0 (progress démarre vide jusqu'au premier `/update` — cohérent avec
    chart/bar).
- `apply_led_ring` (chemin `/update`) **inchangé** dans sa sémantique : surcharge à chaud par-dessus
  la config de boot ; il appelle désormais `parse_led_mode`.

Résultat : un device flashé avec `mode:"breathe", color:"#FF9F40"` respire en ambre **dès le boot**,
sans serveur ; `/update` peut toujours surcharger.

### 3. Designer — édition (`designer/js/registry.js`, `device-panel.js`)

- `led_ring.defaults()` → `{ type:'led_ring', color:'#FFFFFF', brightness:64, mode:'off' }`.
- `led_ring.compFields` :
  - `color` (color), `brightness` (num),
  - `mode` (nouveau type de champ `select` sur l'enum des 6 modes),
  - `period_ms` (num) **affiché seulement** si `mode ∈ {spinner, blink, breathe}`.
- `led_ring.mockFields` : `value` (« Valeur % (aperçu) ») **affiché seulement** si `mode = progress`.
- Affichage conditionnel : réutiliser le mécanisme existant (cf. `ring` : `font`/`center_color`
  conditionnés par `center_pct`).
- `build` reste `null` (pas de placement page) — l'aperçu passe par le renderer global (§4), pas
  par le pipeline de build par composant.
- Un type de champ `select`/`enum` peut être nécessaire dans l'inspecteur (ex. `arcmode`, `barmode`
  existent déjà comme enums dédiés ; ajouter `ledmode` sur le même modèle).

### 4. Designer — aperçu live du canvas (`designer/style.css` + nouveau module `led-ring-preview.js`)

- Retirer `.stage-wrap::before` (liseré conique statique).
- Nouveau module qui peint **13 pastilles** sur le bord du disque (rayon ≈ bord + petit offset,
  comme l'inset:-10px actuel), à l'échelle `--zoom`.
- Lecture de l'état du `led_ring` singleton (`color`, `brightness`, `mode`, `period_ms`, mock `value`).
- Rendu par mode :
  - `off` → 13 grisées ;
  - `solid` → 13 à `color` ;
  - `progress` → `round(value/100*13)` allumées, reste éteintes ;
  - `spinner` → 1 tête, saut discret (steps 13) à `period_ms` ;
  - `blink` → toutes on/off, duty 50 %, `period_ms` ;
  - `breathe` → toutes, opacité cosinus, `period_ms`.
- `brightness` (0–255) → intensité/opacité des pastilles allumées.
- **Animation** uniquement quand le `led_ring` est sélectionné (panneau Device actif sur cet
  élément) ; sinon frame figée représentative. Préfère CSS keyframes (steps) ou un seul rAF
  démarré/arrêté à la sélection, pour ne pas tourner en continu.
- Sans `led_ring` → 13 pastilles grisées (mode « off »).

#### Invariants à NE PAS régresser (cf. CLAUDE.md)
- Les pastilles gardent `pointer-events:none` → un clic dans le liseré reste une **désélection**
  (l'invariant « clic dans le vide (fond ou liseré) → désélection », `canvas.js:399`).
- Ne pas capturer le clic au centre du disque (pas de `<svg>` plein disque).

### 5. Designer — mini-aperçu dans le panneau Device (`device-panel.js`) [7d]

- À côté des champs du `led_ring`, un petit anneau (même renderer que §4, taille réduite) reflétant
  la config en cours d'édition, **animé tant que l'élément est en édition**. Permet de voir le rendu
  même quand le canvas affiche une autre page.
- Factoriser le rendu d'anneau en une fonction réutilisable (canvas §4 et panneau Device §5
  partagent le même peintre).

## Tests

- **Designer (node, `cd designer && node --test`)** :
  - registre : `period_ms` présent ssi mode animé ; `value` (mock) présent ssi `progress` ;
    `defaults()` contient `mode:'off'`.
  - schéma : `mode`/`period_ms` valides ; valeurs hors-bornes rejetées ; `value` non autorisé dans
    le layout (`additionalProperties:false`).
  - rendu aperçu : nombre de pastilles allumées par mode (off=0, solid=13, progress(value)=N,
    spinner=1) — fonction pure testable sans DOM si possible.
- **Firmware (native, `pio test -e native`)** :
  - `parse_led_mode` : chaque chaîne → enum ; défaut sur inconnu.
  - parse de layout `led_ring` → `led_mode/led_color/led_period_ms/led_brightness` corrects au boot.
- **Parité** : un même layout (mode/color/period) doit donner un aperçu designer cohérent avec le
  rendu firmware (vérif manuelle au device en fin de chantier).

## Fichiers touchés (prévision)

- `schema/layout.schema.json` — `comp_led_ring` : +`mode`, +`period_ms`.
- `src/dashboard.cpp` — `parse_led_mode` partagé ; init runtime du `led_ring` au parse.
- `src/led_ring_comp.cpp` / `.h` — adoption de `parse_led_mode` (pas de changement de comportement
  runtime).
- `designer/js/registry.js` — champs `led_ring` (mode/period_ms/value mock, conditionnels).
- `designer/js/inspector.js` — type de champ `ledmode` (select) si absent.
- `designer/js/device-panel.js` — mini-aperçu live [7d].
- `designer/js/led-ring-preview.js` *(nouveau)* — peintre d'anneau partagé (canvas + Device panel).
- `designer/style.css` — retrait du `.stage-wrap::before` statique ; styles des pastilles.
- `designer/index.html` — montage du conteneur d'aperçu si nécessaire.
- Tests : `designer/tests/*.test.js`, `test/*` (native).

## Hors-scope (niveau C — idées futures)

- `bind` du `led_ring` à une variable du contexte (comme les autres composants).
- Couleurs à seuils (vert→ambre→rouge, comme `ring`/`bar`).
- Modes/couleurs par page ; couleurs par-LED.
- Refléter un composant écran sur l'anneau.
