import { Hex } from "viem";

const ErrorChainDataNotFound = new Error("Chain data not found.");
const ErrorCOTNotFound = (chainID: number) =>
  new Error(`COT not found on chain: ${chainID}`);
const ErrorTokenNotFound = (address: Hex, chainID: number) =>
  new Error(`Token(${address}) not found on chain: ${chainID}`);
const ErrorSingleSourceHasNoSource = new Error(
  "Single source swap has input source missing.",
);
const ErrorInsufficientBalance = new Error("Insufficient balance.");

export {
  ErrorChainDataNotFound,
  ErrorCOTNotFound,
  ErrorInsufficientBalance,
  ErrorSingleSourceHasNoSource,
  ErrorTokenNotFound,
};
