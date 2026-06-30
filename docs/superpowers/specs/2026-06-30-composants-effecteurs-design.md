# Composants effecteurs — design

> Spec issu d'un brainstorm (2026-06-30). Première brique des composants **effecteurs**
> (saisie/action utilisateur), après les composants **afficheurs**. Cible : socle minimal,
> symétrique de l'existant, sans casser la nav ni le modèle de données.

## 1. Contexte et objectif

Tous les composants actuels sont des **afficheurs** : ils *consomment* le contexte (`bind:"var"`).
On ajoute des **effecteurs** : l'utilisateur agit au doigt, le composant *produit* dans le contexte,
et un nouveau pont HTTP **sortant** propage vers le réseau. Symétriquement, on ajoute la **lecture
externe** du contexte. Objectif v1 : un socle de 5 effecteurs + la plomberie de communication.

## 2. Le modèle : le contexte comme bus bidirectionnel

Le `Context` (blackboard de `CtxVar` num|str) devient le **bus central**, avec une symétrie complète :

```
 sources[]    ─pull─►┐                                  ┌─► afficheurs (bind, lecture)
 POST /update ──────►│            CONTEXTE              │
 POST /context ─────►│   var: num|str (+t, +origine)   ├─► effecteurs (bind, lecture+écriture UI)
                     │     ▲ écrit            │ lit     │
   effecteurs (UI) ──┘     │                  ▼─────────┘
                           │
   sinks[] ◄─armés par écriture d'ORIGINE UI seule─► POST/PUT/GET API externe
   GET /context ◄─lecture externe (tout + ?vars=)
```

- **Afficheur** = consommateur du contexte (`bind`, inchangé).
- **Effecteur** = producteur du contexte (écrit à l'interaction tactile), **et** consommateur
  (`bind` : reflète la valeur courante → bidirectionnel).
- **`sources[]`** = entrées HTTP du contexte (existant). **`sinks[]`** = sorties HTTP du contexte (nouveau, miroir).
- **`GET /context`** = lecture externe à la demande (complément *pull* du *push* des sinks).

## 3. Décisions actées (brainstorm)

| # | Décision | Justification |
|---|----------|---------------|
| 1 | **HTTP sortant réactif** : `sinks[]` observe des vars et POST, miroir de `sources[]`. (≠ action HTTP inline par widget) | Découple « UI qui produit » de « câblage qui envoie » ; mutualise le HTTP ; réutilise headers/secrets/templating ; effecteur trivial. |
| 2 | **Effecteurs bidirectionnels** : reflètent la var (`bind`) **et** l'écrivent ; le sink n'est armé que par une écriture **d'origine UI**. | Widgets « vivants », cohérents avec le réel ; fusionne afficheur/effecteur sur `bind` ; l'origine coupe la boucle de rétroaction. |
| 3 | **Tactile primaire** : manipulation au doigt ; l'encodeur reste la **nav de pages** (inchangé). | Zéro conflit modal ; tous les candidats marchent au tactile sur 360 rond ; l'édition à l'encodeur (clic non câblé) est différée. |
| 4 | **Socle v1 = 5 composants** : button, switch, slider, arc, roller. | Couvre déclencher / basculer / régler (linéaire **et** rond) / choisir. Tous touch-natifs. Les variantes (buttonmatrix, spinbox, checkbox, dropdown, list) sont différables sans manque. |
| 5 | **`GET /context`** : tout par défaut + filtre `?vars=a,b`. | LAN mono-utilisateur, **aucun secret dans le contexte** (store write-only séparé) → liste blanche = cérémonie (YAGNI). Ajoutable plus tard sans casse. |
| 6 | **Bouton = `set` + `momentary`**. | `set` (latch, ex. `scene="movie"`) + `momentary` (transitoire/one-shot, ex. `doorbell`). *Toggle* = c'est le switch ; *increment* = différé. |
| 7 | **Designer : panneau `sinks` dédié**. | Édition WYSIWYG comme les autres réglages (≠ schéma + JSON à la main). |

## 4. Spécification firmware

### 4.1 Origine d'écriture sur le contexte

Une écriture du contexte porte désormais une **origine** : `UI` (effecteur) vs `EXTERNAL`
(`source` / `/update` / `/context`).

- Écriture **UI** → **arme** chaque sink qui observe cette var (cf. 4.2).
- Écriture **EXTERNAL** → met à jour l'affichage (les effecteurs bound se re-synchronisent visuellement)
  mais **n'arme aucun sink** → coupe la boucle.

Implémentation pressentie : conserver `ctx_set_num/str` (chemin EXTERNAL par défaut) et ajouter un
chemin UI (paramètre d'origine ou fonctions `*_ui`) qui, après l'écriture, parcourt `sinks[]` et marque
`pending_since = now` sur ceux dont `watch` == var. **Pas de flag d'origine persistant sur `CtxVar`** :
l'armement vit sur le **sink** (état runtime), ce qui gère proprement plusieurs sinks sur une même var.

### 4.2 `sinks[]` (miroir de `sources[]`)

**Schéma (layout top-level) :**

```jsonc
"sinks": [{
  "name": "Lampe salon",                 // libellé (apparait dans GET /status)
  "watch": "lamp",                       // 1 var déclencheuse (l'écriture UI arme ce sink)
  "method": "POST",                      // défaut POST ; PUT / GET possibles
  "url": "http://ha.local/api/states/light.salon",
  "headers": { "Authorization": "$ha_token" },   // "$nom" = secret (store write-only), comme sources
  "debounce_ms": 0,                      // 0 par défaut ; slider/arc ex. 300 (coalesce le drag)
  "body": { "state": "{{lamp}}" }        // gabarit JSON ; {{var}} substitué depuis le contexte
                                         //   absent ⇒ corps par défaut {"<watch>": <valeur>}
}]
```

Deux sigils distincts et cohérents : **`$nom`** = secret (headers, résolu au fire, jamais renvoyé),
**`{{var}}`** = var de contexte (corps, substituée au fire ; number→JSON number, string→JSON échappé).

**Déclenchement (`push_task`, miroir de `net_pull`) :**

- Tâche dédiée épinglée **cœur 0** (comme `pull_task`), boucle ~250 ms.
- Pour chaque sink `pending_since != 0` et `now - pending_since >= debounce_ms` → **fire**.
- **Debounce de traîne** : chaque écriture UI rafraîchit `pending_since = now` → le sink part
  `debounce_ms` après la **dernière** modif (drag de slider coalescé en 1 POST). `debounce_ms=0` ⇒ tir au tick suivant.
- **Patron mutex de `net_pull`** : snapshot de la config + résolution des secrets + substitution du
  corps **sous mutex**, puis requête HTTP **hors mutex** (peut bloquer plusieurs s), puis maj
  `last_status`/`err_count`/`fired_at` sous mutex. `pending_since` remis à 0 au lancement du fire.

**Stockage (calqué sur `Source`, `dashboard.h` + `config.h`) :**

```c
// config.h (nouvelles bornes)
#define MAX_SINKS              6
#define MAX_HEADERS_PER_SINK   4
#define SINK_BODY_LEN          192

// dashboard.h
struct SinkHeader { char name[HEADER_NAME_LEN]; char value[HEADER_VAL_LEN]; };
struct Sink {
    char        name[TEXT_LEN];
    char        watch[ID_LEN];
    uint8_t     method;                 // 0=POST 1=PUT 2=GET
    char        url[URL_LEN];
    SinkHeader  headers[MAX_HEADERS_PER_SINK];
    int         header_count;
    char        body[SINK_BODY_LEN];    // "" => corps par défaut
    uint32_t    debounce_ms;
    // runtime
    uint32_t    pending_since;          // 0 = non armé
    int         last_status; int err_count; uint32_t fired_at;
};
// Dashboard : Sink sinks[MAX_SINKS]; int sink_count;
```

`GET /status` expose les sinks (name/last_status/err_count/fired_at), comme les sources aujourd'hui.

### 4.3 `GET /context`

Nouveau handler dans `api.cpp` : lit le contexte sous mutex, sérialise `{ "<nom>": <valeur>, … }`
(num ou str tels que stockés). `?vars=lamp,volume` restreint au sous-ensemble (CSV) ; absent ⇒ tout.

### 4.4 Les 5 effecteurs

Nouveaux `COMP_*` dans le tableau de composants existant (`MAX_COMPONENTS=32`). Tous réutilisent
`bind:"var"` (reflète + écrit). Interaction = callbacks LVGL **sur le thread UI** (`loop()` /
`lv_timer_handler`), qui prennent brièvement `g_ctx_mutex` pour l'écriture (origine UI).

| Type | Champs (hors placement) | Widget LVGL | Événement → écrit |
|------|-------------------------|-------------|-------------------|
| **button** | `bind`, `value` (num\|str), `momentary` (bool), `text` | `lv_button` + label | `CLICKED` → `bind = value` (UI). Si `momentary` : écrit `value` (arme le sink, 1 POST) puis **reset** différé de la var en EXTERNAL (n'arme pas) → le bound display retombe au repos. Reflet optionnel : surbrillance si `ctx==value` (radio). |
| **switch** | `bind` | `lv_switch` | `VALUE_CHANGED` → `bind = on?1:0` (UI). Reflet : état depuis `ctx`. |
| **slider** | `bind`, `min`, `max`, `orientation`, `step?` | `lv_slider` | `VALUE_CHANGED` → `bind = val` (UI, **live**). Sink débouncé. Reflet : `set_value` depuis `ctx`. |
| **arc** (knob) | `bind`, `min`, `max`, `step?` + (placement) `radius`/`thickness`/`gap_deg`/`start_angle` | `lv_arc` mode input | `VALUE_CHANGED` → `bind = val` (UI, **live**). **Rond-natif**, réutilise l'esthétique ring. Sink débouncé. Reflet depuis `ctx`. |
| **roller** | `bind`, `options[]` (libellés Latin-1), `rows?` | `lv_roller` | `VALUE_CHANGED` → `bind = index` (UI, nombre). Reflet : `set_selected` depuis `ctx`. *(Mapping index→valeur via `values[]` différé.)* |

**Reflet vs interaction (anti-conflit)** : la re-synchro d'un effecteur depuis une écriture EXTERNAL
ne doit pas court-circuiter un geste en cours (slider/arc en drag). Règle : appliquer l'update
externe **sauf** si le widget est en état d'édition LVGL (drag actif) — last-writer-wins sinon.

**Placement** : button (`width`/`height`), switch (taille par défaut), slider (`width`/`height` +
`orientation`), arc (réutilise `radius`/`thickness`/`gap_deg`/`start_angle` du ring), roller
(`width`/`height`, `rows` visibles). Le tactile vise des cibles ≥ ~44 px sur 360 rond.

### 4.5 Parité du parser

`dash_set_layout` parse les nouveaux `COMP_*` et le bloc `sinks[]` (tolérant aux clés inconnues, comme
aujourd'hui). `MAX_SINKS`/bornes appliquées. Le schéma `layout.schema.json` (strict,
`additionalProperties:false`) ajoute `comp_button/switch/slider/arc/roller` au `oneOf` et la propriété
top-level `sinks` (+ `$defs/sink`).

## 5. Designer / parité

- **Producteurs effecteurs** : pour chacun des 5, un patron designer comme les afficheurs —
  `registry.js` (entrée + champs inspecteur), `render.js` (rendu WYSIWYG + parité visuelle),
  `canvas.js` (hit-test/placement), i18n EN↔FR. Le designer **simule** l'interaction (un slider se
  règle dans le canvas) sans réseau.
- **Panneau `sinks` dédié** (décision 7) : un panneau de réglages (calqué sur le panneau settings
  existant) pour ajouter/éditer des sinks — `name`, `watch` (liste des vars connues), `method`, `url`,
  `headers` (avec `$secret`), `debounce_ms`, `body` (gabarit). Validation contre `$defs/sink`.
- Parité de rendu effecteur↔firmware attendue (même contrat schéma), comme pour les afficheurs.

## 6. Hors v1 (différé, sans manque fonctionnel)

- Composants : **buttonmatrix** (pavé/scènes), **spinbox** (± précis), **checkbox** (variante switch),
  **dropdown** (variante roller via overlay), **list** (menu d'actions). Exclus : textarea+keyboard
  (clavier à l'étroit sur rond), calendar, colorwheel.
- **Édition à l'encodeur** (modèle focus LVGL) — suppose de câbler/confirmer le clic encodeur.
- **Mapping `values[]`** du roller (index → valeur émise).
- **Liste blanche** `GET /context` (si exposition au-delà du LAN mono-utilisateur).

## 7. Risques & points ouverts

- **Boucle de rétroaction** : gérée par l'origine UI (le sink n'est armé que par l'UI). À valider en
  conditions réelles (source qui repull la var qu'un effecteur vient d'écrire).
- **Templating `{{var}}`** : nouveau (les sources n'extraient que via JSON Pointer). Garder la
  substitution **simple** (placeholders dans un gabarit JSON ; pas de mini-langage). Échappement
  correct des strings. Borne `SINK_BODY_LEN`.
- **Conflit reflet/drag** (4.4) : à éprouver à l'œil sur device.
- **Charge réseau** : `debounce_ms` par défaut > 0 pour slider/arc dans les templates designer.
- **Pile TLS** du `push_task` HTTPS : mêmes précautions que `net_pull` (16 KB, monter à 20 KB si reset).
- **Sécurité** : `GET /context` expose tout le contexte sur le LAN ; acceptable (mono-utilisateur, pas
  de secret). À reconsidérer si le device sort du LAN.

## 8. Critères de succès (v1)

1. Les 5 effecteurs se placent et s'éditent dans le designer (WYSIWYG), JSON exporté **schema-valide**.
2. Sur device : tap/toggle/drag/scroll écrit la var attendue ; un afficheur `bind` sur la même var
   reflète le changement (cohérence interne via le contexte).
3. Un `sink` observant la var **POST** le corps templaté à l'URL (secret résolu) — armé par l'UI,
   **pas** par un repull `source` (pas de boucle). Slider/arc : **un seul** POST après settle (debounce).
4. `GET /context` renvoie les valeurs courantes ; `?vars=` filtre.
5. `pio test -e native`, `cd designer && node --test`, `pio run -e esp32s3` au vert ; parité i18n EN↔FR.
6. Le tout **sans régresser** la nav (encodeur = pages) ni les afficheurs existants.
```
