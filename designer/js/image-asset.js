// Conversion image -> RGB565A8 (avec alpha) pour les images placées. Le NAVIGATEUR fait tout le
// decodage/rasterisation ; le device n'affiche que du RGB565A8 deja pret (cf. view.cpp build_image).
// Miroir de bg-image.js, mais : (1) 3 octets/px (2 couleur + 1 alpha), (2) etirement LIBRE a w×h (pas
// de cover-crop), (3) garde une SOURCE re-dessinable par composant pour re-rendre au resize.
// Reutilise SWAP (LV_COLOR_16_SWAP=1) et fnv1a64Hex de bg-image.js (meme device, meme contrat).
import { SWAP, fnv1a64Hex } from './bg-image.js';

// RGBA8888 (Uint8ClampedArray) -> RGB565A8 PLANAIRE (Uint8Array, 3 octets/px) : plan couleur
// (px·2 octets) PUIS plan alpha (px·1 octet). C'est le layout qu'attend LVGL 9 (« color array
// followed by alpha array »). NB : en v8 l'alpha etait entrelace par pixel ; LVGL 9 est planaire.
// Le plan couleur suit la MÊME convention que le fond RGB565 (bg-image.js, `swap`=SWAP=false =
// little-endian natif, ce que LVGL 9 lit pour toute source) ; le plan alpha A8 n'a pas de byte order.
export function rgba8888ToRgb565a8(rgba, swap = SWAP) {
  const px = rgba.length >> 2;
  const out = new Uint8Array(px * 3);
  const aoff = px * 2;                          // le plan alpha suit le plan couleur
  for (let i = 0; i < px; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    const v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
    if (swap) { out[i * 2] = (v >> 8) & 0xFF; out[i * 2 + 1] = v & 0xFF; }
    else      { out[i * 2] = v & 0xFF;        out[i * 2 + 1] = (v >> 8) & 0xFF; }
    out[aoff + i] = a;
  }
  return out;
}

// RGB565A8 PLANAIRE -> RGBA8888 (pour reconstruire un apercu). Symetrique de l'encode (meme byte order
// que le fond, plan alpha apres) -> le round-trip d'apercu reste fidele au rendu device.
export function rgb565a8ToRgba8888(bytes, swap = SWAP) {
  const px = (bytes.length / 3) | 0;
  const out = new Uint8ClampedArray(px * 4);
  const aoff = px * 2;                          // le plan alpha suit le plan couleur
  for (let i = 0, o = 0; i < px; i++) {
    const b0 = bytes[i * 2], b1 = bytes[i * 2 + 1], a = bytes[aoff + i];
    const v = swap ? (b0 << 8) | b1 : (b1 << 8) | b0;
    const r5 = (v >> 11) & 0x1F, g6 = (v >> 5) & 0x3F, b5 = v & 0x1F;
    out[o++] = r5 << 3; out[o++] = g6 << 2; out[o++] = b5 << 3; out[o++] = a;
  }
  return out;
}

// Cles d'asset referencees par des composants image (pour upload/sweep cote app.js).
export function referencedImageKeys(state) {
  return [...new Set(Object.values(state.components || {})
    .map(c => (c && c.type === 'image') ? c.src : null).filter(Boolean))];
}

// --- Cache d'asset (cle -> {bytes, url}) + source re-dessinable par composant (compId -> drawable). ---
// Non persiste : au reload, repeuple via rehydrate() depuis le device (cf. app.js).
const _cache = new Map();     // key -> { bytes: Uint8Array RGB565A8, url: dataURL }
const _sources = new Map();   // compId -> ImageBitmap | HTMLCanvasElement (source pour re-render au resize)

export function cacheBytes(key) { return _cache.get(key)?.bytes || null; }
export function previewUrl(key) { return _cache.get(key)?.url || null; }
export function sourceFor(compId) { return _sources.get(compId) || null; }

// Construit un dataURL d'apercu depuis des octets RGB565A8 (w×h).
function buildUrl(bytes, w, h) {
  const cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext('2d');
  const img = ctx.createImageData(w, h);
  img.data.set(rgb565a8ToRgba8888(bytes, SWAP));
  ctx.putImageData(img, 0, 0);
  return cnv.toDataURL();
}

// Rasterise un drawable (ImageBitmap/canvas) a w×h ETIRE (deformation assumee) -> { key, bytes }. Cache.
export function renderToAsset(drawable, w, h) {
  const cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(drawable, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const bytes = rgba8888ToRgb565a8(rgba, SWAP);
  const key = fnv1a64Hex(bytes);
  _cache.set(key, { bytes, url: buildUrl(bytes, w, h) });
  return { key, bytes };
}

// Fichier choisi pour un composant -> { key, bytes }. Memorise la source (pour re-render au resize).
export async function imageFileToAsset(file, compId, w, h) {
  const bmp = await createImageBitmap(file);
  _sources.set(compId, bmp);
  return renderToAsset(bmp, w, h);
}

// Rehydrate depuis le device : octets RGB565A8 + dims -> cache + source de repli (canvas redessinable,
// qualite degradee si un resize survient ensuite, faute de l'original).
export function rehydrate(key, compId, bytes, w, h) {
  const cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext('2d');
  const img = ctx.createImageData(w, h);
  img.data.set(rgb565a8ToRgba8888(bytes, SWAP));
  ctx.putImageData(img, 0, 0);
  _cache.set(key, { bytes, url: cnv.toDataURL() });
  _sources.set(compId, cnv);
}
