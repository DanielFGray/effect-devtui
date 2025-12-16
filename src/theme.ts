/**
 * Centralized Theme System
 *
 * Supports two modes:
 * 1. "system" - Dynamically generated from terminal's ANSI palette
 * 2. "tokyonight" - Static Tokyo Night color scheme (fallback)
 *
 * The theme is reactive and can be updated at runtime when the terminal
 * palette is detected.
 */

import { createSignal } from "solid-js";
import type { TerminalColors } from "@opentui/core";

// =============================================================================
// Theme Types
// =============================================================================

export interface Theme {
  // Primary colors
  primary: string;
  secondary: string;

  // Semantic colors
  success: string;
  warning: string;
  error: string;

  // Text colors
  text: string;
  muted: string;

  // Background colors
  bg: string;
  bgAlt: string;
  bgHighlight: string;
  bgSelected: string;

  // Border colors
  border: string;
  borderFocused: string;
}

// =============================================================================
// Static Themes
// =============================================================================

/** Tokyo Night color scheme - used as fallback */
const tokyoNight: Theme = {
  primary: "#7aa2f7",
  secondary: "#bb9af7",
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
  text: "#c0caf5",
  muted: "#565f89",
  bg: "#1a1b26",
  bgAlt: "#1f2335",
  bgHighlight: "#24283b",
  bgSelected: "#30363D",
  border: "#30363D",
  borderFocused: "#414868",
};

// =============================================================================
// System Theme Generation
// =============================================================================

/**
 * Parse hex color to RGB components
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Convert RGB to hex string
 */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Blend two colors
 */
function blendColors(
  color1: string,
  color2: string,
  weight: number = 0.5,
): string {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  return rgbToHex(
    c1.r * (1 - weight) + c2.r * weight,
    c1.g * (1 - weight) + c2.g * weight,
    c1.b * (1 - weight) + c2.b * weight,
  );
}

/**
 * Lighten or darken a color
 */
function adjustBrightness(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    Math.max(0, Math.min(255, r + amount)),
    Math.max(0, Math.min(255, g + amount)),
    Math.max(0, Math.min(255, b + amount)),
  );
}

/**
 * Determine if a color is "dark" based on luminance
 */
function isDark(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  // Relative luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

/**
 * Generate a theme from the terminal's ANSI color palette.
 *
 * Maps the 16 standard ANSI colors to semantic theme properties:
 * - 0: black, 1: red, 2: green, 3: yellow
 * - 4: blue, 5: magenta, 6: cyan, 7: white
 * - 8-15: bright variants
 */
export function generateSystemTheme(colors: TerminalColors): Theme {
  const palette = colors.palette;
  const bg = colors.defaultBackground ?? palette[0] ?? "#1a1b26";
  const fg = colors.defaultForeground ?? palette[7] ?? "#c0caf5";

  // ANSI color indices
  const black = palette[0] ?? "#000000";
  const red = palette[1] ?? "#ff0000";
  const green = palette[2] ?? "#00ff00";
  const yellow = palette[3] ?? "#ffff00";
  const _blue = palette[4] ?? "#0000ff";
  const magenta = palette[5] ?? "#ff00ff";
  const cyan = palette[6] ?? "#00ffff";
  const _white = palette[7] ?? "#ffffff";

  // Bright variants (8-15)
  const brightBlack = palette[8] ?? adjustBrightness(black, 60);
  // const brightWhite = palette[15] ?? "#ffffff";

  // Determine if we're in a dark or light terminal
  const darkMode = isDark(bg);

  // Generate background variants
  const bgAlt = darkMode ? adjustBrightness(bg, 10) : adjustBrightness(bg, -10);
  const bgHighlight = darkMode
    ? adjustBrightness(bg, 20)
    : adjustBrightness(bg, -20);
  const bgSelected = darkMode
    ? adjustBrightness(bg, 30)
    : adjustBrightness(bg, -30);

  // Generate muted text (blend fg toward bg)
  const muted = blendColors(fg, bg, 0.5);

  // Generate border colors
  const border = darkMode
    ? adjustBrightness(bg, 40)
    : adjustBrightness(bg, -40);
  const borderFocused = darkMode
    ? adjustBrightness(bg, 60)
    : adjustBrightness(bg, -60);

  return {
    // Primary uses cyan (common for terminals)
    primary: cyan,
    // Secondary uses magenta
    secondary: magenta,

    // Semantic colors from ANSI
    success: green,
    warning: yellow,
    error: red,

    // Text
    text: fg,
    muted: brightBlack !== black ? brightBlack : muted,

    // Backgrounds
    bg,
    bgAlt,
    bgHighlight,
    bgSelected,

    // Borders
    border,
    borderFocused,
  };
}

// =============================================================================
// Reactive Theme Store
// =============================================================================

const [currentTheme, setCurrentTheme] = createSignal<Theme>(tokyoNight);
const [themeName, setThemeName] = createSignal<"system" | "tokyonight">(
  "tokyonight",
);

/**
 * The current active theme. This is reactive and will update when
 * the terminal palette is detected or the theme is changed.
 */
export const theme = new Proxy({} as Theme, {
  get(_target, prop: keyof Theme) {
    return currentTheme()[prop];
  },
});

/**
 * Get the current theme name
 */
export function getThemeName(): "system" | "tokyonight" {
  return themeName();
}

/**
 * Set the active theme
 */
export function setTheme(name: "system" | "tokyonight", colors?: Theme) {
  setThemeName(name);
  if (name === "tokyonight") {
    setCurrentTheme(tokyoNight);
  } else if (colors) {
    setCurrentTheme(colors);
  }
}

/**
 * Initialize the system theme from terminal colors.
 * Call this after detecting the terminal palette via renderer.getPalette()
 */
export function initSystemTheme(colors: TerminalColors) {
  const systemTheme = generateSystemTheme(colors);
  setCurrentTheme(systemTheme);
  setThemeName("system");
}

/**
 * Get the raw theme object (non-reactive, for passing to functions)
 */
export function getTheme(): Theme {
  return currentTheme();
}

// Export static themes for reference
export const themes = {
  tokyonight: tokyoNight,
} as const;
