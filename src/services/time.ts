export const minutesToMs = (min: number) => min * 60 * 1000;

export const minutesFromNow = (min: number): bigint =>
  BigInt(Math.floor((Date.now() + minutesToMs(min)) / 1000));
