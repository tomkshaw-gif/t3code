import { useMemo, useState } from "react";
import type { ProviderInstanceId } from "@t3tools/contracts";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";

export interface OrchestrationTarget {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
}

/** Above this many models an instance group gets a filter input. */
const FILTER_THRESHOLD = 8;

const targetKey = (instanceId: string, model: string) => `${instanceId}|${model}`;

/**
 * Orchestration worker allowlist: which provider/model pairs agents may hand
 * work to. `null` means every configured model is fair game; a list restricts
 * spawn targets to exactly the checked pairs (an empty list blocks spawning
 * entirely while keeping the orchestration read tools).
 */
export function OrchestrationTargetsSettings({
  entries,
  targets,
  disabled,
  onChange,
}: {
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly targets: ReadonlyArray<OrchestrationTarget> | null;
  readonly disabled: boolean;
  readonly onChange: (next: ReadonlyArray<OrchestrationTarget> | null) => void;
}) {
  const restricted = targets !== null;
  const targetSet = useMemo(
    () => new Set((targets ?? []).map((t) => targetKey(t.instanceId, t.model))),
    [targets],
  );
  const [filters, setFilters] = useState<Readonly<Record<string, string>>>({});

  const availableEntries = entries.filter((entry) => entry.enabled && entry.models.length > 0);

  const setMode = (mode: string | null) => {
    if (mode === null || mode === "all") {
      onChange(null);
      return;
    }
    // Switching to "Selected" seeds with every available model so the toggle
    // itself never breaks a running fleet — pruning is the explicit step.
    onChange(
      availableEntries.flatMap((entry) =>
        entry.models.map((model) => ({ instanceId: entry.instanceId, model: model.slug })),
      ),
    );
  };

  const setModel = (instanceId: ProviderInstanceId, model: string, allowed: boolean) => {
    if (targets === null) return;
    const key = targetKey(instanceId, model);
    const has = targetSet.has(key);
    if (allowed === has) return;
    onChange(
      allowed
        ? [...targets, { instanceId, model }]
        : targets.filter((t) => targetKey(t.instanceId, t.model) !== key),
    );
  };

  const setAllForInstance = (entry: ProviderInstanceEntry, allowed: boolean) => {
    if (targets === null) return;
    const slugs = new Set(entry.models.map((model) => model.slug));
    const kept = targets.filter((t) => !(t.instanceId === entry.instanceId && slugs.has(t.model)));
    onChange(
      allowed
        ? [
            ...kept,
            ...entry.models.map((model) => ({ instanceId: entry.instanceId, model: model.slug })),
          ]
        : kept,
    );
  };

  const selectedCount = targets?.length ?? 0;
  const totalCount = availableEntries.reduce((sum, entry) => sum + entry.models.length, 0);

  return (
    <>
      <SettingsRow
        title="Worker model targets"
        description="Which providers and models agents may spawn workers on. Selected restricts the list; an empty selection blocks new workers."
        control={
          <Select
            disabled={disabled}
            value={restricted ? "selected" : "all"}
            onValueChange={setMode}
          >
            <SelectTrigger size="sm" aria-label="Worker model targets">
              <SelectValue>
                {restricted ? `Selected (${selectedCount} of ${totalCount})` : "All models"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="all">All models</SelectItem>
              <SelectItem value="selected">Selected models</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      {restricted ? (
        <div className="px-1 pb-3">
          {availableEntries.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No providers available — no worker can be spawned until a provider is ready.
            </p>
          ) : (
            availableEntries.map((entry) => {
              const allowedCount = entry.models.filter((model) =>
                targetSet.has(targetKey(entry.instanceId, model.slug)),
              ).length;
              const filter = (filters[entry.instanceId] ?? "").trim().toLowerCase();
              const visibleModels =
                filter.length > 0
                  ? entry.models.filter(
                      (model) =>
                        model.name.toLowerCase().includes(filter) ||
                        model.slug.toLowerCase().includes(filter),
                    )
                  : entry.models;
              return (
                <div key={entry.instanceId} className="py-1">
                  <div className="flex items-center justify-between px-2 pb-1">
                    <span className="text-xs font-medium text-foreground/80">
                      {entry.displayName}
                      <span className="ml-2 text-muted-foreground/70">
                        {allowedCount}/{entry.models.length}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {entry.models.length > FILTER_THRESHOLD ? (
                        <Input
                          value={filters[entry.instanceId] ?? ""}
                          onChange={(event) =>
                            setFilters((current) => ({
                              ...current,
                              [entry.instanceId]: event.target.value,
                            }))
                          }
                          placeholder="Filter models"
                          size="sm"
                          className="w-40"
                          spellCheck={false}
                          aria-label={`Filter ${entry.displayName} models`}
                        />
                      ) : null}
                      <button
                        type="button"
                        className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground"
                        disabled={disabled}
                        onClick={() => setAllForInstance(entry, true)}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground"
                        disabled={disabled}
                        onClick={() => setAllForInstance(entry, false)}
                      >
                        None
                      </button>
                    </span>
                  </div>
                  {visibleModels.map((model) => {
                    const allowed = targetSet.has(targetKey(entry.instanceId, model.slug));
                    return (
                      <label
                        key={model.slug}
                        className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted/30"
                      >
                        <Checkbox
                          checked={allowed}
                          disabled={disabled}
                          onCheckedChange={(checked) =>
                            setModel(entry.instanceId, model.slug, checked === true)
                          }
                          aria-label={`Allow ${model.name} on ${entry.displayName}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-foreground/90">
                          {model.name}
                          {model.name !== model.slug ? (
                            <code className="ml-2 font-mono text-[11px] text-muted-foreground/70">
                              {model.slug}
                            </code>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </>
  );
}
