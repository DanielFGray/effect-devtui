# Effect DevTools TUI - Agent Development Guide

This document describes how to interact with the effect-dev-tui application using tmux for automated testing and development.

## Development Philosophy: Incremental Testing

**CRITICAL: When implementing new features or debugging crashes, ALWAYS use incremental testing:**

1. **Start with the absolute minimum** - A single static `<text>` element
2. **Add ONE feature at a time** - Dynamic prop, then loop, then style, then logic
3. **Test after EACH addition** - Don't add multiple things before testing
4. **When something breaks, you know exactly what caused it**

### Example Incremental Testing Pattern

```tsx
// Step 1: Static placeholder
<Match when={store.ui.activeTab === "metrics"}>
  <box><text>Test</text></box>
</Match>
// ✓ Works? Continue to step 2

// Step 2: Add dynamic data
<box><text>Count: {metricCount()}</text></box>
// ✓ Works? Continue to step 3

// Step 3: Add structure
<box flexDirection="row">
  <box width="60%"><text>List</text></box>
  <box width="40%"><text>Details</text></box>
</box>
// ✓ Works? Continue to step 4

// Step 4: Add component
<box width="60%">
  <MetricsView metrics={store.metrics} />
</box>
// ✓ Works? Continue to step 5

// Step 5: Add borders/styling one property at a time
borderStyle="rounded"  // Test
borderColor="#7aa2f7"  // Test
overflow="scroll"      // Test
```

**This approach saved hours of debugging by quickly isolating that nested `<Show>` components caused the segfault, not the component logic itself.**

## Critical: Avoiding Bun Process Conflicts

**ALWAYS kill existing bun processes before starting new sessions to prevent multiple runtimes from causing reactivity issues:**

```bash
killall -9 bun 2>/dev/null
sleep 2
```

**Verify no stray processes remain:**

```bash
ps aux | grep "bun.*effect-dev-tui" | grep -v grep
```

Multiple bun processes will cause:

- Store updates going to the wrong instance (old runtime captures actions)
- UI showing "Clients: 0 | Spans: 0" despite spans being received
- Metrics not appearing in the UI
- **Segmentation faults when switching tabs or rendering components**

## Critical: Bun Segfault Debugging Patterns

When encountering Bun segmentation faults (panic with address 0x10):

1. **The issue is almost NEVER in your component logic** - Bun has edge cases with certain JSX patterns
2. **Use incremental testing** to narrow down the exact line causing the crash:
   - Start with static text only
   - Add dynamic props one at a time
   - Add loops/conditionals one at a time
   - Add style objects last
3. **Common causes**:
   - Nested `<Show>` components with complex conditions
   - Certain combinations of borders + overflow + nested boxes
   - NOT the `<For>` loops themselves (they work fine)
   - NOT reactive functions `() =>` (they work fine)
4. **Quick test pattern**:
   ```tsx
   // Replace complex component with placeholder
   <Match when={store.ui.activeTab === "metrics"}>
     <box>
       <text>Test</text>
     </box>{" "}
     {/* Works? */}
   </Match>
   ```
5. **If placeholder works, add back features incrementally** until you find the problematic pattern
6. **Solution is usually simplifying the JSX structure**, not changing the logic

## Setup

### Two-Window Tmux Session Pattern

The recommended setup uses **two tmux windows**: one for the TUI server, one for the test client.

**IMPORTANT: Never kill tmux session 0 - that's where OpenCode runs!**
**CRITICAL: NEVER use `tmux kill-server` - this kills ALL tmux sessions including OpenCode!**

```bash
# Clean up any existing processes first
killall -9 bun 2>/dev/null
tmux kill-session -t effect-tui 2>/dev/null
sleep 2

# Create session with TUI in window 1
tmux new-session -d -s effect-tui -n tui
tmux send-keys -t effect-tui:1 "cd /home/dan/build/my-opentui-project/packages/effect-dev-tui && bun run --conditions=browser src/index.tsx" Enter

# Wait for server to start
sleep 3

# Create test client in window 2
tmux new-window -t effect-tui:2 -n client
tmux send-keys -t effect-tui:2 "cd /home/dan/build/my-opentui-project/packages/effect-dev-tui && bun run test-client.ts" Enter

# Wait for client to connect
sleep 5

# Check status
tmux capture-pane -t effect-tui:1 -p | tail -1
```

Expected output: `Listening | Port: 34437 | Clients: 1 | Spans: X | Metrics: 9 | Tick: X`

## Starting the App

Send a command to the tmux session:

```bash
tmux send-keys -t dev-tui "cd /home/dan/build/my-opentui-project/packages/effect-dev-tui && bun run start 2>&1" Enter
```

Parameters:

- `-t dev-tui`: Target the "dev-tui" session
- `Enter`: Send an Enter key press to execute the command

## Capturing Output

View the current state of the terminal:

```bash
tmux capture-pane -t effect-tui:1 -p
```

View just the status bar (bottom line):

```bash
tmux capture-pane -t effect-tui:1 -p | tail -1
```

View top portion:

```bash
tmux capture-pane -t effect-tui:1 -p | head -20
```

Check for errors (crashes will show panic messages):

```bash
tmux capture-pane -t effect-tui:1 -p -S -100 | grep -E "panic|Error|Segmentation"
```

Parameters:

- `-t effect-tui:1`: Target window 1 (the TUI)
- `-p`: Print to stdout
- `-S -100`: Include scrollback (last 100 lines)

## Sending Keyboard Input

### Tab Navigation

```bash
tmux send-keys -t effect-tui:1 "1"  # Switch to Clients tab
tmux send-keys -t effect-tui:1 "2"  # Switch to Tracer tab
tmux send-keys -t effect-tui:1 "3"  # Switch to Metrics tab
```

### List Navigation (j/k vim-style)

```bash
tmux send-keys -t effect-tui:1 "j"  # Navigate down
tmux send-keys -t effect-tui:1 "k"  # Navigate up
```

### Expand/Collapse

```bash
tmux send-keys -t effect-tui:1 "Enter"  # Toggle expand/collapse on selected span
```

### Help

```bash
tmux send-keys -t effect-tui:1 "?"  # Show help overlay
```

### Special Keys

For special keys, use:

```bash
tmux send-keys -t effect-tui:1 "C-c"  # Ctrl+C (force quit)
tmux send-keys -t effect-tui:1 "q"    # Quit gracefully
tmux send-keys -t effect-tui:1 "Tab"  # Switch focus between panes
```

## Common Workflows

### Test Help Panel Display

```bash
tmux send-keys -t dev-tui "?" && sleep 1 && tmux capture-pane -t dev-tui -p
```

### Close Help and Return to Main View

```bash
tmux send-keys -t dev-tui "space"
```

### Quit the Application

```bash
tmux send-keys -t dev-tui "q"
```

### Clean Exit

```bash
tmux send-keys -t dev-tui "C-c"
```

## Testing Checklist

The following features can be tested interactively:

- [x] Server starts and listens on port 34437
- [x] Terminal UI renders properly
- [x] Keyboard shortcuts work (q, h, ?)
- [x] Help panel toggles on (h) or (?)
- [x] Help panel closes on any key
- [x] Main view shows "Waiting for Effect applications to connect..."
- [x] Status bar displays "Listening" and client count
- [x] Clean exit on [Q]
- [x] Demo Effect spans are logged and visible in console output

## Debugging

View console logs from the application:

```bash
tail -f /tmp/effect-tui.log
```

This shows timestamped UI events logged during execution.

## Cleanup

Kill the tmux session:

```bash
tmux kill-session -t dev-tui
```

## Architecture Notes

The effect-dev-tui uses:

- **Framework**: OpenTUI with @opentui/solid renderer for terminal UI components
- **State Management**: Solid.js createStore for reactive state (NOT atoms!)
- **Runtime**: Bun for TypeScript execution with `--conditions=browser` flag
- **WebSocket**: WebSocket server on port 34437 for Effect DevTools clients
- **Effect Runtime**: Runs separately from Solid.js, communicates via global store actions

### Key Architecture Patterns

**Store Pattern (Critical for Reactivity)**:

- Store created inside `<StoreProvider>` context (src/store.tsx)
- Runtime accesses store via `getGlobalActions()` which is updated when provider mounts
- This enables hot-reload: new store instance → updates globalStoreActions → runtime picks up new reference
- **Runtime MUST start AFTER StoreProvider mounts** (see store.tsx lines 558-568)

**Multi-Client Pattern**:

- Runtime subscribes to ALL clients concurrently (not just active client)
- Uses `Effect.forEach` with `concurrency: "unbounded"` (runtime.ts lines 128-138)
- Pattern from vscode-extension TracerProvider.ts line 118

**Component Rendering Patterns (CRITICAL - Prevents Bun Segfaults)**:

1. **Always use `createMemo` for derived lists**:

   ```tsx
   const visibleNodes = createMemo(() =>
     buildVisibleTree(props.spans, props.expandedSpanIds),
   );
   ```

2. **For loops DON'T need `key` prop** (TypeScript error if you add it):

   ```tsx
   <For each={metrics()}>
     {" "}
     {/* No key needed */}
     {(metric) => <text>{metric.name}</text>}
   </For>
   ```

3. **Use reactive functions for dynamic styles**:

   ```tsx
   {
     (metric) => {
       const color = () => getMetricColor(metric.type); // Reactive
       return <text style={{ fg: color() }}>{metric.name}</text>;
     };
   }
   ```

4. **Avoid unnecessary Show wrappers** - they can cause segfaults when nested

**Correct Pattern (Works)**:

```tsx
<Match when={store.ui.activeTab === "metrics"}>
  <box flexDirection="row">
    <MetricsView metrics={store.metrics} />
  </box>
</Match>
```

**Problematic Pattern (Segfaults)**:

```tsx
<Match when={store.ui.activeTab === "metrics"}>
  <Show when={metricCount() > 0}>
    {" "}
    {/* Nested Show can crash Bun */}
    <box>...</box>
  </Show>
</Match>
```

### File Structure

- `src/index.tsx` - Main UI with tabs, keyboard handlers, layout
- `src/store.tsx` - Solid.js store, actions, StoreProvider context
- `src/runtime.ts` - Effect runtime, server startup, client/span/metrics subscriptions
- `src/server.ts` - WebSocket DevTools server (based on vscode-extension)
- `src/spanTree.tsx` - Span tree component with expand/collapse
- `src/metricsView.tsx` - Metrics list and details components
- `src/clientsView.tsx` - Client list component
- `test-client.ts` - Test Effect app that generates spans and metrics

### Metrics Implementation

**Runtime (runtime.ts)**:

- Subscribes to `client.metrics` queue for each client
- Polls via `client.requestMetrics` every 500ms (Schedule.spaced)
- Calls `actions.updateMetrics(snapshot)` to update store

**Store (store.tsx)**:

- `updateMetrics` action converts `Domain.Metric[]` to `SimpleMetric[]`
- Uses `simplifyMetric()` helper to extract type, value, tags, details
- Supports: Counter, Gauge, Histogram, Frequency, Summary

**UI (metricsView.tsx)**:

- MetricsView: For loop rendering metrics with icons and colors
- MetricDetailsPanel: Shows selected metric's type, value, tags, details
- Uses `createMemo` for selected metric lookup

### Common Pitfalls

1. **Multiple bun processes** - ALWAYS `killall -9 bun` before starting
2. **Runtime starts before Solid mounts** - Use onMount in StoreProvider
3. **Nested Show components** - Can cause Bun segfaults, simplify JSX
4. **Not using createMemo** - Can cause performance issues with For loops
5. **Trying to use `key` prop on For** - TypeScript error, not needed in Solid.js
6. **Accessing store.metrics directly** - Wrap in createMemo for reactivity
