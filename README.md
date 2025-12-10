# Effect DevTools TUI

A terminal user interface (TUI) for Effect DevTools. View traces, spans, metrics, and inspect your Effect applications directly from your terminal!

Built with [OpenTUI](https://github.com/opentui/opentui) and inspired by the [Effect DevTools VS Code extension](../vscode-extension/), but with a more limited feature set focused on observability rather than debugging.

## Features

- 🔍 **Real-time Span Viewer** - View and navigate span traces with expandable tree structure
- 📊 **Metrics Dashboard** - Monitor counters, gauges, histograms, frequencies, and summaries
- 👥 **Multi-Client Support** - Connect multiple Effect applications simultaneously
- ⌨️ **Keyboard Navigation** - Vim-style navigation (j/k) with intuitive shortcuts
- 🎨 **Split Panel Layout** - Side-by-side view of data and detailed information
- 🚀 **Lightweight** - Runs in any terminal, no GUI required

## Setup

To use Effect DevTools TUI with your Effect project, first install the required dependency:

```bash
pnpm install @effect/experimental
```

Then add the `DevTools` layer to your Effect application:

```ts
import { DevTools } from "@effect/experimental";
import { NodeRuntime, NodeSocket } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const program = Effect.log("Hello!").pipe(
  Effect.delay(2000),
  Effect.withSpan("Hi", { attributes: { foo: "bar" } }),
  Effect.forever,
);

program.pipe(
  Effect.provide(DevTools.layer()),
  NodeRuntime.runMain
);
```

### Custom Server URL

If you need to connect to a different host or port:

```ts
const DevToolsLive = DevTools.layer("ws://your-host:34437");
```

### Docker Setup

When running your Effect app in Docker and connecting to the DevTools TUI on your host machine:

1. Add extra host to your `docker-compose.yml`:

```yaml
services:
  effect-backend:
    extra_hosts:
      - host.docker.internal:host-gateway
```

2. Configure the DevTools layer to use the Docker host:

```ts
const DevToolsLive = DevTools.layer("ws://host.docker.internal:34437");
```

### OpenTelemetry Integration

If you're using `@effect/opentelemetry`, provide the `DevTools` layer **before** your tracing layers to ensure the tracer is patched correctly.

## Comparison with VS Code Extension

This TUI is a lightweight alternative focused on **observability**, not a full replacement for the VS Code extension.

### What's Implemented

- ✅ View Spans/Traces
- ✅ Span Tree Navigation
- ✅ Span Details (IDs, attributes, events)
- ✅ Metrics Viewing
- ✅ Multi-Client Support

### What's NOT Implemented ❌

The TUI does **not** support these VS Code extension features:

| Feature                                | Why Not Available                            |
| -------------------------------------- | -------------------------------------------- |
| **DAP (Debug Adapter Protocol)**       |                                              |
| Fiber Debugging                        | Requires VS Code DAP integration             |
| Breakpoints on Defects                 | Requires VS Code DAP integration             |
| Pause/Resume Fibers                    | Requires VS Code DAP integration             |
| Thread Stopped/Continued Events        | Requires VS Code DAP integration             |
| Context Inspection (during debugging)  | Requires VS Code DAP integration             |
| Stack Frame Navigation                 | Requires VS Code DAP integration             |
| Variable Inspection                    | Requires VS Code DAP integration             |
| **IDE Integration**                    |                                              |
| Layer Hover Provider                   | Requires VS Code Language Server integration |
| Layer Mermaid Diagrams                 | Requires VS Code webview + Mermaid extension |
| Code Navigation (Go to Definition)     | Terminal limitation                          |
| Interactive Webview Tracer             | Requires VS Code webview + React UI          |
| File Reveal/Navigation                 | Terminal limitation (no clickable links)     |
| **Advanced Features**                  |                                              |
| Node.js Instrumentation Injection      | Requires VS Code launch configuration        |
| TypeScript Language Server Integration | VS Code specific                             |


## Related Projects

- [Effect](https://effect.website/) - The Effect TypeScript framework
- [OpenTUI](https://github.com/opentui/opentui) - Terminal UI framework
- [Effect DevTools VS Code Extension](../vscode-extension/) - VS Code version
