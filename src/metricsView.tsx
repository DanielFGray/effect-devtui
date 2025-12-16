/**
 * Metrics View Component
 * Displays metrics (Counters, Gauges, Histograms, etc.) with selection
 */

import { For, Show, createMemo } from "solid-js";
import { theme } from "./theme";

import type { SimpleMetric } from "./store";

/**
 * Format metric value for display
 */
function formatMetricValue(metric: SimpleMetric): string {
  if (typeof metric.value === "number") {
    if (Number.isInteger(metric.value)) {
      return metric.value.toString();
    }
    return metric.value.toFixed(3);
  }
  return String(metric.value);
}

/**
 * Get icon for metric type
 */
function getMetricIcon(type: SimpleMetric["type"]): string {
  switch (type) {
    case "Counter":
      return "#";
    case "Gauge":
      return "~";
    case "Histogram":
      return "|";
    case "Frequency":
      return "%";
    case "Summary":
      return "S";
    default:
      return "?";
  }
}

/**
 * Get color for metric type
 */
function getMetricColor(type: SimpleMetric["type"]): string {
  switch (type) {
    case "Counter":
      return theme.success;
    case "Gauge":
      return theme.primary;
    case "Histogram":
      return theme.warning;
    case "Frequency":
      return theme.secondary;
    case "Summary":
      return theme.error;
    default:
      return theme.text;
  }
}

/**
 * Metrics list view
 */
export function MetricsView(props: {
  metrics: ReadonlyArray<SimpleMetric>;
  selectedMetricName: string | null;
}) {
  return (
    <box flexDirection="column" width="100%">
      <For each={props.metrics}>
        {(metric) => {
          const isSelected = () =>
            props.selectedMetricName !== null &&
            props.selectedMetricName === metric.name;

          const color = () =>
            isSelected() ? theme.bg : getMetricColor(metric.type);
          const bg = () => (isSelected() ? theme.primary : undefined);

          return (
            <text style={{ fg: color(), bg: bg() }}>
              {`${getMetricIcon(metric.type)} ${metric.name}: ${formatMetricValue(metric)}`}
            </text>
          );
        }}
      </For>
    </box>
  );
}

/**
 * Metric details panel
 */
export function MetricDetailsPanel(props: {
  metrics: ReadonlyArray<SimpleMetric>;
  metricName: string | null;
}) {
  const selectedMetric = createMemo(() => {
    if (props.metricName === null) return null;
    const found = props.metrics.find((m) => m.name === props.metricName);
    return found || null;
  });

  return (
    <Show
      when={selectedMetric() !== null}
      fallback={
        <text style={{ fg: theme.muted }}>Select a metric to view details</text>
      }
    >
      {(() => {
        const metric = selectedMetric()!;

        return (
          <box flexDirection="column" width="100%">
            <text style={{ fg: theme.primary }} marginBottom={1}>
              {metric.name}
            </text>

            <text style={{ fg: theme.text }} marginBottom={1}>
              {`Type: ${metric.type}`}
            </text>

            <text style={{ fg: theme.text }} marginBottom={1}>
              {`Value: ${formatMetricValue(metric)}`}
            </text>

            <Show when={Object.keys(metric.tags).length > 0}>
              <text style={{ fg: theme.primary }} marginTop={1}>
                Tags:
              </text>
              <For each={Object.entries(metric.tags)}>
                {([key, value]) => (
                  <text style={{ fg: theme.success }}>{`  ${key}: ${value}`}</text>
                )}
              </For>
            </Show>

            <Show
              when={metric.details && Object.keys(metric.details).length > 0}
            >
              <text style={{ fg: theme.primary }} marginTop={1}>
                Details:
              </text>
              <For each={Object.entries(metric.details || {})}>
                {([key, value]) => (
                  <text style={{ fg: theme.warning }}>
                    {`  ${key}: ${typeof value === "number" ? value.toFixed(3) : value}`}
                  </text>
                )}
              </For>
            </Show>
          </box>
        );
      })()}
    </Show>
  );
}
