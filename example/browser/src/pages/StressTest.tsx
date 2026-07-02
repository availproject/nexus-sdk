import type {
  BridgeEvent,
  NexusClient,
  SpanProperties,
  SupportedChainsAndTokensResult,
} from "@avail-project/nexus-core";
import { createNexusClient } from "@avail-project/nexus-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { privateKeyToAccount } from "viem/accounts";
import {
  applyBridgeStepUpdate,
  applyStatusUpdate,
  buildReport,
  runStressTest,
  type LoadModel,
  type Operation,
  type OperationStatus,
  type StressReport,
  type StressRun,
  type StressRunConfig,
} from "../../../../packages/tools/src/stress-test";
import { Dropdown } from "../components/Dropdown";
import { MultiSelect } from "../components/MultiSelect";

type DropdownOption = { value: string; label: string };
import {
  encodeSharedReport,
  decodeSharedReport,
  HARD_URL_LIMIT,
  SOFT_URL_LIMIT,
  SHARE_REPORT_PARAM,
  SHARE_REPORT_CHECKSUM_PARAM,
} from "./stressReportShare";
import StressReportSection from "./stressTest/StressReportSection";
import { titleCase, normalizePrivateKey } from "./stressTest/input";
import { createPrivateKeyProvider } from "./stressTest/provider";
import type { SpanAggregate, StressSpanSample } from "./stressTest/types";
import {
  formatDuration,
  formatDurationCompact,
  formatDurationRange,
  shortSpanLabel,
} from "./stressTest/formatting";
import { aggregateSpans, computeMedian, niceBucketSize } from "./stressTest/metrics";
import './stressTest/stress-test.css';

type StressTestProps = {
  isConnected: boolean;
};

const DEFAULTS = {
  token: "USDC",
  amount: "0.0001",
  totalRequests: 20,
  batchSize: 5,
  delayMs: 1000,
  ratePerSecond: 2,
  maxInFlight: 0,
  rampStartRate: 1,
  rampStepRate: 1,
  rampStepDurationSec: 30,
  rampMaxRate: 5,
  soakDurationMinutes: 5,
};

export default function StressTest({ isConnected }: StressTestProps) {
  const [privateKey, setPrivateKey] = useState("");
  const [token, setToken] = useState(DEFAULTS.token);
  const [amount, setAmount] = useState(DEFAULTS.amount);
  const [totalRequests, setTotalRequests] = useState(DEFAULTS.totalRequests);
  const [batchSize, setBatchSize] = useState(DEFAULTS.batchSize);
  const [delayMs, setDelayMs] = useState(DEFAULTS.delayMs);
  const [loadModel, setLoadModel] = useState<LoadModel>("batch");
  const [ratePerSecond, setRatePerSecond] = useState(DEFAULTS.ratePerSecond);
  const [maxInFlight, setMaxInFlight] = useState(DEFAULTS.maxInFlight);
  const [rampStartRate, setRampStartRate] = useState(DEFAULTS.rampStartRate);
  const [rampStepRate, setRampStepRate] = useState(DEFAULTS.rampStepRate);
  const [rampStepDurationSec, setRampStepDurationSec] = useState(
    DEFAULTS.rampStepDurationSec,
  );
  const [rampMaxRate, setRampMaxRate] = useState(DEFAULTS.rampMaxRate);
  const [soakDurationMinutes, setSoakDurationMinutes] = useState(
    DEFAULTS.soakDurationMinutes,
  );
  const [tokenPanelOpen, setTokenPanelOpen] = useState(false);
  const [selectedDestinations, setSelectedDestinations] = useState<string[]>(
    [],
  );
  const [operationsById, setOperationsById] = useState<
    Record<number, Operation>
  >({});
  const [operationOrder, setOperationOrder] = useState<number[]>([]);
  const [supported, setSupported] = useState<SupportedChainsAndTokensResult>(
    [],
  );
  const [clientReady, setClientReady] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [report, setReport] = useState<StressReport | null>(null);
  const [currentRunSpanSamples, setCurrentRunSpanSamples] = useState<
    StressSpanSample[]
  >([]);
  const [currentRunSpanAggregates, setCurrentRunSpanAggregates] = useState<
    SpanAggregate[]
  >([]);
  const [comparisonMetric, setComparisonMetric] = useState<
    "medianMs" | "meanMs"
  >("medianMs");
  const [selectedSpanForTrend, setSelectedSpanForTrend] = useState<string>("");
  const [run, setRun] = useState<StressRun | null>(null);
  const [isSharedReportView, setIsSharedReportView] = useState(false);
  const [privateAddress, setPrivateAddress] = useState<string | null>(null);
  const [isCopyingShareLink, setIsCopyingShareLink] = useState(false);
  const [shareButtonLabel, setShareButtonLabel] = useState("Share link");

  const opsRef = useRef<Record<number, Operation>>({});
  const orderRef = useRef<number[]>([]);
  const runRef = useRef<StressRun | null>(null);
  const operationPromisesRef = useRef<Map<number, Promise<void>>>(new Map());
  const spanSamplesByRunRef = useRef<Record<number, StressSpanSample[]>>({});
  const clientRef = useRef<NexusClient | null>(null);
  const stopRequestedRef = useRef(false);
  const runIdRef = useRef(0);

  const resetRunState = useCallback(() => {
    setOperationsById({});
    setOperationOrder([]);
    opsRef.current = {};
    orderRef.current = [];
    operationPromisesRef.current.clear();
    setRun(null);
    runRef.current = null;
    setReport(null);
    setCurrentRunSpanSamples([]);
    setCurrentRunSpanAggregates([]);
    setRunError(null);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const encoded = url.searchParams.get(SHARE_REPORT_PARAM);
    if (!encoded) {
      setIsSharedReportView(false);
      return;
    }

    try {
      const checksum =
        url.searchParams.get(SHARE_REPORT_CHECKSUM_PARAM) ?? undefined;
      const shared = decodeSharedReport(encoded, checksum);
      setReport(shared.report);
      setCurrentRunSpanSamples(shared.spanSamples);
      setCurrentRunSpanAggregates(aggregateSpans(shared.spanSamples));
      setIsSharedReportView(true);
      setRun(null);
      setRunError(null);
    } catch (err) {
      setRunError(
        err instanceof Error
          ? `Could not load shared report: ${err.message}`
          : "Could not load shared report.",
      );
    }
  }, []);

  const exitSharedReportView = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete(SHARE_REPORT_PARAM);
    url.searchParams.delete(SHARE_REPORT_CHECKSUM_PARAM);
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, "", next);

    setIsSharedReportView(false);
    setReport(null);
    setCurrentRunSpanSamples([]);
    setCurrentRunSpanAggregates([]);
    setSelectedSpanForTrend("");
    setRun(null);
    setRunError(null);
  }, []);

  const handleCopyShareLink = useCallback(async () => {
    if (!report || typeof window === "undefined") return;
    try {
      setIsCopyingShareLink(true);
      const { encoded, checksum } = encodeSharedReport(
        report,
        currentRunSpanSamples,
      );
      const url = new URL(window.location.href);
      url.searchParams.set(SHARE_REPORT_PARAM, encoded);
      url.searchParams.set(SHARE_REPORT_CHECKSUM_PARAM, checksum);
      const shareUrl = url.toString();

      if (shareUrl.length > HARD_URL_LIMIT) {
        throw new Error(
          "Share link is too large to generate reliably for this report.",
        );
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        window.prompt("Copy shared report link:", shareUrl);
      }

      setShareButtonLabel("Copied");
      window.setTimeout(() => setShareButtonLabel("Share link"), 1800);

      if (shareUrl.length > SOFT_URL_LIMIT) {
        setRunError(
          "Share link is long and may not work in some apps. Direct browser sharing is recommended.",
        );
      }
    } catch (err) {
      setRunError(
        err instanceof Error
          ? `Could not create shared report link: ${err.message}`
          : "Could not create shared report link.",
      );
    } finally {
      setIsCopyingShareLink(false);
    }
  }, [currentRunSpanSamples, report]);

  useEffect(() => {
    if (!isConnected) {
      setClientReady(false);
      setSupported([]);
      setClientError(null);
      clientRef.current?.destroy();
      clientRef.current = null;
      return;
    }

    let isMounted = true;
    const client = createNexusClient({ network: "testnet", debug: true });
    clientRef.current = client;

    client
      .initialize()
      .then(() => {
        if (!isMounted) return;
        setSupported(client.getSupportedChains());
        setClientReady(true);
      })
      .catch((err) => {
        if (!isMounted) return;
        setClientError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      isMounted = false;
      client.destroy();
      clientRef.current = null;
    };
  }, [isConnected]);

  const tokenOptions: DropdownOption[] = useMemo(() => {
    const tokens = new Map<string, string>();
    for (const chain of supported) {
      for (const token of chain.tokens) {
        tokens.set(token.symbol, token.symbol);
      }
    }
    return Array.from(tokens.keys()).map((symbol) => ({
      value: symbol,
      label: symbol,
    }));
  }, [supported]);

  const destinationOptions = useMemo(
    () =>
      supported.map((chain) => ({
        value: String(chain.id),
        label: chain.name,
      })),
    [supported],
  );

  const destinationLabelMap = useMemo(
    () => new Map(destinationOptions.map((opt) => [opt.value, opt.label])),
    [destinationOptions],
  );

  const loadModelOptions: DropdownOption[] = useMemo(
    () => [
      { value: "batch", label: "Batch" },
      { value: "fixed", label: "Fixed Rate" },
      { value: "ramp", label: "Ramp" },
      { value: "soak", label: "Soak" },
    ],
    [],
  );

  const comparisonMetricOptions: DropdownOption[] = useMemo(
    () => [
      { value: "medianMs", label: "Median" },
      { value: "meanMs", label: "Mean" },
    ],
    [],
  );

  useEffect(() => {
    if (tokenOptions.length === 0) return;
    if (!tokenOptions.some((opt) => opt.value === token)) {
      setToken(tokenOptions[0]?.value ?? DEFAULTS.token);
    }
  }, [token, tokenOptions]);

  useEffect(() => {
    setPrivateAddress(null);
  }, [privateKey]);

  useEffect(() => {
    if (destinationOptions.length > 0 && selectedDestinations.length === 0) {
      setSelectedDestinations(destinationOptions.map((opt) => opt.value));
    }
  }, [destinationOptions, selectedDestinations.length]);

  const resolvePrivateKey = useCallback(() => {
    const normalized = normalizePrivateKey(privateKey);
    if (!normalized) {
      throw new Error("Enter a valid private key (64 hex chars).");
    }
    const account = privateKeyToAccount(normalized);
    setPrivateAddress(account.address);
    return normalized;
  }, [privateKey]);

  const createWorkerClient = useCallback(
    async (params: {
      privateKeyValue: `0x${string}`;
      runId: number;
      operationId: number;
    }) => {
      const { privateKeyValue, runId, operationId } = params;
      const client = createNexusClient({
        network: "testnet",
        debug: true,
        devTiming: {
          enabled: true,
          emitAnalytics: false,
          emitLogs: false,
          captureNetworkTiming: true,
          onSpanComplete: (span: SpanProperties) => {
            const sample: StressSpanSample = {
              runId,
              operationId,
              spanName: span.operation,
              durationMs: span.duration,
              success: span.success,
              timestamp: Date.now(),
            };
            const existing = spanSamplesByRunRef.current[runId] ?? [];
            spanSamplesByRunRef.current[runId] = [...existing, sample];
          },
        },
      });
      await client.initialize();
      const { provider } = createPrivateKeyProvider({
        privateKey: privateKeyValue,
        chains: client.chainList.chains,
      });
      await client.setEVMProvider(provider);
      return client;
    },
    [],
  );

  const updateOperation = useCallback(
    (id: number, updater: (op: Operation) => Operation) => {
      const current = opsRef.current[id];
      if (!current) return;

      const nextOp = updater(current);
      const next = { ...opsRef.current, [id]: nextOp };

      // Keep ref as the source of truth synchronously so finalization
      // does not race with React state batching.
      opsRef.current = next;
      setOperationsById(next);
    },
    [],
  );

  const ensureOperationOrder = useCallback((id: number) => {
    setOperationOrder((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      orderRef.current = next;
      return next;
    });
  }, []);

  const markStatus = useCallback(
    (id: number, status: OperationStatus, patch?: Partial<Operation>) => {
      if (status === "running") {
        ensureOperationOrder(id);
      }
      updateOperation(id, (op) => {
        if (op.status === "failed" && status !== "failed") {
          return op;
        }
        const base =
          op.status === "fulfilled" && status !== "failed"
            ? {
                ...op,
                ...patch,
                status: op.status,
              }
            : {
                ...op,
                ...patch,
                status,
              };
        const timed = applyStatusUpdate(base, base.status, Date.now()).operation;
        const next = timed;
        if (
          (next.status === "fulfilled" || next.status === "failed") &&
          next.startedAt !== undefined &&
          next.finishedAt !== undefined
        ) {
          next.durationMs = Math.max(0, next.finishedAt - next.startedAt);
        }
        return next;
      });
    },
    [ensureOperationOrder, updateOperation],
  );

  const runOperation = useCallback(
    (op: Operation, privateKeyValue: `0x${string}`, runId: number) => {
      const promise = (async () => {
        let worker: NexusClient | null = null;

        markStatus(op.id, "running", { startedAt: Date.now() });

        try {
          worker = await createWorkerClient({
            privateKeyValue,
            runId,
            operationId: op.id,
          });
          const amountBigInt = worker.convertTokenReadableAmountToBigInt(
            op.amount,
            op.token,
            op.destinationChainId,
          );

          const result = await worker.bridge(
            {
              toTokenSymbol: op.token,
              toAmountRaw: amountBigInt,
              toChainId: op.destinationChainId,
            },
            {
              onEvent: (event: BridgeEvent) => {
                // Map v2 BridgeEvent to BridgeStepLike for applyBridgeStepUpdate
                let stepType: string | undefined;
                let stepData: Record<string, unknown> | undefined;

                if (event.type === "plan_progress") {
                  const pe = event as { stepType?: string; state?: string; step?: { intentRequestHash?: string } };
                  if (pe.stepType === "allowance_approval" && pe.state === "confirmed") {
                    stepType = "ALLOWANCE_ALL_DONE";
                  } else if (pe.stepType === "request_signing" && pe.state === "completed") {
                    stepType = "INTENT_HASH_SIGNED";
                  } else if (pe.stepType === "request_submission" && pe.state === "completed") {
                    const sub = event as { explorerUrl?: string; intentRequestHash?: string };
                    stepType = "INTENT_SUBMITTED";
                    stepData = { explorerURL: sub.explorerUrl, intentID: sub.intentRequestHash };
                  } else if (pe.stepType === "vault_deposit" && pe.state === "confirmed") {
                    stepType = "INTENT_DEPOSITS_CONFIRMED";
                  } else if (pe.stepType === "bridge_fill" && pe.state === "completed") {
                    stepType = "INTENT_FULFILLED";
                  }
                }

                if (!stepType) return;

                const step = { type: stepType, data: stepData };
                const now = Date.now();
                updateOperation(op.id, (current) => {
                  if (current.status === "failed") return current;
                  const { operation: next, statusChanged } = applyBridgeStepUpdate(
                    current,
                    step,
                    now,
                  );
                  if (statusChanged === "fulfilled" && next.finishedAt === undefined) {
                    next.finishedAt = now;
                  }
                  if (
                    (next.status === "fulfilled" || next.status === "failed") &&
                    next.startedAt !== undefined &&
                    next.finishedAt !== undefined
                  ) {
                    next.durationMs = Math.max(0, next.finishedAt - next.startedAt);
                  }
                  return next;
                });
              },
              hooks: {
                onIntent: ({ allow }) => allow(),
                onAllowance: ({ allow, sources }) =>
                  allow(sources.map(() => "max")),
              },
            },
          );

          const finishedAt = Date.now();
          markStatus(op.id, "fulfilled", {
            finishedAt,
            explorerUrl: result.intentExplorerUrl,
          });
        } catch (err) {
          const finishedAt = Date.now();
          markStatus(op.id, "failed", {
            finishedAt,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          worker?.destroy();
        }
      })();

      operationPromisesRef.current.set(op.id, promise);
      return promise.finally(() => {
        operationPromisesRef.current.delete(op.id);
      });
    },
    [createWorkerClient, markStatus, updateOperation],
  );

  const operationsList = useMemo(() => {
    const ordered = operationOrder
      .map((id) => operationsById[id])
      .filter((op): op is Operation => Boolean(op));
    const orderedIds = new Set(operationOrder);
    const queued = Object.values(operationsById)
      .filter((op) => !orderedIds.has(op.id))
      .sort((a, b) => a.id - b.id);
    return [...ordered, ...queued];
  }, [operationOrder, operationsById]);

  const startTest = useCallback(async () => {
    if (!clientReady) {
      setRunError("SDK not ready yet.");
      return;
    }
    if (isRunning) return;
    setRunError(null);
    resetRunState();
    setIsRunning(true);
    setIsStopping(false);
    stopRequestedRef.current = false;

    let privateKeyValue: `0x${string}`;
    try {
      privateKeyValue = resolvePrivateKey();
    } catch (err) {
      setIsRunning(false);
      setRunError(err instanceof Error ? err.message : String(err));
      return;
    }

    const destinationIds = selectedDestinations
      .map(Number)
      .filter((id) => Number.isFinite(id));
    const eligibleDestinations = destinationIds.filter((id) => {
      const chain = supported.find((entry) => entry.id === id);
      return chain?.tokens.some((entry) => entry.symbol === token);
    });
    if (eligibleDestinations.length === 0) {
      setIsRunning(false);
      setRunError("Select a destination chain that supports the chosen token.");
      return;
    }

    const total = Math.max(1, Math.floor(totalRequests));
    const now = Date.now();

    const requirePositive = (label: string, value: number) => {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} must be a positive number.`);
      }
    };

    const normalizeMaxInFlight = (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return undefined;
      return Math.floor(value);
    };

    let runConfig: StressRunConfig | null = null;
    try {
      switch (loadModel) {
        case "batch": {
          const batch = Math.max(1, Math.floor(batchSize));
          const delay = Math.max(0, Math.floor(delayMs));
          runConfig = {
            loadModel: "batch",
            token,
            amount,
            totalRequests: total,
            batchSize: batch,
            delayMs: delay,
          };
          break;
        }
        case "fixed": {
          const rate = Number(ratePerSecond);
          requirePositive("Rate per second", rate);
          runConfig = {
            loadModel: "fixed",
            token,
            amount,
            totalRequests: total,
            ratePerSecond: rate,
            maxInFlight: normalizeMaxInFlight(maxInFlight),
          };
          break;
        }
        case "ramp": {
          const startRate = Number(rampStartRate);
          const stepRate = Number(rampStepRate);
          const stepDurationSec = Number(rampStepDurationSec);
          const maxRate = Number(rampMaxRate);
          requirePositive("Start rate", startRate);
          requirePositive("Step rate", stepRate);
          requirePositive("Step duration", stepDurationSec);
          requirePositive("Max rate", maxRate);
          runConfig = {
            loadModel: "ramp",
            token,
            amount,
            totalRequests: total,
            startRate,
            stepRate,
            stepDurationSec,
            maxRate,
            maxInFlight: normalizeMaxInFlight(maxInFlight),
          };
          break;
        }
        case "soak": {
          const rate = Number(ratePerSecond);
          const durationMinutes = Number(soakDurationMinutes);
          requirePositive("Rate per second", rate);
          requirePositive("Duration minutes", durationMinutes);
          runConfig = {
            loadModel: "soak",
            token,
            amount,
            totalRequests: total,
            ratePerSecond: rate,
            durationMinutes,
            maxInFlight: normalizeMaxInFlight(maxInFlight),
          };
          break;
        }
        default:
          throw new Error("Select a load model.");
      }
    } catch (err) {
      setIsRunning(false);
      setRunError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!runConfig) {
      setIsRunning(false);
      setRunError("Select a load model.");
      return;
    }

    const opsList: Operation[] = Array.from({ length: total }, (_, idx) => {
      const destinationChainId =
        eligibleDestinations[
          Math.floor(Math.random() * eligibleDestinations.length)
        ]!;
      return {
        id: idx + 1,
        status: "queued",
        destinationChainId,
        token,
        amount,
        startedAt: undefined,
        finishedAt: undefined,
      };
    });
    const opsById: Record<number, Operation> = {};
    for (const op of opsList) {
      opsById[op.id] = op;
    }

    setOperationsById(opsById);
    opsRef.current = opsById;
    setOperationOrder([]);
    orderRef.current = [];

    const chainLookup = new Map(
      supported.map((chain) => [chain.id, chain.name]),
    );
    const startedAt = now;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const runState: StressRun = {
      id: runId,
      status: "running",
      startedAt,
      config: runConfig,
    };
    setRun(runState);
    runRef.current = runState;
    spanSamplesByRunRef.current[runId] = [];

    await runStressTest({
      operations: opsList,
      config: runConfig,
      execute: (op) => runOperation(op, privateKeyValue, runId),
      shouldStop: () => stopRequestedRef.current || runIdRef.current !== runId,
    });

    const end = Date.now();
    const stopped = stopRequestedRef.current;
    const finalOpsList = Object.values(opsRef.current).map((op) => {
      if (op.status === "fulfilled" || op.status === "failed") return op;
      const finishedAt = op.finishedAt ?? end;
      const durationMs =
        op.startedAt !== undefined
          ? Math.max(0, finishedAt - op.startedAt)
          : undefined;
      return {
        ...op,
        status: "failed" as OperationStatus,
        error: stopRequestedRef.current
          ? "Cancelled by user."
          : "Incomplete operation.",
        cancelled: stopRequestedRef.current ? true : op.cancelled,
        finishedAt,
        durationMs,
      };
    });
    const finalOpsMap: Record<number, Operation> = {};
    for (const op of finalOpsList) {
      finalOpsMap[op.id] = op;
    }
    opsRef.current = finalOpsMap;
    setOperationsById(finalOpsMap);
    setIsRunning(false);
    setIsStopping(false);
    stopRequestedRef.current = false;
    if (runRef.current) {
      const nextRun: StressRun = {
        ...runRef.current,
        status: stopped ? "stopped" : "completed",
        endedAt: end,
      };
      setRun(nextRun);
      runRef.current = nextRun;
    }

    const nextReport = buildReport(
      finalOpsList,
      startedAt,
      end,
      runConfig,
      chainLookup,
    );
    setReport(nextReport);
    const runSpanSamples = spanSamplesByRunRef.current[runId] ?? [];
    setCurrentRunSpanSamples(runSpanSamples);
    setCurrentRunSpanAggregates(aggregateSpans(runSpanSamples));
  }, [
    amount,
    batchSize,
    clientReady,
    delayMs,
    isRunning,
    loadModel,
    maxInFlight,
    rampMaxRate,
    rampStartRate,
    rampStepDurationSec,
    rampStepRate,
    ratePerSecond,
    resetRunState,
    runOperation,
    selectedDestinations,
    soakDurationMinutes,
    supported,
    token,
    totalRequests,
    resolvePrivateKey,
  ]);

  const stopTest = useCallback(() => {
    if (!isRunning) return;
    stopRequestedRef.current = true;
    setIsStopping(true);
    setOperationsById((prev) => {
      const now = Date.now();
      const next: Record<number, Operation> = { ...prev };
      for (const op of Object.values(prev)) {
        if (op.status !== "queued") continue;
        next[op.id] = {
          ...op,
          status: "failed" as OperationStatus,
          cancelled: true,
          error: "Cancelled by user.",
          finishedAt: now,
        };
      }
      opsRef.current = next;
      return next;
    });
  }, [isRunning]);

  const statusCounts = useMemo(() => {
    const counts: Record<OperationStatus, number> = {
      queued: 0,
      running: 0,
      approved: 0,
      signed: 0,
      deposited: 0,
      fulfilled: 0,
      failed: 0,
    };
    for (const op of operationsList) {
      counts[op.status] += 1;
    }
    return counts;
  }, [operationsList]);

  const progress = useMemo(() => {
    const total = operationsList.length || 1;
    const done = operationsList.filter(
      (op) => op.status === "fulfilled" || op.status === "failed",
    ).length;
    return Math.min(100, (done / total) * 100);
  }, [operationsList]);

  const destinationSummary = useMemo(() => {
    if (selectedDestinations.length === 0) return "None";
    if (
      destinationOptions.length > 0 &&
      selectedDestinations.length === destinationOptions.length
    ) {
      return "All chains";
    }
    const labels = selectedDestinations
      .map((value) => destinationLabelMap.get(value))
      .filter((label): label is string => Boolean(label));
    if (labels.length === 0) {
      return `${selectedDestinations.length} chains`;
    }
    const visible = labels.slice(0, 2);
    const remaining = labels.length - visible.length;
    return remaining > 0
      ? `${visible.join(", ")} +${remaining}`
      : visible.join(", ");
  }, [destinationLabelMap, destinationOptions.length, selectedDestinations]);

  const tokenSummaryParts = useMemo(() => {
    const destinationLabel =
      destinationSummary === "All chains"
        ? "All chains"
        : destinationSummary === "None"
          ? "No destinations"
          : destinationSummary;
    return [token, amount, destinationLabel];
  }, [amount, destinationSummary, token]);

  const modelExplainer = useMemo(() => {
    switch (loadModel) {
      case "batch":
        return "Batch runs a fixed number of requests in parallel, waits for completion, then applies the delay before the next batch.";
      case "fixed":
        return "Fixed rate starts requests at a steady pace (requests per second), regardless of how long previous requests take.";
      case "ramp":
        return "Ramp increases the request rate in steps over time, starting at the base rate and climbing until the max rate.";
      case "soak":
        return "Soak runs at a steady rate for a fixed duration to test stability over time.";
      default:
        return "";
    }
  }, [loadModel]);

  const modelSettings = useMemo(() => {
    const formatMaxInFlight =
      maxInFlight && maxInFlight > 0 ? `${maxInFlight}` : "Unlimited";
    const base = [
      {
        label: "Total requests",
        value: `${totalRequests}`,
        description: "Hard cap on how many operations this run will start.",
      },
    ];
    switch (loadModel) {
      case "batch":
        return [
          ...base,
          {
            label: "Batch size",
            value: `${batchSize}`,
            description: "How many operations run in parallel per batch.",
          },
          {
            label: "Delay",
            value: `${delayMs} ms`,
            description:
              "Pause between batches after all operations in a batch finish.",
          },
        ];
      case "fixed":
        return [
          ...base,
          {
            label: "Rate",
            value: `${ratePerSecond} req/s`,
            description: "How many operations start per second.",
          },
          {
            label: "Max in-flight",
            value: formatMaxInFlight,
            description: "Optional cap on concurrent operations.",
          },
        ];
      case "ramp":
        return [
          ...base,
          {
            label: "Start rate",
            value: `${rampStartRate} req/s`,
            description: "Initial rate when the run begins.",
          },
          {
            label: "Step rate",
            value: `${rampStepRate} req/s`,
            description: "Increase applied each step interval.",
          },
          {
            label: "Step duration",
            value: `${rampStepDurationSec} s`,
            description: "How long each step rate lasts before increasing.",
          },
          {
            label: "Max rate",
            value: `${rampMaxRate} req/s`,
            description: "Upper bound for the ramp.",
          },
          {
            label: "Max in-flight",
            value: formatMaxInFlight,
            description: "Optional cap on concurrent operations.",
          },
        ];
      case "soak":
        return [
          ...base,
          {
            label: "Rate",
            value: `${ratePerSecond} req/s`,
            description: "How many operations start per second.",
          },
          {
            label: "Duration",
            value: `${soakDurationMinutes} min`,
            description: "How long to sustain the fixed rate.",
          },
          {
            label: "Max in-flight",
            value: formatMaxInFlight,
            description: "Optional cap on concurrent operations.",
          },
        ];
      default:
        return base;
    }
  }, [
    batchSize,
    delayMs,
    loadModel,
    maxInFlight,
    rampMaxRate,
    rampStartRate,
    rampStepDurationSec,
    rampStepRate,
    ratePerSecond,
    soakDurationMinutes,
    totalRequests,
  ]);

  const reportConfigLines = useMemo(() => {
    if (!report) return [];
    const { config } = report;
    const lines = [
      `Load model: ${titleCase(config.loadModel)}`,
      `Token: ${config.token}`,
      `Amount: ${config.amount}`,
      `Total: ${config.totalRequests}`,
    ];

    switch (config.loadModel) {
      case "batch":
        lines.push(`Batch: ${config.batchSize}`);
        lines.push(`Delay: ${config.delayMs} ms`);
        break;
      case "fixed":
        lines.push(`Rate: ${config.ratePerSecond} req/s`);
        if (config.maxInFlight && config.maxInFlight > 0) {
          lines.push(`Max in-flight: ${config.maxInFlight}`);
        }
        break;
      case "ramp":
        lines.push(`Start rate: ${config.startRate} req/s`);
        lines.push(`Step rate: ${config.stepRate} req/s`);
        lines.push(`Step duration: ${config.stepDurationSec} s`);
        lines.push(`Max rate: ${config.maxRate} req/s`);
        if (config.maxInFlight && config.maxInFlight > 0) {
          lines.push(`Max in-flight: ${config.maxInFlight}`);
        }
        break;
      case "soak":
        lines.push(`Rate: ${config.ratePerSecond} req/s`);
        lines.push(`Duration: ${config.durationMinutes} min`);
        if (config.maxInFlight && config.maxInFlight > 0) {
          lines.push(`Max in-flight: ${config.maxInFlight}`);
        }
        break;
      default:
        break;
    }

    return lines;
  }, [report]);

  const operationDurations = useMemo(() => {
    return operationsList
      .map((op) => op.durationMs)
      .filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value),
      )
      .sort((a, b) => a - b);
  }, [operationsList]);

  const operationHistogram = useMemo(() => {
    if (operationDurations.length === 0) return [];
    const maxValue = operationDurations[operationDurations.length - 1] ?? 0;
    const bucketCount = 6;
    const bucketSize = niceBucketSize(maxValue, bucketCount);
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      fromMs: i * bucketSize,
      toMs: (i + 1) * bucketSize,
      count: 0,
    }));
    for (const duration of operationDurations) {
      const index = Math.min(
        Math.floor(duration / bucketSize),
        bucketCount - 1,
      );
      const bucket = buckets[index];
      if (bucket) {
        bucket.count += 1;
      }
    }
    const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);
    return buckets.map((bucket) => ({
      ...bucket,
      label: formatDurationRange(bucket.fromMs, bucket.toMs),
      ratio: bucket.count / maxCount,
    }));
  }, [operationDurations]);

  const operationSpanComparison = useMemo(() => {
    const operationIds = Array.from(
      new Set(currentRunSpanSamples.map((sample) => sample.operationId)),
    ).sort((a, b) => a - b);
    const allSpanNames = Array.from(
      new Set(currentRunSpanSamples.map((sample) => sample.spanName)),
    )
      .filter((name) => name.startsWith("flow.") || name.startsWith("network."))
      .sort();

    const rows = allSpanNames.map((spanName) => {
      const byOperation = operationIds.map((operationId) => {
        const values = currentRunSpanSamples
          .filter(
            (sample) =>
              sample.operationId === operationId &&
              sample.spanName === spanName,
          )
          .map((sample) => sample.durationMs);
        if (values.length === 0) {
          return {
            operationId,
            value: null,
          };
        }
        const mean =
          values.reduce((acc, value) => acc + value, 0) / values.length;
        const median = computeMedian(values);
        return {
          operationId,
          value: comparisonMetric === "meanMs" ? mean : median,
        };
      });

      const availableValues = byOperation
        .map((entry) => entry.value)
        .filter((value): value is number => value !== null);
      const meanAcrossOps =
        availableValues.length > 0
          ? availableValues.reduce((acc, value) => acc + value, 0) /
            availableValues.length
          : 0;
      const medianAcrossOps = computeMedian(availableValues);
      const firstValue =
        byOperation.find((entry) => entry.value !== null)?.value ?? null;
      const lastValue =
        [...byOperation].reverse().find((entry) => entry.value !== null)
          ?.value ?? null;
      const deltaFirstToLastPct =
        firstValue !== null && lastValue !== null && firstValue > 0
          ? ((lastValue - firstValue) / firstValue) * 100
          : null;
      return {
        spanName,
        byOperation,
        meanAcrossOps,
        medianAcrossOps,
        deltaFirstToLastPct,
      };
    });

    const sortedRows = rows.sort(
      (a, b) => b.medianAcrossOps - a.medianAcrossOps,
    );
    return { operationIds, rows: sortedRows };
  }, [comparisonMetric, currentRunSpanSamples]);

  useEffect(() => {
    if (operationSpanComparison.rows.length === 0) {
      setSelectedSpanForTrend("");
      return;
    }
    if (
      !operationSpanComparison.rows.some(
        (row) => row.spanName === selectedSpanForTrend,
      )
    ) {
      setSelectedSpanForTrend(operationSpanComparison.rows[0]?.spanName ?? "");
    }
  }, [operationSpanComparison.rows, selectedSpanForTrend]);

  const selectedSpanTrend = useMemo(() => {
    if (!selectedSpanForTrend) return [];
    const row = operationSpanComparison.rows.find(
      (entry) => entry.spanName === selectedSpanForTrend,
    );
    if (!row) return [];
    return row.byOperation.filter((entry) => entry.value !== null) as Array<{
      operationId: number;
      value: number;
    }>;
  }, [operationSpanComparison.rows, selectedSpanForTrend]);

  const selectedSpanTrendData = useMemo(
    () =>
      selectedSpanTrend.map((entry) => ({
        operationLabel: `#${entry.operationId}`,
        operationId: entry.operationId,
        durationMs: entry.value,
      })),
    [selectedSpanTrend],
  );

  const trendSpanOptions: DropdownOption[] = useMemo(
    () =>
      operationSpanComparison.rows.map((row) => ({
        value: row.spanName,
        label: row.spanName,
      })),
    [operationSpanComparison.rows],
  );

  const durationSummaryLine = useMemo(() => {
    if (!report) return "";
    return [
      `Min ${formatDurationCompact(report.performance.minMs)}`,
      `Median ${formatDurationCompact(report.performance.medianMs)}`,
      `P95 ${formatDurationCompact(report.performance.p95Ms)}`,
      `Max ${formatDurationCompact(report.performance.maxMs)}`,
    ].join("  ·  ");
  }, [report]);

  const histogramChartData = useMemo(
    () =>
      operationHistogram.map((bucket) => ({
        range: bucket.label,
        count: bucket.count,
      })),
    [operationHistogram],
  );

  const currentRunSubrunChartData = useMemo(
    () =>
      currentRunSpanAggregates.slice(0, 10).map((span) => ({
        spanLabel: shortSpanLabel(span.spanName),
        spanName: span.spanName,
        medianMs: span.medianMs,
        meanMs: span.meanMs,
        p95Ms: span.p95Ms,
        count: span.count,
      })),
    [currentRunSpanAggregates],
  );

  const subrunGridTemplate = useMemo(() => {
    const operationColumns = operationSpanComparison.operationIds.length;
    return [
      "minmax(210px, 1.8fr)",
      ...Array.from({ length: operationColumns }, () => "minmax(90px, 0.8fr)"),
      "minmax(90px, 0.8fr)",
      "minmax(90px, 0.8fr)",
      "minmax(140px, 1fr)",
    ].join(" ");
  }, [operationSpanComparison.operationIds.length]);

  if (!isConnected && !isSharedReportView) {
    return (
      <p className="status">Connect your wallet to access stress testing.</p>
    );
  }

  if (clientError && !isSharedReportView) {
    return <p className="status error">{clientError}</p>;
  }

  const progressTier =
    progress >= 100 ? 3 : progress >= 70 ? 2 : progress >= 30 ? 1 : 0;
  const runStatusVariant =
    run?.status === "completed"
      ? "fulfilled"
      : run?.status === "stopped"
        ? "warning"
        : "running";

  return (
    <div
      className={`stack-xl stress-layout${isSharedReportView ? " stress-layout--shared" : ""}`}
    >
      {!isSharedReportView && (
        <section className="hero-card stress-hero">
          <div className="card-kicker">
            <span className="icon-badge" aria-hidden="true">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </span>
            <span>Stress Test</span>
            <span className="meta-pill meta-pill--warning">
              Testnet only · disposable key
            </span>
          </div>

          <p className="hero-copy">
            Run repeated cross-chain bridge operations to measure latency and
            surface failure modes. Uses your private key to sign automatically.
          </p>

          <div className="stress-disclaimer">
            <svg
              className="stress-disclaimer-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div>
              <strong>Max allowance approvals are enabled</strong> to reduce
              concurrent allowance races and focus on protocol stress behavior.
              Do not paste mainnet or real-value private keys here.
            </div>
          </div>

          {!clientReady && <p className="status">Initializing SDK…</p>}

          {clientReady && (
            <div className="stress-hero-body">
              <form
                className="stress-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!isRunning) {
                    startTest().catch(() => {});
                  }
                }}
              >
                <div className="field-section">
                  <label
                    className="field-section-label"
                    htmlFor="stress-private-key"
                  >
                    Private Key
                  </label>
                  <div className="field field-full">
                    <input
                      id="stress-private-key"
                      type="password"
                      value={privateKey}
                      onChange={(event) => setPrivateKey(event.target.value)}
                      placeholder="0x…"
                    />
                    {privateAddress && (
                      <p className="field-helper">{privateAddress}</p>
                    )}
                  </div>
                </div>

                <div className="field-section">
                  <span className="field-section-label">Model Settings</span>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="stress-load-model">Load Model</label>
                      <Dropdown
                        id="stress-load-model"
                        options={loadModelOptions}
                        value={loadModel}
                        onChange={(value) => setLoadModel(value as LoadModel)}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="stress-total-requests">
                        Total Requests
                      </label>
                      <input
                        id="stress-total-requests"
                        type="number"
                        min={1}
                        value={totalRequests}
                        onChange={(event) =>
                          setTotalRequests(Number(event.target.value))
                        }
                      />
                    </div>

                    {loadModel === "batch" && (
                      <>
                        <div className="field">
                          <label htmlFor="stress-batch-size">Batch Size</label>
                          <input
                            id="stress-batch-size"
                            type="number"
                            min={1}
                            value={batchSize}
                            onChange={(event) =>
                              setBatchSize(Number(event.target.value))
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="stress-delay">Delay (ms)</label>
                          <input
                            id="stress-delay"
                            type="number"
                            min={0}
                            value={delayMs}
                            onChange={(event) =>
                              setDelayMs(Number(event.target.value))
                            }
                          />
                        </div>
                      </>
                    )}

                    {loadModel === "fixed" && (
                      <>
                        <div className="field">
                          <label htmlFor="stress-rate">Rate (req/s)</label>
                          <input
                            id="stress-rate"
                            type="number"
                            min={0}
                            step="0.1"
                            value={ratePerSecond}
                            onChange={(event) =>
                              setRatePerSecond(Number(event.target.value))
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="stress-max-inflight">
                            Max In-Flight
                          </label>
                          <input
                            id="stress-max-inflight"
                            type="number"
                            min={0}
                            value={maxInFlight}
                            onChange={(event) =>
                              setMaxInFlight(Number(event.target.value))
                            }
                            placeholder="Unlimited"
                          />
                        </div>
                      </>
                    )}

                    {loadModel === "ramp" && (
                      <>
                        <div className="field">
                          <label htmlFor="stress-ramp-start">Start Rate</label>
                          <input
                            id="stress-ramp-start"
                            type="number"
                            min={0}
                            step="0.1"
                            value={rampStartRate}
                            onChange={(event) =>
                              setRampStartRate(Number(event.target.value))
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="stress-ramp-step">Step Rate</label>
                          <input
                            id="stress-ramp-step"
                            type="number"
                            min={0}
                            step="0.1"
                            value={rampStepRate}
                            onChange={(event) =>
                              setRampStepRate(Number(event.target.value))
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="stress-ramp-step-duration">
                            Step Duration (s)
                          </label>
                          <input
                            id="stress-ramp-step-duration"
                            type="number"
                            min={1}
                            value={rampStepDurationSec}
                            onChange={(event) =>
                              setRampStepDurationSec(
                                Number(event.target.value),
                              )
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="stress-ramp-max">Max Rate</label>
                          <input
                            id="stress-ramp-max"
                            type="number"
                            min={0}
                            step="0.1"
                            value={rampMaxRate}
                            onChange={(event) =>
                              setRampMaxRate(Number(event.target.value))
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="stress-ramp-max-inflight">
                            Max In-Flight
                          </label>
                          <input
                            id="stress-ramp-max-inflight"
                            type="number"
                            min={0}
                            value={maxInFlight}
                            onChange={(event) =>
                              setMaxInFlight(Number(event.target.value))
                            }
                            placeholder="Unlimited"
                          />
                        </div>
                      </>
                    )}

                    {loadModel === "soak" && (
                      <>
                        <div className="field">
                          <label htmlFor="stress-soak-rate">Rate (req/s)</label>
                          <input
                            id="stress-soak-rate"
                            type="number"
                            min={0}
                            step="0.1"
                            value={ratePerSecond}
                            onChange={(event) =>
                              setRatePerSecond(Number(event.target.value))
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="stress-soak-duration">
                            Duration (min)
                          </label>
                          <input
                            id="stress-soak-duration"
                            type="number"
                            min={1}
                            value={soakDurationMinutes}
                            onChange={(event) =>
                              setSoakDurationMinutes(
                                Number(event.target.value),
                              )
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="stress-soak-max-inflight">
                            Max In-Flight
                          </label>
                          <input
                            id="stress-soak-max-inflight"
                            type="number"
                            min={0}
                            value={maxInFlight}
                            onChange={(event) =>
                              setMaxInFlight(Number(event.target.value))
                            }
                            placeholder="Unlimited"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="field-section">
                  <span className="field-section-label">
                    Token &amp; Destination
                  </span>
                  <div className="stress-collapsible">
                    <button
                      type="button"
                      className="stress-collapsible-toggle"
                      onClick={() => setTokenPanelOpen((open) => !open)}
                      aria-expanded={tokenPanelOpen}
                    >
                      <span className="stress-collapsible-toggle-text">
                        <span className="stress-collapsible-title">
                          Configure
                        </span>
                        {!tokenPanelOpen && (
                          <span className="stress-collapsible-summary">
                            {tokenSummaryParts.map((part) => (
                              <span
                                key={part}
                                className="stress-collapsible-tag"
                              >
                                {part}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <svg
                        className={`stress-collapsible-chevron${tokenPanelOpen ? " open" : ""}`}
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {tokenPanelOpen && (
                      <div className="stress-collapsible-body">
                        <div className="form-grid">
                          <div className="field">
                            <label htmlFor="stress-token">Token</label>
                            <Dropdown
                              id="stress-token"
                              options={tokenOptions}
                              value={
                                tokenOptions.find((opt) => opt.value === token)
                                  ? token
                                  : (tokenOptions[0]?.value ?? "")
                              }
                              onChange={(value) => setToken(value)}
                            />
                          </div>

                          <div className="field">
                            <label htmlFor="stress-amount">Amount</label>
                            <input
                              id="stress-amount"
                              type="text"
                              inputMode="decimal"
                              value={amount}
                              onChange={(event) =>
                                setAmount(event.target.value)
                              }
                            />
                          </div>

                          <div className="field field-full">
                            <label htmlFor="stress-destinations">
                              Destination Chains
                            </label>
                            <MultiSelect
                              id="stress-destinations"
                              options={destinationOptions}
                              selected={selectedDestinations}
                              onChange={(value) =>
                                setSelectedDestinations(value)
                              }
                              placeholder="Select destination chains…"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="stress-actions">
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={isRunning}
                  >
                    Start Test
                  </button>
                  <button
                    type="button"
                    className="intent-button intent-button-stop"
                    onClick={stopTest}
                    disabled={!isRunning}
                  >
                    {isStopping ? "Stopping…" : "Stop"}
                  </button>
                  <button
                    type="button"
                    className="intent-button intent-button-deny"
                    onClick={resetRunState}
                    disabled={isRunning}
                  >
                    Reset
                  </button>
                </div>
                {runError && <p className="status error">{runError}</p>}
              </form>

              <aside className="stress-explainer">
                <div className="stress-explainer-head">
                  <span className="stress-explainer-eyebrow">
                    Model Explainer
                  </span>
                  <h4 className="stress-explainer-title">
                    {loadModelOptions.find((opt) => opt.value === loadModel)
                      ?.label ?? loadModel}
                  </h4>
                </div>
                <p className="stress-explainer-copy">{modelExplainer}</p>
                <div className="stress-explainer-list">
                  {modelSettings.map((setting) => (
                    <div
                      key={setting.label}
                      className="stress-explainer-item"
                    >
                      <div className="stress-explainer-item-row">
                        <span>{setting.label}</span>
                        <strong>{setting.value}</strong>
                      </div>
                      <p className="stress-explainer-item-desc">
                        {setting.description}
                      </p>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          )}
        </section>
      )}

      {!isSharedReportView && (
        <section className="stress-run">
          <div className="stress-run-head">
            <div className="stress-run-head-text">
              <h3>
                <span className="icon-badge" aria-hidden="true">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <polygon points="6 4 20 12 6 20 6 4" />
                  </svg>
                </span>
                {run ? `Run #${run.id}` : "Run Status"}
                {run && (
                  <span
                    className={`meta-pill meta-pill--${runStatusVariant} meta-pill--inline`}
                  >
                    {run.status}
                  </span>
                )}
              </h3>
              <p>Progress and per-operation state updates</p>
            </div>
            <div className="stress-run-status-strip">
              <span className="meta-pill meta-pill--queued meta-pill--inline">
                Queued {statusCounts.queued}
              </span>
              <span className="meta-pill meta-pill--running meta-pill--inline">
                Running {statusCounts.running}
              </span>
              <span className="meta-pill meta-pill--approved meta-pill--inline">
                Approved {statusCounts.approved}
              </span>
              <span className="meta-pill meta-pill--signed meta-pill--inline">
                Signed {statusCounts.signed}
              </span>
              <span className="meta-pill meta-pill--deposited meta-pill--inline">
                Deposited {statusCounts.deposited}
              </span>
              <span className="meta-pill meta-pill--fulfilled meta-pill--inline">
                Fulfilled {statusCounts.fulfilled}
              </span>
              <span className="meta-pill meta-pill--failed meta-pill--inline">
                Failed {statusCounts.failed}
              </span>
            </div>
          </div>

          <div className="stress-progress-row">
            <div
              className="stress-progress-track"
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`stress-progress-fill stress-progress-fill--tier-${progressTier}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="stress-progress-label">
              {progress.toFixed(0)}%
            </span>
          </div>

          {operationsList.length === 0 ? (
            <p className="status">No operations yet.</p>
          ) : (
            <ol className="stress-list">
              {operationsList.map((op) => (
                <li
                  key={op.id}
                  className={`stress-row stress-row--${op.status}`}
                >
                  <div className="stress-row-id">
                    <span className="stress-row-num">#{op.id}</span>
                    <span className="stress-row-meta">
                      Chain {op.destinationChainId} · {op.token} · {op.amount}
                    </span>
                  </div>
                  <div className="stress-row-side">
                    {(op.intentExplorerUrl || op.explorerUrl) && (
                      <span className="stress-row-links">
                        {op.intentExplorerUrl && (
                          <a
                            className="stress-row-link"
                            href={op.intentExplorerUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            intent
                          </a>
                        )}
                        {op.explorerUrl &&
                          op.explorerUrl !== op.intentExplorerUrl && (
                            <a
                              className="stress-row-link"
                              href={op.explorerUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              tx
                            </a>
                          )}
                      </span>
                    )}
                    {op.durationMs !== undefined ? (
                      <span className="stress-row-duration">
                        {formatDuration(op.durationMs)}
                      </span>
                    ) : op.startedAt ? (
                      <span className="stress-row-duration">
                        {formatDuration(Date.now() - op.startedAt)}
                      </span>
                    ) : null}
                    <span
                      className={`meta-pill meta-pill--${op.status} meta-pill--inline`}
                    >
                      {op.status}
                    </span>
                  </div>
                  {op.depositObserved === false && (
                    <div className="stress-row-note">
                      Deposit not observed
                    </div>
                  )}
                  {op.error && (
                    <div className="stress-row-error field-error">
                      {op.error}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {report && (
        <StressReportSection
          report={report}
          isSharedReportView={isSharedReportView}
          exitSharedReportView={exitSharedReportView}
          handleCopyShareLink={handleCopyShareLink}
          isCopyingShareLink={isCopyingShareLink}
          shareButtonLabel={shareButtonLabel}
          currentRunSpanAggregates={currentRunSpanAggregates}
          operationHistogramLength={operationHistogram.length}
          durationSummaryLine={durationSummaryLine}
          histogramChartData={histogramChartData}
          currentRunSubrunChartData={currentRunSubrunChartData}
          comparisonMetric={comparisonMetric}
          comparisonMetricOptions={comparisonMetricOptions}
          setComparisonMetric={setComparisonMetric}
          selectedSpanForTrend={selectedSpanForTrend}
          trendSpanOptions={trendSpanOptions}
          setSelectedSpanForTrend={setSelectedSpanForTrend}
          selectedSpanTrendData={selectedSpanTrendData}
          operationSpanComparison={operationSpanComparison}
          subrunGridTemplate={subrunGridTemplate}
          reportConfigLines={reportConfigLines}
        />
      )}
    </div>
  );
}
