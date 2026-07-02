import type { Phase, PhaseState } from "../lib/types";

function getPhaseState(
  phases: Phase[],
  phase: Phase,
  started: boolean,
  completedSteps: Set<string>,
): PhaseState {
  if (!started) return "idle";
  if (completedSteps.has(phase.doneWhen)) return "done";
  const idx = phases.findIndex((p) => p.key === phase.key);
  const allPrevDone = phases.slice(0, idx).every((p) => completedSteps.has(p.doneWhen));
  return allPrevDone ? "active" : "idle";
}

export function StepBar({
  phases,
  started,
  completedSteps,
}: {
  phases: Phase[];
  started: boolean;
  completedSteps: Set<string>;
}) {
  if (!started) return null;
  const allDone = phases.every((p) => completedSteps.has(p.doneWhen));
  return (
    <section className={`result-card${allDone ? " step-bar-complete" : ""}`}>
      <div className="step-bar">
        {phases.map((p, i) => {
          const state = getPhaseState(phases, p, started, completedSteps);
          return (
            <div key={p.key} className="step-phase-wrapper">
              <div className={`step-phase ${state}`}>
                <div className="step-icon">
                  {state === "done" ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : state === "active" ? (
                    <span className="spinner-sm" />
                  ) : (
                    <span className="step-number">{i + 1}</span>
                  )}
                </div>
                <span className="step-label">{p.label}</span>
              </div>
              {i < phases.length - 1 && (
                <div className={`step-connector${state === "done" ? " done" : ""}`} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
