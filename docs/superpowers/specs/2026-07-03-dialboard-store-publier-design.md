# Dialboard Store — dialogue « Publier » — design

> Statut : design validé au brainstorm (2026-07-03). Prochaine étape : plan d'implémentation (`writing-plans`).
> 100 % designer (web + embarqué LittleFS + Electron). Zéro firmware. Suite du Store (spec `2026-07-03-dialboard-store-design.md` §7, phase v2).

## 1. Objectif & valeur

Le versant **« déposer »** du Store : un dialogue côté designer qui aide un auteur à **publier son dashboard** dans le repo store. Il saisit les métadonnées, produit un `.dboard` **v2 + `meta`**, et fluidifie l'ouverture de la Pull Request — sans compte/API GitHub, sans upload de binaire dans le cas courant. Complète la **consommation** (galerie, déjà livrée, Plan 1) par la **contribution**.

## 2. Décisions de cadrage (brainstorm)

| Question | Décision |
|---|---|
| Aide à la soumission | **Hybride** : pré-remplissage de l'éditeur « new file » GitHub si le `.dboard` est petit ; repli téléchargement + lien « Contribuer » si gros (images). |
| Placement / déclencheur | Bouton **« Publier le vôtre »** dans l'**en-tête du tiroir Store** (hub communautaire). Les boutons export/import `.dboard` de la toolbar restent (sauvegarde perso v1). |
| Surface de saisie | **Overlay de formulaire** modelé sur `#shot-overlay` (précédent maison ; l'ethos « pas de modale » vise les confirmations, pas la saisie). |
| Encodage | **Étendre `encodeBundle(layoutText, assets, meta?)`** : `meta` fourni → `version:2` + `meta` ; absent → `version:1` (export perso inchangé). Le décode accepte déjà v1\|v2 (Plan 1). |
| Seuil prefill→téléchargement | `.dboard` URL-encodé **≤ ~6 Ko** → prefill GitHub ; sinon repli. |

## 3. Flux

```
[Tiroir Store] → « Publier le vôtre » → overlay formulaire
  ↳ champs : name, author (pseudo GitHub), description, domain (<select> enum),
             tags (CSV), requires (textarea)
  ↳ validation live : « Publier » actif si name/author/description/domain non vides
  ↳ « Publier » :
       slug = slugify(name)
       dboardText = encodeBundle(model.toJSON(), collectAssets(model), meta)   // v2
       télécharge <slug>.dboard                                                 // l'auteur a le fichier
       si encodeURIComponent(dboardText).length ≤ SEUIL :
         open github.com/Sandjab/dialboard-store/new/main?filename=entries/<author>/<slug>.dboard&value=<dboardText>
       sinon :
         toast + lien « Contribuer » (CONTRIBUTING) ; upload manuel
```

Vérifié (GitHub Docs + issues) : l'éditeur « new file » accepte `?filename=` et `?value=` pour pré-remplir chemin + contenu ; l'auteur clique « Propose new file » → PR. Limite : longueur d'URL (d'où le seuil + repli).

## 4. Composants (unités isolées)

- **`publish.js` (pur, testé node)** — `slugify(name)`, `validateMeta(fields)` (→ champs manquants), `buildMeta(fields)` (normalise tags CSV→array, trim), `publishUrl(base, author, slug, dboardText)` + `fitsPrefill(dboardText, seuil)` (décision seuil). Aucun DOM.
- **`publish-dialog.js` (DOM, vérifié navigateur)** — monte l'overlay, câble champs/validation, orchestre à la validation : encode v2, download (réutilise le pattern `bundle-io.js`), prefill/repli. Successeur ergonomique de rien (nouveau).
- **`bundle.js` (existant, étendu)** — `encodeBundle(layoutText, assets, meta?)` : 3ᵉ paramètre optionnel ; `meta` présent → `{version:2, meta, layout, assets}` ; absent → `{version:1, …}` (comportement actuel). `collectAssets` inchangé.
- **`app.js` / `index.html` / `style.css`** — bouton en-tête tiroir Store + overlay markup + styles (modelés sur `#shot-overlay`) + câblage `mountPublishDialog`.
- **i18n** `publish.*` (fr + en, parité).

## 5. UX & garde-fous

- **Validation** : `name/author/description/domain` requis (bouton désactivé sinon) ; `tags`/`requires` optionnels ; `author` libre (pseudo GitHub public).
- **Assets manquants** : réutilise `missingKeys` (comme l'export `.dboard`) → avertit si des octets d'image ne sont pas en cache (bundle partiel signalé, non bloquant).
- **Toast = verdict** (publié/repli), `#status` inutile ici (action synchrone). Ethos maison respecté.
- **Domaine** : `<select>` sur l'enum `DOMAINS` (time…other), source commune avec `store-index.js` — importer la constante plutôt que la redéclarer.

## 6. Hors périmètre (non-buts)

- Pas d'auth ni d'API GitHub (le prefill évite tout token/OAuth).
- Pas d'upload d'images via l'URL (repli téléchargement assumé pour les gros bundles).
- L'export `.dboard` perso reste **v1** (pas de meta) — inchangé, but différent.
- Aucune modification firmware.

## 7. Risques & questions ouvertes

- **Longueur d'URL réelle** tolérée par GitHub/navigateur : le seuil ~6 Ko est prudent ; à **vérifier navigateur** (prefill effectif sur un cas layout-only).
- **Quirk `filename` GitHub** (le dernier segment de dossier peut être ignoré selon des rapports) : à confirmer que `entries/<author>/<slug>.dboard` arrive au bon chemin ; sinon documenter le chemin attendu dans le repli.
- **Slug collision** (deux auteurs, même slug sous des dossiers `author/` différents) : non-problème (namespacé par `author`).
