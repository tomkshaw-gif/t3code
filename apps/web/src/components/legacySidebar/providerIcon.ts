import type { ServerConfig } from "@t3tools/contracts";
import type { SidebarThreadSummary } from "../../types";
import { applyProviderInstanceSettings, getProviderInstanceEntry } from "../../providerInstances";

export function resolveLegacySidebarProviderEntry(
  config: Pick<ServerConfig, "providers" | "settings"> | null | undefined,
  thread: Pick<SidebarThreadSummary, "modelSelection" | "runtime">,
) {
  if (!config) return undefined;
  const instanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const entry = getProviderInstanceEntry(config.providers, instanceId);
  // Registry agent identity and its icon can live in settings, rather than the
  // last provider probe. Retain disabled instances for existing thread identity.
  return entry ? applyProviderInstanceSettings([entry], config.settings)[0] : undefined;
}
