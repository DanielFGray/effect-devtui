/**
 * Clients Section Component
 * Displays connected Effect clients with dropdown selection
 */

import { createMemo } from "solid-js";
import { useStore, type FocusedSection } from "./store";
import { ClientDropdown } from "./clientDropdown";

/**
 * Helper to get section header color based on focus state
 */
function getSectionHeaderColor(
  focusedSection: FocusedSection,
  section: FocusedSection,
): string {
  return focusedSection === section ? "#7aa2f7" : "#565f89";
}

/**
 * Clients section with compact dropdown
 */
export function ClientsSection() {
  const { store, actions } = useStore();

  const clientCount = createMemo(() => store.clients.length);

  return (
    <box
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
      height="auto"
    >
      <text
        style={{
          fg: getSectionHeaderColor(store.ui.focusedSection, "clients"),
        }}
      >
        {`Clients (${clientCount()})`}
      </text>
      <box paddingLeft={2}>
        <ClientDropdown
          clients={store.clients}
          serverStatus={store.serverStatus}
          selectedClientIndex={store.ui.selectedClientIndex}
          isExpanded={store.ui.focusedSection === "clients"}
          onToggleExpanded={actions.toggleClientsExpanded}
        />
      </box>
    </box>
  );
}
