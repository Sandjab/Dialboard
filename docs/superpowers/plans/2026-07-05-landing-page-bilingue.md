# Landing page + socle bilingue (P1) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la redirection racine de GitHub Pages par une vraie landing bilingue (EN par défaut, FR si le navigateur est en français), qui donne accès au Designer, à la Documentation, à la Galerie (bientôt), au Test API (bientôt) et à GitHub.

**Architecture:** Un fichier HTML par langue (`site/index.html` EN, `site/index.fr.html` FR), sans dictionnaire de traductions. Un module partagé `site/lang.js` (helpers purs testés + câblage de la bascule) + un court script inline anti-FOUC en `<head>` pour la redirection au premier rendu. `pages.yml` assemble la landing en racine et publie aussi le manuel `docs/`.

**Tech Stack:** HTML/CSS/JS statique (aucun framework), fontes variables woff2 auto-hébergées, `node:test` pour la logique pure, GitHub Actions (Pages).

**Référence visuelle (déjà en repo) :** `docs/superpowers/specs/2026-07-05-landing-mockup-reference.html` — c'est la maquette FR validée. Les tâches partent de ce fichier et lui appliquent des deltas précis.

**Spec :** `docs/superpowers/specs/2026-07-05-landing-page-bilingue-design.md`

**Convention commit :** `feat(site): …` (cf. `feat(designer): …` dans l'historique).

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `site/index.html` (créé) | Landing **anglaise** (défaut). |
| `site/index.fr.html` (créé) | Landing **française**. |
| `site/lang.js` (créé) | Module : helpers purs (`currentLang`, `pickLanguage`, `siblingHref`) + `initToggle` (câblage bascule). Réutilisé par les docs en P2. |
| `site/assets/brand/*` (déplacés depuis `assets/brand/`) | Favicons + logo (déjà générés). |
| `site/assets/fonts/*` (créés) | `inter.woff2`, `jetbrains-mono.woff2` (copiés de `designer/vendor/fonts/`). |
| `site/package.json` (créé) | `{ "type": "module", "private": true }` — pour `node --test`. |
| `site/tests/lang.test.js` (créé) | Tests node des helpers purs. |
| `.github/workflows/pages.yml` (modifié) | Assemble landing (racine) + docs + designer + schema + firmware. |

---

## Task 0 : Branche de travail

- [ ] **Step 1 : Créer la branche**

On est sur `main` ; toute la suite se fait sur une branche dédiée.

```bash
git checkout -b feat/landing-bilingue
```

---

## Task 1 : Assets (marque + fontes) en place

**Files:**
- Déplacer : `assets/brand/*` → `site/assets/brand/`
- Créer : `site/assets/fonts/inter.woff2`, `site/assets/fonts/jetbrains-mono.woff2`

- [ ] **Step 1 : Déplacer les assets de marque et copier les fontes**

```bash
mkdir -p site/assets/brand site/assets/fonts
git mv assets/brand/* site/assets/brand/ 2>/dev/null || mv assets/brand/* site/assets/brand/
rmdir assets/brand assets 2>/dev/null || true
cp designer/vendor/fonts/inter.woff2          site/assets/fonts/inter.woff2
cp designer/vendor/fonts/jetbrains-mono.woff2 site/assets/fonts/jetbrains-mono.woff2
```

- [ ] **Step 2 : Vérifier l'inventaire**

Run: `ls site/assets/brand && echo '---' && ls site/assets/fonts`
Expected (brand) : `apple-touch-icon.png dialboard-icon.png favicon-16.png favicon-32.png favicon-48.png favicon.ico icon-192.png icon-512.png maskable-512.png`
Expected (fonts) : `inter.woff2 jetbrains-mono.woff2`

- [ ] **Step 3 : Commit**

Les assets de marque n'ont jamais été suivis par git (générés cette session) — `git mv` bascule donc sur `mv` ; il suffit d'ajouter `site/`.

```bash
git add site
git commit -m "feat(site): assets de marque (favicons/logo) + fontes woff2 auto-hébergées"
```

---

## Task 2 : `site/lang.js` (helpers purs testés + câblage bascule)

**Files:**
- Create: `site/package.json`
- Create: `site/tests/lang.test.js`
- Create: `site/lang.js`

- [ ] **Step 1 : Manifeste node (type module)**

Create `site/package.json` :

```json
{
  "name": "dialboard-site",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2 : Écrire le test qui échoue**

Create `site/tests/lang.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentLang, pickLanguage, siblingHref } from '../lang.js';

test('currentLang : *.fr.html = fr, sinon en', () => {
  assert.equal(currentLang('/Dialboard/index.fr.html'), 'fr');
  assert.equal(currentLang('/Dialboard/index.html'), 'en');
  assert.equal(currentLang('/Dialboard/'), 'en');               // répertoire = index EN
  assert.equal(currentLang('/Dialboard/docs/index.fr.html'), 'fr');
});

test('pickLanguage : choix mémorisé prioritaire', () => {
  assert.equal(pickLanguage('fr', 'en-US'), 'fr');
  assert.equal(pickLanguage('en', 'fr-FR'), 'en');
});

test('pickLanguage : sans mémoire, suit le navigateur (fr seulement si fr*)', () => {
  assert.equal(pickLanguage(null, 'fr-FR'), 'fr');
  assert.equal(pickLanguage(null, 'fr'), 'fr');
  assert.equal(pickLanguage(null, 'en-US'), 'en');
  assert.equal(pickLanguage(null, ''), 'en');
  assert.equal(pickLanguage(undefined, undefined), 'en');
});

test('siblingHref : dérive le fichier jumeau dans les deux sens', () => {
  assert.equal(siblingHref('/Dialboard/index.html', 'fr'), '/Dialboard/index.fr.html');
  assert.equal(siblingHref('/Dialboard/index.fr.html', 'en'), '/Dialboard/index.html');
  assert.equal(siblingHref('/Dialboard/index.fr.html', 'fr'), '/Dialboard/index.fr.html');
  assert.equal(siblingHref('/Dialboard/index.html', 'en'), '/Dialboard/index.html');
});

test('siblingHref : chemin-répertoire traité comme index.html', () => {
  assert.equal(siblingHref('/Dialboard/', 'fr'), '/Dialboard/index.fr.html');
  assert.equal(siblingHref('/Dialboard/', 'en'), '/Dialboard/index.html');
});

test('siblingHref : marche pour les docs (P2)', () => {
  assert.equal(siblingHref('/Dialboard/docs/index.html', 'fr'), '/Dialboard/docs/index.fr.html');
  assert.equal(siblingHref('/Dialboard/docs/index.fr.html', 'en'), '/Dialboard/docs/index.html');
});
```

- [ ] **Step 3 : Lancer le test, vérifier l'échec**

Run: `cd site && node --test; cd ..`
Expected: FAIL (`Cannot find module '../lang.js'` / export absent).

- [ ] **Step 4 : Implémenter `site/lang.js`**

Create `site/lang.js` :

```js
// site/lang.js — bascule bilingue « un fichier par langue » (EN défaut, FR = *.fr.html).
// Aucune traduction stockée ici : le texte vit dans chaque fichier HTML.
// Helpers purs (testés node) + initToggle (câblage navigateur, browser-verified).
// La redirection au premier rendu est faite par un court script inline en <head>
// (anti-FOUC) ; ce module ne gère QUE l'état + le clic de la bascule.

const KEY = 'dboard.lang';

// Langue de la page courante d'après son chemin ; un chemin-répertoire ('…/') = index EN.
export function currentLang(pathname) {
  return /\.fr\.html$/.test(pathname) ? 'fr' : 'en';
}

// Langue à servir : choix mémorisé prioritaire, sinon navigateur (fr seulement si « fr… »), défaut en.
export function pickLanguage(saved, navLang) {
  if (saved === 'fr' || saved === 'en') return saved;
  return String(navLang || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

// Chemin du fichier jumeau pour la langue cible ; gère le chemin-répertoire comme index.html.
export function siblingHref(pathname, lang) {
  const p = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  const en = p.replace(/\.fr\.html$/, '.html');       // normalise vers la base EN
  return lang === 'fr' ? en.replace(/\.html$/, '.fr.html') : en;
}

// Câblage navigateur : reflète la langue active sur la bascule + clic = mémorise & navigue.
export function initToggle(win = window) {
  const here = currentLang(win.location.pathname);
  win.document.documentElement.lang = here;
  const wire = () => {
    win.document.querySelectorAll('[data-lang]').forEach((btn) => {
      const l = btn.getAttribute('data-lang');
      btn.classList.toggle('on', l === here);
      btn.setAttribute('aria-pressed', String(l === here));
      btn.addEventListener('click', () => {
        win.localStorage.setItem(KEY, l);
        const target = siblingHref(win.location.pathname, l);
        if (target !== win.location.pathname) win.location.assign(target);
      });
    });
  };
  if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', wire);
  else wire();
}

// Effet de bord uniquement en navigateur (import node = sans effet → helpers testables).
if (typeof window !== 'undefined' && typeof document !== 'undefined') initToggle();
```

- [ ] **Step 5 : Lancer le test, vérifier le succès**

Run: `cd site && node --test; cd ..`
Expected: PASS (tous les tests verts, 0 échec).

- [ ] **Step 6 : Commit**

```bash
git add site/lang.js site/tests/lang.test.js site/package.json
git commit -m "feat(site): moteur de bascule bilingue (lang.js) + tests node"
```

---

## Task 3 : Landing française (`site/index.fr.html`)

Partir de la maquette de référence et lui appliquer les deltas de production (fontes locales, favicons, icône fichier, redirection, bascule, liens).

**Files:**
- Create: `site/index.fr.html` (depuis `docs/superpowers/specs/2026-07-05-landing-mockup-reference.html`)

- [ ] **Step 1 : Copier la maquette comme base**

```bash
cp docs/superpowers/specs/2026-07-05-landing-mockup-reference.html site/index.fr.html
```

- [ ] **Step 2 : `<head>` — retirer le CDN Google, ajouter fontes locales + favicons + meta + anti-FOUC**

Dans `site/index.fr.html` : **supprimer** les trois `<link ... fonts.googleapis / fonts.gstatic>` et le `<link href="https://fonts.googleapis.com/css2?...">`. **Remplacer** par le bloc suivant (juste après `<meta name="viewport" …>`), et régler `<title>`/description :

```html
<title>Dialboard — Dashboards sur écran rond</title>
<meta name="description" content="Conçois des dashboards dans ton navigateur et pousse-les sur un écran tactile rond ESP32-S3, en pull ou en push.">
<link rel="icon" href="assets/brand/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="assets/brand/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="assets/brand/favicon-16.png">
<link rel="apple-touch-icon" href="assets/brand/apple-touch-icon.png">
<style>
  /* Fontes variables auto-hébergées (parité designer, zéro CDN). */
  @font-face{font-family:'Inter';src:url('assets/fonts/inter.woff2') format('woff2');font-weight:400 800;font-display:swap}
  @font-face{font-family:'JetBrains Mono';src:url('assets/fonts/jetbrains-mono.woff2') format('woff2');font-weight:400 700;font-display:swap}
</style>
<script>
  /* Anti-FOUC : redirige AVANT le premier rendu si le navigateur veut l'autre langue
     et qu'aucun choix n'est mémorisé. Logique volontairement inline et autonome. */
  (function () { try {
    var K = 'dboard.lang', s = localStorage.getItem(K);
    var here = /\.fr\.html$/.test(location.pathname) ? 'fr' : 'en';
    var want = (s === 'fr' || s === 'en') ? s
      : ((navigator.language || '').toLowerCase().indexOf('fr') === 0 ? 'fr' : 'en');
    if (!s && want !== here) {
      var p = location.pathname.endsWith('/') ? location.pathname + 'index.html' : location.pathname;
      var en = p.replace(/\.fr\.html$/, '.html');
      var t = want === 'fr' ? en.replace(/\.html$/, '.fr.html') : en;
      if (t !== location.pathname) location.replace(t);
    }
  } catch (e) {} })();
</script>
```

- [ ] **Step 3 : En-tête — icône fichier + boutons de bascule**

Remplacer l'`<img class="markimg" … src="data:image/png;base64,…">` (icône inline de la maquette) par une référence fichier, et donner aux boutons de langue leurs `data-lang` (FR actif ici) :

```html
<div class="brand"><img class="markimg" alt="Dialboard" src="assets/brand/dialboard-icon.png"><span class="name">Dial<b>board</b></span></div>
```
```html
<div class="lang">
  <button type="button" data-lang="fr" class="on">FR</button>
  <button type="button" data-lang="en">EN</button>
</div>
```

- [ ] **Step 4 : Cartes — liens réels + « bientôt » non cliquables**

> Les `…` ci-dessous = **conserver tel quel le contenu déjà présent** dans la maquette copiée (icône SVG, `<h3>`, `<p>`, `<span class="go">`). On ne modifie que la balise englobante et le `href`.

Régler les `href` et neutraliser Galerie + Test API. Cartes **actives** (garder leur contenu, ne changer que `href`) :

```html
<a class="card primary" href="designer/"> … Designer … </a>
<a class="card" href="docs/"> … Documentation … </a>
<a class="card" href="https://github.com/Sandjab/Dialboard" rel="noopener"> … GitHub … </a>
```

Cartes **« bientôt »** — remplacer la balise `<a … href="#">` par un `<div>` non cliquable (garder le badge et le contenu) :

```html
<div class="card" aria-disabled="true" style="cursor:default">
  <span class="soon">bientôt</span>
  <div class="ic"> … (svg image) … </div>
  <h3>Galerie</h3>
  <p>Des dashboards prêts à installer, partagés.</p>
  <span class="go">Bientôt →</span>
</div>
```
```html
<div class="card" aria-disabled="true" style="cursor:default">
  <span class="soon">bientôt</span>
  <div class="ic"> … (svg flèches) … </div>
  <h3>Test API</h3>
  <p>Envoie des requêtes REST à ton device.</p>
  <span class="go">Bientôt →</span>
</div>
```

Le lien du pied de page : `<a href="https://github.com/Sandjab/Dialboard" rel="noopener">github.com/Sandjab/Dialboard →</a>`.

- [ ] **Step 5 : Charger le module de bascule**

Juste avant `</body>` :

```html
<script type="module" src="lang.js"></script>
```

- [ ] **Step 6 : Vérifier au navigateur (servi en local, hors port 8000, no-store)**

```bash
cd site && python3 -m http.server 8123 --bind 127.0.0.1 &  # note le PID
```
Ouvrir `http://127.0.0.1:8123/index.fr.html`. Vérifier : fontes chargées (Inter/JetBrains, pas de fallback système), favicon dans l'onglet, icône d'en-tête nette, aucune requête `fonts.googleapis` (onglet Réseau), les cartes Galerie/Test API non cliquables, Designer/Documentation/GitHub avec le bon `href` au survol. Arrêter le serveur (`kill <PID>`).

- [ ] **Step 7 : Commit**

```bash
git add site/index.fr.html
git commit -m "feat(site): landing française (Atelier) — fontes locales, favicons, bascule"
```

---

## Task 4 : Landing anglaise (`site/index.html`, défaut)

**Files:**
- Create: `site/index.html` (depuis `site/index.fr.html`, traduit)

- [ ] **Step 1 : Copier la version FR comme base**

```bash
cp site/index.fr.html site/index.html
```

- [ ] **Step 2 : `<html lang>` + bascule (EN actif)**

- `<html lang="fr">` → `<html lang="en">`.
- Boutons de langue : retirer `class="on"` de FR, l'ajouter à EN :
```html
<div class="lang">
  <button type="button" data-lang="fr">FR</button>
  <button type="button" data-lang="en" class="on">EN</button>
</div>
```

- [ ] **Step 3 : Traduire tout le texte visible (table FR → EN)**

| Emplacement | FR | EN |
|---|---|---|
| `<title>` | Dialboard — Dashboards sur écran rond | Dialboard — Dashboards on a round screen |
| meta description | Conçois des dashboards… en pull ou en push. | Design dashboards in your browser and push them to a round ESP32-S3 touchscreen, pull or push. |
| eyebrow hero | Écran tactile rond · ESP32-S3 | Round touchscreen · ESP32-S3 |
| h1 | Des dashboards,<br>sur un `<span class="g">`cadran`</span>`. | Dashboards,<br>on a `<span class="g">`dial`</span>`. |
| lead | Conçois des tableaux de bord dans ton navigateur et pousse-les sur un petit écran tactile rond, à quelques dizaines d'euros — sans recompiler. Les valeurs arrivent de n'importe quelle source HTTP, en pull ou en push. | Design dashboards in your browser and push them to a small round touchscreen costing a few tens of euros — no recompiling. Values arrive from any HTTP source, pull or push. |
| chips | 360×360 px · config-driven · LVGL 9.5 | *(inchangé)* |
| device : `.lbl` | Salon | Living room |
| device : `.big` / `.sub` | 21°C / ◐ 58 % | *(inchangé)* |
| carte Designer p | Éditeur WYSIWYG, glisser-déposer, sans recompiler. | WYSIWYG editor, drag and drop, no recompiling. |
| carte Designer go | Ouvrir → | Open → |
| carte Documentation h3/p/go | Documentation / Le manuel complet : layout, composants, API. / Lire → | Documentation / The full manual: layout, components, API. / Read → |
| carte Galerie h3/p/go/badge | Galerie / Des dashboards prêts à installer, partagés. / Bientôt → / bientôt | Gallery / Ready-to-install dashboards, shared. / Soon → / soon |
| carte Test API h3/p/go/badge | Test API / Envoie des requêtes REST à ton device. / Bientôt → / bientôt | Test API / Send REST requests to your device. / Soon → / soon |
| carte GitHub h3/p/go | GitHub / Code source, firmware et releases. / Voir → | GitHub / Source code, firmware and releases. / View → |
| story eyebrow | Le principe | How it works |
| story h2 | Concevoir, pousser, afficher. | Design, push, display. |
| story intro | Dialboard transforme un écran rond à quelques dizaines d'euros en tableau de bord pour la maison, l'atelier ou le bureau — piloté entièrement depuis le web, sans chaîne de compilation. | Dialboard turns a round screen costing a few tens of euros into a dashboard for the home, workshop or office — driven entirely from the web, with no build chain. |
| bloc 1 h3/p1/p2/cap | Un designer dans le navigateur / Compose tes pages en glisser-déposer : jauges, anneaux, courbes, valeurs. L'éditeur est embarqué dans le device — pas d'installation, pas de recompilation. / Exporte, importe, publie dans la galerie communautaire. / Image ou vidéo — démo du designer | A designer in your browser / Compose your pages by drag and drop: gauges, rings, charts, values. The editor is embedded in the device — no install, no recompiling. / Export, import, publish to the community gallery. / Image or video — designer demo |
| bloc 2 h3/p1/p2/cap | Des valeurs depuis n'importe quelle source / Un simple `<code>`POST /update`</code>` depuis Home Assistant, un script Python, un webhook… et l'écran se met à jour. Le layout, lui, vit en JSON. / Firmware ESP32-S3, rendu LVGL, mises à jour OTA. / Image ou vidéo — le device en situation | Values from any source / A simple `<code>`POST /update`</code>` from Home Assistant, a Python script, a webhook… and the screen updates. The layout itself lives in JSON. / ESP32-S3 firmware, LVGL rendering, OTA updates. / Image or video — the device in place |
| bloc 3 h3/p1/p2/cap | Une galerie de modèles prêts à l'emploi / Parcours les dashboards partagés par la communauté et installe-les en un clic depuis le designer. Publie les tiens en retour. / Chaque modèle est un fichier `<code>`.dboard`</code>` autonome. / Image ou vidéo — les modèles du store | A gallery of ready-made templates / Browse dashboards shared by the community and install them in one click from the designer. Publish your own in return. / Each template is a self-contained `<code>`.dboard`</code>` file. / Image or video — templates from the store |
| footer specs / lien | Guition JC3636K718 · ESP32-S3 · 360×360 · LVGL / github.com/Sandjab/Dialboard → | *(inchangé)* |

- [ ] **Step 4 : Vérifier au navigateur**

Servir `site/` (comme Task 3 Step 6), ouvrir `http://127.0.0.1:8123/index.html`. Vérifier : tout le texte en anglais, EN actif dans la bascule, `<html lang="en">`, cartes/liens identiques à la version FR.

- [ ] **Step 5 : Commit**

```bash
git add site/index.html
git commit -m "feat(site): landing anglaise (défaut) — traduction complète"
```

---

## Task 5 : Câblage GitHub Pages (`pages.yml`)

**Files:**
- Modify: `.github/workflows/pages.yml` (l'étape « Assemble _site … »)

- [ ] **Step 1 : Remplacer l'étape d'assemblage**

Remplacer entièrement l'étape `- name: Assemble _site (designer + schema + redirect)` (le heredoc de redirection) par :

```yaml
      - name: Assemble _site (landing + docs + designer + schema)
        run: |
          mkdir -p _site
          # Landing en racine du site (remplace l'ancienne redirection).
          cp -r site/* _site/
          rm -rf _site/tests _site/package.json      # infra de test node, pas de prod
          # Manuel public (exclut _internal gitignoré et superpowers = notes de dev).
          mkdir -p _site/docs
          cp docs/index.html _site/docs/index.html
          cp -r docs/assets   _site/docs/assets
          # Designer + schema (inchangé).
          cp -r designer _site/designer
          cp -r schema   _site/schema
          rm -rf _site/designer/tests _site/designer/package.json
```

Mettre à jour l'en-tête de commentaire du fichier (la 1re ligne « Publie le designer… ») pour dire « Publie la landing + le manuel + le designer ». Le `paths:` du déclencheur `push` doit inclure la landing :

```yaml
    paths:
      - 'site/**'
      - 'docs/index.html'
      - 'docs/assets/**'
      - 'designer/**'
      - 'schema/**'
      - '.github/workflows/pages.yml'
```

- [ ] **Step 2 : Valider la syntaxe YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pages.yml')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 3 : Répéter l'assemblage en local (fumée)**

Reproduire l'assemblage hors CI pour vérifier l'arborescence produite :

```bash
rm -rf /tmp/_site_test && mkdir -p /tmp/_site_test
cp -r site/* /tmp/_site_test/ && rm -rf /tmp/_site_test/tests /tmp/_site_test/package.json
mkdir -p /tmp/_site_test/docs && cp docs/index.html /tmp/_site_test/docs/ && cp -r docs/assets /tmp/_site_test/docs/assets
ls /tmp/_site_test && echo '--- pas de tests/package.json ci-dessous ---' && ls /tmp/_site_test | grep -E 'tests|package.json' || echo 'OK: exclus'
```
Expected: `index.html index.fr.html lang.js assets docs` ; et `OK: exclus`.

- [ ] **Step 4 : Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "feat(site): pages.yml publie la landing en racine + le manuel docs/"
```

---

## Task 6 : Vérification bout-en-bout (bilingue)

Aucun code ; on prouve les critères de succès de la spec (§8) au navigateur.

- [ ] **Step 1 : Servir la landing**

```bash
cd site && python3 -m http.server 8123 --bind 127.0.0.1 &   # PID noté ; port ≠ 8000
```

- [ ] **Step 2 : Auto-détection**

- Navigateur en **français** (ou `Accept-Language: fr`), `localStorage` vide : ouvrir `http://127.0.0.1:8123/index.html` → **redirige** vers `index.fr.html`.
- Navigateur en **anglais**, `localStorage` vide : ouvrir `index.html` → **reste** en anglais.
- Ouvrir directement `index.fr.html` avec navigateur anglais et `localStorage` vide → redirige vers `index.html`.

- [ ] **Step 3 : Bascule manuelle + persistance**

- Cliquer `EN`/`FR` : change de fichier, langue correcte, bouton actif correct.
- Après un clic, **recharger** : la langue choisie persiste (même si elle contredit le navigateur). Vérifier `localStorage['dboard.lang']`.
- Aucune **boucle** de redirection ; `<html lang>` correct dans les deux langues.

- [ ] **Step 4 : Cartes, responsive, favicons**

- Designer→`designer/`, Documentation→`docs/`, GitHub→dépôt ; Galerie/Test API non cliquables (« bientôt »).
- Largeurs ≥3 (≈1200 / 900 / 480 px) : cartes 5→3→2→1, hero et blocs se réempilent (média au-dessus du texte).
- Favicon onglet + apple-touch (inspection). Onglet Réseau : **aucune** requête `fonts.googleapis`.

- [ ] **Step 5 : Parité EN/FR**

Relire `index.html` et `index.fr.html` : mêmes sections, mêmes liens, textes traduits, rien d'oublié en français dans la version EN.

- [ ] **Step 6 : Arrêter le serveur**

```bash
kill <PID>
```

- [ ] **Step 7 : Nettoyage**

```bash
rm -rf /tmp/_site_test
```

---

## Notes de fin

- **`docs/` reste français seul** à ce stade : la carte Documentation ouvre le manuel FR jusqu'à P2 (traduction EN + `docs/index.fr.html` réutilisant `lang.js`). Comportement attendu, pas un bug.
- **Le déploiement Pages** se vérifie après merge sur `main` (workflow `pages.yml`), pas en local. Ne pas pousser sans demande explicite de l'utilisateur.
- **Le logo/favicon** est un placeholder amélioré (icône Nano Banana recadrée) ; un vrai logo pourra le remplacer sans changer le câblage.
