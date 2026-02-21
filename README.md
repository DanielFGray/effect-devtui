# Effect DevTools TUI

A terminal user interface (TUI) for Effect DevTools. View traces, spans, metrics, and inspect your Effect applications directly from your terminal!

Built with [OpenTUI][OpenTUI] and inspired by the [Effect DevTools VS Code extension][Effect DevTools VS Code Extension], but with a more limited feature set focused on observability rather than debugging.

<img width="1056" height="864" alt="20251210" src="https://github.com/user-attachments/assets/acc54df6-77fa-4b5c-b189-6ccba2e0bd14" />
<img width="957" height="420" alt="Screenshot_20251212_210250" src="https://github.com/user-attachments/assets/cbc0fe98-b27f-4cf1-bbb9-f677cfedb827" />

## Installation

```bash
# Install as a dev dependency
npm i -d effect-devtui

# Or run directly with npmx
npmx effect-devtui
```

## Features

### Observability
- 🔍 **Real-time Span Viewer** - View and navigate span traces with an expandable tree structure
- 📊 **Metrics Dashboard** - Monitor counters, gauges, histograms, frequencies, and summaries
- 👥 **Multi-Client Support** - Connect multiple Effect applications simultaneously

### Code Analysis & Fixing

- 🔧 **Automatic Layer Fixer** - Detect missing Effect service requirements and auto-generate layer composition code
- 🎯 **Layer Analysis** - Scan codebase for Layer definitions and resolve service dependencies
- 📋 **Dependency Resolution** - Handle transitive dependencies and multiple layer candidates
- ✨ **Code Generation** - Auto-apply fixes directly to source files with AST-aware transformations

### General

- ⌨️ **Keyboard Navigation** - Vim-style navigation (j/k) with intuitive shortcuts
- 🎨 **Split Panel Layout** - Side-by-side view of data and detailed information
- 🚀 **Lightweight** - Runs in any terminal, no GUI required
- 🤖 **MCP Server for Agents** - Exposes read-only observability tools for LLM agents over HTTP

## Setup

To use Effect DevTools TUI with your Effect project, first install the required dependency:

```bash
npm i @effect/experimental
npm i -d effect-devtui
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

program.pipe(Effect.provide(DevTools.layer()), NodeRuntime.runMain);
```

### Custom Server URL

If you need to connect to a different host or port:

```ts
const DevToolsLive = DevTools.layer("ws://your-host:34437");
```

### Docker Setup

When running your Effect app in Docker and connecting to the DevTools TUI on your host machine:

1. Add an extra host to your `docker-compose.yml`:

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

### MCP Server (Agent Access)

`effect-devtui` also starts an MCP server automatically when the TUI starts.

- **Transport**: HTTP
- **Default endpoint**: `http://localhost:34438/mcp`
- **Server name**: `effect-devtools`
- **Access model**: read-only tools over in-memory DevTools state

Available tools:

- `list_spans`
- `get_span`
- `get_active_spans`
- `list_clients`
- `get_metrics`
- `get_span_tree`

This lets coding agents query live observability data (spans/metrics/clients) while you run your Effect app and the DevTools TUI.

#### Client setup examples

Claude Code (recommended via CLI, no JSON editing):

```bash
claude mcp add --transport http effect-devtui http://localhost:34438/mcp
```

OpenCode (`~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "effect-devtools": {
      "type": "remote",
      "url": "http://127.0.0.1:34438/mcp",
      "enabled": true
    }
  }
}
```

## Comparison with VS Code Extension

This TUI complements the VS Code extension by focusing on **observability and code analysis**, while the extension provides debugging capabilities and IDE integration.

## Related Projects

- [Effect](https://effect.website/) - The Effect TypeScript framework
- [OpenTUI](https://github.com/sst/opentui) - Terminal UI framework
- [Effect DevTools VS Code Extension](https://github.com/Effect-TS/vscode-extension/) - VS Code version
