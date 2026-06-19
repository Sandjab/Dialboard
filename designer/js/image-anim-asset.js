// Conversion GIF/serie d'images -> pack RGB565A8 multi-frames (N frames brutes concatenees) pour le
// composant image_anim. Le NAVIGATEUR decode/rasterise/convertit ; le device n'affiche que du
// RGB565A8 deja pret (cf. view.cpp aimg_load_component). Reutilise la conversion d'image-asset.js et
// le hash de bg-image.js (meme device, meme contrat). previewUrl(key, frame) sert l'apercu.
import { SWAP, fnv1a64Hex } from './bg-image.js';
import { rgba8888ToRgb565a8, rgb565a8ToRgba8888 } from './image-asset.js';

// --- Pur (testable hors navigateur) : assemble des octets de frames deja convertis en pack + cle. ---
export function packFrames(frameBytesList) {
  const total = frameBytesList.reduce((s, f) => s + f.length, 0);
  const pack = new Uint8Array(total);
  let off = 0;
  for (const f of frameBytesList) { pack.set(f, off); off += f.length; }
  return { key: fnv1a64Hex(pack), bytes: pack, frames: frameBytesList.length };
}

export function referencedAimgKeys(state) {
  return [...new Set(Object.values(state.components || {})
    .map(c => (c && c.type === 'image_anim') ? c.src : null).filter(Boolean))];
}

// --- Cache d'apercu (navigateur). cle -> { bytes, frames, w, h, urls:[dataURL/frame] }. ---
const _cache = new Map();
export function packBytes(key)  { return _cache.get(key)?.bytes  || null; }
export function frameCount(key) { return _cache.get(key)?.frames || 0; }
export function previewUrls(key){ return _cache.get(key)?.urls   || []; }
export function previewUrl(key, frame = 0) {
  const e = _cache.get(key);
  return e ? (e.urls[frame] || e.urls[0] || null) : null;
}

function frameDataUrl(bytes, off, w, h) {
  const cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext('2d');
  const img = ctx.createImageData(w, h);
  img.data.set(rgb565a8ToRgba8888(bytes.subarray(off, off + w * h * 3), SWAP));
  ctx.putImageData(img, 0, 0);
  return cnv.toDataURL();
}
function cachePack(key, bytes, frames, w, h) {
  const fb = w * h * 3;
  const urls = [];
  for (let i = 0; i < frames; i++) urls.push(frameDataUrl(bytes, i * fb, w, h));
  _cache.set(key, { bytes, frames, w, h, urls });
}

// Rasterise un drawable (VideoFrame/ImageBitmap) a w×h (etire) -> octets RGB565A8 (1 frame).
function frameToBytes(drawable, w, h) {
  const cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(drawable, 0, 0, w, h);
  return rgba8888ToRgb565a8(ctx.getImageData(0, 0, w, h).data, SWAP);
}

// Assemble des drawables en pack -> { key, bytes, frames, w, h } + cache d'apercu.
export function framesToAsset(drawables, w, h) {
  const list = drawables.map(d => { const b = frameToBytes(d, w, h); d.close?.(); return b; });
  const { key, bytes, frames } = packFrames(list);
  cachePack(key, bytes, frames, w, h);
  return { key, bytes, frames, w, h };
}

// Decode un GIF anime -> { drawables, periodMs } (periode = moyenne des durees de frames du GIF).
export async function decodeGif(file) {
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type || 'image/gif' });
  await dec.tracks.ready;
  const count = dec.tracks.selectedTrack?.frameCount || 1;
  const drawables = []; let totalUs = 0;
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    drawables.push(image);
    totalUs += (image.duration || 0);            // microsecondes
  }
  const periodMs = (count > 0 && totalUs > 0) ? Math.round(totalUs / count / 1000) : 100;
  return { drawables, periodMs };
}

// Plusieurs fichiers image -> { drawables, periodMs } (tries par nom).
export async function decodeImages(files) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const drawables = [];
  for (const f of sorted) drawables.push(await createImageBitmap(f));
  return { drawables, periodMs: 100 };
}

// Rehydrate depuis le device (pack brut) -> reconstruit le cache d'apercu.
export function rehydrate(key, bytes, w, h, frames) { cachePack(key, bytes, frames, w, h); }
