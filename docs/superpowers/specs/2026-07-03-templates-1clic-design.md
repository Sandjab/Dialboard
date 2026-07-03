# Templates 1-clic — design

> Statut : design validé au brainstorm (2026-07-03). Prochaine étape : plan d'implémentation (`writing-plans`).
> 100 % designer (web + embarqué LittleFS + Electron). Zéro firmware.

## 1. Objectif & valeur

Passer du **canvas vide** à un dashboard fonctionnel et esthétique en **un clic**. C'est le levier
d'**adoption** : un nouvel utilisateur (ou un curieux qui découvre le device) obtient une valeur
immédiate au lieu d'une page blanche à construire.

Contrainte de crédibilité : pour les templates « câblés » (météo/crypto), le rendu doit vraiment
fonctionner **sur le device**, pas seulement afficher des mocks dans le designer. Faisabilité
**vérifiée** : `src/net_pull.cpp` fait du HTTPS (`WiFiClientSecure` + `setInsecure()`, l.61-65 ;
handshake mbedtls, stack montée l.113). Les API HTTPS gratuites sont donc atteignables.

## 2. Décisions de cadrage (brainstorm)

| Question | Décision |
|---|---|
| Substance d'un template | **Mixte** : câblé clé-en-main quand une API publique gratuite existe ; skeleton sinon. |
| Effet du chargement | **Remplace tout** le layout courant, avec **confirmation** si le canvas n'est pas vide. |
| Shipping | **Fichiers statiques embarqués** + manifeste (miroir de `designer/i18n/index.json`). |
| Lot v1 | **5 templates** : clock, weather, crypto, server, home-assistant. |
| API crypto | **CoinGecko** (`/api/v3/simple/price`, prix **+ variation 24 h**). Risque rate-limit/clé démo assumé. |
| Miniatures gallery | **Miniature live dès la v1** (réutilise les builders `render.js`). |

## 3. Approche architecturale (3 envisagées)

- **A — fichiers statiques + manifeste (RETENUE).** `designer/templates/index.json` (manifeste
  `[{id, file}]`) + un layout `*.json` par template. Chargés à la demande. **Layout-only** (pas
  d'assets d'image) → simple `model.loadJSON`, pas besoin du bundle `.dboard`. Marche hors-ligne,
  sur le LAN, dans l'Electron. **Miroir exact du pattern `i18n/index.json`** déjà dans le repo
  (Rule 11 : convention citable).
- **B — objets JS inline** (comme `default-layout.js`) → *rejeté* : gonfle le bundle toujours chargé,
  mêle données et code, mal adapté à un set qui grandit.
- **C — gallery distante** (GitHub raw) → *rejeté* : casse le hors-ligne/LAN, impose CORS, or le
  device est souvent sans accès internet.

## 4. Composants (unités isolées)

### 4.1 `designer/templates/` — données
- `index.json` : `[{ "id": "clock", "file": "clock.json" }, …]`. Manifeste minimal (mêmes champs
  d'esprit que `i18n/index.json`).
- Un layout par template : `clock.json`, `weather.json`, `crypto.json`, `server.json`,
  `home-assistant.json`. Chacun **schema-valide** (`schema/layout.schema.json`), layout-only.
- **Aucun libellé UI en dur ici** : nom/description/note de config vivent dans le catalogue i18n
  sous `templates.<id>.{name,description,setupNote}` (tout le texte UI reste centralisé — cohérent
  avec le repo). Le *contenu* des layouts (libellés de composants type « Température ») est figé
  par template, dans la langue par défaut du designer.

### 4.2 `designer/js/templates.js` — logique + UI
- `openGallery()` : construit la modale à partir du manifeste (une carte par template).
- Chaque carte : **titre + description + badge** (« prêt à l'emploi » / « à brancher ») +
  **miniature live** (§4.4).
- Au clic sur une carte : si le canvas n'est pas vide → confirmation (`confirm.js`) ; puis
  `fetch(file)` → `model.loadJSON(text)` → `onLoad()` (reset page active + sélection, exactement
  comme `file-io.js`) → **toast** portant la `setupNote` (i18n).
- Échap / clic hors-modale = ferme.
- Nouveau bouton `#templates` dans la topbar `index.html` (classe `.tb-btn` + attributs
  `data-i18n-*`, à côté des 4 boutons export/import existants).

### 4.3 i18n
Nouvelles clés dans `designer/i18n/fr.json` (et `en.json` quand WS-1 arrivera) :
`toolbar.templates.{tip,title}`, `templates.title`, `templates.badge.{ready,wire}`,
`templates.<id>.{name,description,setupNote}` (×5), `confirm.replace_layout`,
`toast.template_loaded`. Contrainte charset : le contenu par défaut reste Latin-1 (cf. WS-2).

### 4.4 Miniature live — rendu isolé
Le dispatch de rendu est **déjà data-driven** : `canvas.js::buildNode` = `COMPONENTS[type].build(comp,
pl, mock)` (registre `registry.js`) + positionnement via `placeAt()` (`geometry.js`, stage 360). La
miniature réutilise **directement** ces deux briques dans un rendu isolé :
- Nouvelle petite fonction (dans `templates.js` ou un `preview.js` dédié) : pour un layout donné,
  itère `pages[0].place`, résout `components[ref]`, appelle `COMPONENTS[type].build(comp, pl, mock)`,
  positionne dans un stage 360×360 détaché, puis **réduit par CSS `transform: scale(k)`** dans la
  carte.
- **`canvas.js` reste intouché** (on ne touche pas à la logique fragile sélection/poignées/guides —
  cf. invariants QA du CLAUDE.md). La boucle de placement (~20 lignes) est répliquée, pas partagée :
  duplication assumée en échange de la sûreté de l'éditeur.
- Nuance à traiter au plan : les composants **radiaux** (ring/rings/meter/led_ring) se positionnent
  au centre du stage, pas via `placeAt` — la boucle miniature doit refléter le traitement de
  `canvas.js`. Valeurs = mocks des builders (`MOCKS.*`, défauts suffisants pour une vignette).

### 4.5 Test node (`designer/tests/`)
Charge chaque `templates/*.json`, le **valide** contre `schema/layout.schema.json` **et** les limites
firmware (max pages/placements) via la logique de `validate.js`. *Pourquoi* (Rule 9) : un template
livré cassé = mauvaise première impression et, pour un layout poussé au device, un risque de rejet
firmware → **doit être bloqué en CI**, jamais découvert par l'utilisateur. Test purement données
(pas de DOM) → exécutable sous `node --test` (cf. mémoire `designer-tests-dom-builders`).

## 5. Flux de données (templates câblés)

Le layout embarque `sources:[{name,url,interval_s,vars:{v:"/json/pointer"}}]` + des composants
`bind:"v"`. **Sur le device** : `net_pull` fetch l'URL à son `interval_s`, extrait les vars par
JSON Pointer, les écrit dans le contexte ; les composants `bind` lisent la valeur. **Dans le
designer** : pas de fetch réel → mocks. La `setupNote` post-import dit **quoi personnaliser**.

Secrets : jamais dans le layout. Une source qui a besoin d'un token le référence par `$nom` dans
`headers` ; l'utilisateur pose la valeur via `POST /secrets` (write-only). La `setupNote` l'explique.

## 6. Le lot v1 (5 templates)

- **clock** — *zéro config.* `clock` (NTP on-device) + date + anneau déco. `tz` par défaut Paris
  (`CET-1CEST,M3.5.0,M10.5.0`), note pour changer. Marche dès l'import.
- **weather** — *câblé, open-meteo, sans clé.*
  `https://api.open-meteo.com/v1/forecast?latitude=48.85&longitude=2.35&current=temperature_2m,wind_speed_10m,relative_humidity_2m`
  → vars `temp`/`wind`/`hum` (pointers `/current/temperature_2m`, …) → anneau température +
  readouts. `setupNote` : « Renseigne latitude/longitude de ta ville dans le panneau Sources ».
- **crypto** — *câblé, CoinGecko, sans clé.*
  `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true`
  → prix (`/bitcoin/usd`) + variation 24 h (`/bitcoin/usd_24h_change`) → prix en readout + variation
  en anneau coloré (thresholds). `setupNote` : « Change la crypto (`ids=`) dans l'URL de la source ».
  ⚠ **Risque** : le tier gratuit CoinGecko est rate-limité et pousse aux « demo keys » — pérennité à
  surveiller ; repli documenté au plan (ex. Coinbase spot, prix seul) si l'API libre se ferme.
- **server** *(skeleton)* — jauges CPU/RAM/uptime + **source placeholder**
  (`http://mon-serveur:9100/metrics` ou un JSON perso) + `setupNote` détaillée. N'affiche rien tant
  que non branché — assumé.
- **home-assistant** *(skeleton)* — quelques états (température, présence…) + source placeholder
  `http://homeassistant.local:8123/api/states/<entity>` avec header `Authorization: $ha_token` +
  `setupNote` (créer un jeton longue durée, le poser via `POST /secrets`).

## 7. Gallery UI (MVP)

Modale ; cartes verticales : **miniature live + titre + description + badge**
(« prêt à l'emploi » vert / « à brancher » ambre). Clic sur la carte = charge. Échap / clic
hors-modale = ferme. Réutilise les primitives d'overlay existantes (`confirm.js`, drawer/carousel).

## 8. Non-goals (YAGNI v1)

- Pas de « sauver le dashboard courant comme template ».
- Pas de fusion / add-page (remplace tout).
- Pas d'assets/images de fond dans les templates (layout-only).
- Pas de gallery distante ni de contributions utilisateur.
- Pas de « fill-in-the-blanks » guidé : la personnalisation se fait dans le panneau Sources existant,
  guidée par la `setupNote`.

## 9. Critères de succès

- Nouvel utilisateur → « Modèles » → « Horloge » → dashboard affiché, **zéro config**.
- « Météo » → après avoir mis sa lat/lon, **le device affiche la vraie température**.
- `node --test` : **tous** les templates livrés valident (schéma + limites firmware).
- Parité designer : chaque template rend correctement dans le canvas ET en miniature
  (browser-verified).
- Chargement d'un template sur un canvas non vide : confirmation, puis remplacement propre (page
  active + sélection réinitialisées, panneau Sources reflète les sources du template).

## 10. Risques & points à trancher au plan

- **CoinGecko** : rate-limit / clé démo → surveiller ; repli documenté (Coinbase spot) si fermeture.
- **weather_code / conditions** : open-meteo renvoie un code WMO numérique, pas un libellé — v1 se
  limite à temp/vent/humidité (pas de mapping code→icône, éventuel fast-follow).
- **Positionnement radial** en miniature (cf. §4.4) : refléter fidèlement `canvas.js`.
- **Langue du contenu** des layouts (libellés « Température » etc.) : figée dans la langue par
  défaut du designer ; à confirmer au plan (FR aujourd'hui, EN quand WS-1 bascule le défaut).
