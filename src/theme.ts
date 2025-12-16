/**
 * Centralized Theme Definition
 *
 * All colors used in the Effect DevTools TUI are defined here.
 * Based on the Tokyo Night color palette.
 */

export const theme = {
  // Primary colors
  primary: "#7aa2f7", // Blue - primary accent, selections, links
  secondary: "#bb9af7", // Purple - secondary accent, special highlights

  // Semantic colors
  success: "#9ece6a", // Green - success states, ended spans
  warning: "#e0af68", // Orange/Yellow - warnings, running spans
  error: "#f7768e", // Red/Pink - errors, failures

  // Text colors
  text: "#c0caf5", // Light gray/blue - primary text
  muted: "#565f89", // Dark gray - muted/secondary text, placeholders

  // Background colors
  bg: "#1a1b26", // Dark blue - main background
  bgAlt: "#1f2335", // Slightly lighter - alternate background
  bgHighlight: "#24283b", // Highlight background (input fields)
  bgSelected: "#30363D", // Selected item background

  // Border colors
  border: "#30363D", // Default border
  borderFocused: "#414868", // Focused/active border
} as const;

export type Theme = typeof theme;
export type ThemeColor = (typeof theme)[keyof typeof theme];
