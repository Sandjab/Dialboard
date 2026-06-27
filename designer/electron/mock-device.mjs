// Faux device HTTP pour le PoC desktop : dev manuel (CLI) + test transport.
// Sert les routes utilisées par le socle ; simule la validation device sur POST /layout.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAYOUT_PATH = join(__dirname, '..', '..', 'data', 'layout.json'); // racine repo / data

const STATUS = { ip: '127.0.0.1', page: 0, pages: 1, uptime_s: 1, components: 0, sources: [] };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Démarre le mock. port=0 → port libre attribué par l'OS (tests). Renvoie { url, close }.
export function startMockDevice(port = 0) {
  const layout = readFileSync(LAYOUT_PATH, 'utf8');
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const sendJson = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET' && url.pathname === '/status') return sendJson(200, STATUS);
    if (req.method === 'GET' && url.pathname === '/layout') {
      // layout est déjà une chaîne JSON → res.end direct, sans le JSON.stringify de sendJson
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(layout);
    }
    if (req.method === 'POST' && url.pathname === '/layout') {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body); } catch { return sendJson(400, { ok: false, error: 'JSON invalide' }); }
      if (!Array.isArray(parsed.pages)) return sendJson(200, { ok: false, error: 'layout sans pages' });
      return sendJson(200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/update') {
      return sendJson(200, { ok: true, updated: [], unknown: [] });
    }
    return sendJson(404, { ok: false, error: 'not found' });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({
        url: `http://127.0.0.1:${p}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// Lancement CLI direct : `node mock-device.mjs` → écoute sur PORT (défaut 8099) pour le dev manuel.
// 8099 et non 8000 (port réservé à l'utilisateur).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT) || 8099;
  startMockDevice(port).then((d) => console.log('mock device →', d.url));
}
