import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { makeThreadFixture } from "../test-fixtures";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";

const state = vi.hoisted(() => ({
  threads: [] as ReturnType<typeof makeThreadFixture>[],
  visits: {} as Record<string, string>,
  visit: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => void) => effect(),
}));
vi.mock("../state/threads", () => ({ threadEnvironment: { visit: {} } }));
vi.mock("../state/entities", () => ({ useThreadShells: () => state.threads }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.visit }));
vi.mock("../uiStateStore", () => ({
  useUiStateStore: { getState: () => ({ threadLastVisitedAtById: state.visits }) },
}));

const localVisit = "2026-10-03T12:01:00.000Z";
const rewind = "2026-10-03T11:59:59.999Z";
async function loadMigration() {
  return (await import("./useThreadVisitedMigration")).useThreadVisitedMigration;
}
async function finishCommand() {
  await state.visit.mock.results.at(-1)?.value;
}
beforeEach(() => {
  vi.resetModules();
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    },
  });
  state.threads = [makeThreadFixture({ lastVisitedAt: null })];
  state.visits = {
    [scopedThreadKey(scopeThreadRef(state.threads[0]!.environmentId, state.threads[0]!.id))]:
      localVisit,
  };
  state.visit.mockReset().mockResolvedValue({ _tag: "Success" });
});
afterEach(() => vi.unstubAllGlobals());

describe("visited watermark migration", () => {
  it("never overwrites Mark unread after a successful migration and page reload", async () => {
    (await loadMigration())();
    await finishCommand();
    expect(state.visit).toHaveBeenCalledOnce();
    state.visits = Object.fromEntries(
      Object.keys(state.visits).map((key) => [key, "2026-10-03T13:00:00.000Z"]),
    );
    state.threads[0] = { ...state.threads[0]!, lastVisitedAt: rewind };
    vi.resetModules();
    (await loadMigration())();
    await finishCommand();
    expect(state.visit).toHaveBeenCalledOnce();
  });
  it("retries a failed command on reconnect and persists only the successful migration", async () => {
    let fail!: () => void;
    state.visit.mockReturnValueOnce(
      new Promise((resolve) => {
        fail = () => resolve({ _tag: "Failure" });
      }),
    );
    const migrate = await loadMigration();
    migrate();
    migrate();
    expect(state.visit).toHaveBeenCalledOnce();
    fail();
    await finishCommand();
    migrate();
    await finishCommand();
    expect(state.visit).toHaveBeenCalledTimes(2);
    state.threads[0] = { ...state.threads[0]!, lastVisitedAt: rewind };
    vi.resetModules();
    (await loadMigration())();
    await finishCommand();
    expect(state.visit).toHaveBeenCalledTimes(2);
  });
  it("migrates independently for the same thread id in another environment after reload", async () => {
    (await loadMigration())();
    await finishCommand();
    const remote = { ...state.threads[0]!, environmentId: EnvironmentId.make("remote") };
    state.visits[scopedThreadKey(scopeThreadRef(remote.environmentId, remote.id))] = localVisit;
    state.threads.push(remote);
    vi.resetModules();
    (await loadMigration())();
    await finishCommand();
    expect(state.visit).toHaveBeenCalledTimes(2);
    expect(state.visit).toHaveBeenLastCalledWith({
      environmentId: remote.environmentId,
      input: { threadId: remote.id, visitedAt: localVisit },
    });
  });
});
