import type { PassColor } from './ui';

// The API doesn't store colours: a class gets one from its course code, so the
// same class has the same colour on every screen and every visit.
const COLORS: PassColor[] = ['teal', 'indigo', 'orange', 'pink', 'slate', 'purple'];

export function passColor(courseCode: string): PassColor {
  // Order matters ("ITS332" and "ITS323" must differ), so multiply as we go.
  // shortcut: with 6 colours two courses can share one; 33 keeps the two seeded courses apart.
  let hash = 0;
  for (const ch of courseCode) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}
