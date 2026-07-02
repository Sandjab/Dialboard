// Présentation de GET /wifi pour le panneau — séparée du transport (testable node).
// Ne remonte QUE des SSID + un drapeau « connecté » ; aucun mot de passe (write-only).
export function formatWifiList(data) {
  const d = (data && typeof data === 'object') ? data : {};
  const connected = typeof d.connected === 'string' ? d.connected : '';
  const nets = Array.isArray(d.nets) ? d.nets.filter(s => typeof s === 'string') : [];
  return nets.map(ssid => ({ ssid, connected: ssid === connected }));
}
