import { SynaraIcon } from "./SynaraIcon";

export function SynaraFolderIcon({ expanded }: { expanded: boolean }) {
  return <SynaraIcon name={expanded ? "folder-open" : "folder"} className="size-4" />;
}
