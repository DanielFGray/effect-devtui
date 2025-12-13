# Effect Dev TUI - Feature Ideas

This document contains planned features that leverage existing capabilities from the Effect DevTools ecosystem without requiring editor integration.

## Quick Wins (High Value, Low Effort)

### 1. Span Duration Statistics

**Effort**: Low  
**Value**: High

Display aggregated statistics for spans with the same name:

- Min/Avg/Max/P95 duration
- Total count
- Success/failure rates

**Implementation**: Add aggregation logic to store that groups spans by name and calculates statistics. Display in span details panel or new dedicated stats section.

**Why**: Provides immediate performance analysis insights using data already collected.

---

### 2. Span Count by Status

**Effort**: Low  
**Value**: Medium

Show count of running vs ended spans in the header/status bar.

**Implementation**: Add computed properties that count spans by status, display in header next to total count.

**Why**: Quick visual indicator of active work and system state.

---

### 3. Export/Save Snapshot

**Effort**: Low  
**Value**: High

Add command to save current spans/metrics to JSON file for later analysis.

**Implementation**: Add command (e.g., `s` key) that writes `store.spans` and `store.metrics` to timestamped JSON file.

**Why**: Essential for debugging, sharing with team, comparing system states, or post-mortem analysis.

---

### 4. Metric History with ASCII Sparklines

**Effort**: Medium  
**Value**: High

Keep last N values for each metric and display trend as ASCII sparkline (e.g., `▁▂▃▅▇`).

**Implementation**:

- Add ring buffer to store for each metric (configurable size, default 20-50 samples)
- Render sparkline in metric details using Unicode block characters
- Show trend direction indicator (↑↓→)

**Why**: Metrics are currently static snapshots. Seeing trends helps identify patterns, regressions, and anomalies.

---

## Medium Effort Features

### 5. Span Filter by Attributes

**Effort**: Medium  
**Value**: Medium

Extend current span filter to search within span attributes, not just name.

**Implementation**: Modify filter logic in `spanTree.tsx` to include attribute key/value pairs in search. Syntax could be `name:value` or just search all.

**Why**: Many important details are in attributes. Current name-only filter is limiting.

---

### 6. Trace ID Grouping/Filtering

**Effort**: Medium  
**Value**: Medium-High

Filter or group spans by trace ID to focus on a single request flow.

**Implementation**:

- Add trace ID selector (similar to client dropdown)
- Filter span tree to only show spans matching selected trace
- Show trace count in header

**Why**: When multiple concurrent traces are active, helps isolate and follow a single request flow.

---

### 7. Metric Comparison Mode

**Effort**: Medium  
**Value**: Medium

Select two metrics and display side-by-side comparison or diff.

**Implementation**:

- Add multi-select state for metrics (Shift+Enter to add to comparison)
- Split metric details panel to show both
- Highlight differences in values/trends

**Why**: Useful for comparing related metrics (e.g., request count vs error count, before/after deployment).

---

## Easy Convenience Features

### 8. Span Tree Collapse All/Expand All

**Effort**: Low  
**Value**: Low-Medium

Add hotkeys to collapse or expand the entire span tree at once.

**Implementation**:

- `E` key: expand all (add all span IDs to `expandedSpanIds`)
- `C` key: collapse all (clear `expandedSpanIds`, or only keep root level)

**Why**: Navigation convenience when dealing with large span trees.

---

### 9. Metrics Poll Interval Control

**Effort**: Low  
**Value**: Low

Add hotkeys to increase/decrease metrics polling interval dynamically.

**Implementation**:

- `+`/`-` keys (when metrics focused) to adjust interval
- Display current interval in status bar
- Persist preference

**Why**: VS Code extension has this as config. Allows users to balance between freshness and performance.

---

### 10. Span Event Timeline

**Effort**: Low  
**Value**: Medium

Display span events inline in the span tree or details panel with relative timestamps.

**Implementation**:

- Enhance `SpanDetailsPanel` to show `span.events` array
- Display event name, relative time from span start, and attributes

**Why**: Events are already collected but not prominently displayed. VS Code extension shows them in tree nodes.

---

## Future Ideas (Require More Design)

### 11. Histogram Visualization

Display histogram buckets visually as ASCII bar chart in metric details.

### 12. Span Search History

Keep history of recent span filter queries for quick re-application.

### 13. Metric Alerts/Thresholds

Visual indicators when metrics exceed configured thresholds.

### 14. Client-Specific Views

Save layout/filter preferences per client.

### 15. Span Timeline View

Waterfall/flamegraph-style visualization of span relationships (inspired by VS Code's TraceViewer component).

---

## Implementation Priority

**Phase 1** (Quick wins for immediate value):

1. Span Duration Statistics
2. Export/Save Snapshot
3. Span Count by Status

**Phase 2** (Enhanced observability): 4. Metric History with Sparklines 5. Span Filter by Attributes 6. Span Event Timeline

**Phase 3** (Advanced features): 7. Trace ID Grouping 8. Metric Comparison Mode 9. Remaining convenience features

---

## Advanced TypeScript/AST-Powered Features (Standalone TUI)

These features extend the existing fixer experiment by leveraging the TypeScript Compiler API and Recast for advanced static analysis and code transformation. All work without editor integration.

### 16. Dependency Graph Viewer (ASCII)

**Effort**: Medium  
**Value**: High

Build and visualize a project-wide service dependency graph using ASCII art:

```
┌─────────────────┐
│  HttpClient     │
└────────┬────────┘
         │ requires
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│ Config │ │ Logger │
└────────┘ └────────┘
```

**Implementation**:

- Extend `layerResolverCore.ts` to build a full project-wide layer/service index
- Use `recast` + box-drawing characters to render tree/graph visualization
- Toggle with hotkey (e.g., `g` in Fix tab) to switch between list and graph view
- Highlight circular dependencies in red/bold
- Show "orphaned" layers (defined but never provided)

**Why**: Complements the current fixer (which handles individual missing requirements) with a holistic view of the entire Effect architecture. Makes it easier to understand and refactor complex layer compositions.

---

### 17. Effect Health Check / Linter

**Effort**: Medium  
**Value**: High

Dedicated "Health" or "Lint" tab that runs a suite of static checks:

- Unused layers (defined but never provided anywhere)
- Unhandled errors (Effects with `never` error type that could still fail at runtime)
- Missing `Effect.provide` wraps on `Effect.run*` calls
- Inconsistent layer naming (e.g., `ConfigLayer` vs `ConfigLive` inconsistencies)
- Potential schema validation gaps (if Effect Schema is used)
- Services provided multiple times (conflicting layer compositions)

**Implementation**:

- Create `healthCheck.ts` module that runs multiple validator functions
- Each validator returns structured results with file:line references
- Display as a scrollable checklist in a dedicated UI panel
- Each item has metadata: file, line, severity (error/warn/info), suggestion

**Why**: Proactive quality checks prevent runtime errors and enforce architecture consistency. Particularly valuable for Effect newcomers learning best practices.

---

### 18. Batch Fixer with Preview & Rollback

**Effort**: Medium  
**Value**: High

Extend the current single-file layer fixer to handle bulk operations:

- "Fix All Missing Requirements" command that applies fixes across all affected files
- **Preview mode**: Show all planned changes before applying
  - Display diff-style view of what will be modified
  - User can deselect specific changes before committing
- **Backup & Rollback**:
  - Automatically backup modified files before applying changes
  - Provide quick rollback if changes break the build
- Multi-file status feedback showing progress

**Implementation**:

- Batch `applyLayerFix` calls with transaction-like semantics
- Generate preview data structure before writing files
- Add backup files (`.bak` or version control) before modifications
- Persist rollback info so user can undo if needed

**Why**: Applies your powerful fixer to real-world scenarios where entire projects need layer composition fixes. The preview/rollback reduces risk.

---

### 19. Effect API Usage & Pattern Report

**Effort**: Low  
**Value**: Medium

Scan the codebase and generate a report on Effect API usage patterns:

- **Most used APIs**: `pipe`, `map`, `flatMap`, `gen`, `all`, `race`, etc.
- **Pattern distribution**: Effect-gen vs pipe style prevalence
- **Deprecated API usage**: Flag any outdated Effect patterns (version-aware)
- **Service density**: Average services per Layer, max depth of compositions
- **Error handling patterns**: How many Effects handle errors vs rely on defaults

**Implementation**:

- Extend `layerResolverCore.ts` to add AST visitors for common Effect call patterns
- Parse source files and count pattern occurrences
- Display as a statistics panel or exportable report
- Show trends over time if snapshots are saved/compared

**Why**: Provides visibility into codebase architecture and style. Useful for refactoring efforts, onboarding, and identifying technical debt.

---

### 20. Span → Source File Correlation

**Effort**: Medium  
**Value**: High

Hybrid approach combining runtime observability with static analysis:

- When viewing a span in the Observability tab, the span's **source location** is extracted (if available in tracer attributes)
- Display as `file:line` reference in span details
- **Integration options**:
  - Show the filename and context snippet in the TUI (read-only display)
  - Provide a command that opens the file in `$EDITOR` at that location
  - Alternatively, print file:line references that user can copy into their editor

**Implementation**:

- Track span origins in the tracer (if not already done) via stack trace analysis or instrumentation
- Store `sourceFile` and `sourceLine` in span metadata
- When displaying span details, check for these attributes
- Add command `o` (open) to spawn `$EDITOR` or `code --goto file:line`

**Why**: This is a TUI advantage over static tools: you can correlate runtime behavior with source code without editor integration. Developers can see "this span came from src/handlers/checkout.ts:145" and navigate there.

---

### 21. Effect Schema Analysis & Documentation

**Effort**: Medium  
**Value**: Medium

For projects using Effect Schema, provide analysis and documentation:

- Scan for `Schema.Struct`, `Schema.Literal`, `Schema.decode`, etc.
- Generate a **schema catalog** showing all defined schemas with their fields/types
- Display as tree view with collapsible type definitions
- Validate schema definitions (e.g., warn if schema has no encoder, only decoder)
- Show **schema coverage**: which domain types have schemas defined

**Implementation**:

- Extend AST analysis to recognize Schema patterns
- Parse Schema definitions to extract field names, types, validators
- Display in a dedicated "Schemas" tab or sub-panel of Health check
- Compare schemas across versions if multiple snapshot exports exist

**Why**: Makes schema usage discoverable and enforces best practices. Useful for API documentation and data validation debugging.

---

### 22. Dead Code & Unused Service Detection

**Effort**: Medium  
**Value**: Medium

Extend static analysis to find potentially unused code in an Effect context:

- **Unused layers**: Layers defined but never required or provided anywhere
- **Unused services**: Services defined but never consumed
- **Unreachable branches**: Dead code paths in Effect.if, Effect.match, etc.
- **Orphaned effects**: Effect values constructed but never run or returned
- **Unused span names**: Spans defined but no actual traces contain them (requires runtime data)

**Implementation**:

- Leverage type checker to trace service consumption across the project
- Build a service dependency graph and identify unreachable nodes
- Use AST visitors to find constructed Effects that aren't passed through any runtime call
- Cross-reference with runtime trace data for "unused spans in practice"

**Why**: Helps clean up Effect code and identify incomplete refactorings. The combination of static + runtime analysis reveals both theoretical and practical dead code.

---

## Notes

- All features work without editor integration
- Leverage existing data structures from Effect DevTools
- Follow existing keyboard-driven TUI patterns
- Maintain performance with large datasets (use filtering/pagination)
