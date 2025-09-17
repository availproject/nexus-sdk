import { InternalRpcError, UserRejectedRequestError } from "viem";

const ErrorUserDeniedIntent = new UserRejectedRequestError(
  new Error("User denied intent."),
);

const ErrorUserDeniedAllowance = new UserRejectedRequestError(
  new Error("User denied allowance."),
);

const ErrorInsufficientBalance = new InternalRpcError(
  new Error("Insufficient balance."),
);

const ErrorBuildingIntent = new InternalRpcError(
  new Error("Error while building intent."),
);

const ErrorLiquidityTimeout = new InternalRpcError(
  new Error("Timed out waiting for liquidity."),
);

export {
  ErrorBuildingIntent,
  ErrorInsufficientBalance,
  ErrorLiquidityTimeout,
  ErrorUserDeniedAllowance,
  ErrorUserDeniedIntent,
};
