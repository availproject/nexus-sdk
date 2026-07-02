import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AssetRowIcon,
  AssetRowMeta,
  AssetRowValue,
  ChevronIcon,
  CopyButton,
  InfoIcon,
  shortAddress,
} from "./AssetRow";
import { TokenInfoCard } from "./TokenInfoCard";
import { PickerSearch, matchesQuery, type PickerChainOption } from "./PickerSearch";
import { ChainPickerView } from "./ChainPickerView";
import type { SourceOption } from "../lib/types";
import { formatAmount } from "../lib/format";

export type DestinationOption = {
  id: string;
  chainId: number;
  chainName: string;
  chainLogo?: string;
  symbol: string;
  label: string;
  tokenLogo?: string;
  tokenAddress?: `0x${string}`;
  decimals?: number;
};

type DestinationSelectorProps = {
  options: DestinationOption[];
  selectedId: string;
  onSelect: (option: DestinationOption) => void;
  /** Optional placeholder text when nothing is selected. */
  placeholder?: string;
  /** User's current balances. When provided, each row shows the held amount + USD on the right. */
  balances?: SourceOption[];
};

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function DestinationSelector({
  options,
  selectedId,
  onSelect,
  placeholder = "Select",
  balances,
}: DestinationSelectorProps) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => options.find((o) => o.id === selectedId),
    [options, selectedId],
  );

  const balanceMap = useMemo(() => {
    const map = new Map<string, { balance: string; value: string }>();
    for (const b of balances ?? []) {
      map.set(`${b.chainId}:${b.tokenAddress.toLowerCase()}`, {
        balance: b.balance,
        value: b.value,
      });
    }
    return map;
  }, [balances]);

  const [query, setQuery] = useState("");
  const [chainFilter, setChainFilter] = useState<number | null>(null);
  const [view, setView] = useState<"main" | "chains">("main");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setChainFilter(null);
    setView("main");
  }, [open]);

  const availableChains = useMemo<PickerChainOption[]>(() => {
    const seen = new Map<number, string>();
    for (const o of options) {
      if (!seen.has(o.chainId)) seen.set(o.chainId, o.chainName);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [options]);

  const selectedChain = chainFilter !== null
    ? availableChains.find((c) => c.id === chainFilter) ?? null
    : null;

  const filteredOptions = useMemo(() => {
    if (!query && chainFilter === null) return options;
    return options.filter((o) => {
      if (chainFilter !== null && o.chainId !== chainFilter) return false;
      if (!matchesQuery(query, o.symbol, o.label, o.chainName, o.tokenAddress)) return false;
      return true;
    });
  }, [options, query, chainFilter]);

  function handleSelect(option: DestinationOption) {
    onSelect(option);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="dest-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        disabled={options.length === 0}
      >
        {selected ? (
          <>
            <AssetRowIcon
              size="sm"
              src={selected.tokenLogo}
              fallback={selected.symbol}
              badge={{ src: selected.chainLogo, fallback: selected.chainName }}
            />
            <span className="dest-trigger-symbol">{selected.label}</span>
          </>
        ) : (
          <span className="dest-trigger-placeholder">{placeholder}</span>
        )}
        <span className="dest-trigger-chevron" aria-hidden="true">
          <ChevronIcon open={false} />
        </span>
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay" />
          <Dialog.Content className="modal-panel src-modal-panel modal-content-centered">
            {view === "chains" ? (
              <ChainPickerView
                chains={availableChains}
                selected={chainFilter}
                onApply={(id) => {
                  setChainFilter(id);
                  setView("main");
                }}
                onBack={() => setView("main")}
              />
            ) : (
            <>
            <div className="modal-header src-modal-header">
              <div className="src-modal-title">
                <Dialog.Title className="modal-title">Choose asset to receive</Dialog.Title>
                <p className="src-modal-subtitle">Select token and destination chain</p>
              </div>
              <Dialog.Close asChild>
                <button className="ghost-button" type="button" title="Close" aria-label="Close">
                  <CloseIcon />
                </button>
              </Dialog.Close>
            </div>

            <PickerSearch
              query={query}
              onQueryChange={setQuery}
              chains={availableChains}
              selectedChain={selectedChain}
              onOpenChainPicker={() => setView("chains")}
            />

            <div className="modal-body src-modal-body">
              {options.length === 0 ? (
                <p className="modal-empty">No destinations available.</p>
              ) : filteredOptions.length === 0 ? (
                <p className="picker-empty">No matches for current filters.</p>
              ) : (
                <div className="src-list">
                  {filteredOptions.map((option) => {
                    const isSelected = option.id === selectedId;
                    const addressKey = option.tokenAddress?.toLowerCase();
                    const held = addressKey
                      ? balanceMap.get(`${option.chainId}:${addressKey}`)
                      : undefined;
                    const isNative =
                      !option.tokenAddress ||
                      option.tokenAddress.toLowerCase() === "0x0000000000000000000000000000000000000000";
                    return (
                      <div
                        key={option.id}
                        className={`src-group${isSelected ? " is-open" : ""}`}
                      >
                        <button
                          type="button"
                          className="asset-row"
                          onClick={() => handleSelect(option)}
                          aria-pressed={isSelected}
                        >
                          <AssetRowIcon
                            src={option.tokenLogo}
                            fallback={option.symbol}
                            badge={{ src: option.chainLogo, fallback: option.chainName }}
                          />
                          <AssetRowMeta
                            symbol={option.label}
                            sub={
                              option.tokenAddress && !isNative ? (
                                <>
                                  {shortAddress(option.tokenAddress)}
                                  <CopyButton value={option.tokenAddress} />
                                  <TokenInfoCard
                                    token={{
                                      symbol: option.symbol,
                                      tokenLogo: option.tokenLogo,
                                      chainName: option.chainName,
                                      chainLogo: option.chainLogo,
                                      decimals: option.decimals,
                                      contractAddress: option.tokenAddress,
                                    }}
                                  >
                                    <span
                                      className="asset-row-info"
                                      tabIndex={0}
                                      role="button"
                                      aria-label="Token info"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <InfoIcon />
                                    </span>
                                  </TokenInfoCard>
                                </>
                              ) : (
                                <>on {option.chainName}</>
                              )
                            }
                          />
                          {held && (
                            <AssetRowValue
                              amount={`${formatAmount(held.balance)} ${option.symbol}`}
                              usd={`≈ $${formatAmount(held.value, 2)}`}
                            />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
