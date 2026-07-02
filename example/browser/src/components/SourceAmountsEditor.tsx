import { useMemo, useState } from "react";
import { formatAmount } from "../lib/format";
import { D } from "../lib/math";
import type { SourceOption } from "../lib/types";
import { AssetRowIcon, ChevronIcon } from "./AssetRow";
import { SourceSelectorModal } from "./SourceSelectorModal";

type SourceAmountsEditorProps = {
  /** All flattened balances (one entry per chain × token). */
  sources: SourceOption[];
  /** Explicitly-selected source ids ([] = none). */
  selectedIds: string[];
  onSelectedChange: (ids: string[]) => void;
  /** Per-source input amounts keyed by SourceOption.id. */
  amounts: Record<string, string>;
  onAmountChange: (id: string, value: string) => void;
};

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

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

/**
 * Exact-in "Send" editor: pick multiple source assets (via the shared
 * SourceSelectorModal) and give each its own input amount, with a running USD
 * total. Each row reads amount-first (left) → token (right), mirroring the
 * receive card. The picker's "all selected → []" convention is normalized to
 * explicit ids on apply so amounts always map to a concrete, removable row.
 */
export function SourceAmountsEditor({
  sources,
  selectedIds,
  onSelectedChange,
  amounts,
  onAmountChange,
}: SourceAmountsEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const allIds = useMemo(() => sources.map((s) => s.id), [sources]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rows = useMemo(
    () => sources.filter((s) => selectedSet.has(s.id)),
    [sources, selectedSet],
  );

  const totalFiat = rows.reduce((acc, s) => acc + rowFiat(s, amounts[s.id]), 0);
  const noBalances = sources.length === 0;

  return (
    <div className="field-full send-card">
      <div className="send-header">
        <span className="source-selector-label">
          <span>Send</span>
        </span>
        <button
          type="button"
          className="add-asset-btn"
          onClick={() => setPickerOpen(true)}
          disabled={noBalances}
        >
          <PlusIcon />
          Add asset
        </button>
      </div>

      {rows.length === 0 ? (
        <button
          type="button"
          className="send-empty"
          onClick={() => setPickerOpen(true)}
          disabled={noBalances}
        >
          {noBalances ? "No balances available." : "Add an asset to send"}
        </button>
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
                      <button
                        type="button"
                        className="send-asset-max"
                        onClick={() => onAmountChange(s.id, s.balance)}
                      >
                        Max {formatAmount(s.balance)}
                      </button>
                      {usd > 0 && (
                        <span className="send-asset-usd">≈ ${formatAmount(usd, 2)}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="dest-trigger"
                    onClick={() => setPickerOpen(true)}
                    aria-haspopup="dialog"
                    aria-label={`Change ${s.symbol} on ${s.chainName}`}
                  >
                    <AssetRowIcon
                      size="sm"
                      src={s.tokenLogo}
                      fallback={s.symbol}
                      badge={{ src: s.chainLogo, fallback: s.chainName }}
                    />
                    <span className="dest-trigger-symbol">{s.symbol}</span>
                    <span className="dest-trigger-chevron" aria-hidden="true">
                      <ChevronIcon open={false} />
                    </span>
                  </button>
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
          <div className="send-total">
            <span>Total</span>
            <span className="send-total-value">≈ ${formatAmount(totalFiat, 2)}</span>
          </div>
        </>
      )}

      <SourceSelectorModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        sources={sources}
        selectedIds={selectedIds}
        onApply={(ids) => onSelectedChange(ids.length === 0 ? allIds : ids)}
      />
    </div>
  );
}
