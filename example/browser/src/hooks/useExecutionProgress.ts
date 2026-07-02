import { useCallback, useRef, useState } from "react";
import type {
  ExecutionProgressState,
  NormalizedStep,
  ProgressHeader,
  ProgressPhase,
  ProgressResult,
  StepState,
} from "../lib/types";

/* ── Step normalization ──────────────────────────────────────────── */

type RawStep = {
  id: string;
  type: string;
  chain?: { id: number; name: string; logo: string };
  asset?: { symbol: string; amount: string; logo?: string };
  token?: { symbol: string; logo?: string };
  swaps?: Array<{
    input: { symbol: string; amount: string; logo?: string };
    output: { symbol: string; amount: string; logo?: string };
  }>;
  to?: string;
};

const STEP_LABELS: Record<string, (step: RawStep) => string> = {
  source_swap: (s) => `Swap on ${s.chain?.name ?? "source"}`,
  eoa_to_ephemeral_transfer: (s) => `Transfer on ${s.chain?.name ?? "chain"}`,
  bridge_deposit: (s) => `Deposit to bridge on ${s.chain?.name ?? "chain"}`,
  bridge_intent_submission: () => "Submit bridge intent",
  bridge_fill: (s) => `Bridge to ${s.chain?.name ?? "destination"}`,
  destination_swap: (s) => `Swap on ${s.chain?.name ?? "destination"}`,
  allowance_approval: (s) => `Approve ${s.token?.symbol ?? "token"} on ${s.chain?.name ?? "chain"}`,
  request_signing: () => "Sign request",
  request_submission: () => "Submit RFF",
  vault_deposit: (s) => `Deposit on ${s.chain?.name ?? "chain"}`,
  execute_approval: (s) => `Approve ${s.token?.symbol ?? "token"}`,
  execute_transaction: (s) => `Execute on ${s.chain?.name ?? "chain"}`,
};

function extractToken(step: RawStep): NormalizedStep["token"] {
  if (step.asset) {
    return { symbol: step.asset.symbol, amount: step.asset.amount, logo: step.asset.logo };
  }
  if (step.swaps?.length) {
    if (step.type === "destination_swap") {
      const last = step.swaps[step.swaps.length - 1]!;
      return { symbol: last.output.symbol, amount: last.output.amount, logo: last.output.logo };
    }
    const first = step.swaps[0]!;
    return { symbol: first.input.symbol, amount: first.input.amount, logo: first.input.logo };
  }
  if (step.token) {
    return { symbol: step.token.symbol, amount: "", logo: step.token.logo };
  }
  return undefined;
}

function normalizeStep(raw: RawStep): NormalizedStep {
  const labelFn = STEP_LABELS[raw.type];
  return {
    id: raw.id,
    type: raw.type,
    label: labelFn ? labelFn(raw) : raw.type.replace(/_/g, " "),
    state: "pending",
    chain: raw.chain,
    token: extractToken(raw),
  };
}

/* ── State mapping from SDK events ───────────────────────────────── */

function mapStatusToPhase(status: string): ProgressPhase | null {
  switch (status) {
    case "preparing":
      return "preparing";
    case "route_building":
      return "route_building";
    case "intent_building":
      return "intent_building";
    case "route_ready":
    case "intent_ready":
    case "awaiting_approval":
    case "awaiting_allowance_selection":
      return "awaiting_approval";
    case "approved":
    case "executing":
      return "executing";
    case "completed":
      return "completed";
    default:
      return null;
  }
}

function mapProgressState(state: string): StepState {
  switch (state) {
    case "wallet_prompted":
    case "started":
    case "waiting":
      return "active";
    case "submitted":
      return "submitted";
    case "confirmed":
    case "completed":
      return "done";
    case "failed":
      return "failed";
    default:
      return "active";
  }
}

/* ── Hook ─────────────────────────────────────────────────────────── */

type OperationType = ExecutionProgressState["operationType"];

export function useExecutionProgress(operationType: OperationType) {
  const [state, setState] = useState<ExecutionProgressState | null>(null);

  // Mutable draft to batch rapid event updates
  const draftRef = useRef<ExecutionProgressState | null>(null);
  const flushRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (draftRef.current) {
      // Clone to trigger React re-render
      setState({ ...draftRef.current, steps: [...draftRef.current.steps] });
    }
    flushRef.current = null;
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushRef.current === null) {
      flushRef.current = requestAnimationFrame(flush);
    }
  }, [flush]);

  const ensureDraft = useCallback((): ExecutionProgressState => {
    if (!draftRef.current) {
      draftRef.current = {
        phase: "preparing",
        steps: [],
        operationType,
        resultLinks: [],
      };
    }
    return draftRef.current;
  }, [operationType]);

  const handleEvent = useCallback(
    (event: unknown) => {
      const ev = event as {
        type?: string;
        status?: string;
        stepType?: string;
        state?: string;
        step?: RawStep;
        plan?: { steps?: RawStep[] };
        txHash?: string;
        explorerUrl?: string;
        error?: string;
        intentRequestHash?: string;
      };

      if (!ev.type) return;

      const draft = ensureDraft();

      // Plan preview/confirmed — populate steps
      if (ev.type === "plan_preview" || ev.type === "plan_confirmed") {
        if (ev.plan?.steps) {
          draft.steps = ev.plan.steps.map(normalizeStep);
          console.log(`[plan ${ev.type}]`, {
            rawSteps: ev.plan.steps,
            normalized: draft.steps.map((s) => ({
              id: s.id,
              type: s.type,
              label: s.label,
              chain: s.chain?.name,
            })),
          });
        }
        scheduleFlush();
        return;
      }

      // Status events — update phase
      if (ev.type === "status" && ev.status) {
        const phase = mapStatusToPhase(ev.status);
        if (phase) {
          draft.phase = phase;
          // On completion, mark any remaining active/submitted steps as done
          if (phase === "completed") {
            if (draft.completedAt === undefined) draft.completedAt = Date.now();
            for (const step of draft.steps) {
              if (step.state === "active" || step.state === "submitted") {
                step.state = "done";
                if (step.completedAt === undefined) step.completedAt = Date.now();
              }
            }
          }
        }
        scheduleFlush();
        return;
      }

      // Progress events — update individual steps
      if (ev.type === "plan_progress" && ev.stepType) {
        console.log(`[plan_progress:raw]`, {
          event: ev
        });
        const stepId = ev.step?.id;
        const target = stepId
          ? draft.steps.find((s) => s.id === stepId)
          : draft.steps.find((s) => s.type === ev.stepType && s.state !== "done");

        if (target) {
          const prevState = target.state;
          target.state = mapProgressState(ev.state ?? "active");
          target.rawState = ev.state;
          if (ev.txHash) target.txHash = ev.txHash;
          if (ev.explorerUrl) target.explorerUrl = ev.explorerUrl;
          if (ev.error) target.error = ev.error;
          if (ev.intentRequestHash && !target.explorerUrl) {
            target.explorerUrl = ev.explorerUrl;
          }
          // Stamp completion time the first time we transition into a terminal state.
          if (
            (target.state === "done" || target.state === "failed") &&
            prevState !== target.state &&
            target.completedAt === undefined
          ) {
            target.completedAt = Date.now();
            console.log(`[plan_progress ${target.state}] ${target.label}`, {
              rawEvent: ev,
              rawStep: ev.step,
              normalized: { id: target.id, type: target.type, label: target.label },
              allSteps: draft.steps.map((s) => ({
                id: s.id,
                type: s.type,
                label: s.label,
                state: s.state,
              })),
            });
          }

          // Collect result links from completed steps. The link label can
          // diverge from the step label — e.g. the in-progress step reads
          // "Submit request" while the end-state link reads "View RFF".
          if (target.state === "done" && target.explorerUrl) {
            const exists = draft.resultLinks.some((l) => l.href === target.explorerUrl);
            if (!exists) {
              const linkLabel = target.type === "request_submission" ? "View RFF" : target.label;
              draft.resultLinks.push({ label: linkLabel, href: target.explorerUrl });
            }
          }
        }
        scheduleFlush();
      }
    },
    [ensureDraft, scheduleFlush],
  );

  const handleError = useCallback(
    (
      error: unknown,
      opts?: { kind?: "cancelled" | "failed"; reason?: string },
    ) => {
      const draft = ensureDraft();
      draft.phase = "failed";
      draft.failureKind = opts?.kind ?? "failed";
      draft.failureReason =
        opts?.reason ?? (error instanceof Error ? error.message : "Operation failed");
      // Mark the first active step as failed
      const activeStep = draft.steps.find(
        (s) => s.state === "active" || s.state === "submitted",
      );
      if (activeStep) {
        activeStep.state = "failed";
        activeStep.error = draft.failureReason;
        if (activeStep.completedAt === undefined) {
          activeStep.completedAt = Date.now();
        }
      }
      scheduleFlush();
    },
    [ensureDraft, scheduleFlush],
  );

  const openModal = useCallback(
    (header?: ProgressHeader) => {
      draftRef.current = {
        phase: "preparing",
        steps: [],
        operationType,
        resultLinks: [],
        header,
        startedAt: Date.now(),
      };
      setState(draftRef.current);
    },
    [operationType],
  );

  const attachResult = useCallback(
    (result: ProgressResult) => {
      const draft = ensureDraft();
      draft.result = { ...draft.result, ...result };
      scheduleFlush();
    },
    [ensureDraft, scheduleFlush],
  );

  const closeModal = useCallback(() => {
    draftRef.current = null;
    if (flushRef.current !== null) {
      cancelAnimationFrame(flushRef.current);
      flushRef.current = null;
    }
    setState(null);
  }, []);

  return { state, openModal, closeModal, handleEvent, handleError, attachResult };
}
