# Notifications unifiées + verrou busy (Phase 5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commits :** chaque `git commit` de ce plan se termine par la ligne `Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP` (convention harnais). Push **uniquement sur demande explicite**.

**Goal:** Remplacer les trois canaux de notification concurrents (`#status` header, `showToast` bas-centre, `#devbar`) par **un seul foyer d'attention** — une pile de toasts haut-droite dont le toast « en cours » (spinner) se **mue en verdict** sur place — et **sérialiser les I/O device** via un verrou `busy` (une opération en vol désactive les autres).

**Architecture:** `toast.js` est étendu (modèle A) : `showToast` (verdict instantané) **conservé** pour les verdicts locaux, `makeToast` neuf renvoie un handle `.morph(msg, kind)`/`.dismiss()` pour les opérations longues. `app.js` gagne `withBusy(progressMsg, fn)` qui pose un toast progress, désactive le groupe device, sérialise l'I/O, puis mue le toast en succès/échec. Les 7 sites d'I/O device (tous dans `app.js`) + `pushVisible` passent par `withBusy`. `#status` disparaît ; `#devbar` devient une **pastille device** (`#dev-pill`) alimentée par une fonction pure `formatDeviceStatus` (testée node). Périmètre **100 % designer** — firmware, `render.js`, schéma : intacts.

**Tech Stack:** JS modules ES (designer), tests `node --test` (cœur pur, sans DOM — convention projet), vérification navigateur Playwright (serveur no-store).

---

## Décisions verrouillées (rappel)

- **Modèle A** (spec §3) : pile unique de toasts **haut-droite** ; un toast `progress` (spinner) se mue en verdict **en place** (pas de second toast, pas de clignotement). Position haut-droite **validée** (la spec ; déplace l'actuel bas-centre).
- **Verrou busy global** : une seule I/O device en vol. `busy` bloque la **ré-entrée** (double-clic ignoré) **et** désactive les boutons device (feedback). Les éditions **locales** (inspecteur, arbre, undo) ne sont **jamais** bloquées (spec §3).
- **Pastille device paresseuse** (validé utilisateur) : « ○ non vérifié » au boot ; renseignée à la **1re requête Statut** (succès → `● ip` + détail en infobulle ; échec → `○ injoignable`). **Aucun ping spontané** au chargement (cohérent dev local, device souvent absent).
- **`showToast` conservé** tel quel pour les verdicts **locaux instantanés** déjà câblés : doublon de nom (`inspector.js`, `tree.js`), doublon d'id (`tree.js`), import KO (`file-io.js`), garde « URL device ? ». On **ajoute** `makeToast`, on ne casse pas `showToast`.
- **`formatDeviceStatus` dans `device.js`** : la mise en forme de `GET /status` (présentation) est extraite du transport pour être **testable node** (Rule 9) ; c'est la seule logique pure de la phase.
- **Hint CORS centralisé et affiné** : l'ancien code suffixait « (CORS ? cf. README) » sur **tout** échec d'I/O. Désormais le suffixe « (réseau/CORS ? cf. README) » n'apparaît **que** sur un échec **réseau réel** (`fetch` rejette → `TypeError`), pas sur un HTTP 4xx ni une validation. Amélioration assumée (Rule 7) — message plus juste.
- **Hors scope Phase 5** (→ Phases 6/7) : barre d'état (`statusbar.js`), console Problèmes/Source, tiroir Device, scission `json-view.js`. Le `<footer>` (Device/Sources/JSON) **reste en place**. En Phase 5 le **résumé** device (page/uptime/sources) vit dans l'**infobulle** (`title`) de la pastille, pas dans une barre d'état (inexistante).

## File Structure

| Fichier | Rôle | Action |
|---|---|---|
| `designer/js/toast.js` | Toasts (modèle A) | **Réécrire** : `showToast` conservé + `makeToast`/`morph`/`dismiss`/spinner |
| `designer/style.css` | CSS structurelle | **Modifier** : `.toast-host` haut-droite + `.toast` flex + `.toast-progress`/`.toast-spinner`/`@keyframes` ; retrait `.status`/`.devbar` ; ajout `.dev-pill` |
| `designer/js/device.js` | Pont REST device | **Modifier** : +export pur `formatDeviceStatus` |
| `designer/tests/device.test.js` | Tests node device | **Créer** : 4 tests `formatDeviceStatus` |
| `designer/js/app.js` | Câblage / coordinateur | **Modifier** : +`withBusy`/`setDeviceBusy`/`makeToast` ; migration des 7 I/O + `pushVisible` ; −`setStatus` ; pastille `setDevicePill` ; −`renderStatus`/`devbar` |
| `designer/index.html` | Structure | **Modifier** : −`#status` ; −`#devbar` ; +`#dev-pill` |
| `designer/js/file-io.js` | Export/import fichier | **Modifier** : retrait de l'usage direct de `#status` (garde `showToast`) |

**Invariants à NE PAS régresser** : `showToast` reste appelable avec la **même signature** (`message, {kind, ms}`) — ses 4 appelants existants ne changent pas. Les éditions locales ne sont jamais désactivées par `busy`. Le contrat `pushVisible(ref, visible) → truthy/falsy` (lu par `inspector.js:480` `const ok = await pushVisible(...)`) est **préservé**.

---

## Task 1 : `toast.js` — modèle A (progress → verdict) + CSS

**But :** étendre les toasts au modèle A (pile haut-droite, toast progress à spinner muable en verdict) **sans casser** `showToast`. Pas de test node (DOM pur — convention projet) ; vérification navigateur.

**Files:**
- Modify: `designer/js/toast.js` (réécriture complète)
- Modify: `designer/style.css` (`.toast-host` / `.toast` / `+.toast-progress` / `+.toast-spinner` / `+@keyframes`)

- [ ] **Step 1 : Réécrire `designer/js/toast.js`**

Remplacer **tout** le contenu du fichier par :

```js
// Toasts unifiés (modèle A) : une pile unique (haut-droite), non bloquante. Deux usages :
//  - showToast(msg, {kind}) : verdict instantané auto-disparaissant (export, doublon de nom, import…).
//  - makeToast(msg) : toast de PROGRESSION (spinner) pour une I/O device ; son handle .morph(msg, kind)
//    le mue EN PLACE en verdict (pas de second toast, pas de clignotement), puis il auto-disparaît.
// Câblage DOM, vérifié au navigateur (convention projet : node --test sans DOM → pas de test ici).
let host = null;

function ensureHost() {
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; document.body.appendChild(host); }
  return host;
}

// Monte un toast (texte + spinner optionnel) et renvoie { node, label }.
function mount(message, kind, spinner) {
  const node = document.createElement('div');
  node.className = 'toast toast-' + kind;
  if (spinner) { const sp = document.createElement('span'); sp.className = 'toast-spinner'; node.appendChild(sp); }
  const label = document.createElement('span');
  label.className = 'toast-label';
  label.textContent = message;
  node.appendChild(label);
  ensureHost().appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));   // déclenche la transition d'entrée
  return { node, label };
}

// Retrait avec transition de sortie.
function leave(node) {
  node.classList.remove('show');
  setTimeout(() => node.remove(), 200);
}

// Verdict instantané : auto-disparition après ms. (kind 'err' par défaut — compat des appels existants.)
export function showToast(message, { kind = 'err', ms = 2600 } = {}) {
  const { node } = mount(message, kind, false);
  setTimeout(() => leave(node), ms);
}

// Toast de progression (spinner), muable en verdict via le handle renvoyé. Ne disparaît pas tant que
// morph() ou dismiss() n'a pas été appelé (une I/O en vol reste visible). morph()/dismiss() sont idempotents.
export function makeToast(message) {
  const { node, label } = mount(message, 'progress', true);
  let settled = false;
  return {
    // Mue le toast progress en verdict EN PLACE : retire le spinner, repasse la classe en ok/err,
    // change le texte, puis auto-disparaît après ms.
    morph(msg, kind = 'ok', { ms = 2600 } = {}) {
      if (settled) return; settled = true;
      const sp = node.querySelector('.toast-spinner'); if (sp) sp.remove();
      node.className = 'toast toast-' + kind + ' show';
      label.textContent = msg;
      setTimeout(() => leave(node), ms);
    },
    // Ferme sans verdict (cas rare : abandon).
    dismiss() { if (settled) return; settled = true; leave(node); }
  };
}
```

- [ ] **Step 2 : Vérifier la syntaxe + non-régression des tests**

Run: `cd designer && node --check js/toast.js && node --test`
Expected: pas d'erreur ; **297 tests** PASS (aucun test DOM, donc inchangé).

- [ ] **Step 3 : Mettre à jour le CSS des toasts (`designer/style.css`)**

Remplacer le bloc actuel (repère : commentaire « Toasts éphémères (cf. toast.js)… ») :

```css
/* Toasts éphémères (cf. toast.js) : empilés en bas-centre, non bloquants, auto-disparition. */
.toast-host { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 8px; z-index: 1000; pointer-events: none; }
.toast { padding: 8px 14px; border-radius: 8px; font: 13px/1.4 var(--font-ui); color: var(--ink);
  background: var(--panel); border: 1px solid var(--line); box-shadow: 0 6px 20px rgba(0, 0, 0, .45);
  opacity: 0; transform: translateY(8px); transition: opacity .15s, transform .15s; }
.toast.show { opacity: 1; transform: translateY(0); }
.toast-err { border-color: var(--err); color: var(--err); }
.toast-ok { border-color: var(--ok); color: var(--ok); }
```

par :

```css
/* Toasts unifiés (cf. toast.js, modèle A) : pile haut-droite, non bloquante. Un toast progress (spinner)
   se mue en verdict EN PLACE. */
.toast-host { position: fixed; right: 24px; top: 24px; z-index: 1000; pointer-events: none;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.toast { display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 8px; font: 13px/1.4 var(--font-ui); color: var(--ink);
  background: var(--panel); border: 1px solid var(--line); box-shadow: 0 6px 20px rgba(0, 0, 0, .45);
  opacity: 0; transform: translateY(-8px); transition: opacity .15s, transform .15s; }
.toast.show { opacity: 1; transform: translateY(0); }
.toast-ok { border-color: var(--ok); color: var(--ok); }
.toast-err { border-color: var(--err); color: var(--err); }
.toast-progress { border-color: var(--line); color: var(--muted); }
.toast-spinner { flex: none; width: 13px; height: 13px; border-radius: 50%;
  border: 2px solid var(--line); border-top-color: var(--accent); animation: toast-spin .7s linear infinite; }
@keyframes toast-spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 4 : Vérification navigateur — toast progress→verdict + toast instantané**

Servir le designer en **no-store depuis la racine du repo** (cf. mémoire `designer-verif-navigateur` : `Cache-Control: no-store`, port ≠ 8000 ; servir `Dialboard/`, ouvrir `…/designer/`). Dans la console du designer :

```js
import('./js/toast.js').then(m => {
  const t = m.makeToast('Chargement…');           // spinner, reste affiché
  setTimeout(() => t.morph('Chargé', 'ok'), 1500); // se mue en vert sur place
  m.showToast('Échec démo', { kind: 'err' });      // verdict rouge instantané (auto-disparaît)
});
```

Expected (capture d'écran à envoyer) : les toasts apparaissent en **haut-droite** ; le 1er montre un **spinner qui tourne** puis devient un verdict vert « Chargé » **au même endroit** (pas de second toast) ; le 2e est rouge et disparaît seul.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/toast.js designer/style.css
git commit -m "designer: toast.js — modèle A (toast progress→verdict, pile haut-droite)"
```

---

## Task 2 : `formatDeviceStatus` (pur) + tests node

**But :** extraire la mise en forme de `GET /status` (présentation) dans une fonction pure testable, en amont de son usage par la pastille (Task 4).

**Files:**
- Modify: `designer/js/device.js` (append export `formatDeviceStatus`)
- Test: `designer/tests/device.test.js` (créer)

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `designer/tests/device.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDeviceStatus } from '../js/device.js';

const base = { ip: '192.168.1.35', page: 0, pages: 5, uptime_s: 42, components: 24, sources: [] };

test('formatDeviceStatus : label = pastille pleine + ip (intent : état connecté lisible d’un coup d’œil)', () => {
  const { label } = formatDeviceStatus(base);
  assert.equal(label, '● 192.168.1.35');
});

test('formatDeviceStatus : page affichée en base 1 (intent : l’utilisateur compte les pages à partir de 1)', () => {
  const { tooltip } = formatDeviceStatus({ ...base, page: 0, pages: 5 });
  assert.match(tooltip, /page 1\/5/);
});

test('formatDeviceStatus : état par source — 200→ok, err_count→err, sinon … (intent : refléter le vrai état pull)', () => {
  const { tooltip } = formatDeviceStatus({ ...base, sources: [
    { name: 'a', last_status: 200, err_count: 0 },
    { name: 'b', last_status: 0, err_count: 3 },
    { name: 'c', last_status: 0, err_count: 0 },
  ] });
  assert.match(tooltip, /sources a:ok b:err c:…/);
});

test('formatDeviceStatus : aucune source → pas de segment « sources » dans l’infobulle', () => {
  const { tooltip } = formatDeviceStatus(base);
  assert.doesNotMatch(tooltip, /sources/);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `formatDeviceStatus is not a function` (import non résolu).

- [ ] **Step 3 : Implémenter la fonction pure**

À la **fin** de `designer/js/device.js`, ajouter :

```js
// Présentation de GET /status pour la pastille device (séparée du transport → testable node).
// { label } : court, pour la toolbar (pastille pleine ● + ip). { tooltip } : détail (page 1-based,
// uptime, composants, état de chaque source pull). En Phase 5 le tooltip alimente le `title` de la
// pastille ; en Phase 6 il alimentera la barre d'état. Reprend la mise en forme de l'ancien renderStatus.
export function formatDeviceStatus(s) {
  const srcs = (s.sources || []).map(x =>
    `${x.name || '?'}:${x.last_status === 200 ? 'ok' : (x.err_count ? 'err' : '…')}`).join(' ');
  const label = `● ${s.ip}`;
  const tooltip = `page ${(+s.page) + 1}/${s.pages} · up ${s.uptime_s}s · ${s.components} comp.`
    + (srcs ? ` · sources ${srcs}` : '');
  return { label, tooltip };
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS — 297 + 4 = **301 tests**, 0 fail.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/device.js designer/tests/device.test.js
git commit -m "designer: device — formatDeviceStatus pur (présentation /status, testée node)"
```

---

## Task 3 : Verrou `busy` + notifications unifiées (retrait `#status`)

**But :** introduire `withBusy` (sérialisation + toast progress→verdict), migrer **tous** les sites d'I/O device + `pushVisible` + l'init schema + l'import fichier, et **supprimer** `#status` / `setStatus`. `#devbar`/`renderStatus` sont **conservés tels quels** ici (remplacés en Task 4) : Task 3 reste shippable (les toasts couvrent tous les verdicts ; la barre device fonctionne encore).

**Files:**
- Modify: `designer/js/app.js` (import `makeToast` ; init schema ; `setStatus`→`withBusy`/`setDeviceBusy` ; `pushVisible` ; load/push/values/statusbtn/capture/navAndCapture)
- Modify: `designer/index.html` (retrait `#status`)
- Modify: `designer/js/file-io.js` (retrait usage `#status`)
- Modify: `designer/style.css` (retrait sélecteurs `.status`, conservation `.valid`)

> **Note ordre/TDZ :** `pushVisible` (créé dans l'appel `createInspector`, en haut de `main()`) référence `withBusy` (déclaré plus bas). C'est sûr : `pushVisible` n'est **appelé** qu'au clic, bien après l'initialisation du `const withBusy`. Idem `deviceBtns` (les boutons existent dans le DOM au chargement).

- [ ] **Step 1 : Importer `makeToast`**

Dans `designer/js/app.js`, remplacer :

```js
import { showToast } from './toast.js';
```

par :

```js
import { showToast, makeToast } from './toast.js';
```

- [ ] **Step 2 : Migrer l'échec d'init schema (retrait `#status`)**

Remplacer (dans `main()`, le `catch` de l'init schema) :

```js
  } catch (e) {
    const s = document.getElementById('status');
    s.textContent = 'Erreur init schema : ' + e.message;
    s.className = 'status err';
    return;
  }
```

par :

```js
  } catch (e) {
    showToast('Erreur init schema : ' + e.message, { kind: 'err', ms: 6000 });
    return;
  }
```

- [ ] **Step 3 : Remplacer `setStatus` par la machinerie `withBusy`**

Remplacer le bloc :

```js
  // La barre #status garde la trace (dont la progression « … » sans kind) ; un verdict ok/err part aussi
  // en toast (échec rouge / succès vert) — plus visible que la petite barre. Cf. toast.js.
  const setStatus = (msg, kind) => {
    $('status').textContent = msg; $('status').className = 'status' + (kind ? ' ' + kind : '');
    if (kind === 'ok' || kind === 'err') showToast(msg, { kind });
  };
```

par :

```js
  // --- Notifications unifiées + verrou busy (modèle A, cf. spec §3) ---
  // Une seule I/O device en vol à la fois : `busy` bloque la ré-entrée (double-clic) ET désactive les
  // boutons device (feedback visuel). Les éditions locales (inspecteur/arbre/undo) ne sont PAS bloquées.
  const deviceBtns = ['load', 'push', 'values', 'statusbtn', 'capture', 'shot-prev', 'shot-next'].map($);
  let busy = false;
  const setDeviceBusy = (b) => { busy = b; for (const el of deviceBtns) if (el) el.disabled = b; };

  // withBusy(progressMsg, fn) : pose un toast progress (spinner), sérialise l'I/O, mue le toast en
  // verdict. fn renvoie le texte de succès (string) ; une exception → verdict d'échec. Le suffixe
  // « réseau/CORS » n'apparaît que sur un vrai échec réseau (fetch rejette → TypeError), pas sur un
  // HTTP 4xx ni une validation. Renvoie le texte de succès, ou undefined si échec/ré-entrée
  // (pushVisible s'en sert pour signaler le succès à l'inspecteur).
  async function withBusy(progressMsg, fn) {
    if (busy) return undefined;                 // ré-entrée bloquée (double-clic)
    const t = makeToast(progressMsg);
    setDeviceBusy(true);
    try {
      const okMsg = await fn();
      t.morph(typeof okMsg === 'string' ? okMsg : 'Terminé', 'ok');
      return okMsg;
    } catch (e) {
      const hint = e instanceof TypeError ? ' (réseau/CORS ? cf. README)' : '';
      t.morph('Échec : ' + e.message + hint, 'err');
      return undefined;
    } finally {
      setDeviceBusy(false);
    }
  }
```

- [ ] **Step 4 : Migrer `pushVisible` (option de `createInspector`)**

Remplacer :

```js
    pushVisible: async (id, visible) => {
      if (!$('base').value) { setStatus('URL device ?', 'err'); return false; }
      setStatus('Visibilité…');
      try {
        await pushValues($('base').value, { [id]: { visible } });
        setStatus(visible ? 'Affiché sur le device' : 'Caché sur le device', 'ok');
        return true;
      } catch (e) { setStatus('Échec : ' + e.message, 'err'); return false; }
    }
```

par :

```js
    pushVisible: async (id, visible) => {
      const base = $('base').value;
      if (!base) { showToast('URL device ?'); return false; }
      // withBusy renvoie le texte de succès (truthy) ou undefined (échec/ré-entrée) → booléen pour l'inspecteur.
      const r = await withBusy(visible ? 'Affichage…' : 'Masquage…', async () => {
        await pushValues(base, { [id]: { visible } });
        return visible ? 'Affiché sur le device' : 'Caché sur le device';
      });
      return r !== undefined;
    }
```

- [ ] **Step 5 : Migrer `load` et `push`**

Remplacer le handler `$('load').onclick` :

```js
  $('load').onclick = async () => {
    if (!$('base').value) return setStatus('URL device ?', 'err');
    setStatus('Chargement…');
    try {
      const base = $('base').value;
      const lay = await loadLayout(base);
      stripPhysicalPlacements(lay);            // migration avant chargement dans le modèle
      model.loadJSON(JSON.stringify(lay));
      for (const k of referencedKeys(model.state)) {
        if (!previewUrl(k)) { const b = await fetchBgImage(base, k); if (b) cachePut(k, b); }
      }
      for (const [id, ic] of Object.entries(model.state.components || {})) {
        // garde w/h > 0 : un layout edite a la main sans dimensions ferait throw createImageData(0,0)
        if (ic.type === 'image_anim' && ic.src && ic.w > 0 && ic.h > 0 && ic.frames > 0 && !aimgPreviewUrl(ic.src)) {
          const b = await fetchAimg(base, ic.src);
          if (b) rehydrateAimg(ic.src, b, ic.w, ic.h, ic.frames);
        }
        if (ic.type !== 'image' || !ic.src || !(ic.w > 0) || !(ic.h > 0) || imagePreviewUrl(ic.src)) continue;
        const b = await fetchImage(base, ic.src);
        if (b) rehydrateImage(ic.src, id, b, ic.w, ic.h);
      }
      setStatus('Chargé', 'ok');
    }
    catch (e) { setStatus('Échec : ' + e.message + ' (CORS ? cf. README)', 'err'); }
  };
```

par :

```js
  $('load').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast('URL device ?');
    withBusy('Chargement…', async () => {
      const lay = await loadLayout(base);
      stripPhysicalPlacements(lay);            // migration avant chargement dans le modèle
      model.loadJSON(JSON.stringify(lay));
      for (const k of referencedKeys(model.state)) {
        if (!previewUrl(k)) { const b = await fetchBgImage(base, k); if (b) cachePut(k, b); }
      }
      for (const [id, ic] of Object.entries(model.state.components || {})) {
        // garde w/h > 0 : un layout edite a la main sans dimensions ferait throw createImageData(0,0)
        if (ic.type === 'image_anim' && ic.src && ic.w > 0 && ic.h > 0 && ic.frames > 0 && !aimgPreviewUrl(ic.src)) {
          const b = await fetchAimg(base, ic.src);
          if (b) rehydrateAimg(ic.src, b, ic.w, ic.h, ic.frames);
        }
        if (ic.type !== 'image' || !ic.src || !(ic.w > 0) || !(ic.h > 0) || imagePreviewUrl(ic.src)) continue;
        const b = await fetchImage(base, ic.src);
        if (b) rehydrateImage(ic.src, id, b, ic.w, ic.h);
      }
      return 'Chargé';
    });
  };
```

Remplacer le handler `$('push').onclick` :

```js
  $('push').onclick = async () => {
    if (!$('base').value) return setStatus('URL device ?', 'err');
    if ($('json').value.trim() !== model.toJSON().trim()) return setStatus('Modifs JSON non appliquées — clique « Appliquer » d’abord', 'err');
    if (!validate(model.state).valid) return setStatus('Layout invalide', 'err');
    setStatus('Envoi…');
    try {
      const base = $('base').value;
      for (const k of referencedKeys(model.state)) {
        const bytes = cacheBytes(k);
        if (bytes) await uploadBgImage(base, k, bytes);   // avant pushLayout (le sweep tourne au POST /layout)
      }
      for (const k of referencedImageKeys(model.state)) {
        const bytes = imageCacheBytes(k);
        if (bytes) await uploadImage(base, k, bytes);   // avant pushLayout (le sweep tourne au POST /layout)
      }
      for (const k of referencedAimgKeys(model.state)) {
        const bytes = aimgPackBytes(k);
        if (bytes) await uploadAimg(base, k, bytes);   // avant pushLayout (le sweep tourne au POST /layout)
      }
      await pushLayout(base, model.toJSON());
      setStatus('Poussé et persisté', 'ok');
    }
    catch (e) { setStatus('Échec : ' + e.message + ' (CORS ? cf. README)', 'err'); }
  };
```

par :

```js
  $('push').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast('URL device ?');
    if ($('json').value.trim() !== model.toJSON().trim()) return void showToast('Modifs JSON non appliquées — clique « Appliquer » d’abord');
    if (!validate(model.state).valid) return void showToast('Layout invalide');
    withBusy('Envoi…', async () => {
      for (const k of referencedKeys(model.state)) {
        const bytes = cacheBytes(k);
        if (bytes) await uploadBgImage(base, k, bytes);   // avant pushLayout (le sweep tourne au POST /layout)
      }
      for (const k of referencedImageKeys(model.state)) {
        const bytes = imageCacheBytes(k);
        if (bytes) await uploadImage(base, k, bytes);   // avant pushLayout (le sweep tourne au POST /layout)
      }
      for (const k of referencedAimgKeys(model.state)) {
        const bytes = aimgPackBytes(k);
        if (bytes) await uploadAimg(base, k, bytes);   // avant pushLayout (le sweep tourne au POST /layout)
      }
      await pushLayout(base, model.toJSON());
      return 'Poussé et persisté';
    });
  };
```

- [ ] **Step 6 : Migrer `statusbtn` (devbar conservé) et `values`**

Remplacer le handler `$('statusbtn').onclick` (la `const devbar` et `renderStatus` au-dessus restent **inchangés** ici) :

```js
  $('statusbtn').onclick = async () => {
    if (!$('base').value) return setStatus('URL device ?', 'err');
    setStatus('Statut…');
    try { renderStatus(await getStatus($('base').value)); setStatus('Statut OK', 'ok'); }
    catch (e) { devbar.hidden = false; devbar.className = 'devbar err'; devbar.textContent = '○ injoignable : ' + e.message; setStatus('Échec statut', 'err'); }
  };
```

par :

```js
  $('statusbtn').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast('URL device ?');
    withBusy('Statut…', async () => {
      try { renderStatus(await getStatus(base)); return 'Statut OK'; }
      catch (e) { devbar.hidden = false; devbar.className = 'devbar err'; devbar.textContent = '○ injoignable : ' + e.message; throw e; }
    });
  };
```

Remplacer le handler `$('values').onclick` :

```js
  $('values').onclick = async () => {
    if (!$('base').value) return setStatus('URL device ?', 'err');
    const payload = buildUpdatePayload(model.state);
    if (!Object.keys(payload).length) return setStatus('Aucune valeur de test à pousser', 'err');
    setStatus('Valeurs…');
    try { const r = await pushValues($('base').value, payload); setStatus(`Valeurs poussées (${r.updated ?? '?'})`, 'ok'); }
    catch (e) { setStatus('Échec : ' + e.message, 'err'); }
  };
```

par :

```js
  $('values').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast('URL device ?');
    const payload = buildUpdatePayload(model.state);
    if (!Object.keys(payload).length) return void showToast('Aucune valeur de test à pousser');
    withBusy('Valeurs…', async () => {
      const r = await pushValues(base, payload);
      return `Valeurs poussées (${r.updated ?? '?'})`;
    });
  };
```

- [ ] **Step 7 : Migrer `capture` et `navAndCapture`**

Remplacer le handler `$('capture').onclick` (les `const shot`, `doCapture`, `refreshShotPage` au-dessus restent inchangés) :

```js
  $('capture').onclick = async () => {
    if (!$('base').value) return setStatus('URL device ?', 'err');
    setStatus('Capture…');
    try { await doCapture(); await refreshShotPage(); $('shot-overlay').hidden = false; setStatus('Capturé', 'ok'); }
    catch (e) { setStatus('Échec : ' + e.message + ' (CORS ? cf. README)', 'err'); }
  };
```

par :

```js
  $('capture').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast('URL device ?');
    withBusy('Capture…', async () => {
      await doCapture(); await refreshShotPage(); $('shot-overlay').hidden = false;
      return 'Capturé';
    });
  };
```

Remplacer `navAndCapture` :

```js
  const navAndCapture = async (dir) => {
    if (!$('base').value) return;
    setStatus('Navigation…');
    try {
      await setDevicePage($('base').value, { dir });
      await new Promise(r => setTimeout(r, 350));   // laisse le device basculer + sync avant la capture
      await doCapture(); await refreshShotPage(); setStatus('Capturé', 'ok');
    } catch (e) { setStatus('Échec : ' + e.message, 'err'); }
  };
```

par :

```js
  const navAndCapture = (dir) => {
    const base = $('base').value;
    if (!base) return;
    withBusy('Navigation…', async () => {
      await setDevicePage(base, { dir });
      await new Promise(r => setTimeout(r, 350));   // laisse le device basculer + sync avant la capture
      await doCapture(); await refreshShotPage();
      return 'Capturé';
    });
  };
```

- [ ] **Step 8 : Retirer `#status` de `designer/index.html`**

Supprimer la ligne (dans `<header>`, juste avant `</header>`) :

```html
    <span id="status" class="status"></span>
```

- [ ] **Step 9 : Retirer l'usage de `#status` dans `designer/js/file-io.js`**

Remplacer le `catch` :

```js
    } catch (e) {
      const status = document.getElementById('status');
      if (status) { status.textContent = 'Import échoué : ' + e.message; status.className = 'status err'; }
      showToast('Import échoué : ' + e.message, { kind: 'err' });
    } finally {
```

par :

```js
    } catch (e) {
      showToast('Import échoué : ' + e.message, { kind: 'err' });
    } finally {
```

- [ ] **Step 10 : Retirer les sélecteurs `.status` du CSS (conserver `.valid`)**

Dans `designer/style.css`, remplacer :

```css
.status, .valid { font-size: 12.5px; }
.status.ok, .valid.ok { color: var(--ok); }
.status.err, .valid.err { color: var(--err); }
```

par :

```css
.valid { font-size: 12.5px; }
.valid.ok { color: var(--ok); }
.valid.err { color: var(--err); }
```

- [ ] **Step 11 : Vérifier la syntaxe + absence de résidus `#status`/`setStatus`**

Run: `cd designer && node --check js/app.js && node --check js/file-io.js && node --test`
Expected: pas d'erreur ; **301 tests** PASS.

Run (résidus `setStatus`/`#status`) : `grep -rn "setStatus\|getElementById('status')\|id=\"status\"" designer/js designer/index.html`
Expected: aucune ligne.
Run (classe CSS `.status` retirée, `.valid` conservée) : `grep -n "\.status" designer/style.css`
Expected: aucune ligne (ne PAS confondre avec `r.status` en JS — d'où la recherche restreinte à `style.css`).
Note : `.devbar`/`renderStatus` subsistent encore (retirés en Task 4) — c'est attendu.

- [ ] **Step 12 : Vérification navigateur — toasts progress→verdict + verrou busy**

Servir no-store depuis la racine. Avec le device joignable (IP `192.168.1.35` — Playwright/Chromium ne résout pas le `.local`, cf. HANDOFF), via Playwright (vrais events pointer) :
1. Renseigner l'URL device, cliquer **Statut** → toast `Statut…` (spinner) qui se mue en `Statut OK` (vert) ; la `#devbar` se remplit (conservée).
2. **Double-clic rapide sur Pousser** → **un seul** toast `Envoi…` ; le 2e clic est **ignoré** (ré-entrée bloquée) ; pendant l'envoi les boutons device sont **grisés** (`disabled`) puis réactivés au verdict.
3. Pendant un push en vol, **déplacer un widget** sur le canvas / faire **Undo** → **non bloqué** (éditions locales libres).
4. Device **coupé** (mauvaise URL) → cliquer **Charger** → toast `Chargement…` muté en `Échec : … (réseau/CORS ? cf. README)` (rouge).

Captures par lot pour validation async par l'utilisateur.

- [ ] **Step 13 : Commit**

```bash
git add designer/js/app.js designer/js/file-io.js designer/index.html designer/style.css
git commit -m "designer: notifications unifiées + verrou busy (toasts progress→verdict, retrait #status)"
```

---

## Task 4 : Pastille device `#dev-pill` (remplace `#devbar`)

**But :** remplacer la barre `#devbar` par une **pastille** dans la toolbar (état de connexion permanent, paresseuse), alimentée par `formatDeviceStatus` (Task 2). Le détail (page/uptime/sources) passe dans l'**infobulle** (`title`).

**Files:**
- Modify: `designer/index.html` (retrait `#devbar` ; ajout `#dev-pill`)
- Modify: `designer/js/app.js` (import `formatDeviceStatus` ; `setDevicePill` ; `statusbtn` ; retrait `devbar`/`renderStatus`)
- Modify: `designer/style.css` (retrait `.devbar` ; ajout `.dev-pill`)

- [ ] **Step 1 : HTML — retirer `#devbar`, ajouter `#dev-pill`**

Dans `designer/index.html`, supprimer la ligne (entre `</header>` et `<main>`) :

```html
  <div id="devbar" class="devbar" hidden></div>
```

et ajouter, dans `<header>` juste avant `</header>` (là où vivait `#status`) :

```html
    <span id="dev-pill" class="dev-pill" title="Aucune requête device effectuée">○ non vérifié</span>
```

- [ ] **Step 2 : `app.js` — importer `formatDeviceStatus`**

Remplacer la ligne d'import depuis `./device.js` :

```js
import { loadLayout, pushLayout, captureScreenshot, getStatus, setDevicePage, pushValues, uploadBgImage, fetchBgImage, uploadImage, fetchImage, uploadAimg, fetchAimg } from './device.js';
```

par (ajout de `formatDeviceStatus` en fin de liste) :

```js
import { loadLayout, pushLayout, captureScreenshot, getStatus, setDevicePage, pushValues, uploadBgImage, fetchBgImage, uploadImage, fetchImage, uploadAimg, fetchAimg, formatDeviceStatus } from './device.js';
```

- [ ] **Step 3 : `app.js` — remplacer `devbar`/`renderStatus` par la pastille**

Remplacer le bloc (issu de la Task 3) :

```js
  // --- Boucle device : santé (/status), valeurs de test (/update), capture + navigation (/page + /screenshot) ---
  const devbar = $('devbar');
  const renderStatus = (s) => {
    const srcs = (s.sources || []).map(x => `${x.name || '?'}:${x.last_status === 200 ? 'ok' : (x.err_count ? 'err' : '…')}`).join(' ');
    devbar.className = 'devbar'; devbar.hidden = false;
    devbar.textContent = `● ${s.ip} · page ${(+s.page) + 1}/${s.pages} · up ${s.uptime_s}s · ${s.components} comp.` + (srcs ? ` · sources ${srcs}` : '');
  };
  $('statusbtn').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast('URL device ?');
    withBusy('Statut…', async () => {
      try { renderStatus(await getStatus(base)); return 'Statut OK'; }
      catch (e) { devbar.hidden = false; devbar.className = 'devbar err'; devbar.textContent = '○ injoignable : ' + e.message; throw e; }
    });
  };
```

par :

```js
  // --- Boucle device : santé (/status), valeurs de test (/update), capture + navigation (/page + /screenshot) ---
  // Pastille device (toolbar) : état de connexion permanent (modèle A). Paresseuse — « ○ non vérifié »
  // au boot, renseignée à la 1re requête Statut (succès → ● ip + détail en infobulle ; échec → ○ injoignable).
  const devPill = $('dev-pill');
  const setDevicePill = (kind, label, tooltip = '') => {
    devPill.className = 'dev-pill' + (kind ? ' ' + kind : '');
    devPill.textContent = label;
    devPill.title = tooltip;
  };
  $('statusbtn').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast('URL device ?');
    withBusy('Statut…', async () => {
      try {
        const f = formatDeviceStatus(await getStatus(base));
        setDevicePill('ok', f.label, f.tooltip);
        return 'Statut OK';
      } catch (e) {
        setDevicePill('err', '○ injoignable', e.message);
        throw e;
      }
    });
  };
```

- [ ] **Step 4 : CSS — retirer `.devbar`, ajouter `.dev-pill`**

Dans `designer/style.css`, remplacer :

```css
/* Barre de santé device (GET /status) */
.devbar { padding: 5px 12px; font: 12.5px/1.4 ui-monospace, monospace; color: var(--muted);
  border-bottom: 1px solid var(--line); background: var(--panel-2); }
.devbar.err { color: var(--err); }
```

par :

```css
/* Pastille device (toolbar, cf. app.js setDevicePill) : état de connexion permanent (modèle A). */
.dev-pill { font: 12.5px/1 ui-monospace, monospace; color: var(--muted);
  padding: 4px 9px; border: 1px solid var(--line); border-radius: 999px; white-space: nowrap; }
.dev-pill.ok { color: var(--ok); border-color: var(--ok); }
.dev-pill.err { color: var(--err); border-color: var(--err); }
```

- [ ] **Step 5 : Vérifier la syntaxe + absence de résidus `devbar`/`renderStatus`**

Run: `cd designer && node --check js/app.js && node --test`
Expected: pas d'erreur ; **301 tests** PASS.

Run: `grep -rn "devbar\|renderStatus\|#status\|setStatus" designer/js designer/index.html designer/style.css`
Expected: aucune ligne.

- [ ] **Step 6 : Vérification navigateur — états de la pastille**

Servir no-store depuis la racine. Via Playwright :
1. **Boot** → pastille « ○ non vérifié » (gris), infobulle « Aucune requête device effectuée ».
2. URL device joignable + **Statut** → pastille « ● 192.168.1.35 » (vert) ; **survol** → infobulle `page i/n · up Ns · M comp. · sources …`.
3. URL erronée + **Statut** → pastille « ○ injoignable » (rouge) + toast d'échec.

Captures par lot.

- [ ] **Step 7 : Commit**

```bash
git add designer/js/app.js designer/index.html designer/style.css
git commit -m "designer: pastille device #dev-pill (remplace #devbar, état de connexion paresseux)"
```

---

## Task 5 : Vérification navigateur intégrale + MAJ HANDOFF

**But :** valider l'ensemble de la Phase 5 à l'écran (un seul foyer de notif, busy, pastille) et consigner l'avancement.

**Files:**
- Modify: `docs/_internal/HANDOFF.md` (gitignoré — **pas de commit**)

- [ ] **Step 1 : Parcours complet Playwright (captures par lot)**

Servir no-store depuis la racine. Capturer, pour validation async par l'utilisateur :
- **Toast** : progress→ok (Statut device joignable) ; progress→err (device coupé, suffixe réseau/CORS) ; **un seul foyer** (haut-droite), plus aucun `#status` ni `#devbar`.
- **Busy** : double-clic Pousser → un seul envoi, boutons device grisés pendant l'I/O ; édition locale (drag/undo) **non bloquée** pendant un push.
- **Pastille** : ○ non vérifié → ● ip (infobulle détaillée) → ○ injoignable.
- **`showToast` local intact** : provoquer un doublon de nom de page dans l'arbre (toast « … est déjà utilisé ») ; un import KO (`file-io`).

- [ ] **Step 2 : Vérification finale + état des tests**

Run: `cd designer && node --test`
Expected: **301 tests**, 0 fail.
Run: `git status --short`
Expected: arbre propre après les commits des Tasks 1–4.

- [ ] **Step 3 : Mettre à jour le HANDOFF**

Dans `docs/_internal/HANDOFF.md` : marquer **Phase 5 ✅** dans le phasage (section « Phasage (7 phases) — état », ligne 26 : `5-7.` → détacher la 5), et résumer (toast.js modèle A `makeToast`/`morph` + spinner ; `withBusy` + verrou busy ; pastille `#dev-pill` paresseuse ; `formatDeviceStatus` testée node ; retrait `#status`/`#devbar`/`setStatus` ; hint réseau/CORS affiné). Mettre à jour la ligne « Date / DERNIER » en tête. Prochaine étape : **Phase 6** (barre d'état + console Problèmes/Source + scission `json-view.js`). Note : `HANDOFF.md` est **gitignoré** → édition seule, pas de commit.

---

## Self-Review (effectuée à la rédaction)

**1. Couverture spec (§3 du design doc) :**
- Pile unique de toasts + spinner muable en verdict (`morph`) → Task 1 (`makeToast`/`.morph`). ✓
- Toast verdict immédiat pour le local (export/copie) → `showToast` conservé (Task 1) ; appelants inchangés. ✓
- Toast progress pour les I/O longues (`/layout`, `/screenshot`, `/status`, `/update`) → Task 3 (`withBusy` sur load/push/statusbtn/values/capture/nav + pushVisible). ✓
- Suppression `#status` (header) → Task 3 (HTML/CSS/app/file-io). ✓
- `devbar` → pastille device toolbar (`● ip` / `○ injoignable`) + résumé en infobulle → Task 4 (`#dev-pill` + `formatDeviceStatus`). Résumé en `title` (barre d'état = Phase 6) — écart assumé, justifié. ✓
- Verrou busy (`withBusy`, boutons disabled, ré-entrée bloquée, éditions locales libres) → Task 3. ✓

**2. Scan placeholders :** aucun « TODO/TBD ». Tout step de code montre le code complet (anciens blocs cités intégralement pour le remplacement, pas par renvoi). ✓

**3. Cohérence des types/noms :**
- `makeToast(msg) → { morph(msg, kind, {ms}), dismiss() }` : défini Task 1, consommé par `withBusy` Task 3. ✓
- `showToast(message, {kind, ms})` : signature **inchangée** → 4 appelants existants intacts. ✓
- `withBusy(progressMsg, fn) → Promise<string|undefined>` : défini Task 3 ; `pushVisible` mappe `r !== undefined` → booléen (contrat `inspector.js:480` préservé). ✓
- `formatDeviceStatus(s) → { label, tooltip }` : défini/testé Task 2, consommé Task 4. ✓
- `setDeviceBusy`/`setDevicePill` : helpers app.js, pas d'API publique. ✓
- `deviceBtns` = `['load','push','values','statusbtn','capture','shot-prev','shot-next']` — tous présents dans `index.html`. `export`/`import`/`undo`/`redo` **exclus** (ops locales, non bloquées). ✓

**4. Risque d'ordre (TDZ) :** `pushVisible` (créé tôt dans `createInspector`) référence `withBusy` (déclaré plus bas) — sûr car appelé seulement au clic. Noté dans Task 3. ✓

**5. Périmètre :** 100 % designer (web + tests node). Aucune touche firmware / `render.js` / schéma. `<footer>` (Device/Sources/JSON) conservé (Phases 6/7). ✓
