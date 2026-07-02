export function ConnectGate() {
  return (
    <div className="connect-gate">
      <div className="connect-gate-icon-wrap">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="connect-gate-icon">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </div>

      <h2 className="connect-gate-heading">Connect your wallet</h2>

      <p className="connect-gate-line">
        <strong className="connect-gate-keyword connect-gate-keyword--primary">Swap</strong> across chains.
      </p>
      <p className="connect-gate-line">
        <strong className="connect-gate-keyword connect-gate-keyword--accent">Bridge</strong> in one click.
      </p>
      <p className="connect-gate-line">
        Deposit into <strong className="connect-gate-keyword connect-gate-keyword--success">DeFi</strong>.
      </p>
    </div>
  );
}
