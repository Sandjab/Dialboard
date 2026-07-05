# Landing page + socle bilingue (P1)

**Date** : 2026-07-05
**Statut** : design validé (brainstorming), prêt pour le plan d'implémentation
**Périmètre** : P1 uniquement — la landing page publiée à `sandjab.github.io/Dialboard` + le socle bilingue partagé. Les sous-chantiers P2 (docs bilingues), P3 (outil de test REST), P4 (README bilingue), P5 (auto-détection langue du designer) et la page galerie ont chacun leur propre cycle.

---

## 1. Contexte & objectif

Aujourd'hui, `sandjab.github.io/Dialboard` **redirige** simplement vers le designer (heredoc dans `.github/workflows/pages.yml`). On remplace cette redirection par une **vraie landing page** qui donne accès à : le **Designer**, la **Documentation**, la **Galerie**, l'**outil de Test API**, et le **dépôt GitHub**.

Contrainte transverse du projet : tout le **contenu externe** (landing, docs, README) doit exister **en anglais et en français**, l'anglais étant le défaut, le français servi **uniquement si la langue du navigateur est le français**, avec une **bascule manuelle** sur chaque contenu. P1 pose ce socle bilingue et l'applique à la landing ; P2/P4 le réutilisent.

---

## 2. Décision structurante : un document par langue

Le contenu externe va de textes courts (landing) à de la **prose longue** (README multi-pages, manuel HTML de 10 chapitres). Un dictionnaire de clés `data-i18n → chaîne` ne passe pas à l'échelle de la prose. **Modèle retenu : un fichier par langue**, le texte écrit naturellement dans chaque fichier.

| Contenu | Anglais (défaut) | Français | Chantier |
|---|---|---|---|
| Landing | `site/index.html` | `site/index.fr.html` | **P1** |
| Manuel | `docs/index.html` | `docs/index.fr.html` | P2 |
| README | `README.md` | `README.fr.md` | P4 |

Le « moteur » se réduit à un **helper de bascule** partagé (`site/lang.js`, ~20 lignes) qui **ne stocke aucune traduction** : il détecte la langue au premier passage, redirige vers le bon fichier, et mémorise le choix manuel. Le README n'utilise pas de JS (GitHub n'exécute rien) — deux `.md` + un lien « Français / English » en tête ; c'est de toute façon la seule option côté GitHub, ce qui rend le modèle **cohérent des trois côtés**.

---

## 3. Périmètre de P1

**Dans le périmètre :**
1. La landing page, **en deux fichiers** : `site/index.html` (EN, défaut) + `site/index.fr.html` (FR).
2. Le helper partagé `site/lang.js` (auto-détection + bascule + mémorisation).
3. Les **assets de marque** (favicon, apple-touch, etc.) — déjà générés (cf. §7), à placer dans `site/assets/brand/`.
4. Le **câblage `pages.yml`** : publier la landing à la racine du site, publier aussi `docs/` (le manuel, encore FR seul à ce stade) pour que la carte Documentation fonctionne, conserver designer + schema + firmware.

**Hors périmètre (sous-chantiers dédiés) :**
- P2 — traduire le manuel HTML en anglais + `docs/index.fr.html` + câbler `lang.js` côté docs.
- P3 — l'outil de test REST (carte « Test API » = badge « bientôt » d'ici là).
- P4 — README bilingue.
- P5 — auto-détection `navigator.language` dans le designer.
- La **page galerie** autonome (phase de design séparée, hébergement probable sur la GitHub Page du dépôt `dialboard-store`) — carte « Galerie » = badge « bientôt » d'ici là.

---

## 4. Design visuel de la landing

Direction **« Atelier »** validée au navigateur (companion). Maquette de référence figée : `docs/superpowers/specs/2026-07-05-landing-mockup-reference.html` (version FR ; la version EN reprend la même structure, textes traduits).

**Langage visuel** (aligné sur le designer) : fond quasi-noir `#0E0E0E`, panneaux `#161616`, encre blanc-cassé `#F4F1E8`, accent **ambre** `#FF9F40`/`#FFB84D`, fontes **Inter** (UI) + **JetBrains Mono** (chiffres/technique). Deux halos radiaux ambre discrets en fond.

**Structure (de haut en bas) :**
- **En-tête** : à gauche, l'**icône de marque** (le fichier `dialboard-icon.png`, avec un léger halo CSS `drop-shadow`) + le wordmark « Dial**board** » (« board » en ambre, ~32 px, poids 800) d'un seul tenant ; à droite, la **bascule de langue** segmentée `FR / EN`.
- **Hero** (2 colonnes) : à gauche, eyebrow « Écran tactile rond · ESP32-S3 », titre « Des dashboards, sur un *cadran* » (« cadran » en dégradé ambre), accroche (« …pousse-les sur un petit écran tactile rond, **à quelques dizaines d'euros** — sans recompiler. Les valeurs arrivent de n'importe quelle source HTTP, **en pull ou en push**. »), 3 puces mono (`360×360`, `config-driven`, `LVGL 9.5`). À droite, le **device rond** dessiné en CSS/SVG (jauge ambre + segment blanc + aiguille + halo).
- **Cartes d'accès** (5, style trait cohérent avec le designer) :
  | Carte | Icône | Cible P1 | État |
  |---|---|---|---|
  | **Designer** (carte primaire ambre) | cadre + curseur | `designer/` | actif |
  | **Documentation** | livre | `docs/` | actif (FR seul jusqu'à P2) |
  | **Galerie** | image | — | **badge « bientôt »** |
  | **Test API** | flèches requête/réponse | — | **badge « bientôt »** |
  | **GitHub** | logo GitHub officiel | `https://github.com/Sandjab/Dialboard` | actif |
- **Section « Le principe »** : eyebrow + titre « Concevoir, pousser, afficher. » + intro, puis **3 blocs alternés** texte / **emplacement image ou vidéo** (placeholders, à remplir plus tard) : (1) le designer dans le navigateur, (2) les valeurs depuis n'importe quelle source, (3) la galerie de modèles du store.
- **Pied de page** : specs matérielles (`Guition JC3636K718 · ESP32-S3 · 360×360 · LVGL`) + lien dépôt.

**Responsive** : cartes 5 → 3 → 2 colonnes ; hero et blocs passent en une colonne sous ~860 px (device et média remontent au-dessus du texte).

**Cartes « bientôt »** : visibles, badge ambre « bientôt » en coin, non cliquables (pas de `href`, `aria-disabled`, curseur par défaut).

---

## 5. Socle bilingue — comportement de `site/lang.js`

Convention de nommage : `X.html` = anglais (défaut), `X.fr.html` = français. Le helper dérive le fichier jumeau en insérant/retirant `.fr` avant `.html` — donc **le même `lang.js` sert la landing ET, plus tard, les docs** (`docs/index.html` ↔ `docs/index.fr.html`).

Clé de mémorisation : `localStorage['dboard.lang']` ∈ `{ 'en', 'fr' }`.

**Au chargement :**
1. Déterminer la langue de la page courante (`fr` si le chemin finit par `.fr.html`, sinon `en`).
2. Langue voulue = choix mémorisé s'il existe, sinon `fr` si `navigator.language` commence par `fr`, sinon `en`. Si la voulue ≠ la courante → `location.replace()` vers le fichier jumeau (pas d'entrée d'historique). **Le choix manuel est « collant »** : il redirige sur toutes les pages (pas seulement au premier passage), pour qu'un utilisateur ayant choisi une langue la retrouve partout.
3. Refléter la langue active sur `<html lang>` et l'état visuel de la bascule.

**Bascule FR/EN** (boutons `data-lang="fr|en"`) : au clic → mémoriser le choix dans `localStorage`, puis `location.assign()` vers le fichier jumeau (si on n'y est pas déjà).

Garde-fous : validation du code de langue, protection anti-boucle de redirection (ne rediriger que si la cible diffère réellement).

**Cas limite** : quand la page est servie comme répertoire (`/Dialboard/`, chemin sans `index.html`), le helper doit traiter le chemin courant comme `index.html` (langue = `en`, jumeau = `index.fr.html`). La dérivation du fichier jumeau doit donc gérer un chemin finissant par `/` aussi bien que par `*.html`.

---

## 6. Câblage `pages.yml`

Remplacer le heredoc de redirection racine par l'assemblage suivant dans `_site` :
- `site/*` → racine de `_site` (landing `index.html` + `index.fr.html` + `lang.js` + `assets/`). La landing devient donc la racine `/Dialboard/`.
- `designer/` → `_site/designer` (inchangé ; on continue de retirer `tests/` + `package.json`).
- `schema/` → `_site/schema` (inchangé).
- **NOUVEAU** : `docs/index.html` + `docs/assets/` → `_site/docs/` (le manuel public). **Exclure** `docs/_internal/` (déjà gitignoré, absent du checkout) **et** `docs/superpowers/` (notes de dev : plans/specs, ne pas publier).
- Téléchargement de la release firmware → `_site/firmware` (inchangé).

Principe repo respecté : la disposition de `_site` reflète les chemins relatifs source (la landing est auto-contenue dans `site/`, ses assets en `site/assets/` → `assets/` relatif identique en local et sur Pages).

**Limite connue (inchangée, à documenter) :** les liens vers le device (dans le designer) restent inopérants depuis Pages (mixed content HTTPS→HTTP). La landing, elle, ne fait que des liens internes/externes — pas concernée.

---

## 7. Assets de marque

Générés à partir de l'image Nano Banana Pro (`~/Downloads/Gemini_Generated_Image_24yr3d24yr3d24yr.png`, 2048²) par **recadrage circulaire** du device (centre 1038,1028 ; rayon 698 dans l'image source) → **disque transparent, sans halo ni watermark**. Master 1396² puis déclinaisons. Actuellement dans `assets/brand/` ; **à déplacer dans `site/assets/brand/`** à l'implémentation.

| Fichier | Usage |
|---|---|
| `dialboard-icon.png` (1024, transparent) | logo en-tête / master |
| `icon-512.png`, `icon-192.png` | PWA / manifest |
| `favicon.ico` (16/32/48) | favicon |
| `favicon-32.png`, `favicon-16.png`, `favicon-48.png` | favicons PNG |
| `apple-touch-icon.png` (180, fond `#0E0E0E`) | iOS |
| `maskable-512.png` (fond + marge) | PWA maskable |

Câblage HTML à l'implémentation : `<link rel="icon" href="assets/brand/favicon.ico">`, `<link rel="icon" type="image/png" sizes="32x32" ...>`, `<link rel="apple-touch-icon" ...>`, et l'icône en-tête en `<img>`.

La commande de génération (ImageMagick) est reproductible et sera consignée dans le plan si régénération nécessaire. Le **logo/favicon reste un placeholder amélioré** : un vrai logo pourra le remplacer plus tard sans changer le câblage.

---

## 8. Vérification (critères de succès)

Servi en local (serveur statique **hors port 8000**, en `no-store`) et vérifié au navigateur :
- **Auto-détection** : navigateur en `fr-*` → `index.html` redirige vers `index.fr.html` ; navigateur non-fr → reste sur `index.html`. Sans choix mémorisé uniquement.
- **Bascule manuelle** : cliquer `EN`/`FR` change de fichier, affiche la bonne langue, et **persiste** (recharger conserve la langue choisie, y compris si elle contredit le navigateur).
- **Pas de boucle de redirection** ; `<html lang>` correct dans les deux langues.
- **Cartes** : Designer/Documentation/GitHub ouvrent la bonne cible ; Galerie et Test API affichent « bientôt » et ne sont pas cliquables.
- **Responsive** : 5→3→2→1 colonnes, hero et blocs se réempilent proprement (vérifié à ≥3 largeurs).
- **Favicons** : onglet, apple-touch (simulateur/inspection), favicon.ico chargé.
- **Parité EN/FR** : mêmes sections, mêmes liens, textes traduits (relecture des deux fichiers).
- `pages.yml` : après merge, `sandjab.github.io/Dialboard` sert la landing (plus la redirection), `/Dialboard/docs/` sert le manuel, `/Dialboard/designer/` inchangé.

---

## 9. Fichiers touchés (récap)

**Créés :** `site/index.html`, `site/index.fr.html`, `site/lang.js`, `site/assets/brand/*` (déplacés depuis `assets/brand/`).
**Modifiés :** `.github/workflows/pages.yml` (assemblage landing + docs).
**Inchangés :** designer, schema, firmware, le manuel `docs/index.html` (publié tel quel, traduit en P2).
