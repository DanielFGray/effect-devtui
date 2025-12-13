#!/usr/bin/env node
console.log("[INDEX MODULE] Loading index.tsx");
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { Show, Match, createMemo, onMount, createEffect } from "solid-js";
import * as Option from "effect/Option";
import { PORT, triggerLayerFix } from "./runtime";
import {
  StoreProvider,
  useStore,
  type FocusedSection,
  type ActiveTab,
} from "./store";
import { SpanTreeView, SpanDetailsPanel } from "./spanTree";
import { MetricsView, MetricDetailsPanel } from "./metricsView";
import { ClientDropdown } from "./clientDropdown";
import { ResizableBox } from "./resizableBox";
import { CommandPalette } from "./commandPalette";
import { SpanFilterInput } from "./spanFilterInput";
import { FixTab } from "./fixTab";
import type { ScrollBoxRenderable } from "@opentui/core";

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
      width="100%"
      height="100%"
      backgroundColor="#1a1b26"
    >
      <text style={{ fg: "#7aa2f7" }} paddingLeft={2} paddingTop={1}>
        Effect DevTools - Keyboard Shortcuts
      </text>
      <scrollbox
        flexGrow={1}
        style={{
          rootOptions: { paddingLeft: 2, paddingRight: 2, paddingBottom: 1 },
        }}
        focused
      >
        <text style={{ fg: "#c0caf5" }}>
          {`Navigation:
  [Tab]        - Cycle focus: Clients → Spans → Metrics
  [j/k] or [↓/↑] - Navigate down/up in focused section
  [h/l] or [←/→] - Navigate left/right (collapse/expand spans)
  [Enter]      - Expand/collapse span (when Spans focused)

Clients Section:
  Auto-expands when focused
  Navigate to select active client (filters spans and metrics)

  Spans Section:
    Navigate to select span with arrows or hjkl
    Press l/→ to expand and navigate into children
    Press h/← to collapse and navigate to parent
    Press "/" to open span filter (search by name)
    Selected span details shown in right panel

Metrics Section:
  Navigate to select metric, details shown inline below

General:
  [:]          - Open command palette (search and execute commands)
  [?]          - Toggle this help
  [F12]        - Toggle debug console (shows internal logs)
  [c]          - Clear spans or metrics (depending on focused section)
  [q]          - Quit application
  [Ctrl+C]     - Force exit

Press any key (except arrows/hjkl) to close...`}
        </text>
      </scrollbox>
    </box>
  );
}

function AppContent() {
  const renderer = useRenderer();
  const { store, actions } = useStore();

  // Ref for the spans scrollbox to disable its keyboard handling
  let spansScrollBoxRef: ScrollBoxRenderable | undefined;

  // Disable scrollbox keyboard handling on mount
  onMount(() => {
    if (spansScrollBoxRef) {
      // Access the protected _focusable property to prevent scrollbox from handling keys
      (spansScrollBoxRef as any)._focusable = false;
    }
  });

  // Auto-scroll to keep selected span in view
  createEffect(() => {
    const selectedSpanId = store.ui.selectedSpanId;
    if (!selectedSpanId || !spansScrollBoxRef) return;

    // The span tree is wrapped in a box, so we need to get the children of that box
    const scrollBoxChildren = spansScrollBoxRef.getChildren();
    if (scrollBoxChildren.length === 0) return;

    // Get the actual span text elements (children of the first box)
    const spanElements = scrollBoxChildren[0].getChildren();
    const target = spanElements.find((child) => child.id === selectedSpanId);
    if (!target) return;

    // Calculate relative position
    const y = target.y - spansScrollBoxRef.y;

    // Scroll down if needed
    if (y >= spansScrollBoxRef.height) {
      spansScrollBoxRef.scrollBy(y - spansScrollBoxRef.height + 1);
    }
    // Scroll up if needed
    if (y < 0) {
      spansScrollBoxRef.scrollBy(y);
    }
  });

  // Setup keyboard handlers
  useKeyboard((key) => {
    // Command palette keyboard handling (must be before quit handlers)
    if (store.ui.showCommandPalette) {
      // Close on Esc
      if (key.name === "escape") {
        actions.toggleCommandPalette();
        return;
      }

      // Navigate commands
      if (key.name === "up") {
        actions.navigateCommandUp();
        return;
      }
      if (key.name === "down") {
        actions.navigateCommandDown();
        return;
      }

      // Execute selected command
      if (key.name === "return" || key.name === "enter") {
        actions.executeSelectedCommand();
        return;
      }

      // Type to filter (printable characters, backspace, space)
      if (key.raw && key.raw.length === 1 && !key.ctrl && !key.meta) {
        actions.setCommandPaletteQuery(store.ui.commandPaletteQuery + key.raw);
        return;
      }
      if (key.name === "backspace") {
        actions.setCommandPaletteQuery(
          store.ui.commandPaletteQuery.slice(0, -1),
        );
        return;
      }

      // Prevent other keys from doing anything when palette is open
      return;
    }

    // Span filter keyboard handling (must be before quit handlers)
    if (store.ui.showSpanFilter) {
      if (key.name === "escape") {
        // Cancel: close filter and clear query
        actions.clearSpanFilter();
        actions.toggleSpanFilter();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        // Confirm: close filter but keep query active
        actions.toggleSpanFilter();
        return;
      }

      if (key.name === "backspace") {
        const currentQuery = store.ui.spanFilterQuery;
        if (currentQuery.length > 0) {
          actions.setSpanFilterQuery(currentQuery.slice(0, -1));
        }
        return;
      }

      // Handle printable characters (including 'q')
      if (key.raw && key.raw.length === 1 && !key.ctrl && !key.meta) {
        actions.setSpanFilterQuery(store.ui.spanFilterQuery + key.raw);
        return;
      }

      // Prevent other keys from doing anything when filter is open
      return;
    }

    // Quit handlers (after modal input handlers)
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
    if (key.name === "?") {
      actions.toggleHelp();
      return;
    }

    // Command palette toggle
    if (key.raw === ":" && !key.ctrl && !key.shift) {
      actions.toggleCommandPalette();
      return;
    }

    // Toggle console overlay
    if (key.name === "f12") {
      renderer.console.toggle();
      return;
    }

    // Close help on any key except navigation keys when help is shown
    if (store.ui.showHelp) {
      // Don't close on navigation keys - allow scrolling
      if (
        key.name === "up" ||
        key.name === "down" ||
        key.name === "left" ||
        key.name === "right" ||
        key.name === "h" ||
        key.name === "j" ||
        key.name === "k" ||
        key.name === "l" ||
        key.name === "pageup" ||
        key.name === "pagedown"
      ) {
        // Let navigation keys pass through (no-op, don't close help)
        return;
      }
      // Close help on any other key
      actions.toggleHelp();
      return;
    }

    // Top-level tab switching with number keys
    if (key.raw === "1" || key.raw === "o") {
      actions.setActiveTab("observability");
      return;
    }
    if (key.raw === "2" || key.raw === "f") {
      actions.setActiveTab("fix");
      return;
    }

    // Fix tab specific keyboard handlers
    if (store.ui.activeTab === "fix") {
      // Apply fix (when analysis is complete)
      if (
        key.name === "p" &&
        store.ui.layerAnalysisStatus === "complete" &&
        store.ui.layerAnalysisResults
      ) {
        console.log("[App] Applying layer fix with user selections");
        triggerLayerFix();
        return;
      }

      // Analyze/re-analyze
      if (key.name === "a") {
        actions.startLayerAnalysis();
        return;
      }

      // Navigation within analysis results
      if (
        store.ui.layerAnalysisStatus === "complete" &&
        store.ui.layerAnalysisResults
      ) {
        // Tab or left/right arrows to toggle focus between services and candidates panels
        if (key.name === "tab" || key.name === "left" || key.name === "right") {
          actions.toggleFixTabFocus();
          return;
        }

        const focusedPanel = store.ui.fixTabFocusedPanel;

        // Navigate services (j/k or up/down) - only when services panel is focused
        if (focusedPanel === "services") {
          if (key.name === "j" || key.name === "down") {
            actions.navigateLayerRequirements("down");
            return;
          }
          if (key.name === "k" || key.name === "up") {
            actions.navigateLayerRequirements("up");
            return;
          }
        }

        // Navigate layer candidates (j/k or up/down) - only when candidates panel is focused
        if (focusedPanel === "candidates") {
          if (key.name === "j" || key.name === "down") {
            actions.navigateLayerCandidates("down");
            return;
          }
          if (key.name === "k" || key.name === "up") {
            actions.navigateLayerCandidates("up");
            return;
          }

          // Select layer candidate with Enter - only when candidates panel is focused
          if (key.name === "return" || key.name === "enter") {
            const results = store.ui.layerAnalysisResults;
            const candidates = results?.candidates || [];
            const serviceIndex = store.ui.selectedLayerRequirementIndex;
            const candidateIndex = store.ui.selectedLayerCandidateIndex;

            if (candidates[serviceIndex]) {
              const service = candidates[serviceIndex].service;
              const layers = candidates[serviceIndex].layers;
              if (layers[candidateIndex]) {
                const layerName = layers[candidateIndex].name;
                actions.selectLayerForService(service, layerName);
                console.log(`[App] Selected ${layerName} for ${service}`);
              }
            }
            return;
          }
        }
      }

      // Clear analysis
      if (key.name === "c") {
        actions.clearLayerAnalysis();
        return;
      }

      // Re-analyze
      if (key.name === "r") {
        actions.startLayerAnalysis();
        return;
      }
    }

    // Observability tab: Section cycling with Tab
    if (store.ui.activeTab === "observability" && key.name === "tab") {
      const sections: FocusedSection[] = ["clients", "spans", "metrics"];
      const currentIdx = sections.indexOf(store.ui.focusedSection);
      const nextIdx = (currentIdx + 1) % sections.length;
      actions.setFocusedSection(sections[nextIdx]);
      return;
    }

    // Observability tab: Vim-style navigation (hjkl + arrow keys)
    if (store.ui.activeTab === "observability") {
      if (key.name === "j" || key.name === "down") {
        actions.navigateDown();
        return;
      }
      if (key.name === "k" || key.name === "up") {
        actions.navigateUp();
        return;
      }
      if (key.name === "h" || key.name === "left") {
        actions.navigateLeft();
        return;
      }
      if (key.name === "l" || key.name === "right") {
        actions.navigateRight();
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

      // Span filter toggle with "/" key (only when spans section is focused)
      if (
        key.raw === "/" &&
        !key.ctrl &&
        !key.meta &&
        store.ui.focusedSection === "spans"
      ) {
        actions.toggleSpanFilter();
        return;
      }

      // Clear active span filter with Escape when not in filter input mode
      if (
        key.name === "escape" &&
        store.ui.focusedSection === "spans" &&
        store.ui.spanFilterQuery.length > 0 &&
        !store.ui.showSpanFilter
      ) {
        actions.clearSpanFilter();
        return;
      }
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

      {/* Main Content - Two-Tab Layout */}
      <box flexGrow={1} flexDirection="column" backgroundColor="#1a1b26">
        <Show when={store.ui.showHelp}>
          <HelpOverlay />
        </Show>

        {/* Observability Tab */}
        <Show
          when={store.ui.activeTab === "observability" && !store.ui.showHelp}
        >
          {/* Clients Section - Compact dropdown */}
          <box
            flexDirection="column"
            padding={1}
            paddingBottom={0}
            flexShrink={0}
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
          <box
            height={1}
            flexShrink={0}
            border={["bottom"]}
            borderColor="#30363D"
          />

          {/* Spans Section - Resizable with drag handle */}
          <ResizableBox
            height={store.ui.spansHeight}
            minHeight={10}
            maxHeight={50}
            onResize={actions.setSpansHeight}
          >
            <box
              flexDirection="column"
              padding={1}
              paddingBottom={0}
              flexGrow={1}
            >
              <text
                style={{ fg: getSectionHeaderColor("spans") }}
                marginBottom={1}
              >
                {`Spans (${spanCount()}) - Active: ${store.activeClient
                  .pipe(Option.map((c) => c.name))
                  .pipe(Option.getOrElse(() => "None"))}`}
              </text>

              {/* Span filter input (shown when typing) */}
              <Show when={store.ui.showSpanFilter}>
                <SpanFilterInput />
              </Show>

              {/* Active filter indicator (shown when filter closed but query active) */}
              <Show
                when={
                  !store.ui.showSpanFilter &&
                  store.ui.spanFilterQuery.length > 0
                }
              >
                <box
                  flexDirection="row"
                  width="100%"
                  paddingLeft={1}
                  paddingBottom={1}
                  flexShrink={0}
                >
                  <text style={{ fg: "#f7768e" }}>
                    {`Filter: "${store.ui.spanFilterQuery}" (press / to edit, Esc to clear)`}
                  </text>
                </box>
              </Show>

              {/* Side-by-side: Span list and details */}
              <box flexDirection="row" flexGrow={1}>
                {/* Span list - left side */}
                <scrollbox
                  ref={(r) => (spansScrollBoxRef = r)}
                  width="60%"
                  marginRight={1}
                >
                  <SpanTreeView
                    spans={store.spans}
                    selectedSpanId={store.ui.selectedSpanId}
                    expandedSpanIds={store.ui.expandedSpanIds}
                    filterQuery={store.ui.spanFilterQuery || undefined}
                  />
                </scrollbox>

                {/* Span Details - right side */}
                <scrollbox
                  width="40%"
                  paddingLeft={1}
                  style={{
                    rootOptions: {
                      border: ["left"],
                      borderColor: "#30363D",
                    },
                  }}
                >
                  <Show
                    when={store.ui.selectedSpanId !== null}
                    fallback={
                      <text style={{ fg: "#565f89" }}>
                        {`Select a span with j/k\nPress → to expand or Enter`}
                      </text>
                    }
                  >
                    <SpanDetailsPanel
                      spans={store.spans}
                      spanId={store.ui.selectedSpanId}
                    />
                  </Show>
                </scrollbox>
              </box>
            </box>
          </ResizableBox>

          {/* Metrics Section - fills remaining space */}
          <box
            flexDirection="column"
            padding={1}
            paddingBottom={0}
            flexGrow={1}
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
                    borderColor: "#30363D",
                  },
                }}
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
              </scrollbox>
            </box>
          </box>
        </Show>

        {/* Fix Tab */}
        <Show when={store.ui.activeTab === "fix" && !store.ui.showHelp}>
          <FixTab />
        </Show>
      </box>

      {/* Footer/Status Bar - Context-sensitive */}
      <box height={1} width="100%" backgroundColor="#414868" paddingLeft={1}>
        <Show when={store.ui.activeTab === "observability"}>
          <text style={{ fg: "#c0caf5" }}>
            {`${statusText()} | Port: ${PORT} | Clients: ${clientCount()} | Spans: ${spanCount()} | Metrics: ${metricCount()} | [1/2] Tab | [Tab] Focus | [?] Help | [:] Command | [q] Quit`}
          </text>
        </Show>
        <Show when={store.ui.activeTab === "fix"}>
          <Show
            when={
              store.ui.layerAnalysisStatus === "idle" ||
              store.ui.layerAnalysisStatus === "error" ||
              (store.ui.layerAnalysisStatus === "complete" &&
                store.ui.layerAnalysisResults === null)
            }
          >
            <text style={{ fg: "#c0caf5" }}>
              [a] Analyze | [1/2] Tab | [?] Help | [q] Quit
            </text>
          </Show>
          <Show when={store.ui.layerAnalysisStatus === "analyzing"}>
            <text style={{ fg: "#c0caf5" }}>Analyzing... | [q] Quit</text>
          </Show>
          <Show
            when={
              store.ui.layerAnalysisStatus === "complete" &&
              store.ui.layerAnalysisResults !== null
            }
          >
            <text style={{ fg: "#c0caf5" }}>
              [Tab] Focus | [j/k] Navigate | [Enter] Select | [c] Clear | [r]
              Re-analyze | [1/2] Tab | [?] Help
            </text>
          </Show>
          <Show when={store.ui.layerAnalysisStatus === "applied"}>
            <text style={{ fg: "#c0caf5" }}>
              [a] Re-analyze | [1/2] Tab | [?] Help | [q] Quit
            </text>
          </Show>
        </Show>
      </box>

      {/* Command Palette Overlay */}
      <CommandPalette />
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
render(App, {
  consoleOptions: {
    backgroundColor: "#1a1b26", // Match the main UI background
  },
});
