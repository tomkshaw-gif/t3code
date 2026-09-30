import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import type { ComponentProps, ReactNode } from "react";
import { moveLegacySidebarItem } from "./preferences";

export function LegacySortableList({
  items,
  onReorder,
  children,
}: {
  items: readonly string[];
  onReorder: (order: string[], movedKey: string) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id)
          onReorder(
            moveLegacySidebarItem(items, String(active.id), String(over.id)),
            String(active.id),
          );
      }}
    >
      <SortableContext items={[...items]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function LegacySortableItem({
  id,
  disabled = false,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: (handle: ComponentProps<"button">) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  return (
    <li
      ref={setNodeRef}
      data-legacy-sortable-item
      data-dragging={isDragging}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {children({
        ...attributes,
        ...listeners,
        ref: setActivatorNodeRef,
        type: "button",
        disabled,
      })}
    </li>
  );
}
