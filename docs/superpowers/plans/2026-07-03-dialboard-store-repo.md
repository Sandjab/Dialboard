# Dialboard Store — Plan 2 : repo store + CI + seed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire le **repo store** (public, `Sandjab/dialboard-store`) : structure `entries/*.dboard`, un générateur `build-index.mjs` (valide les soumissions + émet `index.json`), une CI (PR = check bloquant ; merge = régénère), 5 seed entries dérivées des templates intégrés, et le CONTRIBUTING/PR-template. Le designer (Plan 1) le consomme déjà — `DEFAULT_STORE_BASE` pointe déjà dessus.

**Architecture :** Repo séparé bâti en local à `~/Documents/Dev/dialboard-store`. Validation CI **sans dépendance npm** : Ajv vendorisé (le même que le designer → parité) + `schema/layout.schema.json` copié du repo principal. `build-index.mjs` exporte une fonction pure `validateEntry` (testée node) + un CLI gardé (walk fs + `--check`/write). `index.json` embarque, par entrée, les métadonnées + le `layout` (les assets vivent dans `o.assets`, séparés du layout → naturellement absents de l'index).

**Tech Stack :** Node ESM (`.mjs`), Ajv vendorisé (ESM), GitHub Actions, `node --test`.

**⚠ Frontière outward-facing (NON dans ce plan tant que l'utilisateur ne l'a pas dit) :** `gh repo create` + `git push` + activation CDN + vérif live jsDelivr. Tout le reste (scaffold, générateur, seed, `index.json` généré, CI YAML, git commits **locaux**) est fait et testé hors-ligne. La Task 4 est explicitement gardée.

**Frontière de validation (assumée) :** la CI store valide **forme (Ajv, schéma partagé)** + **résolution des `ref`** + **complétude `meta`** + **plafond de taille**. Les **limites de comptage firmware** (composants/pages/placements ≤ 32/8/12) restent gardées **côté designer** (CLAUDE.md : « les limites firmware sont gardées côté designer ») — non dupliquées ici.

---

## File Structure (repo store, à `~/Documents/Dev/dialboard-store`)

```
build-index.mjs                     # générateur + validateur (exports purs + CLI gardé)
vendor/ajv.min.mjs                  # Ajv vendorisé (copié de designer/vendor/ajv.min.js → .mjs pour ESM node)
schema/layout.schema.json           # copié du repo principal (source de vérité partagée)
entries/dialboard/clock.dboard      # seed (v2, layout-only)
entries/dialboard/weather.dboard
entries/dialboard/crypto.dboard
entries/dialboard/server.dboard
entries/dialboard/home-assistant.dboard
index.json                          # GÉNÉRÉ par build-index.mjs
test/build-index.test.mjs           # tests node de validateEntry
.github/workflows/build-index.yml   # PR: --check ; push main: régénère + commit
.github/PULL_REQUEST_TEMPLATE.md
CONTRIBUTING.md · README.md · .gitignore
```

---

## Task 1 : scaffold + vendoring

**Files (créés dans `~/Documents/Dev/dialboard-store`) :** arborescence + `README.md`, `CONTRIBUTING.md`, `.gitignore`, `.github/PULL_REQUEST_TEMPLATE.md`, `vendor/ajv.min.mjs`, `schema/layout.schema.json`.

- [ ] **Step 1 : Créer le repo local + arborescence**

```bash
mkdir -p ~/Documents/Dev/dialboard-store/{vendor,schema,entries/dialboard,test,.github/workflows}
cd ~/Documents/Dev/dialboard-store && git init -q && echo "repo local initialisé"
```

- [ ] **Step 2 : Vendorer Ajv (en `.mjs` pour l'ESM node) + copier le schéma**

```bash
cp ~/Documents/Dev/Dialboard/designer/vendor/ajv.min.js ~/Documents/Dev/dialboard-store/vendor/ajv.min.mjs
cp ~/Documents/Dev/Dialboard/schema/layout.schema.json ~/Documents/Dev/dialboard-store/schema/layout.schema.json
```

- [ ] **Step 3 : Vérifier qu'Ajv s'importe et compile le schéma en node**

Run:
```bash
cd ~/Documents/Dev/dialboard-store && node -e "import('./vendor/ajv.min.mjs').then(m=>{const A=m.default;const a=new A({allErrors:true,strict:false});const v=a.compile(JSON.parse(require('fs').readFileSync('schema/layout.schema.json','utf8')));console.log('ajv OK, compile OK, valide layout minimal:', v({title:'x',components:{},pages:[]}));})"
```
Expected: `ajv OK, compile OK, valide layout minimal: true`.
**Si l'import échoue** (globals navigateur) : fallback documenté → `package.json` avec `"type":"module"` + dépendance `ajv` npm et `import Ajv from 'ajv'`, CI avec `npm ci`. (Ne PAS appliquer sauf échec ici.)

- [ ] **Step 4 : `.gitignore`**

Créer `~/Documents/Dev/dialboard-store/.gitignore` :
```
node_modules/
.DS_Store
```

- [ ] **Step 5 : `README.md`**

Créer `README.md` :
```markdown
# Dialboard Store

Catalogue communautaire **gratuit** de dashboards pour [Dialboard](https://github.com/Sandjab/Dialboard) — l'écran tactile rond à ~15 €.

Chaque dashboard est un fichier `.dboard` (JSON déclaratif : layout + éventuels assets). **Navigable et installable directement depuis le designer** (tiroir « Store »), ou téléchargeable ici.

## Installer un dashboard
Ouvre le designer Dialboard → tiroir **Store** → filtre par domaine, cherche, **Installe**. (Ou télécharge le `.dboard` et importe-le.)

## Contribuer
Voir [CONTRIBUTING.md](CONTRIBUTING.md). En bref : exporte ton dashboard en `.dboard` (avec le bloc `meta`) depuis le designer, ajoute-le sous `entries/<ton-pseudo>/`, ouvre une Pull Request. La CI valide ; un mainteneur relit. `index.json` est **généré** — ne l'édite pas à la main.

## Sûreté
Un `.dboard` est du **JSON déclaratif, sans exécution de code**. La CI rejette tout layout non conforme au schéma, aux métadonnées incomplètes ou surdimensionné.
```

- [ ] **Step 6 : `CONTRIBUTING.md`**

Créer `CONTRIBUTING.md` :
```markdown
# Contribuer au Dialboard Store

1. **Crée ton dashboard** dans le designer Dialboard.
2. **Exporte-le en `.dboard`** via « Publier » (renseigne nom / description / domaine / tags) — le bloc `meta` est rempli pour toi. (À défaut, ajoute-le à la main, voir plus bas.)
3. **Ajoute le fichier** sous `entries/<ton-pseudo-github>/<slug>.dboard`.
4. **Ouvre une Pull Request.** La CI (`build-index --check`) valide ; corrige les erreurs signalées. Un mainteneur relit et merge. `index.json` se régénère automatiquement au merge.

## Format `.dboard` (v2)
```json
{
  "version": 2,
  "meta": {
    "name": "Nom affiché",
    "author": "ton-pseudo-github",
    "description": "Une phrase.",
    "domain": "time|weather|finance|system|home|transit|health|fun|other",
    "tags": ["mot", "clé"],
    "requires": "Ce qu'il faut brancher (source, POST /secrets…). Vide si zéro-config."
  },
  "layout": { /* … ton layout … */ },
  "assets": { "bg": {}, "image": {}, "aimg": {} }
}
```

## Règles (vérifiées par la CI)
- `layout` conforme au schéma partagé (`schema/layout.schema.json`).
- Toute `place.ref` résout vers un composant existant.
- `meta.name/author/description/domain` non vides ; `domain` dans l'enum.
- Taille du `.dboard` ≤ 512 Ko.
- Pas de secret/PII (jetons, mots de passe) — utilise des variables (`$ha_token`) alimentées côté device via `POST /secrets`.
```

- [ ] **Step 7 : `.github/PULL_REQUEST_TEMPLATE.md`**

Créer `.github/PULL_REQUEST_TEMPLATE.md` :
```markdown
## Nouveau(x) dashboard(s)

- **Nom / domaine :**
- **Ce qu'il fait :**
- **À brancher (le cas échéant) :**

### Checklist
- [ ] Fichier sous `entries/<mon-pseudo>/<slug>.dboard`, format v2 avec bloc `meta` complet.
- [ ] Aucun secret / PII dans le fichier (variables `$…` uniquement).
- [ ] `node build-index.mjs --check` passe en local.
- [ ] Je n'ai PAS édité `index.json` (généré automatiquement).
```

- [ ] **Step 8 : Commit local**

```bash
cd ~/Documents/Dev/dialboard-store
git add -A && git commit -q -m "chore: scaffold repo store (README, CONTRIBUTING, PR template, ajv vendorisé, schéma)"
```

---

## Task 2 : `build-index.mjs` (validateur + générateur) + tests

**Files:** Create `build-index.mjs`, `test/build-index.test.mjs`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `test/build-index.test.mjs` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntry } from '../build-index.mjs';

const goodLayout = { title: 'Clock', background: '#000000', components: { a: { type: 'label', text: 'Hi', font: 18, color: '#ffffff' } }, pages: [{ name: 'p', place: [{ ref: 'a', anchor: 'CENTER' }] }] };   // hex 6 chiffres (le schéma impose ^#[0-9A-Fa-f]{6}$)
const goodMeta = { name: 'Horloge', author: 'me', description: 'demo', domain: 'time', tags: ['clock'], requires: '' };
const dboard = (over = {}) => ({ version: 2, meta: goodMeta, layout: goodLayout, assets: { bg: {}, image: {}, aimg: {} }, ...over });

test('validateEntry : une entrée valide produit une ligne d\'index (intent : le happy path alimente le catalogue)', () => {
  const r = validateEntry('me/clock.dboard', 400, dboard());
  assert.ok(r.entry, 'devrait renvoyer entry, erreurs: ' + JSON.stringify(r.errors));
  assert.equal(r.entry.id, 'me/clock');
  assert.equal(r.entry.file, 'entries/me/clock.dboard');
  assert.equal(r.entry.domain, 'time');
  assert.equal(r.entry.bytes, 400);
  assert.deepEqual(r.entry.layout, goodLayout);      // layout embarqué pour la miniature
});

test('validateEntry : rejette une propriété inconnue (intent : la forme est gardée par le schéma partagé)', () => {
  const bad = dboard({ layout: { ...goodLayout, components: { a: { type: 'label', text: 'Hi', font: 18, color: '#fff', bogus: 1 } } } });
  const r = validateEntry('me/x.dboard', 400, bad);
  assert.ok(r.errors && r.errors.length, 'devrait rejeter la prop inconnue');
});

test('validateEntry : rejette une ref pendante (intent : invariant sémantique non exprimé par le schéma)', () => {
  const bad = dboard({ layout: { ...goodLayout, pages: [{ name: 'p', place: [{ ref: 'ghost', anchor: 'CENTER' }] }] } });
  const r = validateEntry('me/x.dboard', 400, bad);
  assert.ok(r.errors.some(e => /ref/.test(e)), 'devrait signaler la ref inconnue : ' + JSON.stringify(r.errors));
});

test('validateEntry : rejette meta incomplète (intent : la galerie a besoin de nom/domaine)', () => {
  const bad = dboard({ meta: { name: '', author: 'me', description: 'd', domain: 'time' } });
  const r = validateEntry('me/x.dboard', 400, bad);
  assert.ok(r.errors.some(e => /meta\.name/.test(e)));
});

test('validateEntry : rejette un domaine hors enum (intent : taxonomie fermée)', () => {
  const bad = dboard({ meta: { ...goodMeta, domain: 'zzz' } });
  const r = validateEntry('me/x.dboard', 400, bad);
  assert.ok(r.errors.some(e => /domain/.test(e)));
});

test('validateEntry : rejette au-delà du plafond de taille (intent : garder le repo/CDN léger)', () => {
  const r = validateEntry('me/x.dboard', 600 * 1024, dboard());
  assert.ok(r.errors.some(e => /taille|octets/.test(e)));
});

test('validateEntry : accepte v1 comme v2 (intent : rétro-compat des exports legacy)', () => {
  const r = validateEntry('me/x.dboard', 400, dboard({ version: 1 }));
  assert.ok(r.entry, 'v1 doit rester accepté : ' + JSON.stringify(r.errors));
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd ~/Documents/Dev/dialboard-store && node --test`
Expected: FAIL (`Cannot find module '../build-index.mjs'`).

- [ ] **Step 3 : Écrire `build-index.mjs`**

Créer `~/Documents/Dev/dialboard-store/build-index.mjs` :

```js
// Valide les entries/*.dboard et génère index.json. Sans dépendance npm : Ajv vendorisé (parité designer)
// + schéma partagé. `validateEntry` est PUR (testé node) ; le CLI (walk fs + --check/write) est gardé.
//
//   node build-index.mjs           → écrit index.json (mode build, pour main)
//   node build-index.mjs --check    → valide seulement, exit 1 si une entrée invalide (mode PR)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from './vendor/ajv.min.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const DOMAINS = ['time', 'weather', 'finance', 'system', 'home', 'transit', 'health', 'fun', 'other'];
export const MAX_BYTES = 512 * 1024;   // plafond d'un .dboard (base64 des assets inclus)

const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'layout.schema.json'), 'utf8'));
const validateShape = new Ajv({ allErrors: true, strict: false }).compile(schema);

// (rel, bytes, obj) → { entry } | { errors:[...], rel }. Pur : aucune I/O.
export function validateEntry(rel, bytes, o) {
  const errors = [];
  if (bytes > MAX_BYTES) errors.push(`taille ${bytes} > ${MAX_BYTES} octets`);
  if (!o || typeof o !== 'object') return { errors: ['fichier non-objet'], rel };
  if (o.version !== 1 && o.version !== 2) errors.push(`version ${o.version} non supportée (attendu 1|2)`);

  const m = (o.meta && typeof o.meta === 'object') ? o.meta : {};
  for (const k of ['name', 'author', 'description', 'domain'])
    if (typeof m[k] !== 'string' || !m[k]) errors.push(`meta.${k} manquant ou vide`);
  if (m.domain && !DOMAINS.includes(m.domain)) errors.push(`meta.domain « ${m.domain} » hors enum`);

  const layout = o.layout;
  if (!layout || typeof layout !== 'object') { errors.push('layout manquant'); return { errors, rel }; }

  // Forme (Ajv, schéma partagé) — parité designer/firmware
  if (!validateShape(layout)) {
    for (const e of validateShape.errors) {
      if (e.keyword === 'const' && e.instancePath.endsWith('/type')) continue;   // bruit oneOf (cf. designer validate.js)
      errors.push(`layout${e.instancePath} ${e.message}`);
    }
  }
  // Résolution des ref (invariant sémantique non exprimé par le schéma)
  const ids = new Set(Object.keys(layout.components || {}));
  (Array.isArray(layout.pages) ? layout.pages : []).forEach((pg, pi) =>
    (Array.isArray(pg && pg.place) ? pg.place : []).forEach(pl => {
      if (pl && pl.ref !== undefined && !ids.has(pl.ref)) errors.push(`page ${pi + 1} : ref « ${pl.ref} » inconnue`);
    }));

  if (errors.length) return { errors, rel };
  return { entry: {
    id: rel.replace(/\.dboard$/, ''),
    file: `entries/${rel}`,
    name: m.name, author: m.author, description: m.description, domain: m.domain,
    tags: Array.isArray(m.tags) ? m.tags.filter(t => typeof t === 'string') : [],
    requires: typeof m.requires === 'string' ? m.requires : '',
    bytes,
    layout,   // les assets vivent dans o.assets (séparés) → le layout est naturellement sans octets
  } };
}

// --- CLI (non exécuté à l'import) ---
function listEntries(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listEntries(p));
    else if (name.endsWith('.dboard')) out.push(p);
  }
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  const entriesDir = join(ROOT, 'entries');
  const files = listEntries(entriesDir).sort();
  const entries = [];
  let bad = 0;
  for (const f of files) {
    const rel = relative(entriesDir, f).split(sep).join('/');
    const bytes = statSync(f).size;
    let obj;
    try { obj = JSON.parse(readFileSync(f, 'utf8')); }
    catch (e) { bad++; console.error(`✗ ${rel}\n  - JSON invalide : ${e.message}`); continue; }
    const r = validateEntry(rel, bytes, obj);
    if (r.errors && r.errors.length) { bad++; console.error(`✗ ${rel}\n  - ${r.errors.join('\n  - ')}`); }
    else { entries.push(r.entry); console.log(`✓ ${r.entry.id}`); }
  }
  if (bad) { console.error(`\n${bad} entrée(s) invalide(s).`); process.exit(1); }
  if (check) { console.log(`\n${entries.length} entrée(s) valide(s) — --check, index.json non modifié.`); return; }
  writeFileSync(join(ROOT, 'index.json'), JSON.stringify(entries, null, 2) + '\n');
  console.log(`\nindex.json écrit — ${entries.length} entrée(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4 : Lancer pour vérifier le vert**

Run: `cd ~/Documents/Dev/dialboard-store && node --test`
Expected: PASS (7 tests).

- [ ] **Step 5 : Commit local**

```bash
cd ~/Documents/Dev/dialboard-store
git add build-index.mjs test/build-index.test.mjs && git commit -q -m "feat: build-index.mjs — valide (Ajv+refs+meta+taille) et génère index.json (testé node)"
```

---

## Task 3 : seed des 5 entrées + génération de `index.json`

**Files:** Create `entries/dialboard/{clock,weather,crypto,server,home-assistant}.dboard` ; generate `index.json`.

> Chaque seed = bundle v2 `{version:2, meta, layout, assets:{bg:{},image:{},aimg:{}}}`, `layout` = le template intégré correspondant (copié depuis `designer/templates/<slug>.json`). Métadonnées ci-dessous (dérivées des `templates.*` i18n FR).

- [ ] **Step 1 : `entries/dialboard/clock.dboard`**

`meta` : `{ "name": "Horloge de bureau", "author": "dialboard", "description": "Horloge digitale minimaliste, marche tout de suite, zéro réglage.", "domain": "time", "tags": ["clock","time"], "requires": "" }` ; `layout` = contenu de `designer/templates/clock.json`.

- [ ] **Step 2 : `entries/dialboard/weather.dboard`**

`meta` : `{ "name": "Météo", "author": "dialboard", "description": "Température, vent et humidité en direct via open-meteo (sans clé API).", "domain": "weather", "tags": ["weather","meteo"], "requires": "Renseigne ta latitude/longitude dans l'URL de la source (panneau Sources)." }` ; `layout` = `designer/templates/weather.json`.

- [ ] **Step 3 : `entries/dialboard/crypto.dboard`**

`meta` : `{ "name": "Ticker crypto", "author": "dialboard", "description": "Prix et variation 24 h en direct via CoinGecko (sans clé API).", "domain": "finance", "tags": ["crypto","finance"], "requires": "Change la crypto (ids=) dans l'URL de la source. Le tier gratuit CoinGecko est rate-limité." }` ; `layout` = `designer/templates/crypto.json`.

- [ ] **Step 4 : `entries/dialboard/server.dboard`**

`meta` : `{ "name": "Moniteur serveur", "author": "dialboard", "description": "Jauges CPU / RAM / uptime, à pointer sur ton endpoint JSON.", "domain": "system", "tags": ["server","system"], "requires": "Édite l'URL de la source vers ton endpoint JSON renvoyant {cpu, ram, uptime}." }` ; `layout` = `designer/templates/server.json`.

- [ ] **Step 5 : `entries/dialboard/home-assistant.dboard`**

`meta` : `{ "name": "Home Assistant", "author": "dialboard", "description": "Lecture d'un capteur depuis ton instance Home Assistant.", "domain": "home", "tags": ["home","homeassistant"], "requires": "Renseigne ton URL/entité HA dans la source, puis POST /secrets ha_token=<jeton longue durée>." }` ; `layout` = `designer/templates/home-assistant.json`.

- [ ] **Step 6 : Générer `index.json` et vérifier les 5 valides**

Run: `cd ~/Documents/Dev/dialboard-store && node build-index.mjs`
Expected : `✓ dialboard/clock` … `✓ dialboard/home-assistant` puis `index.json écrit — 5 entrée(s).` (aucune ligne `✗`).

- [ ] **Step 7 : `--check` passe aussi (mode PR)**

Run: `node build-index.mjs --check`
Expected: `5 entrée(s) valide(s) — --check, index.json non modifié.` exit 0.

- [ ] **Step 8 : Preuve que `--check` REJETTE une mauvaise entrée (le garde-fou discrimine)**

Run:
```bash
cd ~/Documents/Dev/dialboard-store
printf '{"version":2,"meta":{"name":"x","author":"x","description":"x","domain":"zzz"},"layout":{"title":"x","components":{},"pages":[{"name":"p","place":[{"ref":"ghost"}]}]},"assets":{"bg":{},"image":{},"aimg":{}}}' > entries/dialboard/_bad.dboard
node build-index.mjs --check; echo "exit=$?"
rm entries/dialboard/_bad.dboard
```
Expected : lignes `✗ dialboard/_bad.dboard` (domaine hors enum + ref inconnue) et `exit=1`.

- [ ] **Step 9 : Scan secrets/PII des seeds**

Run: `grep -rIn "sk-\|ghp_\|password\|BEGIN .*PRIVATE" entries/ || echo "clean"`
Expected : `clean` (les seeds n'utilisent que des variables `$ha_token` et des URLs publiques).

- [ ] **Step 10 : Commit local**

```bash
cd ~/Documents/Dev/dialboard-store
git add entries/ index.json && git commit -q -m "feat: 5 seed entries (clock/weather/crypto/server/home-assistant) + index.json généré"
```

---

## Task 4 : publication + vérif live — ⚠ GARDÉE (feu vert utilisateur requis)

> **NE PAS exécuter sans accord explicite de l'utilisateur** (création d'un repo public + push = outward-facing, gaté par CLAUDE.md). Étapes fournies pour quand il dira « publie ».

- [ ] **Step 1 : `.github/workflows/build-index.yml`** (déjà créable en Task 1, mais listé ici car lié à la publication)

Créer :
```yaml
name: build-index
on:
  pull_request:
    paths: ['entries/**', 'schema/**', 'build-index.mjs', 'vendor/**']
  push:
    branches: [main]
    paths: ['entries/**', 'schema/**', 'build-index.mjs', 'vendor/**']
jobs:
  check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node build-index.mjs --check
  build:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node build-index.mjs
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add index.json
          git diff --staged --quiet || (git commit -m "chore: régénère index.json [skip ci]" && git push)
```
Commit local : `git add .github/workflows/build-index.yml && git commit -m "ci: build-index (PR check + régénération au merge)"`.

- [ ] **Step 2 : Créer le repo public + push** (après « publie »)

```bash
cd ~/Documents/Dev/dialboard-store
git branch -M main
gh repo create Sandjab/dialboard-store --public --source=. --remote=origin --push
```

- [ ] **Step 3 : Vérif live du CDN**

Attendre la propagation jsDelivr, puis :
Run: `curl -sS https://cdn.jsdelivr.net/gh/Sandjab/dialboard-store@main/index.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('entrées live:', JSON.parse(s).length))"`
Expected: `entrées live: 5`.

- [ ] **Step 4 : Vérif live du designer (sans override)**

Servir le designer (racine repo, no-store), ouvrir `/designer/index.html` **sans** `?store=`. Attendu : les **5 entrées Store** s'affichent (mêmes miniatures que les templates intégrés), install/download OK. Confirme que `DEFAULT_STORE_BASE` (déjà = `https://cdn.jsdelivr.net/gh/Sandjab/dialboard-store@main`) est correct — aucune bascule nécessaire.

---

## Self-Review (rempli à la rédaction)

- **Couverture spec §4** : repo séparé (T1) ; CI PR `--check` + build au merge (T4S1) ; `index.json` généré avec métadonnées + layout embarqué (T2/T3) ; distribution jsDelivr + vérif live (T4S3-4) ; enum domaines (build-index `DOMAINS`) ; validation forme via schéma partagé (parité) + refs + meta + taille (T2). Seed = 5 curated (T3). « Publier »/dialogue = hors périmètre (Plan 3 éventuel).
- **Placeholders** : aucun `TODO`. La Task 4 est *gardée*, pas vide : ses commandes sont complètes, juste conditionnées à l'accord utilisateur. Le fallback Ajv-npm (T1S3) est conditionnel à un échec constaté, pas un trou.
- **Cohérence des types** : `validateEntry(rel, bytes, obj)` → `{entry:{id,file,name,author,description,domain,tags,requires,bytes,layout}} | {errors,rel}` ; le CLI et les tests consomment exactement cette forme ; `entry` = le schéma d'`index.json` que `store-index.js::parseIndex` (Plan 1) lit déjà (champs identiques). `DOMAINS` identique à celui du designer (`store-index.js`) et du spec §8.
- **Dépendances** : Ajv importé comme ESM `.mjs` (export vérifié `export{export_default as default}`) — testé en T1S3 avec fallback npm documenté. `schema/layout.schema.json` = copie de la source partagée.
