/**
 * Keyboard handling types
 *
 * Provides types for declarative keymap definitions with support for:
 * - Single key bindings (e.g., "j", "k", "?")
 * - Multi-key sequences (e.g., "gg", "gc")
 * - Modifier keys (e.g., "ctrl+c", "shift+g")
 * - Conditional bindings (with `when` predicate)
 */

import type { ParsedKey } from "@opentui/core";

/**
 * A key specification - either a single key or a sequence
 * Examples: "j", "gg", "ctrl+c", "shift+g"
 */
export type KeySpec = string;

/**
 * Action to execute when a key/sequence matches
 */
export type KeyAction = () => void;

/**
 * A single key binding definition
 */
export interface KeyBinding {
  /** The key or sequence (e.g., "j", "gg", "ctrl+c") */
  keys: KeySpec;
  /** Action to execute */
  action: KeyAction;
  /** Optional condition - binding only active when this returns true */
  when?: () => boolean;
  /** Optional description for help/documentation */
  description?: string;
}

/**
 * Shorthand binding: just an action (no conditions)
 */
export type ShorthandBinding = KeyAction;

/**
 * Full binding with conditions
 */
export interface ConditionalBinding {
  action: KeyAction;
  when?: () => boolean;
  description?: string;
}

/**
 * A binding can be shorthand (just action) or full (with conditions)
 */
export type BindingValue = ShorthandBinding | ConditionalBinding;

/**
 * Keymap definition object - maps key specs to bindings
 * Example:
 * ```
 * {
 *   "j": actions.navigateDown,
 *   "k": actions.navigateUp,
 *   "gg": actions.goToTop,
 *   "c": { action: actions.clear, when: () => focused === "spans" },
 * }
 * ```
 */
export type KeymapDefinition = Record<KeySpec, BindingValue>;

/**
 * Normalized keymap - all bindings in full form
 */
export type NormalizedKeymap = Map<KeySpec, KeyBinding>;

/**
 * Parsed key with normalized name for matching
 */
export interface NormalizedKey {
  /** The key name (lowercase) */
  name: string;
  /** Ctrl modifier */
  ctrl: boolean;
  /** Shift modifier */
  shift: boolean;
  /** Meta/Alt modifier */
  meta: boolean;
}

/**
 * Sequence state for tracking multi-key sequences
 */
export interface SequenceState {
  /** Keys pressed so far */
  buffer: string[];
  /** Timestamp of first key in sequence */
  startTime: number;
  /** Timeout ID for sequence expiration */
  timeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * Options for useKeymap hook
 */
export interface UseKeymapOptions {
  /** Whether this keymap is currently active (default: true) */
  enabled?: () => boolean;
  /** Timeout for multi-key sequences in ms (default: 500) */
  sequenceTimeout?: number;
  /** Callback when sequence buffer changes (for visual feedback) */
  onSequenceChange?: (buffer: string[]) => void;
}

/**
 * Result of attempting to match a key against a keymap
 */
export type MatchResult =
  | { type: "none" }
  | { type: "partial"; buffer: string[] }
  | { type: "match"; binding: KeyBinding };

/**
 * Helper to check if a binding is a conditional binding (has action property)
 */
export function isConditionalBinding(
  value: BindingValue,
): value is ConditionalBinding {
  return typeof value === "object" && "action" in value;
}

/**
 * Normalize a ParsedKey to our internal format
 */
export function normalizeKey(key: ParsedKey): NormalizedKey {
  return {
    name: key.name?.toLowerCase() ?? "",
    ctrl: key.ctrl ?? false,
    shift: key.shift ?? false,
    meta: key.meta ?? false,
  };
}

/**
 * Convert a NormalizedKey to a string representation for matching
 * Examples: "j", "ctrl+c", "shift+g"
 *
 * Note: The `meta` modifier is output as "alt" for cross-platform consistency.
 * On macOS, Meta is the Cmd key; on Windows/Linux, it's typically the Windows/Super key.
 * Most terminal applications treat Meta/Alt similarly for keyboard shortcuts.
 */
export function keyToString(key: NormalizedKey): string {
  const parts: string[] = [];
  if (key.ctrl) parts.push("ctrl");
  if (key.meta) parts.push("alt");
  if (key.shift) parts.push("shift");
  if (key.name) parts.push(key.name);
  return parts.join("+");
}
