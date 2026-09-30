import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";
import { resolveLegacySidebarProviderEntry } from "./providerIcon";

function provider(driver: ProviderDriverKind, instanceId: string = driver): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-30T00:00:00Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
}
const selection = (id: string) => ({
  modelSelection: { instanceId: ProviderInstanceId.make(id), model: "model" },
  runtime: null,
});
const config = (providers: ServerProvider[]) => ({ providers, settings: DEFAULT_SERVER_SETTINGS });

describe("legacy provider icon identity", () => {
  it.each(["codex", "claudeAgent", "opencode", "cursor", "grok", "antigravity", "pi"] as const)(
    "resolves the %s driver for both default and custom instances",
    (driver) => {
      const providers = [
        provider(ProviderDriverKind.make(driver)),
        provider(ProviderDriverKind.make(driver), "custom"),
      ];
      expect(
        resolveLegacySidebarProviderEntry(config(providers), selection(driver))?.driverKind,
      ).toBe(driver);
      expect(
        resolveLegacySidebarProviderEntry(config(providers), selection("custom"))?.driverKind,
      ).toBe(driver);
    },
  );

  it("keeps the current runtime's provider when a different model is selected", () => {
    const thread = {
      ...selection("codex"),
      runtime: {
        providerInstanceId: ProviderInstanceId.make("open-code-remote"),
        status: "running" as const,
        activeRunId: null,
        providerName: null,
        lastError: null,
        updatedAt: "2026-09-30T00:00:00Z",
      },
    };
    const entry = resolveLegacySidebarProviderEntry(
      config([
        provider(ProviderDriverKind.make("codex")),
        provider(ProviderDriverKind.make("opencode"), "open-code-remote"),
      ]),
      thread,
    );
    expect(entry?.driverKind).toBe("opencode");
  });

  it("keeps equal instance IDs distinct across environment configurations", () => {
    const local = {
      ...provider(ProviderDriverKind.make("codex"), "custom"),
      accentColor: "#112233",
    };
    const remote = {
      ...provider(ProviderDriverKind.make("opencode"), "custom"),
      accentColor: "#445566",
    };
    expect(
      resolveLegacySidebarProviderEntry(config([local]), selection("custom"))?.driverKind,
    ).toBe("codex");
    const entry = resolveLegacySidebarProviderEntry(config([remote]), selection("custom"));
    expect(entry?.driverKind).toBe("opencode");
    expect(entry?.accentColor).toBe("#445566");
  });

  it("uses registry agent branding from settings even if the probe has no icon", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        custom: {
          driver: ProviderDriverKind.make("acpRegistry"),
          enabled: false,
          config: { agentId: "devin", registryIconUrl: "https://example.com/devin.svg" },
        },
      },
    };
    const entry = resolveLegacySidebarProviderEntry(
      {
        providers: [provider(ProviderDriverKind.make("acpRegistry"), "custom")],
        settings,
      },
      selection("custom"),
    );
    expect(entry?.acpRegistryAgentId).toBe("devin");
    expect(entry?.acpRegistryIconUrl).toBe("https://example.com/devin.svg");
    expect(entry?.enabled).toBe(false);
  });

  it("does not label a missing provider as a different available provider", () => {
    expect(resolveLegacySidebarProviderEntry(undefined, selection("opencode"))).toBeUndefined();
    expect(
      resolveLegacySidebarProviderEntry(
        config([provider(ProviderDriverKind.make("codex"))]),
        selection("removed"),
      ),
    ).toBeUndefined();
  });
});
