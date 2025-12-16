/**
 * StoreReaderService - Effect Service for Read-Only Store Access
 *
 * This provides read-only access to the Solid.js store for MCP tools
 * and other Effect code that needs to query current state.
 *
 * Unlike StoreActionsService (which provides write access), this service
 * only allows reading the current store state.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import type { StoreState } from "./storeTypes";

// =============================================================================
// Service Definition
// =============================================================================

/**
 * Service interface for read-only store access.
 */
export interface StoreReaderService {
  /**
   * Get the current store state snapshot.
   * This returns the raw Solid.js store state.
   */
  readonly getState: Effect.Effect<StoreState>;
}

/**
 * The Context Tag for the StoreReaderService
 */
export class StoreReader extends Context.Tag("effect-tui/StoreReader")<
  StoreReader,
  StoreReaderService
>() {}

// =============================================================================
// Live Implementation
// =============================================================================

/**
 * Creates a Layer that provides StoreReader from a store getter function.
 *
 * The getter is passed from the Solid.js StoreProvider component,
 * allowing Effect code to read the current store state.
 */
export const makeStoreReaderLayer = (
  getStore: () => StoreState,
): Layer.Layer<StoreReader> =>
  Layer.succeed(StoreReader, {
    getState: Effect.sync(getStore),
  });

// =============================================================================
// Mock Implementation (for testing)
// =============================================================================

/**
 * Creates a mock StoreReader layer with the provided initial state.
 * Useful for testing MCP tools in isolation.
 */
export const makeMockStoreReaderLayer = (
  initialState: StoreState,
): Layer.Layer<StoreReader> =>
  Layer.succeed(StoreReader, {
    getState: Effect.succeed(initialState),
  });
