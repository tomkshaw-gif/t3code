import { describe, expect, it } from "vite-plus/test";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { ProviderDriverKind } from "@t3tools/contracts";

import {
  acpAvailableCommandsToSlashCommands,
  acpPermissionOutcome,
  mapAcpToAdapterError,
} from "./AcpAdapterSupport.ts";

const command = (
  input: Partial<EffectAcpSchema.AvailableCommand> & { name: string },
): EffectAcpSchema.AvailableCommand =>
  ({
    description: "",
    ...input,
  }) as EffectAcpSchema.AvailableCommand;

describe("AcpAdapterSupport", () => {
  it("maps ACP approval decisions to permission outcomes", () => {
    expect(acpPermissionOutcome("accept")).toBe("allow-once");
    expect(acpPermissionOutcome("acceptForSession")).toBe("allow-always");
    expect(acpPermissionOutcome("decline")).toBe("reject-once");
  });

  it("maps ACP request errors to provider adapter request errors", () => {
    const error = mapAcpToAdapterError(
      ProviderDriverKind.make("cursor"),
      "thread-1" as never,
      "session/prompt",
      new EffectAcpErrors.AcpRequestError({
        code: -32602,
        errorMessage: "Invalid params",
      }),
    );

    expect(error._tag).toBe("ProviderAdapterRequestError");
    expect(error.message).toContain("Invalid params");
  });

  it("maps an empty command catalog to no slash commands", () => {
    expect(acpAvailableCommandsToSlashCommands([])).toEqual([]);
  });

  it("drops commands with missing or blank names", () => {
    expect(
      acpAvailableCommandsToSlashCommands([
        command({ name: "" }),
        command({ name: "   " }),
        command({ name: "goal", description: "Set the session goal" }),
      ]),
    ).toEqual([{ name: "goal", description: "Set the session goal" }]);
  });

  it("keeps the first occurrence of a duplicated command name", () => {
    expect(
      acpAvailableCommandsToSlashCommands([
        command({ name: "goal", description: "first" }),
        command({ name: "goal", description: "second" }),
      ]),
    ).toEqual([{ name: "goal", description: "first" }]);
  });

  it("maps input hints and trims descriptions", () => {
    expect(
      acpAvailableCommandsToSlashCommands([
        command({
          name: "deep-research",
          description: "  Run deep research  ",
          input: { hint: "  topic  " },
        }),
        command({ name: "feedback", description: "   " }),
        command({ name: "loop", input: { hint: "   " } }),
      ]),
    ).toEqual([
      {
        name: "deep-research",
        description: "Run deep research",
        input: { hint: "topic" },
      },
      { name: "feedback" },
      { name: "loop" },
    ]);
  });
});
