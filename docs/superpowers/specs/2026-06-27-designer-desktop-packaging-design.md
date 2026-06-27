# Designer Desktop — Packaging (build local non signé, macOS)

- **Date** : 2026-06-27
- **Branche** : `feat/designer-desktop-electron`
- **Statut** : design validé (brainstorm), spec à relire avant plan d'implémentation
- **Scope** : produire un **installeur macOS non signé** (`.dmg` + `.app`) du designer desktop via
  `electron-builder`, en résolvant le **staging** de `designer/` + `schema/` (qui vivent *hors* de
  `designer/electron/`) dans les `resources` de l'app empaquetée, et une **icône** dérivée de la
  marque (anneau orange). **Hors-scope** : signature/notarisation, Windows/Linux + CI, auto-update.

## Problème

Le PoC socle Electron tourne en dev (`designer/electron/` : `main.js` sert `designer/` + `schema/`
via le protocole interne `app://`, injecte les en-têtes CORS pour parler au device). Les incréments
mDNS et fichiers locaux/bundle `.dboard` sont faits. Mais il n'existe **aucun artefact
distribuable** : on ne peut lancer l'app qu'avec `npm start` depuis le repo, où `ROOT` pointe deux
niveaux au-dessus (la racine du repo, qui contient `designer/` et `schema/` côte à côte).

Pour empaqueter, deux choses manquent :

1. **Staging** — `designer/` et `schema/` doivent être **copiés dans l'app** (Electron asar ne
   contient que `designer/electron/`), et `main.js` doit savoir résoudre `ROOT` selon dev vs
   packagé.
2. **Identité** — `appId`, `productName`, **icône** (le `.app` porterait sinon l'icône Electron
   générique).

Choix de techno arbitré en amont (spec socle) : **Electron** + **electron-builder** pour le
packaging.

## État vérifié (source de vérité)

### `designer/electron/main.js` — résolution de racine
- `main.js:11` : `const ROOT = path.resolve(__dirname, '..', '..')` → racine du repo en dev
  (contient `designer/` ET `schema/`).
- `main.js:43` : `protocol.handle('app', …)` mappe `app://app/<chemin>` → `path.join(ROOT, pathname)`,
  avec **garde anti-traversée** `main.js:47` : `if (!filePath.startsWith(ROOT + path.sep)) return 403`.
- La page se charge sur `app://app/designer/index.html` (`main.js:87`) ; le `fetch('../schema/…')`
  du designer résout vers `app://app/schema/…`.
- **Conséquence** : en packagé, `designer/` et `schema/` ne sont plus à `__dirname/../..`. `ROOT`
  doit basculer vers leur emplacement réel dans les `resources`.

### Convention de staging existante — `tools/stage_fs.sh`
- Stage bien `designer/` + `schema/`, **mais pour LittleFS** : aplatit vers `data/` **et renomme
  `index.html` → `index.htm`** (quirk `serveStatic` du WebServer firmware).
- Electron charge `index.html` via `app://` (pas `.htm`) → **cette convention ne se réutilise pas
  telle quelle** ; un staging Electron devrait justement *diverger* de `stage_fs.sh`. Argument
  « convention » donc faible pour un script dédié (voir Décisions).

### Dépendances runtime
- `bonjour-service` (mDNS, `designer/electron/package.json`) est une **dépendance de prod** →
  electron-builder l'embarque automatiquement (il inclut les deps de prod, pas les devDeps).

### Outillage icône disponible localement (vérifié)
- `magick`/`convert` (ImageMagick), `cairosvg`, `sips`, `iconutil` présents → chaîne
  SVG → PNG 1024 → `.iconset` → `.icns` faisable (moitié arrière native macOS via `sips`/`iconutil`).
- Marque existante : favicon SVG inline `designer/index.html:8` — cercle `stroke #FF9F40`,
  `viewBox 0 0 32 32`, sans fond. Seul élément de branding du projet.

## Décisions

1. **electron-builder**, config sous la clé `build` de `designer/electron/package.json` (ajouté en
   devDependency). Script `"dist": "electron-builder --mac"`.

2. **Staging via `extraResources` pointant les vrais dossiers** (et **non** un script de staging
   dédié). electron-builder copie `../../designer` → `Contents/Resources/app-root/designer` et
   `../../schema` → `Contents/Resources/app-root/schema` au build, via des mappings `from`/`to`
   explicites (cas d'usage prévu d'`extraResources`). `designer/` reste l'octet près identique à
   l'embarqué (invariant projet) ; aucun script ni arbre gitignoré dupliqué.
   - **Écartée — script `stage` dédié** (façon `stage_fs.sh`, copie dans `designer/electron/staged/`
     gitignoré) : confine les entrées au dossier app, mais ajoute un 2e script de staging à
     maintenir et un arbre dupliqué — et il faudrait de toute façon *diverger* de `stage_fs.sh`
     (pas de rename `.htm`), donc le bénéfice « convention » est illusoire. YAGNI.

3. **`ROOT` bascule sur `app.isPackaged`** (changement chirurgical, 1 ligne dans `main.js`) :
   `const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app-root') : path.resolve(__dirname, '..', '..')`.
   Sous-dossier `app-root/` (plutôt que la racine de `resources`) pour que la garde anti-traversée
   confine `app://` à **exactement** designer+schema, sans exposer `app.asar` & co. Le reste de
   `main.js` est inchangé.

4. **Build non signé explicite** : `mac.identity = null` → electron-builder ne cherche aucun
   certificat. Un `.app` construit localement tourne sans blocage Gatekeeper (la quarantaine ne
   frappe que les apps *téléchargées*). Cible `dmg`, arch **hôte (arm64)**.

5. **Icône dérivée de la marque, générée une fois, committée** : source
   `designer/electron/build/icon.svg` (anneau `#FF9F40`, fond transparent) ; script
   `designer/electron/build/make-icon.sh` (cairosvg→PNG 1024, `sips` → `.iconset`, `iconutil` →
   `icon.icns`). **On committe `icon.icns`** → le packaging ne dépend pas de l'outillage icône au
   build (electron-builder référence le `.icns` committé). L'utilisateur est juge du rendu visuel.

## Architecture

```
designer/                       # SOURCE UNIQUE, inchangée
  index.html, js/, style.css, vendor/
schema/                         # inchangé
designer/electron/
  main.js                       # MODIFIÉ : ROOT bascule sur app.isPackaged
  package.json                  # MODIFIÉ : + devDep electron-builder, clé "build", script "dist"
  build/
    icon.svg                    # NOUVEAU : source de l'icône (anneau)
    make-icon.sh                # NOUVEAU : SVG → icon.icns (one-shot)
    icon.icns                   # NOUVEAU (committé) : référencé par electron-builder
  dist/                         # NOUVEAU, gitignoré : sortie .dmg/.app
```

## Composants

### `designer/electron/main.js` (modifié)
- Unique changement : la ligne `ROOT`. `app` est déjà importé ; `app.isPackaged` est lisible
  synchroniquement au chargement du module. Garde anti-traversée et handler `app://` inchangés.

### `designer/electron/package.json` (modifié)
- `devDependencies` += `electron-builder`.
- `scripts` += `"dist": "electron-builder --mac"`.
- Clé `build` :
  - `appId: "io.github.sandjab.dialboard.designer"` (reverse-DNS calqué sur le dépôt public ;
    pas de domaine personnel committé).
  - `productName: "Dialboard Designer"`.
  - `directories.output: "dist"`.
  - `files` : **uniquement des négations** `["!mock-device.mjs", "!mock-announce.mjs"]` —
    elles s'**ajoutent** aux includes par défaut d'electron-builder (qui embarquent `node_modules`
    de prod dont `bonjour-service`), au lieu de les remplacer. On ne fait qu'exclure les mocks de
    dev. ⚠ Une liste d'includes positifs remplacerait le glob par défaut et risquerait de larguer
    `node_modules` → ne pas faire.
  - `extraResources` : `[{ from: "../../designer", to: "app-root/designer" },
    { from: "../../schema", to: "app-root/schema" }]`.
  - `mac` : `{ icon: "build/icon.icns", category: "public.app-category.developer-tools",
    target: ["dmg"], identity: null }`.

### `designer/electron/build/make-icon.sh` (nouveau)
- Rasterise `icon.svg` en PNG 1024×1024 (cairosvg, fallback `magick`), génère un `.iconset` aux
  tailles attendues par `iconutil` (16…512 + @2x) via `sips`, puis `iconutil -c icns` → `icon.icns`.
- Idempotent, lancé à la main quand l'icône change. Sa sortie (`icon.icns`) est committée.

### `.gitignore`
- += `designer/electron/dist/`.

## Flux (build)

1. `cd designer/electron && npm install` (récupère electron-builder).
2. (Une fois, ou à chaque changement d'icône) `bash build/make-icon.sh` → `build/icon.icns`.
3. `npm run dist` :
   - electron-builder empaquette `main.js`/`preload.js`/`discovery.mjs` (+ deps de prod dont
     `bonjour-service`) dans `app.asar`,
   - copie `designer/` + `schema/` dans `Contents/Resources/app-root/` (extraResources),
   - applique l'icône, produit `dist/Dialboard Designer-0.0.0-arm64.dmg` + le `.app`.
4. À l'ouverture du `.app` : `app.isPackaged === true` → `ROOT = resources/app-root` →
   `app://app/designer/index.html` et `…/schema/…` résolvent depuis les resources. Le designer
   tourne identique au dev ; l'injection CORS reste active pour parler au device/mock.

## Gestion d'erreurs

- **Staging absent/mal mappé** : si `extraResources` ne copie pas designer/schema sous `app-root/`,
  le handler `app://` renvoie déjà un **404 logué** (`main.js`) — pas d'échec muet ; détecté au 1er
  lancement (fenêtre vide + log). Critère de succès #2 ci-dessous l'attrape.
- **electron-builder `from` hors dossier app** : supporté, mais **à confirmer au 1er build** (cf.
  Risques). Si refus, repli sur le script `stage` (décision 2, variante écartée).
- **Icône manquante au build** : electron-builder émet un warning et retombe sur l'icône par défaut
  — non bloquant ; on committe le `.icns` pour l'éviter.

## Tests & critères de succès

- **Build** : `npm run dist` produit `dist/Dialboard Designer-0.0.0-arm64.dmg` **et** le `.app`,
  sans erreur de signature (grâce à `identity: null`).
- **Lancement empaqueté** : ouvrir le `.app` → la fenêtre **affiche le designer** (prouve que
  `app://` résout designer+schema depuis `process.resourcesPath`).
- **Transport en packagé** : Charger / Statut / Pousser **contre le mock device** réussissent
  *depuis le `.app`* (prouve que l'injection CORS + le staging tiennent une fois empaqueté).
- **Non-régression designer** : `cd designer && node --test` reste vert (on ne touche pas
  `designer/`).
- **Honnêteté de couverture** : `main.js` (protocole `app://`, bascule `ROOT`) et la config
  electron-builder ne sont **pas** auto-testés — ils exigent le runtime Electron + un build réel.
  Validés **manuellement** (les 3 critères ci-dessus). À ne pas présenter comme auto-testés.

## Hors scope (YAGNI — incréments suivants, chacun son cycle spec→plan)

- **Signature / notarisation** : cert Apple Developer + notarisation macOS, signature Windows.
- **Windows / Linux** : NSIS (Win), AppImage/deb (Linux) — nécessite un build CI (GitHub Actions),
  pas productibles proprement depuis le Mac seul.
- **Auto-update** : feed GitHub Releases via `electron-updater`.
- **Universal / x64** : ce build cible l'arch hôte (arm64) uniquement.

## Risques / points d'attention

- **`extraResources` `from` hors du dossier projet** : electron-builder résout `from` relativement
  au dossier de l'app (`designer/electron/`) ; `../../designer` pointe donc hors de cet arbre. Les
  mappings `from`/`to` explicites le gèrent, mais **à vérifier au 1er build** (présence effective de
  `Resources/app-root/{designer,schema}`). Repli : script `stage`.
- **Garde anti-traversée en packagé** : `ROOT = resources/app-root` confine `app://` à designer+
  schema ; vérifier que la garde `startsWith(ROOT + path.sep)` ne casse pas un chemin légitime une
  fois sous `resources` (séparateurs, casse).
- **Icône anneau sur fond transparent** : convention macOS = squircle plein ; un anneau nu peut
  paraître petit/atypique. Rendu soumis au juge visuel (utilisateur) ; ajustable (fond/échelle) sans
  toucher au reste.
- **Version electron-builder** : épingler une version récente compatible avec l'Electron déjà
  épinglé (`^42.5.0`).
