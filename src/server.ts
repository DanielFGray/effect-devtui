import * as Domain from "@effect/experimental/DevTools/Domain";
import * as Server from "@effect/experimental/DevTools/Server";
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer";
import * as SocketServer from "@effect/platform/SocketServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HashSet from "effect/HashSet";
import * as Option from "effect/Option";
import * as Hash from "effect/Hash";
import * as Equal from "effect/Equal";
import type { Dequeue } from "effect/Queue";
import type { Scope } from "effect/Scope";
import * as fs from "fs";

const log = (msg: string) => {
  fs.appendFileSync(
    "/tmp/effect-tui.log",
    `${new Date().toISOString()} - ${msg}\n`,
  );
};

/**
 * Represents a connected Effect DevTools client
 */
export interface Client extends Equal.Equal {
  readonly id: number;
  readonly name: string;
  readonly spans: Effect.Effect<
    Dequeue<Domain.Span | Domain.SpanEvent>,
    never,
    Scope
  >;
  readonly metrics: Effect.Effect<
    Dequeue<Domain.MetricsSnapshot>,
    never,
    Scope
  >;
  readonly requestMetrics: Effect.Effect<void>;
}

/**
 * Server context holding all clients and server state
 */
export class ServerContext extends Effect.Tag("effect-tui/ServerContext")<
  ServerContext,
  {
    readonly clients: SubscriptionRef.SubscriptionRef<HashSet.HashSet<Client>>;
    readonly activeClient: SubscriptionRef.SubscriptionRef<
      Option.Option<Client>
    >;
    readonly clientId: Ref.Ref<number>;
  }
>() {
  static readonly Live = Layer.scoped(
    ServerContext,
    Effect.gen(function* () {
      const clients = yield* SubscriptionRef.make(HashSet.empty<Client>());
      const activeClient = yield* SubscriptionRef.make(Option.none<Client>());
      const clientId = yield* Ref.make(1);
      return ServerContext.of({
        clients,
        activeClient,
        clientId,
      });
    }),
  );
}

/**
 * Creates a new client when a DevTools connection is established
 */
const makeClient = (serverClient: Server.Client, name?: string) =>
  Effect.gen(function* () {
    const { activeClient, clientId, clients } = yield* ServerContext;

    log("New DevTools client connected!");

    const spans = yield* Effect.acquireRelease(
      PubSub.sliding<Domain.Span | Domain.SpanEvent>({
        capacity: 100,
      }),
      PubSub.shutdown,
    );
    const metrics = yield* Effect.acquireRelease(
      PubSub.sliding<Domain.MetricsSnapshot>({
        capacity: 2,
      }),
      PubSub.shutdown,
    );
    const id = yield* Ref.getAndUpdate(clientId, (_) => _ + 1);
    const client: Client = {
      id,
      name: name ?? `Client #${id}`,
      spans: PubSub.subscribe(spans),
      metrics: PubSub.subscribe(metrics),
      requestMetrics: serverClient.request({ _tag: "MetricsRequest" }),
      [Equal.symbol](that: Client) {
        return id === that.id;
      },
      [Hash.symbol]() {
        return Hash.number(id);
      },
    };
    yield* Effect.acquireRelease(
      SubscriptionRef.update(clients, HashSet.add(client)),
      () => SubscriptionRef.update(clients, HashSet.remove(client)),
    );
    yield* Effect.acquireRelease(
      SubscriptionRef.update(
        activeClient,
        Option.orElseSome(() => client),
      ),
      () =>
        SubscriptionRef.update(
          activeClient,
          Option.filter((_) => _ !== client),
        ),
    );

    yield* serverClient.queue.take.pipe(
      Effect.flatMap((res) => {
        log(`Received from client: ${res._tag}`);
        switch (res._tag) {
          case "MetricsSnapshot": {
            return metrics.offer(res);
          }
          case "SpanEvent":
          case "Span": {
            return spans.offer(res);
          }
        }
      }),
      Effect.forever,
      Effect.fork,
    );
  }).pipe(Effect.awaitAllChildren, Effect.scoped);

/**
 * Runs the WebSocket DevTools server
 */
export const runServer = (port: number) =>
  Effect.gen(function* () {
    const context = yield* ServerContext;

    log("Starting DevTools server...");

    const run = Server.run((...args) => {
      log(`Server.run callback invoked with ${args.length} args`);
      return makeClient(...args);
    }).pipe(
      Effect.provideServiceEffect(
        SocketServer.SocketServer,
        Effect.tap(NodeSocketServer.makeWebSocket({ port }), () =>
          Effect.sync(() => log(`WebSocket server created on port ${port}`)),
        ),
      ),
      Effect.scoped,
      Effect.interruptible,
      Effect.provideService(ServerContext, context),
      Effect.tapErrorCause((cause) =>
        Effect.sync(() => log(`Server error: ${JSON.stringify(cause)}`)),
      ),
    );

    log("Running server effect...");
    yield* run;
    log("Server effect completed");
  }).pipe(Effect.scoped);

/**
 * DevTools service that manages the WebSocket server and clients
 */
export class DevToolsService extends Effect.Service<DevToolsService>()(
  "effect-tui/DevToolsService",
  {
    scoped: Effect.gen(function* () {
      const { activeClient, clients } = yield* ServerContext;

      return {
        clients,
        activeClient,
        getClientCount: () =>
          Effect.map(SubscriptionRef.get(clients), HashSet.size),
      } as const;
    }),
    dependencies: [ServerContext.Live],
  },
) {}
