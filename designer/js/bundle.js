// Bundle .dboard : { version:1, layout, assets:{ bg|image|aimg : { key: base64 } } }.
// Partie PURE (encode/decode + base64) — testée en node. La partie « caches » (plus bas) touche
// les modules d'assets et n'est exécutable qu'au navigateur (canvas).

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
  if (o.version !== 1 || !o.assets) throw new Error('Bundle .dboard invalide ou version non supportée');
  return {
    layout: JSON.stringify(o.layout),
    assets: {
      bg: mapVals(o.assets.bg, b64ToBytes),
      image: mapVals(o.assets.image, b64ToBytes),
      aimg: mapVals(o.assets.aimg, b64ToBytes),
    },
  };
}
