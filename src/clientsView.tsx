/**
 * Clients View Component
 * Displays connected Effect clients and server status
 */

import { For, Show } from "solid-js";
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
  const statusColor = () => {
    switch (props.serverStatus) {
      case "starting":
        return "#e0af68"; // Orange
      case "listening":
        return "#7aa2f7"; // Blue
      case "connected":
        return "#9ece6a"; // Green
    }
  };

  const statusIcon = () => {
    switch (props.serverStatus) {
      case "starting":
        return "...";
      case "listening":
        return "o";
      case "connected":
        return "*";
    }
  };

  return (
    <box flexDirection="column" padding={2} width="100%">
      {/* Server Status */}
      <box flexDirection="column" marginBottom={2}>
        <text style={{ fg: "#7aa2f7" }} marginBottom={1}>
          Server Status
        </text>
        <text style={{ fg: statusColor() }}>
          {`[${statusIcon()}] ${props.serverStatus.charAt(0).toUpperCase() + props.serverStatus.slice(1)}`}
        </text>
        <text style={{ fg: "#c0caf5" }} marginTop={1}>
          {`Port: ${PORT}`}
        </text>
        <text style={{ fg: "#c0caf5" }}>
          {`Clients: ${props.clients.length}`}
        </text>
      </box>

      {/* Connected Clients */}
      <box flexDirection="column">
        <text style={{ fg: "#7aa2f7" }} marginBottom={1}>
          Connected Clients
        </text>

        <Show
          when={props.clients.length > 0}
          fallback={
            <box flexDirection="column">
              <text style={{ fg: "#565f89" }}>No clients connected</text>
              <text style={{ fg: "#565f89" }} marginTop={1}>
                {`Waiting for Effect apps on port ${PORT}...`}
              </text>
              <text style={{ fg: "#414868" }} marginTop={2}>
                {`To connect your Effect app, add:\n` +
                  `  import { DevTools } from "@effect/experimental"\n` +
                  `  pipe(Effect.runPromise, DevTools.layer())`}
              </text>
            </box>
          }
        >
          <For each={props.clients}>
            {(client, index) => {
              const isSelected = () => index() === props.selectedClientIndex;
              return (
                <box flexDirection="row" marginBottom={1}>
                  <text style={{ fg: isSelected() ? "#7aa2f7" : "#9ece6a" }}>
                    {`${isSelected() ? ">" : " "} [${index() + 1}] ${client.name}`}
                  </text>
                </box>
              );
            }}
          </For>
        </Show>
      </box>
    </box>
  );
}
