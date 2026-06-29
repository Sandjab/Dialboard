# playgrounds/ — démos visuelles à conserver

Explorateurs HTML autonomes servant à **décider d'un rendu** (et à le montrer), gardés
volontairement. Le contenu de ce dossier n'est **pas suivi par git** (cf. `.gitignore` :
`playgrounds/*` ignoré, sauf ce `README.md`) — mais ce README, lui, est tracké pour
inscrire dans l'historique que ce dossier est intentionnel : **ne pas le supprimer lors
d'un nettoyage.**

> Note : « non tracké » ne protège pas de `git clean -fdx` (le flag `-x` efface les
> fichiers ignorés). Évite cette commande ici, ou sauvegarde d'abord.

## Démos

| Fichier | Quoi | Comment l'ouvrir |
|---|---|---|
| `led-playground.html` | Explorateur interactif du rendu LED (glow, reflet, dôme, état éteint), vert/rouge × allumé/éteint, presets, prompt copiable. | Double-clic (autonome). |
| `palette-mockup.html` | Comparatif de layouts de la palette (liste vs grille icône+label vs icône seule). | Double-clic (autonome). |
| `critique-playground.html` | Critique design appliquée : mock fidèle du designer où chaque reco (palette découvrable, iconographie device, console/états vides, équilibre, détails mineurs) est activable et configurable ; preset « Avant (original) » pour comparer, prompt copiable. | Double-clic (autonome). |
| `led-harness.html` | Vérification de parité : rend la LED via le **vrai** `buildLed()` de `designer/js/render.js` dans plusieurs états. | **Doit être servi** (import ESM) : `python3 -m http.server 8137` depuis la racine du repo, puis ouvrir `http://127.0.0.1:8137/playgrounds/led-harness.html`. |

`led-harness.html` dépend de `../designer/js/render.js` : il doit rester à la racine du
repo (un niveau au-dessus de `designer/`) pour que l'import résolve.
