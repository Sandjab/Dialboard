# Effecteurs — Plan C (designer) : producteurs `switch`/`button` + panneau `sinks` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au designer WYSIWYG la parité designer↔firmware pour les 2 effecteurs déjà livrés côté firmware (B1 : `switch` + `button` mode `set`) et un panneau d'édition des `sinks[]` (sorties HTTP réactives), sans casser la parité ni les afficheurs existants.

**Architecture :** Les composants du designer suivent tous le même patron : une entrée dans `registry.js` (défauts + champs d'inspecteur), un builder DOM dans `render.js`, une icône de palette dans `icons.js`, une entrée dans `schema/layout.schema.json` (`component.oneOf` + `$defs`), et des clés i18n EN↔FR. Le canvas est **générique** (aucun code par type sauf les poignées de redimensionnement, dont switch/button se passent). Le panneau `sinks` est un **miroir de `sources.js`** (le `$defs/sink` et le top-level `sinks` existent déjà depuis le Plan A). Le firmware parse déjà switch/button et les sinks (A + B1 mergés) — **ce plan est 100 % designer + schéma**, aucun changement firmware.

**Tech Stack :** JS modules ES (designer, tests `node --test`), JSON Schema draft-07 (validé côté designer via AJV et côté firmware par construction), i18n plat à clés namespacées (`t()`).

**Périmètre (décidé) :** switch + button (`set`) + panneau sinks. `momentary` et slider/arc/roller sont **différés** à une tranche ultérieure (après le firmware B2). Ne PAS les ajouter ici (romprait la parité designer↔firmware).

---

## Faits de parité firmware (vérifiés — ne pas ré-explorer)

- **`switch`** (`COMP_SWITCH`) : champ `bind` **seul**. Rendu `lv_switch`. Reflet on/off depuis le contexte ; écrit `bind=on?1:0` (origine UI) au `VALUE_CHANGED`. Taille : `build_switch` (view.cpp:552) utilise `q.width/q.height` **si présents** (défaut par-axe 60/30), sinon taille LVGL par défaut. → le designer **doit émettre width/height** pour un rendu déterministe.
- **`button`** (`COMP_BUTTON`) : champs `bind`, `text` (libellé), `value` (num|str). Le firmware distingue num/str par le **type JSON** de `value` (`dashboard.cpp:235` : `bv.is<float>()||bv.is<int>()` → `set_is_num`). Rendu `lv_button` + label ; texte **blanc** (`0xFFFFFF` codé en dur, view.cpp:571), police **générique** `get_font(font_family, font, bold, italic)` (défaut font 20). Taille : `build_button` (view.cpp:565) `q.width/q.height` si présents (défaut 100/44), sinon auto-taille au contenu. → émettre width/height.
- **Parsing générique** (dashboard.cpp) : `text` (l.129), `bind` (l.177), `font` (l.149, défaut 20) sont parsés **pour tous les composants** → le button hérite de `text`/`bind`/`font` sans code dédié.
- **Sinks** : `$defs/sink` (schema l.451) + top-level `sinks` (l.37) **déjà présents** (Plan A). `sink.watch`+`url` requis. Le firmware lit `body` via `serializeJson(sk["body"], s.body, …)` (dashboard.cpp:317) → **`body` doit être une valeur JSON** (objet), pas une chaîne brute. `{{var}}` vit **dans une chaîne JSON** (ex. `{"state":"{{lamp}}"}` = JSON valide) ; corps vide ⇒ défaut typé `{"<watch>": <valeur>}` (sink.cpp:20-27). **Aucun changement de schéma sink** requis.

## Non-touché (surgical scope)

- `canvas.js` : **aucun changement**. Le rendu/placement/drag/sélection est générique via `COMPONENTS[type].build/.centered/.makePlacement`. Le dispatch des poignées de redimensionnement (canvas.js:133-139) est par `if (comp.type === …)` et n'inclut pas switch/button → ils se redimensionnent via les champs width/height de l'inspecteur (pas de poignée canvas — acceptable v1).
- `tools/stage_fs.sh` : **aucun changement** (`cp designer/js/*.js` globe déjà tous les modules ; `sinks.js` est tiré par le graphe d'`import` d'`app.js`, chargé en module ES).
- **Firmware** (`src/`, `lib/`) : **aucun changement** (A + B1 déjà mergés).

## Point ouvert (cosmétique, NON traité ici)

`validate.js` émet un avertissement **non bloquant** `validate.unbound_bind` pour un `bind` qui n'est fourni par aucune var de source. Un effecteur **écrit** sa var (elle peut n'exister dans aucune `source`) → l'avertissement s'affichera pour switch/button liés. C'est **cosmétique** (warning, pas erreur ; le JSON reste schema-valide). **Laisser tel quel** dans ce plan ; le signaler dans le HANDOFF. Si l'utilisateur le souhaite plus tard : élargir « var connue » aux `sink.watch` et aux `bind` d'effecteurs.

---

## Task 1 : `render.js` — builders `buildSwitch` / `buildButton` + CSS

**Files:**
- Modify: `designer/js/render.js` (ajouter 2 fonctions exportées, en fin de fichier près des autres `build*`)
- Modify: `designer/style.css` (ajouter les classes `.w-switch` / `.w-button`, près des autres `.w-*`)

**Note de vérification :** `render.test.js` n'importe que des fonctions **pures** (pas de DOM en node) ; les builders DOM (`buildBar`, `buildLabel`…) sont vérifiés **au navigateur** (Task 6), pas en node. On suit cette convention : pas de test node ici. `.w { position:absolute }` (style.css:268) est acquis → un enfant `position:absolute` se cale sur l'élément `.w-*`.

- [ ] **Step 1 : Ajouter `buildSwitch` et `buildButton` à `render.js`**

Ajouter en fin de `designer/js/render.js` (après `buildIcon` / les autres `build*`). `font` et `pickFontPx` sont déjà exportés dans ce fichier (utilisés par `buildLabel`).

```javascript
// --- Effecteurs (Plan C). Parité firmware : view.cpp build_switch/build_button. ---

// switch : piste arrondie (état repos = off, gris) + poignée circulaire à gauche. Taille = placement
// width/height (défaut firmware 60×30, cf. build_switch). Pas de champ de style (le firmware rend le
// switch au thème LVGL par défaut) → aperçu statique off.
export function buildSwitch(comp, placement = {}) {
  const w = placement.width || 60, h = placement.height || 30;
  const n = document.createElement('div');
  n.className = 'w w-switch';
  n.style.width = w + 'px';
  n.style.height = h + 'px';
  n.style.borderRadius = (h / 2) + 'px';
  const knob = document.createElement('div');
  knob.className = 'w-switch-knob';
  const kd = Math.max(2, h - 6);           // poignée : marge 3px sur chaque bord
  knob.style.width = kd + 'px';
  knob.style.height = kd + 'px';
  knob.style.left = '3px';                 // off = poignée à gauche
  knob.style.top = '3px';
  n.appendChild(knob);
  return n;
}

// button : rectangle arrondi + libellé blanc centré. Taille = placement width/height (défaut 100×44).
// Police générique du composant (défaut 20, comme le firmware). Le fond/rayon approchent le bouton LVGL
// par défaut (le chrome exact suit le thème device ; la parité porte sur taille/texte/position).
export function buildButton(comp, placement = {}) {
  const w = placement.width || 100, h = placement.height || 44;
  const n = document.createElement('div');
  n.className = 'w w-button';
  n.style.width = w + 'px';
  n.style.height = h + 'px';
  const lbl = document.createElement('span');
  lbl.className = 'w-button-label';
  lbl.style.font = font(comp.font_family, comp.bold, comp.italic, pickFontPx(comp.font ?? 20));
  lbl.textContent = comp.text || 'Button';
  n.appendChild(lbl);
  return n;
}
```

- [ ] **Step 2 : Ajouter le CSS `.w-switch` / `.w-button`**

Ajouter dans `designer/style.css`, près des autres `.w-*` (ex. après `.w-led-spec` l.306). `.w` porte déjà `position:absolute`.

```css
/* Effecteurs (Plan C) */
.w-switch { box-sizing: border-box; background: #4B5563; }
.w-switch-knob { position: absolute; border-radius: 50%; background: #FFFFFF; }
.w-button { box-sizing: border-box; display: flex; align-items: center; justify-content: center; background: #4B5563; border-radius: 6px; }
.w-button-label { color: #FFFFFF; white-space: nowrap; line-height: 1; }
```

- [ ] **Step 3 : Vérifier l'absence de casse (import + suite node)**

Run: `cd designer && node --test`
Expected: PASS (inchangé — aucune régression ; les nouveaux builders ne sont pas encore importés).

Run: `cd designer && node -e "import('./js/render.js').then(m => console.log(typeof m.buildSwitch, typeof m.buildButton))"`
Expected: `function function`

- [ ] **Step 4 : Commit**

```bash
git add designer/js/render.js designer/style.css
git commit -m "feat(effecteurs-C): render designer switch/button (builders + CSS)"
```

---

## Task 2 : Parité — schéma + registre + icônes + i18n (increment couplé)

Le test `registry.test.js` exige `Object.keys(COMPONENTS)` == types du schéma, **strictement**. Ajouter un côté seul casse le test → schéma **et** registre dans le **même commit**.

**Files:**
- Modify: `schema/layout.schema.json` (2 refs dans `component.oneOf` + 2 `$defs`)
- Modify: `designer/js/registry.js` (import des builders + 2 entrées `switch`/`button`)
- Modify: `designer/js/icons.js` (2 icônes de palette)
- Modify: `designer/i18n/en.js` + `designer/i18n/fr.json` (clés `comp.switch`, `comp.button`, `default.button.text`, `field.value`)
- Test: `designer/tests/registry.test.js` (assertions switch/button) + `designer/tests/schema.test.js` (round-trip `value` num|str)

- [ ] **Step 1 : Écrire les tests d'abord (registre + schéma round-trip)**

Ajouter à `designer/tests/registry.test.js` :

```javascript
test('registre : switch expose bind seul + defaults()', () => {
  const keys = COMPONENTS.switch.compFields.map(f => f[0]);
  assert.deepEqual(keys, ['bind']);
  const d = COMPONENTS.switch.defaults();
  assert.equal(d.type, 'switch');
  assert.equal(COMPONENTS.switch.physical, false);
  assert.equal(COMPONENTS.switch.centered, false);
});

test('registre : button expose text/value/bind + defaults() (value string, radio set)', () => {
  const keys = COMPONENTS.button.compFields.map(f => f[0]);
  assert.deepEqual(keys, ['text', 'value', 'bind']);
  const d = COMPONENTS.button.defaults();
  assert.equal(d.type, 'button');
  assert.equal(typeof d.value, 'string');          // défaut string (set_is_num=false côté firmware)
  // le champ value utilise l'éditeur bespoke 'value' (num|str)
  assert.equal(COMPONENTS.button.compFields.find(f => f[0] === 'value')[2], 'value');
});

test('registre : switch/button émettent width/height au placement (parité taille firmware)', () => {
  const sw = COMPONENTS.switch.makePlacement('sw1', 180, 180);
  assert.equal(sw.width, 60); assert.equal(sw.height, 30);
  const bt = COMPONENTS.button.makePlacement('bt1', 180, 180);
  assert.equal(bt.width, 100); assert.equal(bt.height, 44);
});
```

Ajouter à `designer/tests/schema.test.js` un round-trip du type num|str du button. (Ce fichier importe déjà le schéma + un validateur AJV — reprendre le même harnais que les cas existants ; le squelette ci-dessous suppose un `validateLayout(obj)` ou l'usage direct d'AJV déjà présent dans le fichier. S'aligner sur le style local du fichier.)

```javascript
test('schema : comp_button accepte value nombre ET chaîne ; comp_switch minimal', () => {
  const base = { components: {}, pages: [{ name: 'p', place: [] }] };
  const withNum = { ...base, components: { b: { type: 'button', text: 'Play', value: 5, bind: 'scene' } } };
  const withStr = { ...base, components: { b: { type: 'button', text: 'Movie', value: 'movie', bind: 'scene' } } };
  const sw      = { ...base, components: { s: { type: 'switch', bind: 'lamp' } } };
  for (const layout of [withNum, withStr, sw]) {
    const r = validate(layout);                 // ← adapter au nom du validateur du fichier
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  }
});
```

- [ ] **Step 2 : Lancer les tests → échec attendu**

Run: `cd designer && node --test`
Expected: FAIL — `registry.test.js` (`le registre couvre exactement les types du schema` et les nouveaux cas : `COMPONENTS.switch`/`button` indéfinis) + `schema.test.js` (types `button`/`switch` inconnus du schéma).

- [ ] **Step 3 : Ajouter `comp_switch` / `comp_button` au schéma**

Dans `schema/layout.schema.json`, `component.oneOf` (l.121) — ajouter une virgule après `comp_icon` puis :

```json
        { "$ref": "#/$defs/comp_icon" },
        { "$ref": "#/$defs/comp_switch" },
        { "$ref": "#/$defs/comp_button" }
```

Et dans `$defs` (placer après le def `comp_line`, avant `page`) :

```json
    "comp_switch": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "description": "Effecteur : interrupteur tactile (lv_switch). Écrit bind=on?1:0 à l'interaction (origine UI → arme les sinks) et reflète l'état on/off depuis le contexte. Taille via placement width/height (défaut 60×30).",
      "properties": {
        "type": { "const": "switch" },
        "visible": { "type": "boolean", "description": "Affiche le composant (défaut true). false = caché (LV_OBJ_FLAG_HIDDEN). Révélable via /update." },
        "bind": { "$ref": "#/$defs/id", "description": "Var de contexte écrite au toggle (origine UI) et reflétée (état on/off)." }
      }
    },
    "comp_button": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "description": "Effecteur : bouton tactile (lv_button + label). Au tap, écrit bind=value (origine UI → arme les sinks). Reflet radio : surbrillance si contexte == value. Taille via placement width/height (défaut 100×44). Texte blanc, police générique (font/font_family, défaut 20).",
      "properties": {
        "type": { "const": "button" },
        "visible": { "type": "boolean", "description": "Affiche le composant (défaut true). false = caché (LV_OBJ_FLAG_HIDDEN). Révélable via /update." },
        "bind": { "$ref": "#/$defs/id", "description": "Var de contexte écrite au tap (origine UI)." },
        "text": { "$ref": "#/$defs/display", "description": "Libellé du bouton (Latin-1). Pilotable via /update." },
        "value": { "type": ["number", "string"], "description": "Valeur écrite dans bind au tap. Nombre → set numérique ; chaîne → set string (le type JSON décide, cf. set_is_num firmware). Absent ⇒ chaîne vide." }
      }
    },
```

- [ ] **Step 4 : Ajouter les entrées `switch` / `button` au registre**

Dans `designer/js/registry.js` :

(a) Étendre l'import de `render.js` (l.11) avec `buildSwitch, buildButton` :

```javascript
import { buildLabel, buildReadout, buildBar, buildRing, buildChart, buildMeter, buildImage, buildImageAnim, buildLed, buildRect, buildCircle, buildLine, buildIcon, buildSwitch, buildButton } from './render.js';
```

(b) Insérer les 2 entrées **après `icon`** et **avant `rect`** (place les effecteurs dans le quadrant « special » de la palette, avec led/icon — cf. `canvas-zones.js`) :

```javascript
  switch: {
    label: 'comp.switch',
    defaults: () => ({ type: 'switch' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), width: 60, height: 30 }),
    centered: false, physical: false,
    compFields: [['bind', 'field.bind', 'idtext']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['width', 'field.width', 'num', 60], ['height', 'field.height', 'num', 30]],  // 4e = défaut firmware (view.cpp:552)
    mockFields: [],
    build: (comp, pl) => buildSwitch(comp, pl),
  },
  button: {
    label: 'comp.button',
    defaults: () => ({ type: 'button', text: t('default.button.text'), value: 'on' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), width: 100, height: 44 }),
    centered: false, physical: false,
    compFields: [['text', 'field.text', 'latintext'], ['value', 'field.value', 'value'], ['bind', 'field.bind', 'idtext']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['width', 'field.width', 'num', 100], ['height', 'field.height', 'num', 44]],  // 4e = défaut firmware (view.cpp:565)
    mockFields: [],
    build: (comp, pl) => buildButton(comp, pl),
  },
```

- [ ] **Step 5 : Ajouter les icônes de palette**

Dans `designer/js/icons.js`, ajouter au dict `PATHS` (après `icon`, l.23) :

```javascript
  switch:   '<rect x="2.5" y="8.5" width="19" height="7" rx="3.5"/><circle cx="16" cy="12" r="2.2" fill="currentColor" stroke="none"/>', // interrupteur (poignée à droite = on)
  button:   '<rect x="4" y="7" width="16" height="10" rx="3"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/>',      // bouton + point de tap
```

- [ ] **Step 6 : Ajouter les clés i18n (EN source + FR)**

Dans `designer/i18n/en.js` — après `'comp.ring'` (l.108) pour les `comp.*`, après `'default.bar.label'` (l.130) pour `default.*`, et près de `'field.text'` (l.132) pour `field.value` :

```javascript
  'comp.switch': 'Switch',
  'comp.button': 'Button',
```
```javascript
  'default.button.text': 'Button',
```
```javascript
  'field.value': 'Value (set)',
```

Dans `designer/i18n/fr.json` — mêmes clés, mêmes emplacements relatifs :

```json
  "comp.switch": "Interrupteur",
  "comp.button": "Bouton",
```
```json
  "default.button.text": "Bouton",
```
```json
  "field.value": "Valeur (set)",
```

- [ ] **Step 7 : Lancer les tests → succès attendu**

Run: `cd designer && node --test`
Expected: PASS — parité rétablie ; nouveaux cas registry + schema round-trip verts.

Run (parité i18n, depuis la racine) :
```bash
node -e "import('./designer/i18n/en.js').then(m=>{const en=m.default;const fr=JSON.parse(require('fs').readFileSync('./designer/i18n/fr.json','utf8'));const ek=Object.keys(en),fk=Object.keys(fr);console.log('EN',ek.length,'FR',fk.length,'EN-only',ek.filter(k=>!fk.includes(k)),'FR-only',fk.filter(k=>!ek.includes(k)));})"
```
Expected: `EN n FR n EN-only [] FR-only []` (compteurs égaux, aucune clé orpheline).

- [ ] **Step 8 : Commit**

```bash
git add schema/layout.schema.json designer/js/registry.js designer/js/icons.js designer/i18n/en.js designer/i18n/fr.json designer/tests/registry.test.js designer/tests/schema.test.js
git commit -m "feat(effecteurs-C): schéma + registre + icônes switch/button (parité)"
```

---

## Task 3 : `inspector.js` — éditeur `value` (nombre|chaîne) du button

Le champ `value` du button peut être **nombre ou chaîne** ; le firmware distingue par le type JSON. Aucun éditeur existant ne couvre ce cas → éditeur bespoke `valueField` (miroir de `fillField`) : un champ texte + une case « numérique ». Vérifié au **navigateur** (Task 6) ; pas de test node d'inspecteur (aucun `inspector.test.js` — convention du dépôt). Le contrat de type est couvert par le round-trip schéma de la Task 2.

**Files:**
- Modify: `designer/js/inspector.js` (fonction `valueField` + branche de dispatch dans `renderComp`)
- Modify: `designer/i18n/en.js` + `designer/i18n/fr.json` (`inspector.tip.value_numeric`)

- [ ] **Step 1 : Ajouter la fonction `valueField`**

Dans `designer/js/inspector.js`, ajouter (à côté de `fillField`, même portée — `sel`, `model`, `setComponentProp`, `t` y sont accessibles) :

```javascript
  // Champ « Valeur (set) » du button : texte + case « numérique ». Case cochée → value émise comme
  // NOMBRE (Number, 0 si vide/non numérique) ; décochée → CHAÎNE. Le firmware décide num/str par le type
  // JSON (set_is_num). ref figée au rendu (cf. invariant inspecteur : le change part en différé).
  function valueField(label, c) {
    const ref = sel.ref;
    const row = document.createElement('div'); row.className = 'insp-row';
    const span = document.createElement('span'); span.className = 'insp-label'; span.textContent = t(label);
    row.appendChild(span);
    const txt = document.createElement('input'); txt.type = 'text';
    txt.value = c.value == null ? '' : String(c.value);
    const num = document.createElement('input'); num.type = 'checkbox'; num.checked = typeof c.value === 'number';
    num.title = t('inspector.tip.value_numeric');
    const commit = () => {
      let v;
      if (num.checked) { const parsed = Number(txt.value); v = Number.isFinite(parsed) ? parsed : 0; }
      else v = txt.value;
      model.commit(s => setComponentProp(s, ref, 'value', v));
    };
    txt.addEventListener('change', commit);
    num.addEventListener('change', commit);
    row.append(txt, num);
    return row;
  }
```

- [ ] **Step 2 : Dispatcher `kind === 'value'` dans `renderComp`**

Dans `designer/js/inspector.js`, boucle `renderComp` (l.598-622), ajouter la branche juste après la branche `fill` (l.601) :

```javascript
        if (kind === 'fill') { propBody.appendChild(fillField(label, c)); continue; }   // forme : fond optionnel (bespoke : enableWhen non supporté, comme image/image_anim)
        if (kind === 'value') { propBody.appendChild(valueField(label, c)); continue; }  // button : valeur num|str (bespoke)
```

- [ ] **Step 3 : Ajouter la clé i18n du tooltip (EN + FR)**

`designer/i18n/en.js` (avec les autres `inspector.tip.*`) :
```javascript
  'inspector.tip.value_numeric': 'Send as a number (unchecked = text)',
```
`designer/i18n/fr.json` :
```json
  "inspector.tip.value_numeric": "Émettre comme nombre (décoché = texte)",
```

- [ ] **Step 4 : Vérifier l'absence de casse + parité i18n**

Run: `cd designer && node --test`
Expected: PASS (inchangé côté node).

Run: la commande de parité i18n de la Task 2 Step 7.
Expected: compteurs égaux, aucune clé orpheline.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/inspector.js designer/i18n/en.js designer/i18n/fr.json
git commit -m "feat(effecteurs-C): inspecteur — éditeur value (nombre|chaîne) du button"
```

---

## Task 4 : `mutations.js` — mutations des sinks (pures, TDD)

**Files:**
- Modify: `designer/js/mutations.js` (fonctions pures, à côté des `*Source`, l.292-335)
- Test: `designer/tests/mutations.test.js` (à côté des tests `*Source`, l.293-329)

- [ ] **Step 1 : Écrire les tests d'abord**

Ajouter à `designer/tests/mutations.test.js` (importer les nouveaux symboles depuis `../js/mutations.js`) :

```javascript
test('addSink : ajoute un sink vide (watch/url manquants → invalide, débounce 0)', () => {
  const s = {};
  addSink(s, 'lampe');
  assert.deepEqual(s.sinks, [{ name: 'lampe', watch: '', url: '', debounce_ms: 0 }]);
});

test('uniqueSinkName : évite les collisions de nom', () => {
  const s = { sinks: [{ name: 'sink1' }] };
  assert.equal(uniqueSinkName(s), 'sink2');
});

test('setSinkProp : édite/efface (chaîne vide → clé supprimée)', () => {
  const s = { sinks: [{ name: 'a', watch: 'lamp', url: '', debounce_ms: 0 }] };
  setSinkProp(s, 0, 'url', 'http://ha.local');
  assert.equal(s.sinks[0].url, 'http://ha.local');
  setSinkProp(s, 0, 'watch', '');
  assert.equal('watch' in s.sinks[0], false);
});

test('setSinkHeaders : objet non vide posé, vide supprimé', () => {
  const s = { sinks: [{ name: 'a' }] };
  setSinkHeaders(s, 0, { Authorization: '$ha' });
  assert.deepEqual(s.sinks[0].headers, { Authorization: '$ha' });
  setSinkHeaders(s, 0, {});
  assert.equal('headers' in s.sinks[0], false);
});

test('setSinkBody : valeur JSON posée, absente supprimée', () => {
  const s = { sinks: [{ name: 'a' }] };
  setSinkBody(s, 0, { state: '{{lamp}}' });
  assert.deepEqual(s.sinks[0].body, { state: '{{lamp}}' });
  setSinkBody(s, 0, null);
  assert.equal('body' in s.sinks[0], false);
});

test('removeSink : retire par index', () => {
  const s = { sinks: [{ name: 'a' }, { name: 'b' }] };
  removeSink(s, 0);
  assert.deepEqual(s.sinks, [{ name: 'b' }]);
});
```

- [ ] **Step 2 : Lancer → échec attendu**

Run: `cd designer && node --test`
Expected: FAIL — `addSink`/`uniqueSinkName`/… non définis.

- [ ] **Step 3 : Implémenter les mutations**

Ajouter à `designer/js/mutations.js` (après le bloc `*Source`, l.335) :

```javascript
// --- Sinks (push réactif ; miroir des sources) ---
export function uniqueSinkName(state) {
  const used = new Set((state.sinks || []).map(s => s.name));
  let n = 1;
  while (used.has(`sink${n}`)) n++;
  return `sink${n}`;
}

export function addSink(state, name) {
  (state.sinks ||= []).push({ name, watch: '', url: '', debounce_ms: 0 });
}

export function removeSink(state, index) {
  if (!state.sinks) return;
  state.sinks.splice(index, 1);
}

export function setSinkProp(state, index, key, value) {
  const s = state.sinks?.[index];
  if (!s) return;
  if (value === '' || value === null || value === undefined) delete s[key];
  else s[key] = value;
}

export function setSinkHeaders(state, index, headers) {
  const s = state.sinks?.[index];
  if (!s) return;
  if (headers && Object.keys(headers).length) s.headers = headers;
  else delete s.headers;
}

export function setSinkBody(state, index, body) {
  const s = state.sinks?.[index];
  if (!s) return;
  if (body != null) s.body = body;   // body = valeur JSON (objet) ; null/absent → défaut typé firmware
  else delete s.body;
}
```

- [ ] **Step 4 : Lancer → succès attendu**

Run: `cd designer && node --test`
Expected: PASS (nouveaux cas sinks verts).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/mutations.js designer/tests/mutations.test.js
git commit -m "feat(effecteurs-C): mutations sinks (add/remove/prop/headers/body)"
```

---

## Task 5 : Panneau `sinks` — module + HTML + câblage + i18n

Miroir du panneau `sources` (`sources.js` + tiroir dédié). Champs sink : `name`, `watch`, `method` (select), `url`, `headers` (paires), `debounce_ms` (num), `body` (JSON, textarea validée). Vérifié au **navigateur** (Task 6) ; les CSS `.src-*` sont réutilisées (aucun nouveau CSS).

**Files:**
- Create: `designer/js/sinks.js`
- Modify: `designer/index.html` (tiroir `#sinks-drawer` + bouton toolbar `#sinks-toggle`)
- Modify: `designer/js/app.js` (import + `createSinks` + `createDrawer` + exclusion mutuelle des tiroirs)
- Modify: `designer/i18n/en.js` + `designer/i18n/fr.json` (`sinks.*`, `toolbar.sinks.*`, `drawer.sinks.*`)

- [ ] **Step 1 : Créer `designer/js/sinks.js`**

```javascript
// Panneau d'édition des sinks (push réseau réactif top-level, hors canvas). Miroir de sources.js :
// commit sur 'change' (1 undo/édition), garde-focus, headers édités en paires. Spécifique aux sinks :
// method (select), debounce_ms (num), body (gabarit JSON parsé — {{var}} vit dans une chaîne JSON ;
// le firmware fait serializeJson(body) → body DOIT être une valeur JSON, pas une chaîne brute).
import {
  uniqueSinkName, addSink, removeSink,
  setSinkProp, setSinkHeaders, setSinkBody
} from './mutations.js';
import { t } from './i18n.js';

const MAX_SINKS = 6, MAX_PAIRS = 4;   // miroir config.h (MAX_SINKS=6, MAX_HEADERS_PER_SINK=4)
const METHODS = ['POST', 'PUT', 'GET'];

const toPairs = obj => Object.entries(obj || {}).map(([k, v]) => [k, v]);
const fromPairs = pairs => Object.fromEntries(pairs.filter(([k]) => k !== ''));

function textInput(value, onChange, placeholder) {
  const el = document.createElement('input');
  el.type = 'text'; el.value = value ?? ''; if (placeholder) el.placeholder = placeholder;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function numInput(value, onChange) {
  const el = document.createElement('input');
  el.type = 'number'; el.value = value ?? '';
  el.addEventListener('change', () => onChange(el.value === '' ? '' : Number(el.value)));
  return el;
}

function selectInput(value, options, onChange) {
  const el = document.createElement('select');
  for (const opt of options) { const o = document.createElement('option'); o.value = opt; o.textContent = opt; if (opt === value) o.selected = true; el.appendChild(o); }
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function row(...kids) {
  const r = document.createElement('div'); r.className = 'src-row';
  for (const k of kids) r.appendChild(k);
  return r;
}

function labelled(text, input) {
  const l = document.createElement('label'); l.className = 'src-field';
  const s = document.createElement('span'); s.textContent = text;
  l.appendChild(s); l.appendChild(input);
  return l;
}

// Éditeur du corps : gabarit JSON. Vide → défaut typé firmware (clé body supprimée). Sinon JSON.parse :
// succès → objet stocké ; échec → avertissement, pas de commit (le dernier objet valide reste au modèle).
function bodyField(sink, onCommit) {
  const box = document.createElement('div'); box.className = 'src-field';
  const s = document.createElement('span'); s.textContent = t('sinks.body');
  const ta = document.createElement('textarea'); ta.rows = 2; ta.className = 'snk-body';
  ta.value = sink.body != null ? JSON.stringify(sink.body) : '';
  ta.placeholder = t('sinks.body_ph');
  const warn = document.createElement('span'); warn.className = 'insp-warn'; warn.textContent = t('sinks.body_invalid');
  warn.style.display = 'none';
  ta.addEventListener('change', () => {
    const txt = ta.value.trim();
    if (txt === '') { warn.style.display = 'none'; onCommit(null); return; }
    try { const obj = JSON.parse(txt); warn.style.display = 'none'; onCommit(obj); }
    catch { warn.style.display = ''; }   // invalide : pas de commit
  });
  box.append(s, ta, warn);
  return box;
}

export function createSinks(root, model) {
  function render() {
    const ae = document.activeElement;
    if (ae && root.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;   // garde-focus
    root.replaceChildren();
    const sinks = model.state.sinks || [];

    sinks.forEach((snk, i) => {
      const card = document.createElement('div'); card.className = 'src-card';

      const head = document.createElement('div'); head.className = 'src-head';
      const title = document.createElement('span'); title.className = 'src-title';
      title.textContent = snk.name || t('sinks.default_name', { n: i + 1 });
      const del = document.createElement('button'); del.className = 'src-del'; del.textContent = t('sinks.delete');
      del.addEventListener('click', () => model.commit(s => removeSink(s, i)));
      head.appendChild(title); head.appendChild(del);
      card.appendChild(head);

      card.appendChild(labelled(t('sinks.name'), textInput(snk.name, v => model.commit(s => setSinkProp(s, i, 'name', v)))));
      card.appendChild(labelled(t('sinks.watch'), textInput(snk.watch, v => model.commit(s => setSinkProp(s, i, 'watch', v)))));
      card.appendChild(labelled(t('sinks.method'), selectInput(snk.method || 'POST', METHODS, v => model.commit(s => setSinkProp(s, i, 'method', v)))));
      card.appendChild(labelled(t('sinks.url'), textInput(snk.url, v => model.commit(s => setSinkProp(s, i, 'url', v)), 'https://…')));
      card.appendChild(labelled(t('sinks.debounce'), numInput(snk.debounce_ms, v => model.commit(s => setSinkProp(s, i, 'debounce_ms', v)))));

      // Headers (paires nom -> valeur ; "$nom" = secret)
      card.appendChild(pairEditor(
        t('sinks.headers'), toPairs(snk.headers), t('sinks.name'), t('sinks.value'),
        pairs => model.commit(s => setSinkHeaders(s, i, fromPairs(pairs)))
      ));

      // Body (gabarit JSON)
      card.appendChild(bodyField(snk, body => model.commit(s => setSinkBody(s, i, body))));

      root.appendChild(card);
    });

    const add = document.createElement('button'); add.className = 'src-add';
    add.textContent = t('sinks.add');
    add.disabled = sinks.length >= MAX_SINKS;
    add.addEventListener('click', () => model.commit(s => addSink(s, uniqueSinkName(s))));
    root.appendChild(add);
  }

  // Éditeur de paires (headers) : identique à sources.js (ligne locale sans commit ; commit sur 'change').
  function pairEditor(title, pairs, kPlaceholder, vPlaceholder, onCommit) {
    const box = document.createElement('div'); box.className = 'src-pairs';
    const sub = document.createElement('div'); sub.className = 'src-sub'; sub.textContent = title;
    box.appendChild(sub);
    const rowsBox = document.createElement('div'); box.appendChild(rowsBox);
    const add = document.createElement('button'); add.className = 'src-pair-add'; add.textContent = '+';

    const addRow = idx => {
      const k = textInput(pairs[idx][0], v => { pairs[idx][0] = v; onCommit(pairs); }, kPlaceholder);
      const v = textInput(pairs[idx][1], v => { pairs[idx][1] = v; onCommit(pairs); }, vPlaceholder);
      const rm = document.createElement('button'); rm.className = 'src-pair-rm'; rm.textContent = '×';
      rm.addEventListener('click', () => { pairs.splice(idx, 1); onCommit(pairs); });
      rowsBox.appendChild(row(k, v, rm));
    };
    pairs.forEach((_, idx) => addRow(idx));

    add.disabled = pairs.length >= MAX_PAIRS;
    add.addEventListener('click', () => {
      if (pairs.length >= MAX_PAIRS) return;
      pairs.push(['', '']);
      addRow(pairs.length - 1);
      add.disabled = pairs.length >= MAX_PAIRS;
    });
    box.appendChild(add);
    return box;
  }

  model.subscribe(render);
  render();
  return { render };
}
```

- [ ] **Step 2 : Ajouter le tiroir + le bouton toolbar dans `index.html`**

(a) Bouton toolbar — après `#drawer-toggle` (l.42), avant `#settings-toggle` :

```html
      <button id="sinks-toggle" class="tb-btn" type="button" data-i18n-tip="toolbar.sinks.tip" data-i18n-title="toolbar.sinks.title" data-tip="Sinks (push)" title="Sinks : push réactif"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v7"/><path d="M5 6l3 3 3-3"/><path d="M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2"/></svg></button>
```

(b) Tiroir — après la fermeture du `<aside id="drawer">` (l.95), avant `<aside id="settings-drawer">` :

```html
  <aside id="sinks-drawer" class="drawer" hidden>
    <div class="drawer-backdrop"></div>
    <div class="drawer-panel" role="dialog" aria-label="Sinks" data-i18n-aria-label="drawer.sinks.aria">
      <div class="drawer-head">
        <h2 data-i18n="drawer.sinks.title">Sinks</h2>
        <button class="drawer-close" type="button" data-i18n-title="drawer.close" title="Fermer">✕</button>
      </div>
      <div id="sinks-pane" class="drawer-pane">
        <div id="sinks" class="sources-panel"></div>
      </div>
    </div>
  </aside>
```

- [ ] **Step 3 : Câbler dans `app.js`**

(a) Import — près de `import { createSources } from './sources.js';` (l.18) :
```javascript
import { createSinks } from './sinks.js';
```

(b) Instanciation + tiroir + exclusion mutuelle — bloc l.242-258. Remplacer :

```javascript
  createSources($('sources'), model);
  const drawer = createDrawer($('drawer'), { toggleBtn: $('drawer-toggle'), onOpen: () => settings.close() });  // settings déclaré juste après — closure, pas de TDZ
```
par :
```javascript
  createSources($('sources'), model);
  createSinks($('sinks'), model);
  const drawer = createDrawer($('drawer'), { toggleBtn: $('drawer-toggle'), onOpen: () => { settings.close(); sinksDrawer.close(); } });  // settings/sinksDrawer déclarés après — closure, pas de TDZ
  const sinksDrawer = createDrawer($('sinks-drawer'), { toggleBtn: $('sinks-toggle'), onOpen: () => { drawer.close(); settings.close(); } });
```
et, dans `createSettings(...)`, remplacer `onOpen: () => drawer.close(),` (l.248) par :
```javascript
    onOpen: () => { drawer.close(); sinksDrawer.close(); },   // un seul tiroir ouvert à la fois
```

- [ ] **Step 4 : Ajouter les clés i18n (EN + FR)**

`designer/i18n/en.js` — bloc `sinks.*` (après le bloc `sources.*`, ~l.333) + `toolbar.sinks.*` (avec les autres `toolbar.*`) + `drawer.sinks.*` (avec `drawer.sources.*`) :

```javascript
  'sinks.default_name': 'sink {n}',
  'sinks.delete': 'Delete',
  'sinks.name': 'Name',
  'sinks.watch': 'Watch (variable)',
  'sinks.method': 'Method',
  'sinks.url': 'URL',
  'sinks.headers': 'Headers (value "$name" = secret)',
  'sinks.value': 'Value',
  'sinks.debounce': 'Debounce (ms)',
  'sinks.body': 'Body template (JSON, {{var}})',
  'sinks.body_ph': '{"state":"{{watch}}"}',
  'sinks.body_invalid': 'Invalid JSON',
  'sinks.add': '+ sink',
  'toolbar.sinks.tip': 'Sinks (reactive push)',
  'toolbar.sinks.title': 'Reactive push sinks (POST on UI write)',
  'drawer.sinks.aria': 'Sinks',
  'drawer.sinks.title': 'Sinks',
```

`designer/i18n/fr.json` — mêmes clés :

```json
  "sinks.default_name": "sink {n}",
  "sinks.delete": "Supprimer",
  "sinks.name": "Nom",
  "sinks.watch": "Variable observée",
  "sinks.method": "Méthode",
  "sinks.url": "URL",
  "sinks.headers": "En-têtes (valeur « $nom » = secret)",
  "sinks.value": "Valeur",
  "sinks.debounce": "Anti-rebond (ms)",
  "sinks.body": "Corps (JSON, {{var}})",
  "sinks.body_ph": "{\"state\":\"{{watch}}\"}",
  "sinks.body_invalid": "JSON invalide",
  "sinks.add": "+ sink",
  "toolbar.sinks.tip": "Sinks (push réactif)",
  "toolbar.sinks.title": "Push réactif (POST à l'écriture UI)",
  "drawer.sinks.aria": "Sinks",
  "drawer.sinks.title": "Sinks",
```

- [ ] **Step 5 : Vérifier suite + parité i18n**

Run: `cd designer && node --test`
Expected: PASS (inchangé — sinks.js n'est pas testé en node ; aucune régression).

Run: la commande de parité i18n (Task 2 Step 7).
Expected: compteurs égaux, aucune clé orpheline.

- [ ] **Step 6 : Commit**

```bash
git add designer/js/sinks.js designer/index.html designer/js/app.js designer/i18n/en.js designer/i18n/fr.json
git commit -m "feat(effecteurs-C): panneau sinks (push réactif) + tiroir dédié"
```

---

## Task 6 : Vérification complète + QA navigateur (EN + FR) + docs

**Files:**
- Modify: `docs/_internal/HANDOFF.md` (nouvel état courant)
- Modify: mémoire auto `effecteurs-plan.md` (statut Plan C)

- [ ] **Step 1 : Suites automatisées au vert**

```bash
cd designer && node --test          # designer (registre parité, mutations sinks, schema round-trip)
```
Expected: PASS (0 échec).

```bash
cd /Users/jean-paulgavini/Documents/Dev/Dialboard
node -e "import('./designer/i18n/en.js').then(m=>{const en=m.default;const fr=JSON.parse(require('fs').readFileSync('./designer/i18n/fr.json','utf8'));const ek=Object.keys(en),fk=Object.keys(fr);console.log('EN',ek.length,'FR',fk.length,'EN-only',ek.filter(k=>!fk.includes(k)),'FR-only',fk.filter(k=>!ek.includes(k)));})"
```
Expected: compteurs égaux, `EN-only []`, `FR-only []`.

- [ ] **Step 2 : Build firmware (sanity — inchangé mais schéma partagé)**

```bash
pio test -e native                  # cœur logique firmware (non affecté)
pio run -e esp32s3                   # build firmware (non affecté)
```
Expected: natif PASS (compte inchangé), esp32s3 SUCCESS. (Le firmware ne lit pas le schéma au build ; ces runs prouvent l'absence de casse collatérale.)

- [ ] **Step 3 : QA navigateur (EN puis FR)**

Servir le designer en **no-store depuis la racine du repo** (cf. mémoire `designer-verif-navigateur`), ouvrir `/designer/index.html`. Piloter avec de **vrais events pointer** (pas `.click()`). Vérifier (EN, puis rebasculer en FR via Réglages→reload) :

1. **Palette** : chips `Switch` / `Button` présents (quadrant « special », avec led/icon), icônes distinctes non vides.
2. **Placement** : glisser `switch` sur l'écran → toggle gris (poignée à gauche) ~60×30 ; glisser `button` → rectangle arrondi ~100×44, texte « Button »/« Bouton » blanc centré. Sélection + déplacement OK (drag générique), désélection (Échap / clic hors composant).
3. **Inspecteur switch** : un seul champ `⛓ Variable` (bind) + placement (anchor/dx/dy/width/height). Saisir bind `lamp`.
4. **Inspecteur button** : champs `Text`, `Value (set)` (texte + case numérique), `⛓ Variable`. Vérifier :
   - case **décochée** + valeur `movie` → JSON exporté `"value":"movie"` (chaîne) ;
   - case **cochée** + valeur `5` → JSON exporté `"value":5` (nombre) ;
   - le libellé du bouton suit `Text` en direct.
5. **Panneau Sinks** : ouvrir via le nouveau bouton toolbar. Ajouter un sink → carte avec `Nom`/`Variable observée`/`Méthode`(POST/PUT/GET)/`URL`/`Anti-rebond`/`En-têtes`(paires)/`Corps`. Remplir watch=`lamp`, url, un header `Authorization=$ha`, body `{"state":"{{lamp}}"}` → **pas** d'avertissement JSON ; body `{bad` → avertissement « JSON invalide », pas de commit. Exclusion mutuelle des 3 tiroirs (sources/sinks/réglages).
6. **Export** : le JSON exporté est **schema-valide** (console « ✓ valid ») avec un switch, un button et un sink. Un afficheur `bind:"lamp"` + le switch `bind:"lamp"` cohérents.
7. **0 erreur console** en EN et en FR ; tous les libellés traduits (aucune clé brute).

Consigner les captures/constats dans `docs/_internal/designer-qa-report.md` si pertinent.

- [ ] **Step 4 : Mettre à jour le HANDOFF + la mémoire**

Écrire un nouvel « ÉTAT COURANT » en tête de `docs/_internal/HANDOFF.md` (Plan C livré : switch/button designer + panneau sinks ; parité ; QA navigateur ; RESTE = B2 firmware puis slider/arc/roller designer ; point ouvert `unbound_bind`). Mettre à jour `effecteurs-plan.md` (Plan C : switch/button + sinks **livré**, reste slider/arc/roller après B2).

- [ ] **Step 5 : (si demandé) PR**

Le push et l'ouverture de PR **uniquement sur demande explicite** de l'utilisateur (cf. CLAUDE.md). Branche suggérée : `feat/effecteurs-C-switch-button-sinks`.

---

## Self-Review (rempli)

**1. Couverture spec §5 :**
- « Producteurs effecteurs (registry/render/canvas/inspecteur/i18n) » → Tasks 1-3 (switch/button ; slider/arc/roller **hors périmètre**, différés). canvas = aucun changement (générique). ✅
- « Le designer simule l'interaction sans réseau » → aperçu statique (switch off, button au repos) ; l'interaction réelle est on-device. Le designer ne simule pas le toggle au clic (v1 : édition, pas simulation runtime) — **écart assumé** vs « un slider se règle dans le canvas » (concernait slider, différé). ✅ (à noter)
- « Panneau sinks dédié (name/watch/method/url/headers/$secret/debounce_ms/body) validé contre `$defs/sink` » → Tasks 4-5. ✅
- « Parité de rendu effecteur↔firmware » → tailles/texte/police alignées sur view.cpp ; chrome bouton approché (thème device) — noté. ✅

**2. Placeholders :** aucun « TODO/TBD » ; code complet à chaque étape ; le seul « adapter au nom du validateur » (Task 2 Step 1 schema.test) est explicite car le harnais AJV local doit être réutilisé tel quel.

**3. Cohérence des types :** `buildSwitch(comp, placement)` / `buildButton(comp, placement)` — mêmes signatures en render.js (Task 1), import (Task 2 registry), et `build:` du registre. `value` : registre kind `'value'` (Task 2) ↔ dispatch `kind === 'value'` (Task 3) ↔ `valueField` (Task 3). Mutations `addSink/removeSink/setSinkProp/setSinkHeaders/setSinkBody/uniqueSinkName` — mêmes noms en mutations.js (Task 4), tests (Task 4), import sinks.js (Task 5).
