const TOKEN_COLORS: ReadonlyArray<readonly [string, string]> = [
  ['#6366f1', '#4f46e5'],
  ['#8b5cf6', '#7c3aed'],
  ['#ec4899', '#db2777'],
  ['#f43f5e', '#e11d48'],
  ['#f97316', '#ea580c'],
  ['#eab308', '#ca8a04'],
  ['#22c55e', '#16a34a'],
  ['#14b8a6', '#0d9488'],
  ['#06b6d4', '#0891b2'],
  ['#3b82f6', '#2563eb'],
  ['#a855f7', '#9333ea'],
  ['#ef4444', '#dc2626'],
];

const hashSymbol = (symbol: string): number => {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash + symbol.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % TOKEN_COLORS.length;
};

const getLabel = (symbol: string): string => {
  const normalized = symbol.trim().toUpperCase();
  return normalized.length <= 3 ? normalized : normalized.charAt(0);
};

const getFontSize = (label: string, size: number): number => {
  const base = size * 0.42;
  if (label.length === 1) return base;
  if (label.length === 2) return base * 0.75;
  return base * 0.58;
};

const generateTokenLogoSvg = (symbol: string, size = 128): string => {
  const [colorStart, colorEnd] = TOKEN_COLORS[hashSymbol(symbol)];
  const label = getLabel(symbol);
  const fontSize = getFontSize(label, size);
  const half = size / 2;
  const gradientId = `tg-${symbol.toLowerCase()}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colorStart}"/>
      <stop offset="100%" stop-color="${colorEnd}"/>
    </linearGradient>
  </defs>
  <circle cx="${half}" cy="${half}" r="${half}" fill="url(#${gradientId})"/>
  <text
    x="${half}" y="${half}"
    text-anchor="middle"
    dominant-baseline="central"
    font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
    font-size="${fontSize}"
    font-weight="600"
    fill="white"
    letter-spacing="-0.5"
  >${label}</text>
</svg>`;
};

export const getFallbackTokenLogoDataUri = (symbol: string, size = 128): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(generateTokenLogoSvg(symbol, size))}`;
