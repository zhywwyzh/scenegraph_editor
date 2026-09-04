import { useState, useCallback } from "react";
import type { SceneObject, TopologicalNode } from "../lib/types";

interface Props {
  objects: SceneObject[];
  selectedIds: Set<number>;
  onSelect: (id: number) => void;
  /** Called with the full effective object-id order after a drag reorder */
  onChangeOrder: (order: number[]) => void;
  /** Node lookup keyed by id, for showing each object's father-poly node */
  nodesById: Map<number, TopologicalNode>;
  selectedNodeIds: Set<number>;
  onSelectNode: (id: number) => void;
}

/**
 * Left-side list of all scene objects (and their linked nodes) in edit mode.
 * Rows are read-only selectors; id / label / position editing happens in the
 * right-side property panels.
 */
export function ObjectsListPanel({
  objects,
  selectedIds,
  onSelect,
  onChangeOrder,
  nodesById,
  selectedNodeIds,
  onSelectNode,
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
        background: "rgba(0,0,0,0.82)",
        borderRadius: 8,
        color: "#ccc",
        fontFamily: "monospace",
        fontSize: 14,
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        flex: "0 0 auto",
        minWidth: 320,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
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
            fontSize: 13,
            padding: 0,
            width: 16,
          }}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span style={{ color: "#fff", fontWeight: 600, fontSize: 15 }}>
          Objects / Nodes ({visible.length}/{objects.length})
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
                padding: "5px 8px",
                fontFamily: "monospace",
                fontSize: 13,
              }}
            />
          </div>

          {/* Rows */}
          <div
            style={{
              overflowY: "auto",
              padding: "4px 8px 10px",
              minWidth: 320,
              maxHeight: "50vh",
            }}
          >
            {visible.length === 0 && (
              <div style={{ color: "#666", padding: "8px 6px", fontSize: 13 }}>
                no objects
              </div>
            )}
            {visible.map((o) => (
              <ObjectRow
                key={o.id}
                object={o}
                selected={selectedIds.has(o.id)}
                dragging={dragId === o.id}
                dragOver={dragOverId === o.id}
                onSelect={onSelect}
                nodesById={nodesById}
                selectedNodeIds={selectedNodeIds}
                onSelectNode={onSelectNode}
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
  selected,
  dragging,
  dragOver,
  onSelect,
  nodesById,
  selectedNodeIds,
  onSelectNode,
  onDragStartHandle,
  onDragEndHandle,
  onDragOverRow,
  onDropRow,
}: {
  object: SceneObject;
  selected: boolean;
  dragging: boolean;
  dragOver: boolean;
  onSelect: (id: number) => void;
  nodesById: Map<number, TopologicalNode>;
  selectedNodeIds: Set<number>;
  onSelectNode: (id: number) => void;
  onDragStartHandle: () => void;
  onDragEndHandle: () => void;
  onDragOverRow: () => void;
  onDropRow: () => void;
}) {
  const node =
    object.fatherPolyId >= 0 ? nodesById.get(object.fatherPolyId) : undefined;
  const nodeSelected = node ? selectedNodeIds.has(node.id) : false;

  return (
    <div
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest("[data-drag-handle]")) return;
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
        gap: 7,
        padding: "4px 5px",
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
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: object.colorHex,
          flexShrink: 0,
        }}
        title={`area ${object.areaId >= 0 ? object.areaId : "—"}`}
      />
      <span
        title="object id"
        style={{
          width: 54,
          color: "#eee",
          textAlign: "right",
          flexShrink: 0,
          fontSize: 13,
        }}
      >
        {object.id}
      </span>
      <span
        title={object.label}
        style={{
          flex: 1,
          minWidth: 96,
          color: "#ccc",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 13,
        }}
      >
        {object.label}
      </span>
      {node && (
        <span
          data-node-chip
          onClick={(e) => {
            e.stopPropagation();
            onSelectNode(node.id);
          }}
          title={`Select node ${node.id} (area ${node.areaId})`}
          style={{
            flexShrink: 0,
            cursor: "pointer",
            color: nodeSelected ? "#fff" : "#8ab4f8",
            background: nodeSelected
              ? "rgba(52,152,219,0.30)"
              : "rgba(255,255,255,0.04)",
            border: nodeSelected
              ? "1px solid rgba(52,152,219,0.55)"
              : "1px solid #2f3a55",
            borderRadius: 3,
            padding: "2px 7px",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          N{node.id}
        </span>
      )}
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
          fontSize: 14,
          flexShrink: 0,
          padding: "0 3px",
          userSelect: "none",
        }}
      >
        ⠿
      </span>
    </div>
  );
}
