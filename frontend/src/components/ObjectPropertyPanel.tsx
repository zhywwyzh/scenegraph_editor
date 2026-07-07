import { useState, useEffect, useCallback } from "react";
import type { SceneObject } from "../lib/types";

interface Props {
  object: SceneObject;
  onChangeLabel: (id: number, label: string) => void;
  onDelete: (id: number) => void;
}

/**
 * Property panel shown when exactly one scene object is selected in edit mode.
 * Allows editing the object's label.
 */
export function ObjectPropertyPanel({ object, onChangeLabel, onDelete }: Props) {
  const [localLabel, setLocalLabel] = useState(object.label);

  // Reset when selected object changes
  useEffect(() => {
    setLocalLabel(object.label);
  }, [object.id, object.label]);

  const handleApply = useCallback(() => {
    if (localLabel.trim() !== object.label) {
      onChangeLabel(object.id, localLabel.trim());
    }
  }, [localLabel, object.id, object.label, onChangeLabel]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleApply();
        (e.target as HTMLInputElement).blur();
      }
    },
    [handleApply],
  );

  const handleDelete = useCallback(() => {
    onDelete(object.id);
  }, [object.id, onDelete]);

  return (
    <div
      data-overlay
      style={{
        position: "absolute",
        top: 54,
        right: 16,
        zIndex: 10,
        background: "rgba(0,0,0,0.82)",
        borderRadius: 8,
        padding: "12px 16px",
        color: "#ccc",
        fontFamily: "monospace",
        fontSize: 12,
        minWidth: 210,
        userSelect: "none",
      }}
    >
      <div
        style={{
          color: "#fff",
          fontWeight: 600,
          marginBottom: 10,
          fontSize: 13,
        }}
      >
        Object Properties
      </div>

      {/* Read-only metadata */}
      <Row label="ID" value={String(object.id)} />
      <Row label="Area ID" value={object.areaId >= 0 ? String(object.areaId) : "—"} />
      <Row
        label="Father Poly"
        value={object.fatherPolyId >= 0 ? String(object.fatherPolyId) : "—"}
      />
      <Row
        label="Position"
        value={object.position.map((v) => v.toFixed(2)).join(", ")}
      />

      <div style={{ margin: "8px 0 6px", borderTop: "1px solid #333" }} />

      {/* Label editing */}
      <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>
        Label
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="text"
          value={localLabel}
          onChange={(e) => setLocalLabel(e.target.value)}
          onBlur={handleApply}
          onKeyDown={handleInputKeyDown}
          style={{
            flex: 1,
            background: "#1a1a2e",
            color: "#eee",
            border: "1px solid #3498db",
            borderRadius: 4,
            padding: "3px 6px",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        />
        <button
          type="button"
          onClick={handleApply}
          style={{
            background: "rgba(52,152,219,0.3)",
            border: "1px solid rgba(52,152,219,0.5)",
            borderRadius: 4,
            color: "#3498db",
            padding: "3px 8px",
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: 11,
            whiteSpace: "nowrap",
          }}
        >
          Apply
        </button>
      </div>

      <div style={{ margin: "8px 0 6px", borderTop: "1px solid #333" }} />

      {/* Delete button */}
      <button
        type="button"
        onClick={handleDelete}
        style={{
          width: "100%",
          background: "rgba(200,50,50,0.2)",
          border: "1px solid rgba(200,50,50,0.4)",
          borderRadius: 4,
          color: "#e55",
          padding: "4px 10px",
          cursor: "pointer",
          fontFamily: "monospace",
          fontSize: 11,
        }}
      >
        Delete Object
      </button>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 0",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 68,
          color: "#aaa",
          fontSize: 11,
        }}
      >
        {label}
      </span>
      <span style={{ color: "#ddd" }}>{value}</span>
    </div>
  );
}
