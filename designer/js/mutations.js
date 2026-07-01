// Mutations dédiées du layout. Fonctions PURES : elles mutent l'état passé en place et sont
// appelées via model.commit(s => mutate(s, ...)). Séparées de model.js (state/undo/events) pour
// rester testables sous node --test. Toute clé posée doit rester valide vis-à-vis du schéma.

import { COMPONENTS } from './registry.js';

// Identifiant (poignée de référence) : lettres ASCII, chiffres, underscore. Cf. $defs/id du schéma.
export const isValidId = s => /^[A-Za-z0-9_]+$/.test(s ?? '');

// id unique pour un nouveau composant : <type><n>, n = 1er entier libre.
export function uniqueId(state, type) {
  const comps = state.components || {};
  let n = 1;
  while (comps[`${type}${n}`]) n++;
  return `${type}${n}`;
}

export function addComponent(state, id, def) {
  (state.components ||= {})[id] = def;
}

export function addPlacement(state, pageIndex, placement) {
  const page = state.pages[pageIndex];
  if (!page) return;
  (page.place ||= []).push(placement);
}

export function removePlacement(state, pageIndex, placeIndex) {
  const page = state.pages[pageIndex];
  if (!page?.place) return;
  page.place.splice(placeIndex, 1);
}

// Décalage (unités écran) appliqué à une copie pour qu'elle ne masque pas l'original.
const COPY_OFFSET = 8;

// Crée une copie INDÉPENDANTE d'un composant + place cette copie sur une page. Brique commune
// de duplicateComponent et du coller (paste) : la copie reçoit un id neuf (uniqueId), le
// placement est cloné, re-pointé sur le nouvel id et décalé. dx/dy sont des clés valides pour
// tout placement (schéma $defs/placement) ; pour un ring centré l'offset est inerte (copie
// concentrique). Retourne l'index du nouveau placement, ou -1 si la page/def est absente.
export function placeComponentCopy(state, pageIndex, compDef, placement) {
  const page = state.pages?.[pageIndex];
  if (!page || !compDef || !placement) return -1;
  const id = uniqueId(state, compDef.type);
  addComponent(state, id, structuredClone(compDef));
  const copy = { ...structuredClone(placement), ref: id,
                 dx: (placement.dx || 0) + COPY_OFFSET, dy: (placement.dy || 0) + COPY_OFFSET };
  addPlacement(state, pageIndex, copy);
  return page.place.length - 1;
}

// Duplique le composant d'un placement EXISTANT en une copie indépendante sur la même page.
// Retourne l'index du nouveau placement, ou -1 si le placement / composant est introuvable.
export function duplicateComponent(state, pageIndex, placeIndex) {
  const placement = state.pages?.[pageIndex]?.place?.[placeIndex];
  if (!placement) return -1;
  const compDef = state.components?.[placement.ref];
  if (!compDef) return -1;
  return placeComponentCopy(state, pageIndex, compDef, placement);
}

// Retire un placement, puis supprime son composant s'il n'est plus référencé par aucun placement
// (toutes pages) ET qu'il n'est pas physique. Modèle 1:1 : le composant est en pratique toujours
// supprimé ; la garde « encore référencé » protège un éventuel ref hérité partagé (zéro casse, sans
// migration) ; la garde « physique » est défensive (led_ring/sound ne sont jamais placés).
export function removePlacementAndOrphan(state, pageIndex, placeIndex) {
  const placement = state.pages?.[pageIndex]?.place?.[placeIndex];
  if (!placement) return;
  const ref = placement.ref;
  removePlacement(state, pageIndex, placeIndex);
  const stillUsed = (state.pages || []).some(p => (p.place || []).some(pl => pl.ref === ref));
  if (stillUsed) return;
  const comp = state.components?.[ref];
  if (comp && !COMPONENTS[comp.type]?.physical) delete state.components[ref];
}

// Édite une prop de composant. Valeur vide (''/null/undefined) => suppression de la clé
// (le firmware retombe alors sur son défaut ; évite de produire des clés invalides).
export function setComponentProp(state, id, key, value) {
  const c = state.components[id];
  if (!c) return;
  if (value === '' || value === null || value === undefined) delete c[key];
  else c[key] = value;
}

export function setPlacementProp(state, pageIndex, placeIndex, key, value) {
  const p = state.pages[pageIndex]?.place?.[placeIndex];  // parité avec add/removePlacement : pas de throw sur index invalide
  if (!p) return;
  if (value === '' || value === null || value === undefined) delete p[key];
  else p[key] = value;
}

// Bascule l'orientation d'une barre ET échange Largeur/Hauteur du placement (axe inversé → la barre
// « pivote » : une horizontale large devient une verticale haute). On échange les dimensions EFFECTIVES
// en matérialisant les défauts firmware (200×16, cf. view.cpp:184 / buildBar) ; sinon le swap serait un
// no-op pour une barre fraîche (width/height implicites) et elle ne se réorienterait pas.
export function setBarOrientation(state, id, pageIndex, placeIndex, orientation) {
  const c = state.components[id];
  if (!c) return;
  const flipped = orientation !== (c.orientation || 'horizontal');   // horizontal = défaut firmware
  c.orientation = orientation;
  if (!flipped) return;
  const p = state.pages[pageIndex]?.place?.[placeIndex];
  if (!p) return;
  const w = p.width ?? 200, h = p.height ?? 16;                       // défauts firmware (view.cpp:184)
  p.width = h; p.height = w;
}

// icon states : tableau de {at, symbol?, color?}. Vide => suppression de la clé (icône statique).
export function setIconStates(state, id, states) {
  const c = state.components[id];
  if (!c) return;
  if (states && states.length) c.states = states;
  else delete c.states;
}

// thresholds : tableau de [limite, "#hex"]. Vide => suppression de la clé.
export function setThresholds(state, id, thresholds) {
  const c = state.components[id];
  if (!c) return;
  if (thresholds && thresholds.length) c.thresholds = thresholds;
  else delete c.thresholds;
}

// Navigation circulaire (nav.wrap) : true = boucle (dernière page → première, défaut firmware), false =
// bute au bord. Crée l'objet nav au besoin ; n'écrit que la clé wrap (le spread préserve d'éventuelles
// futures clés nav). Coerce en booléen — le layout ne porte jamais de wrap non-bool.
export function setNavWrap(state, wrap) {
  state.nav = { ...(state.nav || {}), wrap: !!wrap };
}

// --- Pages (Plan C2) ---

// Nom de page auto unique (« Page_N » au premier N libre) : évite les collisions à la création, le
// nom de page étant la cible de POST /page {"name":...}. Le renommage manuel reste libre. Cf. uniqueSourceName.
export function uniquePageName(state) {
  const used = new Set((state.pages || []).map(p => p.name));
  let n = 1;
  while (used.has(`Page_${n}`)) n++;
  return `Page_${n}`;
}

// `name` est-il déjà porté par une AUTRE page que `exceptIndex` ? Comparaison exacte (comme le strcmp
// du firmware pour POST /page) → garde anti-doublon du renommage manuel.
export function pageNameTaken(state, name, exceptIndex) {
  return (state.pages || []).some((p, i) => i !== exceptIndex && p.name === name);
}

// Ajoute une page vide en fin de liste. `name` est requis (le schéma exige page.name).
export function addPage(state, name) {
  (state.pages ||= []).push({ name, place: [] });
}

// Retire une page ET nettoie les composants de ses placements devenus orphelins (modèle 1:1 : sinon les
// définitions restent dans `components` du JSON). Même logique que removePlacementAndOrphan, batchée sur
// tous les placements de la page : garde « encore référencé par une autre page » (ref partagé hérité) +
// garde « physique » (led_ring/sound jamais retirés). Index hors bornes → no-op (garde `removed`).
export function removePage(state, pageIndex) {
  if (!state.pages) return;
  const removed = state.pages[pageIndex];
  if (!removed) return;
  const refs = (removed.place || []).map(pl => pl.ref);
  state.pages.splice(pageIndex, 1);
  for (const ref of refs) {
    if (state.pages.some(p => (p.place || []).some(pl => pl.ref === ref))) continue;
    const comp = state.components?.[ref];
    if (comp && !COMPONENTS[comp.type]?.physical) delete state.components[ref];
  }
}

// Couleur de fond effective d'une page : override de la page, sinon fond global, sinon #000000.
export function effectivePageBg(state, pageIndex) {
  return state.pages?.[pageIndex]?.background || state.background || '#000000';
}

// Définit/supprime l'override de fond d'une page. Couleur vide/null → supprime (la page hérite du global).
export function setPageBackground(state, pageIndex, color) {
  const page = state.pages?.[pageIndex];
  if (!page) return;
  if (color) page.background = color;
  else delete page.background;
}

// Clé d'image de fond effective d'une page (override par page uniquement ; pas de fond image global).
export function effectivePageBgImage(state, pageIndex) {
  return state.pages?.[pageIndex]?.background_image || null;
}

// Définit/supprime la clé d'image de fond d'une page. Vide/null → supprime (pas d'image).
export function setPageBackgroundImage(state, pageIndex, key) {
  const page = state.pages?.[pageIndex];
  if (!page) return;
  if (key) page.background_image = key;
  else delete page.background_image;
}

export function renamePage(state, pageIndex, name) {
  const page = state.pages?.[pageIndex];
  if (!page || !isValidId(name)) return false;
  page.name = name;
  return true;
}

// Déplace la page d'index `from` vers `to`. No-op si index hors bornes ou identiques.
export function reorderPages(state, from, to) {
  const pages = state.pages;
  if (!pages || from === to) return;
  if (from < 0 || from >= pages.length || to < 0 || to >= pages.length) return;
  const [p] = pages.splice(from, 1);
  pages.splice(to, 0, p);
}

// Nom unique pour une page dupliquée : « <base>_copie », puis « <base>_copie2 »… 1er libre. Le nom de
// page est la cible de POST /page → unicité obligatoire (cf. uniquePageName / pageNameTaken).
export function uniqueCopyName(state, base) {
  const used = new Set((state.pages || []).map(p => p.name));
  let name = `${base}_copie`;
  let n = 2;
  while (used.has(name)) name = `${base}_copie${n++}`;
  return name;
}

// Duplique une page JUSTE APRÈS la source. La page repart d'un clone profond → les props de page (fond
// couleur/image, et toute clé future) sont préservées. Chaque placement devient une copie INDÉPENDANTE
// (modèle 1:1) : nouvel id (uniqueId), compDef cloné, placement cloné re-pointé — SANS offset (copie
// fidèle, ≠ placeComponentCopy). Un ref orphelin est copié tel quel (pas de composant créé). Renvoie
// l'index de la nouvelle page, ou -1 si la source est absente.
export function duplicatePage(state, pageIndex) {
  const src = state.pages?.[pageIndex];
  if (!src) return -1;
  const newPage = structuredClone(src);                 // préserve background / background_image / autres props de page
  newPage.name = uniqueCopyName(state, src.name || `Page_${pageIndex + 1}`);
  newPage.place = [];
  for (const pl of src.place || []) {
    const compDef = state.components?.[pl.ref];
    if (compDef) {
      const id = uniqueId(state, compDef.type);
      addComponent(state, id, structuredClone(compDef));
      newPage.place.push({ ...structuredClone(pl), ref: id });
    } else {
      newPage.place.push(structuredClone(pl));          // orphelin : copié tel quel
    }
  }
  state.pages.splice(pageIndex + 1, 0, newPage);
  return pageIndex + 1;
}

// Déplace un placement de `from` vers `to` dans pages[pageIndex].place. L'ordre du tableau = l'ordre de
// rendu (z-index : le dernier est dessus). No-op si page/place absent, index hors bornes ou identiques.
// Miroir de reorderPages (même garde de bornes).
export function reorderPlacement(state, pageIndex, from, to) {
  const place = state.pages?.[pageIndex]?.place;
  if (!place || from === to) return;
  if (from < 0 || from >= place.length || to < 0 || to >= place.length) return;
  const [p] = place.splice(from, 1);
  place.splice(to, 0, p);
}

// Déplace un placement de la page `fromPage` (index `placeIndex`) vers pages[toPage].place. Sans `toIndex`
// (ou hors bornes) → ajout en FIN ; avec `toIndex` → insertion à cette position (drop positionné inter-page).
// Le composant reste dans la map globale `components` (seul le placement migre). No-op si page/placement
// absent. Même page autorisée (retire puis ré-ajoute en fin = remonte au-dessus). `||= []` couvre une page
// cible sans tableau place (parité avec addPlacement).
export function movePlacementToPage(state, fromPage, placeIndex, toPage, toIndex) {
  const srcPage = state.pages?.[fromPage];
  const dstPage = state.pages?.[toPage];
  if (!srcPage?.place || !dstPage) return;
  const placement = srcPage.place[placeIndex];
  if (!placement) return;
  srcPage.place.splice(placeIndex, 1);
  const dst = (dstPage.place ||= []);
  if (toIndex == null || toIndex < 0 || toIndex > dst.length) dst.push(placement);
  else dst.splice(toIndex, 0, placement);
}

// Renomme l'id d'un composant : la clé dans `components` ET tous les place[].ref qui la pointent (toutes
// pages). Retourne false (no-op) si oldId absent, newId vide/invalide/identique/déjà pris.
// Retourne true si renommé. newId doit respecter isValidId (lettres ASCII, chiffres, underscore).
export function renameComponent(state, oldId, newId) {
  const comps = state.components;
  if (!comps || !comps[oldId]) return false;
  if (!newId || newId === oldId || comps[newId] || !isValidId(newId)) return false;
  comps[newId] = comps[oldId];
  delete comps[oldId];
  for (const page of state.pages || [])
    for (const pl of page.place || [])
      if (pl.ref === oldId) pl.ref = newId;
  return true;
}

// --- Sources (pull reseau, P3). Top-level state.sources (array d'objets plats). ---

// Nom libre <source><n> : 1er entier sans collision avec les noms existants.
export function uniqueSourceName(state) {
  const used = new Set((state.sources || []).map(s => s.name));
  let n = 1;
  while (used.has(`source${n}`)) n++;
  return `source${n}`;
}

// Ajoute une source en fin de liste. url absente volontairement (l'utilisateur la saisit ;
// url requise par le schema => signalee invalide tant qu'elle est vide).
export function addSource(state, name) {
  (state.sources ||= []).push({ name, interval_s: 60 });
}

export function removeSource(state, index) {
  if (!state.sources) return;
  state.sources.splice(index, 1);
}

// Edite name/url/interval_s. Valeur vide => suppression de la cle (parite avec setComponentProp).
export function setSourceProp(state, index, key, value) {
  const s = state.sources?.[index];
  if (!s) return;
  if (value === '' || value === null || value === undefined) delete s[key];
  else s[key] = value;
}

// Remplace l'objet headers (reconstruit cote UI depuis une liste de paires). Vide => supprime la cle.
export function setSourceHeaders(state, index, headers) {
  const s = state.sources?.[index];
  if (!s) return;
  if (headers && Object.keys(headers).length) s.headers = headers;
  else delete s.headers;
}

// Remplace l'objet vars (nom -> JSON Pointer). Vide => supprime la cle.
export function setSourceVars(state, index, vars) {
  const s = state.sources?.[index];
  if (!s) return;
  if (vars && Object.keys(vars).length) s.vars = vars;
  else delete s.vars;
}

// --- Sinks (push réactif ; miroir des sources) ---

// Nom libre <sink><n> : 1er entier sans collision avec les noms existants.
export function uniqueSinkName(state) {
  const used = new Set((state.sinks || []).map(s => s.name));
  let n = 1;
  while (used.has(`sink${n}`)) n++;
  return `sink${n}`;
}

// Ajoute un sink en fin de liste. watch/url absents volontairement (l'utilisateur les saisit ;
// requis par le schema => signalés invalides tant qu'ils sont vides).
export function addSink(state, name) {
  (state.sinks ||= []).push({ name, watch: '', url: '', debounce_ms: 0 });
}

export function removeSink(state, index) {
  if (!state.sinks) return;
  state.sinks.splice(index, 1);
}

// Edite name/watch/url/debounce_ms. Valeur vide => suppression de la cle (parité avec setSourceProp).
export function setSinkProp(state, index, key, value) {
  const s = state.sinks?.[index];
  if (!s) return;
  if (value === '' || value === null || value === undefined) delete s[key];
  else s[key] = value;
}

// Remplace l'objet headers (reconstruit côté UI depuis une liste de paires). Vide => supprime la clé.
export function setSinkHeaders(state, index, headers) {
  const s = state.sinks?.[index];
  if (!s) return;
  if (headers && Object.keys(headers).length) s.headers = headers;
  else delete s.headers;
}

// Remplace le body (objet JSON envoyé au endpoint). null/absent => supprime la clé (firmware applique son défaut).
export function setSinkBody(state, index, body) {
  const s = state.sinks?.[index];
  if (!s) return;
  if (body != null) s.body = body;
  else delete s.body;
}
