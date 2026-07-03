// designer/js/qr.js — jumeau JS du rendu lv_qrcode (paramètres figés côté firmware)
import qrcodegen from '../vendor/qrcodegen.js';
const { QrCode } = qrcodegen;

// Renvoie { size, get(x,y) } pour un texte donné, en MEDIUM (comme lv_qrcode).
// Texte trop long -> encodeBinary lève RangeError ; on replie sur l'URL device pour ne pas
// faire planter le rendu du canvas (le firmware, lui, borne le texte à TEXT_LEN).
export function qrModules(text) {
  const encode = t => {
    const bytes = Array.from(new TextEncoder().encode(t));
    const qr = QrCode.encodeBinary(bytes, QrCode.Ecc.MEDIUM);
    return { size: qr.size, get: (x, y) => qr.getModule(x, y) };
  };
  try {
    return encode(text ?? '');
  } catch {
    return encode('http://dialboard.local');
  }
}
