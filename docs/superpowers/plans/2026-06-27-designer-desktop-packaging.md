# Designer Desktop — Packaging (build local non signé macOS) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produire un `.dmg`/`.app` macOS **non signé** du designer desktop Electron, en empaquetant `designer/` + `schema/` (situés hors de `designer/electron/`) et une icône dérivée de l'anneau.

**Architecture:** electron-builder bundle le wrapper (`designer/electron/`) et copie `designer/` + `schema/` dans `Contents/Resources/app-root/` via `extraResources`. `main.js` fait basculer `ROOT` sur `app.isPackaged` pour que le protocole `app://` résolve depuis les resources en packagé et depuis la racine du repo en dev. L'icône est générée une fois depuis un SVG (anneau `#FF9F40`) et committée.

**Tech Stack:** Electron (`^42.5.0`, déjà épinglé), electron-builder, cairosvg/sips/iconutil (génération `.icns`), Node `node:test` (non-régression designer existante).

> **⚠ Honnêteté de couverture (lire avant de commencer).** Le cœur de cet incrément — config electron-builder, bascule `ROOT`, mapping `extraResources` — **n'est pas auto-testable** : `main.js` exige le runtime Electron (`require('electron')`), et le staging ne se prouve qu'en construisant l'app. Le **build + lancement manuel (Task 4) EST le test**. Ne pas inventer de test Node qui n'exerce pas le vrai chemin. Le seul test automatique du périmètre est la **non-régression** de la suite designer existante (on ne touche pas `designer/`). Cette posture est volontaire et héritée de la spec socle.

**Spec :** `docs/superpowers/specs/2026-06-27-designer-desktop-packaging-design.md`

---

## File Structure

| Fichier | Rôle | Action |
|---|---|---|
| `designer/electron/main.js` | Wrapper Electron : `app://`, CORS, fenêtre | **Modifier** (1 ligne : `ROOT`) |
| `designer/electron/package.json` | Manifeste wrapper | **Modifier** (devDep + script `dist` + clé `build`) |
| `designer/electron/package-lock.json` | Lockfile | **Modifier** (via `npm install`) |
| `designer/electron/build/icon.svg` | Source de l'icône (anneau) | **Créer** |
| `designer/electron/build/make-icon.sh` | SVG → `icon.icns` (one-shot) | **Créer** |
| `designer/electron/build/icon.icns` | Icône compilée, **committée** | **Créer** (généré) |
| `.gitignore` | Ignore la sortie de build | **Modifier** (+ `designer/electron/dist/`) |

`designer/` et `schema/` restent **inchangés** (invariant projet : octet près identiques à l'embarqué).

---

## Task 1: Bascule `ROOT` sur `app.isPackaged` dans `main.js`

**Files:**
- Modify: `designer/electron/main.js:11`

- [ ] **Step 1: Lire le contexte exact**

Run: `sed -n '1,15p' designer/electron/main.js`
Objectif : confirmer que la ligne 11 est bien `const ROOT = path.resolve(__dirname, '..', '..');` et que `app` est déjà importé en tête (il l'est — `main.js` crée une `BrowserWindow`). Si `app` n'est pas dans les imports, l'ajouter au `require('electron')` existant.

- [ ] **Step 2: Modifier la ligne `ROOT`**

Remplacer :

```js
const ROOT = path.resolve(__dirname, '..', '..');
```

par :

```js
// En dev, ROOT = racine du repo (designer/ + schema/ côte à côte, deux niveaux au-dessus).
// En packagé, electron-builder a copié designer/ + schema/ dans resources/app-root (extraResources).
const ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app-root')
  : path.resolve(__dirname, '..', '..');
```

- [ ] **Step 3: Vérifier que le dev n'a pas régressé (lancement)**

Run: `cd designer/electron && npm start`
Expected: la fenêtre s'ouvre et **affiche le designer** (en dev, `app.isPackaged === false` → branche inchangée). Fermer la fenêtre. C'est la seule vérification possible à ce stade ; la branche packagée est validée en Task 4.

> Pas de test Node ici : `main.js` ne s'importe pas hors runtime Electron (`require('electron')`). Ne pas en simuler un.

- [ ] **Step 4: Commit**

```bash
git add designer/electron/main.js
git commit -m "feat(designer): packaging — ROOT bascule sur app.isPackaged"
```

---

## Task 2: Icône d'app dérivée de l'anneau

**Files:**
- Create: `designer/electron/build/icon.svg`
- Create: `designer/electron/build/make-icon.sh`
- Create (généré, committé): `designer/electron/build/icon.icns`

- [ ] **Step 1: Créer le SVG source**

Create `designer/electron/build/icon.svg` (reprend la marque du favicon `designer/index.html:8` : anneau `#FF9F40`, fond transparent, mis à l'échelle 1024) :

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="11" fill="none" stroke="#FF9F40" stroke-width="5"/>
</svg>
```

- [ ] **Step 2: Créer le script de génération**

Create `designer/electron/build/make-icon.sh` :

```bash
#!/usr/bin/env bash
# Génère icon.icns depuis icon.svg (anneau de la marque). One-shot : relancer si l'icône change.
# Outils : cairosvg (rasterise le SVG en PNG 1024), sips + iconutil (natifs macOS) pour le .icns.
# Sa sortie (icon.icns) est COMMITTÉE → le packaging ne dépend pas de cet outillage au build.
set -euo pipefail
cd "$(dirname "$0")"

SRC=icon.svg
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1) SVG -> PNG maître 1024x1024 (transparence préservée).
if command -v cairosvg >/dev/null 2>&1; then
  cairosvg "$SRC" -W 1024 -H 1024 -o "$WORK/icon_1024.png"
elif command -v magick >/dev/null 2>&1; then
  magick -background none "$SRC" -resize 1024x1024 "$WORK/icon_1024.png"
else
  echo "Aucun rasteriseur SVG (cairosvg ou magick) trouvé." >&2
  exit 1
fi

# 2) PNG maître -> .iconset aux tailles attendues par iconutil (16..512 + @2x).
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
for sz in 16 32 64 128 256 512; do
  sips -z "$sz" "$sz"           "$WORK/icon_1024.png" --out "$ICONSET/icon_${sz}x${sz}.png"     >/dev/null
  d=$((sz * 2))
  sips -z "$d"  "$d"            "$WORK/icon_1024.png" --out "$ICONSET/icon_${sz}x${sz}@2x.png"  >/dev/null
done

# 3) .iconset -> .icns
iconutil -c icns "$ICONSET" -o icon.icns
echo "Écrit : $(pwd)/icon.icns"
```

- [ ] **Step 3: Générer l'icône**

Run: `chmod +x designer/electron/build/make-icon.sh && bash designer/electron/build/make-icon.sh`
Expected: `Écrit : .../designer/electron/build/icon.icns`

- [ ] **Step 4: Vérifier que le .icns est valide**

Run: `file designer/electron/build/icon.icns && sips -g pixelWidth -g pixelHeight designer/electron/build/icon.icns`
Expected: `Mac OS X icon` (ou `icns`) ; dimensions max `1024 x 1024`. Si invalide, stop (loop brake) et signaler — ne pas committer un `.icns` cassé.

- [ ] **Step 5: Commit (source + script + icône générée)**

```bash
git add designer/electron/build/icon.svg designer/electron/build/make-icon.sh designer/electron/build/icon.icns
git commit -m "feat(designer): packaging — icône d'app (anneau) + générateur .icns"
```

---

## Task 3: Config electron-builder + devDep + gitignore

**Files:**
- Modify: `designer/electron/package.json`
- Modify: `designer/electron/package-lock.json` (via npm)
- Modify: `.gitignore`

- [ ] **Step 1: Installer electron-builder (devDep)**

Run: `cd designer/electron && npm install --save-dev electron-builder`
Expected: installation OK ; `package.json` gagne `electron-builder` dans `devDependencies` avec la version résolue (ne PAS coder en dur une version supposée — laisser npm résoudre la dernière compatible).
Vérifier la version posée : `node -p "require('./package.json').devDependencies['electron-builder']"`

- [ ] **Step 2: Ajouter le script `dist` et la clé `build`**

Éditer `designer/electron/package.json`. Ajouter dans `scripts` :

```json
    "dist": "electron-builder --mac"
```

Et ajouter au niveau racine du JSON la clé `build` (sœur de `scripts`/`dependencies`) :

```json
  "build": {
    "appId": "io.github.sandjab.dialboard.designer",
    "productName": "Dialboard Designer",
    "directories": { "output": "dist" },
    "files": ["!mock-device.mjs", "!mock-announce.mjs"],
    "extraResources": [
      { "from": "../../designer", "to": "app-root/designer", "filter": ["**/*", "!electron", "!electron/**", "!tests", "!tests/**"] },
      { "from": "../../schema", "to": "app-root/schema" }
    ],
    "mac": {
      "icon": "build/icon.icns",
      "category": "public.app-category.developer-tools",
      "target": ["dmg"],
      "identity": null
    }
  }
```

Points de vigilance (ne pas dévier) :
- `files` = **uniquement des négations** → elles s'ajoutent aux includes par défaut (qui embarquent `node_modules` de prod, dont `bonjour-service`). Une liste d'includes positifs remplacerait le glob par défaut et largerait `node_modules`.
- `identity: null` → build **non signé** explicite (electron-builder ne cherche aucun certificat).
- `extraResources.from` pointe **hors** du dossier app (`../../`) → c'est voulu ; vérifié au build en Task 4.
- `filter` **obligatoire** sur la copie de `designer/` : `designer/electron/` vit *dans* `designer/`,
  donc sans exclusion la copie embarquerait le wrapper — dont `electron/dist/` (la sortie en cours
  → **récursion infinie**, `ENAMETOOLONG`) et `electron/node_modules/`. On exclut aussi `tests/` :
  les `*.test.js` embarqués sous `designer/` casseraient `node --test` *sans argument* (la convention
  CLAUDE.md découvre depuis le cwd et tomberait sur les copies dans `dist/`, non lu par `.gitignore`).

- [ ] **Step 3: Valider que package.json reste un JSON valide**

Run: `cd designer/electron && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"`
Expected: `package.json OK`

- [ ] **Step 4: Ignorer la sortie de build**

Ajouter à `.gitignore` (à la racine du repo), sous la ligne existante `designer/electron/node_modules/` :

```
designer/electron/dist/
```

- [ ] **Step 5: Commit (config, sans la sortie de build)**

```bash
git add designer/electron/package.json designer/electron/package-lock.json .gitignore
git commit -m "feat(designer): packaging — config electron-builder (mac dmg non signé)"
```

> Ne PAS `git add designer/electron/dist/` (ignoré). Vérifier avec `git status` que `dist/` n'apparaît pas.

---

## Task 4: Build + vérification manuelle (le test réel)

**Files:** aucun fichier committé (sortie de build ignorée). Cette tâche est une **passerelle de vérification**.

- [ ] **Step 1: Construire l'app**

Run: `cd designer/electron && npm run dist`
Expected: build sans erreur de signature ; produit dans `dist/` un `.dmg` (nom du type `Dialboard Designer-0.0.0-arm64.dmg`) et un `.app` sous `dist/mac-arm64/` (ou `dist/mac/`).
Si `ENAMETOOLONG` / chemins récursifs `app-root/designer/electron/dist/.../app-root/...` : le `filter` excluant `electron/**` (Task 3) n'est pas pris en compte → vérifier le `package.json`. Nettoyer la sortie corrompue (`rm -rf designer/electron/dist`, à faire valider) **avant** de relancer (le scan re-bute sinon sur les chemins trop longs).

- [ ] **Step 2: Vérifier le staging dans le bundle**

Run: `ls "dist/mac-arm64/Dialboard Designer.app/Contents/Resources/app-root/designer/index.html" "dist/mac-arm64/Dialboard Designer.app/Contents/Resources/app-root/schema/layout.schema.json"`
(adapter `mac-arm64`→`mac` si nécessaire)
Expected: les deux chemins existent → `extraResources` a bien copié designer+schema sous `app-root/`.

- [ ] **Step 3: Lancer l'app empaquetée et vérifier le rendu**

Run: `open "dist/mac-arm64/Dialboard Designer.app"`
Expected: la fenêtre s'ouvre et **affiche le designer** (prouve que `app.isPackaged` → `ROOT = resources/app-root` → `app://` résout designer+schema depuis les resources). Si fenêtre vide : inspecter la console (logs 404 du handler `app://`).

- [ ] **Step 4: Vérifier le transport device en packagé (contre le mock)**

Terminal 1 : `cd designer/electron && PORT=8099 node mock-device.mjs`
Dans l'app empaquetée : saisir `base = http://127.0.0.1:8099`, puis **Charger / Statut / Pousser**.
Expected: les trois opérations aboutissent (prouve que l'injection CORS + le staging tiennent une fois empaqueté). Arrêter le mock ensuite (Ctrl-C).

- [ ] **Step 5: Non-régression designer (seul test automatique du périmètre)**

Run: `cd designer && node --test`
Expected: suite verte (on n'a pas touché `designer/`).

- [ ] **Step 6: Confirmer qu'aucun artefact de build n'est tracké**

Run: `git status --porcelain`
Expected: rien sous `designer/electron/dist/` (gitignoré). Aucun commit ici — la sortie de build n'est pas versionnée.

---

## Self-review (faite à l'écriture du plan)

- **Couverture spec** : tooling electron-builder (T3) ✓ ; staging `extraResources` (T3) + bascule `ROOT` (T1) ✓ ; `identity:null` non signé (T3) ✓ ; icône anneau générée+committée (T2) ✓ ; `.gitignore dist/` (T3) ✓ ; critères de succès build/lancement/transport/non-régression/honnêteté (T4 + encart en tête) ✓ ; hors-scope (signature, Win/Linux, auto-update) non implémenté ✓.
- **Placeholders** : aucun — chaque step a sa commande/son code complet.
- **Cohérence des noms** : `app-root` identique entre `extraResources.to` (T3) et `ROOT` (T1) ; `build/icon.icns` identique entre `make-icon.sh` (T2), `mac.icon` (T3) ; `productName`/arch cohérents entre T3 et les chemins `dist/` de T4.
