// Process principal Electron du designer desktop (PoC socle).
// - sert designer/ + schema/ via le protocole interne app:// (file:// casserait les modules ES) ;
// - injecte les en-têtes CORS sur les réponses du device (approche A) → designer/ reste zéro-touch.
const { app, BrowserWindow, protocol, session, net, ipcMain, Menu, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');

// Racine servie par app:// : contient designer/ ET schema/ côte à côte (= racine du repo en dev).
// app://app/designer/index.html → ROOT/designer/index.html ; le fetch('../schema/…') de app.js → ROOT/schema/…
// En packagé, electron-builder a copié designer/ + schema/ sous resources/app-root (extraResources).
const ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app-root')
  : path.resolve(__dirname, '..', '..');

// MIME explicite : net.fetch(file://) déduit le type de la base MIME de l'OS (peu fiable hors macOS).
// Le designer vise Win/macOS/Linux ; les modules ES exigent un type JS, sinon le navigateur les refuse.
const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml',
};

// Doit être appelé AVANT app.whenReady. standard:true → modules ES + localStorage ;
// secure:false → la page n'est pas un secure context, donc fetch http://<device> n'est pas bloqué (mixed-content).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: false, supportFetchAPI: true, stream: true } },
]);

function injectCors() {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (!/^https?:\/\//.test(details.url)) return cb({});
    const cors = {
      'Access-Control-Allow-Origin': ['*'],
      'Access-Control-Allow-Methods': ['GET, POST, OPTIONS'],
      'Access-Control-Allow-Headers': ['*'],
      'Access-Control-Max-Age': ['86400'],
    };
    // Préflight : le navigateur exige un 2xx ET les en-têtes. On neutralise OPTIONS côté Electron pour
    // ne pas dépendre du comportement OPTIONS du device (ni du mock, qui ne gère pas OPTIONS).
    if (details.method === 'OPTIONS') return cb({ statusLine: 'HTTP/1.1 204 No Content', responseHeaders: cors });
    // Retire d'abord tout en-tête CORS du device (insensible à la casse) : un access-control-allow-origin déjà
    // émis par le firmware s'ajouterait au nôtre (clés de casse ≠ en JS) → doublon → Chromium rejette.
    const clean = {};
    for (const [k, v] of Object.entries(details.responseHeaders || {})) {
      if (!/^access-control-/i.test(k)) clean[k] = v;
    }
    cb({ responseHeaders: { ...clean, ...cors } });
  });
}

function serveApp() {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.join(ROOT, decodeURIComponent(pathname));
    // Garde anti-traversal : %2E%2E / %2F survivent à la normalisation d'URL puis au décodage.
    if (!filePath.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const res = await net.fetch(pathToFileURL(filePath).toString());
      const ct = MIME[path.extname(filePath).toLowerCase()];
      if (!ct) return res;
      const headers = new Headers(res.headers);
      headers.set('Content-Type', ct);
      return new Response(res.body, { status: res.status, headers });
    } catch (err) {
      // Fichier absent/illisible : 404 explicite + log (cf. spec) plutôt qu'une promesse rejetée non gérée.
      console.error('[serveApp] fichier introuvable ou illisible : ' + filePath, err);
      return new Response('Not Found', { status: 404 });
    }
  });
}

app.whenReady().then(() => {
  // Découverte mDNS : browse _http._tcp pendant ~2,5 s, filtre « dialboard », renvoie [{name,ip,port,url}].
  ipcMain.handle('discover-devices', async () => {
    try {
      const { Bonjour } = await import('bonjour-service');
      const { parseService, isDialboardService } = await import('./discovery.mjs');
      const bonjour = new Bonjour();
      let browser;
      try {
        browser = bonjour.find({ type: 'http' });
        await new Promise((r) => setTimeout(r, 2500));
        const found = browser.services.filter(isDialboardService).map(parseService).filter(Boolean);
        const byIp = new Map();
        for (const d of found) if (!byIp.has(d.ip)) byIp.set(d.ip, d);
        return [...byIp.values()];
      } finally {
        if (browser) browser.stop();
        bonjour.destroy();   // toujours fermer le socket multicast, même si find() jette
      }
    } catch (e) {
      console.error('[discover-devices]', e);   // best-effort UX, mais on trace (pas de panne muette)
      return [];
    }
  });

  injectCors();
  serveApp();
  const win = new BrowserWindow({
    width: 1100, height: 800,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.loadURL('app://app/designer/index.html');

  // Menu natif : raccourcis fichier → relayés au renderer (qui détient model + caches).
  const send = (action) => () => win.webContents.send('menu', action);
  const DEFAULT_MENU = { file: 'File', open: 'Open…', save: 'Save', saveAs: 'Save As…' };
  const buildMenu = (labels) => {
    const L = { ...DEFAULT_MENU, ...(labels || {}) };
    const fileMenu = {
      label: L.file,
      submenu: [
        { label: L.open, accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: L.save, accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: L.saveAs, accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    };
    const template = process.platform === 'darwin'
      ? [{ role: 'appMenu' }, fileMenu, { role: 'editMenu' }, { role: 'viewMenu' }]
      : [fileMenu, { role: 'editMenu' }, { role: 'viewMenu' }];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };
  buildMenu();   // menu initial (EN) ; le renderer le réémet dans la langue active au boot
  ipcMain.handle('menu:setLabels', (_e, labels) => buildMenu(labels));

  const DBOARD = [{ name: 'Dialboard', extensions: ['dboard'] }];
  ipcMain.handle('file:open', async () => {
    const r = await dialog.showOpenDialog(win, { filters: DBOARD, properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { path: r.filePaths[0], text: await fs.readFile(r.filePaths[0], 'utf8') };
  });
  ipcMain.handle('file:save', async (_e, { text, path: p }) => {
    let target = p;
    if (!target) {
      const r = await dialog.showSaveDialog(win, { filters: DBOARD, defaultPath: 'layout.dboard' });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    await fs.writeFile(target, text);
    return { path: target };
  });
  ipcMain.handle('file:saveAs', async (_e, { text }) => {
    const r = await dialog.showSaveDialog(win, { filters: DBOARD, defaultPath: 'layout.dboard' });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, text);
    return { path: r.filePath };
  });
  ipcMain.handle('window:setTitle', (_e, name) => win.setTitle(name));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
