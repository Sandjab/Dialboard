# Designer — refonte IHM Phase 7 : tiroir Device + retrait du footer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sortir la plomberie I/O du `<footer>` fourre-tout vers un **tiroir latéral droit** `⚙ Device` à deux onglets [Sorties physiques | Sources pull], et **supprimer le footer**. Dernière phase de la refonte IHM.

**Architecture :** Un module neuf `drawer.js` (slide-over droit, sur le pattern `.shot-overlay` + attribut `hidden`) qui pilote ouverture/fermeture (bouton `⚙ Device` toolbar, ✕, backdrop, Échap) et bascule d'onglet. Les panneaux existants (`device-panel.js`, `sources.js`) sont **réutilisés inchangés** : leurs points de montage `#device`/`#sources` (divs statiques) **migrent** du footer vers le tiroir, donc `app.js` continue de les monter à l'identique. Le nœud Document de l'inspecteur gagne un lien « Ouvrir la plomberie → » (spec §6). Aucune logique pure → pas de test node (DOM vérifié navigateur). `render.js`/firmware/schéma intacts.

**Tech Stack :** JS modules ES (designer), vérif navigateur Playwright (DOM). Spec : `docs/superpowers/specs/2026-06-21-designer-refonte-ihm-design.md` §5 (tiroir Device), §6 (lien plomberie Document), §2 (« ⚙ Device → tiroir latéral »).

---

## Contexte d'exécution (état au démarrage)

- Branche `feat/designer-refonte-ihm`, tip `5548d38` (Phase 6 ✅), arbre propre. `cd designer && node --test` → **313/313**.
- **Périmètre** : `designer/` uniquement. `render.js`, firmware, schéma : **intacts**.
- **Serveur de vérif** : `python3 -m http.server <port>` no-store **depuis la racine du repo** (`Dialboard/`), port libre ≠ 8000. Arrêter en fin de tâche.
- **État courant du HTML** (post Phase 6) : `<header>` (4 `.hgroup` + `#dev-pill`) → `<main>` (dock/canvas/inspecteur) → `#statusbar` → `#console` → `<footer>` (2 `<details>` : Device `#device`, Sources `#sources`). C'est ce `<footer>` que la Phase 7 supprime.
- **Patterns à réutiliser** : overlay = `.shot-overlay { position:fixed; inset:0; z-index:50 } .shot-overlay[hidden]{display:none}` (cf. `style.css`) ; panneaux = `.sources-panel` (conservé) ; bouton toolbar = style `button` global (ghost). Forward-référence d'un `const` dans une closure créée plus tôt = pattern **déjà utilisé** (`canvas` créé avant `inspector`, sa closure `onLiveMove` appelle `inspector.setLivePlacement`) → légitime pour `openDrawer: () => drawer.open()`.
- **Invariants** : ne pas régresser les gardes F1/F5 (ni canvas ni inspecteur composant touchés en Phase 7).

## File Structure

**Neuf :**
- `designer/js/drawer.js` — `createDrawer(root, { toggleBtn })`. Slide-over droit ; gère open/close (toggle/✕/backdrop/Échap) + bascule d'onglet ; retourne `{ open, close, toggle }`. Responsabilité unique : comportement du tiroir. **Aucune logique métier** → pas de test node (DOM, vérifié navigateur).

**Modifiés :**
- `designer/index.html` — supprime le `<footer>` ; ajoute `<aside id="drawer">` (backdrop + panneau : en-tête, onglets, 2 panes contenant les divs `#device`/`#sources` **déplacés**) ; ajoute un bouton `#drawer-toggle` « ⚙ Device » dans la toolbar (avant `#dev-pill`).
- `designer/style.css` — ajoute les règles `.drawer*` ; **retire** la règle morte `footer { … }`.
- `designer/js/app.js` — importe + instancie `createDrawer($('drawer'), { toggleBtn: $('drawer-toggle') })` ; passe `openDrawer: () => drawer.open()` à `createInspector`. `createDevicePanel($('device'), model)` / `createSources($('sources'), model)` **inchangés** (les éléments existent toujours, déplacés dans le tiroir).
- `designer/js/inspector.js` — `createInspector(..., { …, openDrawer })` ; `renderDoc` ajoute un lien « Ouvrir la plomberie (Device) → » appelant `openDrawer`.

**Réutilisés tels quels :** `device-panel.js`, `sources.js`, `physical.js`, `device.js`, `model.js`.

## Décisions de conception (verrouillées)

1. **Markup `#device`/`#sources` statique, déplacé tel quel.** Comme le footer les avait en divs statiques montés par `app.js`, on les garde statiques dans le tiroir → `app.js` ne change pas ses appels de montage. `drawer.js` ne fait QUE le comportement (open/close/onglets), pas le montage des panneaux.
2. **Pas de test node en Phase 7.** Le tiroir est 100 % présentation (afficher/masquer, bascule d'onglet) — aucune fonction pure à extraire (YAGNI). Vérification = navigateur. `node --test` reste **313**.
3. **Échap ferme le tiroir s'il est ouvert.** Listener `keydown` propre au tiroir (ne consomme rien si fermé). Le listener Échap global d'`app.js` (désélection) continue de tourner indépendamment : ouvrir le tiroir puis Échap ferme le tiroir ET vide une éventuelle sélection — effet double bénin et assumé (on n'édite pas une sélection en consultant la plomberie).
4. **`openDrawer` via forward-référence.** `createInspector` est instancié avant `createDrawer` dans `app.js` ; la closure `() => drawer.open()` capture le `const drawer` du scope `main()` et n'est appelée qu'au clic (après initialisation) — même pattern que la closure `onLiveMove`/`inspector` existante.
5. **Onglet par défaut = Sorties physiques.** Premier onglet du diagramme spec ([ Sorties physiques | Sources pull ]).

---

## Task 1 : Tiroir Device — `drawer.js` + markup + CSS + câblage + retrait du footer

**Files:**
- Create: `designer/js/drawer.js`
- Modify: `designer/index.html`
- Modify: `designer/style.css`
- Modify: `designer/js/app.js`

> DOM non unit-testable (convention projet) → vérif navigateur (contrôleur) en fin de tâche.

- [ ] **Step 1 : Créer `designer/js/drawer.js`**

```js
// Tiroir Device (Phase 7, spec §5) : slide-over latéral droit, deux onglets [Sorties physiques | Sources pull].
// Héberge les panneaux existants (#device via device-panel.js, #sources via sources.js — montés par app.js,
// inchangés). Géré ici : ouverture/fermeture (bouton ⚙ toolbar, ✕, Échap, clic backdrop) + bascule d'onglet.
// Câblage DOM, vérifié navigateur (aucune logique pure → pas de test node, cf. convention projet).
export function createDrawer(root, { toggleBtn }) {
  const backdrop = root.querySelector('.drawer-backdrop');
  const closeBtn = root.querySelector('.drawer-close');
  const tabs = [...root.querySelectorAll('.drawer-tab')];   // dataset.tab = 'device' | 'sources'
  const panes = { device: root.querySelector('#device-pane'), sources: root.querySelector('#sources-pane') };

  const setTab = (name) => {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    for (const [k, el] of Object.entries(panes)) el.hidden = k !== name;
  };
  const open = () => { root.hidden = false; };
  const close = () => { root.hidden = true; };
  const toggle = () => { root.hidden = !root.hidden; };

  toggleBtn.onclick = toggle;
  closeBtn.onclick = close;
  backdrop.onclick = close;
  tabs.forEach(t => { t.onclick = () => setTab(t.dataset.tab); });
  // Échap ferme le tiroir s'il est ouvert (ne consomme rien si fermé ; cohabite avec l'Échap global d'app.js).
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });

  setTab('device');   // onglet par défaut : Sorties physiques
  return { open, close, toggle };
}
```

- [ ] **Step 2 : `designer/index.html` — bouton « ⚙ Device » dans la toolbar**

Dans `<header>`, juste **avant** `<span id="dev-pill" …>`, insère :
```html
    <div class="hgroup">
      <button id="drawer-toggle" type="button" title="Plomberie I/O : sorties physiques (led_ring/sound) + sources pull">⚙ Device</button>
    </div>
```

- [ ] **Step 3 : `designer/index.html` — supprimer le `<footer>`, ajouter le tiroir**

**Supprime** entièrement le bloc :
```html
  <footer>
    <details>
      <summary>Device (sorties physiques)</summary>
      <div id="device" class="sources-panel"></div>
    </details>
    <details>
      <summary>Sources (pull réseau)</summary>
      <div id="sources" class="sources-panel"></div>
    </details>
  </footer>
```
**Ajoute** à la place (les divs `#device`/`#sources` y sont **déplacés** tels quels) :
```html
  <aside id="drawer" class="drawer" hidden>
    <div class="drawer-backdrop"></div>
    <div class="drawer-panel" role="dialog" aria-label="Device">
      <div class="drawer-head">
        <h2>Device</h2>
        <button class="drawer-close" type="button" title="Fermer">✕</button>
      </div>
      <div class="drawer-tabs">
        <button class="drawer-tab" type="button" data-tab="device">Sorties physiques</button>
        <button class="drawer-tab" type="button" data-tab="sources">Sources pull</button>
      </div>
      <div id="device-pane" class="drawer-pane">
        <div id="device" class="sources-panel"></div>
      </div>
      <div id="sources-pane" class="drawer-pane">
        <div id="sources" class="sources-panel"></div>
      </div>
    </div>
  </aside>
```

- [ ] **Step 4 : `designer/style.css` — règles du tiroir + retrait de `footer`**

**Retire** la règle morte (le footer n'existe plus) :
```css
footer { padding: 10px 12px; border-top: 1px solid var(--line); }
```
**Ajoute** (p. ex. juste avant `.shot-overlay` pour regrouper les overlays) :
```css
/* --- Tiroir Device (Phase 7) : slide-over latéral droit [Sorties physiques | Sources pull] --- */
.drawer { position: fixed; inset: 0; z-index: 60; }
.drawer[hidden] { display: none; }
.drawer-backdrop { position: absolute; inset: 0; background: rgba(8, 8, 12, .55); }
.drawer-panel { position: absolute; top: 0; right: 0; height: 100%; width: 340px; overflow: auto;
  background: var(--panel); border-left: 1px solid var(--line); padding: 14px;
  display: flex; flex-direction: column; gap: 12px; box-shadow: -8px 0 28px rgba(0, 0, 0, .4); }
.drawer-head { display: flex; align-items: center; justify-content: space-between; }
.drawer-head h2 { font-family: var(--font-ui); font-size: 12px; font-weight: 500; letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted); margin: 0; }
.drawer-tabs { display: flex; gap: 4px; }
.drawer-tab { font-size: 12px; padding: 4px 10px; }
.drawer-tab.active { color: var(--ink); border-color: var(--accent); }
.drawer-pane[hidden] { display: none; }
```

- [ ] **Step 5 : `designer/js/app.js` — instancier le tiroir**

1. Ajoute l'import (près des autres imports de modules UI, p. ex. après `import { createConsole } from './console.js';`) :
```js
import { createDrawer } from './drawer.js';
```
2. Après les appels `createSources($('sources'), model);` et `createDevicePanel($('device'), model);` (inchangés), ajoute :
```js
  const drawer = createDrawer($('drawer'), { toggleBtn: $('drawer-toggle') });
```
(`drawer` servira aussi au lien plomberie de l'inspecteur en Task 2. Pour l'instant il est ouvert par le bouton ⚙ Device.)

- [ ] **Step 6 : Vérifs**
```bash
cd /Users/jean-paulgavini/Documents/Dev/Dialboard/designer && node --check js/drawer.js && node --check js/app.js && node --test 2>&1 | grep -E "tests |pass |fail "
echo "--- footer retiré ? (doit être vide) ---"; grep -n "<footer\|</footer>\|footer {" index.html style.css
echo "--- #device et #sources présents une seule fois ? ---"; grep -c 'id="device"' index.html; grep -c 'id="sources"' index.html
```
Attendu : `node --check` OK ; **313/313** ; le grep footer ne renvoie **rien** ; `id="device"` = **1**, `id="sources"` = **1**.

- [ ] **Step 7 : Vérif navigateur (contrôleur, Playwright, no-store, racine repo)**
- Toolbar : bouton « ⚙ Device » présent ; plus de `<footer>` sous la console.
- Clic « ⚙ Device » → le tiroir glisse depuis la droite (onglet **Sorties physiques** actif, panneau led_ring/sound rendu) ; backdrop visible.
- Onglet **Sources pull** → le panneau sources (add/remove/url/intervalle) s'affiche ; le panneau Sorties se masque.
- Fermeture : ✕, clic backdrop, et **Échap** ferment le tiroir.
- Les panneaux device/sources **fonctionnent** (édition d'une source, etc.) comme avant (réutilisés inchangés).

- [ ] **Step 8 : Commit**
```bash
cd /Users/jean-paulgavini/Documents/Dev/Dialboard && git add designer/js/drawer.js designer/index.html designer/style.css designer/js/app.js && git commit -m "$(cat <<'EOF'
designer: tiroir Device (slide-over [Sorties physiques|Sources pull]) + retrait du footer

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP
EOF
)"
```

---

## Task 2 : Lien « Ouvrir la plomberie → » dans l'inspecteur Document

**Files:**
- Modify: `designer/js/inspector.js`
- Modify: `designer/js/app.js`
- Modify: `designer/style.css`

> DOM non unit-testable → vérif navigateur (contrôleur).

- [ ] **Step 1 : `designer/js/inspector.js` — option `openDrawer` + lien dans `renderDoc`**

1. Ajoute `openDrawer` à la déstructuration des options de `createInspector` (ligne ~85) :
```js
export function createInspector(root, model, { selection, rerenderCanvas, clearSelection, getActivePage = () => 0, previewProp, clearPreview, pushVisible, openDrawer } = {}) {
```
2. Dans `renderDoc(body)`, **après** la ligne `note(body, \`${np} page(s) · ${nc} composant(s)\`);` (fin de fonction, ~ligne 307), ajoute :
```js
    if (openDrawer) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'insp-link';
      link.textContent = 'Ouvrir la plomberie (Device) →';
      link.title = 'Sorties physiques (led_ring/sound) + sources pull';
      link.onclick = () => openDrawer();
      body.appendChild(link);
    }
```

- [ ] **Step 2 : `designer/js/app.js` — passer `openDrawer` à l'inspecteur**

Le `createInspector(...)` est appelé **avant** `const drawer = …` ; la closure capture `drawer` et n'est appelée qu'au clic (pattern forward-ref déjà utilisé pour `inspector`). Ajoute `openDrawer` à l'objet d'options de `createInspector` :
```js
    openDrawer: () => drawer.open(),
```
(à insérer dans l'objet options passé à `createInspector`, p. ex. juste après `pushVisible: async (id, visible) => { … }`).

- [ ] **Step 3 : `designer/style.css` — style du lien**

Ajoute (près des autres règles `.insp-*`) :
```css
.insp-link { margin-top: 10px; align-self: flex-start; font-size: 12px; color: var(--info); border-color: transparent; padding: 2px 0; }
.insp-link:hover:not(:disabled) { color: var(--ink); background: transparent; border-color: transparent; text-decoration: underline; }
```

- [ ] **Step 4 : Vérifs**
```bash
cd /Users/jean-paulgavini/Documents/Dev/Dialboard/designer && node --check js/inspector.js && node --check js/app.js && node --test 2>&1 | grep -E "tests |pass |fail "
```
Attendu : `node --check` OK ; **313/313**.

- [ ] **Step 5 : Vérif navigateur (contrôleur)**
- Sélectionner le nœud **Document** dans l'arbre → l'inspecteur affiche le lien « Ouvrir la plomberie (Device) → ».
- Clic sur le lien → le tiroir Device s'ouvre (même tiroir que le bouton ⚙ Device).

- [ ] **Step 6 : Commit**
```bash
cd /Users/jean-paulgavini/Documents/Dev/Dialboard && git add designer/js/inspector.js designer/js/app.js designer/style.css && git commit -m "$(cat <<'EOF'
designer: inspecteur Document — lien « Ouvrir la plomberie → » (ouvre le tiroir Device)

Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP
EOF
)"
```

---

## Task 3 : Vérification finale + revue + HANDOFF

**Files:**
- Modify: `docs/_internal/HANDOFF.md` (gitignoré — édition disque, pas de commit)

- [ ] **Step 1 : Suite complète + grep anti-résidu**
```bash
cd /Users/jean-paulgavini/Documents/Dev/Dialboard/designer && node --test 2>&1 | grep -E "tests |pass |fail "
grep -rn "<footer\|</footer>\|footer {" index.html style.css || echo "OK : plus de footer"
```
Attendu : **313/313** ; « OK : plus de footer ».

- [ ] **Step 2 : Revue de code finale indépendante** (subagent) sur le diff Phase 7 : `git diff <tip-phase6>..HEAD -- designer/`. Vérifier : périmètre livré, pas d'over-engineering, panneaux réutilisés sans régression, pas de fuite de listener anormale, footer bien retiré. Corriger les findings non-mineurs avant de clore.

- [ ] **Step 3 : Récapitulatif de vérif navigateur** (captures à l'utilisateur, juge visuel) :
- ⚙ Device ouvre le tiroir ; 2 onglets fonctionnels ; ✕/backdrop/Échap ferment ; panneaux device/sources opérationnels.
- Lien plomberie du Document inspecteur ouvre le tiroir.
- Plus de footer. Non-régression : barre d'état/console (Phase 6), sélection/canvas/inspecteur (F1/F5), undo/redo.

- [ ] **Step 4 : Mettre à jour `docs/_internal/HANDOFF.md`** (gitignoré, pas de commit) : Phase 7 ✅ → **refonte IHM terminée** (7/7 phases) ; tip, compte commits, `node --test` 313 ; noter que la branche `feat/designer-refonte-ihm` est complète et prête (selon décision utilisateur : merge/PR — hors scope de ce plan, push sur demande).

---

## Self-Review (couverture spec)

- **§5 tiroir Device** — slide-over droit, 2 onglets [Sorties physiques | Sources pull], réutilise `device-panel.js`/`sources.js` inchangés (Task 1) ✅.
- **§2 « ⚙ Device → tiroir latéral »** — bouton toolbar `#drawer-toggle` (Task 1) ✅.
- **§6 lien plomberie Document** — « Ouvrir la plomberie → » dans `renderDoc` (Task 2) ✅.
- **Retrait du `<footer>`** — supprimé (Task 1) ✅.
- **Hors scope** — direction artistique (thème/couleurs/densité) : passe dédiée ultérieure, non couverte ici (conforme à la spec).
- **Tests** — aucune fonction pure ajoutée (DOM pur) → pas de test node ; vérif navigateur (Task 1/2). `node --test` reste 313.
- **Invariants F1/F5** — canvas/inspecteur composant non touchés (seul `renderDoc` gagne un lien) ; vérifiés en non-régression (Task 3).
