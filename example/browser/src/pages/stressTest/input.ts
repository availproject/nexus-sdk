export const titleCase = (value: string) =>
  value.length > 0
    ? `${value.charAt(0).toUpperCase()}${value.slice(1)}`
    : value;

export const normalizePrivateKey = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) return null;
  return normalized as `0x${string}`;
};
