// Transport de flash série (Web Serial + esptool-js). Browser-only → browser-verified (comme les builders DOM).
import { ESPLoader, Transport } from '../vendor/esptool-bundle.js';

// port (SerialPort), fileArray ([{data:Uint8Array, address}] de usb-plan.planParts), opts.
// onProgress(frac 0..1) pondéré par taille des parts ; onLog(op, arg?) pour le journal ; eraseAll (efface la NVS/WiFi).
export async function flashDevice(port, fileArray, { onProgress, onLog, eraseAll = false } = {}) {
  const transport = new Transport(port, true);
  const loader = new ESPLoader({ transport, baudrate: 921600 });   // esptool-js 0.6.0 : le ctor ne lit PAS romBaudrate (hardcodé à 115200), inutile de le passer
  try {
    onLog && onLog('connect');
    const chip = await loader.main();                    // reset DTR/RTS + sync + détection de puce
    onLog && onLog('detected', chip);
    const total = fileArray.reduce((n, f) => n + f.data.length, 0) || 1;
    const done = new Array(fileArray.length).fill(0);
    onLog && onLog('write');
    await loader.writeFlash({
      fileArray,
      flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep',   // 'keep' : ne pas repatcher l'en-tête bootloader (déjà 16 Mo)
      eraseAll, compress: true,
      reportProgress: (i, written) => {
        done[i] = written;
        onProgress && onProgress(done.reduce((a, b) => a + b, 0) / total);
      },
    });
    onLog && onLog('reset');
    await loader.after('hard_reset');                    // reset confirmé Task 1 (esptool-js 0.6.0 : ESPLoader.after, défaut 'hard_reset')
  } finally {
    try { await transport.disconnect(); } catch { /* déjà fermé / débranché */ }
  }
}
