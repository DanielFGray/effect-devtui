/**
 * Client Dropdown Component
 * Compact dropdown-style selector for clients that can be expanded/collapsed
 */

import { For, Show } from "solid-js";
import { theme } from "./theme";
import type { Client } from "./server";
import { PORT } from "./runtime";

export function ClientDropdown(props: {
  clients: ReadonlyArray<Client>;
  serverStatus: "starting" | "listening" | "connected";
  selectedClientIndex: number;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}) {
  const selectedClient = () => props.clients[props.selectedClientIndex];

  return (
    <box flexDirection="column" width="100%">
      <Show
        when={props.clients.length > 0}
        fallback={
          <text style={{ fg: theme.muted }}>
            No clients connected (port {PORT})
          </text>
        }
      >
        {/* Collapsed view: show only selected client */}
        <Show when={!props.isExpanded}>
          <text style={{ fg: theme.primary }}>
            {`▶ ${selectedClient()?.name || "Unknown"} (${props.clients.length} total)`}
          </text>
        </Show>

        {/* Expanded view: show all clients */}
        <Show when={props.isExpanded}>
          <text style={{ fg: theme.muted }} marginBottom={1}>
            {`▼ Clients (${props.clients.length})`}
          </text>
          <For each={props.clients}>
            {(client, index) => {
              const isSelected = () => index() === props.selectedClientIndex;
              return (
                <text style={{ fg: isSelected() ? theme.primary : theme.success }}>
                  {`  ${isSelected() ? ">" : " "} [${index() + 1}] ${client.name}`}
                </text>
              );
            }}
          </For>
        </Show>
      </Show>
    </box>
  );
}
