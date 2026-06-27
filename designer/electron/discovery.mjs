// Logique pure de découverte mDNS (aucune I/O réseau) → testable en node.
const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

// URL device depuis IP + port : http://<ip> (port 80 omis), sinon http://<ip>:<port>.
export function toDeviceUrl(ip, port) {
  return `http://${ip}` + (port && port !== 80 ? `:${port}` : '');
}

// Vrai si l'enregistrement ressemble à un device Dialboard (nom/host commençant par « dialboard »).
export function isDialboardService(svc) {
  const name = (svc?.name ?? '').toLowerCase();
  const host = (svc?.host ?? '').toLowerCase();
  return name.startsWith('dialboard') || host.startsWith('dialboard');
}

// Enregistrement bonjour → { name, ip, port, url } ; null si pas d'adresse IPv4.
export function parseService(svc) {
  const ip = (svc?.addresses ?? []).find((a) => IPV4.test(a));
  if (!ip) return null;
  return { name: svc.name ?? '', ip, port: svc.port, url: toDeviceUrl(ip, svc.port) };
}
