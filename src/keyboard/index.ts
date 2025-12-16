/**
 * Keyboard handling module
 *
 * Provides a declarative keymap system with:
 * - Multi-key sequence support (e.g., "gg", "gc")
 * - Modifier key support (e.g., "ctrl+c", "shift+g")
 * - Conditional bindings
 * - Timeout-based sequence handling
 */

// Types
export type {
  KeySpec,
  KeyAction,
  KeyBinding,
  ShorthandBinding,
  ConditionalBinding,
  BindingValue,
  KeymapDefinition,
  NormalizedKeymap,
  NormalizedKey,
  SequenceState,
  UseKeymapOptions,
  MatchResult,
} from "./types";

export { isConditionalBinding, normalizeKey, keyToString } from "./types";

// Keymap utilities
export {
  DEFAULT_SEQUENCE_TIMEOUT,
  parseKeySpec,
  isSequence,
  normalizeKeymap,
  createSequenceState,
  clearSequence,
  addToSequence,
  getSequenceString,
  findPotentialMatches,
  matchKey,
  defineKeymap,
} from "./keymap";

// Hook
export { useKeymap, mergeKeymaps } from "./useKeymap";
