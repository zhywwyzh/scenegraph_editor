import { useState, useEffect, useCallback, useRef } from "react";
import type { SceneObject } from "../lib/types";

interface Props {
  object: SceneObject;
  /** Current ids of all (effective) objects, used to block duplicate ids */
  existingIds: number[];
  onChangeId: (oldId: number, newId: number) => void;
  onChangeLabel: (id: number, label: string) => void;
  onChangePosition: (id: number, position: [number, number, number]) => void;
  onDelete: (id: number) => void;
}

/**
 * Property panel shown when exactly one scene object is selected in edit mode.
 * Allows editing the object's id, label, and X/Y/Z position.
 */
export function ObjectPropertyPanel({
  object,
  existingIds,
  onChangeId,
  onChangeLabel,
  onChangePosition,
  onDelete,
}: Props) {
  const [localLabel, setLocalLabel] = useState(object.label);
  const [localId, setLocalId] = useState(String(object.id));
  const [localX, setLocalX] = useState(object.position[0]);
  const [localY, setLocalY] = useState(object.position[1]);
  const [localZ, setLocalZ] = useState(object.position[2]);

  // Reset when selected object changes
  useEffect(() => {
    setLocalLabel(object.label);
    setLocalId(String(object.id));
    setLocalX(object.position[0]);
    setLocalY(object.position[1]);
    setLocalZ(object.position[2]);
  }, [object.id, object.label, object.position[0], object.position[1], object.position[2]]);

  // id is a uint16 in the flight instruction contract (target_obj_id)
  const parsedId = Number(localId);
  const idValid =
    Number.isInteger(parsedId) &&
    parsedId >= 0 &&
    parsedId <= 65535 &&
    parsedId !== object.id &&
    !existingIds.includes(parsedId);

  const handleApplyId = useCallback(() => {
    if (idValid) {
      onChangeId(object.id, parsedId);
    }
  }, [idValid, object.id, parsedId, onChangeId]);

  const handleIdKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && idValid) {
        handleApplyId();
        (e.target as HTMLInputElement).blur();
      }
    },
    [handleApplyId, idValid],
  );

  const handleApply = useCallback(() => {
    if (localLabel.trim() !== object.label) {
      onChangeLabel(object.id, localLabel.trim());
    }
  }, [localLabel, object.id, object.label, onChangeLabel]);

  // Enter commits and then blurs; the resulting blur must not commit a second
  // time (otherwise it produces two identical history entries).
  const labelCommittedRef = useRef(false);
  const handleLabelBlur = useCallback(() => {
    if (labelCommittedRef.current) {
      labelCommittedRef.current = false;
      return;
    }
    handleApply();
  }, [handleApply]);

  const commitAxis = useCallback(
    (axis: "x" | "y" | "z", value: number) => {
      const position: [number, number, number] = [...object.position];
      const idx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
      position[idx] = value;
      onChangePosition(object.id, position);
    },
    [object.id, object.position, onChangePosition],
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        labelCommittedRef.current = true;
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
        background: "rgba(0,0,0,0.82)",
        borderRadius: 8,
        padding: "14px 18px",
        color: "#ccc",
        fontFamily: "monospace",
        fontSize: 14,
        minWidth: 0,
        userSelect: "none",
      }}
    >
      <div
        style={{
          color: "#fff",
          fontWeight: 600,
          marginBottom: 10,
          fontSize: 15,
        }}
      >
        Object Properties
      </div>

      {/* Read-only metadata */}
      <Row label="Area ID" value={object.areaId >= 0 ? String(object.areaId) : "—"} />
      <Row
        label="Father Poly"
        value={object.fatherPolyId >= 0 ? String(object.fatherPolyId) : "—"}
      />

      {/* Position editing */}
      <div style={{ margin: "8px 0 6px", borderTop: "1px solid #333" }} />
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
        Position
      </div>
      <AxisInput axis="x" value={localX} setValue={setLocalX} commit={commitAxis} />
      <AxisInput axis="y" value={localY} setValue={setLocalY} commit={commitAxis} />
      <AxisInput axis="z" value={localZ} setValue={setLocalZ} commit={commitAxis} />

      {/* ID editing */}
      <div style={{ fontSize: 12, color: "#888", margin: "6px 0 4px" }}>
        ID {localId !== String(object.id) && (
          <span style={{ color: idValid ? "#2ecc71" : "#e55" }}>
            {idValid ? "✓" : "invalid (duplicate / out of 0–65535)"}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="number"
          value={localId}
          onChange={(e) => setLocalId(e.target.value)}
          onKeyDown={handleIdKeyDown}
          style={{
            flex: 1,
            background: "#1a1a2e",
            color: "#eee",
            border: "1px solid #3498db",
            borderRadius: 4,
            padding: "5px 8px",
            fontFamily: "monospace",
            fontSize: 14,
          }}
        />
        <button
          type="button"
          onClick={handleApplyId}
          disabled={!idValid}
          style={{
            background: "rgba(52,152,219,0.3)",
            border: "1px solid rgba(52,152,219,0.5)",
            borderRadius: 4,
            color: "#3498db",
            padding: "5px 10px",
            cursor: idValid ? "pointer" : "not-allowed",
            opacity: idValid ? 1 : 0.4,
            fontFamily: "monospace",
            fontSize: 13,
            whiteSpace: "nowrap",
          }}
        >
          Apply
        </button>
      </div>

      <div style={{ margin: "8px 0 6px", borderTop: "1px solid #333" }} />

      {/* Label editing */}
      <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>
        Label
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="text"
          value={localLabel}
          onChange={(e) => setLocalLabel(e.target.value)}
          onBlur={handleLabelBlur}
          onKeyDown={handleInputKeyDown}
          style={{
            flex: 1,
            background: "#1a1a2e",
            color: "#eee",
            border: "1px solid #3498db",
            borderRadius: 4,
            padding: "5px 8px",
            fontFamily: "monospace",
            fontSize: 14,
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
            padding: "5px 10px",
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: 13,
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
          padding: "6px 12px",
          cursor: "pointer",
          fontFamily: "monospace",
          fontSize: 13,
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
          width: 76,
          color: "#aaa",
          fontSize: 13,
        }}
      >
        {label}
      </span>
      <span style={{ color: "#ddd" }}>{value}</span>
    </div>
  );
}

function AxisInput({
  axis,
  value,
  setValue,
  commit,
}: {
  axis: "x" | "y" | "z";
  value: number;
  setValue: (v: number) => void;
  commit: (axis: "x" | "y" | "z", value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const committedRef = useRef(false);
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraft(e.target.value);
    },
    [],
  );

  const commitFromDraft = useCallback(() => {
    const v = Number(draft);
    if (!Number.isFinite(v)) {
      setDraft(String(value));
      return;
    }
    setValue(v);
    commit(axis, v);
  }, [draft, value, axis, setValue, commit]);

  const handleBlur = useCallback(() => {
    if (committedRef.current) {
      committedRef.current = false;
      return;
    }
    commitFromDraft();
  }, [commitFromDraft]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        committedRef.current = true;
        commitFromDraft();
        (e.target as HTMLInputElement).blur();
      }
    },
    [commitFromDraft],
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginTop: 3,
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 16,
          color: "#3498db",
          fontWeight: 600,
          fontSize: 13,
          textTransform: "uppercase",
        }}
      >
        {axis}
      </span>
      <input
        type="number"
        step={0.1}
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={{
          flex: 1,
          background: "#1a1a2e",
          color: "#eee",
          border: "1px solid #3498db",
          borderRadius: 4,
          padding: "5px 8px",
          fontFamily: "monospace",
          fontSize: 14,
          textAlign: "right",
        }}
      />
    </div>
  );
}
