# Design — 5 nouveaux composants : clock, rings, qr, stepper, segmented

Date : 2026-07-02
Statut : design validé (brainstorm), en attente de relecture avant plan d'implémentation.

## Contexte

Dialboard rend un dashboard **config-driven** : un layout JSON décrit pages + composants ;
le **designer WYSIWYG** (embarqué) édite ce layout ; les valeurs sont poussées par `POST /update`.
Le catalogue actuel compte 20 types (label, readout, bar, chart, meter, ring, image, image_anim,
led, icon, switch, button, slider, arc, roller, rect, circle, line, led_ring, sound).

On ajoute **5 composants**, en **une seule fois**, en **version minimale d'abord**. Le schéma JSON
(`schema/layout.schema.json`) reste la **source commune** (validée designer ET firmware) et la
**parité de rendu designer↔firmware** est un invariant du projet.

## Objectifs

- 3 composants d'**affichage** (sink / valeur poussée) : `clock`, `rings`, `qr`.
- 2 **effecteurs** (source / le tactile produit une valeur sur le bus bidirectionnel) : `stepper`, `segmented`.
- Rester minimal : pas de fonctionnalités au-delà du socle utile de chaque composant (voir « Hors périmètre »).

## Décisions verrouillées (brainstorm)

1. **`clock` = heure du device via NTP** (le provisioning WiFi de la PR #29 rend `configTzTime` trivial).
   L'horloge marche seule, aucun POST requis. Pas de `bind`.
2. **Fuseau = un champ `tz` à la racine du layout** (chaîne TZ POSIX, gère l'heure d'été), pas par
   composant : le device a une seule heure. **Défaut `UTC0`** (neutre).
3. **`qr` : parité designer via encodeur JS jumeau** de celui de LVGL (vendorisé) → QR **réellement
   scannable** dans l'aperçu, parité exacte. (Options écartées : rendu approximatif, placeholder.)
4. **`segmented` écrit un index numérique** (conformité avec `roller`), `options` = libellés.

## Périmètre transverse (s'applique aux 5)

- **Schéma** (`schema/layout.schema.json`) : +5 `const` de type + 1 champ racine `tz`. Limites firmware
  **gardées côté designer** (convention projet) : `rings` ≤ 3 pistes, `segmented` 2–4 options,
  `qr` longueur de `text` bornée (cap de version QR), `stepper` bornes cohérentes.
- **Firmware** : dispatch de rendu dans `src/view.cpp` + application de valeur dans `src/dashboard.cpp`.
- **Designer** : mapping `FAMILY` (`designer/js/canvas-zones.js`) + registre des types + rendu
  `designer/js/render.js` + champs inspecteur.
- **i18n EN=FR** : libellés palette + champs inspecteur (parité stricte, comme le reste du projet).
- **Tests** : cœur pur en natif (Unity, `test/`) + designer (node, `designer/tests/`), parité.
- **2 ajouts d'infra firmware** : heure NTP (`clock`) ; `LV_USE_QRCODE 1` (`qr`). Détaillés plus bas.

## Palette designer (familles)

- `clock` → **data** · `rings` → **data** · `qr` → **rich** · `stepper` → **effectors** · `segmented` → **effectors**.

---

## 1. `clock` — horloge (famille *data*, affichage)

- **Rôle** : affiche l'heure **du device** (NTP). **Aucun `bind`** (la source, c'est l'horloge device).
- **Champs (minimaux)** :
  - `mode` : `analog` | `digital` (défaut `analog`).
  - `show_seconds` : bool (défaut false). Si false, rafraîchissement à la minute.
  - `show_date` : bool (défaut false).
  - `color`, police (famille/taille/gras) : conventions communes des composants texte.
- **Rendu firmware** : analogique = aiguilles en `lv_line` + ticks (même approche « dessin main » que
  meter/ring) ; digital = readout Tiny TTF. Un `lv_timer` rafraîchit chaque seconde (ou minute).
  L'heure vient de `localtime()` après `configTzTime`.
- **Parité designer** : cadran à une **heure d'exemple figée** (ex. 10:10) — parité d'**allure**, pas
  de sync live. Formateur pur (heure → angles d'aiguilles / `HH:MM`) testé des deux côtés.
- **Hors périmètre** : alarmes, 12h/AM-PM, multi-fuseaux par composant, fond image.

## 2. `rings` — anneaux d'activité (famille *data*, affichage)

- **Rôle** : 1 à **3 pistes concentriques**, chacune = une valeur poussée (lue via `bind`).
- **Champs (minimaux)** :
  - `tracks` : liste de 1–3 objets `{ bind, min (déf. 0), max (déf. 100), color }`.
  - `center` : optionnel — texte libre affiché au centre (ou vide).
- **Rendu firmware** : N `lv_arc` en indicateur, rayons décroissants calculés par index ; chaque piste
  lit son `bind`. Réutilise la mécanique de l'anneau `ring` existant, empilée.
- **Application valeur** (raffiné au plan : `/update` adresse par **ID de composant**, pas par var) :
  `POST /update {"<ringsId>": [v0, v1, v2]}` (tableau, push-by-id) met à jour les pistes dans l'ordre.
  Chaque piste garde un `bind` optionnel pour le chemin pull/sources (lu via `context_apply`).
- **Parité designer** : arcs concentriques (prototype validé au brainstorm).
- **Hors périmètre** : seuils/gradients par piste (couleur unie), > 3 pistes, légende courbe par piste,
  countdown.

## 3. `qr` — QR code (famille *rich*, affichage)

- **Rôle** : encode une chaîne — URL du device (utile après le portail captif WiFi) ou payload poussé.
- **Champs (minimaux)** :
  - `text` : chaîne encodée (défaut = URL du device). **Updatable via `bind`** comme un label
    (`POST /update {"<id>": "…"}`).
  - couleurs (contraste requis ; défauts sombre/clair).
- **ECC figé à MEDIUM** (découvert au plan : `lv_qrcode.c` hardcode `qrcodegen_Ecc_MEDIUM`).
  Pas de champ `ecc` : les deux côtés encodent en MEDIUM → parité triviale.
- **Rendu firmware** : `LV_USE_QRCODE 1` dans `src/lv_conf.h` + `lv_qrcode_create` / `lv_qrcode_update`.
  (`lv_qrcode` est présent dans notre LVGL 9.5 : `.pio/libdeps/esp32s3/lvgl/src/libs/qrcode/`,
  seulement désactivé par défaut.)
- **Parité designer (option a)** : **vendoriser l'encodeur JS jumeau** de celui utilisé par
  `lv_qrcode` → même standard, même version/ECC ⇒ **QR identique et scannable** dans l'aperçu.
  *À faire au plan* : identifier précisément l'encodeur de `lv_qrcode` pour choisir le port JS exact.
- **Hors périmètre** : logo au centre, ECC animé, quiet-zone paramétrable.

## 4. `stepper` — incrément +/− (famille *effectors*, **source**)

- **Rôle** : pousse une **consigne numérique** sur le bus bidirectionnel (thermostat, volume…).
  Modèle calqué sur `slider`/`arc` (effecteurs à `bind` + `min`/`max`/`step`).
- **Champs (minimaux)** :
  - `bind` : variable écrite (origine UI).
  - `min` (déf. 0), `max` (déf. 100), `step` (déf. 1), `value` initiale.
  - `unit` : suffixe affiché (ex. `°`), optionnel.
  - `color`.
- **Rendu firmware** : conteneur = deux zones tactiles (−/+) + valeur centrale ; le tap borne
  `[min,max]` et **pousse** la valeur (socle effecteurs v1). Réversible : `/update` peut refléter la
  valeur (le composant est aussi sink de sa propre var, comme les autres effecteurs).
- **Parité designer** : dessine −/valeur/+ ; inspecteur = min/max/step/unit/bind. Clamp pur testé
  des deux côtés.
- **Hors périmètre** : appui long / répétition auto, valeurs décimales (entiers), animation.

## 5. `segmented` — contrôle segmenté (famille *effectors*, **source**)

- **Rôle** : choix **exclusif** parmi **2–4** segments ; **écrit l'index** sélectionné (comme `roller`).
- **Champs (minimaux)** :
  - `bind` : variable écrite à la sélection (**index numérique**).
  - `options` : liste 2–4 de libellés (`display`).
- **Rendu firmware** : `lv_buttonmatrix` en sélection unique (`LV_BUTTONMATRIX_CTRL_CHECKABLE`) ; le tap
  sélectionne et pousse l'index. Reprend la sémantique index/labels du `roller`, à plat.
- **Parité designer** : pilule segmentée ; inspecteur = liste d'options + bind. Réversible via `/update`.
- **Hors périmètre** : multi-sélection, > 4 segments, défilement, icônes par segment.

---

## Infra firmware (minimale)

- **NTP (clock)** : après connexion WiFi (`src/wifi_prov`), appeler
  `configTzTime(tz, "pool.ntp.org")` ; `tz` lu à la racine du layout (défaut `UTC0`). L'heure locale
  (`localtime()`) devient dispo pour le rendu du `clock`. Dégradé propre si pas encore synchronisé
  (afficher `--:--` / cadran neutre jusqu'à la 1ʳᵉ synchro).
- **lv_conf (qr)** : `#define LV_USE_QRCODE 1` dans `src/lv_conf.h`.

## Stratégie de tests (parité)

- **Natif (Unity, `test/`)** : logique pure sans HW/LVGL —
  clamp `stepper` `[min,max]`+`step` ; sélection `segmented` → index ; mapping piste→valeur `rings` ;
  formatage `HH:MM` / angles d'aiguilles depuis un `struct tm`.
- **Node (designer, `designer/tests/`)** : formateurs purs —
  angles d'aiguilles depuis l'heure ; géométrie des arcs `rings` ; clamp `stepper` ; index `segmented` ;
  nombre de modules / version `qr` (encodeur jumeau).

## Risques / points de vigilance

- **QR parité** : le seul composant avec un coût de parité réel (encodeur JS à vendoriser, à aligner
  exactement sur celui de `lv_qrcode`). Bordure « quiet zone » et niveau ECC doivent matcher.
- **NTP** : dépend du WiFi connecté ; gérer l'état « heure non encore synchro ».
- **`lv_buttonmatrix`** pour `segmented` : vérifier la disponibilité/style dans notre `lv_conf`.
- **Espace écran rond** : `segmented` 2–4 segments et `rings` 3 pistes doivent rester lisibles en 360×360
  (limites gardées côté designer).

## Hors périmètre global (YAGNI, éventuelle v2)

- `colorwheel` (retiré du cœur LVGL 9, dessin main requis) — non retenu ce lot.
- Seuils multi-pistes, 12h, appui long stepper, multi-sélection segmented, QR à logo.
