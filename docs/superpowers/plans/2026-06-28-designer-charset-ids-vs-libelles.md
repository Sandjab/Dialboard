# WS-2 — Contrat charset « IDs vs libellés » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Séparer dans le contrat du layout les *identifiants* (`^[A-Za-z0-9_]+$`) du *contenu d'affichage* (Latin-1), pour préparer l'i18n du designer (WS-1) et corriger l'asymétrie actuelle où les IDs sont non contraints et les libellés sur-contraints (ASCII alors que les fontes rendent Latin-1).

**Architecture:** Le schéma JSON (`schema/layout.schema.json`) est la source de vérité, validé par ajv côté designer. On ajoute deux `$defs` (`id`, `display`) et on rebranche chaque champ. Les générateurs de noms (designer) sont corrigés pour produire des ids valides, des gardes empêchent la saisie d'ids invalides, et les messages d'erreur sont humanisés. Aucun changement firmware (parser tolérant, fontes Latin-1 déjà présentes).

**Tech Stack:** JS ES modules (vanilla, sans build), ajv (vendorisé), `node --test` (designer). Branche : `feat/designer-charset-ids-vs-libelles`.

**Spec :** `docs/superpowers/specs/2026-06-28-designer-charset-ids-vs-libelles-design.md`

**Convention de commit :** messages `feat(designer):` / `test(designer):` ; terminer chaque message par le footer `Claude-Session:` de la session courante.

> **Déviations d'exécution (mises à jour pendant l'implémentation) :**
> - Format des noms de page générés figé sur **underscore** : `Page_1`, `Page_2`… et `<base>_copie`, `<base>_copie2`… (et non `Page1`/`(copie)`). Raison : cohérence avec `default-layout` `Page_1` et la convention `_copie`.
> - Les **3 générateurs de noms de page** (`uniquePageName`, `uniqueCopyName`, fallback `duplicatePage`) + `default-layout.js` sont traités **dans le lot de la Task 1** (le resserrement du schéma les casse → même unité logique). Découle de la revue qualité Task 1.
> - **Task 3 réduite** à : `isValidId` + gardes défensives `renameComponent`/`renamePage` (les générateurs en sont retirés).
> - **Task 4 (`default-layout`) : faite** (commit Task 1, `Page_1`).

---

## Task 1 : Schéma — `$defs` id/display + rebranchement de tous les champs

**Files:**
- Modify: `schema/layout.schema.json` (`$defs` + champs aux lignes 10, 19, 113, 114, 129, 130, 131, 146, 147, 170, 186, 220, 235, 275, 286, 323, et `$defs/source` `name`/`vars`, `$defs/page` `name`)
- Test: `designer/tests/schema.test.js`

> **Risque ajv** : l'enforcement des clés `components`/`vars` repose sur `propertyNames` (draft-07). Si l'ajv vendorisé ne le supporte pas, le test « clé invalide rejetée » ne passera pas à l'étape 4 → repli : porter ces deux contraintes de clés dans la couche sémantique `designer/js/validate.js` (boucle sur `Object.keys`). Les tests ci-dessous restent valides quel que soit le mécanisme.

- [ ] **Step 1 : Écrire les tests qui échouent** (ajouter à la fin de `designer/tests/schema.test.js`)

```js
// --- WS-2 : contrat charset IDs vs libellés ---

test('schema : id de composant invalide (espace) rejeté', () => {
  const l = base();
  l.components['bad id'] = { type: 'readout', unit: 'C' };
  l.pages[0].place.push({ ref: 'bad id', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});

test('schema : nom de page invalide (espace) rejeté', () => {
  const l = base();
  l.pages[0].name = 'Page 1';
  assert.equal(validate(l).valid, false);
});

test('schema : nom de page valide (underscore) accepté', () => {
  const l = base();
  l.pages[0].name = 'Page_1';
  assert.equal(validate(l).valid, true);
});

test('schema : bind invalide (tiret) rejeté', () => {
  const l = base();
  l.components.t.bind = 'cpu-load';
  assert.equal(validate(l).valid, false);
});

test('schema : bind valide accepté', () => {
  const l = base();
  l.components.t.bind = 'cpu_load';
  assert.equal(validate(l).valid, true);
});

test('schema : clé de vars invalide rejetée', () => {
  const l = base();
  l.sources = [{ url: 'https://x', vars: { 'bad var': '/a' } }];
  assert.equal(validate(l).valid, false);
});

test('schema : label accentué (Latin-1) accepté', () => {
  const l = base();
  l.components.t.label = 'Mémoire';
  l.components.t.unit = '°C';
  assert.equal(validate(l).valid, true);
});

test('schema : title accentué accepté', () => {
  const l = base();
  l.title = 'Mon écran';
  assert.equal(validate(l).valid, true);
});

test('schema : cap_prefix accentué accepté (ring)', () => {
  const l = base();
  l.components.r = { type: 'ring', cap_prefix: 'Réf ' };
  l.pages[0].place.push({ ref: 'r', radius: 80, thickness: 16 });
  assert.equal(validate(l).valid, true);
});

test('schema : contenu hors Latin-1 (emoji) rejeté', () => {
  const l = base();
  l.components.t.label = 'CPU 🔥';
  assert.equal(validate(l).valid, false);
});

test('schema : contenu hors Latin-1 (CJK) rejeté', () => {
  const l = base();
  l.components.t.label = '天気';
  assert.equal(validate(l).valid, false);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `cd designer && node --test tests/schema.test.js`
Expected: les nouveaux cas « rejeté » ÉCHOUENT (le schéma actuel accepte espaces/tirets via `ascii`, et rejette les accents) — c.-à-d. `valid` vaut l'inverse de l'attendu.

- [ ] **Step 3 : Modifier le schéma**

Dans `schema/layout.schema.json`, ajouter dans `$defs` (à côté de `ascii`) :

```jsonc
"id": {
  "type": "string",
  "pattern": "^[A-Za-z0-9_]+$",
  "minLength": 1,
  "description": "Identifiant (poignee de reference) : lettres ASCII, chiffres, underscore. Jamais traduit."
},
"display": {
  "type": "string",
  "pattern": "^[\\x20-\\x7E\\xA0-\\xFF]*$",
  "description": "Texte affiche sur le device : Latin-1 (ce que les fontes embarquees rendent ; cf. tools/gen_fonts.py)."
},
```

Puis rebrancher :
- `components` (objet) : ajouter `"propertyNames": { "$ref": "#/$defs/id" }`.
- Dans `$defs/source` : `vars` (objet) → ajouter `"propertyNames": { "$ref": "#/$defs/id" }` ; `name` : `{ "type": "string" }` → `{ "$ref": "#/$defs/display", ... }`.
- Dans `$defs/page` : `name` : `{ "type": "string" }` → `{ "$ref": "#/$defs/id", ... }`.
- Top-level `title` : `{ "type": "string" }` → `{ "$ref": "#/$defs/display", ... }`.
- Les **9** `bind` (lignes 113, 129, 146, 170, 220, 235, 275, 286, 323) : `#/$defs/ascii` → `#/$defs/id`.
- `text` (114), `label` (130, 147), `unit` (131), `cap_prefix` (186) : `#/$defs/ascii` → `#/$defs/display`.
- **Ne PAS toucher** : `src` (254, 267), `background_image` (377) — restent `#/$defs/ascii`.

(Conserver les `description` existantes ; remplacer juste le `$ref` ou le `type`.)

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

Run: `cd designer && node --test tests/schema.test.js`
Expected: PASS (tous, anciens + nouveaux). Si un « clé invalide rejetée » échoue → appliquer le repli `propertyNames` (cf. encadré Risque) dans `validate.js`.

- [ ] **Step 5 : Vérifier la non-régression du registre + valeurs par défaut**

Run: `cd designer && node --test tests/registry.test.js tests/validate.test.js`
Expected: PASS. (La conformité registre↔schéma ne dépend que des clés `type`, inchangées.)

- [ ] **Step 6 : Commit**

```bash
git add schema/layout.schema.json designer/tests/schema.test.js
git commit -m "feat(designer): schema — sépare \$defs id (^[A-Za-z0-9_]+\$) et display (Latin-1)"
```

---

## Task 2 : `humanize.js` — messages des patterns id / display

**Files:**
- Modify: `designer/js/humanize.js` (constantes en tête + `case 'pattern'`)
- Test: `designer/tests/humanize.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent** (ajouter à `designer/tests/humanize.test.js`)

```js
test('humanize : pattern id → message identifiant', () => {
  const msg = humanizeAjvError({ instancePath: '/pages/0/name', keyword: 'pattern', params: { pattern: '^[A-Za-z0-9_]+$' } });
  assert.match(msg, /identifiant invalide/);
});

test('humanize : pattern display → message Latin-1', () => {
  const msg = humanizeAjvError({ instancePath: '/components/t/label', keyword: 'pattern', params: { pattern: '^[\\x20-\\x7E\\xA0-\\xFF]*$' } });
  assert.match(msg, /Latin-1/);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd designer && node --test tests/humanize.test.js`
Expected: FAIL — les deux patterns retombent aujourd'hui sur « format invalide ».

- [ ] **Step 3 : Implémenter**

Dans `designer/js/humanize.js`, après les constantes existantes (`COLOR_PATTERN`, `ASCII_PATTERN`) :

```js
const ID_PATTERN = '^[A-Za-z0-9_]+$';
const DISPLAY_PATTERN = '^[\\x20-\\x7E\\xA0-\\xFF]*$';
```

Dans `case 'pattern':`, ajouter avant le `return \`${where} : format invalide\`;` final :

```js
      if (e.params?.pattern === ID_PATTERN) return `${where} : identifiant invalide (lettres, chiffres, _ uniquement)`;
      if (e.params?.pattern === DISPLAY_PATTERN) return `${where} : caractère non affichable par le device (Latin-1 uniquement)`;
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `cd designer && node --test tests/humanize.test.js`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/humanize.js designer/tests/humanize.test.js
git commit -m "feat(designer): humanize — messages pour patterns id et display (Latin-1)"
```

---

## Task 3 : `mutations.js` — `isValidId` + générateurs de noms + gardes de renommage

**Files:**
- Modify: `designer/js/mutations.js` (`uniquePageName` l.134, `renamePage` l.195, `uniqueCopyName` l.211, `duplicatePage` l.228, `renameComponent` l.276 ; nouveau `isValidId`)
- Test: `designer/tests/mutations.test.js` (mise à jour l.29-47 et l.560-571 + nouveaux cas)

- [ ] **Step 1 : Mettre à jour les tests existants + écrire les nouveaux**

Dans `designer/tests/mutations.test.js`, **remplacer** les valeurs attendues des tests `uniquePageName` (l.29-47) et `uniqueCopyName` (l.560-571) :

```js
// uniquePageName (remplacer les littéraux "Page N" avec espace) :
assert.equal(uniquePageName({ pages: [{ name: 'Accueil' }] }), 'Page1');
assert.equal(uniquePageName({ pages: [{ name: 'Page1' }, { name: 'Page2' }] }), 'Page3');
assert.equal(uniquePageName({ pages: [{ name: 'Page1' }, { name: 'Page3' }] }), 'Page2');
assert.equal(uniquePageName({ pages: [{ name: 'Page1' }, { name: 'Page1' }] }), 'Page2');
assert.equal(uniquePageName({}), 'Page1');

// uniqueCopyName (remplacer les littéraux "(copie)") :
assert.equal(uniqueCopyName({ pages: [{ name: 'Accueil' }] }, 'Accueil'), 'Accueil_copie');
assert.equal(uniqueCopyName({ pages: [{ name: 'A', place: [] }, { name: 'A_copie', place: [] }] }, 'A'), 'A_copie2');
assert.equal(uniqueCopyName({ pages: [{ name: 'A' }, { name: 'A_copie' }, { name: 'A_copie2' }] }, 'A'), 'A_copie3');
```

(Adapter aux textes de `test('…')` correspondants si besoin ; garder un test par cas.)

Puis **ajouter** (importer `isValidId`, `renamePage` depuis `../js/mutations.js` si absents de l'import en tête) :

```js
test('isValidId : accepte lettres/chiffres/underscore, refuse le reste', () => {
  assert.equal(isValidId('cpu_load2'), true);
  assert.equal(isValidId('Page1'), true);
  assert.equal(isValidId('cpu load'), false);   // espace
  assert.equal(isValidId('cpu-load'), false);   // tiret
  assert.equal(isValidId('café'), false);       // accent
  assert.equal(isValidId(''), false);           // vide
});

test('renameComponent : refuse un id invalide (state intact)', () => {
  const s = { components: { a: { type: 'readout' } }, pages: [] };
  assert.equal(renameComponent(s, 'a', 'bad id'), false);
  assert.ok(s.components.a);                     // pas renommé
  assert.equal(s.components['bad id'], undefined);
});

test('renamePage : refuse un nom invalide (state intact)', () => {
  const s = { pages: [{ name: 'P1', place: [] }] };
  assert.equal(renamePage(s, 0, 'P 1'), false);
  assert.equal(s.pages[0].name, 'P1');
});

test('uniqueCopyName : produit toujours un id valide', () => {
  const s = { pages: [{ name: 'A' }, { name: 'A_copie' }] };
  assert.equal(isValidId(uniqueCopyName(s, 'A')), true);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd designer && node --test tests/mutations.test.js`
Expected: FAIL (`isValidId`/`renamePage` retour booléen non définis ; générateurs produisent encore les anciens formats).

- [ ] **Step 3 : Implémenter dans `designer/js/mutations.js`**

Ajouter en tête (après les imports) :

```js
// Identifiant (poignée de référence) : lettres ASCII, chiffres, underscore. Cf. $defs/id du schéma.
export const isValidId = s => /^[A-Za-z0-9_]+$/.test(s ?? '');
```

`uniquePageName` (l.137) :

```js
  while (used.has(`Page${n}`)) n++;
  return `Page${n}`;
```

`renamePage` (l.195-198) → garder la signature, ajouter la garde et un retour booléen :

```js
export function renamePage(state, pageIndex, name) {
  const page = state.pages?.[pageIndex];
  if (!page || !isValidId(name)) return false;
  page.name = name;
  return true;
}
```

`uniqueCopyName` (l.211-217) :

```js
export function uniqueCopyName(state, base) {
  const used = new Set((state.pages || []).map(p => p.name));
  let name = `${base}_copie`;
  let n = 2;
  while (used.has(name)) name = `${base}_copie${n++}`;
  return name;
}
```

`duplicatePage` (l.228) — corriger le fallback :

```js
  newPage.name = uniqueCopyName(state, src.name || `Page${pageIndex + 1}`);
```

`renameComponent` (l.279) — ajouter la garde charset à la condition d'échec existante :

```js
  if (!newId || newId === oldId || comps[newId] || !isValidId(newId)) return false;
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `cd designer && node --test tests/mutations.test.js`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add designer/js/mutations.js designer/tests/mutations.test.js
git commit -m "feat(designer): mutations — isValidId, générateurs de noms id-valides, gardes de renommage"
```

---

## Task 4 : `default-layout.js` — nom de page id-valide

**Files:**
- Modify: `designer/js/default-layout.js:15`

- [ ] **Step 1 : Modifier**

`designer/js/default-layout.js` ligne 15 : `{ name: "Page 1", place: [` → `{ name: "Page1", place: [`.

- [ ] **Step 2 : Vérifier que le layout par défaut valide**

Run: `cd designer && node -e "import('./js/default-layout.js').then(async m => { const {createValidator}=await import('./js/validate.js'); const fs=await import('node:fs'); const sch=JSON.parse(fs.readFileSync('../schema/layout.schema.json')); const r=createValidator(sch)(m.DEFAULT_LAYOUT); console.log('valid:', r.valid, r.errors); })"`
Expected: `valid: true []`. (Si l'export ne s'appelle pas `DEFAULT_LAYOUT`, ajuster au nom réel exporté par `default-layout.js`.)

- [ ] **Step 3 : Lancer la suite complète**

Run: `cd designer && node --test`
Expected: PASS (aucune régression).

- [ ] **Step 4 : Commit**

```bash
git add designer/js/default-layout.js
git commit -m "feat(designer): default-layout — nom de page Page1 (id valide)"
```

---

## Task 5 : Inspecteur + registre — avertissements live charset

**Files:**
- Modify: `designer/js/inspector.js` (`nonAscii` l.25, `fieldRow` l.113, appel l.605, champ title l.435)
- Modify: `designer/js/registry.js` (kinds `asciitext` → `latintext`/`idtext`)
- Modify: `designer/js/tree.js` (gardes de renommage l.88-99 et l.210-221)

> Code DOM : **vérifié au navigateur**, pas de test node (convention du projet — cf. `nonAscii` privé non testé). La logique d'id pure est déjà couverte par `isValidId` (Task 3).

- [ ] **Step 1 : Prédicats charset dans `inspector.js`**

Après `const nonAscii` (l.25), ajouter :

```js
const nonLatin1 = v => /[^\x20-\x7E\xA0-\xFF]/.test(v ?? '');
const nonId = v => (v ?? '') !== '' && !/^[A-Za-z0-9_]+$/.test(v);
```

- [ ] **Step 2 : Généraliser `fieldRow`** (l.113-125)

```js
// Ligne libellé + champ (+ avertissement live selon le charset : 'latin1' ou 'id').
function fieldRow(label, input, { charset } = {}) {
  const row = document.createElement('label');
  row.className = 'insp-row';
  const span = document.createElement('span'); span.className = 'insp-label'; span.textContent = label;
  row.appendChild(span); row.appendChild(input);
  const bad = charset === 'id' ? nonId : charset === 'latin1' ? nonLatin1 : null;
  if (bad) {
    const warn = document.createElement('span'); warn.className = 'insp-warn';
    warn.textContent = charset === 'id' ? '⚠ id' : '⚠ Latin-1';
    warn.style.display = bad(input.value) ? '' : 'none';
    input.addEventListener('input', () => { warn.style.display = bad(input.value) ? '' : 'none'; });
    row.appendChild(warn);
  }
  return row;
}
```

- [ ] **Step 3 : Adapter les appels de `fieldRow`**

- l.435 (champ title du Document) : `fieldRow('Titre', titleInput, { ascii: true })` → `fieldRow('Titre', titleInput, { charset: 'latin1' })`.
- l.605 (champs de composant) : `fieldRow(displayLabel, input, { ascii: kind === 'asciitext' })` → 
```js
const row = fieldRow(displayLabel, input, { charset: kind === 'idtext' ? 'id' : kind === 'latintext' ? 'latin1' : undefined });
```

- [ ] **Step 4 : Mettre à jour les kinds du registre** (`designer/js/registry.js`)

Remplacer le 3ᵉ élément `'asciitext'` :
- `text` (l.27), `label` (l.37, l.47), `unit` (l.37), `cap_prefix` (l.67) → `'latintext'`.
- tous les `bind` (l.27, 37, 47, 68, 79, 91, 114, 127, 138) → `'idtext'`.

- [ ] **Step 5 : Gardes de renommage dans `tree.js`** (importer `isValidId` depuis `./mutations.js`)

Renommage composant — dans `tryCommit` (l.88-95), avant la garde d'unicité :
```js
        if (!isValidId(id)) { showToast('id invalide : lettres, chiffres, _ uniquement'); return false; }
```
et la classe `invalid` live (l.97-98) :
```js
        inp.classList.toggle('invalid', !!v && v !== orig && (!isValidId(v) || !!model.state.components?.[v]));
```

Renommage page — dans `tryCommit` (l.210-217), après le calcul de `name` :
```js
        if (!isValidId(name)) { showToast('nom de page invalide : lettres, chiffres, _ uniquement'); return false; }
```
et la classe `invalid` live (l.220-221) :
```js
        inp.classList.toggle('invalid', !!v && (!isValidId(v) || pageNameTaken(model.state, v, p.index)));
```

- [ ] **Step 6 : Vérification navigateur** (servir en no-store, piloter avec de vrais events pointer — cf. mémoire `designer-verif-navigateur`)

Servir : `cd designer && python3 -m http.server 8765` (port libre, **pas 8000**). Vérifier :
1. Inspecteur d'un **label** : taper `é` dans Texte → l'avertissement `⚠ Latin-1` reste **masqué** (é est Latin-1) ; coller un emoji `🔥` → l'avertissement **apparaît**.
2. Champ **Variable (pull)** (`bind`) : taper `cpu load` → `⚠ id` apparaît ; `cpu_load` → disparaît.
3. **Renommer un composant** (arbre) en `bad id` → toast « id invalide … », pas de renommage ; classe `invalid` (bord rouge) pendant la frappe.
4. **Renommer une page** en `Mon ecran` (espace) → toast « nom de page invalide … ».
5. Champ **Document → Titre** : `é` accepté sans avertissement, emoji → `⚠ Latin-1`.
6. **0 erreur console.**

- [ ] **Step 7 : Non-régression node**

Run: `cd designer && node --test`
Expected: PASS (le registre change de kind mais aucun test n'assert `asciitext` ; conformité intacte).

- [ ] **Step 8 : Commit**

```bash
git add designer/js/inspector.js designer/js/registry.js designer/js/tree.js
git commit -m "feat(designer): inspecteur/arbre — avertissements et gardes charset (id / Latin-1)"
```

---

## Task 6 : Vérification on-device (manuelle) — rendu Latin-1 réel

**But :** confirmer que le chemin texte accentué (JSON UTF-8 → LVGL → glyphe Latin-1), jamais exercé, peint bien le glyphe et non du tofu.

- [ ] **Step 1 : Construire un layout de test accentué**

Dans le designer (ou par édition JSON), un label `text: "Météo"`, un readout `label: "Mémoire"` / `unit: "°C"`.

- [ ] **Step 2 : Pousser au device**

Device à `192.168.1.35` (ou USB série `/dev/cu.usbmodem8401` — cf. HANDOFF). Bouton **Pousser** (POST /layout) depuis le designer pointé sur l'IP du device.

- [ ] **Step 3 : Observer le rendu**

`GET /screenshot` (bouton Capture) ou observation directe de l'écran.
Expected: `Météo`, `Mémoire`, `°C` rendus **correctement**, pas de `□□□`.

- [ ] **Step 4 : Verdict**

- Rendu correct → parité acquise, WS-2 terminé côté device.
- Tofu → **escalade** : ce n'est plus designer-only. Documenter dans le HANDOFF et investiguer le pipeline texte firmware (décodage UTF-8 du parser JSON, fonte sélectionnée) **avant** de clôturer. Ne pas masquer le problème.

---

## Task 7 : Clôture — suite complète + HANDOFF

**Files:**
- Modify: `docs/_internal/HANDOFF.md` (gitignoré — note d'état)

- [ ] **Step 1 : Suite complète verte**

Run: `cd designer && node --test`
Expected: PASS (compte ≥ baseline + nouveaux tests).

- [ ] **Step 2 : Diff de revue — confirmer le périmètre**

Run: `git diff main --stat`
Expected: uniquement `schema/`, `designer/js/`, `designer/tests/`, `docs/superpowers/`. **Pas** de `src/`, `lib/` (aucun changement firmware).

- [ ] **Step 3 : Mettre à jour le HANDOFF** (état courant + verdict on-device de la Task 6).

- [ ] **Step 4 : Commit final + (sur demande utilisateur) PR**

```bash
git add docs/_internal/HANDOFF.md
git commit -m "docs(internal): HANDOFF — WS-2 charset livré"
```
Le push / la PR vers GitHub n'a lieu **que sur demande explicite** de l'utilisateur (cf. `CLAUDE.md`).

---

## Self-Review (rempli à l'écriture du plan)

- **Couverture spec** : §1 Schéma → Task 1 ; §2 Designer (gardes/inspecteur) → Tasks 3, 5 ; §3 Messages → Task 2 ; §4 Générateurs → Tasks 3, 4 ; Migration fail-loud → comportement de `validate.js` (inchangé, vérifié Task 1) ; Tests → chaque task ; Vérif on-device → Task 6. Sources (`vars`/`name`) : couvert par le schéma (Task 1) ; avertissements live = hors scope (noté).
- **Placeholders** : aucun « TBD » ; code montré à chaque étape de code ; numéros de ligne donnés comme ancres avec instruction de vérifier le contexte.
- **Cohérence des noms** : `isValidId` (exporté de `mutations.js`) utilisé partout (Tasks 3, 5) ; kinds `latintext`/`idtext` cohérents entre registre (Task 5 step 4) et mapping `fieldRow` (Task 5 step 3) ; générateurs `Page${n}` / `${base}_copie` cohérents entre impl (Task 3) et tests (Task 3 step 1) et default-layout (Task 4).
