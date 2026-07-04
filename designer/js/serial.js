// Transport de flash série (Web Serial + esptool-js). Browser-only → browser-verified (comme les builders DOM).
import { ESPLoader, Transport } from '../vendor/esptool-bundle.js';
import { weightedProgress } from './usb-plan.js';

const USB_JTAG_SERIAL_PID = 0x1001;   // PID de l'USB-Serial/JTAG natif de l'ESP32-S3 (cf. esptool-js USB_JTAG_SERIAL_PID)

// port (SerialPort), fileArray ([{data:Uint8Array, address}] de usb-plan.planParts), opts.
// onProgress(frac 0..1) ; onLog(op, arg?) pour le journal ; eraseAll (efface la NVS/WiFi).
// Retourne { reset } — reset:false ⇒ le device n'a PAS pu redémarrer seul (l'UI invite à débrancher/rebrancher).
export async function flashDevice(port, fileArray, { onProgress, onLog, eraseAll = false } = {}) {
  if (!Array.isArray(fileArray) || !fileArray.length) return;   // défensif : rien à flasher
  const transport = new Transport(port, true);
  const loader = new ESPLoader({ transport, baudrate: 921600 });   // 0.6.0 : le ctor ne lit PAS romBaudrate (hardcodé 115200)
  try {
    onLog && onLog('connect');
    const chip = await loader.main();                    // entrée bootloader (reset auto USB-JTAG ou RTS selon PID) + détection
    onLog && onLog('detected', chip);
    // esptool reporte written/total en octets COMPRESSÉS (mêmes unités → ratio par fichier juste). On pondère la
    // fraction de chaque fichier par sa taille NON-compressée (connue) → montée fluide jusqu'à 100 % (le gros FS domine).
    const weights = fileArray.map(f => f.data.length);
    const frac = new Array(fileArray.length).fill(0);
    onLog && onLog('write');
    await loader.writeFlash({
      fileArray,
      flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep',   // 'keep' : ne pas repatcher l'en-tête bootloader (déjà 16 Mo)
      eraseAll, compress: true,
      reportProgress: (i, written, total) => {
        frac[i] = total ? written / total : 0;
        onProgress && onProgress(weightedProgress(frac, weights));
      },
    });
    // Reset post-flash BEST-EFFORT. On tente la stratégie par PID (usbJTAGSerialReset pour l'USB natif du S3,
    // sinon RTS) mais l'auto-reset n'est PAS fiable en Web Serial sur cet USB natif, et on ne peut pas détecter
    // de façon fiable si le device a physiquement redémarré → l'UI conseille TOUJOURS de débrancher/rebrancher.
    // Le flash a déjà réussi ; un reset raté n'est pas un échec.
    onLog && onLog('reset');
    try {
      const rc = loader.resetConstructors;
      const usbJtag = typeof transport.getPid === 'function' && transport.getPid() === USB_JTAG_SERIAL_PID;
      const make = (usbJtag && rc.usbJTAGSerialReset) ? rc.usbJTAGSerialReset : rc.hardReset;
      await make(transport).reset();
    } catch { /* reset best-effort ; l'utilisateur débranche/rebranche */ }
  } finally {
    try { await transport.disconnect(); } catch { /* déjà fermé / débranché */ }
  }
}
