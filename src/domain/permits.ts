export enum PermitVariant {
  Unsupported = 0,
  EIP2612Canonical = 1,
  DAI = 2,
  Polygon2612 = 3,
  PolygonEMT = 4,
}

export type PermitDetails = {
  permitVariant: PermitVariant;
  permitContractVersion: number;
};

export class PermitCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermitCreationError';
  }
}

export type PermitCurrency = {
  tokenAddress: `0x${string}`;
  decimals: number;
  permitVariant: PermitVariant;
  permitContractVersion: number;
};
