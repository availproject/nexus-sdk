import process from 'node:process';

// Kept self-contained (no SDK imports) so emission stays a leaf module: a
// metrics failure can never pull in heavier code paths or affect the run.
const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// Minimal OTLP/HTTP JSON metrics emitter. We hand-build the payload (rather than
// pull the @opentelemetry SDK) because this is a short-lived cron emitting a
// handful of gauge points: no MeterProvider lifecycle, no periodic-flush race,
// zero new deps. The endpoint (otel2.avail.so/v1/metrics) is an OTel Collector
// whose OTLP/HTTP receiver accepts JSON. All emission is best-effort: a metrics
// failure must never affect the cron's pass/fail or exit code.

type OtlpAttribute = {
  key: string;
  value: { stringValue: string } | { intValue: string } | { doubleValue: number };
};

type OtlpNumberDataPoint = {
  timeUnixNano: string;
  asDouble?: number;
  asInt?: string;
  attributes: OtlpAttribute[];
};

type OtlpMetric = {
  name: string;
  unit?: string;
  gauge: { dataPoints: OtlpNumberDataPoint[] };
};

type OtlpPayload = {
  resourceMetrics: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeMetrics: Array<{ scope: { name: string }; metrics: OtlpMetric[] }>;
  }>;
};

const SCOPE_NAME = 'nexus-e2e-cron';
const BALANCE_METRIC = 'nexus.e2e.wallet_balance';
const RUN_METRIC = 'nexus.e2e.run';

const strAttr = (key: string, value: string): OtlpAttribute => ({
  key,
  value: { stringValue: value },
});
const intAttr = (key: string, value: number): OtlpAttribute => ({
  key,
  value: { intValue: String(value) },
});

const msToUnixNano = (ms: number): string => (BigInt(Math.trunc(ms)) * 1_000_000n).toString();

export type ChainBalancePoint = {
  chainId: number;
  chainName: string;
  token: string;
  balance: string;
  role: 'stable' | 'native';
};

export type ChainBalancesInput = {
  network: string;
  wallet: string;
  balances: ChainBalancePoint[];
  capturedAtMs: number;
};

// One per-run snapshot: two points per chain — a stablecoin and the native gas
// token — tagged role 'stable' / 'native'. token is always the real symbol
// (USDC, ETH, POL, MON, cBTC, …). Non-numeric balances are skipped.
export const buildChainBalancesMetric = (input: ChainBalancesInput): OtlpMetric => {
  const timeUnixNano = msToUnixNano(input.capturedAtMs);
  const dataPoints: OtlpNumberDataPoint[] = [];
  for (const b of input.balances) {
    const asDouble = Number(b.balance);
    if (!Number.isFinite(asDouble)) continue;
    dataPoints.push({
      timeUnixNano,
      asDouble,
      attributes: [
        strAttr('network', input.network),
        strAttr('token', b.token),
        strAttr('chain', b.chainName),
        intAttr('chain_id', b.chainId),
        strAttr('role', b.role),
        strAttr('wallet', input.wallet),
      ],
    });
  }
  return { name: BALANCE_METRIC, gauge: { dataPoints } };
};

// Unconditional liveness signal: emitted once per run regardless of bridge or
// balance-snapshot outcome, so "no run in N hours" alerts stay reliable even
// when the balance gauge is absent (snapshot failed).
export const buildRunMetric = (network: string, status: string, atMs: number): OtlpMetric => ({
  name: RUN_METRIC,
  gauge: {
    dataPoints: [
      {
        timeUnixNano: msToUnixNano(atMs),
        asInt: '1',
        attributes: [strAttr('network', network), strAttr('status', status)],
      },
    ],
  },
});

export const buildPayload = (network: string, metrics: OtlpMetric[]): OtlpPayload => ({
  resourceMetrics: [
    {
      resource: {
        attributes: [
          strAttr('service.name', SCOPE_NAME),
          strAttr('deployment.environment', network),
        ],
      },
      scopeMetrics: [{ scope: { name: SCOPE_NAME }, metrics }],
    },
  ],
});

const postOtlp = async (endpoint: string, payload: OtlpPayload): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    process.stderr.write(`metrics export fetch failed: ${errMsg(err)}\n`);
    return;
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    process.stderr.write(`metrics export failed (HTTP ${response.status}): ${body}\n`);
  }
};

export const postChainBalances = async (
  endpoint: string,
  input: ChainBalancesInput
): Promise<void> => {
  const metric = buildChainBalancesMetric(input);
  if (metric.gauge.dataPoints.length === 0) return;
  await postOtlp(endpoint, buildPayload(input.network, [metric]));
};

export const postRunMetric = async (
  endpoint: string,
  network: string,
  status: string
): Promise<void> => {
  await postOtlp(endpoint, buildPayload(network, [buildRunMetric(network, status, Date.now())]));
};
