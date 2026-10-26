// Curated calendar colours for stylists: mid-lightness, saturated enough to read as a 4px stripe and a
// tinted block on white, ordered so neighbours stay distinguishable for colour-blind users.
// A stylist's name always sits next to the colour, so identity never depends on colour alone.
export const STAFF_COLORS: { hex: string; name: string }[] = [
  { hex: '#0F6E73', name: 'Peacock' },
  { hex: '#7A3FB8', name: 'Violet' },
  { hex: '#C2541B', name: 'Rust' },
  { hex: '#2F6DB5', name: 'Indigo' },
  { hex: '#9A6B00', name: 'Turmeric' },
  { hex: '#B43D6B', name: 'Rose' },
  { hex: '#5B4FC4', name: 'Iris' },
  { hex: '#3B7D3A', name: 'Leaf' },
];

/** First palette colour not used by the current team (cycles once all are used). */
export function nextStaffColor(used: string[]): string {
  const taken = new Set(used.map((c) => c.toUpperCase()));
  return (STAFF_COLORS.find((c) => !taken.has(c.hex)) ?? STAFF_COLORS[used.length % STAFF_COLORS.length]).hex;
}
