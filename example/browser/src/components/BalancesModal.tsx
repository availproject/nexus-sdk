import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { formatAmount } from "../lib/format";
import { D, sum } from "../lib/math";
import type { TokenBalance } from "@avail-project/nexus-core";
import {
  AssetRowIcon,
  AssetRowMeta,
  AssetRowValue,
  ChainDots,
  ChevronIcon,
  InfoIcon,
} from "./AssetRow";
import { TokenInfoCard } from "./TokenInfoCard";

type BalancesModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assets: TokenBalance[];
  loading: boolean;
  onRefresh: () => void;
};

export function BalancesModal({ open, onOpenChange, assets, loading, onRefresh }: BalancesModalProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const nonZeroAssets = useMemo(
    () => assets.filter((asset) => D(asset.balance).gt(0)),
    [assets],
  );

  const totalUsd = useMemo(
    () => sum(nonZeroAssets.map((a) => a.value)).toNumber(),
    [nonZeroAssets],
  );

  function toggleAsset(symbol: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-panel bal-modal-panel modal-content-centered">
          <div className="modal-header src-modal-header">
            <div className="src-modal-title">
              <Dialog.Title className="modal-title">Balances</Dialog.Title>
              <p className="src-modal-subtitle">Your cross-chain portfolio</p>
            </div>
            <div className="modal-header-actions">
              <button className="ghost-button" type="button" onClick={onRefresh} disabled={loading} title="Refresh" aria-label="Refresh balances">
                {loading ? (
                  <span className="spinner" />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                )}
              </button>
              <Dialog.Close asChild>
                <button className="ghost-button" type="button" title="Close" aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </Dialog.Close>
            </div>
          </div>

          {nonZeroAssets.length > 0 && (
            <div className="src-summary">
              <span className="src-summary-text">Portfolio</span>
              <span className="bal-total-value">${formatAmount(totalUsd, 2)}</span>
            </div>
          )}

          <div className="modal-body src-modal-body">
            {nonZeroAssets.length === 0 && !loading && (
              <div className="bal-empty">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="bal-empty-icon">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
                  <path d="M12 18V6" />
                </svg>
                <h3>No balances yet</h3>
                <p>Connect your wallet to see your cross-chain portfolio.</p>
              </div>
            )}

            {nonZeroAssets.length > 0 && (
              <div className="src-list">
                {nonZeroAssets.map((asset) => {
                  const isOpen = expanded.has(asset.symbol);
                  const nonZeroBreakdown = asset.chainBalances.filter((e) => D(e.balance).gt(0));
                  const chainCount = nonZeroBreakdown.length;
                  const chainDotItems = nonZeroBreakdown.map((e) => ({
                    chainId: e.chain.id,
                    chainName: e.chain.name,
                    chainLogo: e.chain.logo,
                  }));
                  return (
                    <div
                      key={asset.symbol}
                      className={`src-group${isOpen ? " is-open" : ""}`}
                    >
                      <button
                        type="button"
                        className="asset-row"
                        onClick={() => toggleAsset(asset.symbol)}
                        aria-expanded={isOpen}
                      >
                        <AssetRowIcon src={asset.logo} fallback={asset.symbol} />
                        <AssetRowMeta
                          symbol={asset.symbol}
                          sub={
                            chainCount === 1 ? (
                              <>
                                <ChainDots chains={chainDotItems} max={1} />
                                {chainDotItems[0]?.chainName}
                              </>
                            ) : (
                              <>
                                <ChainDots chains={chainDotItems} />
                                {chainCount} chains
                              </>
                            )
                          }
                        />
                        <AssetRowValue
                          amount={`${formatAmount(asset.balance)} ${asset.symbol}`}
                          usd={`≈ $${formatAmount(asset.value, 2)}`}
                        />
                        <span className="asset-row-chevron" aria-hidden="true">
                          <ChevronIcon open={isOpen} />
                        </span>
                      </button>

                      {isOpen && (
                        <div className="src-group-body">
                          {nonZeroBreakdown.map((entry) => (
                            <div
                              key={`${asset.symbol}-${entry.chain.id}`}
                              className="asset-row asset-row--chain asset-row--static"
                            >
                              <AssetRowIcon
                                size="sm"
                                src={entry.chain.logo}
                                fallback={entry.chain.name}
                              />
                              <AssetRowMeta
                                symbol={
                                  <>
                                    {entry.chain.name}
                                    <TokenInfoCard
                                      token={{
                                        symbol: asset.symbol,
                                        tokenName: (asset as { name?: string }).name,
                                        tokenLogo: asset.logo,
                                        chainName: entry.chain.name,
                                        chainLogo: entry.chain.logo,
                                        decimals: (entry as { decimals?: number }).decimals,
                                        contractAddress: entry.contractAddress,
                                      }}
                                    >
                                      <span
                                        className="asset-row-info"
                                        tabIndex={0}
                                        role="button"
                                        aria-label="Token info"
                                      >
                                        <InfoIcon />
                                      </span>
                                    </TokenInfoCard>
                                  </>
                                }
                              />
                              <AssetRowValue amount={formatAmount(entry.balance)} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
