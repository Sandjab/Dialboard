# Onglet « Device » — dump du contexte (debug source/sink) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au designer un onglet console « Device » qui, sur un bouton Pull (ou un auto-refresh optionnel), affiche le blackboard (`/context`) et la télémétrie source/sink (`/status`) du device, pour débugger les mécanismes de sources et de sinks.

**Architecture:** 100 % designer, aucun changement firmware (le device expose déjà `GET /context` et `GET /status`). Un formateur **pur** (`device.js`, testé node) transforme le dump en lignes ; `console.js` (DOM, QA navigateur) ajoute l'onglet, le pilote via une case de réglage (miroir des journaux), et gère le cycle de vie de l'auto-refresh. `console.js` reste agnostique du transport : `app.js` lui injecte `pullDeviceContext`.

**Tech Stack:** JS modules ES (designer), `node --test` (Unity côté firmware non concerné), tests DOM = QA navigateur (convention repo : `Câblage DOM, vérifié navigateur (pas de test node)`).

**Spec:** `docs/superpowers/specs/2026-07-02-designer-device-context-dump-design.md`

**Convention de test (Rule 11, à respecter) :** logique **pure** → test node (`designer/tests/*.test.js`) ; **DOM** (`settings.js`/`console.js`/`app.js`) → **QA navigateur** finale, pas de test node (cf. en-têtes de `console.js`/`settings.js`). Les tâches DOM n'ont donc pas d'étape « test node » ; leur vérification est la Tâche 9.

**Raffinement de la spec (âge) :** `updated_at`/`fired_at` sont des `millis()` **device**. L'âge se calcule contre l'uptime device (`/status.uptime_s × 1000`), **pas** l'heure navigateur. Encodé en Tâche 2 et transporté en Tâche 8 (`pullDeviceContext` renvoie `uptime_s`).

---

## Fichiers touchés

| Fichier | Rôle | Test |
|---|---|---|
| `designer/i18n/en.js` + `designer/i18n/fr.json` | Clés de l'onglet/panneau/réglage (parité EN=FR) | `tests/i18n.test.js` (parité) |
| `designer/js/device.js` | `formatDeviceDump` (pur) + `getContext` (transport) | `tests/device.test.js` (pur seulement) |
| `designer/js/settings.js` | Clé `deviceContext` (défaut+normalize) + case du tiroir | `tests/settings.test.js` (pur) + QA (DOM) |
| `designer/js/console.js` | Onglet `deviceCtx` : panneau, visibilité, Pull, rendu, Copier, auto-refresh | QA navigateur |
| `designer/js/app.js` | Injection de `pullDeviceContext` + import `getContext` | QA navigateur |

---

## Task 1 : Clés i18n (EN + FR, parité stricte)

**Files:**
- Modify: `designer/i18n/en.js` (autour des lignes 372 et 398)
- Modify: `designer/i18n/fr.json` (autour des lignes 354 et 377)
- Test: `designer/tests/i18n.test.js` (parité EN=FR, existant)

- [ ] **Step 1 : Ajouter les clés EN dans `en.js`**

Après `'console.tab.net': 'Network Log',` (ligne ~372), insérer :

```js
  'console.tab.device_context': 'Device',
  'console.devctx.pull': 'Pull',
  'console.devctx.auto': 'Auto (2s)',
  'console.devctx.vars': 'Variables',
  'console.devctx.sources': 'Sources',
  'console.devctx.sinks': 'Sinks',
  'console.devctx.empty': 'No pull yet — click Pull.',
  'console.devctx.error': 'Pull failed',
```

Après `'settings.log_net': 'Network log (device)',` (ligne ~398), insérer :

```js
  'settings.device_context': 'Device context tab',
```

- [ ] **Step 2 : Ajouter les clés FR dans `fr.json`**

Après `"console.tab.net": "Log réseau",` (ligne ~354), insérer :

```json
  "console.tab.device_context": "Device",
  "console.devctx.pull": "Pull",
  "console.devctx.auto": "Auto (2 s)",
  "console.devctx.vars": "Variables",
  "console.devctx.sources": "Sources",
  "console.devctx.sinks": "Sinks",
  "console.devctx.empty": "Aucun pull — clique Pull.",
  "console.devctx.error": "Échec du pull",
```

Après `"settings.log_net": "Journal réseau (device)",` (ligne ~377), insérer :

```json
  "settings.device_context": "Onglet contexte device",
```

- [ ] **Step 3 : Vérifier la parité (comptage réel — `i18n.test.js` ne teste que des helpers purs, pas les packs)**

Run: `cd designer && node --test tests/i18n.test.js && node -e "const e=Object.keys(require('./i18n/en.js').default||{}).length; const f=Object.keys(require('./i18n/fr.json')).length; console.log('EN',e,'FR',f); process.exit(e===f?0:1)"`
> Si `en.js` est un module ES sans `require`, comparer à la main : `grep -c \"'console.devctx\\|settings.device_context\\|console.tab.device_context'\" i18n/en.js` doit égaler le compte FR. L'essentiel : les **9** clés sont ajoutées des deux côtés, à l'identique.
Expected: PASS + `EN` == `FR`.

- [ ] **Step 4 : Commit**

```bash
git add designer/i18n/en.js designer/i18n/fr.json
git commit -m "i18n(designer): clés onglet Device (dump contexte)"
```

---

## Task 2 : Formateur pur `formatDeviceDump` (device.js)

**Files:**
- Modify: `designer/js/device.js` (ajout d'un export, à côté de `formatDeviceStatus`)
- Test: `designer/tests/device.test.js`

- [ ] **Step 1 : Écrire les tests (échouent)**

Ajouter à la fin de `designer/tests/device.test.js` :

```js
import { formatDeviceDump } from '../js/device.js';

test('formatDeviceDump : vars objet → lignes triées par nom (intent : lecture stable du blackboard)', () => {
  const r = formatDeviceDump({ vars: { vol: 5, bell: 'on' }, uptime_s: 0 });
  assert.deepEqual(r.vars, [{ name: 'bell', value: 'on' }, { name: 'vol', value: 5 }]);
});

test('formatDeviceDump : vars non-objet → tableau vide (intent : import/réponse malformé toléré, cf. Array.isArray sources/sinks)', () => {
  assert.deepEqual(formatDeviceDump({ vars: [1, 2] }).vars, []);
  assert.deepEqual(formatDeviceDump({ vars: null }).vars, []);
  assert.deepEqual(formatDeviceDump({}).vars, []);
});

test('formatDeviceDump : âge source calculé contre uptime device (intent : updated_at est un millis device, pas navigateur)', () => {
  const r = formatDeviceDump({ uptime_s: 100, sources: [{ name: 's', last_status: 200, err_count: 0, updated_at: 95000 }] });
  assert.deepEqual(r.sources, [{ name: 's', status: 200, errors: 0, age: 5 }]);   // (100000 - 95000)/1000
});

test('formatDeviceDump : âge borné à 0 si timestamp > uptime (intent : troncature uptime_s ne donne jamais un âge négatif)', () => {
  const r = formatDeviceDump({ uptime_s: 10, sinks: [{ name: 'k', last_status: 0, err_count: 1, fired_at: 12000 }] });
  assert.equal(r.sinks[0].age, 0);
});

test('formatDeviceDump : timestamp absent → âge null (intent : distinguer « jamais » de « il y a 0 s »)', () => {
  const r = formatDeviceDump({ uptime_s: 100, sources: [{ name: 's', last_status: 200, err_count: 0 }] });
  assert.equal(r.sources[0].age, null);
});

test('formatDeviceDump : sinks lit fired_at ; err_count manquant → 0 (intent : télémétrie sink)', () => {
  const r = formatDeviceDump({ uptime_s: 50, sinks: [{ name: 'k', last_status: 204, fired_at: 40000 }] });
  assert.deepEqual(r.sinks, [{ name: 'k', status: 204, errors: 0, age: 10 }]);
});

test('formatDeviceDump : sources/sinks non-tableau → vides (intent : firmware ancien / réponse partielle)', () => {
  const r = formatDeviceDump({ sources: undefined, sinks: 'x' });
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.sinks, []);
});
```

- [ ] **Step 2 : Lancer les tests (échec attendu)**

Run: `cd designer && node --test tests/device.test.js`
Expected: FAIL (`formatDeviceDump is not a function` / import non résolu).

- [ ] **Step 3 : Implémenter `formatDeviceDump`**

Dans `designer/js/device.js`, sous `formatDeviceStatus` (fin de fichier), ajouter :

```js
// Présentation de {vars, sources, sinks, uptime_s} (pull de GET /context + GET /status) pour l'onglet
// Device — séparée du transport → testable node. L'âge se calcule contre l'uptime DEVICE (updated_at/
// fired_at sont des millis() device, pas navigateur). Tolère vars/sources/sinks non conformes (Array.isArray).
export function formatDeviceDump(dump) {
  const d = (dump && typeof dump === 'object') ? dump : {};
  const nowMs = (Number(d.uptime_s) || 0) * 1000;
  const age = (ts) => (Number.isFinite(ts) && ts > 0) ? Math.max(0, Math.round((nowMs - ts) / 1000)) : null;
  const vars = (d.vars && typeof d.vars === 'object' && !Array.isArray(d.vars))
    ? Object.keys(d.vars).sort().map(name => ({ name, value: d.vars[name] }))
    : [];
  const tele = (arr, tsKey) => (Array.isArray(arr) ? arr : []).map(o => ({
    name: o.name, status: o.last_status, errors: o.err_count || 0, age: age(o[tsKey]),
  }));
  return { vars, sources: tele(d.sources, 'updated_at'), sinks: tele(d.sinks, 'fired_at') };
}
```

- [ ] **Step 4 : Lancer les tests (succès attendu)**

Run: `cd designer && node --test tests/device.test.js`
Expected: PASS (tous les `formatDeviceDump : …`).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/device.js designer/tests/device.test.js
git commit -m "feat(designer): formatDeviceDump — présentation pure du dump device"
```

---

## Task 3 : Transport `getContext` (device.js)

**Files:**
- Modify: `designer/js/device.js` (ajout à côté de `loadLayout`/`getStatus`)

Convention : transport = **non testé node** (cf. le reste de `device.js`). Pas d'étape test node ; couvert en QA (Tâche 9).

- [ ] **Step 1 : Implémenter `getContext`**

Dans `designer/js/device.js`, après `getStatus` (ligne ~38), ajouter :

```js
// GET /context : dump du blackboard { nom: valeur, … }. vars = CSV optionnel → filtre ?vars=a,b,c.
export async function getContext(base, vars) {
  const q = vars ? '?vars=' + encodeURIComponent(vars) : '';
  const r = await devFetch(base, '/context' + q);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
```

- [ ] **Step 2 : Sanity — la suite complète reste verte**

Run: `cd designer && node --test`
Expected: PASS (aucune régression ; `getContext` non couvert node par convention).

- [ ] **Step 3 : Commit**

```bash
git add designer/js/device.js
git commit -m "feat(designer): getContext — GET /context (filtre ?vars=)"
```

---

## Task 4 : Réglage `deviceContext` (settings.js — pur)

**Files:**
- Modify: `designer/js/settings.js` (`defaultSettings`, `normalizeSettings`)
- Test: `designer/tests/settings.test.js`

- [ ] **Step 1 : Adapter les tests existants + en ajouter (échouent)**

Dans `designer/tests/settings.test.js`, le test `defaultSettings: valeurs de référence` (ligne ~5) fait un `deepEqual` strict → ajouter la clé. Remplacer la ligne :

```js
    logActivity: true, logJs: false, logNet: false,
```
par :
```js
    logActivity: true, logJs: false, logNet: false, deviceContext: false,
```

Puis ajouter à la fin du fichier :

```js
test('settings: deviceContext défaut OFF (intent : onglet debug caché tant qu\'on n\'en a pas besoin)', () => {
  assert.equal(defaultSettings().deviceContext, false);
  assert.equal(normalizeSettings({}).deviceContext, false);
});

test('settings: deviceContext booléen respecté ; non-booléen → défaut (intent : pas d\'état tiers)', () => {
  assert.equal(normalizeSettings({ deviceContext: true }).deviceContext, true);
  assert.equal(normalizeSettings({ deviceContext: 'x' }).deviceContext, false);
});
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `cd designer && node --test tests/settings.test.js`
Expected: FAIL (`deviceContext` absent du défaut → `deepEqual` échoue, `undefined !== false`).

- [ ] **Step 3 : Implémenter**

Dans `designer/js/settings.js`, `defaultSettings()` (ligne ~14), remplacer :

```js
           logActivity: true, logJs: false, logNet: false };
```
par :
```js
           logActivity: true, logJs: false, logNet: false, deviceContext: false };
```

Dans `normalizeSettings()`, après la ligne `logNet: …` (ligne ~30), ajouter :

```js
    deviceContext: typeof r.deviceContext === 'boolean' ? r.deviceContext : d.deviceContext,
```

- [ ] **Step 4 : Lancer (succès attendu)**

Run: `cd designer && node --test tests/settings.test.js`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/settings.js designer/tests/settings.test.js
git commit -m "feat(designer): réglage deviceContext (visibilité onglet Device)"
```

---

## Task 5 : Case du tiroir Settings (settings.js — DOM)

**Files:**
- Modify: `designer/js/settings.js` (`createSettings().build()`)

DOM → pas de test node ; vérifié en Tâche 9.

- [ ] **Step 1 : Ajouter la case dans `build()`**

Dans `designer/js/settings.js`, après le bloc du journal réseau (la ligne `pane.appendChild(netRow);`, ~148), ajouter :

```js
    // Onglet « Device » (dump contexte, debug source/sink) — montre/masque l'onglet console
    const devCtxRow = settingRow(t('settings.device_context'));
    devCtxRow.querySelector('.set-line').appendChild(checkbox(s.deviceContext, v => setSettings({ deviceContext: v })));
    pane.appendChild(devCtxRow);
```

- [ ] **Step 2 : Sanity build (pas de test node ; on lance la suite pour non-régression)**

Run: `cd designer && node --test`
Expected: PASS (inchangé — DOM non couvert).

- [ ] **Step 3 : Commit**

```bash
git add designer/js/settings.js
git commit -m "feat(designer): case de réglage — onglet Device"
```

---

## Task 6 : Onglet + panneau `deviceCtx` — Pull, rendu, Copier (console.js — DOM)

**Files:**
- Modify: `designer/js/console.js`
- Modify: `designer/style.css` (styles du panneau, optionnel — réutiliser `.console-log*` autant que possible)

DOM → QA en Tâche 9. `console.js` reçoit une nouvelle dépendance `pullDeviceContext` (branchée en Tâche 8).

- [ ] **Step 1 : Signature + import du formateur**

Ligne ~9, remplacer :
```js
export function createConsole(root, model, { validate, logs, getSettings }) {
```
par :
```js
export function createConsole(root, model, { validate, logs, getSettings, pullDeviceContext }) {
```
En tête de fichier (après `import { t } from './i18n.js';`), ajouter :
```js
import { formatDeviceDump } from './device.js';
```

- [ ] **Step 2 : Onglet dans le bandeau**

Dans l'objet `tabBtns` (ligne ~22), ajouter l'entrée :
```js
    deviceCtx: mkTab('deviceCtx', t('console.tab.device_context')),
```
Dans `head.append(...)` (ligne ~32), insérer `tabBtns.deviceCtx` avant `spacer` :
```js
  head.append(tabBtns.problems, tabBtns.source, tabBtns.activity, tabBtns.js, tabBtns.net, tabBtns.deviceCtx, spacer, toggle);
```

- [ ] **Step 3 : Panneau (barre d'outils + 3 sections)**

Après la construction des `logPanels` (ligne ~55), avant `body.append(...)`, ajouter :

```js
  // --- Panneau Device : [Pull] [☐ Auto] [Copier] + 3 sections (Vars / Sources / Sinks) ---
  const devCtx = document.createElement('div'); devCtx.className = 'console-devctx';
  const devBar = document.createElement('div'); devBar.className = 'console-devbar';
  const pullBtn = document.createElement('button'); pullBtn.type = 'button'; pullBtn.className = 'console-copy'; pullBtn.textContent = t('console.devctx.pull');
  const autoLabel = document.createElement('label'); autoLabel.className = 'console-devauto';
  const autoChk = document.createElement('input'); autoChk.type = 'checkbox';
  autoLabel.append(autoChk, document.createTextNode(' ' + t('console.devctx.auto')));
  const devCopy = document.createElement('button'); devCopy.type = 'button'; devCopy.className = 'console-copy'; devCopy.textContent = t('console.copy');
  devBar.append(pullBtn, autoLabel, devCopy);
  const devOut = document.createElement('div'); devOut.className = 'console-devout';
  devCtx.append(devBar, devOut);
```

Modifier `body.append(...)` (ligne ~56) pour inclure `devCtx` :
```js
  body.append(problems, source, logPanels.activity.wrap, logPanels.js.wrap, logPanels.net.wrap, devCtx);
```

Dans `panelByTab` (ligne ~59), ajouter :
```js
    deviceCtx: devCtx,
```

- [ ] **Step 4 : Visibilité de l'onglet (miroir des journaux)**

Remplacer `logVisible` (lignes ~65-68) par une version qui inclut l'onglet Device :

```js
  // Quels onglets optionnels sont visibles selon les settings (case décochée → onglet masqué).
  const tabVisible = () => {
    const s = (getSettings && getSettings()) || {};
    return { activity: !!s.logActivity, js: !!s.logJs, net: !!s.logNet, deviceCtx: !!s.deviceContext };
  };
```

Dans `syncView` (lignes ~70-80), remplacer `const vis = logVisible();` par `const vis = tabVisible();` et ajouter la ligne de masquage :
```js
    tabBtns.deviceCtx.hidden = !vis.deviceCtx;
```

Dans `refreshTabs` (lignes ~84-88), remplacer `const vis = logVisible();` par `const vis = tabVisible();`, et étendre la retombée pour couvrir `deviceCtx` :
```js
  const refreshTabs = () => {
    const vis = tabVisible();
    if ((tab in LOG_TABS && !vis[tab]) || (tab === 'deviceCtx' && !vis.deviceCtx)) tab = 'problems';
    syncAuto();   // défini en Tâche 7
    syncView();
  };
```
> Note : `syncAuto()` est ajouté en Tâche 7. Si la Tâche 7 n'est pas encore faite, définir un stub `const syncAuto = () => {};` en tête pour garder le fichier fonctionnel — la Tâche 7 le remplace.

- [ ] **Step 5 : Rendu + Pull + Copier**

Après `renderSource` (ligne ~105), ajouter l'état + le rendu :

```js
  let lastDump = null;   // dernier pull { vars, sources, sinks, uptime_s } (pour Copier)

  const renderDevCtx = (dump, errMsg) => {
    devOut.replaceChildren();
    if (errMsg) {
      const e = document.createElement('div'); e.className = 'console-err'; e.textContent = '✗ ' + t('console.devctx.error') + ' — ' + errMsg;
      devOut.append(e); return;
    }
    if (!dump) {
      const empty = document.createElement('div'); empty.className = 'console-empty'; empty.textContent = t('console.devctx.empty');
      devOut.append(empty); return;
    }
    const f = formatDeviceDump(dump);
    const section = (titleKey, lines) => {
      const h = document.createElement('div'); h.className = 'console-devsec'; h.textContent = t(titleKey);
      devOut.append(h);
      if (!lines.length) { const em = document.createElement('div'); em.className = 'console-empty'; em.textContent = t('console.no_entries'); devOut.append(em); return; }
      for (const el of lines) devOut.append(el);
    };
    // Vars : nom = valeur
    section('console.devctx.vars', f.vars.map(v => {
      const line = document.createElement('div'); line.className = 'console-logline';
      const n = document.createElement('span'); n.className = 'console-logtime'; n.textContent = v.name;
      const val = document.createElement('span'); val.textContent = String(v.value);
      line.append(n, val); return line;
    }));
    // Sources / Sinks : nom · statut · errN · âge
    const teleLine = (r) => {
      const line = document.createElement('div'); line.className = 'console-logline';
      const n = document.createElement('span'); n.className = 'console-logtime'; n.textContent = r.name || '?';
      const st = document.createElement('span');
      st.className = (r.status === 200 || r.status === 204) ? 'console-log-ok' : (r.errors ? 'console-log-err' : '');
      const agePart = r.age === null ? '—' : (r.age + 's');
      st.textContent = `${r.status == null ? '—' : r.status} · err${r.errors} · ${agePart}`;
      line.append(n, st); return line;
    };
    section('console.devctx.sources', f.sources.map(teleLine));
    section('console.devctx.sinks', f.sinks.map(teleLine));
  };

  let pullInFlight = false;
  const doPull = async () => {
    if (pullInFlight || !pullDeviceContext) return;
    pullInFlight = true;
    try { lastDump = await pullDeviceContext(); renderDevCtx(lastDump, null); }
    catch (e) { renderDevCtx(null, e && e.message ? e.message : String(e)); }
    finally { pullInFlight = false; }
  };
  pullBtn.onclick = doPull;

  let devCopyTimer = null;
  devCopy.onclick = async () => {
    if (devCopyTimer) clearTimeout(devCopyTimer);
    try { await navigator.clipboard.writeText(JSON.stringify(lastDump || {}, null, 2)); devCopy.textContent = t('console.copied'); }
    catch (e) { devCopy.textContent = t('console.copy_failed'); }
    devCopyTimer = setTimeout(() => { devCopy.textContent = t('console.copy'); devCopyTimer = null; }, 1500);
  };
```

- [ ] **Step 6 : Rendu initial (état vide)**

À la fin de `createConsole`, après `renderProblems(); renderSource(); syncView();` (ligne ~146), ajouter :
```js
  renderDevCtx(null, null);   // état « aucun pull » d'emblée
```

- [ ] **Step 7 : Styles minimaux**

Dans `designer/style.css`, ajouter (sous les styles `.console-*` existants) :
```css
.console-devctx { display: flex; flex-direction: column; height: 100%; overflow: auto; }
.console-devbar { display: flex; gap: 8px; align-items: center; padding: 4px 6px; }
.console-devauto { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; opacity: .85; }
.console-devsec { font-weight: 600; opacity: .7; margin: 6px 6px 2px; text-transform: uppercase; font-size: 11px; }
.console-devout { overflow: auto; }
```
> Réutilise `.console-logline`/`.console-logtime`/`.console-log-ok`/`.console-log-err`/`.console-empty`/`.console-copy` déjà stylés.

- [ ] **Step 8 : Sanity (non-régression suite node)**

Run: `cd designer && node --test`
Expected: PASS (aucun test node sur console.js ; on vérifie qu'aucun import cassé ne casse un autre test).

- [ ] **Step 9 : Commit**

```bash
git add designer/js/console.js designer/style.css
git commit -m "feat(designer): onglet Device — Pull + rendu vars/sources/sinks + Copier"
```

---

## Task 7 : Cycle de vie de l'auto-refresh (console.js — DOM)

**Files:**
- Modify: `designer/js/console.js`

Le point sensible : le `setInterval` ne doit tourner **que si** `autoOn && isOpen && tab==='deviceCtx' && visible`, et être *clear* dès qu'une condition tombe (sinon timer orphelin → poll d'une console fermée).

- [ ] **Step 1 : État + helper `syncAuto`**

Remplacer le stub `const syncAuto = () => {};` (s'il a été posé en Tâche 6) — ou l'ajouter avant `syncView` — par :

```js
  let autoOn = false;         // toggle éphémère (non persisté ; off à chaque session)
  let autoTimer = null;
  const AUTO_MS = 2000;
  const autoShouldRun = () => autoOn && isOpen && tab === 'deviceCtx' && !!tabVisible().deviceCtx;
  const syncAuto = () => {
    if (autoShouldRun()) {
      if (!autoTimer) autoTimer = setInterval(() => { if (!pullInFlight) doPull(); }, AUTO_MS);
    } else if (autoTimer) {
      clearInterval(autoTimer); autoTimer = null;
    }
  };
```
> `autoShouldRun`/`doPull`/`pullInFlight`/`tabVisible` sont définis en Tâche 6. Ordre dans le fichier : déclarer `autoOn/autoTimer/syncAuto` **après** `doPull` et `tabVisible`, **avant** le premier appel à `syncAuto()`.

- [ ] **Step 2 : Câbler la case Auto**

Après la définition de `autoChk` (Tâche 6) ou à la suite de `syncAuto`, ajouter le handler :
```js
  autoChk.onchange = () => { autoOn = autoChk.checked; if (autoOn) doPull(); syncAuto(); };
```
> Cocher Auto déclenche un pull immédiat (feedback), puis démarre le timer si les autres conditions sont réunies.

- [ ] **Step 3 : Invalider le timer à chaque changement d'état**

Ajouter `syncAuto();` dans les points qui changent `isOpen`/`tab`/visibilité :

`selectTab` (ligne ~141) :
```js
  const selectTab = (t) => { tab = t; isOpen = true; if (t in LOG_TABS) renderLog(t); syncAuto(); syncView(); };
```
`toggle.onclick` (ligne ~142) :
```js
  toggle.onclick = () => { isOpen = !isOpen; syncAuto(); syncView(); };
```
`refreshTabs` contient déjà `syncAuto()` (posé en Tâche 6, Step 4).

- [ ] **Step 4 : Sanity**

Run: `cd designer && node --test`
Expected: PASS (non-régression).

- [ ] **Step 5 : Commit**

```bash
git add designer/js/console.js
git commit -m "feat(designer): auto-refresh Device borné à ouvert+actif+coché (anti-timer orphelin)"
```

---

## Task 8 : Câblage `app.js` — injection de `pullDeviceContext`

**Files:**
- Modify: `designer/js/app.js` (import ligne ~6, appel `createConsole` ligne ~263)

- [ ] **Step 1 : Importer `getContext`**

Ligne ~6, ajouter `getContext` à l'import depuis `./device.js` :
```js
import { loadLayout, pushLayout, captureScreenshot, getStatus, getContext, setDevicePage, pushValues, uploadBgImage, fetchBgImage, uploadImage, fetchImage, uploadAimg, fetchAimg, formatDeviceStatus } from './device.js';
```

- [ ] **Step 2 : Définir `pullDeviceContext` et l'injecter**

Juste avant la ligne `const dconsole = createConsole($('console'), model, { validate, logs, getSettings });` (ligne ~263), ajouter :
```js
  // Pull on-demand pour l'onglet Device : /context (blackboard) + /status (télémétrie + uptime pour l'âge).
  const pullDeviceContext = async () => {
    const base = $('base').value;
    const [vars, status] = await Promise.all([getContext(base), getStatus(base)]);
    return { vars, sources: status.sources || [], sinks: status.sinks || [], uptime_s: status.uptime_s };
  };
```
Puis modifier l'appel :
```js
  const dconsole = createConsole($('console'), model, { validate, logs, getSettings, pullDeviceContext });
```

- [ ] **Step 3 : Sanity**

Run: `cd designer && node --test`
Expected: PASS.

- [ ] **Step 4 : Commit**

```bash
git add designer/js/app.js
git commit -m "feat(designer): app.js injecte pullDeviceContext (/context + /status)"
```

---

## Task 9 : Vérification — suite complète + QA navigateur (EN + FR)

**Files:** aucun (vérification).

Convention QA (cf. mémoire `designer-verif-navigateur`) : servir le designer en **no-store** (cache module ES) + piloter avec de **vrais events pointer**. Ne pas utiliser le port 8000 (réservé — cf. mémoire `test-server-hygiene`) ; arrêter le serveur après. Un **device mock** ou le device réel (`192.168.1.35`) sert `/context` + `/status`.

- [ ] **Step 1 : Suite node complète**

Run: `cd designer && node --test`
Expected: PASS (tous), parité i18n EN=FR verte.

- [ ] **Step 2 : Servir le designer no-store + ouvrir**

Lancer le serveur no-store (ex. `scratchpad/nostore-server.mjs`, port ≠ 8000) depuis la racine ; ouvrir le designer ; renseigner `base` vers le device mock/réel.

- [ ] **Step 3 : Visibilité de l'onglet**

Réglages → cocher « Onglet contexte device » → l'onglet **Device** apparaît dans la console. Décocher → il disparaît ; s'il était actif, la console retombe sur **Problèmes**. (Critère spec §10.1)

- [ ] **Step 4 : Pull**

Onglet Device → **Pull** → les 3 sections se remplissent : Variables (nom = valeur), Sources et Sinks (statut · errN · âge). Vérifier qu'un **âge** plausible s'affiche (ex. quelques s). (Spec §10.2)

- [ ] **Step 5 : Auto-refresh borné (le point sensible)**

Cocher **Auto (2 s)** → au journal réseau (ou onglet Réseau du navigateur), une paire `/context`+`/status` **toutes les ~2 s**. Puis vérifier l'**arrêt** dans chacun des cas : (a) changer d'onglet console, (b) plier la console, (c) décocher la case de réglage « Onglet contexte device », (d) décocher Auto → **plus aucune requête** `/context`. (Spec §10.3 + risque « fuite de timer »)

- [ ] **Step 6 : Copier + erreur**

**Copier** → le presse-papier contient le JSON `{vars, sources, sinks, uptime_s}` du dernier pull. Vider/casser `base` (ou couper le device) → **Pull** affiche une erreur inline `✗ Échec du pull — …`, pas de crash. (Spec §10.5-6)

- [ ] **Step 7 : Parité FR + console propre**

Recharger en **FR** ; refaire §3-6 ; vérifier les libellés FR (Onglet contexte device, Pull, Auto (2 s), Variables/Sources/Sinks, Aucun pull, Échec du pull) et **0 erreur/warning console** en EN **et** FR. (Spec §10.7)

- [ ] **Step 8 : Arrêter le serveur de test**

Arrêter le serveur no-store (hygiène).

- [ ] **Step 9 : Commit (si ajustements QA)**

Si la QA a nécessité des retouches, committer ; sinon rien.

```bash
git add -A && git commit -m "test(designer): QA navigateur onglet Device (EN+FR)"   # seulement si retouches
```

---

## Notes de conformité (revue holistique finale)

- **Parité i18n** : le test `i18n.test.js` impose EN=FR ; 9 clés ajoutées de chaque côté (Tâche 1).
- **Invariant console** : la retombée « onglet actif masqué → Problèmes » est étendue à `deviceCtx` (Tâche 6, Step 4) — sinon un panneau caché resterait « actif » sans onglet.
- **Anti-timer orphelin** : `syncAuto()` est appelé sur **tous** les chemins qui invalident `autoShouldRun()` (pliage, changement d'onglet, refreshTabs, toggle Auto). Point de vigilance QA §10.5.
- **Durcissement `Array.isArray`** : `formatDeviceDump` tolère vars/sources/sinks non conformes (miroir de la convention sources/sinks du designer).
- **Aucun changement firmware** : `git diff main -- src/ lib/ platformio.ini schema/` doit être **vide** à la fin de la tranche.
