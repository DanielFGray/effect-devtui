/**
 * Analysis Progress List Component
 *
 * A reusable component that shows the progress of layer analysis
 * with visual indicators for completed, current, and pending steps.
 */

import { For, createMemo } from "solid-js";
import { theme } from "./theme";
import { useStore } from "./store";
import {
  ANALYSIS_STEPS,
  ANALYSIS_STEP_LABELS,
  type AnalysisProgressStep,
} from "./storeTypes";

/**
 * Get the status of a step relative to the current progress
 */
function getStepStatus(
  step: AnalysisProgressStep,
  currentStep: AnalysisProgressStep | null,
): "pending" | "current" | "completed" {
  if (!currentStep) return "pending";

  const stepIndex = ANALYSIS_STEPS.indexOf(step);
  const currentIndex = ANALYSIS_STEPS.indexOf(currentStep);

  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "current";
  return "pending";
}

/**
 * Get the icon for a step based on its status
 */
function getStepIcon(status: "pending" | "current" | "completed"): string {
  switch (status) {
    case "completed":
      return "✓";
    case "current":
      return "→";
    case "pending":
      return "○";
  }
}

interface AnalysisProgressListProps {
  /** Whether to show in a compact single-line format */
  compact?: boolean;
}

/**
 * Displays the list of analysis progress steps with visual status indicators.
 *
 * - Completed steps: ✓ in green
 * - Current step: → in orange/warning
 * - Pending steps: ○ in muted gray
 */
export function AnalysisProgressList(props: AnalysisProgressListProps) {
  const { store } = useStore();

  const currentStep = createMemo(() => store.ui.layerAnalysisProgress);

  // Compact mode: show only current step on one line
  if (props.compact) {
    return (
      <text style={{ fg: theme.warning }}>
        {currentStep()
          ? `→ ${ANALYSIS_STEP_LABELS[currentStep()!]}...`
          : "Analyzing..."}
      </text>
    );
  }

  // Full mode: show all steps
  return (
    <box flexDirection="column">
      <For each={ANALYSIS_STEPS}>
        {(step) => {
          const status = createMemo(() => getStepStatus(step, currentStep()));
          const icon = createMemo(() => getStepIcon(status()));
          const label = ANALYSIS_STEP_LABELS[step];

          return (
            <text
              style={{
                fg:
                  status() === "completed"
                    ? theme.success
                    : status() === "current"
                      ? theme.warning
                      : theme.muted,
              }}
              marginBottom={1}
            >
              {icon()} {label}
            </text>
          );
        }}
      </For>
    </box>
  );
}
