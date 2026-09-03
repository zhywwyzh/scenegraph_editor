import { useState, useEffect, useCallback } from "react";
import type { SceneObject } from "../lib/types";

interface Props {
  objects: SceneObject[];
  /** Current ids of all (effective) objects, used to block duplicate ids */
  existingIds: number[];
  selectedIds: Set<number>;
  onSelect: (id: number) => void;
  onChangeId: (oldId: number, newId: number) => void;
  onChangeLabel: (id: number, label: string) => void;
  /** Called with the full effective object-id order after a drag reorder */
  onChangeOrder: (order: number[]) => void;
}

/**
 * Left-side list of all scene objects in edit mode.
 * Allows batch editing of object ids and labels, and selecting
 * objects from the list (syncs with the 3D view selection).
 */
export function ObjectsListPanel({
  objects,
  existingIds,
  selectedIds,
  onSelect,
  onChangeId,
  onChangeLabel,
  onChangeOrder,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  const moveItem = useCallback(
    (fromId: number, toId: number) => {
      if (fromId === toId) return;
      const fromIdx = objects.findIndex((o) => o.id === fromId);
      const toIdx = objects.findIndex((o) => o.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = [...objects];
      const [moved] = next.splice(fromIdx, 1);
      // Insert before the target row (target shifts left when moving down).
      const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
      next.splice(insertAt, 0, moved);
      onChangeOrder(next.map((o) => o.id));
    },
    [objects, onChangeOrder],
  );

  const handleDrop = useCallback(
    (targetId: number) => {
      if (dragId === null) return;
      moveItem(dragId, targetId);
      setDragId(null);
      setDragOverId(null);
    },
    [dragId, moveItem],
  );

  const visible = filter.trim()
    ? objects.filter(
        (o) =>
          o.label.toLowerCase().includes(filter.trim().toLowerCase()) ||
          String(o.id).includes(filter.trim()),
      )
    : objects;

  return (
    <div
      data-overlay
      style={{
        position: "absolute",
        top: 54,
        left: 16,
        zIndex: 10,
        background: "rgba(0,0,0,0.82)",
        borderRadius: 8,
        color: "#ccc",
        fontFamily: "monospace",
        fontSize: 12,
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        maxHeight: "calc(100% - 90px)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: collapsed ? "none" : "1px solid #333",
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{
            background: "transparent",
            border: "none",
            color: "#888",
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: 11,
            padding: 0,
            width: 14,
          }}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>
          Objects
        </span>
        <span style={{ color: "#666", fontSize: 10 }}>
          {visible.length}/{objects.length}
        </span>
      </div>

      {!collapsed && (
        <>
          {/* Filter */}
          <div style={{ padding: "6px 10px 2px" }}>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter id / label…"
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#1a1a2e",
                color: "#eee",
                border: "1px solid #333",
                borderRadius: 4,
                padding: "3px 6px",
                fontFamily: "monospace",
                fontSize: 11,
              }}
            />
          </div>

          {/* Rows */}
          <div
            style={{
              overflowY: "auto",
              padding: "4px 6px 8px",
              minWidth: 260,
            }}
          >
            {visible.length === 0 && (
              <div style={{ color: "#666", padding: "8px 6px", fontSize: 11 }}>
                no objects
              </div>
            )}
            {visible.map((o) => (
              <ObjectRow
                key={o.id}
                object={o}
                existingIds={existingIds}
                selected={selectedIds.has(o.id)}
                dragging={dragId === o.id}
                dragOver={dragOverId === o.id}
                onSelect={onSelect}
                onChangeId={onChangeId}
                onChangeLabel={onChangeLabel}
                onDragStartHandle={() => setDragId(o.id)}
                onDragEndHandle={() => {
                  setDragId(null);
                  setDragOverId(null);
                }}
                onDragOverRow={() => setDragOverId(o.id)}
                onDropRow={() => handleDrop(o.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ObjectRow({
  object,
  existingIds,
  selected,
  dragging,
  dragOver,
  onSelect,
  onChangeId,
  onChangeLabel,
  onDragStartHandle,
  onDragEndHandle,
  onDragOverRow,
  onDropRow,
}: {
  object: SceneObject;
  existingIds: number[];
  selected: boolean;
  dragging: boolean;
  dragOver: boolean;
  onSelect: (id: number) => void;
  onChangeId: (oldId: number, newId: number) => void;
  onChangeLabel: (id: number, label: string) => void;
  onDragStartHandle: () => void;
  onDragEndHandle: () => void;
  onDragOverRow: () => void;
  onDropRow: () => void;
}) {
  const [localId, setLocalId] = useState(String(object.id));
  const [localLabel, setLocalLabel] = useState(object.label);

  // Reset when the underlying object (id or label) changes externally
  useEffect(() => {
    setLocalId(String(object.id));
    setLocalLabel(object.label);
  }, [object.id, object.label]);

  const parsedId = Number(localId);
  const idDirty = localId !== String(object.id);
  const idValid =
    Number.isInteger(parsedId) &&
    parsedId >= 0 &&
    parsedId <= 65535 &&
    parsedId !== object.id &&
    !existingIds.includes(parsedId);
  const labelDirty = localLabel.trim() !== object.label;

  const applyId = useCallback(() => {
    if (idValid) onChangeId(object.id, parsedId);
  }, [idValid, object.id, parsedId, onChangeId]);

  const applyLabel = useCallback(() => {
    if (labelDirty && localLabel.trim() !== "") {
      onChangeLabel(object.id, localLabel.trim());
    } else {
      setLocalLabel(object.label);
    }
  }, [labelDirty, localLabel, object.id, object.label, onChangeLabel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, apply: () => void) => {
      if (e.key === "Enter") {
        apply();
        (e.target as HTMLInputElement).blur();
      }
      if (e.key === "Escape") {
        setLocalId(String(object.id));
        setLocalLabel(object.label);
        (e.target as HTMLInputElement).blur();
      }
    },
    [object.id, object.label],
  );

  const inputStyle: React.CSSProperties = {
    background: "#1a1a2e",
    color: "#eee",
    border: "1px solid #333",
    borderRadius: 4,
    padding: "2px 5px",
    fontFamily: "monospace",
    fontSize: 11,
  };

  return (
    <div
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el.tagName === "INPUT" || el.closest("[data-drag-handle]")) return;
        onSelect(object.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverRow();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropRow();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 4px",
        borderRadius: 4,
        background: dragging
          ? "rgba(52,152,219,0.24)"
          : dragOver
            ? "rgba(52,152,219,0.12)"
            : selected
              ? "rgba(52,152,219,0.18)"
              : "transparent",
        border: dragOver
          ? "1px solid rgba(52,152,219,0.6)"
          : selected
            ? "1px solid rgba(52,152,219,0.4)"
            : "1px solid transparent",
        marginBottom: 2,
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: object.colorHex,
          flexShrink: 0,
        }}
        title={`area ${object.areaId >= 0 ? object.areaId : "—"}`}
      />
      <input
        type="number"
        value={localId}
        onChange={(e) => setLocalId(e.target.value)}
        onBlur={idDirty && idValid ? applyId : undefined}
        onKeyDown={(e) => handleKeyDown(e, applyId)}
        title={idDirty && !idValid ? "invalid (duplicate / out of 0–65535)" : "object id"}
        style={{
          ...inputStyle,
          width: 62,
          borderColor: idDirty ? (idValid ? "#2ecc71" : "#e55") : "#333",
        }}
      />
      <input
        type="text"
        value={localLabel}
        onChange={(e) => setLocalLabel(e.target.value)}
        onBlur={applyLabel}
        onKeyDown={(e) => handleKeyDown(e, applyLabel)}
        style={{ ...inputStyle, flex: 1, minWidth: 90 }}
      />
      <span
        data-drag-handle
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(object.id));
          onDragStartHandle();
        }}
        onDragEnd={onDragEndHandle}
        title="Drag to reorder"
        style={{
          cursor: "grab",
          color: dragging ? "#fff" : "#666",
          fontSize: 12,
          flexShrink: 0,
          padding: "0 2px",
          userSelect: "none",
        }}
      >
        ⠿
      </span>
    </div>
  );
}
