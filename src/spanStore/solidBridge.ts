/**
 * Solid Bridge
 *
 * Subscribes to SpanStore PubSub events and applies incremental updates
 * to the Solid.js reactive store. This bridges the Effect world (SpanStore)
 * with the Solid.js world (createStore) so the UI stays in sync.
 *
 * Event handling strategy:
 * - SpanAdded / SpanUpdated / SpanEventAdded / SpansRotated: query SpanStore
 *   for the full source span list and replace the Solid store's array.
 *   This is simple and correct; the SpanStore is the source of truth.
 * - MetricsUpdated: query SpanStore snapshot for the source's metrics and
 *   replace the Solid store's metrics array.
 * - ClientsChanged: skipped — client updates come via StoreActionsService.
 *
 * All Solid mutations are wrapped in Effect.sync + batch() for correctness.
 */

import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as PubSub from "effect/PubSub"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import { pipe } from "effect/Function"
import type * as Scope from "effect/Scope"
import { batch } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"
import type { StoreState, SimpleSpan, SimpleMetric } from "../storeTypes"
import type { Client } from "../server"
import { SpanStore } from "./service"
import { type SourceKey, type SpanStoreState, StoreEvent as SE } from "./types"

// =============================================================================
// Helpers
// =============================================================================

/**
 * Determine whether a source should be visible based on the active client.
 * When a client is selected, only that client's numeric source is visible.
 * When no client is selected, only the "server" source is visible.
 */
const isVisibleSource = (
  source: SourceKey,
  activeClient: Option.Option<Client>,
): boolean =>
  pipe(
    activeClient,
    Option.match({
      onNone: () => source === "server",
      onSome: (client) => typeof source === "number" && source === client.id,
    }),
  )

/**
 * Apply a span array update to the correct per-source slot in the Solid store,
 * and also update the visible `spans` array if this source is currently active.
 */
const setSourceSpans = (
  setStore: SetStoreFunction<StoreState>,
  source: SourceKey,
  spans: ReadonlyArray<SimpleSpan>,
  activeClient: Option.Option<Client>,
): void => {
  const mutableSpans = spans as SimpleSpan[]

  if (source === "server") {
    setStore("serverSpans", mutableSpans)
  } else {
    setStore("spansByClient", source as number, mutableSpans)
  }

  if (isVisibleSource(source, activeClient)) {
    setStore("spans", mutableSpans)
  }
}

/**
 * Apply a metrics array update to the correct per-source slot in the Solid store,
 * and also update the visible `metrics` array if this source is currently active.
 */
const setSourceMetrics = (
  setStore: SetStoreFunction<StoreState>,
  source: SourceKey,
  metrics: ReadonlyArray<SimpleMetric>,
  activeClient: Option.Option<Client>,
): void => {
  const mutableMetrics = metrics as SimpleMetric[]

  if (source === "server") {
    setStore("serverMetrics", mutableMetrics)
  } else {
    setStore("metricsByClient", source as number, mutableMetrics)
  }

  if (isVisibleSource(source, activeClient)) {
    setStore("metrics", mutableMetrics)
  }
}

/**
 * Query the SpanStore for all spans of a given source, then update the
 * Solid store's per-source and visible arrays inside a batch.
 */
const syncSpansFromStore = (
  spanStore: { readonly getAllSpans: (source?: SourceKey) => Effect.Effect<ReadonlyArray<SimpleSpan>> },
  setStore: SetStoreFunction<StoreState>,
  source: SourceKey,
  getActiveClient: () => Option.Option<Client>,
): Effect.Effect<void> =>
  pipe(
    spanStore.getAllSpans(source),
    Effect.flatMap((spans) =>
      Effect.sync(() => {
        batch(() => {
          setSourceSpans(setStore, source, spans, getActiveClient())
        })
      }),
    ),
  )

/**
 * Query the SpanStore snapshot for metrics of a given source, then update
 * the Solid store's per-source and visible arrays inside a batch.
 */
const syncMetricsFromStore = (
  spanStore: { readonly snapshot: () => Effect.Effect<SpanStoreState> },
  setStore: SetStoreFunction<StoreState>,
  source: SourceKey,
  getActiveClient: () => Option.Option<Client>,
): Effect.Effect<void> =>
  pipe(
    spanStore.snapshot(),
    Effect.map((state) =>
      pipe(
        HashMap.get(state.metricsBySource, source),
        Option.getOrElse((): ReadonlyArray<SimpleMetric> => []),
      ),
    ),
    Effect.flatMap((metrics) =>
      Effect.sync(() => {
        batch(() => {
          setSourceMetrics(setStore, source, metrics, getActiveClient())
        })
      }),
    ),
  )

// =============================================================================
// Bridge
// =============================================================================

/**
 * Create the Solid bridge: subscribes to SpanStore events and keeps the
 * Solid.js store in sync. Runs forever (until the Scope is closed).
 *
 * @param setStore - Solid.js store setter function
 * @param getActiveClient - Accessor for the currently active client Option
 */
export const createSolidBridge = (
  setStore: SetStoreFunction<StoreState>,
  getActiveClient: () => Option.Option<Client>,
): Effect.Effect<void, never, SpanStore | Scope.Scope> =>
  Effect.gen(function* () {
    const spanStore = yield* SpanStore

    const subscription = yield* PubSub.subscribe(spanStore.events)

    yield* pipe(
      Stream.fromQueue(subscription),
      Stream.runForEach((event) =>
        SE.$match(event, {
          SpanAdded: ({ source }) =>
            syncSpansFromStore(spanStore, setStore, source, getActiveClient),

          SpanUpdated: ({ source }) =>
            syncSpansFromStore(spanStore, setStore, source, getActiveClient),

          SpanEventAdded: ({ source }) =>
            syncSpansFromStore(spanStore, setStore, source, getActiveClient),

          SpansRotated: ({ source }) =>
            syncSpansFromStore(spanStore, setStore, source, getActiveClient),

          MetricsUpdated: ({ source }) =>
            syncMetricsFromStore(spanStore, setStore, source, getActiveClient),

          ClientsChanged: () => Effect.void,
        }),
      ),
    )
  })
