# Designer — onglet « Device » : dump du contexte pour débugger source/sink

- **Date** : 2026-07-02
- **Périmètre** : designer uniquement (`designer/`). **Aucun changement firmware.**
- **But** : voir, depuis le designer, l'état runtime du device (blackboard + télémétrie source/sink) pour débugger les mécanismes de sources et de sinks.

## 1. Contexte & objectif

Le firmware **expose déjà** tout le nécessaire ; le manque est purement côté designer :

- **`GET /context`** (`src/api.cpp:35`) — dump du **blackboard** : `{"nom": valeur, …}` de toutes les vars ; filtre optionnel `?vars=a,b,c` (CSV, tokens exacts). C'est l'état que les *sources* écrivent et que les *sinks* observent.
- **`GET /status`** (`src/api.cpp:65`) — la **télémétrie** par source (`name`, `last_status`, `err_count`, `updated_at`) et par sink (`name`, `last_status`, `err_count`, `fired_at`).

Côté designer aujourd'hui : `device.js` n'a **aucun `getContext`** (le `/context` n'est jamais interrogé) ; `getStatus` est appelé mais ses tableaux `sources`/`sinks` sont écrasés en une ligne de tooltip de pastille (`app.js`) puis jetés.

**Asymétrie utile au debug** (justifie le pull manuel plutôt qu'un poll continu) : la **télémétrie** (`/status` : `fired_at`, `last_status`, `err_count`) est **durable** — un pull *après* une action répond de façon fiable à « le sink a-t-il tiré ? quel code HTTP ? ». Les **valeurs** (`/context`) peuvent être **transitoires** (un `momentary` remet la var à 0/`""` juste après). Le pull manuel couvre l'essentiel ; l'auto-refresh ne sert qu'à *regarder* une interaction se dérouler.

## 2. Périmètre

**Inclus** : un onglet « Device » dans la console existante, piloté par une case de réglage (visibilité, miroir de `logActivity`/`logJs`/`logNet`), avec bouton **Pull** manuel, toggle **Auto** éphémère (2 s), bouton **Copier** (snapshot JSON), et 3 tables (Vars / Sources / Sinks).

**Exclus** (hors périmètre, possibles plus tard) :
- Exposer le **corps réellement envoyé par un sink** ou la **réponse brute d'une source** (le firmware ne les garde pas → nécessiterait un changement firmware).
- Un journal d'événements / timeline des `POST /update` (plus lourd, partiellement firmware).
- Persistance de l'état du toggle Auto (YAGNI).

## 3. Architecture & flux

```
[Panneau console: onglet Device]
   │  clic Pull  (ou tick Auto)
   ▼
pullDeviceContext()          ← injecté par app.js (connaît base + device.js)
   │  Promise.all
   ├── getContext(base)      → GET /context   → { nom: valeur, … }
   └── getStatus(base)       → GET /status    → { sources:[…], sinks:[…], … }
   ▼
{ vars, sources, sinks }  → rendu des 3 tables (+ ages calculés)
```

`console.js` reste **agnostique du transport** : il reçoit une fonction `pullDeviceContext` et ne connaît ni l'URL de base ni `device.js`. Le calcul d'affichage (lignes + âges) est extrait en fonction **pure** testable node.

## 4. Couche données — `designer/js/device.js`

Ajout d'un seul export (miroir des fetchs existants, via `devFetch` → journalisé réseau) :

```js
// GET /context : dump du blackboard { nom: valeur, … }. vars = CSV optionnel (filtre ?vars=).
export async function getContext(base, vars) {
  const q = vars ? '?vars=' + encodeURIComponent(vars) : '';
  const r = await devFetch(base, '/context' + q);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
```

`getStatus` existe déjà (inchangé).

## 5. Réglage de visibilité — `designer/js/settings.js`

- `defaultSettings()` : ajout de `deviceContext: false` (**caché par défaut** — outil de debug, seul onglet qui parle au device).
- `normalizeSettings()` : `deviceContext: typeof r.deviceContext === 'boolean' ? r.deviceContext : d.deviceContext` (miroir des `logActivity`/`logJs`/`logNet`).
- `createSettings().build()` : une `settingRow(t('settings.device_context'))` + `checkbox(s.deviceContext, v => setSettings({ deviceContext: v }))`, placée juste après les 3 cases de journaux.
- **Câblage déjà en place** : `setSettings` appelle `dconsole.refreshTabs()` à chaque changement (`app.js:84`) → la nouvelle case montre/masque l'onglet sans code supplémentaire.

## 6. Onglet & panneau — `designer/js/console.js`

- Nouvel onglet `deviceCtx` : `tabBtns.deviceCtx = mkTab('deviceCtx', t('console.tab.device_context'))`, ajouté au `head` et à `panelByTab`.
- **Visibilité** : `logVisible()` (renommage cosmétique possible en `tabVisible()`, ou simple extension) inclut `deviceContext` → `syncView()` masque `tabBtns.deviceCtx` si la case est décochée. `refreshTabs()` : si l'onglet actif est `deviceCtx` et devient caché → retombe sur `problems` (même règle que les journaux).
- **Panneau** : barre d'outils **[Pull] [☐ Auto (2 s)] [Copier]** + 3 tables :
  - **Vars** : `nom` → `valeur` (colonne âge omise par défaut — `/context` ne renvoie pas de timestamps ; voir §11 risque « Âge des vars »).
  - **Sources** : `name`, `last_status`, `err_count`, âge de `updated_at`.
  - **Sinks** : `name`, `last_status`, `err_count`, âge de `fired_at`.
  - États **vide** (pas encore de pull / device sans vars) et **erreur** (message inline).
- **Dépendance injectée** : `createConsole(root, model, { validate, logs, getSettings, pullDeviceContext })`. `app.js` fournit `pullDeviceContext = async () => { const base = $('base').value; const [vars, status] = await Promise.all([getContext(base), getStatus(base)]); return { vars, sources: status.sources || [], sinks: status.sinks || [] }; }`.
- **Copier** : réutilise les i18n `console.copy`/`console.copied`/`console.copy_failed` ; copie un snapshot JSON `{ vars, sources, sinks }` du dernier pull.

## 7. Cycle de vie de l'auto-refresh (point sensible)

- Toggle = état **local éphémère** `autoOn` (off par défaut, **non persisté** ; se remet à off à chaque session/rechargement).
- Un seul `setInterval(2000)`. Il ne tourne **que si** `autoOn && isOpen && tab === 'deviceCtx' && visible(deviceContext)`. Un helper `syncAuto()` (re)démarre/arrête le timer ; appelé depuis `syncView`, `selectTab`, `toggle.onclick` (pliage), `refreshTabs`, et le handler de la case Auto.
- **Conséquence** : fermer la console, changer d'onglet, décocher la case de réglage, ou couper Auto → `clearInterval` → **zéro trafic device inutile**. C'est ce qui répond à la crainte « le poll est lourd ».
- **Garde anti-empilement** : flag `inFlight` ; un tick programmé est **sauté** si le pull précédent n'est pas revenu (device lent → pas d'accumulation de requêtes sur le loop-task partagé du firmware).
- **Pull manuel** : fait toujours **une** requête immédiate, indépendamment du toggle.
- **Erreur** : un pull échoué affiche un message inline (et est déjà loggé au journal réseau via `devFetch`) ; l'auto **continue** de ticker (device offline transitoire ne doit pas tuer la boucle ; l'utilisateur décoche Auto si le device est durablement absent).

## 8. Fréquence

2 s par défaut quand Auto est actif (jamais sous ~1 s : le `WebServer` du firmware partage le loop-task de `lv_timer_handler()` → un poll trop rapide risque des micro-saccades à l'écran). Non configurable (YAGNI).

## 9. i18n — `designer/i18n/en.js` + `fr.json` (parité stricte EN = FR)

Nouvelles clés (EN **et** FR, le test de parité impose l'égalité des comptes) :
- `settings.device_context` — libellé de la case de réglage.
- `console.tab.device_context` — libellé de l'onglet (« Device »).
- `console.devctx.pull`, `console.devctx.auto`, `console.devctx.vars`, `console.devctx.sources`, `console.devctx.sinks`, `console.devctx.empty`, `console.devctx.error` (+ en-têtes de colonnes si non triviaux).
- **Réutilise** `console.copy` / `console.copied` / `console.copy_failed` (pas de nouvelle clé de copie).

## 10. Tests & critères d'acceptation

Convention repo : DOM console/settings = **QA navigateur** (pas de test node) ; logique pure = **test node**.

**Node** :
- `normalizeSettings` : `deviceContext` — booléen respecté, non-booléen → défaut `false`.
- Formateur pur du dump (extrait de `console.js`) : `{ vars, sources, sinks }` + `now` → lignes attendues + âges (s) ; tableaux vides tolérés ; entrées non-tableau tolérées (`Array.isArray`, miroir du durcissement sources/sinks).

**QA navigateur** (serveur no-store + vrais events pointer, **EN et FR**, cf. mémoire `designer-verif-navigateur`) :
1. Case de réglage cochée → onglet « Device » apparaît ; décochée → disparaît ; si actif au moment du masquage → retombe sur *Problèmes*.
2. **Pull** (device mock ou réel) → les 3 tables se remplissent (vars, sources, sinks) avec statuts/âges.
3. **Auto** coché → poll observable au réseau **toutes les 2 s** ; **s'arrête** dès qu'on : ferme la console, change d'onglet, décoche la case de réglage, ou décoche Auto (vérifié : plus de requêtes `/context` au journal réseau).
4. Garde `inFlight` : device lent → pas d'empilement de requêtes.
5. **Copier** → snapshot JSON `{vars, sources, sinks}` dans le presse-papier.
6. Device offline → message d'erreur inline, pas de crash, 0 erreur console.
7. **0 erreur/warning console** en EN et FR ; libellés FR intégraux.

**Sanity** : `cd designer && node --test` vert ; parité i18n EN = FR (0 orpheline).

## 11. Risques & pièges

- **Âge des vars** : `/context` renvoie `{nom: valeur}` **sans** timestamps (cf. `ctx_to_json`). L'âge par var n'est donc pas disponible directement depuis `/context`. Options : (a) omettre la colonne âge de la table Vars et ne garder l'âge que pour Sources/Sinks (issus de `/status`) — **retenu par défaut** (simple, honnête) ; (b) corréler par nom avec `sources[].updated_at` quand un même nom est à la fois var et source (partiel). À trancher à l'implémentation ; le défaut (a) est sûr.
- **`getStatus` sans `sinks`/`sources`** : un firmware ancien pourrait ne pas renvoyer les tableaux → `|| []` déjà prévu ; tables vides, pas de crash.
- **Durcissement `Array.isArray`** : le formateur tolère un `vars`/`sources`/`sinks` non-tableau (import/réponse malformée), miroir de la convention sources/sinks du designer.
- **Fuite de timer** : `syncAuto()` doit couvrir **tous** les chemins qui invalident les conditions (pliage, changement d'onglet, refreshTabs, toggle) sinon un `setInterval` orphelin continue de poller la console fermée. Point de vigilance QA n°3.
- **Base device vide/invalide** : si `$('base').value` est vide, le pull échoue proprement (chemin erreur §7), pas de requête vers une URL cassée bloquante.
