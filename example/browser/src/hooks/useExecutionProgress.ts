import { useCallback, useRef, useState } from "react";
import type {
  ExecutionProgressState,
  NormalizedStep,
  OperationResult,
  ProgressHeader,
  ProgressPhase,
  ProgressResult,
  StepState,
} from "../lib/types";

/* ── Step normalization ──────────────────────────────────────────── */

type RawStep = {
  id: string;
  type: string;
  chainId?: number;
  tokenAddress?: string;
  chain?: { id: number; name: string; logo: string };
  token?: { symbol: string; logo?: string };
  to?: string;
};

const STEP_LABELS: Record<string, (step: RawStep) => string> = {
  execute_approval: (s) => `Approve ${s.token?.symbol ?? "token"}`,
  execute_transaction: (s) => `Execute on ${s.chain?.name ?? "chain"}`,
  erc20_approval: (s) => `Approve token on ${s.chain?.name ?? "source chain"}`,
  source_approval_signature: () => "Sign token approval",
  intent_signature: () => "Sign intent",
  native_transaction: (s) => `Submit source transaction on ${s.chain?.name ?? "chain"}`,
  intent_submission: () => "Submit intent",
  intent_fulfillment: () => "Wait for fulfillment",
};

function extractToken(step: RawStep): NormalizedStep["token"] {
  if (step.token) {
    return { symbol: step.token.symbol, amount: "", logo: step.token.logo };
  }
  return undefined;
}

function normalizeStep(raw: RawStep): NormalizedStep {
  const labelFn = STEP_LABELS[raw.type];
  const chain = raw.chain ?? (raw.chainId
    ? { id: raw.chainId, name: `Chain ${raw.chainId}`, logo: "" }
    : undefined);
  return {
    id: raw.id,
    type: raw.type,
    label: labelFn ? labelFn(raw) : raw.type.replace(/_/g, " "),
    state: "pending",
    chain,
    token: extractToken(raw),
  };
}

/* ── State mapping from SDK events ───────────────────────────────── */

export function mapStatusToPhase(status: string): ProgressPhase | null {
  switch (status) {
    case "completed":
      return "completed";
    case "fulfilled":
      return "executing";
    case "created":
    case "deposited":
      return "executing";
    default:
      return null;
  }
}

function mapProgressState(state: string): StepState {
  switch (state) {
    case "started":
      return "active";
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
        state?: string;
        step?: RawStep;
        quote?: { plan?: { steps?: RawStep[] } };
        txHash?: string;
        explorerUrl?: string;
        error?: string;
      };

      if (!ev.type) return;

      const draft = ensureDraft();

      // Better Intent quote events carry the canonical API execution plan.
      if (ev.type === "quote") {
        if (ev.quote?.plan?.steps) {
          draft.steps = ev.quote.plan.steps.map(normalizeStep);
        }
        draft.phase = "awaiting_approval";
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

      // Better Intent emits one event per canonical plan-step transition.
      if (ev.type === "step" && ev.step) {
        let target = draft.steps.find((step) => step.id === ev.step?.id);
        if (!target) {
          target = normalizeStep(ev.step);
          draft.steps.push(target);
        }
        const previousState = target.state;
        target.state = mapProgressState(ev.state ?? "started");
        target.rawState = ev.state;
        if (ev.txHash) target.txHash = ev.txHash;
        if (ev.explorerUrl) target.explorerUrl = ev.explorerUrl;
        if (ev.error) target.error = ev.error;
        if (
          (target.state === "done" || target.state === "failed") &&
          previousState !== target.state &&
          target.completedAt === undefined
        ) {
          target.completedAt = Date.now();
        }
        if (target.state === "done" && target.explorerUrl &&
          !draft.resultLinks.some((link) => link.href === target.explorerUrl)) {
          draft.resultLinks.push({ label: target.label, href: target.explorerUrl });
        }
        draft.phase = target.state === "failed" ? "failed" : "executing";
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

  const complete = useCallback(
    (result: OperationResult) => {
      const draft = ensureDraft();
      const destination = result.richResult?.route
        .filter((step) => step.type === "destination")
        .at(-1);
      if (draft.header && destination) {
        draft.header = { ...draft.header, amount: destination.amount };
      }
      for (const hash of result.hashes) {
        if (hash.href && !draft.resultLinks.some((link) => link.href === hash.href)) {
          draft.resultLinks.push({ label: hash.label, href: hash.href });
        }
      }
      handleEvent({ type: "status", status: "completed" });
    },
    [ensureDraft, handleEvent],
  );

  const closeModal = useCallback(() => {
    draftRef.current = null;
    if (flushRef.current !== null) {
      cancelAnimationFrame(flushRef.current);
      flushRef.current = null;
    }
    setState(null);
  }, []);

  return { state, openModal, closeModal, handleEvent, handleError, attachResult, complete };
}
