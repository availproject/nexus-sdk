import type { ReactNode } from "react";
import * as HoverCard from "@radix-ui/react-hover-card";
import { AssetRowIcon } from "./AssetRow";

export type TokenInfo = {
  symbol: string;
  tokenName?: string;
  tokenLogo?: string;
  chainName: string;
  chainLogo?: string;
  decimals?: number;
  contractAddress: string;
};

type TokenInfoCardProps = {
  token: TokenInfo;
  children: ReactNode;
  /** Side of the trigger to open on. Default "right" — popover appears outside the modal column. */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  openDelay?: number;
  closeDelay?: number;
};

/**
 * Reusable hover popover for a token+chain combo. Wrap any trigger element
 * (e.g. a chain row in the source picker, a token row in the destination picker)
 * and the card appears with full metadata on hover.
 */
export function TokenInfoCard({
  token,
  children,
  side = "top",
  align = "center",
  openDelay = 300,
  closeDelay = 100,
}: TokenInfoCardProps) {
  return (
    <HoverCard.Root openDelay={openDelay} closeDelay={closeDelay}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          className="token-info-card"
          side={side}
          sideOffset={8}
          align={align}
          collisionPadding={16}
        >
          <div className="token-info-header">
            <AssetRowIcon src={token.tokenLogo} fallback={token.symbol} />
            <div className="token-info-heading">
              <span className="token-info-name">{token.tokenName ?? token.symbol}</span>
              <span className="token-info-chain">on {token.chainName}</span>
            </div>
          </div>
          <dl className="token-info-rows">
            <div className="token-info-row">
              <dt>Symbol</dt>
              <dd>{token.symbol}</dd>
            </div>
            {token.tokenName && (
              <div className="token-info-row">
                <dt>Name</dt>
                <dd>{token.tokenName}</dd>
              </div>
            )}
            <div className="token-info-row">
              <dt>Chain</dt>
              <dd>{token.chainName}</dd>
            </div>
            {typeof token.decimals === "number" && (
              <div className="token-info-row">
                <dt>Decimals</dt>
                <dd>{token.decimals}</dd>
              </div>
            )}
            <div className="token-info-row token-info-row--address">
              <dt>Contract address</dt>
              <dd>
                <code>{token.contractAddress}</code>
              </dd>
            </div>
          </dl>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
