# Templates 1-clic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une gallery de dashboards prêts à l'emploi, chargeables en un clic dans le designer, pour transformer le canvas vide en valeur immédiate.

**Architecture:** 100 % designer. Les templates sont des fichiers `designer/templates/*.json` (layouts schema-valides) listés par un manifeste `index.json` (miroir de `i18n/index.json`). Un tiroir « Modèles » (pattern `createDrawer`, comme Device/Sinks/Settings — **pas de modale**) affiche une carte par template avec une **miniature live** (réutilise `COMPONENTS[type].build` + `geometry.js`). Cliquer une carte charge le layout via `model.loadJSON` puis le même `onLoad` que l'import fichier (ensurePhysicals/pruneOrphans/setPage/tree). Sur un canvas déjà travaillé, un **arm-confirm** (ethos designer) protège avant remplacement.

**Tech Stack:** JS modules ES (designer), `node --test` (tests données), ajv (`js/validate.js`), i18n plat (`i18n/en.js` + `i18n/fr.json`).

**Contexte vérifié (session brainstorm 2026-07-03) :**
- `model.loadJSON(text)` = `JSON.parse` + snapshot undo + emit — **ne valide pas** (d'où le test node) ; charger est **annulable**.
- `onLoad` (app.js:200) = `model.commit(s => { stripPhysicalPlacements(s); ensurePhysicals(s); pruneOrphans(s); }); canvas.setPage(0); tree.render();` — **à réutiliser tel quel** (ajoute led_ring/sound absents).
- `createDrawer(root, {toggleBtn, onOpen})` (drawer.js) ferme sur Échap/backdrop/✕ ; les 4 tiroirs se ferment mutuellement via `onOpen`.
- Schéma strict (`additionalProperties:false`). Champs confirmés : clock `{mode:analog|digital, show_seconds, color, font, font_family, bold, italic}` (centered=false) ; ring `{color,countdown,min,max,thresholds,center_pct,center_color,cap_*,mode,rounded,bind}` (placement `{radius,thickness,gap_deg}`, centré) ; readout `{label,unit,font,font_family,bold,italic,color,bind}` ; bar `{label,min,max,color,thresholds,mode,orientation,...,bind}` (placement width/height) ; meter `{color,min,max,thresholds,bind}` ; icon `{symbol,color,font,states,bind}` ; source `{url,name,interval_s≥5,headers,vars}`. `fontFamily ∈ {montserrat,jetbrains_mono,lora,inter}`. `id ∈ [A-Za-z0-9_]+`. `display` (texte affiché) = Latin-1 (`°`,`é` OK ; pas d'emoji).
- Contenu des layouts en **anglais** (langue par défaut du designer = EN intégré) — labels courts et universels (adoption). Localisable plus tard.

---

## Task 1 : clés i18n

**Files:**
- Modify: `designer/i18n/en.js` (catalogue intégré, source de vérité)
- Modify: `designer/i18n/fr.json` (pack FR)

Pas de test node (chrome i18n = browser-verified, cf. convention projet). Les clés sont consommées par les tâches 4-6.

- [ ] **Step 1 : ajouter les clés EN dans `designer/i18n/en.js`**

Insérer ces paires dans l'objet `export default { … }` (près des clés `toolbar.*` / `drawer.*` existantes ; l'ordre n'importe pas, garder le style « clé plate ») :

```js
  'toolbar.templates.tip': 'Templates',
  'toolbar.templates.title': 'Start from a ready-made dashboard',
  'drawer.templates.title': 'Templates',
  'drawer.templates.aria': 'Templates gallery',
  'templates.badge.ready': 'Ready to use',
  'templates.badge.wire': 'Needs wiring',
  'templates.replace': 'Replace dashboard?',
  'toast.template_loaded': 'Template loaded — Ctrl+Z to undo',
  'activity.template_loaded': 'Template loaded: {id}',
  'templates.clock.name': 'Desk clock',
  'templates.clock.description': 'A digital clock with date-free minimalist face. Works instantly, no setup.',
  'templates.clock.setup': '',
  'templates.weather.name': 'Weather',
  'templates.weather.description': 'Live temperature, wind and humidity from open-meteo (no API key).',
  'templates.weather.setup': 'Set your latitude/longitude in the source URL (Sources panel).',
  'templates.crypto.name': 'Crypto ticker',
  'templates.crypto.description': 'Live price and 24h change from CoinGecko (no API key).',
  'templates.crypto.setup': 'Change the coin (ids=) in the source URL. Free CoinGecko tier is rate-limited.',
  'templates.server.name': 'Server monitor',
  'templates.server.description': 'CPU / RAM / uptime gauges. Point it at your own JSON metrics endpoint.',
  'templates.server.setup': 'Edit the source URL to your JSON endpoint returning {cpu, ram, uptime}.',
  'templates.home-assistant.name': 'Home Assistant',
  'templates.home-assistant.description': 'A sensor readout from your Home Assistant instance.',
  'templates.home-assistant.setup': 'Set your HA URL/entity in the source, then POST /secrets ha_token=<long-lived token>.',
```

- [ ] **Step 2 : ajouter les mêmes clés (traduites) dans `designer/i18n/fr.json`**

```json
  "toolbar.templates.tip": "Modèles",
  "toolbar.templates.title": "Partir d'un dashboard prêt à l'emploi",
  "drawer.templates.title": "Modèles",
  "drawer.templates.aria": "Galerie de modèles",
  "templates.badge.ready": "Prêt à l'emploi",
  "templates.badge.wire": "À brancher",
  "templates.replace": "Remplacer le dashboard ?",
  "toast.template_loaded": "Modèle chargé — Ctrl+Z pour annuler",
  "activity.template_loaded": "Modèle chargé : {id}",
  "templates.clock.name": "Horloge de bureau",
  "templates.clock.description": "Une horloge digitale au cadran minimaliste. Marche tout de suite, zéro réglage.",
  "templates.clock.setup": "",
  "templates.weather.name": "Météo",
  "templates.weather.description": "Température, vent et humidité en direct via open-meteo (sans clé API).",
  "templates.weather.setup": "Renseigne ta latitude/longitude dans l'URL de la source (panneau Sources).",
  "templates.crypto.name": "Ticker crypto",
  "templates.crypto.description": "Prix et variation 24 h en direct via CoinGecko (sans clé API).",
  "templates.crypto.setup": "Change la crypto (ids=) dans l'URL de la source. Le tier gratuit CoinGecko est rate-limité.",
  "templates.server.name": "Moniteur serveur",
  "templates.server.description": "Jauges CPU / RAM / uptime. À pointer sur ton propre endpoint JSON.",
  "templates.server.setup": "Édite l'URL de la source vers ton endpoint JSON renvoyant {cpu, ram, uptime}.",
  "templates.home-assistant.name": "Home Assistant",
  "templates.home-assistant.description": "Lecture d'un capteur depuis ton instance Home Assistant.",
  "templates.home-assistant.setup": "Renseigne ton URL/entité HA dans la source, puis POST /secrets ha_token=<jeton longue durée>."
```

> ⚠️ JSON : ne pas laisser de virgule pendante ; insérer avant la `}` finale avec une virgule sur la ligne précédente.

- [ ] **Step 3 : vérifier la parité des clés (test i18n existant)**

Run: `cd designer && node --test tests/i18n-parity.test.js`
Expected: PASS (le test `i18n-parity` compare les clés EN ↔ FR ; il échoue si une clé manque d'un côté).

- [ ] **Step 4 : commit**

```bash
git add designer/i18n/en.js designer/i18n/fr.json
git commit -m "feat(templates): clés i18n (gallery + 5 modèles)"
```

---

## Task 2 : données des templates + test de validation (TDD)

**Files:**
- Test: `designer/tests/templates.test.js`
- Create: `designer/templates/index.json`
- Create: `designer/templates/clock.json`
- Create: `designer/templates/weather.json`
- Create: `designer/templates/crypto.json`
- Create: `designer/templates/server.json`
- Create: `designer/templates/home-assistant.json`

- [ ] **Step 1 : écrire le test qui échoue**

Créer `designer/tests/templates.test.js` :

```js
// Chaque template livré DOIT valider (schéma + limites firmware) : un template cassé = mauvaise
// première impression et rejet possible au push device → bloqué en CI, jamais découvert par l'user.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createValidator } from '../js/validate.js';

const schema = JSON.parse(readFileSync(new URL('../../schema/layout.schema.json', import.meta.url)));
const validate = createValidator(schema);
const readTpl = (p) => JSON.parse(readFileSync(new URL(`../templates/${p}`, import.meta.url)));
const manifest = readTpl('index.json');

test('manifeste : liste non vide d\'entrées {id, file}', () => {
  assert.ok(Array.isArray(manifest) && manifest.length >= 1);
  for (const e of manifest) {
    assert.match(e.id, /^[a-z0-9-]+$/);
    assert.ok(typeof e.file === 'string' && e.file.endsWith('.json'));
  }
});

for (const entry of manifest) {
  test(`template « ${entry.id} » : layout valide (schéma + limites firmware)`, () => {
    const r = validate(readTpl(entry.file));
    assert.deepEqual(r.errors, [], `erreurs: ${r.errors.join(' | ')}`);
    assert.equal(r.valid, true);
  });
}
```

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue**

Run: `cd designer && node --test tests/templates.test.js`
Expected: FAIL (`ENOENT` sur `templates/index.json` — les fichiers n'existent pas encore).

- [ ] **Step 3 : créer le manifeste `designer/templates/index.json`**

```json
[
  { "id": "clock",          "file": "clock.json" },
  { "id": "weather",        "file": "weather.json" },
  { "id": "crypto",         "file": "crypto.json" },
  { "id": "server",         "file": "server.json" },
  { "id": "home-assistant", "file": "home-assistant.json" }
]
```

- [ ] **Step 4 : créer `designer/templates/clock.json`** (zéro config)

```json
{
  "title": "Clock",
  "background": "#0B0B0F",
  "tz": "CET-1CEST,M3.5.0,M10.5.0",
  "components": {
    "deco":  { "type": "ring", "color": "#FF9F40", "min": 0, "max": 60, "rounded": true },
    "time":  { "type": "clock", "mode": "digital", "show_seconds": true, "color": "#F5F5F7", "font": 54, "font_family": "jetbrains_mono" },
    "hello": { "type": "label", "text": "Hello", "font": 18, "color": "#9AA0AA" }
  },
  "pages": [
    { "name": "Clock", "place": [
      { "ref": "deco",  "radius": 170, "thickness": 8, "gap_deg": 0 },
      { "ref": "time",  "anchor": "CENTER", "dy": -6 },
      { "ref": "hello", "anchor": "CENTER", "dy": 48 }
    ] }
  ]
}
```

- [ ] **Step 5 : créer `designer/templates/weather.json`** (câblé open-meteo)

```json
{
  "title": "Weather",
  "background": "#0B1220",
  "components": {
    "arc":  { "type": "ring", "color": "#38BDF8", "min": -10, "max": 40, "bind": "temp",
              "thresholds": [[0, "#60A5FA"], [25, "#34D399"], [40, "#F59E0B"]] },
    "tval": { "type": "readout", "label": "", "unit": "°C", "font": 40, "color": "#F5F5F7", "bind": "temp" },
    "wind": { "type": "readout", "label": "Wind", "unit": " km/h", "font": 16, "color": "#9AA0AA", "bind": "wind" },
    "hum":  { "type": "readout", "label": "Hum", "unit": " %", "font": 16, "color": "#9AA0AA", "bind": "hum" }
  },
  "pages": [
    { "name": "Weather", "place": [
      { "ref": "arc",  "radius": 150, "thickness": 18, "gap_deg": 90 },
      { "ref": "tval", "anchor": "CENTER", "dy": -6 },
      { "ref": "wind", "anchor": "BOTTOM_MID", "dy": -70 },
      { "ref": "hum",  "anchor": "BOTTOM_MID", "dy": -44 }
    ] }
  ],
  "sources": [
    { "name": "Open-Meteo",
      "url": "https://api.open-meteo.com/v1/forecast?latitude=48.85&longitude=2.35&current=temperature_2m,wind_speed_10m,relative_humidity_2m",
      "interval_s": 900,
      "vars": { "temp": "/current/temperature_2m", "wind": "/current/wind_speed_10m", "hum": "/current/relative_humidity_2m" } }
  ]
}
```

- [ ] **Step 6 : créer `designer/templates/crypto.json`** (câblé CoinGecko)

```json
{
  "title": "Crypto",
  "background": "#0B0B0F",
  "components": {
    "chg":   { "type": "ring", "color": "#34D399", "min": -10, "max": 10, "bind": "chg",
               "thresholds": [[0, "#EF4444"], [10, "#34D399"]] },
    "price": { "type": "readout", "label": "BTC", "unit": " $", "font": 34, "color": "#F5F5F7", "bind": "price" },
    "chgv":  { "type": "readout", "label": "24h", "unit": " %", "font": 16, "color": "#9AA0AA", "bind": "chg" }
  },
  "pages": [
    { "name": "Crypto", "place": [
      { "ref": "chg",   "radius": 150, "thickness": 16, "gap_deg": 90 },
      { "ref": "price", "anchor": "CENTER", "dy": -6 },
      { "ref": "chgv",  "anchor": "BOTTOM_MID", "dy": -60 }
    ] }
  ],
  "sources": [
    { "name": "CoinGecko",
      "url": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
      "interval_s": 120,
      "vars": { "price": "/bitcoin/usd", "chg": "/bitcoin/usd_24h_change" } }
  ]
}
```

- [ ] **Step 7 : créer `designer/templates/server.json`** (skeleton)

```json
{
  "title": "Server",
  "background": "#0B0F0B",
  "components": {
    "cpu":  { "type": "meter", "color": "#38BDF8", "min": 0, "max": 100, "bind": "cpu",
              "thresholds": [[70, "#F59E0B"], [90, "#EF4444"]] },
    "cpul": { "type": "readout", "label": "CPU", "unit": " %", "font": 18, "color": "#F5F5F7", "bind": "cpu" },
    "ram":  { "type": "bar", "label": "RAM", "min": 0, "max": 100, "color": "#A78BFA", "bind": "ram" },
    "up":   { "type": "readout", "label": "Uptime", "unit": " h", "font": 14, "color": "#9AA0AA", "bind": "uptime" }
  },
  "pages": [
    { "name": "Server", "place": [
      { "ref": "cpu",  "anchor": "CENTER", "dy": -30 },
      { "ref": "cpul", "anchor": "CENTER", "dy": 60 },
      { "ref": "ram",  "anchor": "BOTTOM_MID", "dy": -50, "width": 220, "height": 16 },
      { "ref": "up",   "anchor": "BOTTOM_MID", "dy": -20 }
    ] }
  ],
  "sources": [
    { "name": "My server (edit me)",
      "url": "http://192.168.1.10:9000/metrics.json",
      "interval_s": 10,
      "vars": { "cpu": "/cpu", "ram": "/ram", "uptime": "/uptime" } }
  ]
}
```

- [ ] **Step 8 : créer `designer/templates/home-assistant.json`** (skeleton, secret)

```json
{
  "title": "Home Assistant",
  "background": "#0B0B0F",
  "components": {
    "ic":   { "type": "icon", "symbol": "home", "color": "#41BDF5", "font": 40 },
    "tval": { "type": "readout", "label": "", "unit": " °C", "font": 40, "color": "#F5F5F7", "bind": "temp" },
    "cap":  { "type": "label", "text": "Living room", "font": 16, "color": "#9AA0AA" }
  },
  "pages": [
    { "name": "Home", "place": [
      { "ref": "ic",   "anchor": "CENTER", "dy": -70 },
      { "ref": "tval", "anchor": "CENTER", "dy": 0 },
      { "ref": "cap",  "anchor": "CENTER", "dy": 46 }
    ] }
  ],
  "sources": [
    { "name": "Home Assistant (edit me)",
      "url": "http://homeassistant.local:8123/api/states/sensor.living_room_temperature",
      "interval_s": 30,
      "headers": { "Authorization": "$ha_token" },
      "vars": { "temp": "/state" } }
  ]
}
```

- [ ] **Step 9 : lancer le test, vérifier qu'il passe**

Run: `cd designer && node --test tests/templates.test.js`
Expected: PASS (6 tests : manifeste + 5 templates valides). Si un template échoue, l'assertion imprime les erreurs ajv humanisées → corriger le champ fautif.

- [ ] **Step 10 : commit**

```bash
git add designer/templates/ designer/tests/templates.test.js
git commit -m "feat(templates): 5 layouts + manifeste + test de validation"
```

---

## Task 3 : rendu miniature isolé (`preview.js`)

**Files:**
- Create: `designer/js/template-preview.js`
- Modify: `designer/style.css` (classes `.tpl-thumb*`)

DOM pur → browser-verified (pas de test node, cf. mémoire `designer-tests-dom-builders`). Réutilise `COMPONENTS[type].build`, `placeAt`, `SCREEN`, `MOCKS`.

- [ ] **Step 1 : créer `designer/js/template-preview.js`**

```js
// Miniature live d'un layout (page 0). Réutilise les builders du registre + la géométrie du canvas,
// SANS toucher canvas.js (sélection/poignées/guides). Mesure les nœuds attachés dans un hôte
// « visibility:hidden » (display:none donnerait des tailles nulles) puis positionne comme canvas.js.
import { COMPONENTS } from './registry.js';
import { placeAt, SCREEN } from './geometry.js';
import { MOCKS } from './render.js';

// Hôte de mesure : rendu (layout calculé) mais invisible, hors flux.
let measureHost = null;
function ensureMeasureHost() {
  if (!measureHost) {
    measureHost = document.createElement('div');
    measureHost.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
    document.body.appendChild(measureHost);
  }
  return measureHost;
}

// Renvoie un <div.tpl-thumb> contenant un stage 360×360 réduit par `scale`.
export function buildThumbnail(layout, { scale = 0.42 } = {}) {
  const stage = document.createElement('div');
  stage.className = 'tpl-thumb-stage';
  stage.style.width = stage.style.height = SCREEN + 'px';
  stage.style.background = layout.background || '#000';
  stage.style.transform = `scale(${scale})`;
  stage.style.transformOrigin = 'top left';

  const comps = layout.components || {};
  const page = (Array.isArray(layout.pages) && layout.pages[0]) || { place: [] };

  // 1) construire + attacher dans l'hôte de mesure (échelle 1 : le stage y est mesuré avant scale)
  ensureMeasureHost().appendChild(stage);
  const placed = [];
  for (const pl of (Array.isArray(page.place) ? page.place : [])) {
    const comp = comps[pl.ref];
    if (!comp) continue;
    const def = COMPONENTS[comp.type];
    if (!def || def.physical) continue;
    const node = def.build(comp, pl, MOCKS[comp.type] ?? {});
    stage.appendChild(node);
    placed.push({ node, pl, def });
  }
  // 2) positionner (mesure fiable : stage attaché, visibility:hidden ⇒ layout calculé)
  for (const { node, pl, def } of placed) {
    if (def.centered) {
      const r = pl.radius || 80;
      node.style.left = (SCREEN / 2 - r) + 'px';
      node.style.top  = (SCREEN / 2 - r) + 'px';
    } else {
      const rect = node.getBoundingClientRect();   // hôte à scale 1 ⇒ px = unités écran
      const { x, y } = placeAt(pl.anchor || 'CENTER', pl.dx || 0, pl.dy || 0, rect.width, rect.height);
      node.style.left = x + 'px';
      node.style.top  = y + 'px';
    }
  }

  // 3) sortir de l'hôte de mesure, emballer à la taille réduite
  const wrap = document.createElement('div');
  wrap.className = 'tpl-thumb';
  wrap.style.width = (SCREEN * scale) + 'px';
  wrap.style.height = (SCREEN * scale) + 'px';
  wrap.appendChild(stage);   // déplace le stage (retiré de measureHost)
  return wrap;
}
```

- [ ] **Step 2 : ajouter le CSS dans `designer/style.css`** (fin de fichier)

```css
/* Miniatures de la gallery de modèles : disque rond, contenu positionné en unités écran (360) et réduit. */
.tpl-thumb { position: relative; overflow: hidden; border-radius: 50%; flex: none; }
.tpl-thumb-stage { position: relative; overflow: hidden; border-radius: 50%; }
.tpl-thumb-stage .w { position: absolute; }
```

- [ ] **Step 3 : commit**

```bash
git add designer/js/template-preview.js designer/style.css
git commit -m "feat(templates): rendu miniature isolé (réutilise builders + geometry)"
```

> Vérif browser différée à la Task 6 (la miniature n'est visible qu'une fois la gallery montée).

---

## Task 4 : module gallery (`templates.js`)

**Files:**
- Create: `designer/js/templates.js`

DOM pur → browser-verified. Fetch le manifeste, construit les cartes (miniature + i18n), gère l'arm-confirm, appelle `onPick(text, entry)`.

- [ ] **Step 1 : créer `designer/js/templates.js`**

```js
// Gallery de modèles montée dans le tiroir « Modèles ». Fetch le manifeste templates/index.json,
// rend une carte par modèle (miniature live + nom/description/badge i18n). Cliquer une carte :
// si le canvas a déjà été travaillé (model.canUndo()) → arm-confirm (1er clic « Remplacer ? », 2e
// exécute, disarm après 3 s) ; sinon charge direct. Charge = fetch du fichier → onPick(text, entry).
// Câblage DOM, vérifié navigateur (aucune logique pure → pas de test node, cf. convention projet).
import { buildThumbnail } from './template-preview.js';
import { t } from './i18n.js';

const WIRED = new Set(['weather', 'crypto', 'server', 'home-assistant']);  // badge « à brancher »

export async function mountTemplatesGallery(host, model, { onPick } = {}) {
  let manifest;
  try {
    const res = await fetch('templates/index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (e) {
    console.warn('[templates] manifeste indisponible', e);
    host.textContent = t('templates.badge.wire');   // dégradé silencieux : gallery vide plutôt que crash
    return;
  }

  for (const entry of (Array.isArray(manifest) ? manifest : [])) {
    let layout;
    try {
      const r = await fetch(`templates/${entry.file}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      layout = await r.json();
    } catch (e) { console.warn(`[templates] ${entry.file} illisible`, e); continue; }

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tpl-card';
    card.appendChild(buildThumbnail(layout));

    const meta = document.createElement('div');
    meta.className = 'tpl-meta';
    const h = document.createElement('div'); h.className = 'tpl-name'; h.textContent = t(`templates.${entry.id}.name`);
    const p = document.createElement('div'); p.className = 'tpl-desc'; p.textContent = t(`templates.${entry.id}.description`);
    const b = document.createElement('span'); b.className = 'tpl-badge ' + (WIRED.has(entry.id) ? 'wire' : 'ready');
    b.textContent = WIRED.has(entry.id) ? t('templates.badge.wire') : t('templates.badge.ready');
    meta.append(h, p, b);
    card.appendChild(meta);

    wireCard(card, model, entry, layout, onPick);
    host.appendChild(card);
  }
}

// Arm-confirm sur canvas travaillé (ethos designer : pas de modale). Session vierge → 1 clic.
function wireCard(card, model, entry, layout, onPick) {
  let armed = false, timer = null;
  const badge = card.querySelector('.tpl-badge');
  const disarm = () => { armed = false; card.classList.remove('confirm'); if (timer) clearTimeout(timer); timer = null; };
  const load = () => onPick && onPick(JSON.stringify(layout), entry);
  card.addEventListener('click', () => {
    if (!model.canUndo()) return load();                 // rien à protéger → charge direct
    if (armed) { disarm(); return load(); }              // 2e clic → charge
    armed = true; card.classList.add('confirm');         // 1er clic → arme
    badge.textContent = t('templates.replace');
    timer = setTimeout(() => { disarm(); badge.textContent = WIRED.has(entry.id) ? t('templates.badge.wire') : t('templates.badge.ready'); }, 3000);
  });
}
```

- [ ] **Step 2 : ajouter le CSS des cartes dans `designer/style.css`**

```css
/* Cartes de la gallery de modèles (tiroir). */
.tpl-card { display: flex; gap: 12px; align-items: center; width: 100%; text-align: left; padding: 10px;
            background: var(--panel, #16161c); border: 1px solid var(--line, #2a2a33); border-radius: 10px;
            color: inherit; cursor: pointer; margin-bottom: 10px; }
.tpl-card:hover { border-color: var(--accent, #FF9F40); }
.tpl-card.confirm { border-color: var(--warn, #F59E0B); }
.tpl-meta { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tpl-name { font-weight: 600; }
.tpl-desc { font-size: 12px; color: var(--text-dim, #9AA0AA); }
.tpl-badge { align-self: flex-start; font-size: 11px; padding: 1px 8px; border-radius: 999px; }
.tpl-badge.ready { background: rgba(52,211,153,.15); color: #34D399; }
.tpl-badge.wire  { background: rgba(245,158,11,.15); color: #F59E0B; }
```

> Vérifier les noms de variables CSS (`--panel`, `--line`, `--accent`, `--warn`, `--text-dim`) contre `:root` de `style.css` ; remplacer par les variables réelles si différentes.

- [ ] **Step 3 : commit**

```bash
git add designer/js/templates.js designer/style.css
git commit -m "feat(templates): module gallery (cartes + arm-confirm)"
```

---

## Task 5 : markup (bouton topbar + tiroir)

**Files:**
- Modify: `designer/index.html`

- [ ] **Step 1 : ajouter le bouton topbar** (après le groupe « Fichier local », l.29, en nouveau `tb-group`)

Insérer juste après `</div>` de fermeture du premier `tb-group` (ligne 29) :

```html
    <!-- Modèles -->
    <div class="tb-group">
      <button id="templates-toggle" class="tb-btn" type="button" data-i18n-tip="toolbar.templates.tip" data-i18n-title="toolbar.templates.title" data-tip="Modèles" title="Partir d'un dashboard prêt à l'emploi"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="5" height="5" rx="1"/><rect x="9" y="2.5" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg></button>
    </div>
```

- [ ] **Step 2 : ajouter le tiroir** (après le `settings-drawer`, l.125, avant `shot-overlay`)

```html
  <aside id="templates-drawer" class="drawer" hidden>
    <div class="drawer-backdrop"></div>
    <div class="drawer-panel" role="dialog" aria-label="Templates" data-i18n-aria-label="drawer.templates.aria">
      <div class="drawer-head">
        <h2 data-i18n="drawer.templates.title">Modèles</h2>
        <button class="drawer-close" type="button" data-i18n-title="drawer.close" title="Fermer">✕</button>
      </div>
      <div id="templates-pane" class="drawer-pane">
        <div id="templates-gallery" class="tpl-gallery"></div>
      </div>
    </div>
  </aside>
```

- [ ] **Step 3 : commit**

```bash
git add designer/index.html
git commit -m "feat(templates): bouton topbar + tiroir gallery"
```

---

## Task 6 : câblage app.js + vérification navigateur end-to-end

**Files:**
- Modify: `designer/js/app.js`

- [ ] **Step 1 : importer le module gallery** (près des autres imports, ~l.5-24)

```js
import { mountTemplatesGallery } from './templates.js';
```

- [ ] **Step 2 : créer le tiroir Modèles et monter la gallery** (dans le bloc des `createDrawer`, ~l.252-257)

Ajouter, après la création de `settings` :

```js
  const templatesDrawer = createDrawer($('templates-drawer'), {
    toggleBtn: $('templates-toggle'),
    onOpen: () => { drawer.close(); sinksDrawer.close(); settings.close(); },   // un seul tiroir ouvert
  });
  mountTemplatesGallery($('templates-gallery'), model, {
    onPick: (text, entry) => {
      model.loadJSON(text);
      onLoad();                                   // même reset que l'import fichier (ensurePhysicals…)
      templatesDrawer.close();
      showToast(t('toast.template_loaded'), { kind: 'ok' });
      logs.logActivity(t('activity.template_loaded', { id: entry.id }));
    },
  });
```

- [ ] **Step 3 : ajouter `templates-drawer` à l'exclusion mutuelle des 3 autres tiroirs**

Dans les `onOpen` existants de `drawer`, `sinksDrawer`, `settings` (l.252-257), ajouter `templatesDrawer.close()`.
Exemple pour `drawer` :

```js
  const drawer = createDrawer($('drawer'), { toggleBtn: $('drawer-toggle'), onOpen: () => { settings.close(); sinksDrawer.close(); templatesDrawer.close(); } });
```

Faire de même dans `sinksDrawer.onOpen` et `settings` (`onOpen`). `templatesDrawer` est déclaré après → référence en closure (comme le commentaire l.252 le note déjà pour settings/sinksDrawer : pas de TDZ car appelé au clic, pas au montage).

> Vérifier que `showToast`, `t`, `logs` sont déjà importés dans app.js (ils le sont — utilisés par le câblage existant). Sinon ajouter l'import manquant.

- [ ] **Step 4 : build de vérification (sanity JS)**

Run: `cd designer && node --test`
Expected: PASS (toute la suite ; aucun test ne doit régresser ; `templates.test.js` + `i18n-parity.test.js` verts).

- [ ] **Step 5 : vérification navigateur (servir en no-store + vrais events, cf. mémoire `designer-verif-navigateur`)**

Servir : `cd designer && python3 -m http.server 8123 --bind 127.0.0.1` (⚠ PAS le port 8000 — réservé, cf. mémoire `test-server-hygiene` ; arrêter le serveur après). Ouvrir `http://127.0.0.1:8123`.

Cocher :
- [ ] Le bouton « Modèles » ouvre le tiroir ; les 4 autres tiroirs se ferment si l'un est ouvert.
- [ ] Les **5 cartes** s'affichent avec **miniature ronde non vide** (clock/weather/crypto/server/home-assistant), nom + description + badge (vert « ready » pour clock, ambre « wire » pour les 4 autres).
- [ ] Sur session vierge (aucune édition) : clic sur « Desk clock » → charge en **1 clic**, canvas affiche l'horloge, toast « Template loaded ».
- [ ] Après une édition (déplacer un composant) : clic sur une carte → la carte passe en « Replace dashboard? » (arm) ; 2e clic → charge. Attendre 3 s sans recliquer → l'arm se désarme (badge revient).
- [ ] Charger « Weather » : le panneau **Sources** (tiroir) contient bien la source Open-Meteo ; les composants (anneau temp + readouts) sont rendus sur le canvas avec les mocks.
- [ ] Après chargement, **Ctrl+Z** restaure le dashboard précédent (charge annulable).
- [ ] Arrêter le serveur de test.

- [ ] **Step 6 : commit**

```bash
git add designer/js/app.js
git commit -m "feat(templates): câblage tiroir + chargement (onLoad réutilisé)"
```

---

## Task 7 : vérification finale

- [ ] **Step 1 : suite complète**

Run: `cd designer && node --test`
Expected: PASS (0 échec). Noter le compte de tests (doit augmenter de +6 vs avant : les tests templates).

- [ ] **Step 2 : diff de revue**

Run: `git diff --stat main`
Expected: uniquement `designer/` (+ specs/plans `docs/superpowers/`). **Aucun** fichier `src/`, `lib/`, `schema/` touché (feature 100 % designer).

- [ ] **Step 3 : (optionnel, sur demande) e2e on-device d'un template câblé**

Hors périmètre du designer, à la demande : `bash tools/stage_fs.sh` + `pio run -e esp32s3 -t uploadfs` (⚠ efface les assets device — sauvegarder d'abord, cf. mémoire `uploadfs-efface-assets-device`), pousser `weather.json` avec une vraie lat/lon, vérifier que le device affiche la **vraie** température (valide la chaîne HTTPS `net_pull`).

---

## Self-review (rempli à l'écriture)

- **Couverture spec** : §4.1 données→T2 ; §4.2 gallery→T4 ; §4.3 i18n→T1 ; §4.4 miniature→T3 ; §4.5 test→T2 ; §6 lot→T2 (5 fichiers) ; §7 UI→T4/T5 ; confirmation→T4 (arm) ; onLoad→T6. Écart assumé vs spec : la « modale » de la spec devient un **tiroir** (ethos designer, découvert à la lecture de `confirm.js` — pas de modale) ; noté aussi dans l'Architecture ci-dessus.
- **Placeholders** : aucun (`templates.clock.setup` = '' est intentionnel — clock zéro config).
- **Cohérence de types** : `onPick(text, entry)` ↔ appelé en T4, fourni en T6 ; `buildThumbnail(layout)` ↔ T3/T4 ; `mountTemplatesGallery(host, model, {onPick})` ↔ T4/T6. `model.canUndo()`/`loadJSON` ↔ API réelle (model.js). Ids manifeste (`home-assistant`) = clés i18n `templates.home-assistant.*` = nom de fichier.
- **Risques** : CoinGecko rate-limit (assumé, repli Coinbase documenté spec) ; variables CSS `:root` à confirmer (T4 step 2) ; positionnement radial en miniature (géré `def.centered` T3).
