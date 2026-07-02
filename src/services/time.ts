export const minutesToMs = (min: number) => min * 60 * 1000;

export const createDeadlineFromNow = (minutes = 3n): bigint => {
  const nowInSeconds = BigInt(Math.floor(Date.now() / 1000));
  return nowInSeconds + minutes * 60n;
};
