# Inspecteur contextuel (Phase 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commits :** chaque `git commit` de ce plan se termine par la ligne `Claude-Session: https://claude.ai/code/session_01TSUWuE3MaqEn6ELiXguwpP` (convention harnais). Push **uniquement sur demande explicite**.

**Goal:** L'inspecteur (colonne droite) affiche **une** vue parmi trois — Document / Page / Composant — pilotée par `selection.kind`, supprimant la « démarcation floue » de l'ancien panneau fourre-tout.

**Architecture:** Refactor d'aiguillage dans `inspector.js`. La vue Composant existante est extraite telle quelle dans `renderComp()` (zéro changement de comportement). Deux nouvelles vues pures-DOM `renderDoc()` (title/background/nav.wrap) et `renderPage(pageIndex)` (name/fond couleur/image) reprennent le contenu de l'ancien `renderPagePanel`, désormais supprimé. `render()` lit `selection.get()` et aiguille. Une seule mutation pure nouvelle : `setNavWrap` (le seul champ Document non encore éditable). Au démarrage, la sélection initiale devient le nœud Document (sinon l'inspecteur serait vide au lancement) ; `null` (après Échap / clic-vide) affiche un placeholder neutre — **Option 1 validée** : cohérence stricte arbre↔inspecteur, « Échap vide tout » conservé.

**Tech Stack:** JS modules ES (designer), tests `node --test` (cœur pur, sans DOM), vérification navigateur Playwright (serveur no-store).

---

## Décisions verrouillées (rappel)

- **État « rien sélectionné »** : Option 1. `selection === null` → placeholder neutre ; démarrage → nœud Document sélectionné ; raccourci « Échap vide toute sélection » **inchangé** (fix 3a préservé).
- **`nav.wrap`** : booléen, défaut firmware **`true`** (boucle). Case cochée = boucler ; décochée = buter. Édité via une mutation pure `setNavWrap` (testée node).
- **`name` de page** : éditable dans la vue Page **en plus** du rename inline de l'arbre (deux surfaces, voulu — cf. spec §2). Réutilise la garde-doublon existante `pageNameTaken` + `showToast`. Pas de contrainte ASCII (le `name` est un libellé designer, pas un texte poussé au device — contrairement à `title`).
- **Lien « Ouvrir la plomberie → »** de la vue Document (spec §2) : **différé en Phase 7** (le tiroir Device n'existe pas encore — YAGNI, pas de lien vers une cible inexistante).
- **`title` / `background`** : restent édités **inline** dans le commit (comme aujourd'hui), simplement déplacés dans `renderDoc`. On ne les transforme pas en mutations (Rule 3, surgical).

## File Structure

| Fichier | Rôle | Action |
|---|---|---|
| `designer/js/mutations.js` | Mutations pures du modèle | **Modifier** : +`setNavWrap` |
| `designer/tests/mutations.test.js` | Tests node des mutations | **Modifier** : +import +3 tests `setNavWrap` |
| `designer/js/inspector.js` | Inspecteur (aiguillage + vues) | **Modifier** : +`renderComp` (extraction) ; +`renderDoc`/`renderPage`/`renderEmpty` ; `render()` aiguille sur `kind` ; −`renderPagePanel` ; +imports `setNavWrap`/`renamePage`/`pageNameTaken`/`showToast` |
| `designer/js/app.js` | Câblage / coordinateur | **Modifier** : 1 ligne — `createSelection({ kind: 'doc' })` |
| `designer/style.css` | CSS structurelle | **Vérifier** au navigateur ; ajustement structurel mineur seulement si une vue casse (pas de DA — hors scope) |

**Invariants à NE PAS régresser** (cf. `CLAUDE.md` « invariants inspecteur/canvas ») :
- **F1** : changer de sélection blur le champ focalisé avant de muter `selection` (logique dans `app.js` `setSelection` — non touchée).
- **F5** : les closures de commit figent `sel.ref`/`placeIndex` au rendu (préservé dans `renderComp`).
- **Coalescence num** (F2) + `focusout` (restaure l'aperçu couleur + casse la coalescence) : le listener `focusout` reste au niveau `root`, indépendant de la vue.
- **Garde-focus** de `render()` : pas de rebuild pendant qu'un champ de l'inspecteur a le focus.

---

## Task 1 : Mutation `setNavWrap`

**Files:**
- Modify: `designer/js/mutations.js` (après `setThresholds`, vers la ligne 116)
- Test: `designer/tests/mutations.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `designer/tests/mutations.test.js`, ajouter `setNavWrap` à l'import (bloc `from '../js/mutations.js'`) puis ajouter ces tests à la fin du fichier :

```js
test('setNavWrap : crée nav.wrap quand nav est absent', () => {
  const s = fresh();
  setNavWrap(s, false);
  assert.equal(s.nav.wrap, false);
});

test('setNavWrap : met à jour wrap sans détruire l’objet nav', () => {
  const s = fresh(); s.nav = { wrap: false };
  setNavWrap(s, true);
  assert.equal(s.nav.wrap, true);
});

test('setNavWrap : coerce en booléen (intention : jamais de valeur non-bool dans le layout)', () => {
  const s = fresh();
  setNavWrap(s, 1);
  assert.equal(s.nav.wrap, true);
  setNavWrap(s, 0);
  assert.equal(s.nav.wrap, false);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd designer && node --test`
Expected: FAIL — `setNavWrap is not a function` (import non résolu / `ReferenceError`).

- [ ] **Step 3 : Implémenter la mutation**

Dans `designer/js/mutations.js`, après la fonction `setThresholds` (juste avant `uniquePageName`), ajouter :

```js
// Navigation circulaire (nav.wrap) : true = boucle (dernière page → première, défaut firmware), false =
// bute au bord. Crée l'objet nav au besoin ; n'écrit que la clé wrap (le spread préserve d'éventuelles
// futures clés nav). Coerce en booléen — le layout ne porte jamais de wrap non-bool.
export function setNavWrap(state, wrap) {
  state.nav = { ...(state.nav || {}), wrap: !!wrap };
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd designer && node --test`
Expected: PASS — 294 + 3 = **297 tests**, 0 fail.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/mutations.js designer/tests/mutations.test.js
git commit -m "designer: mutations — setNavWrap (nav.wrap éditable, défaut true)"
```

---

## Task 2 : Extraire la vue Composant dans `renderComp` (refactor neutre)

**But :** isoler le contenu composant actuel dans une fonction dédiée, **sans changer le comportement**, pour préparer l'aiguillage. À l'issue de cette tâche, l'app se comporte **exactement** comme avant.

**Files:**
- Modify: `designer/js/inspector.js:371-476` (la fonction `render()` actuelle)

- [ ] **Step 1 : Créer `renderComp(body, c, p)` à partir du corps composant de `render()`**

Dans `designer/js/inspector.js`, **déplacer verbatim** le bloc qui va de la création du `head` (`const head = document.createElement('div'); head.className = 'insp-head';`, ligne ~385) jusqu'à `body.appendChild(del);` (ligne ~474) dans une nouvelle fonction placée **juste avant** `function render()` :

```js
// Vue Composant : props/géométrie/seuils/aperçu mock + œil d'en-tête + bouton device visible + suppr.
// Contenu inchangé (extrait de l'ancien render()) ; F5 (ref figée au rendu) et coalesce num préservés.
function renderComp(body, c, p) {
  // <<< coller ici, INCHANGÉ, le bloc head…del de l'ancien render() (lignes ~385 à ~474) >>>
}
```

Le bloc déplacé commence par `const head = document.createElement('div'); head.className = 'insp-head';` et se termine par `body.appendChild(del);`. Il référence `sel.ref`, `sel.placeIndex`, `getActivePage()`, `comp()`, `place()`, `renderExtras`, `pushVisible`, `deviceHidden`, `COMPONENTS` — tous toujours en portée (variables/fonctions du closure `createInspector`). **Ne rien renommer.**

- [ ] **Step 2 : Réécrire `render()` pour appeler `renderComp` (comportement identique)**

Remplacer la fonction `render()` par :

```js
function render() {
  // garde focus : ne pas reconstruire pendant qu'un champ de l'inspecteur est en cours d'édition.
  if (root.contains(document.activeElement) && document.activeElement !== document.body) return;
  sel = currentSel();   // source de vérité : le store partagé (recalculé à chaque rendu)
  if (_aimgPreviewTimer) { clearInterval(_aimgPreviewTimer); _aimgPreviewTimer = null; }   // stoppe l'aperçu avant tout rebuild
  root.querySelectorAll('.insp-body').forEach(n => n.remove());
  placementInputs = {};   // les anciens champs viennent d'être retirés
  const c = comp();
  const p = place();
  const body = document.createElement('div');
  body.className = 'insp-body';
  if (!c || !p) {                               // sélection absente ou obsolète → ancien panneau (provisoire)
    renderPagePanel(body); root.appendChild(body); return;
  }
  renderComp(body, c, p);
  root.appendChild(body);
}
```

> Note : `renderPagePanel` est encore appelé ici — il sera remplacé par l'aiguillage Document/Page/Empty en Task 3. Cette étape ne fait que l'extraction.

- [ ] **Step 3 : Vérifier la syntaxe**

Run: `cd designer && node --check js/inspector.js && node --test`
Expected: pas d'erreur ; **297 tests** PASS (aucun test DOM, donc inchangé).

- [ ] **Step 4 : Vérification navigateur — non-régression composant**

Servir le designer en no-store (cf. mémoire `designer-verif-navigateur` : serveur `Cache-Control: no-store`, port ≠ 8000) et, via Playwright (vrais events pointer, pas `.click()`) :
1. Cliquer un widget sur le canvas → l'inspecteur montre `type · ref`, l'œil, les champs.
2. Éditer une couleur (input → change) → le bon composant change (F5).
3. Flèches sur un champ num → **une** entrée d'undo (F2, vérifier avec Cmd+Z).
4. Sélectionner un autre widget pendant l'édition d'un champ → l'édition se committe sur l'ancien, l'inspecteur bascule (F1).

Expected: comportement identique à avant le refactor.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/inspector.js
git commit -m "designer: inspecteur — extraire renderComp (refactor neutre, prépare l'aiguillage)"
```

---

## Task 3 : Aiguillage contextuel — `renderDoc` / `renderPage` / `renderEmpty`

**But :** scinder l'ancien `renderPagePanel` (qui mêlait globales Document + page active) en deux vues distinctes, ajouter le placeholder, et aiguiller `render()` sur `selection.kind`. Supprimer `renderPagePanel`.

**Files:**
- Modify: `designer/js/inspector.js` (imports en tête ; +3 fonctions ; `render()` ; −`renderPagePanel`)

- [ ] **Step 1 : Étendre les imports**

En tête de `designer/js/inspector.js`, étendre l'import depuis `./mutations.js` avec `setNavWrap, renamePage, pageNameTaken`, et ajouter un import `showToast` :

```js
import { setComponentProp, setPlacementProp, setBarOrientation, setThresholds, removePlacementAndOrphan, setPageBackground, setPageBackgroundImage, setNavWrap, renamePage, pageNameTaken } from './mutations.js';
import { showToast } from './toast.js';
```

(Les autres imports — `bg-image`, `image-asset`, `image-anim-asset`, `registry`, `geometry`, `mocks` — restent inchangés.)

- [ ] **Step 2 : Ajouter `renderEmpty(body)`**

Juste avant `function renderComp` (ou après `note()`), ajouter le placeholder neutre (réutilise la classe `.todo` déjà stylée) :

```js
// Rien de sélectionné (null / sélection périmée) : placeholder neutre. Cohérence stricte arbre↔inspecteur
// (Option 1) : on n'édite rien tant que rien n'est sélectionné.
function renderEmpty(body) {
  const tip = document.createElement('p'); tip.className = 'todo';
  tip.textContent = 'Rien de sélectionné — choisis un élément dans l’arbre, ou un widget sur le canvas.';
  body.appendChild(tip);
}
```

- [ ] **Step 3 : Ajouter `renderDoc(body)` (Document : title / background / nav.wrap)**

Ajouter, après `renderEmpty` :

```js
// Vue Document : params globaux du layout. title (poussé au device → ASCII) + background (couleur globale)
// + nav.wrap (boucle de navigation). Reprend l'édition inline title/background de l'ancien renderPagePanel.
function renderDoc(body) {
  const s = model.state;
  const head = document.createElement('div'); head.className = 'insp-head';
  const title = document.createElement('span'); title.textContent = 'Document';
  head.appendChild(title);
  body.appendChild(head);

  const titleInput = makeInput('text', s.title ?? '', v => model.commit(st => { st.title = v; }));
  body.appendChild(fieldRow('Titre', titleInput, { ascii: true }));          // texte affiché par le device = ASCII
  const bg = makeInput('color', s.background || '#000000', v => model.commit(st => { st.background = v; }));
  body.appendChild(fieldRow('Fond', bg));

  sub(body, 'Navigation');
  // wrap : défaut firmware true (boucle). Coché = boucler (dernière → première) ; décoché = buter au bord.
  const wrap = s.nav?.wrap !== false;
  const cb = makeInput('bool', wrap, v => model.commit(st => setNavWrap(st, v)));
  body.appendChild(fieldRow('Boucler la navigation', cb));

  const np = s.pages?.length ?? 0;
  const nc = Object.keys(s.components || {}).length;
  note(body, `${np} page(s) · ${nc} composant(s)`);
}
```

- [ ] **Step 4 : Ajouter `renderPage(body, pi)` (Page : name / fond couleur / image)**

Ajouter, après `renderDoc`. Ce code reprend le bloc « Page active » de l'ancien `renderPagePanel` (lignes ~131-203), **paramétré par `pi`** (au lieu de `getActivePage()`), précédé d'un en-tête « Page » et d'un champ `name` (garde-doublon partagée) :

```js
// Vue Page : nom de la page (libellé designer — pas poussé au device, donc pas de garde ASCII ; garde-
// doublon partagée avec l'arbre via pageNameTaken) + fond couleur (override/hérité) + image de fond.
function renderPage(body, pi) {
  const s = model.state;
  const pg = s.pages?.[pi];
  if (!pg) { renderEmpty(body); return; }   // robustesse : page disparue (reorder/suppr concurrente)

  const head = document.createElement('div'); head.className = 'insp-head';
  const htitle = document.createElement('span'); htitle.textContent = `Page « ${pg.name || `Page ${pi + 1}`} »`;
  head.appendChild(htitle);
  body.appendChild(head);

  // Nom : commit sur change ; vide → ignoré (on garde l'ancien) ; doublon → toast + re-render (revient à pg.name).
  const name = makeInput('text', pg.name ?? '', v => {
    const nv = (v || '').trim();
    if (!nv || nv === (pg.name || '')) { render(); return; }       // vide / inchangé → resync l'input
    if (pageNameTaken(s, nv, pi)) { showToast(`« ${nv} » est déjà utilisé`); render(); return; }
    model.commit(st => renamePage(st, pi, nv));
  });
  body.appendChild(fieldRow('Nom', name));

  // Fond de la page : override optionnel. (hérité) si absent (= fond global) ; ↺ pour réhériter sinon.
  const hasBgImg = !!pg.background_image;   // image présente → la couleur de page n'est plus qu'un repli
  const pbg = makeInput('color', pg.background || s.background || '#000000',
    v => model.commit(st => setPageBackground(st, pi, v)));
  const row = fieldRow('Fond page', pbg);
  if (hasBgImg) { row.classList.add('insp-row--fallback'); pbg.title = "Repli : ne s'affiche que si l'image de fond est absente."; }
  if (pg.background == null) {
    const hint = document.createElement('span'); hint.className = 'insp-bg-hint'; hint.textContent = '(hérité)';
    row.appendChild(hint);
  } else {
    const reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'insp-bg-reset'; reset.textContent = '↺';
    reset.title = 'Hériter du fond global';
    reset.addEventListener('click', () => model.commit(st => setPageBackground(st, pi, null)));
    row.appendChild(reset);
  }
  body.appendChild(row);

  // Image de fond de la page : override optionnel, prime sur la couleur. File natif masqué, ouvert par le
  // bouton dossier ; conversion + upload au navigateur (bg-image.js) ; la clé (hash) est posée dans le layout.
  const imgRow = document.createElement('div'); imgRow.className = 'insp-row insp-bg-row';
  const imgLabel = document.createElement('span'); imgLabel.className = 'insp-label';
  imgLabel.textContent = 'Image de fond';
  imgRow.appendChild(imgLabel);
  const file = document.createElement('input');
  file.type = 'file'; file.accept = 'image/*'; file.className = 'insp-bg-file';   // masqué (CSS), ouvert par le bouton dossier
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; if (!f) return;
    try {
      const { key } = await imageFileToBg(f);
      model.commit(st => setPageBackgroundImage(st, pi, key));
    } catch (e) { console.error('bg image:', e); }
    file.value = '';
  });
  imgRow.appendChild(file);
  if (pg.background_image) {                                  // aperçu ; cadre « octets sur le device » si pas en cache local
    const u = previewUrl(pg.background_image);
    if (u) {
      const thumb = document.createElement('img');
      thumb.className = 'insp-bg-thumb'; thumb.src = u; thumb.alt = 'aperçu du fond';
      imgRow.appendChild(thumb);
    } else {
      const ph = document.createElement('span');
      ph.className = 'insp-bg-thumb insp-bg-thumb--empty';
      ph.title = 'Fond défini — aperçu indisponible (octets stockés sur le device)';
      const phIcon = document.createElement('img');
      phIcon.src = IMAGE_URI; phIcon.width = 18; phIcon.height = 18; phIcon.alt = '';
      ph.appendChild(phIcon);
      imgRow.appendChild(ph);
    }
  }
  const pick = document.createElement('button');
  pick.type = 'button'; pick.className = 'insp-iconbtn';
  pick.title = pg.background_image ? "Changer l'image" : "Choisir une image";
  const pickIcon = document.createElement('img');
  pickIcon.src = FOLDER_URI; pickIcon.width = 16; pickIcon.height = 16; pickIcon.alt = pick.title;
  pick.appendChild(pickIcon);
  pick.addEventListener('click', () => file.click());
  imgRow.appendChild(pick);
  if (pg.background_image) {
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'insp-iconbtn';
    del.title = "Retirer l'image";
    const delIcon = document.createElement('img');
    delIcon.src = TRASH_URI; delIcon.width = 16; delIcon.height = 16; delIcon.alt = "Retirer l'image";
    del.appendChild(delIcon);
    del.addEventListener('click', () => model.commit(st => setPageBackgroundImage(st, pi, null)));
    imgRow.appendChild(del);
  }
  body.appendChild(imgRow);
  if (hasBgImg) note(body, "L'image de fond prime sur la couleur ; celle-ci sert de repli si l'image est absente du device.");

  const onPage = pg.place?.length ?? 0;
  note(body, `${onPage} composant(s) placé(s) sur cette page`);
}
```

- [ ] **Step 5 : Réécrire `render()` pour aiguiller sur `selection.kind`, et supprimer `renderPagePanel`**

Remplacer la fonction `render()` par :

```js
function render() {
  // garde focus : ne pas reconstruire pendant qu'un champ de l'inspecteur est en cours d'édition.
  if (root.contains(document.activeElement) && document.activeElement !== document.body) return;
  sel = currentSel();   // null sauf composant valide (le `ref` se DÉRIVE — cf. spec §1)
  if (_aimgPreviewTimer) { clearInterval(_aimgPreviewTimer); _aimgPreviewTimer = null; }   // stoppe l'aperçu avant tout rebuild
  root.querySelectorAll('.insp-body').forEach(n => n.remove());
  placementInputs = {};   // les anciens champs viennent d'être retirés
  const body = document.createElement('div'); body.className = 'insp-body';
  const s = selection.get();
  const c = sel ? comp() : null;   // composant vivant (sel non-null ⇒ kind comp ; null si ref orpheline)
  if (c) {                                             // composant valide → vue Composant
    renderComp(body, c);
  } else if (s && s.kind === 'doc') {                  // nœud Document → globales
    renderDoc(body);
  } else if (s && s.kind === 'page' && model.state.pages?.[s.page]) {   // page existante → vue Page
    renderPage(body, s.page);
  } else {                                             // null / périmé / ref orpheline → placeholder
    renderEmpty(body);
  }
  root.appendChild(body);
}
```

> Note robustesse : `renderComp` est à **2 arguments** (`body, c`) depuis la Task 2. `c = sel ? comp() : null` retombe sur le placeholder si la sélection composant pointe une ref orpheline (composant absent de la map) — l'ancien `render()` retombait sur le panneau Layout dans ce cas ; le placeholder est l'équivalent gracieux ici (pas de crash sur `c.type`).

Puis **supprimer entièrement** la fonction `renderPagePanel(body)` (l'ancien bloc, lignes ~117-210) : son contenu vit désormais dans `renderDoc` + `renderPage`.

- [ ] **Step 6 : Vérifier la syntaxe**

Run: `cd designer && node --check js/inspector.js && node --test`
Expected: pas d'erreur ; **297 tests** PASS.

Vérifier aussi qu'aucune référence orpheline à `renderPagePanel` ne subsiste :
Run: `grep -n renderPagePanel designer/js/inspector.js`
Expected: aucune ligne.

- [ ] **Step 7 : Vérification navigateur — les trois vues**

Servir no-store + Playwright (vrais events pointer). Scénarios :
1. **Document** : cliquer le nœud `⚙ Document` de l'arbre → inspecteur « Document » avec Titre / Fond / Boucler la navigation / résumé `N pages · M composants`. Éditer le titre → persiste (Cmd+Z annule). Cocher/décocher « Boucler » → `model.toJSON()` contient `nav.wrap` à jour (lisible via la console Source ou `localStorage`).
2. **Page** : cliquer une ligne page de l'arbre → inspecteur « Page « … » » avec Nom / Fond page / Image de fond. Renommer via le champ Nom → l'arbre reflète le nouveau nom. Saisir un nom **déjà pris** → toast « … est déjà utilisé », l'input revient à l'ancien nom (pas de commit).
3. **Composant** : cliquer un widget → vue Composant **identique** à avant (Task 2). F1/F5/F2 toujours OK.
4. **Placeholder** : Échap (ou clic dans le vide du disque) → inspecteur affiche « Rien de sélectionné … ».

- [ ] **Step 8 : Commit**

```bash
git add designer/js/inspector.js
git commit -m "designer: inspecteur — aiguillage contextuel Document/Page/Composant (Phase 4)"
```

---

## Task 4 : Démarrage sur le nœud Document

**Files:**
- Modify: `designer/js/app.js:65`

- [ ] **Step 1 : Sélection initiale = Document**

Dans `designer/js/app.js`, remplacer :

```js
  const selection = createSelection(null);
```

par :

```js
  // Démarrage sur le nœud Document (Option 1) : l'inspecteur montre les globales au lancement plutôt que
  // le placeholder vide. Échap / clic-vide ramènent ensuite à null (placeholder). placementSelection({kind:
  // 'doc'}) = null → aucune surbrillance canvas ; les raccourcis copier/coller/suppr lisent canvas.getSelected()
  // (index de placement), indépendant de la sélection doc.
  const selection = createSelection({ kind: 'doc' });
```

- [ ] **Step 2 : Vérifier la syntaxe**

Run: `cd designer && node --check js/app.js && node --test`
Expected: pas d'erreur ; **297 tests** PASS.

- [ ] **Step 3 : Vérification navigateur — boot + interactions sélection vide**

1. **Recharger** la page (état neuf) → l'inspecteur affiche directement la vue **Document** ; le nœud `⚙ Document` de l'arbre est surligné.
2. Sélectionner un widget puis **Échap** → placeholder « Rien de sélectionné ».
3. Cliquer dans le vide du disque → placeholder.
4. Copier (Cmd+C) un widget, puis **Échap**, puis Coller (Cmd+V) → le coller fonctionne toujours (presse-papier indépendant de la sélection doc).

- [ ] **Step 4 : Commit**

```bash
git add designer/js/app.js
git commit -m "designer: démarrage de la sélection sur le nœud Document (Option 1)"
```

---

## Task 5 : Vérification navigateur intégrale + ajustement CSS structurel éventuel

**But :** valider l'ensemble à l'écran et corriger un éventuel défaut **structurel** (alignement case à cocher, en-tête) — **pas** de direction artistique (couleurs/typo/densité = hors scope, passe DA ultérieure).

**Files:**
- Modify (si nécessaire seulement) : `designer/style.css`

- [ ] **Step 1 : Parcours complet Playwright (captures par lot)**

Servir no-store. Capturer, pour validation async par l'utilisateur :
- Vue Document (title/bg/wrap/résumé).
- Vue Page (name/fond hérité, puis fond override avec ↺, puis avec image → note de priorité).
- Vue Composant (un widget data : couleur + seuils + mock).
- Placeholder (après Échap).
- Bascule rapide Document → Page → Composant → Document (pas de résidu, pas de champ figé).

- [ ] **Step 2 : Corriger un défaut structurel si observé**

Si la case à cocher « Boucler » ou un en-tête s'aligne mal dans `.insp-row` / `.insp-head`, ajuster **a minima** dans `style.css` (ex. `.insp-row input[type=checkbox]{ margin-left:auto }`). Documenter le motif en commentaire. **Ne pas** retoucher couleurs/espacements globaux.

- [ ] **Step 3 : Vérification finale + état des tests**

Run: `cd designer && node --test`
Expected: **297 tests**, 0 fail.
Run: `git status --short`
Expected: arbre propre après commit.

- [ ] **Step 4 : Commit (si Step 2 a modifié le CSS)**

```bash
git add designer/style.css
git commit -m "designer: inspecteur — alignement structurel des vues contextuelles"
```

- [ ] **Step 5 : Mettre à jour le HANDOFF**

Dans `docs/_internal/HANDOFF.md` : marquer **Phase 4 ✅** dans le phasage (ligne 25 / section « Phasage »), et résumer (mutation `setNavWrap`, 3 vues, démarrage Document, placeholder). Prochaine étape : **Phase 5** (notifications + busy).

---

## Self-Review (effectuée à la rédaction)

**1. Couverture spec (§2 + §6 du design doc) :**
- Document = title/background/nav.wrap → Task 3 `renderDoc` + Task 1 `setNavWrap`. ✓
- Page = name/fond couleur/image → Task 3 `renderPage`. ✓
- Composant = inchangé, point d'entrée par la sélection → Task 2 `renderComp` + aiguillage Task 3. ✓
- Aiguillage sur `selection.kind` (spec « Inspecteur contextualisé », étape 4) → Task 3 `render()`. ✓
- Lien « plomberie → » : **explicitement différé** (Phase 7, tiroir inexistant) — noté dans Décisions verrouillées. ✓ (écart assumé, justifié)

**2. Scan placeholders :** aucun « TODO/TBD » ; tout step de code montre le code complet. Le seul renvoi (« coller le bloc head…del de l'ancien render() ») est un **déplacement verbatim** de code existant, balisé par ses lignes de début/fin — pas un placeholder. ✓

**3. Cohérence des types/noms :**
- `setNavWrap(state, wrap)` : même signature en Task 1 (def + tests) et Task 3 (`setNavWrap(st, v)`). ✓
- `renderComp(body, c, p)` / `renderDoc(body)` / `renderPage(body, pi)` / `renderEmpty(body)` : signatures stables entre Task 2/3 et leurs appels dans `render()`. ✓
- `pageNameTaken(state, name, exceptIndex)` / `renamePage(state, pageIndex, name)` : conformes aux signatures de `mutations.js` (vérifiées) et au pattern de `tree.js`. ✓
- `nav.wrap` : lu `s.nav?.wrap !== false` (défaut true) en Task 3, écrit `!!wrap` en Task 1 → cohérent (jamais de wrap non-bool). ✓

**Invariants F1–F5 :** F1 (app.js, non touché), F5 (refs figées, dans `renderComp` extrait verbatim), F2/coalesce/focusout (listener `root`, non touché), garde-focus (préservé dans `render()`). ✓
