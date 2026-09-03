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
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState("");

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
                onSelect={onSelect}
                onChangeId={onChangeId}
                onChangeLabel={onChangeLabel}
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
  onSelect,
  onChangeId,
  onChangeLabel,
}: {
  object: SceneObject;
  existingIds: number[];
  selected: boolean;
  onSelect: (id: number) => void;
  onChangeId: (oldId: number, newId: number) => void;
  onChangeLabel: (id: number, label: string) => void;
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
        if ((e.target as HTMLElement).tagName !== "INPUT") onSelect(object.id);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 4px",
        borderRadius: 4,
        background: selected ? "rgba(52,152,219,0.18)" : "transparent",
        border: selected ? "1px solid rgba(52,152,219,0.4)" : "1px solid transparent",
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
    </div>
  );
}
