export const normalizePrivateKey = (value: string | undefined | null) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) return null;
  return normalized as `0x${string}`;
};

export const maskPrivateKey = (value: `0x${string}`) => {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};
