/**
 * Keymap core logic
 *
 * Handles:
 * - Normalizing keymap definitions
 * - Parsing key specifications (e.g., "ctrl+c", "gg")
 * - Matching keys against keymaps
 * - Managing sequence buffers for multi-key sequences
 */

import {
  type KeymapDefinition,
  type NormalizedKeymap,
  type KeyBinding,
  type NormalizedKey,
  type SequenceState,
  type MatchResult,
  isConditionalBinding,
  keyToString,
} from "./types";

/**
 * Default timeout for multi-key sequences (in milliseconds)
 */
export const DEFAULT_SEQUENCE_TIMEOUT = 500;

/**
 * Parse a key specification into its component parts
 * Examples:
 *   "j" -> ["j"]
 *   "gg" -> ["g", "g"]
 *   "ctrl+c" -> ["ctrl+c"]
 *   "ctrl+shift+c" -> ["ctrl+shift+c"]
 *   "gc" -> ["g", "c"]
 *
 * Note: Modifier keys (ctrl, alt, shift, meta) are kept together with the key
 */
export function parseKeySpec(spec: string): string[] {
  // Check if it contains modifiers (supports compound modifiers like ctrl+shift+c)
  const hasModifier = /^((ctrl|alt|shift|meta)\+)+/.test(spec.toLowerCase());

  if (hasModifier) {
    // Modifier combo is a single "key" in the sequence
    return [spec.toLowerCase()];
  }

  // Split into individual characters for sequences like "gg"
  return spec.toLowerCase().split("");
}

/**
 * Check if a key spec represents a sequence (multiple keys)
 */
export function isSequence(spec: string): boolean {
  return parseKeySpec(spec).length > 1;
}

/**
 * Normalize a keymap definition into a consistent internal format
 */
export function normalizeKeymap(
  definition: KeymapDefinition,
): NormalizedKeymap {
  const normalized: NormalizedKeymap = new Map();

  for (const [keySpec, value] of Object.entries(definition)) {
    const binding: KeyBinding = isConditionalBinding(value)
      ? {
          keys: keySpec,
          action: value.action,
          when: value.when,
          description: value.description,
        }
      : {
          keys: keySpec,
          action: value,
        };

    normalized.set(keySpec.toLowerCase(), binding);
  }

  return normalized;
}

/**
 * Create an initial sequence state
 */
export function createSequenceState(): SequenceState {
  return {
    buffer: [],
    startTime: 0,
    timeoutId: null,
  };
}

/**
 * Clear a sequence state (cancel timeout and reset buffer)
 */
export function clearSequence(state: SequenceState): SequenceState {
  if (state.timeoutId !== null) {
    clearTimeout(state.timeoutId);
  }
  return createSequenceState();
}

/**
 * Add a key to the sequence buffer
 */
export function addToSequence(
  state: SequenceState,
  key: string,
  timeout: number,
  onTimeout: () => void,
): SequenceState {
  // Clear existing timeout
  if (state.timeoutId !== null) {
    clearTimeout(state.timeoutId);
  }

  const now = Date.now();
  const newBuffer = [...state.buffer, key];

  // Set new timeout
  const timeoutId = setTimeout(onTimeout, timeout);

  return {
    buffer: newBuffer,
    startTime: state.buffer.length === 0 ? now : state.startTime,
    timeoutId,
  };
}

/**
 * Get the current sequence as a string for matching
 */
export function getSequenceString(state: SequenceState): string {
  return state.buffer.join("");
}

/**
 * Find all keymap entries that could potentially match the current sequence
 */
export function findPotentialMatches(
  keymap: NormalizedKeymap,
  sequencePrefix: string,
): { exact: KeyBinding | null; partial: boolean } {
  let exact: KeyBinding | null = null;
  let partial = false;

  for (const [keySpec, binding] of keymap) {
    if (keySpec === sequencePrefix) {
      // Exact match found
      exact = binding;
    } else if (keySpec.startsWith(sequencePrefix)) {
      // This could be a longer sequence that starts with our prefix
      partial = true;
    }
  }

  return { exact, partial };
}

/**
 * Attempt to match a key against the keymap, considering sequences
 *
 * Returns:
 * - { type: "none" } - No match, sequence cleared
 * - { type: "partial", buffer } - Partial match, waiting for more keys
 * - { type: "match", binding } - Full match found
 */
export function matchKey(
  keymap: NormalizedKeymap,
  key: NormalizedKey,
  sequenceState: SequenceState,
): { result: MatchResult; newSequenceState: SequenceState } {
  const keyStr = keyToString(key);
  const currentSequence = getSequenceString(sequenceState);
  const newSequence = currentSequence + keyStr;

  // Find potential matches for the new sequence
  const { exact, partial } = findPotentialMatches(keymap, newSequence);

  // If we have an exact match
  if (exact) {
    // Check if the binding's condition is met
    if (exact.when && !exact.when()) {
      // Condition not met, treat as no match
      return {
        result: { type: "none" },
        newSequenceState: clearSequence(sequenceState),
      };
    }

    // Check if there are also longer sequences possible
    if (partial) {
      // We have both an exact match and potential longer matches
      // For now, prioritize the exact match (vim behavior varies by command)
      // This could be made configurable later
      return {
        result: { type: "match", binding: exact },
        newSequenceState: clearSequence(sequenceState),
      };
    }

    // Just an exact match, execute it
    return {
      result: { type: "match", binding: exact },
      newSequenceState: clearSequence(sequenceState),
    };
  }

  // If we have potential longer matches, buffer this key
  if (partial) {
    return {
      result: { type: "partial", buffer: [...sequenceState.buffer, keyStr] },
      newSequenceState: {
        ...sequenceState,
        buffer: [...sequenceState.buffer, keyStr],
      },
    };
  }

  // No match at all - check if just this single key matches
  // (in case the previous sequence was a dead end)
  if (sequenceState.buffer.length > 0) {
    const { exact: singleExact } = findPotentialMatches(keymap, keyStr);
    if (singleExact && (!singleExact.when || singleExact.when())) {
      return {
        result: { type: "match", binding: singleExact },
        newSequenceState: clearSequence(sequenceState),
      };
    }

    // Check if single key starts a new sequence
    const { partial: singlePartial } = findPotentialMatches(keymap, keyStr);
    if (singlePartial) {
      return {
        result: { type: "partial", buffer: [keyStr] },
        newSequenceState: {
          buffer: [keyStr],
          startTime: Date.now(),
          timeoutId: null,
        },
      };
    }
  }

  // Nothing matched
  return {
    result: { type: "none" },
    newSequenceState: clearSequence(sequenceState),
  };
}

/**
 * Helper to create a keymap definition with type checking
 */
export function defineKeymap<T extends KeymapDefinition>(definition: T): T {
  return definition;
}
