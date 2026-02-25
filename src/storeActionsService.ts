/**
 * StoreActionsService - Effect Service for Store Actions
 *
 * This bridges the Solid.js store with the Effect runtime using
 * proper dependency injection instead of global mutable state.
 */

import { Context, Effect, Layer, Ref } from "effect";
import type {
  StoreActions,
  LayerAnalysisResults,
  AnalysisProgressStep,
} from "./storeTypes";

// =============================================================================
// Service Definition
// =============================================================================

/**
 * The StoreActionsService provides the interface that Effect code uses
 * to interact with the Solid.js store.
 *
 * All methods return Effects so they can be composed properly.
 */
export interface StoreActionsService {
  // Client actions
  readonly setClientsFromHashSet: (clients: unknown) => Effect.Effect<void>;
  readonly setActiveClient: (client: unknown) => Effect.Effect<void>;
  readonly setServerStatus: (
    status: "starting" | "listening" | "connected",
  ) => Effect.Effect<void>;

  // Layer Analysis actions
  readonly setLayerAnalysisStatus: (
    status: "idle" | "analyzing" | "complete" | "error",
  ) => Effect.Effect<void>;
  readonly setLayerAnalysisProgress: (
    step: AnalysisProgressStep | null,
  ) => Effect.Effect<void>;
  readonly setLayerAnalysisResults: (
    results: LayerAnalysisResults | null,
  ) => Effect.Effect<void>;
  readonly setLayerAnalysisError: (error: string | null) => Effect.Effect<void>;
  readonly addAnalysisLog: (log: string) => Effect.Effect<void>;
  readonly getLayerAnalysisResults: () => Effect.Effect<LayerAnalysisResults | null>;
  readonly getLayerSelections: () => Effect.Effect<Map<string, string>>;
}

/**
 * The Context Tag for the StoreActionsService
 */
export const StoreActionsService = Context.GenericTag<StoreActionsService>(
  "effect-tui/StoreActionsService",
);

// =============================================================================
// Live Implementation (wraps real Solid store actions)
// =============================================================================

/**
 * Creates a Layer that provides StoreActionsService from real Solid store actions.
 *
 * This is used in production - the Solid StoreProvider sets up the actions
 * and provides them to the Effect runtime via this layer.
 *
 * The store actions themselves use batch() which ensures Solid can track changes.
 * We call them synchronously from Effect.sync() so they execute on the same tick.
 */
export const makeStoreActionsLayer = (
  actions: StoreActions,
): Layer.Layer<StoreActionsService> =>
  Layer.succeed(StoreActionsService, {
    setClientsFromHashSet: (clients: unknown) =>
      Effect.sync(() => {
        actions.setClientsFromHashSet(clients as any);
      }),
    setActiveClient: (client: unknown) =>
      Effect.sync(() => {
        actions.setActiveClient(client as any);
      }),
    setServerStatus: (status: "starting" | "listening" | "connected") =>
      Effect.sync(() => {
        actions.setServerStatus(status);
      }),

    setLayerAnalysisStatus: (
      status: "idle" | "analyzing" | "complete" | "error",
    ) =>
      Effect.sync(() => {
        actions.setLayerAnalysisStatus(status);
      }),
    setLayerAnalysisProgress: (step: AnalysisProgressStep | null) =>
      Effect.sync(() => {
        actions.setLayerAnalysisProgress(step);
      }),
    setLayerAnalysisResults: (results: LayerAnalysisResults | null) =>
      Effect.sync(() => {
        actions.setLayerAnalysisResults(results);
      }),
    setLayerAnalysisError: (error: string | null) =>
      Effect.sync(() => {
        actions.setLayerAnalysisError(error);
      }),
    addAnalysisLog: (log: string) =>
      Effect.sync(() => {
        actions.addAnalysisLog(log);
      }),
    getLayerAnalysisResults: () =>
      Effect.sync(() => {
        return actions.getLayerAnalysisResults();
      }),
    getLayerSelections: () =>
      Effect.sync(() => {
        return actions.getLayerSelections();
      }),
  } as StoreActionsService);

// =============================================================================
// Mock Implementation (for testing)
// =============================================================================

/**
 * Creates a mock StoreActionsService for testing.
 *
 * Uses Effect Refs to track state changes that can be inspected in tests.
 */
export interface MockStoreActionsState {
  readonly clients: unknown[];
  readonly activeClient: unknown;
  readonly serverStatus: "starting" | "listening" | "connected";
  readonly layerAnalysisStatus: "idle" | "analyzing" | "complete" | "error";
  readonly layerAnalysisProgress: AnalysisProgressStep | null;
  readonly layerAnalysisResults: LayerAnalysisResults | null;
  readonly layerAnalysisError: string | null;
  readonly analysisLogs: string[];
}

export const makeMockStoreActionsLayer = Effect.gen(function* () {
  const stateRef = yield* Ref.make<MockStoreActionsState>({
    clients: [],
    activeClient: null,
    serverStatus: "starting",
    layerAnalysisStatus: "idle",
    layerAnalysisProgress: null,
    layerAnalysisResults: null,
    layerAnalysisError: null,
    analysisLogs: [],
  });

  const service: StoreActionsService = {
    setClientsFromHashSet: (clients: unknown) =>
      Ref.update(stateRef, (s) => ({
        ...s,
        clients: Array.from(clients as any),
      })),
    setActiveClient: (client: unknown) =>
      Ref.update(stateRef, (s) => ({ ...s, activeClient: client })),
    setServerStatus: (status: "starting" | "listening" | "connected") =>
      Ref.update(stateRef, (s) => ({ ...s, serverStatus: status })),

    setLayerAnalysisStatus: (
      status: "idle" | "analyzing" | "complete" | "error",
    ) => Ref.update(stateRef, (s) => ({ ...s, layerAnalysisStatus: status })),
    setLayerAnalysisProgress: (step: AnalysisProgressStep | null) =>
      Ref.update(stateRef, (s) => ({ ...s, layerAnalysisProgress: step })),
    setLayerAnalysisResults: (results: LayerAnalysisResults | null) =>
      Ref.update(stateRef, (s) => ({ ...s, layerAnalysisResults: results })),
    setLayerAnalysisError: (error: string | null) =>
      Ref.update(stateRef, (s) => ({ ...s, layerAnalysisError: error })),
    addAnalysisLog: (log: string) =>
      Ref.update(stateRef, (s) => ({
        ...s,
        analysisLogs: [...s.analysisLogs, log],
      })),
    getLayerAnalysisResults: () =>
      Ref.get(stateRef).pipe(Effect.map((s) => s.layerAnalysisResults)),
    getLayerSelections: () => Effect.succeed(new Map<string, string>()),
  };

  return { service, stateRef };
});

/**
 * Layer that provides the mock service.
 * Returns both the Layer and the stateRef for inspection.
 */
export const MockStoreActionsLayer = Layer.effect(
  StoreActionsService,
  makeMockStoreActionsLayer.pipe(Effect.map(({ service }) => service)),
);
