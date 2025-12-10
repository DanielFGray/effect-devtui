#!/usr/bin/env node
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { Show, Switch, Match, For, createMemo } from "solid-js";
import * as Option from "effect/Option";
import { PORT } from "./runtime";
import { StoreProvider, useStore, type TabId } from "./store";
import { SpanTreeView, SpanDetailsPanel } from "./spanTree";
import { MetricsView, MetricDetailsPanel } from "./metricsView";
import { ClientsView } from "./clientsView";

/**
 * Effect DevTools TUI - Using Solid.js createStore with Context Provider
 *
 * Key features:
 * - Tab-based navigation (Clients, Tracer, Metrics)
 * - Vim-style keyboard navigation (j/k, Enter, Tab)
 * - Real-time span and metrics display
 *
 * The Effect runtime is started inside StoreProvider.onMount to ensure
 * there's only one store instance shared between the runtime and UI.
 */

/**
 * Tab bar component
 */
function TabBar(props: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  const tabs: { id: TabId; label: string; key: string }[] = [
    { id: "clients", label: "Clients", key: "1" },
    { id: "tracer", label: "Tracer", key: "2" },
    { id: "metrics", label: "Metrics", key: "3" },
  ];

  return (
    <box height={1} width="100%" flexDirection="row" backgroundColor="#24283b">
      {tabs.map((tab) => (
        <text
          style={{
            fg: props.activeTab === tab.id ? "#7aa2f7" : "#565f89",
            bold: props.activeTab === tab.id,
          }}
          paddingLeft={1}
          paddingRight={2}
        >
          {`[${tab.key}] ${tab.label}`}
        </text>
      ))}
    </box>
  );
}

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
      <text style={{ fg: "#7aa2f7", bold: true }} marginBottom={1}>
        Effect DevTools - Keyboard Shortcuts
      </text>
      <text style={{ fg: "#c0caf5" }}>
        {`Navigation:
  [1] [2] [3]  - Switch tabs (Clients/Tracer/Metrics)
  [j] or [↓]   - Move down / Select next client or item
  [k] or [↑]   - Move up / Select previous client or item
  [Enter]      - Expand/collapse span
  [Tab]        - Switch between main and details pane

Clients Tab:
  [j] [k]      - Navigate and select clients
  Selected client's data shown in Tracer and Metrics tabs

General:
  [?] or [h]   - Toggle this help
  [c]          - Clear spans/metrics
  [q]          - Quit application
  [Ctrl+C]     - Exit

Press any key to close...`}
      </text>
    </box>
  );
}

/**
 * Waiting for connections view
 */
function WaitingView(props: { clientCount: number; spanCount: number }) {
  return (
    <box flexDirection="column" padding={2} width="100%">
      <text style={{ fg: "#7aa2f7", bold: true }} marginBottom={1}>
        Effect DevTools TUI
      </text>
      <text style={{ fg: "#c0caf5" }}>
        {`WebSocket Server: Running on port ${PORT}

Clients: ${props.clientCount} | Spans: ${props.spanCount}

Waiting for Effect applications to connect...

To connect your Effect app, add:
  import { DevTools } from "@effect/experimental"
  pipe(Effect.runPromise, DevTools.layer())

Press [?] or [h] for keyboard shortcuts.
Press [q] to quit.`}
      </text>
    </box>
  );
}

function AppContent() {
  const renderer = useRenderer();
  const { store, actions } = useStore();

  // Setup keyboard handlers
  useKeyboard((key) => {
    const fs = require("fs");
    fs.appendFileSync(
      "/tmp/effect-tui.log",
      `${new Date().toISOString()} - Keyboard: key.name="${key.name}", key.raw="${key.raw}"\n`,
    );

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

    // Tab switching with number keys
    if (key.name === "1") {
      actions.setActiveTab("clients");
      return;
    }
    if (key.name === "2") {
      actions.setActiveTab("tracer");
      return;
    }
    if (key.name === "3") {
      actions.setActiveTab("metrics");
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

    // Expand/collapse
    if (key.name === "return" || key.name === "enter" || key.name === "e") {
      actions.toggleExpand();
      return;
    }

    // Pane switching
    if (key.name === "tab") {
      actions.setFocusedPane(
        store.ui.focusedPane === "main" ? "details" : "main",
      );
      return;
    }

    // Clear data
    if (key.name === "c" && !key.ctrl) {
      if (store.ui.activeTab === "tracer") {
        actions.clearSpans();
      } else if (store.ui.activeTab === "metrics") {
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
  const spanCount = createMemo(() => {
    const count = store.spans.length;
    if (count !== 0) {
      const fs = require("fs");
      fs.appendFileSync(
        "/tmp/effect-tui.log",
        `${new Date().toISOString()} - UI: spanCount()=${count} NON-ZERO!\\n`,
      );
    }
    return count;
  });
  const metricCount = createMemo(() => store.metrics.length);

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
        <text style={{ fg: "#7aa2f7", bold: true }}>Effect DevTools TUI</text>
      </box>

      {/* Tab Bar */}
      <TabBar
        activeTab={store.ui.activeTab}
        onTabChange={actions.setActiveTab}
      />

      {/* Main Content */}
      <box flexGrow={1} flexDirection="row" backgroundColor="#1a1b26">
        <Show when={store.ui.showHelp}>
          <HelpOverlay />
        </Show>

        <Show when={!store.ui.showHelp}>
          <Switch>
            {/* Clients Tab */}
            <Match when={store.ui.activeTab === "clients"}>
              <ClientsView
                clients={store.clients}
                serverStatus={store.serverStatus}
                selectedClientIndex={store.ui.selectedClientIndex}
              />
            </Match>

            {/* Tracer Tab */}
            <Match when={store.ui.activeTab === "tracer"}>
              <box flexDirection="row" width="100%" flexGrow={1} padding={1}>
                {/* Span tree */}
                <box
                  flexDirection="column"
                  flexGrow={1}
                  width="70%"
                  borderColor={
                    store.ui.focusedPane === "main" ? "#7aa2f7" : "#565f89"
                  }
                  borderStyle="rounded"
                  marginRight={1}
                >
                  <text style={{ fg: "#7aa2f7" }} padding={[0, 1]}>
                    {`Spans (${spanCount()}) - Active: ${store.activeClient
                      .pipe(Option.map((c) => c.name))
                      .pipe(Option.getOrElse(() => "None"))}`}
                  </text>
                  <box flexDirection="column" flexGrow={1} overflow="scroll">
                    <SpanTreeView
                      spans={store.spans}
                      selectedSpanId={store.ui.selectedSpanId}
                      expandedSpanIds={store.ui.expandedSpanIds}
                    />
                  </box>
                </box>

                {/* Details panel */}
                <box
                  flexDirection="column"
                  width="30%"
                  borderColor={
                    store.ui.focusedPane === "details" ? "#7aa2f7" : "#565f89"
                  }
                  borderStyle="rounded"
                >
                  <text style={{ fg: "#7aa2f7" }} padding={[0, 1]}>
                    Details
                  </text>
                  <box
                    flexDirection="column"
                    flexGrow={1}
                    overflow="scroll"
                    padding={1}
                  >
                    <SpanDetailsPanel
                      spans={store.spans}
                      spanId={store.ui.selectedSpanId}
                    />
                  </box>
                </box>
              </box>
            </Match>

            {/* Metrics Tab */}
            <Match when={store.ui.activeTab === "metrics"}>
              <box flexDirection="row" width="100%" flexGrow={1} padding={1}>
                {/* Metrics list */}
                <box
                  flexDirection="column"
                  flexGrow={1}
                  width="60%"
                  borderColor={
                    store.ui.focusedPane === "main" ? "#7aa2f7" : "#565f89"
                  }
                  borderStyle="rounded"
                  marginRight={1}
                >
                  <text style={{ fg: "#7aa2f7" }} padding={[0, 1]}>
                    {`Metrics (${metricCount()})`}
                  </text>
                  <box flexDirection="column" flexGrow={1} overflow="scroll">
                    <MetricsView
                      metrics={store.metrics}
                      selectedMetricName={store.ui.selectedMetricName}
                    />
                  </box>
                </box>

                {/* Metric details panel */}
                <box
                  flexDirection="column"
                  width="40%"
                  borderColor={
                    store.ui.focusedPane === "details" ? "#7aa2f7" : "#565f89"
                  }
                  borderStyle="rounded"
                >
                  <text style={{ fg: "#7aa2f7" }} padding={[0, 1]}>
                    Metric Details
                  </text>
                  <box
                    flexDirection="column"
                    flexGrow={1}
                    overflow="scroll"
                    padding={1}
                  >
                    <MetricDetailsPanel
                      metrics={store.metrics}
                      metricName={store.ui.selectedMetricName}
                    />
                  </box>
                </box>
              </box>
            </Match>
          </Switch>
        </Show>
      </box>

      {/* Footer/Status Bar */}
      <box height={1} width="100%" backgroundColor="#414868" paddingLeft={1}>
        <text style={{ fg: "#c0caf5" }}>
          {`${statusText()} | Port: ${PORT} | Clients: ${clientCount()} | Spans: ${spanCount()} | Metrics: ${metricCount()} | Tick: ${store.debugCounter} | [?] Help | [q] Quit`}
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
