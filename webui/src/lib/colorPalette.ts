const HEX_TOKEN = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

/** Expand #RGB to #RRGGBB for display and `<input type="color">`. */
export function normalizeHexColor(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const match = HEX_TOKEN.exec(withHash);
  if (!match) return null;
  const raw = match[1];
  if (raw.length === 3) {
    const [r, g, b] = raw.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return `#${raw}`.toUpperCase();
}

export function parseColorPalette(cp: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of cp.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const value = normalizeHexColor(token) ?? token;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function parseHexColorPalette(cp: string): string[] {
  return parseColorPalette(cp).flatMap((token) => {
    const hex = normalizeHexColor(token);
    return hex ? [hex] : [];
  });
}

export function formatColorPalette(colors: string[]): string {
  return colors.join(", ");
}
