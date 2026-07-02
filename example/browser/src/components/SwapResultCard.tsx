import type { SwapResultData } from "../lib/types";

type SwapResultCardProps = {
  result: SwapResultData;
};

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function StepIcon({ type }: { type: "source" | "bridge" | "destination" }) {
  if (type === "source") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    );
  }
  if (type === "bridge") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="swap-route-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function truncateHash(hash: string): string {
  if (!hash || hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function SwapResultCard({ result }: SwapResultCardProps) {
  return (
    <section className="result-card swap-result-card tx-panel-enter">
      <div className="swap-result-summary">{result.summary}</div>

      <div className="swap-route-path">
        {result.route.map((step, i) => (
          <div key={`${step.type}-${step.chainId}-${i}`} className="swap-route-segment">
            {i > 0 && <ArrowIcon />}
            <div className={`swap-route-pill swap-route-pill--${step.type}`}>
              <StepIcon type={step.type} />
              <div className="swap-route-pill-content">
                <span className="swap-route-pill-chain">{step.chainName}</span>
                {step.amount && (
                  <span className="swap-route-pill-amount">
                    {step.amount} {step.tokenSymbol}
                  </span>
                )}
              </div>
              {(step.txHash || step.explorerUrl) && (
                <a
                  href={step.explorerUrl ?? `#${step.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="swap-route-pill-link"
                  title={step.txHash ?? step.explorerUrl}
                >
                  {step.txHash ? truncateHash(step.txHash) : "View"}
                  <ExternalLinkIcon />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {result.intentExplorerUrl && (
        <a
          href={result.intentExplorerUrl}
          target="_blank"
          rel="noreferrer"
          className="swap-result-intent-link"
        >
          View intent on explorer
          <ExternalLinkIcon />
        </a>
      )}
    </section>
  );
}
