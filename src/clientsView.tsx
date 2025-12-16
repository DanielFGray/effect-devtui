/**
 * Clients View Component
 * Displays connected Effect clients in compact form
 */

import { For, Show } from "solid-js";
import { theme } from "./theme";
import type { Client } from "./server";
import { PORT } from "./runtime";

/**
 * Clients list view with interactive selection
 */
export function ClientsView(props: {
  clients: ReadonlyArray<Client>;
  serverStatus: "starting" | "listening" | "connected";
  selectedClientIndex: number;
}) {
  return (
    <box flexDirection="column" width="100%">
      <Show
        when={props.clients.length > 0}
        fallback={
          <box flexDirection="column">
            <text style={{ fg: theme.muted }}>No clients connected</text>
            <text style={{ fg: theme.muted }} marginTop={1}>
              {`Waiting on port ${PORT}...`}
            </text>
          </box>
        }
      >
        <For each={props.clients}>
          {(client, index) => {
            const isSelected = () => index() === props.selectedClientIndex;
            return (
              <text style={{ fg: isSelected() ? theme.primary : theme.success }}>
                {`${isSelected() ? ">" : " "} [${index() + 1}] ${client.name}`}
              </text>
            );
          }}
        </For>
      </Show>
    </box>
  );
}
