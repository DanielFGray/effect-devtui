/**
 * Observability Tab Component
 * Combines clients, spans, and metrics sections into a unified tab view
 */

import { ClientsSection } from "./clientsSection";
import { theme } from "./theme";
import { SpansSection } from "./spansSection";
import { MetricsSection } from "./metricsSection";
import { useStore } from "./store";
import { useKeymap } from "./keyboard";

/**
 * Observability tab - main view for monitoring Effect applications
 * Layout: Clients dropdown at top, spans in middle, metrics at bottom
 */
export function ObservabilityTab() {
  const { store, actions } = useStore();

  // Vim-like navigation keybindings for the observability tab
  useKeymap(
    {
      gg: actions.goToFirstSpan,
      "shift+g": actions.goToLastSpan,
    },
    {
      enabled: () =>
        store.ui.activeTab === "observability" &&
        store.ui.focusedSection === "spans" &&
        !store.ui.showCommandPalette &&
        !store.ui.showSpanFilter,
    },
  );

  return (
    <>
      {/* Clients Section - Compact dropdown */}
      <ClientsSection />

      {/* Separator */}
      <box
        height={1}
        flexShrink={0}
        border={["bottom"]}
        borderColor={theme.bgSelected}
      />

      {/* Spans Section - fills remaining space above metrics */}
      <SpansSection />

      {/* Metrics Section - Resizable with drag handle at top */}
      <MetricsSection />
    </>
  );
}
