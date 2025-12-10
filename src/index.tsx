#!/usr/bin/env node
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { Show, createMemo } from "solid-js";
import * as Option from "effect/Option";
import { PORT } from "./runtime";
import { StoreProvider, useStore, type FocusedSection } from "./store";
import { SpanTreeView, SpanDetailsPanel } from "./spanTree";
import { MetricsView, MetricDetailsPanel } from "./metricsView";
import { ClientDropdown } from "./clientDropdown";

/**
 * Effect DevTools TUI - Stacked Single-View Layout
 *
 * Key features:
 * - Single vertical stack of all content (no tabs)
 * - Tab key cycles between focusable sections: clients → spans → metrics
 * - j/k or arrow keys navigate within focused section
 * - Real-time span and metrics display
 *
 * The Effect runtime is started inside StoreProvider.onMount to ensure
 * there's only one store instance shared between the runtime and UI.
 */

/**
 * Help overlay component
 */
function HelpOverlay() {
  return (
    <box
      flexDirection="column"
      padding={2}
      width="100%"
      backgroundColor="#1a1b26"
    >
      <text style={{ fg: "#7aa2f7" }} marginBottom={1}>
        Effect DevTools - Keyboard Shortcuts
      </text>
      <text style={{ fg: "#c0caf5" }}>
        {`Navigation:
  [Tab]        - Cycle focus: Clients → Spans → Metrics
  [j] or [↓]   - Navigate down in focused section
  [k] or [↑]   - Navigate up in focused section
  [Enter]      - Expand/collapse span (when Spans focused)

Clients Section:
  Navigate to select active client (filters spans and metrics)

  Spans Section:
    Navigate to select span, press Enter to expand/collapse children
    Selected span details shown in right panel

Metrics Section:
  Navigate to select metric, details shown inline below

General:
  [?] or [h]   - Toggle this help
  [c]          - Clear spans or metrics (depending on focused section)
  [q]          - Quit application
  [Ctrl+C]     - Force exit

Press any key to close...`}
      </text>
    </box>
  );
}

function AppContent() {
  const renderer = useRenderer();
  const { store, actions } = useStore();

  // Setup keyboard handlers
  useKeyboard((key) => {
    // Quit handlers
    if (key.name === "q" && !key.ctrl) {
      renderer.stop();
      process.exit(0);
    }
    if (key.raw === "\u0003") {
      // Ctrl+C
      renderer.stop();
      process.exit(0);
    }

    // Help toggle
    if (key.name === "?" || (key.name === "h" && !key.ctrl)) {
      actions.toggleHelp();
      return;
    }

    // Close help on any other key when help is shown
    if (store.ui.showHelp) {
      actions.toggleHelp();
      return;
    }

    // Section cycling with Tab
    if (key.name === "tab") {
      const sections: FocusedSection[] = ["clients", "spans", "metrics"];
      const currentIdx = sections.indexOf(store.ui.focusedSection);
      const nextIdx = (currentIdx + 1) % sections.length;
      actions.setFocusedSection(sections[nextIdx]);
      return;
    }

    // Vim-style navigation
    if (key.name === "j" || key.name === "down") {
      actions.navigateDown();
      return;
    }
    if (key.name === "k" || key.name === "up") {
      actions.navigateUp();
      return;
    }

    // Expand/collapse (only works in spans section)
    if (key.name === "return" || key.name === "enter" || key.name === "e") {
      actions.toggleExpand();
      return;
    }

    // Clear data
    if (key.name === "c" && !key.ctrl) {
      if (store.ui.focusedSection === "spans") {
        actions.clearSpans();
      } else if (store.ui.focusedSection === "metrics") {
        actions.clearMetrics();
      }
      return;
    }
  });

  const statusText = () => {
    switch (store.serverStatus) {
      case "starting":
        return "Starting";
      case "listening":
        return "Listening";
      case "connected":
        return "Connected";
    }
  };

  const clientCount = createMemo(() => store.clients.length);
  const spanCount = createMemo(() => store.spans.length);
  const metricCount = createMemo(() => store.metrics.length);

  // Helper to show section focus indicator
  const getSectionHeaderColor = (section: FocusedSection) => {
    return store.ui.focusedSection === section ? "#7aa2f7" : "#565f89";
  };

  return (
    <>
      {/* Header */}
      <box
        height={1}
        width="100%"
        backgroundColor="#1f2335"
        paddingLeft={1}
        paddingRight={1}
      >
        <text style={{ fg: "#7aa2f7" }}>Effect DevTools TUI</text>
      </box>

      {/* Main Content - Stacked Vertical Layout */}
      <box flexGrow={1} flexDirection="column" backgroundColor="#1a1b26">
        <Show when={store.ui.showHelp}>
          <HelpOverlay />
        </Show>

        <Show when={!store.ui.showHelp}>
          {/* Clients Section - Compact dropdown */}
          <box
            flexDirection="column"
            padding={1}
            paddingBottom={0}
            height="auto"
          >
            <text
              style={{ fg: getSectionHeaderColor("clients") }}
              marginBottom={1}
            >
              {`Clients (${clientCount()})`}
            </text>
            <box paddingLeft={1}>
              <ClientDropdown
                clients={store.clients}
                serverStatus={store.serverStatus}
                selectedClientIndex={store.ui.selectedClientIndex}
                isExpanded={store.ui.focusedSection === "clients"}
                onToggleExpanded={actions.toggleClientsExpanded}
              />
            </box>
          </box>

          {/* Separator */}
          <box height={1} border={["bottom"]} borderColor="#30363D" />

          {/* Spans Section - Largest section with side-by-side layout */}
          <box
            flexDirection="column"
            padding={1}
            paddingBottom={0}
            flexGrow={2}
          >
            <text
              style={{ fg: getSectionHeaderColor("spans") }}
              marginBottom={1}
            >
              {`Spans (${spanCount()}) - Active: ${store.activeClient
                .pipe(Option.map((c) => c.name))
                .pipe(Option.getOrElse(() => "None"))}`}
            </text>

            {/* Side-by-side: Span list and details */}
            <box flexDirection="row" flexGrow={1}>
              {/* Span list - left side */}
              <box
                flexDirection="column"
                width="60%"
                overflow="scroll"
                marginRight={1}
              >
                <SpanTreeView
                  spans={store.spans}
                  selectedSpanId={store.ui.selectedSpanId}
                  expandedSpanIds={store.ui.expandedSpanIds}
                />
              </box>

              {/* Span Details - right side */}
              <box
                flexDirection="column"
                width="40%"
                overflow="scroll"
                paddingLeft={1}
                border={["left"]}
                borderColor="#30363D"
              >
                <Show
                  when={store.ui.selectedSpanId !== null}
                  fallback={
                    <text style={{ fg: "#565f89" }}>
                      {`Select a span with j/k\nPress Enter to expand`}
                    </text>
                  }
                >
                  <SpanDetailsPanel
                    spans={store.spans}
                    spanId={store.ui.selectedSpanId}
                  />
                </Show>
              </box>
            </box>
          </box>

          {/* Separator */}
          <box height={1} border={["bottom"]} borderColor="#30363D" />

          {/* Metrics Section */}
          <box
            flexDirection="column"
            padding={1}
            paddingBottom={0}
            height="20%"
          >
            <text
              style={{ fg: getSectionHeaderColor("metrics") }}
              marginBottom={1}
            >
              {`Metrics (${metricCount()})`}
            </text>

            {/* Side-by-side: Metrics list and details */}
            <box flexDirection="row" flexGrow={1}>
              {/* Metrics list - left side */}
              <box
                flexDirection="column"
                width="60%"
                overflow="scroll"
                marginRight={1}
              >
                <MetricsView
                  metrics={store.metrics}
                  selectedMetricName={store.ui.selectedMetricName}
                />
              </box>

              {/* Metric Details - right side */}
              <box
                flexDirection="column"
                width="40%"
                overflow="scroll"
                paddingLeft={1}
                border={["left"]}
                borderColor="#30363D"
              >
                <Show
                  when={store.ui.selectedMetricName !== null}
                  fallback={
                    <text style={{ fg: "#565f89" }}>
                      {`Select a metric\nwith j/k`}
                    </text>
                  }
                >
                  <MetricDetailsPanel
                    metrics={store.metrics}
                    metricName={store.ui.selectedMetricName}
                  />
                </Show>
              </box>
            </box>
          </box>
        </Show>
      </box>

      {/* Footer/Status Bar */}
      <box height={1} width="100%" backgroundColor="#414868" paddingLeft={1}>
        <text style={{ fg: "#c0caf5" }}>
          {`${statusText()} | Port: ${PORT} | Clients: ${clientCount()} | Spans: ${spanCount()} | Metrics: ${metricCount()} | [Tab] Focus | [?] Help | [q] Quit`}
        </text>
      </box>
    </>
  );
}

function App() {
  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  );
}

// Setup and mount app
render(App);
