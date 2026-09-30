import type { CSSProperties } from "react";
import pin from "./icons/pin.svg?url";
import pinFilled from "./icons/pin-filled.svg?url";
import compose from "./icons/compose-pencil.svg?url";
import consoleIcon from "./icons/console.svg?url";
import folder from "./icons/folder-2.svg?url";
import folderOpen from "./icons/folder-open-front.svg?url";
import gitCompare from "./icons/git-compare.svg?url";
import expand from "./icons/expand-45.svg?url";
import minimize from "./icons/minimize-45.svg?url";
import fork from "./icons/repo-forked.svg?url";
import worktree from "./icons/arrow-split-right.svg?url";
import activity from "./icons/notes.svg?url";
import sort from "./icons/arrow-top-bottom.svg?url";
import plus from "./icons/plus-medium.svg?url";
import branch from "./icons/branch.svg?url";
import done from "./icons/circle-check.svg?url";
import undo from "./icons/arrow-back-up.svg?url";
import archive from "./icons/archive.svg?url";
import search from "./icons/magnifying-glass.svg?url";
import chevronDown from "./icons/chevron-down.svg?url";
import chevronRight from "./icons/chevron-right.svg?url";

// Exact Synara assets at 529ad049cb106c998010f5400189515008997aa4.
// Pull requests use Ionicons' IoIosGitCompare, as in Synara's Sidebar.tsx.
// Licenses are retained beside the assets and in the packaged third-party notices.
const icons = {
  pin,
  "pin-filled": pinFilled,
  compose,
  console: consoleIcon,
  folder,
  "folder-open": folderOpen,
  "git-compare": gitCompare,
  expand,
  minimize,
  fork,
  worktree,
  activity,
  sort,
  plus,
  branch,
  done,
  undo,
  archive,
  search,
  "chevron-down": chevronDown,
  "chevron-right": chevronRight,
};

export function SynaraIcon({
  name,
  className = "size-3.5",
}: {
  name: keyof typeof icons;
  className?: string;
}) {
  // Synara uses a mask so intersecting strokes keep the same opacity.
  const mask = `url("${icons[name]}") center / contain no-repeat`;
  const style: CSSProperties = { WebkitMask: mask, mask };
  return (
    <span aria-hidden className={`inline-block shrink-0 bg-current ${className}`} style={style} />
  );
}
