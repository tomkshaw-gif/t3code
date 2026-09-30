import { describe, expect, it } from "vite-plus/test";
import {
  applyLegacySessionColor,
  buildLegacySessionColorMenu,
  isLegacySessionColor,
} from "./sessionColors";

describe("session colour organization", () => {
  it("applies and clears colours to a selected group without changing other sessions", () => {
    const original = { unrelated: "green", first: "blue" } as const;
    const marked = applyLegacySessionColor(original, ["first", "second"], "yellow");
    expect(marked).toEqual({ unrelated: "green", first: "yellow", second: "yellow" });
    expect(applyLegacySessionColor(marked, ["first", "second"], null)).toEqual({
      unrelated: "green",
    });
    expect(original).toEqual({ unrelated: "green", first: "blue" });
  });

  it("shows one current colour only when all selected sessions share it", () => {
    const colors = { first: "yellow", second: "blue" } as const;
    const checked = (keys: string[]) =>
      buildLegacySessionColorMenu(keys, colors)
        .children?.filter((item) => item.checked)
        .map((item) => item.id);
    expect(checked(["first"])).toEqual(["session-color:yellow"]);
    expect(checked(["first", "second"])).toEqual([]);
    expect(checked(["uncoloured"])).toEqual(["session-color:none"]);
  });

  it("allows only palette identifiers from persisted preferences or menu responses", () => {
    expect(isLegacySessionColor("yellow")).toBe(true);
    for (const value of [null, {}, "constructor", "#eab308", "invalid"])
      expect(isLegacySessionColor(value)).toBe(false);
  });
});
