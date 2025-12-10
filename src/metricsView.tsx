/**
 * Metrics View Component
 * Displays metrics (Counters, Gauges, Histograms, etc.) with selection
 */

import { For, Show, createMemo } from "solid-js";

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
      return "#9ece6a";
    case "Gauge":
      return "#7aa2f7";
    case "Histogram":
      return "#e0af68";
    case "Frequency":
      return "#bb9af7";
    case "Summary":
      return "#f7768e";
    default:
      return "#c0caf5";
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
    <box flexDirection="column" width="100%" padding={1}>
      <text style={{ fg: "#7aa2f7" }}>
        Total metrics: {props.metrics.length}
      </text>
      <For each={props.metrics}>
        {(metric) => {
          const isSelected = () =>
            props.selectedMetricName !== null &&
            props.selectedMetricName === metric.name;

          const color = () =>
            isSelected() ? "#1a1b26" : getMetricColor(metric.type);
          const bg = () => (isSelected() ? "#7aa2f7" : undefined);

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
        <text style={{ fg: "#565f89" }}>Select a metric to view details</text>
      }
    >
      {(() => {
        const metric = selectedMetric()!;

        return (
          <box flexDirection="column" width="100%">
            <text style={{ fg: "#7aa2f7" }} marginBottom={1}>
              {metric.name}
            </text>

            <text style={{ fg: "#c0caf5" }} marginBottom={1}>
              {`Type: ${metric.type}`}
            </text>

            <text style={{ fg: "#c0caf5" }} marginBottom={1}>
              {`Value: ${formatMetricValue(metric)}`}
            </text>

            <Show when={Object.keys(metric.tags).length > 0}>
              <text style={{ fg: "#7aa2f7" }} marginTop={1}>
                Tags:
              </text>
              <For each={Object.entries(metric.tags)}>
                {([key, value]) => (
                  <text style={{ fg: "#9ece6a" }}>{`  ${key}: ${value}`}</text>
                )}
              </For>
            </Show>

            <Show
              when={metric.details && Object.keys(metric.details).length > 0}
            >
              <text style={{ fg: "#7aa2f7" }} marginTop={1}>
                Details:
              </text>
              <For each={Object.entries(metric.details || {})}>
                {([key, value]) => (
                  <text style={{ fg: "#e0af68" }}>
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
