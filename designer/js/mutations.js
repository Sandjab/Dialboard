// Mutations dédiées du layout. Fonctions PURES : elles mutent l'état passé en place et sont
// appelées via model.commit(s => mutate(s, ...)). Séparées de model.js (state/undo/events) pour
// rester testables sous node --test. Toute clé posée doit rester valide vis-à-vis du schéma.

import { COMPONENTS } from './registry.js';

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

// thresholds : tableau de [limite, "#hex"]. Vide => suppression de la clé.
export function setThresholds(state, id, thresholds) {
  const c = state.components[id];
  if (!c) return;
  if (thresholds && thresholds.length) c.thresholds = thresholds;
  else delete c.thresholds;
}

// --- Pages (Plan C2) ---

// Nom de page auto unique (« Page N » au premier N libre) : évite les collisions à la création, le
// nom de page étant la cible de POST /page {"name":...}. Le renommage manuel reste libre. Cf. uniqueSourceName.
export function uniquePageName(state) {
  const used = new Set((state.pages || []).map(p => p.name));
  let n = 1;
  while (used.has(`Page ${n}`)) n++;
  return `Page ${n}`;
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

export function removePage(state, pageIndex) {
  if (!state.pages) return;
  state.pages.splice(pageIndex, 1);
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
  if (page) page.name = name;
}

// Déplace la page d'index `from` vers `to`. No-op si index hors bornes ou identiques.
export function reorderPages(state, from, to) {
  const pages = state.pages;
  if (!pages || from === to) return;
  if (from < 0 || from >= pages.length || to < 0 || to >= pages.length) return;
  const [p] = pages.splice(from, 1);
  pages.splice(to, 0, p);
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
