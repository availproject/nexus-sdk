import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { getChainLogoUrl } from "../lib/logos";
import { LogoImg } from "./AssetRow";
import type { PickerChainOption } from "./PickerSearch";

type Props = {
  chains: PickerChainOption[];
  selected: number | null;
  /** Clicking a row immediately applies the new chain filter and switches the
      modal back to its main view. The parent modal's Done CTA confirms the
      token selection — there is no Done in this sub-view. */
  onApply: (chainId: number | null) => void;
  onBack: () => void;
};

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function ChainLogo({ chainId, name }: { chainId: number; name: string }) {
  return (
    <span className="chain-row-icon">
      <LogoImg src={getChainLogoUrl(chainId)} fallback={name} />
    </span>
  );
}

function RadioDot({ checked }: { checked: boolean }) {
  return <span className={`radio${checked ? " checked" : ""}`} aria-hidden="true" />;
}

export function ChainPickerView({ chains, selected, onApply, onBack }: Props) {
  const [query, setQuery] = useState("");

  const filtered = chains.filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase().trim();
    return c.name.toLowerCase().includes(q) || String(c.id).includes(q);
  });

  return (
    <>
      <div className="modal-header src-modal-header">
        <button
          type="button"
          className="ghost-button"
          onClick={onBack}
          aria-label="Back"
          title="Back"
        >
          <BackIcon />
        </button>
        <div className="src-modal-title">
          <Dialog.Title className="modal-title">Select chain</Dialog.Title>
        </div>
        <Dialog.Close asChild>
          <button className="ghost-button" type="button" title="Close" aria-label="Close">
            <CloseIcon />
          </button>
        </Dialog.Close>
      </div>

      <div className="picker-search">
        <span className="picker-search-icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          className="picker-search-text"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chains"
          spellCheck={false}
          autoCorrect="off"
          autoFocus
        />
      </div>

      <div className="modal-body src-modal-body">
        <div className="src-list">
          <button
            type="button"
            className="chain-row"
            onClick={() => onApply(null)}
            aria-pressed={selected === null}
          >
            <RadioDot checked={selected === null} />
            <span className="chain-row-icon chain-row-icon--all">
              <GlobeIcon />
            </span>
            <span className="chain-row-name">All Chains</span>
          </button>
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chain-row"
              onClick={() => onApply(c.id)}
              aria-pressed={selected === c.id}
            >
              <RadioDot checked={selected === c.id} />
              <ChainLogo chainId={c.id} name={c.name} />
              <span className="chain-row-name">{c.name}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="picker-empty">No chains match "{query}".</p>
          )}
        </div>
      </div>
    </>
  );
}
