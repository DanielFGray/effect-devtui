/**
 * Command Registry for Command Palette
 * Defines all available commands and their handlers
 */

export interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string; // Display string for keyboard shortcut
  execute: () => void;
  category?: string; // For future grouping
}

/**
 * Get all available commands
 * Actions are passed in from the store to avoid circular dependencies
 */
export function getCommands(actions: {
  expandAllSpans: () => void;
  collapseAllSpans: () => void;
  clearSpans: () => void;
  clearMetrics: () => void;
  toggleHelp: () => void;
  setFocusedSection: (section: "clients" | "spans" | "metrics") => void;
}): Command[] {
  return [
    {
      id: "expand-all",
      label: "Expand All Spans",
      description: "Expand all collapsed spans in the tree view",
      category: "view",
      execute: actions.expandAllSpans,
    },
    {
      id: "collapse-all",
      label: "Collapse All Spans",
      description: "Collapse all expanded spans in the tree view",
      category: "view",
      execute: actions.collapseAllSpans,
    },
    {
      id: "clear-spans",
      label: "Clear Spans",
      description: "Remove all spans from the view",
      shortcut: "c",
      category: "actions",
      execute: actions.clearSpans,
    },
    {
      id: "clear-metrics",
      label: "Clear Metrics",
      description: "Remove all metrics from the view",
      shortcut: "c",
      category: "actions",
      execute: actions.clearMetrics,
    },
    {
      id: "toggle-help",
      label: "Toggle Help",
      description: "Show or hide the help overlay",
      shortcut: "?",
      category: "view",
      execute: actions.toggleHelp,
    },
    {
      id: "focus-clients",
      label: "Focus Clients",
      description: "Switch focus to the clients section",
      shortcut: "Tab",
      category: "navigation",
      execute: () => actions.setFocusedSection("clients"),
    },
    {
      id: "focus-spans",
      label: "Focus Spans",
      description: "Switch focus to the spans section",
      shortcut: "Tab",
      category: "navigation",
      execute: () => actions.setFocusedSection("spans"),
    },
    {
      id: "focus-metrics",
      label: "Focus Metrics",
      description: "Switch focus to the metrics section",
      shortcut: "Tab",
      category: "navigation",
      execute: () => actions.setFocusedSection("metrics"),
    },
  ];
}

/**
 * Filter commands by query (case-insensitive substring match)
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands;

  const lowerQuery = query.toLowerCase();
  return commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(lowerQuery) ||
      cmd.description?.toLowerCase().includes(lowerQuery) ||
      cmd.category?.toLowerCase().includes(lowerQuery),
  );
}
