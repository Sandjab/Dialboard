# Composant `led` — design

> Spec validée le 2026-06-21. Source de cadrage : brainstorming (3 décisions ci-dessous).
> Prochaine étape : plan d'implémentation (writing-plans).

## Motivation

La palette gagne un voyant lumineux : un point dont la couleur reflète une valeur
poussée (ou lue via `bind`), et qui s'éteint sous un seuil. Cas d'usage : état
binaire (connecté/déconnecté, alarme on/off) **et** multi-état (vert/orange/rouge
selon une mesure). Premier ajout « affichage pur » débloqué par l'inventaire LVGL 9.5 ;
n'introduit aucun canal sortant (reste dans le modèle push entrant de Dialboard).

## Contexte technique vérifié (live source, 2026-06-21)

- **Le projet est en LVGL 9.5.0** (`platformio.ini:14`, `lv_version.h`), pas 8.4.
  `CLAUDE.md` et `docs/_internal/HANDOFF.md` affirment « 8.4, migration 9 = prochain
  chantier » : **note périmée** (la migration a eu lieu — `lv_scale`/`lv_arclabel`
  sont déjà utilisés dans `view.cpp`). À corriger séparément de ce chantier.
- `lv_led` existe en 9.5 (`src/widgets/led/lv_led.{c,h}`). `LV_USE_LED` vaut 1 par
  défaut dans ce build (pas de Kconfig → fallback `lv_conf_internal.h` = 1). API :
  `lv_led_create`, `lv_led_set_color`, `lv_led_on`, `lv_led_off`, `lv_led_set_brightness`.
- `threshold_color(const Threshold*, int n, float value, uint32_t base)` (`src/color.cpp`)
  renvoie la couleur du **premier** seuil tel que `value < limite` (seuils en ordre
  croissant), sinon `base`. Réutilisé tel quel pour la couleur allumée.
- Firmware **table-driven** : enum `CompType` (`src/dashboard.h`), table type→enum +
  table `apply` + dispatch d'update + parsing générique des `thresholds`
  (`src/dashboard.cpp`), table `{build, sync}` par type (`src/view.cpp`).

## Décisions de cadrage

1. **Pilotage** : seuils + extinction (réutilise le mécanisme `thresholds` existant).
2. **Extinction** : champ `off_below` (défaut 1). `value < off_below` → éteint ;
   sinon allumé. Couvre le binaire 0/1 sans configuration.
3. **Libellé** : LED nu. Pour un libellé, poser un `label`/`readout` à côté
   (modèle 1:1 déjà en place). Pas de champs `label*` intégrés.

## Modèle de données — `comp_led` (schéma)

| Champ | Type | Défaut | Rôle |
|---|---|---|---|
| `type` | `"led"` | — | discriminant |
| `bind` | ascii | absent | variable de pull ; absent = push par id |
| `color` | hexColor | `#22C55E` | couleur allumée quand aucun seuil ne matche |
| `off_below` | number | `1` | `value < off_below` → éteint ; sinon allumé |
| `thresholds` | `[[limite,"#hex"], …]` | absent | couleur allumée selon la valeur (`threshold_color`) |

Géométrie : un seul champ neuf, **`size`** (diamètre en px, défaut `24`, borné
`1..360`), posé sur `placement` — comme `width`/`height` (bar) et `radius`/`thickness`
(ring) y vivent déjà. Position via `anchor`/`dx`/`dy`. `led` n'utilise pas
`width`/`height`/`radius`/etc.

## Logique firmware

À chaque valeur reçue (push par id ou pull via `bind`), `c.value` est mis à jour
comme pour `meter`/`bar`. Le `sync` du LED applique :

```
if (value < off_below)  lv_led_off(w);                       // sombre mais visible
else { lv_led_on(w); lv_led_set_color(w, threshold_color(thresholds, n, value, color)); }
```

Le halo lumineux est natif `lv_led`. Aucune logique d'état hors firmware.

## Rendu designer (`render.js` → `buildLed`)

Disque CSS de diamètre `size`, couleur = **même résolution de seuil que le firmware**
(parité de rendu exigée par `CLAUDE.md`), léger halo (glow radial) imitant `lv_led`.
L'état (allumé/éteint + couleur) suit la valeur de mock (`mockFields: [['value', …]]`).
Le look exact (taille du halo, aspect éteint) sera figé via une maquette comparative
avant écriture du rendu.

## Câblage (par couche)

- **`schema/layout.schema.json`** : `$defs/comp_led` + entrée dans `component.oneOf` ;
  `size` ajouté à `placement`.
- **`designer/js/registry.js`** : entrée `led` (defaults, `compFields` =
  couleur/off_below/seuils/bind, `placeFields` = `size`, `mockFields` = value, `build`).
- **`designer/js/render.js`** : `buildLed(comp, pl, mock)` + import dans registry.
- **`designer/js/icons.js`** : glyphe `led` (cercle plein + petit halo), style maison
  (viewBox 24, trait 2, bouts ronds).
- **`src/dashboard.h`** : `COMP_LED` dans l'enum `CompType` (avant `COMP_COUNT`) ;
  champ `off_below` dans la struct composant.
- **`src/dashboard.cpp`** : `{"led", COMP_LED}` dans la table de types ; parsing de
  `off_below` ; entrée dans la table `apply` ; case d'update (scalaire → `c.value`).
- **`src/view.cpp`** : `build_led` + `sync_led` dans la table `{build, sync}`.
- **`src/lv_conf.h`** : `#define LV_USE_LED 1` (redondant techniquement mais conforme
  à la convention « lister les widgets extra utilisés »).

## Tests

- `designer` (node --test) : la conformité registry↔schéma (`tests/registry.test.js`
  vérifie déjà l'égalité des clés de type) couvre l'ajout ; ajouter un cas de
  validation d'un `led` bien/mal formé.
- `pio test -e native` : couvre le cœur logique sans HW ; vérifier qu'un layout avec
  `led` parse et que la résolution de seuil/extinction est correcte si testable au natif.
- Vérification visuelle : aperçu designer (allumé selon seuil, éteint sous `off_below`)
  via screenshot, comme pour la palette.

## Hors-scope (volontaire)

- Pas de libellé intégré (LED nu — décidé).
- Pas de clignotement/animation/breathe (le `led_ring` physique a ses modes ; le `led`
  d'écran reste un voyant statique piloté par valeur).
- Pas de canal sortant tactile (le LED est un afficheur, pas un contrôle).
- Correction des notes périmées 8.4 dans `CLAUDE.md`/`HANDOFF` : à traiter à part.
