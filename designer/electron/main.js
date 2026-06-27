// Process principal Electron du designer desktop (PoC socle).
// - sert designer/ + schema/ via le protocole interne app:// (file:// casserait les modules ES) ;
// - injecte les en-têtes CORS sur les réponses du device (approche A) → designer/ reste zéro-touch.
const { app, BrowserWindow, protocol, session, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Racine servie par app:// : contient designer/ ET schema/ côte à côte (= racine du repo en dev).
// app://app/designer/index.html → ROOT/designer/index.html ; le fetch('../schema/…') de app.js → ROOT/schema/…
const ROOT = path.resolve(__dirname, '..', '..');

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
    cb({ responseHeaders: { ...details.responseHeaders, ...cors } });
  });
}

function serveApp() {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.join(ROOT, decodeURIComponent(pathname));
    // Garde anti-traversal : %2E%2E / %2F survivent à la normalisation d'URL puis au décodage.
    if (!filePath.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(filePath).toString());
    const ct = MIME[path.extname(filePath).toLowerCase()];
    if (!ct) return res;
    const headers = new Headers(res.headers);
    headers.set('Content-Type', ct);
    return new Response(res.body, { status: res.status, headers });
  });
}

app.whenReady().then(() => {
  injectCors();
  serveApp();
  const win = new BrowserWindow({ width: 1100, height: 800, webPreferences: { contextIsolation: true } });
  win.loadURL('app://app/designer/index.html');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
