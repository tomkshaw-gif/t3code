// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { DevinSettings, ProviderDriverKind, ThreadId } from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { makeDevinAdapter } from "./DevinAdapter.ts";
import { execScriptSource, writeFakeCli } from "../../testUtils/fakeCli.ts";

const decodeDevinSettings = Schema.decodeSync(DevinSettings);

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

async function makeMockDevinWrapper(extraEnv?: Record<string, string>) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "devin-acp-mock-"));
  return writeFakeCli({
    directory: dir,
    name: "fake-devin",
    env: extraEnv ?? {},
    source: execScriptSource({ scriptPath: mockAgentPath }),
  });
}

const devinAdapterTestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-devin-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const makeTestAdapter = (binaryPath: string, options?: Parameters<typeof makeDevinAdapter>[1]) =>
  makeDevinAdapter(decodeDevinSettings({ binaryPath }), options).pipe(Effect.orDie);

it.layer(devinAdapterTestLayer)("DevinAdapterLive", (it) => {
  it.effect("forwards the native command catalog to onAvailableCommands before any turn", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("devin-commands-thread");
      const wrapperPath = yield* Effect.promise(() =>
        makeMockDevinWrapper({ T3_ACP_ADVERTISE_COMMANDS: "1" }),
      );
      const received = yield* Deferred.make<{
        readonly commands: ReadonlyArray<{ readonly name: string }>;
        readonly cwd: string | undefined;
      }>();
      const adapter = yield* makeTestAdapter(wrapperPath, {
        onAvailableCommands: (commands, cwd) =>
          Deferred.succeed(received, { commands, cwd }).pipe(Effect.asVoid),
      });
      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("devin"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });
      // The catalog publishes during session/new — a timeout here means the
      // adapter dropped the pre-turn event.
      const observed = yield* Deferred.await(received).pipe(
        Effect.timeout("10 seconds"),
        TestClock.withLive,
      );
      assert.equal(observed.cwd, process.cwd());
      assert.deepEqual(
        observed.commands.map((command) => command.name),
        ["goal", "deep-research"],
      );
      yield* adapter.stopSession(threadId);
    }),
  );
});
