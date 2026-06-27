# Designer Desktop — Découverte mDNS du device

- **Date** : 2026-06-27
- **Branche** : `feat/designer-desktop-electron` (suite du PoC socle, non mergé)
- **Statut** : design validé (brainstorm), spec à relire avant plan d'implémentation
- **Scope** : au lancement de l'app desktop, **découvrir le device sur le réseau** (browse mDNS
  actif) et **remplir l'URL automatiquement** (pastille verte sans saisie). `designer/` reste
  zéro-touch. **Hors-scope** : fichiers locaux et packaging (sous-projets suivants), IPv6,
  renommage du hostname device, persistance d'un device favori.

## Problème

Depuis le PoC socle, l'app desktop fonctionne mais l'utilisateur doit **saisir l'URL du device à
la main** (en desktop le champ est volontairement vide au boot, cf. correctif `app.js`). On veut
supprimer cette saisie : trouver le device automatiquement.

Choix d'ambition arbitré au brainstorm : **browse mDNS actif** dans le main process (et non se
reposer sur la résolution `dialboard.local` de l'OS), pour être **réellement multiplateforme**
(indépendant du support `.local` du système, fragile sur Linux) et gérer plusieurs devices.

## État vérifié (source de vérité)

### Le firmware s'annonce déjà en mDNS — rien à toucher côté device
- `src/main.cpp:42` : `if (MDNS.begin(MDNS_HOST)) MDNS.addService("http", "tcp", HTTP_PORT);` →
  le device publie un service **`_http._tcp`** avec le hostname **`dialboard`**.
- `src/config.h:23` : `#define MDNS_HOST "dialboard"` → joignable en `http://dialboard.local`.
- `src/api.cpp:50-51` : `GET /status` renvoie déjà `ip` et `hostname` (`"dialboard.local"`).

### Le socle desktop, point d'ancrage
- `designer/electron/main.js` : sert `designer/` + `schema/` via `app://`, injecte le CORS.
  La `BrowserWindow` a `webPreferences: { contextIsolation: true }` et **pas de preload** → on en
  ajoute un.
- `designer/electron/package.json` : CommonJS, dép `electron` (42.5.0).

### Le correctif `app.js` rend l'auto-remplissage trivial
- `designer/js/app.js` : `probeConnection()` (check de connexion silencieux) est appelé au boot
  **ET au `change`** du champ `#base`. Donc : poser une valeur dans `#base` puis **dispatcher un
  `change`** suffit à déclencher la vérification de connexion et la **pastille verte**. C'est le
  contrat sur lequel le preload s'appuie — aucune autre modification du designer n'est requise.

## Décisions

1. **Browse mDNS actif** dans le main process via **`bonjour-service`** (pur JS, pas de module natif
   à compiler → empaquetage simple ; vs `mdns`/`dns-sd` natifs, pénibles en cross-platform).
2. **Auto au lancement** : scan au boot ; 1 device → champ rempli + vérifié ; plusieurs → sélecteur ;
   aucun → champ vide. Plus un bouton **⟳ re-scan**.
3. **UI portée par le preload** (capacité desktop-only) → `designer/` zéro-touch. Le preload remplit
   `#base` et **dispatche `change`** (déclenche `probeConnection` → pastille).
4. **On remplit avec l'IP** (`http://<ip>[:port]`, `:80` omis), pas `dialboard.local` → indépendant
   du support `.local` de l'OS. Le port vient de l'annonce mDNS.
5. **Filtre par nom** : services `_http._tcp` dont le nom d'instance/host commence par `dialboard`.
   **Pas** de vérification `GET /status` au scan — `probeConnection` valide à la sélection.

## Architecture

```
designer/electron/
  discovery.mjs   (créer)  # logique PURE : enregistrement mDNS → {name,ip,port,url} + filtre/omit:80
  main.js         (modif)  # + handler IPC 'discover-devices' : browse bonjour, applique discovery, renvoie []
  preload.js      (créer)  # DOMContentLoaded → invoke → remplit #base (+ change) / sélecteur / ⟳
  package.json    (modif)  # + dépendance bonjour-service
designer/tests/
  mdns-discovery.test.js (créer)  # teste discovery.mjs (sans réseau)
designer/js/      # ZÉRO-TOUCH (s'appuie sur probeConnection au change, déjà en place)
```

## Composants

### `designer/electron/discovery.mjs` (logique pure, testable)
- `toDeviceUrl(ip, port)` → `http://<ip>` (+ `:port` si `port !== 80`).
- `isDialboardService(svc)` → vrai si `name`/`host` commence par `dialboard` (insensible à la casse).
- `parseService(svc)` → `{ name, ip, port, url }` à partir d'un enregistrement bonjour (1re adresse
  IPv4 ; ignore les services sans IPv4). Aucune I/O réseau ici → testable en node.

### `designer/electron/main.js` (effet de bord : browse)
- Handler `ipcMain.handle('discover-devices', …)` : ouvre un browser bonjour sur `_http._tcp`,
  collecte les `up` pendant **~2,5 s** (borné), ferme le browser, mappe via `discovery.mjs`
  (`parseService` + `isDialboardService`), **dédoublonne par IP**, renvoie le tableau.
- Importé en dynamique depuis le handler async : `const d = await import('./discovery.mjs')`
  (`main.js` est CommonJS ; `discovery.mjs` est ESM).

### `designer/electron/preload.js` (nouveau, autonome)
- `require('electron').ipcRenderer`. Pas de `contextBridge` exposé au renderer — le preload fait tout
  lui-même (le designer n'a pas à connaître mDNS).
- Sur `DOMContentLoaded` : `const list = await ipcRenderer.invoke('discover-devices')`, puis :
  - **0** → ne touche à rien.
  - **1** → `base.value = list[0].url; base.dispatchEvent(new Event('change'));`.
  - **≥2** → injecte un `<select>` (option par device : `name — url`) à côté de `#base` ; au choix,
    remplit + `change`.
  - Toujours : injecte un bouton **⟳** qui relance `discover-devices` et ré-applique la même logique.
- Le preload manipule le DOM (`#base`, identifiant stable) ; couplage léger et documenté.

### `BrowserWindow`
- Ajout `webPreferences.preload = path.join(__dirname, 'preload.js')` (avec `contextIsolation: true`).

## Flux

boot → fenêtre (avec preload) → page chargée → `DOMContentLoaded` → preload `invoke('discover-devices')`
→ main browse `_http._tcp` (~2,5 s) → filtre `dialboard` → renvoie `[{name,ip,port,url}]` → preload :
0/1/≥2 → remplit `#base` + `change` → `probeConnection` (designer) → pastille verte. Bouton ⟳ = relance.

## Gestion d'erreurs

- mDNS indisponible / aucun device → **champ vide, aucune erreur bloquante** (best-effort, cohérent
  avec `probeConnection`). Le scan est borné en temps et le browser bonjour fermé après.
- Plusieurs interfaces réseau : on retient les adresses **IPv4** ; dédoublonnage par IP.
- Le handler attrape ses erreurs et renvoie `[]` plutôt que de rejeter (le preload reste silencieux).

## Tests & critères de succès

- **Auto (node:test, sans réseau)** : `discovery.mjs` — `toDeviceUrl` (omission `:80`),
  `isDialboardService` (match/insensible casse/rejet d'un service non-dialboard), `parseService`
  (extraction IPv4, rejet si pas d'IPv4). Critère : tests verts + suite designer non régressée.
- **Manuel (runtime Electron)** : `npm start` →
  - le champ se remplit tout seul si le device (ou un faux annonceur) est présent, pastille **verte** ;
  - bouton ⟳ relance ; cas « plusieurs » → sélecteur ; cas « aucun » → champ vide, pas d'erreur console.
- **Faux annonceur (sans matériel)** : un court script node `bonjour.publish({name:'dialboard',
  type:'http', port:8099})` (+ le mock device sur 8099) pour exercer le scan de bout en bout.
- **Honnêteté de couverture** : `main.js` (browse) et `preload.js` (injection DOM) ne sont **pas**
  auto-testés (runtime Electron) — validés manuellement. Seule `discovery.mjs` est auto-testée.

## Risques / points d'attention

- **`_http._tcp` est générique** : d'autres appareils l'annoncent. Le filtre par nom `dialboard`
  écarte le bruit ; `probeConnection` confirme à la sélection. Acceptable pour le périmètre.
- **Collision de hostname** si plusieurs devices `dialboard` : le 2e devient `dialboard-2.local`
  côté mDNS → le filtre `commence par dialboard` les capte tous (cas « plusieurs » géré).
- **preload + sandbox** : le preload n'a besoin que de `ipcRenderer` + `document` (disponibles même
  en renderer sandboxé). `bonjour-service` tourne dans le **main** (non sandboxé).
- **Empaquetage** : `bonjour-service` est pur JS → pas de rebuild natif ; sera pris en compte au
  sous-projet packaging.
