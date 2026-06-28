# WS-2 — Correction du contrat « IDs vs libellés » (charset)

**Date** : 2026-06-28
**Statut** : design validé en brainstorm, à relire avant plan d'implémentation.

## Contexte

Premier sous-projet d'un effort plus large d'**internationalisation du designer**. L'i18n proprement dite (extraction de tout le chrome de l'UI, anglais par défaut, français en 1er pack, choisi dans les Settings, extensible par fichier) fait l'objet d'une **spec séparée à venir (WS-1)**.

WS-2 est le **prérequis de contrat** : aujourd'hui le schéma confond *identifiants* et *texte d'affichage*. Les deux sont contraints par le même `$defs/ascii` (`^[\x00-\x7F]*$`), ce qui produit une asymétrie à l'envers :

- les **IDs** (clés de `components`, `name` de page) sont en réalité **non contraints** ou trop permissifs (espaces/ponctuation tolérés) ;
- les **libellés affichés** (`text`, `label`, `unit`, `cap_prefix`, `title`) sont **sur-contraints** (pas d'accents), alors que les fontes embarquées rendent déjà Latin-1.

Fait vérifié : `tools/gen_fonts.py:28` subsette `UNICODES = range(0x20,0x7F) + range(0xA0,0x100)` → **ASCII + Latin-1**. Les glyphes `é è à ç ù ï ô ü …` sont présents. La contrainte ASCII sur les champs d'affichage est donc plus stricte que ce que le firmware sait peindre.

## Principe

- **NOM d'un objet** (identité / poignée de référence) = **identifiant** : `^[A-Za-z0-9_]+$`. Anglais canonique, jamais traduit, jamais accentué.
- **CONTENU d'un champ string** (valeur affichée sur le device) = **Latin-1** : `^[\x20-\x7E\xA0-\xFF]*$`. C'est exactement ce que les fontes rendent → la **parité designer↔device** est préservée (le designer rejette ce que le device afficherait en tofu).

Le plafond Latin-1 est la réalité actuelle des fontes ; il s'élargira **en miroir** de `gen_fonts.py` si le subset grandit un jour.

## Classification de référence (exhaustive — toutes les `$defs/ascii` du schéma + champs `asciitext` du registre)

| Élément (où) | Catégorie | Pattern | Exemple |
|---|---|---|---|
| clé de `components` (id de composant) | **ID** | `^[A-Za-z0-9_]+$` | `cpu`, `w5h` |
| `type` d'un composant (valeur JSON) | **ID** anglais canonique | déjà figé par `const` | `bar`, `ring` |
| `name` de page | **ID** | `^[A-Za-z0-9_]+$` | `Page1`, `usage` |
| `bind` (9 composants) | **ID** | `^[A-Za-z0-9_]+$` | `cpu_load` |
| clés de `vars` (source) | **ID** | `^[A-Za-z0-9_]+$` | `temp` |
| `title` (top-level du layout) | **Contenu Latin-1** | `^[\x20-\x7E\xA0-\xFF]*$` | `Mon écran` |
| `text` (label) | **Contenu Latin-1** | idem | `Météo` |
| `label` (readout, bar) | **Contenu Latin-1** | idem | `Mémoire` |
| `unit` (readout) | **Contenu Latin-1** | idem | `°C` |
| `cap_prefix` (ring) | **Contenu Latin-1** | idem | `Réf ` |
| `name` de source | **Contenu Latin-1** | idem (libellé `/status`) | `Système` |
| `background_image`, `src` (clés de hash) | **Inchangé** | reste `ascii` | hex |
| `headers` (noms HTTP), `url` | **Inchangé** | — | — |

`type` est **déjà** conforme (toutes les clés du registre sont anglaises ; le schéma fige chaque type par `const`). Aucune action sur la valeur `type` — seul son **libellé d'affichage** (`COMPONENTS[t].label`) sera internationalisé, en **WS-1**.

## Changements par couche

### 1. Schéma — `schema/layout.schema.json`

Ajouter deux `$defs` (à côté de `ascii`, qui survit pour les clés de hash) :

```jsonc
"id":      { "type": "string", "pattern": "^[A-Za-z0-9_]+$", "minLength": 1,
             "description": "Identifiant (poignee de reference) : lettres ASCII, chiffres, underscore. Jamais traduit." },
"display": { "type": "string", "pattern": "^[\\x20-\\x7E\\xA0-\\xFF]*$",
             "description": "Texte affiche sur le device : Latin-1 (ce que les fontes embarquees rendent ; cf. tools/gen_fonts.py)." }
```

Brancher :

- `components` (objet) : ajouter `"propertyNames": { "$ref": "#/$defs/id" }`.
- `vars` (objet, dans `$defs/source`) : ajouter `"propertyNames": { "$ref": "#/$defs/id" }`.
- `bind` (9 occurrences : lignes 113, 129, 146, 170, 220, 235, 275, 286, 323) : `#/$defs/ascii` → `#/$defs/id`.
- `title` (top-level, ligne 10) : `{ "type": "string" }` → `#/$defs/display`.
- `text` (comp_label, 114) : `#/$defs/ascii` → `#/$defs/display`.
- `label` (comp_readout 130, comp_bar 147) : `#/$defs/ascii` → `#/$defs/display`.
- `unit` (comp_readout, 131) : `#/$defs/ascii` → `#/$defs/display`.
- `cap_prefix` (comp_ring, 186) : `#/$defs/ascii` → `#/$defs/display`.
- page `name` (`$defs/page`) : `{ "type": "string" }` → `#/$defs/id`.
- source `name` (`$defs/source`) : `{ "type": "string" }` → `#/$defs/display`.
- **Inchangés** : `background_image` (377), image `src` (254, 267), `headers` (clés HTTP), `url`.

> Numéros de ligne = ancres au moment de l'écriture ; vérifier le contexte à l'implémentation.

### 2. Designer — gardes au point de saisie

- **Helper pur** `isValidId(s)` (`/^[A-Za-z0-9_]+$/.test(s)`) dans `mutations.js`. Testé node.
- `renameComponent` (`mutations.js:276`) : garde défensive — retourne `false` si `!isValidId(newId)` (en plus des gardes existence/unicité).
- `renamePage` (`mutations.js:195`) : garde défensive — ne renomme pas (et retourne `false`) si `!isValidId(name)`.
- **Renommage inline (tree.js — la plumberie existe déjà : `tryCommit` + classe `invalid`)** :
  - composant (`tree.js:88-99`) : avant le commit, `if (!isValidId(id)) { showToast('id invalide : lettres, chiffres, _ uniquement'); return false; }` ; la classe `invalid` live inclut `!isValidId`.
  - page (`tree.js:210-221`) : idem sur `name` ; toast « nom de page invalide : lettres, chiffres, _ uniquement ».
- **Inspecteur** (`inspector.js`) : généraliser `fieldRow(label, input, { ascii })` (l.113) en `{ charset }` où `charset ∈ { 'latin1', 'id' }` → choisit le pattern + le texte de l'avertissement live (`⚠ Latin-1` / `⚠ id`). Câblage :
  - registre : champs `text`/`label`/`unit`/`cap_prefix` : `'asciitext'` → `'latintext'` ; champ `bind` : `'asciitext'` → `'idtext'`. (`makeInput` traite tout kind non spécial en `input[type=text]` → pas de changement de saisie, seul l'avertissement diffère.)
  - mapping à l'appel (`inspector.js:605`) : `{ ascii: kind === 'asciitext' }` → `{ charset: kind === 'idtext' ? 'id' : (kind === 'latintext' ? 'latin1' : undefined) }`.
  - **champ `title` du Document** (`inspector.js:435`) : `{ ascii: true }` → `{ charset: 'latin1' }`. **Le libellé reste « Titre »** : c'est bien le titre global du layout (contenu d'affichage), pas un id.
- **Sources** (`sources.js`) : le `name` (Latin-1) et les clés `vars` (id) reposent sur **la validation schéma** (panneau d'erreurs) en WS-2 — le panneau sources a sa propre plumberie d'inputs (`textInput`/`pairEditor`), sans mécanisme d'avertissement live. Ajouter des avertissements live inline ici = **polish optionnel hors WS-2** (la porte dure reste le schéma).

### 3. Messages de validation

- `humanize.js` : déclarer `ID_PATTERN = '^[A-Za-z0-9_]+$'` et `DISPLAY_PATTERN = '^[\\x20-\\x7E\\xA0-\\xFF]*$'` (comme `COLOR_PATTERN`/`ASCII_PATTERN`). Dans le `case 'pattern'`, retourner :
  - id → `${where} : identifiant invalide (lettres, chiffres, _ uniquement)`
  - display → `${where} : caractère non affichable par le device (Latin-1 uniquement)`
  - COLOR / ASCII conservés.
- `validate.js` : aucune modification structurelle (passe par `humanizeAjvError`).

### 4. Générateurs / contenu livré (TOUS doivent produire des ids valides)

- `default-layout.js:15` : `name: "Page 1"` → `name: "Page1"`.
- `uniquePageName` (`mutations.js:137`) : `` `Page ${n}` `` → `` `Page${n}` ``.
- `uniqueCopyName` (`mutations.js:213,215`) : `` `${base} (copie)` `` → `` `${base}_copie` `` ; `` `${base} (copie ${n})` `` → `` `${base}_copie${n}` ``.
- `duplicatePage` (`mutations.js:228`) : fallback `` `Page ${pageIndex + 1}` `` → `` `Page${pageIndex + 1}` ``.
- `uniqueId(state, type)` : produit `type + compteur` (ex. `bar1`) → déjà valide ; à confirmer à l'implémentation.
- `data/layout.json` committé : déjà conforme (`usage` ; ids `w5h/w7d/led/buzz`) → aucun changement.

## Migration & compatibilité

- **Aucun changement firmware** : le parser est tolérant et les fontes contiennent déjà les glyphes Latin-1. Resserrer les IDs (`^[A-Za-z0-9_]+$`) reste compatible avec le routage par `strcmp` du firmware.
- **Existant invalide → fail loud.** Un layout (localStorage / import / Pull device) avec un nom de page espacé (« Page 1 », « Mon-écran »), un `bind` ou une clé `vars` non conforme est **signalé par le validateur** dans le panneau d'erreurs. **Pas** de sanitization automatique : on ne mute jamais en douce une clé de routage (`POST /page` / `bind`). Le push reste bloqué tant que le layout est invalide (comportement existant de `validate.js`).

## Lien avec WS-1 (hors scope ici, mais conditionné par WS-2)

- Décision **(B)** : le **contenu par défaut** des composants sera **localisé** (`'Text'` en EN, `'Texte'` en FR). Le plafond Latin-1 de WS-2 rend ces défauts valides. **Contrainte induite à porter dans WS-1** : les chaînes de *contenu par défaut* d'un pack de langue doivent rester **Latin-1** (un pack non-Latin-1 produirait du contenu rejeté/tofu) — à garder côté chargement de pack.
- Le libellé `COMPONENTS[t].label` (`'Barre'`…) et tous les autres textes de chrome seront extraits dans le catalogue i18n en WS-1.

## Tests (env `node --test` du designer)

- **`schema.test.js`** : id valide accepté / invalide rejeté pour chaque site (clé `components`, `name` de page, `bind`, clé `vars`) ; accent (Latin-1) accepté sur `title`/`text`/`label`/`unit`/`cap_prefix`/`name` de source ; hors-Latin-1 (emoji, CJK) rejeté.
- **`humanize.test.js`** : messages des 2 nouveaux patterns (id + display).
- **`mutations.test.js`** :
  - **mise à jour** des tests existants `uniquePageName` (`Page 1`→`Page1`, etc., l.29-47) et duplication (`A (copie)`→`A_copie`, l.566-571).
  - **ajout** : `isValidId` (vrai/faux) ; `renameComponent`/`renamePage` rejettent un charset invalide ; `uniqueCopyName` produit un id valide.
- **`registry.test.js`** (conformité registre↔schéma) : doit rester vert (clés `type` inchangées ; vérifier que la conformité ne s'appuie pas sur le kind `asciitext`).

## Vérification on-device (manuelle, fin de WS-2)

Le chemin de rendu **JSON UTF-8 → LVGL → glyphe Latin-1** n'a **jamais été exercé** (le schéma interdisait les accents). LVGL est UTF-8-natif et le glyphe existe → ça *devrait* fonctionner, mais à **confirmer avant de déclarer la parité acquise** :

1. Pousser au device (192.168.1.35, ou USB série) un layout avec `text: "Météo"` / `label: "Mémoire"` / `unit: "°C"`.
2. `GET /screenshot` (ou observation directe) → confirmer le rendu correct, **pas du tofu (□□□)**.

Si tofu : ce n'est plus « designer-only » — investiguer le pipeline texte firmware (décodage UTF-8, fonte sélectionnée) avant de finaliser.

## Décisions verrouillées (rappel)

1. Séquence : **WS-2 d'abord, commit dédié** (évolution du contrat), puis WS-1.
2. Plafond d'affichage = **Latin-1** (parité fontes).
3. Génération : `"Page1"` / `` `Page${n}` `` / `` `${base}_copie` ``.
4. Existant invalide → **fail loud** (validateur), aucune mutation silencieuse.
5. Contenu par défaut = **(B) localisé** (porté par WS-1, rendu possible par WS-2).

## Hors scope WS-2

- Toute extraction/traduction de chrome (catalogue i18n, sélecteur de langue, switch à chaud) → **WS-1**.
- Avertissements live inline dans le panneau **Sources** (`name`/`vars`) → polish optionnel.
- Split éventuel d'un `name` de page en `id` + `titre` d'affichage distincts → **non retenu** (YAGNI ; toucherait le routage firmware).
- Élargissement du subset de fontes au-delà de Latin-1 → indépendant.
