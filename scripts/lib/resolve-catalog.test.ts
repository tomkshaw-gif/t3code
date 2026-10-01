import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { describe } from "vite-plus/test";
import { fromYaml } from "@t3tools/shared/schemaYaml";
import { resolveCatalogDependencies } from "./resolve-catalog.ts";

describe("resolveCatalogDependencies", () => {
  it("resolves direct dependencies and preserves literal versions", () => {
    assert.deepStrictEqual(
      resolveCatalogDependencies(
        { effect: "catalog:", "@effect/platform-node": "catalog:", electron: "44.4.2" },
        { effect: "4.0.0-rc.115", "@effect/platform-node": "4.0.0-rc.115" },
        "apps/desktop",
      ),
      { effect: "4.0.0-rc.115", "@effect/platform-node": "4.0.0-rc.115", electron: "44.4.2" },
    );
  });

  it("resolves nested override targets while preserving selectors and removals", () => {
    const overrides = {
      "@opencode/protocol>effect": "catalog:",
      "@opencode/schema>effect": "catalog:",
      "parent>@effect/platform-node": "catalog:",
      "dbus-next>usocket": "-",
    };
    assert.deepStrictEqual(
      resolveCatalogDependencies(
        overrides,
        { effect: "4.0.0-rc.115", "@effect/platform-node": "4.0.0-rc.115" },
        "apps/desktop",
      ),
      {
        "@opencode/protocol>effect": "4.0.0-rc.115",
        "@opencode/schema>effect": "4.0.0-rc.115",
        "parent>@effect/platform-node": "4.0.0-rc.115",
        "dbus-next>usocket": "-",
      },
    );
    assert.strictEqual(overrides["@opencode/protocol>effect"], "catalog:");
  });

  it("uses the target package for version-qualified selectors", () => {
    assert.deepStrictEqual(
      resolveCatalogDependencies(
        { "parent@1>effect@^4": "catalog:", "@scope/package@^2": "catalog:" },
        { effect: "4.0.0-rc.115", "@scope/package": "2.5.0" },
        "apps/desktop",
      ),
      { "parent@1>effect@^4": "4.0.0-rc.115", "@scope/package@^2": "2.5.0" },
    );
  });

  it("preserves an explicit catalog lookup key", () => {
    assert.deepStrictEqual(
      resolveCatalogDependencies(
        { "parent>effect": "catalog: effect-alias " },
        { "effect-alias": "4.0.0-rc.115" },
        "apps/desktop",
      ),
      { "parent>effect": "4.0.0-rc.115" },
    );
  });

  it("reports a missing target catalog entry", () => {
    assert.throws(
      () => resolveCatalogDependencies({ "parent>missing": "catalog:" }, {}, "apps/desktop"),
      /Expected key 'missing'/,
    );
  });

  it.effect("resolves every override from the real desktop workspace", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspacePath = yield* path.fromFileUrl(
        new URL("../../pnpm-workspace.yaml", import.meta.url),
      );
      const workspace = yield* Schema.decodeEffect(
        fromYaml(
          Schema.Struct({
            catalog: Schema.Record(Schema.String, Schema.String),
            overrides: Schema.Record(Schema.String, Schema.String),
          }),
        ),
      )(yield* fs.readFileString(workspacePath));
      const resolved = resolveCatalogDependencies(
        workspace.overrides,
        workspace.catalog,
        "apps/desktop",
      );
      assert.strictEqual(resolved["@opencode/protocol>effect"], workspace.catalog.effect);
      assert.strictEqual(resolved["@opencode/schema>effect"], workspace.catalog.effect);
      assert.strictEqual(Object.keys(resolved).length, Object.keys(workspace.overrides).length);
      assert.ok(Object.values(resolved).every((spec) => !spec.startsWith("catalog:")));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
