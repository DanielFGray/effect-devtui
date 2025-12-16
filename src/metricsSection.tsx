/**
 * Metrics Section Component
 * Displays metrics list with details panel in a resizable container
 */

import { Show, createMemo } from "solid-js";
import { theme } from "./theme";
import { useStore, type FocusedSection } from "./store";
import { MetricsView, MetricDetailsPanel } from "./metricsView";
import { ResizableBox } from "./resizableBox";

/**
 * Helper to get section header color based on focus state
 */
function getSectionHeaderColor(
  focusedSection: FocusedSection,
  section: FocusedSection,
): string {
  return focusedSection === section ? theme.primary : theme.muted;
}

/**
 * Metrics section with resizable container and details panel
 */
export function MetricsSection() {
  const { store, actions } = useStore();

  const metricCount = createMemo(() => store.metrics.length);

  return (
    <ResizableBox
      height={store.ui.metricsHeight}
      minHeight={6}
      maxHeight={30}
      onResize={actions.setMetricsHeight}
      invertDelta
      handlePosition="top"
    >
      <box flexDirection="column" paddingLeft={1} paddingRight={1} flexGrow={1}>
        <text
          style={{
            fg: getSectionHeaderColor(store.ui.focusedSection, "metrics"),
          }}
        >
          {`Metrics (${metricCount()})`}
        </text>

        {/* Side-by-side: Metrics list and details */}
        <box flexDirection="row" flexGrow={1}>
          {/* Metrics list - left side */}
          <scrollbox
            width="60%"
            marginRight={1}
            focused={store.ui.focusedSection === "metrics"}
          >
            <MetricsView
              metrics={store.metrics}
              selectedMetricName={store.ui.selectedMetricName}
            />
          </scrollbox>

          {/* Metric Details - right side */}
          <scrollbox
            width="40%"
            paddingLeft={1}
            style={{
              rootOptions: {
                border: ["left"],
                borderColor: theme.bgSelected,
              },
            }}
          >
            <Show
              when={store.ui.selectedMetricName !== null}
              fallback={
                <text style={{ fg: theme.muted }}>
                  {`Select a metric\nwith j/k`}
                </text>
              }
            >
              <MetricDetailsPanel
                metrics={store.metrics}
                metricName={store.ui.selectedMetricName}
              />
            </Show>
          </scrollbox>
        </box>
      </box>
    </ResizableBox>
  );
}
