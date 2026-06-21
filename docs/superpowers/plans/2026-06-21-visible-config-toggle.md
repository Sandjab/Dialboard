# Designer `visible` config-time + toggle device — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de déclarer un composant caché par défaut dans le layout (`visible:false`), le piloter par un œil cliquable dans le designer (grisé sur le canvas), et le cacher/afficher en direct sur le device depuis l'inspecteur.

**Architecture:** Étape 2 de la partition commandes/valeurs. La commande runtime `visible` existe déjà (étape 1, firmware). Ici : le firmware lit `visible` du layout (config-time), le schéma l'autorise sur les 9 types visuels, l'inspecteur expose un œil (en-tête, préfigure la future ligne de calque), le canvas grise le composant caché, et un bouton device pousse `visible` en direct (sans modifier le layout). `led_ring`/`sound` exclus (non visuels, `physical:true`).

**Tech Stack:** Firmware C++/ArduinoJson v7 (tests Unity `env:native`) ; designer JS modules ES (tests `node --test`, **sans DOM** → le rendu DOM est vérifié au navigateur) ; JSON Schema (ajv via `validate.js`).

**Spec:** `docs/superpowers/specs/2026-06-21-visible-config-toggle-design.md`

---

## File Structure

- `src/dashboard.cpp` — `dash_set_layout` lit `visible` du layout (1 ligne). *(modif)*
- `test/test_core/test_main.cpp` — test natif config-time. *(modif)*
- `schema/layout.schema.json` — `visible` ajouté aux 9 défs visuelles. *(modif)*
- `designer/tests/schema.test.js` — tests d'acceptation/rejet de `visible`. *(modif)*
- `designer/js/canvas.js` — grise le nœud `visible:false` dans `render()`. *(modif)*
- `designer/style.css` — `.w--hidden` (opacité + badge œil-barré) + styles `.insp-head`/`.insp-eye`. *(modif)*
- `designer/js/inspector.js` — œil dans l'en-tête + bouton « Cacher/Afficher sur le device ». *(modif)*
- `designer/tests/mutations.test.js` — caractérise le contrat `setComponentProp(visible)`. *(modif)*
- `designer/js/app.js` — callback `pushVisible` passé à `createInspector`. *(modif)*

Pas de nouveau fichier. `setComponentProp` (générique) et `pushValues` (device.js) sont réutilisés tels quels.

---

## Task 1: Firmware — lecture config-time de `visible`

**Files:**
- Modify: `src/dashboard.cpp` (dans `dash_set_layout`, la ligne `c.visible = true;`)
- Test: `test/test_core/test_main.cpp`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter cette fonction dans `test/test_core/test_main.cpp`, juste après `test_update_value_and_visible_together` :

```c
void test_layout_visible_config_time(void) {
    Dashboard d{}; char err[80];
    dash_set_layout(&d,
        "{\"components\":{"
          "\"a\":{\"type\":\"bar\",\"visible\":false},"
          "\"b\":{\"type\":\"bar\"},"
          "\"c\":{\"type\":\"bar\",\"visible\":true}},"
        "\"pages\":[{\"name\":\"p\",\"place\":["
          "{\"ref\":\"a\"},{\"ref\":\"b\"},{\"ref\":\"c\"}]}]}", err, sizeof(err));
    TEST_ASSERT_FALSE(d.components[dash_find(&d,"a")].visible);   // visible:false honoré (config-time)
    TEST_ASSERT_TRUE (d.components[dash_find(&d,"b")].visible);   // absent -> true
    TEST_ASSERT_TRUE (d.components[dash_find(&d,"c")].visible);   // visible:true explicite
}
```

Enregistrer dans `main()`, juste après `RUN_TEST(test_update_value_and_visible_together);` :

```c
    RUN_TEST(test_layout_visible_config_time);
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `pio test -e native -f test_core 2>&1 | grep -iE "visible_config|failed, .* succeeded"`
Expected: `test_layout_visible_config_time ... FAIL` (assert ligne `a` : attendu FALSE, obtenu TRUE — aujourd'hui `c.visible` est toujours `true`).

- [ ] **Step 3: Implémenter (1 ligne)**

Dans `src/dashboard.cpp`, remplacer :

```cpp
        c.visible     = true;            // memset l'a mis à 0 (caché) ; défaut affiché. Pilotable via /update (visible)
```

par :

```cpp
        c.visible     = o["visible"] | true;   // config-time : caché par défaut possible (visible:false). Aussi pilotable via /update.
```

- [ ] **Step 4: Lancer les tests, vérifier le vert**

Run: `pio test -e native 2>&1 | tail -1`
Expected: `108 test cases: 108 succeeded` (107 + 1).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.cpp test/test_core/test_main.cpp
git commit -m "firmware: lit visible du layout (config-time, caché par défaut possible)

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Task 2: Schéma — `visible` sur les 9 types visuels

**Files:**
- Modify: `schema/layout.schema.json` (les 9 défs `comp_*` visuelles)
- Test: `designer/tests/schema.test.js`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `designer/tests/schema.test.js` :

```js
test('schema : visible:false accepté sur un composant visuel (bar)', () => {
  const l = base();
  l.components.b = { type: 'bar', visible: false };
  l.pages[0].place.push({ ref: 'b', anchor: 'CENTER', width: 200, height: 16 });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : visible non booléen rejeté', () => {
  const l = base();
  l.components.b = { type: 'bar', visible: 'oui' };
  l.pages[0].place.push({ ref: 'b' });
  assert.equal(validate(l).valid, false);
});

test('schema : visible interdit sur sound (non visuel)', () => {
  const l = base();
  l.components.s = { type: 'sound' };                  // contrôle : sound seul est valide
  assert.equal(validate(l).valid, true, JSON.stringify(validate(l).errors));
  l.components.s.visible = false;                      // avec visible : rejeté (additionalProperties:false)
  assert.equal(validate(l).valid, false);
});

test('schema : visible interdit sur led_ring (non visuel)', () => {
  const l = base();
  l.components.lr = { type: 'led_ring' };
  assert.equal(validate(l).valid, true, JSON.stringify(validate(l).errors));
  l.components.lr.visible = false;
  assert.equal(validate(l).valid, false);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd designer && node --test 2>&1 | grep -E "visible|# (pass|fail)"`
Expected: `visible:false accepté sur un composant visuel (bar)` **échoue** (bar rejette aujourd'hui toute prop `visible` via `additionalProperties:false`). Les 3 autres passent déjà (gardes de non-régression).

- [ ] **Step 3: Implémenter — ajouter `visible` aux 9 défs visuelles**

Dans `schema/layout.schema.json`, ajouter **cette propriété identique** dans l'objet `properties` de chacune des 9 défs : `comp_label`, `comp_readout`, `comp_bar`, `comp_ring`, `comp_chart`, `comp_meter`, `comp_image`, `comp_image_anim`, `comp_led` (PAS `comp_sound`, PAS `comp_led_ring`) :

```json
        "visible": { "type": "boolean", "description": "Affiche le composant (defaut true). false = cache (LV_OBJ_FLAG_HIDDEN au rendu). Revelable a chaud via /update {\"<id>\":{\"visible\":true}}." },
```

Exemple pour `comp_label` (insérer après la ligne `"type": { "const": "label" },`) :

```json
      "properties": {
        "type": { "const": "label" },
        "visible": { "type": "boolean", "description": "Affiche le composant (defaut true). false = cache (LV_OBJ_FLAG_HIDDEN au rendu). Revelable a chaud via /update {\"<id>\":{\"visible\":true}}." },
        "bind": { ... },
```

- [ ] **Step 4: Lancer, vérifier le vert**

Run: `cd designer && node --test 2>&1 | grep -E "# (tests|pass|fail)"`
Expected: `# fail 0`, `# pass 217` (213 + 4).

- [ ] **Step 5: Commit**

```bash
git add schema/layout.schema.json designer/tests/schema.test.js
git commit -m "schema: visible (boolean) sur les 9 types visuels (pas sound/led_ring)

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Task 3: Canvas — grisé du composant caché

**Files:**
- Modify: `designer/js/canvas.js` (dans `render()`, après `buildNode`)
- Modify: `designer/style.css`

Pas de test unitaire (DOM, harness sans DOM) → vérification navigateur.

- [ ] **Step 1: Griser le nœud dans `render()`**

Dans `designer/js/canvas.js`, repérer (dans `render()`) :

```js
      const node = buildNode(pl, rcomp);
      node.dataset.pi = i;
```

et insérer la bascule juste après `buildNode` :

```js
      const node = buildNode(pl, rcomp);
      node.classList.toggle('w--hidden', rcomp.visible === false);   // config visible:false -> grisé + badge
      node.dataset.pi = i;
```

- [ ] **Step 2: CSS — opacité + badge œil-barré**

Dans `designer/style.css`, ajouter après la règle `.w.outside { ... }` :

```css
/* visible:false (config) — composant grisé mais toujours sélectionnable/déplaçable, + badge œil-barré. */
.w--hidden { opacity: .38; }
.w--hidden::after {
  content: ''; position: absolute; top: -7px; right: -7px;
  width: 18px; height: 18px; border-radius: 50%; pointer-events: none;
  background: #0c0c10 center/12px no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23EF4444' stroke-width='2.5'%3E%3Cpath d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3Cline x1='3' y1='3' x2='21' y2='21'/%3E%3C/svg%3E");
}
```

- [ ] **Step 3: Vérification navigateur**

Servir le designer en local (port ≠ 8000, réservé), p. ex. :

Run: `cd designer && python3 -m http.server 8765 --bind 127.0.0.1` (puis ouvrir `http://127.0.0.1:8765/`)

Dans la zone JSON du designer, coller un layout avec un composant `visible:false`, cliquer **Appliquer** :

```json
{"components":{"b":{"type":"bar","label":"Test","visible":false},"k":{"type":"bar","label":"Ok"}},"pages":[{"name":"P","place":[{"ref":"b","anchor":"TOP_MID","dy":40},{"ref":"k","anchor":"BOTTOM_MID","dy":-40}]}]}
```

Expected : la barre `b` apparaît **grisée (~38 %)** avec un **badge œil-barré** en coin ; la barre `k` est normale. Cliquer sur `b` la **sélectionne** quand même (toujours interactive). **Arrêter le serveur** ensuite (`Ctrl-C`).

- [ ] **Step 4: Commit**

```bash
git add designer/js/canvas.js designer/style.css
git commit -m "designer: grise sur le canvas un composant visible:false (+ badge œil-barré)

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Task 4: Inspecteur — œil dans l'en-tête

**Files:**
- Modify: `designer/js/inspector.js` (en-tête `head` dans `render()`)
- Modify: `designer/style.css`
- Test: `designer/tests/mutations.test.js` (caractérise le contrat modèle)

- [ ] **Step 1: Tests de caractérisation du contrat modèle**

L'œil s'appuie sur `setComponentProp` (générique). Ajouter à la fin de `designer/tests/mutations.test.js` (verrouille que `false` n'est pas supprimé et que `true` est écrit explicitement) :

```js
test('setComponentProp : visible=false écrit la clé (pas supprimée)', () => {
  const s = { components: { b: { type: 'bar' } }, pages: [] };
  setComponentProp(s, 'b', 'visible', false);
  assert.equal(s.components.b.visible, false);
});

test('setComponentProp : visible=true écrit explicitement true (ré-affichage)', () => {
  const s = { components: { b: { type: 'bar', visible: false } }, pages: [] };
  setComponentProp(s, 'b', 'visible', true);
  assert.equal(s.components.b.visible, true);
});
```

- [ ] **Step 2: Lancer ces tests, vérifier le vert immédiat**

Run: `cd designer && node --test 2>&1 | grep -E "visible=|# fail"`
Expected: les 2 PASSENT immédiatement (caractérisation du comportement générique existant — `false`/`true` ne sont pas dans `'' | null | undefined`, donc écrits). `# fail 0`.

> Note TDD : ces tests caractérisent le contrat existant dont dépend l'œil (pas de red — le code modèle existe déjà). Le rendu DOM de l'œil est vérifié au navigateur (Step 5).

- [ ] **Step 3: Œil dans l'inspecteur (icônes `<img>` data-URI, pas d'innerHTML)**

Dans `designer/js/inspector.js`, ajouter au niveau module (près des autres constantes en haut du fichier) :

```js
// Œil de visibilité : icône SVG en data-URI (img), couleur baked-in (clair = visible, rouge = caché).
const EYE_OPEN_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23E5E7EB' stroke-width='2'%3E%3Cpath d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3C/svg%3E";
const EYE_OFF_URI  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23EF4444' stroke-width='2'%3E%3Cpath d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3Cline x1='3' y1='3' x2='21' y2='21'/%3E%3C/svg%3E";
```

Dans `render()`, remplacer le bloc d'en-tête :

```js
    const head = document.createElement('div'); head.className = 'insp-head';
    head.textContent = `${c.type} · ${sel.ref}`;
    body.appendChild(head);
```

par :

```js
    const head = document.createElement('div'); head.className = 'insp-head';
    const title = document.createElement('span'); title.textContent = `${c.type} · ${sel.ref}`;
    head.appendChild(title);
    if (!COMPONENTS[c.type].physical) {                 // led_ring/sound : pas de visuel à cacher
      const visible = c.visible !== false;
      const eye = document.createElement('button');
      eye.className = 'insp-eye';
      eye.title = visible ? 'Visible — cliquer pour cacher' : 'Caché — cliquer pour afficher';
      const icon = document.createElement('img');
      icon.src = visible ? EYE_OPEN_URI : EYE_OFF_URI;
      icon.width = 15; icon.height = 15; icon.alt = visible ? 'visible' : 'caché';
      eye.appendChild(icon);
      const ref = sel.ref;                              // figée au rendu (cf. invariant inspecteur/canvas)
      eye.addEventListener('click', () => {
        const next = !(c.visible !== false);            // nouvel état après bascule
        eye.blur();                                     // libère le focus -> render() peut reconstruire (garde-focus)
        model.commit(s => setComponentProp(s, ref, 'visible', next));
      });
      head.appendChild(eye);
    }
    body.appendChild(head);
```

- [ ] **Step 4: CSS de l'en-tête + œil**

Dans `designer/style.css`, ajouter (ou étendre `.insp-head` si la règle existe) :

```css
.insp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.insp-eye { background: none; border: 0; padding: 2px; line-height: 0; cursor: pointer; border-radius: 4px; opacity: .85; }
.insp-eye:hover { opacity: 1; background: #16161c; }
```

- [ ] **Step 5: Vérification navigateur**

Servir le designer (port ≠ 8000), sélectionner un composant : un **œil** apparaît dans l'en-tête de l'inspecteur. Cliquer → l'œil devient **rouge barré**, le composant **grise** sur le canvas (Task 3), et le JSON exporté contient `"visible": false`. Re-cliquer → œil clair, composant normal, `"visible": true`. Vérifier qu'aucun œil n'apparaît pour un `led_ring`/`sound`. **Arrêter le serveur** ensuite.

- [ ] **Step 6: Commit**

```bash
git add designer/js/inspector.js designer/style.css designer/tests/mutations.test.js
git commit -m "designer: œil visible dans l'en-tête de l'inspecteur (pilote visible config)

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Task 5: Bouton « Cacher/Afficher sur le device »

**Files:**
- Modify: `designer/js/inspector.js` (bouton device dans `render()` + option `pushVisible`)
- Modify: `designer/js/app.js` (callback `pushVisible` passé à `createInspector`)
- Modify: `designer/style.css`

Pas de test unitaire (push réseau) → vérification navigateur + device (Task 6).

- [ ] **Step 1: Option `pushVisible` dans l'inspecteur**

Dans `designer/js/inspector.js`, ajouter `pushVisible` à la déstructuration des options de `createInspector` :

```js
export function createInspector(root, model, { rerenderCanvas, clearSelection, getActivePage = () => 0, previewProp, clearPreview, pushVisible } = {}) {
```

Ajouter un Set au niveau module (suit l'état device poussé, par ref) :

```js
const deviceHidden = new Set();   // refs poussées cachées sur le device (état de bascule du bouton)
```

Dans `render()`, juste avant la création du bouton `del` (`const del = ...`), insérer le bouton device pour les composants visuels :

```js
    if (!COMPONENTS[c.type].physical && pushVisible) {
      const ref = sel.ref;
      const dev = document.createElement('button');
      dev.className = 'insp-devvis';
      dev.textContent = deviceHidden.has(ref) ? 'Afficher sur le device' : 'Cacher sur le device';
      dev.addEventListener('click', async () => {
        const nextVisible = deviceHidden.has(ref);      // si caché -> on affiche ; sinon on cache
        const ok = await pushVisible(ref, nextVisible);
        if (ok) {
          if (nextVisible) deviceHidden.delete(ref); else deviceHidden.add(ref);
          dev.textContent = deviceHidden.has(ref) ? 'Afficher sur le device' : 'Cacher sur le device';
        }
      });
      body.appendChild(dev);
    }
```

- [ ] **Step 2: Callback `pushVisible` dans `app.js`**

Dans `designer/js/app.js`, ajouter `pushVisible` à l'objet d'options de `createInspector` (à `app.js:66`) :

```js
  inspector = createInspector($('inspector'), model, {
    rerenderCanvas: canvas.render,
    clearSelection: () => canvas.selectPlacement(null),
    getActivePage: canvas.getActivePage,
    previewProp: canvas.previewProp,
    clearPreview: canvas.clearPreview,
    pushVisible: async (id, visible) => {
      if (!$('base').value) { setStatus('URL device ?', 'err'); return false; }
      try {
        await pushValues($('base').value, { [id]: { visible } });
        setStatus(visible ? 'Affiché sur le device' : 'Caché sur le device', 'ok');
        return true;
      } catch (e) { setStatus('Échec : ' + e.message, 'err'); return false; }
    }
  });
```

- [ ] **Step 3: CSS du bouton**

Dans `designer/style.css`, ajouter (look discret, distinct du `Supprimer` rouge) :

```css
.insp-devvis { margin-top: 8px; width: 100%; padding: 6px; background: #16161c; color: #E5E7EB; border: 1px solid #2a2a33; border-radius: 6px; cursor: pointer; }
.insp-devvis:hover { border-color: var(--accent); }
```

- [ ] **Step 4: Lancer la suite designer (non-régression)**

Run: `cd designer && node --test 2>&1 | grep -E "# (tests|pass|fail)"`
Expected: `# fail 0` (les modifs sont DOM/réseau, aucun test cassé ; `# pass 219` = 213 + 4 schéma + 2 mutations).

- [ ] **Step 5: Vérification navigateur (device joignable)**

Servir le designer, renseigner l'URL device (`http://192.168.1.35`), sélectionner un composant visuel : le bouton **« Cacher sur le device »** apparaît. Cliquer → toast vert « Caché sur le device », le composant disparaît à l'écran du device ; le bouton devient **« Afficher sur le device »**. Re-cliquer → réapparaît. Sans URL device : toast rouge « URL device ? ». **Arrêter le serveur** ensuite.

- [ ] **Step 6: Commit**

```bash
git add designer/js/inspector.js designer/js/app.js designer/style.css
git commit -m "designer: bouton Cacher/Afficher sur le device (push visible live, sans toucher au layout)

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```

---

## Task 6: Vérification on-device end-to-end + mise à jour HANDOFF

**Files:**
- Modify: `docs/_internal/HANDOFF.md`, `docs/superpowers/specs/2026-06-21-visible-config-toggle-design.md` (statut)

- [ ] **Step 1: Flasher le firmware (config-time visible)**

Run: `pio run -d /Users/jean-paulgavini/Documents/Dev/Dialboard -e esp32s3 -t upload 2>&1 | tail -3`
Expected: `SUCCESS`.

> ⚠️ `uploadfs` (designer embarqué) **efface les assets device** (cf. HANDOFF). Ici on flashe **seulement le firmware** (`-t upload`) → les assets restent. Le designer reste édité **en local** pour cette vérif (pas besoin d'`uploadfs`).

- [ ] **Step 2: Attendre le boot + sauvegarder le layout courant**

Run: `mkdir -p /tmp/dvis && curl -s --retry 15 --retry-delay 2 --retry-connrefused --max-time 60 http://192.168.1.35/status && curl -s http://192.168.1.35/layout -o /tmp/dvis/backup.json && echo OK`
Expected: JSON `/status` puis `OK` (backup pour restauration).

- [ ] **Step 3: Pousser un layout de test avec `visible:false`, capturer**

Run:
```bash
curl -s -X POST http://192.168.1.35/layout -H 'Content-Type: application/json' \
  -d '{"components":{"hid":{"type":"readout","unit":"%","visible":false},"vis":{"type":"label","text":"VISIBLE"}},"pages":[{"name":"P","place":[{"ref":"hid","anchor":"TOP_MID","dy":60},{"ref":"vis","anchor":"CENTER"}]}]}'
curl -s --max-time 15 http://192.168.1.35/screenshot -o /tmp/dvis/hidden.bmp && sips -s format png /tmp/dvis/hidden.bmp --out /tmp/dvis/hidden.png >/dev/null
```
Expected: `{"ok":true}` ; `hidden.png` montre **VISIBLE** mais **pas** le readout `hid` (caché dès le build = config-time prouvé).

- [ ] **Step 4: Révéler à chaud via /update, capturer**

Run:
```bash
curl -s -X POST http://192.168.1.35/update -H 'Content-Type: application/json' -d '{"hid":{"value":42,"visible":true}}'
curl -s --max-time 15 http://192.168.1.35/screenshot -o /tmp/dvis/shown.bmp && sips -s format png /tmp/dvis/shown.bmp --out /tmp/dvis/shown.png >/dev/null
```
Expected: `shown.png` montre maintenant `42 %` (révélé runtime malgré `visible:false` config).

- [ ] **Step 5: Restaurer le layout utilisateur**

Run: `curl -s -X POST http://192.168.1.35/layout -H 'Content-Type: application/json' --data-binary @/tmp/dvis/backup.json && echo " restored"`
Expected: `{"ok":true} restored`. Envoyer `hidden.png` + `shown.png` à l'utilisateur (juge visuel).

- [ ] **Step 6: Mettre à jour le statut HANDOFF + spec, commit**

Marquer l'étape 2 FAITE dans `docs/_internal/HANDOFF.md` (point 3 « Prochaines étapes ») et dans la spec, avec les compteurs de tests finaux (`pio test -e native` et `cd designer && node --test`).

```bash
git add docs/superpowers/specs/2026-06-21-visible-config-toggle-design.md
git commit -m "docs: étape 2 visible config-time + toggle device — faite et vérifiée on-device

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP"
```
*(`docs/_internal/HANDOFF.md` est gitignoré : mise à jour locale seulement, pas dans le commit.)*

---

## Notes d'exécution

- **Push** : commits **locaux** ; `git push` seulement sur demande explicite de l'utilisateur (convention repo).
- **Port de test** : ne **jamais** utiliser le port 8000 (réservé) ; arrêter tout serveur de test lancé.
- **Ordre** : Tasks 1-2 (TDD, indépendantes) → 3-5 (DOM, vérif navigateur, dépendances croissantes) → 6 (e2e device). Chaque task committe sa tranche.
- **Hors scope** (rappel) : panneau de calques, décision onglets, `led_ring`≡`mode:off`, valeur→contexte (étape 3).
