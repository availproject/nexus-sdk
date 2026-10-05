import { useMemo } from "react";
import type { NexusClient } from "@avail-project/nexus-core";
import { formatAmount } from "../lib/format";
import { D } from "../lib/math";
import type { SourceOption } from "../lib/types";
import { AssetRowIcon } from "./AssetRow";
import { DestinationSelector } from "./DestinationSelector";
import { getSwapChainOptions } from "../lib/destinationTokens";

type SourceAmountsEditorProps = {
  client: NexusClient | null;
  showBalances: boolean;
  onAddSource: (source: SourceOption) => void;
  /** Catalog selections, supplemented with wallet balances when connected. */
  sources: SourceOption[];
  /** Explicitly-selected source ids ([] = none). */
  selectedIds: string[];
  onSelectedChange: (ids: string[]) => void;
  /** Per-source input amounts keyed by SourceOption.id. */
  amounts: Record<string, string>;
  onAmountChange: (id: string, value: string) => void;
};

// Matches the close glyph used by the picker modals (see SourceSelectorModal).
function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** USD value of a typed amount, derived from the source's full-balance price. */
function rowFiat(s: SourceOption, amount?: string): number {
  if (!amount || !(Number(amount) > 0)) return 0;
  const bal = D(s.balance);
  const price = bal.gt(0) ? D(s.value).div(bal) : D(0);
  return D(amount).times(price).toNumber();
}

/** Exact-input amounts can be selected from the catalog before wallet balances are available. */
export function SourceAmountsEditor({
  client,
  showBalances,
  onAddSource,
  sources,
  selectedIds,
  onSelectedChange,
  amounts,
  onAmountChange,
}: SourceAmountsEditorProps) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rows = useMemo(
    () => sources.filter((s) => selectedSet.has(s.id)),
    [sources, selectedSet],
  );

  const totalFiat = rows.reduce((acc, s) => acc + rowFiat(s, amounts[s.id]), 0);

  return (
    <div className="field-full send-card">
      <div className="send-header">
        <span className="source-selector-label">
          <span>Send</span>
        </span>
        <DestinationSelector
          direction="source"
          client={client}
          chains={getSwapChainOptions(client, "source")}
          options={[]}
          selectedId=""
          placeholder="Add asset"
          balances={showBalances ? sources : undefined}
          onSelect={(option) => {
            if (!option.tokenAddress) return;
            onAddSource({
              id: option.id, chainId: option.chainId, chainName: option.chainName,
              chainLogo: option.chainLogo ?? "", tokenAddress: option.tokenAddress,
              symbol: option.symbol, tokenLogo: option.tokenLogo, decimals: option.decimals,
              balance: "0", value: "0",
            });
          }}
        />
      </div>

      {rows.length === 0 ? (
        <p className="send-empty">Add an asset to send</p>
      ) : (
        <>
          <div className="send-list">
            {rows.map((s) => {
              const usd = rowFiat(s, amounts[s.id]);
              return (
                <div key={s.id} className="send-asset-row">
                  <div className="send-asset-main">
                    <input
                      className="send-asset-amount"
                      value={amounts[s.id] ?? ""}
                      onChange={(e) => onAmountChange(s.id, e.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`${s.symbol} on ${s.chainName} amount`}
                    />
                    <div className="send-asset-sub">
                      {showBalances && <button
                        type="button"
                        className="send-asset-max"
                        onClick={() => onAmountChange(s.id, s.balance)}
                      >
                        Max {formatAmount(s.balance)}
                      </button>}
                      {showBalances && usd > 0 && (
                        <span className="send-asset-usd">≈ ${formatAmount(usd, 2)}</span>
                      )}
                    </div>
                  </div>
                  <div
                    className="dest-trigger"
                  >
                    <AssetRowIcon
                      size="sm"
                      src={s.tokenLogo}
                      fallback={s.symbol}
                      badge={{ src: s.chainLogo, fallback: s.chainName }}
                    />
                    <span className="dest-trigger-symbol">{s.symbol}</span>
                  </div>
                  <button
                    type="button"
                    className="ghost-button send-asset-remove"
                    aria-label={`Remove ${s.symbol} on ${s.chainName}`}
                    onClick={() =>
                      onSelectedChange(selectedIds.filter((id) => id !== s.id))
                    }
                  >
                    <CloseIcon />
                  </button>
                </div>
              );
            })}
          </div>
          {showBalances && totalFiat > 0 && <div className="send-total">
            <span>Total</span>
            <span className="send-total-value">≈ ${formatAmount(totalFiat, 2)}</span>
          </div>}
        </>
      )}

    </div>
  );
}
