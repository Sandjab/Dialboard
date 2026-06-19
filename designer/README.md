# Dialboard — Designer

IHM WYSIWYG **autonome** pour concevoir le `layout.json` de Dialboard et le pousser au device. Web app statique : aucune dépendance, aucun build, cross-platform (navigateur). **Ne touche pas au firmware.**

> État : **éditeur WYSIWYG multi-pages complet** (Plans A → C2). Palette + bibliothèque de composants réutilisables, canvas drag-and-drop avec snap aux ancrages, inspecteur (props/géométrie/seuils/aperçu mock), onglets de pages (créer/renommer/réordonner/supprimer), export/import `layout.json`, validation live ajv avec messages humanisés, undo/redo. Le panneau *JSON avancé* reste disponible. Le load/push `/layout` vers le device nécessite le CORS firmware (voir plus bas). Détails : `specs/` et `plans/`.

## Lancer

**Le plus simple — servi par le device.** Une fois le firmware flashé avec son image LittleFS
(`tools/stage_fs.sh` puis `pio run -e esp32s3 -t uploadfs`), le designer est servi directement par le
device à **`http://<ip>/designer/`** : même origin (aucun CORS), aucun serveur local. Charger / Pousser /
Statut / Capture écran fonctionnent sans configuration.

**En local (édition hors device).** Le designer charge le schéma partagé via `../schema/layout.schema.json` ;
il faut donc **servir depuis le dossier parent** `Dialboard/` (pas depuis `designer/`), et ne pas
l'ouvrir en `file://` :

```bash
cd /path/to/Dialboard
python3 -m http.server 8000
# puis http://localhost:8000/designer/
```

> Le travail est **auto-sauvegardé** (localStorage) entre les sessions ; **Exporter / Importer** reste le filet pour un fichier `layout.json`.

## Contrat partagé

Le format est défini par **`../schema/layout.schema.json`** — la *source de vérité unique* partagée avec le firmware (`src/dashboard.cpp`). Le designer produit, le firmware consomme. Toute évolution du format = un commit dédié sur le schéma, mergé sur `master`, puis rebase des branches embarqué/designer.

## Endpoints utilisés

| Action | Bouton | Requête |
|---|---|---|
| Charger le layout actif | Charger | `GET <device>/layout` |
| Pousser un nouveau layout (validé + persisté flash) | Pousser | `POST <device>/layout` |
| Pousser les valeurs d'aperçu (mocks) — live preview | Valeurs test | `POST <device>/update` |
| Naviguer les pages du device (dans l'overlay de capture) | ◀ ▶ | `POST <device>/page` |
| Santé du device + état des sources de pull | Statut | `GET <device>/status` |
| Capture pixel-perfect de l'écran | Capture écran | `GET <device>/screenshot` |

mDNS `dialboard.local` peut être filtré sur certains LAN → utilise l'IP DHCP directe.

## CORS — résolu

Le firmware renvoie `Access-Control-Allow-Origin: *` (preflight `OPTIONS` → 204) : Charger/Pousser depuis
un autre origin (localhost → IP device) fonctionne. Et **servi depuis le device** (`/designer/`), tout est
en même origin → la question ne se pose plus.

## ASCII uniquement

`text`/`label`/`unit` doivent rester ASCII (polices Montserrat embarquées). Le designer devra le signaler (le schéma le contraint déjà via `$defs/ascii`).

## Aperçu : indicatif, pas pixel-exact

Le canvas est une **2e implémentation** du rendu (la 1re étant le firmware, `src/view.cpp` + `src/dashboard.cpp`).
Il vise le « best-effort » : positions et métriques à quelques pixels près, polices approchées. **Le device
reste l'arbitre final.** Conséquences à connaître :

- Les **valeurs affichées sont des mocks** (voir `MOCKS` dans `js/render.js`) ; à l'exécution, `/update` les remplace.
- Le **ring est toujours centré** (le firmware fait `lv_obj_center`) : `anchor`/`dx`/`dy` sont ignorés pour un ring ;
  dans l'éditeur il n'est que redimensionnable (radius / thickness / gap_deg).
- Tout changement de rendu firmware (nouveau widget, nouveau style) **doit être répliqué** dans `js/render.js`.
- L'aperçu a été **aligné sur le device** (audit de parité, `snapshots/parity/` + `parity-report*.html`) :
  polices 36/48, `center_pct`, pastille `%` centrée sur la bande, bar (label centré + pilule), chart
  (panneau/grille/points) et meter (ticks/chiffres/moyeu) corrigés. Restent des écarts esthétiques mineurs
  sur les widgets natifs LVGL (chart/meter) — best-effort assumé.
