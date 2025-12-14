/**
 * Observability Tab Component
 * Combines clients, spans, and metrics sections into a unified tab view
 */

import { ClientsSection } from "./clientsSection";
import { SpansSection } from "./spansSection";
import { MetricsSection } from "./metricsSection";

/**
 * Observability tab - main view for monitoring Effect applications
 * Layout: Clients dropdown at top, spans in middle, metrics at bottom
 */
export function ObservabilityTab() {
  return (
    <>
      {/* Clients Section - Compact dropdown */}
      <ClientsSection />

      {/* Separator */}
      <box
        height={1}
        flexShrink={0}
        border={["bottom"]}
        borderColor="#30363D"
      />

      {/* Spans Section - fills remaining space above metrics */}
      <SpansSection />

      {/* Metrics Section - Resizable with drag handle at top */}
      <MetricsSection />
    </>
  );
}
