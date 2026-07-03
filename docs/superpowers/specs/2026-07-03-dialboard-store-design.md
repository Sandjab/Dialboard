# Dialboard Store — design

> Statut : design validé au brainstorm (2026-07-03). Prochaine étape : plan d'implémentation (`writing-plans`).
> Deux dépôts : le **repo store** (nouveau, `dialboard-store`) et le **designer** (web + embarqué LittleFS + Electron). Zéro firmware.

## 1. Objectif & valeur

Un **« store » communautaire gratuit** où n'importe qui dépose des dashboards (`.dboard`) : galerie
avec description, classés par domaine, **navigable et installable directement depuis le designer**
(en remplacement du tiroir « Modèles »), en plus du téléchargement direct du fichier.

Valeur : prolonge le levier d'adoption des templates 1-clic vers un catalogue **ouvert et vivant**,
sans backend ni coût. Argument de sûreté massue : un `.dboard` est du **JSON déclaratif, sans
exécution de code** → un store *sûr par construction*, contrairement à un vrai app store.

## 2. Décisions de cadrage (brainstorm)

| Question | Décision |
|---|---|
| Hébergement + soumission | **Repo GitHub public + `index.json` généré par CI.** PR = modération (check CI bloquant). Distribution CDN. Zéro backend. |
| Grain partagé / assets | **`.dboard` tel quel** (layout + assets base64). Réutilise le format portable et le chemin d'import existants. |
| Métadonnées | **Bloc `meta` optionnel dans le `.dboard`** (bump `v1 → v2` rétro-compatible). 1 PR = 1 fichier auto-descriptif. |
| Soumission (dépose) | **Export enrichi + PR manuelle.** Dialogue « Publier » qui pré-remplit `meta` ; PR ouverte à la main (CONTRIBUTING + template). |
| CDN | **jsDelivr** (`cdn.jsdelivr.net/gh/…`), CORS `*`, cache ~12 h (purgeable). Alternatives équivalentes : GitHub Pages, raw.githubusercontent. |
| Miniatures | **Live côté client** (réutilise `buildThumbnail`) ; `index.json` embarque le `layout` (assets retirés). Pas de rendu CI. |
| Portée v1 | **Consommation** (galerie + install + download + fallback offline). Le dialogue « Publier » est **v2**. |

## 3. Rapport avec l'existant — conflit assumé (Rule 7)

Le spec `2026-07-03-templates-1clic-design.md` a **rejeté** l'option « gallery distante » (son option C)
car elle « casse le hors-ligne/LAN, impose CORS, or le device est souvent sans accès internet ».

**Résolution — le store ne remplace pas ce choix, il l'étend :**

- Le store est **additif et opt-in**. Hors-ligne (fetch de l'index KO), la galerie **retombe sur les
  5 templates intégrés actuels** (`designer/templates/`, déjà dans le LittleFS) — c'est-à-dire
  **exactement l'option A retenue à l'époque**. Le hors-ligne n'est donc pas cassé, il est *dégradé*.
- CORS : résolu par le CDN (jsDelivr / raw envoient `Access-Control-Allow-Origin: *`), à **vérifier**
  en implémentation pour les trois contextes (embarqué device, web standalone, Electron).
- Curated vs communauté : les 5 built-ins gardent leurs clés **i18n** ; les entrées communautaires
  s'affichent via `meta.name/description` (langue de l'auteur). Split propre.

## 4. Architecture

### 4.1 Repo store (`dialboard-store`, public, séparé du repo principal)

```
entries/<auteur>/<slug>.dboard     # 1 fichier = 1 soumission (bundle v2 avec bloc meta)
index.json                         # GÉNÉRÉ par la CI — jamais édité à la main
.github/
  workflows/build-index.yml        # PR : valide ; merge main : régénère index.json
  scripts/build-index.mjs
  PULL_REQUEST_TEMPLATE.md
schema/layout.schema.json          # copie/synchro du schéma commun (validation CI)
CONTRIBUTING.md · README.md
```

Repo **séparé** (et non dossier `store/` du repo principal) : flux de PR indépendant, CI dédiée, ne
gonfle pas le repo firmware avec des blobs base64.

### 4.2 CI (`build-index.yml`)

- **Sur PR** — pour chaque `.dboard` touché : JSON parse ; `layout` conforme à `layout.schema.json` ;
  plafonds (pages/placements, taille totale, nombre/taille d'assets) **identiques à ceux gardés
  côté designer** ; `meta` présent et complet ; base64 des assets valides. → **check bloquant** :
  une PR non conforme ne peut pas merger.
- **Sur merge `main`** — `build-index.mjs` lit tous les `entries/**/*.dboard`, extrait
  `meta` + `layout` (assets retirés), émet `index.json` et le committe.

### 4.3 `index.json` (schéma)

Tableau d'entrées légères ; le `layout` (sans assets) est embarqué pour la miniature live immédiate :

```jsonc
[
  {
    "id": "auteur/crypto-ticker",
    "file": "entries/auteur/crypto-ticker.dboard",   // chemin CDN relatif
    "name": "Crypto Ticker",
    "author": "github-handle",
    "description": "Cours BTC/ETH en direct",
    "domain": "finance",
    "tags": ["crypto", "ticker"],
    "requires": "POST /update  btc=… eth=…",
    "bytes": 18342,                                    // taille du .dboard complet
    "layout": { … }                                   // assets RETIRÉS → miniature live
  }
]
```

Le `.dboard` **complet** (avec base64) n'est fetché qu'à l'**install**. Layouts ~1–2 Ko ⇒ tient à des
centaines d'entrées ; si ça grandit, pagination/split ultérieurs.

### 4.4 Distribution

jsDelivr sert `index.json` et chaque `.dboard` depuis `main`. Le designer (embarqué / web / Electron)
fetch en cross-origin ; le CDN fournit le CORS. Base URL = constante dans le designer.

## 5. Format `.dboard` v2 (rétro-compatible)

```jsonc
{
  "version": 2,
  "meta": {                          // absent = export perso legacy, toujours accepté
    "name": "Crypto Ticker",
    "author": "github-handle",
    "description": "Cours BTC/ETH en direct",
    "domain": "finance",             // enum fixe (voir §8)
    "tags": ["crypto", "ticker"],
    "requires": "POST /update  btc=… eth=…",   // note « à brancher », texte libre
    "license": "CC0"                 // optionnel
  },
  "layout": { … },                   // inchangé
  "assets": { "bg": {…}, "image": {…}, "aimg": {…} }   // inchangé (base64)
}
```

`decodeBundle` accepte désormais **v1 *ou* v2**, `meta` facultatif ⇒ tous les `.dboard` déjà exportés
continuent d'importer. `encodeBundle`/`missingKeys` inchangés côté logique ; l'export peut écrire v2.

## 6. Composants (unités isolées, côté designer)

- **`store-index.js` (pur, testable node)** — parse/valide la forme d'`index.json`, filtre par domaine,
  recherche par nom/tags. Aucun DOM. Tests `node --test` (cf. convention : logique pure testée, rendu
  DOM browser-verified).
- **`store-gallery.js` (DOM, browser-verified)** — successeur de `templates.js` : monte la galerie
  depuis l'index distant (fallback built-ins), rend cartes + filtre + recherche, `buildThumbnail` live,
  arm-confirm à l'install, bouton install + lien download.
- **`bundle.js` (existant)** — `decodeBundle` relâché v1|v2 ; helper pur `stripAssets(layout)` si besoin
  côté CI/partage.
- **CI store (`build-index.mjs`)** — vit dans le repo store ; réutilise `layout.schema.json`.

## 7. UX designer

- Le tiroir **« Modèles » → « Store »** (remplacement). Filtre par domaine (chips), recherche,
  cartes (miniature, nom, auteur, badge domaine, note « à brancher »).
- **Install** = fetch du `.dboard` → `decodeBundle` → rehydrate assets + charge le layout, **via le
  chemin d'import déjà écrit**. Arm-confirm « Remplacer ? » si canvas travaillé (repris de `templates.js`).
- **Téléchargement direct** conservé : chaque carte a un lien « télécharger le `.dboard` » (fichier brut).
- **Publier** (v2) : dialogue saisissant auteur/description/domaine/tags → exporte un `.dboard` avec
  `meta` prérempli, puis lien « Contribuer » vers le repo (CONTRIBUTING + template de PR).

## 8. Sûreté, limites, taxonomie

- **Sûr par construction** : `.dboard` = JSON déclaratif, aucune exécution de code.
- **Garde-fous CI** = mêmes règles que le designer : conformité `layout.schema.json`, plafonds
  pages/placements/tailles d'assets, images base64 valides. Rejet automatique sinon.
- **Domaines (enum fixe)** : `time` · `weather` · `finance` · `system` · `home` · `transit` · `health`
  · `fun` · `other`. Tags libres par-dessus pour la recherche.

## 9. Phasage

- **v1** — repo store + CI + `index.json` + format v2 (decode relâché) + galerie de consommation
  (filtre/recherche/install/download) remplaçant le tiroir + fallback offline. **Cœur du besoin.**
- **v2** — dialogue « Publier » + CONTRIBUTING + template de PR (dépose fluidifiée).
- **Plus tard (non engagé)** — ratings/tri popularité, i18n des métadonnées, miniatures pré-rendues.

## 10. Hors périmètre (non-buts)

- Pas de backend, comptes, upload direct, ni serverless.
- Pas de ratings/commentaires en v1.
- Pas de modération automatisée au-delà des garde-fous CI (la review de PR humaine reste le filtre).
- Aucune modification firmware.

## 11. Risques & questions ouvertes

- **CORS réel** sur les 3 contextes (embarqué/web/Electron) : à **vérifier** navigateur avant de figer jsDelivr.
- **Cache jsDelivr (~12 h)** : nouvelles entrées visibles avec délai ; purge API si gênant. Acceptable pour un store.
- **Taille d'`index.json`** avec `layout` embarqué : borné en pratique ; prévoir split si le catalogue explose.
- **Nom exact du repo store** et org : à confirmer (`dialboard-store` proposé).
- **Fidélité de la miniature sans assets** : les emplacements d'image apparaissent en placeholder (déjà le cas des built-ins layout-only).
