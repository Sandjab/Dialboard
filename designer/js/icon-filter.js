// Logique PURE du picker d'icônes (testable node ; le DOM vit dans icon-picker.js).
export function filterIcons(icons, query, category) {
  const q = (query || '').trim().toLowerCase();
  return icons.filter(i => {
    if (category && i.cat !== category) return false;
    if (!q) return true;
    if (i.name.toLowerCase().includes(q)) return true;
    return (i.tags || []).some(t => t.toLowerCase().includes(q));
  });
}

export function categoriesOf(icons) {
  return [...new Set(icons.map(i => i.cat))].sort();
}
