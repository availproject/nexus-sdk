import type { ReactNode } from "react";

type HashRecord = {
  label: string;
  value: string;
  href?: string;
};

type TxPanelProps = {
  title: string;
  hashes: HashRecord[];
  action?: ReactNode;
};

export function TxPanel({ title, hashes, action }: TxPanelProps) {
  if (hashes.length === 0 && !action) return null;

  return (
    <section className="result-card stack-md tx-panel-enter">
      <div className="section-heading">
        <span>{title}</span>
      </div>
      {hashes.map((hash) => {
        const display =
          hash.value.startsWith("0x") && hash.value.length > 20
            ? `${hash.value.slice(0, 10)}…${hash.value.slice(-8)}`
            : hash.value;
        return (
          <div key={`${hash.label}-${hash.value}`} className="hash-row">
            <span>{hash.label}</span>
            {hash.href ? (
              <a href={hash.href} target="_blank" rel="noreferrer" title={hash.value}>
                {display}
              </a>
            ) : (
              <span title={hash.value}>{display}</span>
            )}
          </div>
        );
      })}
      {action}
    </section>
  );
}
