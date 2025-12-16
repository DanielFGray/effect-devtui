/**
 * useKeymap hook
 *
 * A Solid.js hook that provides declarative keymap handling with:
 * - Multi-key sequence support (e.g., "gg")
 * - Conditional bindings
 * - Timeout-based sequence expiration
 * - Optional visual feedback for pending sequences
 */

import { onCleanup } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { ParsedKey } from "@opentui/core";
import {
  type KeymapDefinition,
  type NormalizedKeymap,
  type UseKeymapOptions,
  type SequenceState,
  normalizeKey,
} from "./types";
import {
  normalizeKeymap,
  createSequenceState,
  clearSequence,
  matchKey,
  DEFAULT_SEQUENCE_TIMEOUT,
} from "./keymap";

/**
 * Hook for declarative keymap handling with sequence support
 *
 * @example
 * ```tsx
 * useKeymap({
 *   "j": actions.navigateDown,
 *   "k": actions.navigateUp,
 *   "gg": actions.goToTop,
 *   "shift+g": actions.goToBottom,
 *   "c": {
 *     action: actions.clear,
 *     when: () => store.ui.focusedSection === "spans",
 *   },
 * }, {
 *   enabled: () => store.ui.activeTab === "observability",
 * })
 * ```
 */
export function useKeymap(
  definition: KeymapDefinition,
  options: UseKeymapOptions = {},
): void {
  const {
    enabled = () => true,
    sequenceTimeout = DEFAULT_SEQUENCE_TIMEOUT,
    onSequenceChange,
  } = options;

  // Normalize the keymap once at hook creation
  // Note: In Solid.js, hooks run once per component mount, so the keymap is stable.
  // If you need dynamic keymaps, use conditional bindings with `when` predicates.
  const keymap: NormalizedKeymap = normalizeKeymap(definition);

  // Mutable sequence state (we manage this manually for performance)
  let sequenceState: SequenceState = createSequenceState();

  // Timeout handler - clears sequence state when user doesn't complete a multi-key sequence
  const handleTimeout = () => {
    sequenceState = clearSequence(sequenceState);
    onSequenceChange?.([]);
  };

  // Set up the keyboard handler
  useKeyboard((key: ParsedKey) => {
    // Skip if this keymap is disabled
    if (!enabled()) {
      return;
    }

    const normalizedKey = normalizeKey(key);

    // Skip pure modifier key presses
    if (
      normalizedKey.name === "shift" ||
      normalizedKey.name === "control" ||
      normalizedKey.name === "alt" ||
      normalizedKey.name === "meta"
    ) {
      return;
    }

    // Clear any existing timeout before processing
    if (sequenceState.timeoutId !== null) {
      clearTimeout(sequenceState.timeoutId);
      sequenceState.timeoutId = null;
    }

    // Try to match the key
    const { result, newSequenceState } = matchKey(
      keymap,
      normalizedKey,
      sequenceState,
    );

    // Update sequence state
    sequenceState = newSequenceState;

    switch (result.type) {
      case "match":
        // Execute the action
        onSequenceChange?.([]);
        result.binding.action();
        break;

      case "partial":
        // We're in the middle of a sequence, set up timeout
        sequenceState.timeoutId = setTimeout(handleTimeout, sequenceTimeout);
        onSequenceChange?.(result.buffer);
        break;

      case "none":
        // No match, sequence cleared
        onSequenceChange?.([]);
        break;
    }
  });

  // Clean up timeout on unmount
  onCleanup(() => {
    if (sequenceState.timeoutId !== null) {
      clearTimeout(sequenceState.timeoutId);
    }
  });
}

/**
 * Helper to combine multiple keymaps into one
 * Later keymaps override earlier ones for the same keys
 */
export function mergeKeymaps(...keymaps: KeymapDefinition[]): KeymapDefinition {
  return Object.assign({}, ...keymaps);
}
