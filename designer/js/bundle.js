// Bundle .dboard : { version:1, layout, assets:{ bg|image|aimg : { key: base64 } } }.
// Partie PURE (encode/decode + base64) — testée en node. La partie « caches » (plus bas) touche
// les modules d'assets et n'est exécutable qu'au navigateur (canvas).

import { referencedKeys, cacheBytes as bgBytes, cachePut as bgPut } from './bg-image.js';
import { referencedImageKeys, cacheBytes as imgBytes, rehydrate as imgRehydrate } from './image-asset.js';
import { referencedAimgKeys, packBytes as aimgBytes, rehydrate as aimgRehydrate } from './image-anim-asset.js';
import { t } from './i18n.js';

const CHUNK = 0x8000;
function bytesToB64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i += CHUNK) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  return btoa(bin);
}
function b64ToBytes(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
const mapVals = (m, f) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, f(v)]));

// layoutText (string JSON) + assets {bg,image,aimg : {key:Uint8Array}} → string .dboard.
export function encodeBundle(layoutText, assets = {}) {
  return JSON.stringify({
    version: 1,
    layout: JSON.parse(layoutText),
    assets: {
      bg: mapVals(assets.bg, bytesToB64),
      image: mapVals(assets.image, bytesToB64),
      aimg: mapVals(assets.aimg, bytesToB64),
    },
  });
}

// string .dboard → { layout: string JSON, assets:{bg,image,aimg : {key:Uint8Array}} }. Throw si invalide.
export function decodeBundle(text) {
  const o = JSON.parse(text);
  if (o.version !== 1 || !o.assets || !o.layout) throw new Error(t('bundle.invalid'));
  return {
    layout: JSON.stringify(o.layout),
    assets: {
      bg: mapVals(o.assets.bg, b64ToBytes),
      image: mapVals(o.assets.image, b64ToBytes),
      aimg: mapVals(o.assets.aimg, b64ToBytes),
    },
  };
}

// Lit les octets en cache pour toutes les clés référencées par le layout (3 types).
export function collectAssets(model) {
  const pick = (keys, get) => Object.fromEntries(keys.map(k => [k, get(k)]).filter(([, v]) => v));
  return {
    bg: pick(referencedKeys(model.state), bgBytes),
    image: pick(referencedImageKeys(model.state), imgBytes),
    aimg: pick(referencedAimgKeys(model.state), aimgBytes),
  };
}

// Ré-hydrate les caches depuis les octets du bundle. Fonds par clé ; image/anim par composant
// (rehydrate exige compId + dims, lues dans le layout) — même logique que app.js load.
export function applyAssets(model, assets) {
  for (const [k, bytes] of Object.entries(assets.bg || {})) bgPut(k, bytes);
  for (const [id, ic] of Object.entries(model.state.components || {})) {
    if (ic.type === 'image' && assets.image?.[ic.src] && ic.w > 0 && ic.h > 0) {
      imgRehydrate(ic.src, id, assets.image[ic.src], ic.w, ic.h);
    }
    if (ic.type === 'image_anim' && assets.aimg?.[ic.src] && ic.w > 0 && ic.h > 0 && ic.frames > 0) {
      aimgRehydrate(ic.src, assets.aimg[ic.src], ic.w, ic.h, ic.frames);
    }
  }
}

export function serializeBundle(model) {
  return encodeBundle(model.toJSON(), collectAssets(model));
}

export function loadBundle(model, text) {
  const { layout, assets } = decodeBundle(text);
  model.loadJSON(layout);
  applyAssets(model, assets);
}
