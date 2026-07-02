// designer/js/qr.js — jumeau JS du rendu lv_qrcode (paramètres figés côté firmware)
import qrcodegen from '../vendor/qrcodegen.js';
const { QrCode } = qrcodegen;

// Renvoie { size, get(x,y) } pour un texte donné, en MEDIUM (comme lv_qrcode).
export function qrModules(text) {
  const bytes = Array.from(new TextEncoder().encode(text ?? ''));
  const qr = QrCode.encodeBinary(bytes, QrCode.Ecc.MEDIUM);
  return { size: qr.size, get: (x, y) => qr.getModule(x, y) };
}
