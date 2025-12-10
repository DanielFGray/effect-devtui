# Effect DevTools TUI - Development Progress

Last updated: 2025-12-10

## 🎉 Completed Features

### 1. Client Management ✅

**Files:** `store.tsx`, `clientsView.tsx`, `index.tsx`

- Multi-client connection support
- Interactive client selection (j/k navigation)
- Visual indicator for selected client (">")
- Active client display in Tracer and Metrics tabs
- Client list shows connection status

**Testing:** Verified with 2 concurrent test clients

### 2. Span Tracer ✅

**Files:** `spanTree.tsx`, `store.tsx`, `runtime.ts`

- Hierarchical span tree visualization
- Expand/collapse with Enter key
- Tree structure with proper indentation (├─, └─)
- Vim-style navigation (j/k)
- Duration display for ended spans
- Color-coded status (running: orange, ended: green)
- Parent-child relationships
- Keeps last 200 spans to prevent memory issues

**Testing:** Tested with nested userWorkflow spans

### 3. Metrics Display ✅

**Files:** `metricsView.tsx`, `store.tsx`, `runtime.ts`

- All 5 Effect metric types supported:
  - Counter (#)
  - Gauge (~)
  - Histogram (|)
  - Frequency (%)
  - Summary (S)
- Real-time updates (500ms polling)
- Metrics details panel with values, tags, and statistics
- Navigate metrics with j/k
- Multi-client metrics aggregation

**Testing:** Verified all metric types with test client

### 4. Span Events ✅

**Files:** `spanTree.tsx`, `store.tsx`, `runtime.ts`

- Display events within spans (from `Effect.log()`)
- Event buffering system (handles events arriving before spans)
- Relative timestamps (+0.57ms from span start)
- Event attributes display (fiberId, logLevel, custom)
- Color-coded events (red) and attributes (gray)
- Shows event count in details panel

**Key Implementation Details:**

```typescript
// Event buffering pattern
if (spanExists) {
  addEventDirectly();
} else {
  bufferEvent(); // Applied later in flushSpans()
}
```

**Testing:** Verified with Effect.log() calls in fetchUserData, processUserData, saveToDatabase

### 5. Enhanced Span Details ✅ (Latest Feature!)

**Files:** `spanTree.tsx`, `store.tsx`

- Display full Trace ID and Span ID (not truncated)
- Better attribute formatting with counts
- Improved layout with section headers
- Event count displayed in header
- Shows parent span information
- Hierarchical organization of span metadata

**Testing:** Verified with various span types and attribute combinations

## 📋 Current Architecture

### Store Pattern

- Solid.js `createStore` with Context Provider
- Global actions reference for Effect runtime
- Batched updates with 100ms flush interval
- Event buffering for race conditions

### Runtime Pattern

- Effect WebSocket server on port 34437
- Concurrent client handling (unbounded concurrency)
- Subscribes to ALL clients (not just active)
- 500ms metrics polling per client

### Component Structure

```
App (StoreProvider)
├── TabBar (Clients/Tracer/Metrics)
├── ClientsView
│   └── Client list with selection
├── SpanTreeView + SpanDetailsPanel
│   ├── Hierarchical tree
│   ├── Span details with IDs
│   ├── Attributes
│   └── Events (NEW!)
└── MetricsView + MetricDetailsPanel
    ├── Metric list
    └── Metric details
```

### Testing Methodology (from AGENTS.md)

- **Incremental testing** - Add one feature at a time
- **Tmux sessions** - Session "effect-tui" for isolated testing
- **Never kill session 0** - That's where OpenCode runs
- **Log everything** - `/tmp/effect-tui.log`

## 🎯 Next Features to Implement

### Priority 1: Enhanced Span Details Panel ⭐️ RECOMMENDED NEXT

**Effort:** 30 minutes  
**Value:** High  
**Why:** Users need full IDs for searching/debugging

**Improvements:**

- Show full Trace ID and Span ID (not truncated)
- Better attribute formatting (handle long values, objects, arrays)
- Show attribute count
- Improved layout with sections
- Show event count in header

**Example:**

```
┌─ Span Details ──────────────────┐
│ fetchUserData                   │
│                                 │
│ IDs:                            │
│   Span:  a659abb3-4d2e-...      │
│   Trace: e83f4892-1c3a-...      │
│                                 │
│ Status: ended (0.989ms)         │
│ Parent: 829e5201-...            │
│                                 │
│ Events: 1                       │
│  +0.57ms: Fetching user data    │
│                                 │
│ Attributes: 0                   │
└─────────────────────────────────┘
```

### Priority 2: Span Search/Filter ⭐️⭐️

**Effort:** 2-3 hours  
**Value:** Very High  
**Why:** With 200+ spans, finding specific ones is painful

**Implementation:**

- Press `/` to enter search mode
- Filter spans by name, ID, or attribute
- Highlight matching text
- Show match count
- ESC to clear search

**Files to modify:**

- `store.tsx` - Add search state
- `index.tsx` - Add search mode keyboard handler
- `spanTree.tsx` - Filter visible spans

### Priority 3: Trace Grouping ⭐️

**Effort:** 2-3 hours  
**Value:** High  
**Why:** Hard to follow a single request flow when spans are mixed

**Implementation:**

- Group spans by trace ID
- Show trace as top-level item
- All spans in trace grouped together
- Toggle between "flat" and "grouped" view

### Priority 4: Metrics History/Trends

**Effort:** 3-4 hours  
**Value:** Medium-High  
**Why:** Can't see metric trends over time

**Implementation:**

- Store last N metric snapshots
- Calculate min/max/avg
- Show sparkline charts (using unicode chars)
- Reset history with 'c' key

### Priority 5: Reset/Clear Commands

**Effort:** 15 minutes  
**Value:** Medium  
**Why:** Currently 'c' clears everything, need granular control

**Implementation:**

- `c` in Tracer tab - clear spans only
- `c` in Metrics tab - clear metrics only
- `C` (shift+c) - clear everything
- Add confirmation prompt

### Priority 6: Export Spans/Metrics

**Effort:** 1-2 hours  
**Value:** Medium  
**Why:** Useful for sharing debugging sessions

**Implementation:**

- Press `e` to export current view
- Save to JSON file with timestamp
- Export spans, metrics, or both
- Include client info and session metadata

### Priority 7: Color-coded Span Status

**Effort:** 1 hour  
**Value:** Medium  
**Why:** Visual scanning for issues

**Implementation:**

- Red for failed/error spans
- Yellow for slow spans (>1s)
- Green for normal spans
- Gray for cancelled spans

### Priority 8: Span Statistics Summary

**Effort:** 2 hours  
**Value:** Medium  
**Why:** Quick health check

**Implementation:**

- Show in header: avg duration, error rate, total spans
- Update in real-time
- Color-code based on thresholds

## 🚫 Not Feasible for TUI

These require VSCode/IDE integration:

- **Debug Fibers** (DebugFibersProvider.ts) - Requires debug adapter
- **Debug Span Stack** (DebugSpanStackProvider.ts) - Requires debug adapter
- **Debug Breakpoints** (DebugBreakpointsProvider.ts) - Requires debug adapter
- **Layer Mermaid Diagrams** (LayerHoverProvider.ts) - Requires TypeScript LSP
- **React Tracer Webview** (TracerProvider.ts) - Requires HTML rendering

## 📊 Feature Comparison Matrix

| Feature               | Effort | Value     | Status  | Priority |
| --------------------- | ------ | --------- | ------- | -------- |
| Client Management     | Low    | High      | ✅ Done | -        |
| Span Tracer           | Medium | Very High | ✅ Done | -        |
| Metrics Display       | Medium | High      | ✅ Done | -        |
| Span Events           | Medium | High      | ✅ Done | -        |
| Enhanced Span Details | Low    | High      | ✅ Done | -        |
| Span Search/Filter    | Medium | Very High | 🔲 Next | 1        |
| Trace Grouping        | Medium | High      | 🔲 TODO | 3        |
| Metrics History       | High   | Medium    | 🔲 TODO | 4        |
| Reset Commands        | Low    | Medium    | 🔲 TODO | 5        |
| Export Data           | Medium | Medium    | 🔲 TODO | 6        |
| Color-coded Status    | Low    | Medium    | 🔲 TODO | 7        |
| Span Statistics       | Medium | Medium    | 🔲 TODO | 8        |

## 🔧 Technical Debt & Known Issues

### TypeScript Errors (Non-blocking)

- `bold` property not in OpenTUI types (cosmetic)
- `bigint` vs `number | string` type mismatches (cosmetic)
- `padding` array type issues (cosmetic)

These don't affect runtime functionality.

### Performance Considerations

- **Span limit:** Currently 200 spans max (prevents memory issues)
- **Flush interval:** 100ms for spans, 500ms for metrics
- **Event buffering:** Unbounded buffer size (could be issue with high event volume)

### Future Improvements

- [ ] Make span limit configurable
- [ ] Add event buffer size limit
- [ ] Add memory usage monitoring
- [ ] Optimize tree rendering for large hierarchies

## 📁 File Structure

```
packages/effect-dev-tui/
├── src/
│   ├── index.tsx           # Main app, tabs, keyboard handling
│   ├── store.tsx           # Solid.js store, actions, data models
│   ├── runtime.ts          # Effect runtime, WebSocket server
│   ├── server.ts           # DevTools server implementation
│   ├── spanTree.tsx        # Span tree + details panel
│   ├── metricsView.tsx     # Metrics list + details panel
│   ├── clientsView.tsx     # Client list view
│   └── AGENTS.md           # Development guidelines
├── test-client.ts          # Test Effect app with spans/metrics
├── package.json
└── PROGRESS.md             # This file!
```

## 🚀 How to Test

### Start TUI

```bash
cd /home/dan/build/my-opentui-project/packages/effect-dev-tui
killall -9 bun 2>/dev/null
rm -f /tmp/effect-tui.log
tmux new-session -d -s effect-tui -n tui "bun run --conditions=browser src/index.tsx"
```

### Start Test Client

```bash
tmux new-window -t effect-tui -n client "bun run test-client.ts"
```

### View TUI

```bash
tmux select-window -t effect-tui:tui
tmux attach -t effect-tui
```

### View Logs

```bash
tail -f /tmp/effect-tui.log
```

### Cleanup

```bash
tmux kill-session -t effect-tui
```

## 🎮 Keyboard Shortcuts

### Navigation

- `1`, `2`, `3` - Switch tabs (Clients/Tracer/Metrics)
- `j` or `↓` - Move down / Select next
- `k` or `↑` - Move up / Select previous
- `Enter` - Expand/collapse span
- `Tab` - Switch between main and details pane

### Clients Tab

- `j`, `k` - Navigate and select clients
- Selected client's data shown in Tracer and Metrics tabs

### Actions

- `c` - Clear spans/metrics (current tab)
- `?` or `h` - Toggle help
- `q` - Quit application
- `Ctrl+C` - Exit

## 💡 Tips for Development

### Use Incremental Testing (AGENTS.md)

1. Start with minimal static content
2. Add ONE feature at a time
3. Test after EACH addition
4. When something breaks, you know exactly what caused it

This saved us when implementing metrics tab (avoided segfault).

### Check Logs for Everything

```bash
grep "SpanEvent" /tmp/effect-tui.log | head -20
grep -E "(addSpanEvent|buffered events)" /tmp/effect-tui.log
```

### Never Kill Session 0

That's where OpenCode runs! Only kill sessions you create:

```bash
tmux kill-session -t effect-tui  # Good
tmux kill-session -t 0           # BAD!
```

### Process Management

```bash
# Clean up safely
killall -9 bun 2>/dev/null
tmux kill-session -t effect-tui 2>/dev/null
```

## 📚 References

- **vscode-extension source:** `/packages/vscode-extension/src/`
  - `SpanProvider.ts` - Span tree implementation
  - `MetricsProvider.ts` - Metrics subscription
  - `ClientsProvider.ts` - Client management
  - `TracerProvider.ts` - React tracer webview
- **OpenTUI docs:** `opentui-source/packages/*/README.md`

- **Effect DevTools:** `@effect/experimental/DevTools`

## 🎯 Next Session Action Items

1. **Implement Span Search/Filter** (2-3 hours)
    - More impactful than other features
    - '/' to search
    - Highlight matches
    - Filter by name, ID, or attribute

Choose based on time available!
