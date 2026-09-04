import { useState, useEffect, useCallback, useRef } from "react";
import type { SceneObject } from "../lib/types";

/** Convert a `#rrggbb` hex string to RGB in 0–255 integers (object format). */
function hexToRgb255(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface Props {
  object: SceneObject;
  /** Current ids of all (effective) objects, used to block duplicate ids */
  existingIds: number[];
  onChangeId: (oldId: number, newId: number) => void;
  onChangeLabel: (id: number, label: string) => void;
  onChangePosition: (id: number, position: [number, number, number]) => void;
  onColor: (id: number, color: [number, number, number]) => void;
  onDelete: (id: number) => void;
}

/**
 * Property panel shown when exactly one scene object is selected in edit mode.
 * Allows editing the object's id, label, color, and X/Y/Z position.
 */
export function ObjectPropertyPanel({
  object,
  existingIds,
  onChangeId,
  onChangeLabel,
  onChangePosition,
  onColor,
  onDelete,
}: Props) {
  const [localLabel, setLocalLabel] = useState(object.label);
  const [localId, setLocalId] = useState(String(object.id));
  const [localX, setLocalX] = useState(object.position[0]);
  const [localY, setLocalY] = useState(object.position[1]);
  const [localZ, setLocalZ] = useState(object.position[2]);
  const [colorHex, setColorHex] = useState(object.colorHex);

  // Reset when selected object changes
  useEffect(() => {
    setLocalLabel(object.label);
    setLocalId(String(object.id));
    setLocalX(object.position[0]);
    setLocalY(object.position[1]);
    setLocalZ(object.position[2]);
    setColorHex(object.colorHex);
  }, [object.id, object.label, object.position[0], object.position[1], object.position[2], object.colorHex]);

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

  const commitColor = useCallback(() => {
    if (colorHex !== object.colorHex) {
      onColor(object.id, hexToRgb255(colorHex));
    }
  }, [colorHex, object.colorHex, object.id, onColor]);

  return (
    <div
      data-overlay
      style={{
        background: "rgba(0,0,0,0.82)",
        borderRadius: 6,
        padding: "10px 12px",
        color: "#ccc",
        fontFamily: "monospace",
        fontSize: 12,
        minWidth: 0,
        userSelect: "none",
      }}
    >
      <div
        style={{
          color: "#fff",
          fontWeight: 600,
          marginBottom: 6,
          fontSize: 13,
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

      {/* Color editing */}
      <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
      <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
        Color
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="color"
          value={colorHex}
          onChange={(e) => setColorHex(e.target.value)}
          onBlur={commitColor}
          style={{
            width: 30,
            height: 20,
            padding: 0,
            border: "1px solid #3498db",
            borderRadius: 4,
            background: "transparent",
            cursor: "pointer",
          }}
        />
        <span style={{ color: "#ccc", fontSize: 11 }}>{colorHex}</span>
      </div>

      {/* Position editing */}
      <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
      <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
        Position
      </div>
      <AxisRow axis="x" localValue={localX} setLocal={setLocalX} commitAxis={commitAxis} />
      <AxisRow axis="y" localValue={localY} setLocal={setLocalY} commitAxis={commitAxis} />
      <AxisRow axis="z" localValue={localZ} setLocal={setLocalZ} commitAxis={commitAxis} />

      {/* ID editing */}
      <div style={{ fontSize: 11, color: "#888", margin: "4px 0 2px" }}>
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
            padding: "3px 6px",
            fontFamily: "monospace",
            fontSize: 12,
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
            padding: "3px 8px",
            cursor: idValid ? "pointer" : "not-allowed",
            opacity: idValid ? 1 : 0.4,
            fontFamily: "monospace",
            fontSize: 11,
            whiteSpace: "nowrap",
          }}
        >
          Apply
        </button>
      </div>

      <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />

      {/* Label editing */}
      <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
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

      <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />

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
          fontSize: 12,
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
        padding: "1px 0",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 80,
          color: "#aaa",
          fontSize: 11,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span style={{ color: "#ddd" }}>{value}</span>
    </div>
  );
}

function AxisRow({
  axis,
  localValue,
  setLocal,
  commitAxis,
}: {
  axis: "x" | "y" | "z";
  localValue: number;
  setLocal: (v: number) => void;
  commitAxis: (axis: "x" | "y" | "z", value: number) => void;
}) {
  // Draft string for the number input lets the user clear/type partial values
  // without immediately collapsing "" → 0 or "e" → NaN into committed state.
  const [draft, setDraft] = useState(localValue.toFixed(5));
  const draftRef = useRef(localValue);
  const committedRef = useRef(false);
  useEffect(() => {
    setDraft(localValue.toFixed(5));
    draftRef.current = localValue;
  }, [localValue]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraft(e.target.value);
    },
    [],
  );

  const commitFromDraft = useCallback(() => {
    const v = Number(Number(draft).toFixed(5));
    if (!Number.isFinite(v)) {
      setDraft(localValue.toFixed(5));
      return;
    }
    setLocal(v);
    commitAxis(axis, v);
  }, [draft, localValue, axis, setLocal, commitAxis]);

  const handleInputBlur = useCallback(() => {
    if (committedRef.current) {
      committedRef.current = false;
      return;
    }
    commitFromDraft();
  }, [commitFromDraft]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        committedRef.current = true;
        commitFromDraft();
        (e.target as HTMLInputElement).blur();
      }
    },
    [commitFromDraft],
  );

  // Slider: update local preview on change, but only commit one history entry
  // when the drag/keyboard interaction ends (pointerup / keyup).
  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(Number(e.target.value).toFixed(5));
      draftRef.current = v;
      setDraft(v.toFixed(5));
      setLocal(v);
    },
    [setLocal],
  );

  const commitSlider = useCallback(() => {
    const v = Number(draftRef.current.toFixed(5));
    if (Number.isFinite(v)) {
      commitAxis(axis, v);
    }
  }, [axis, commitAxis]);

  const sliderMin = Math.min(localValue - 10, -100);
  const sliderMax = Math.max(localValue + 10, 100);

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 2,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 14,
            color: "#3498db",
            fontWeight: 600,
            fontSize: 12,
            textTransform: "uppercase",
          }}
        >
          {axis}
        </span>
        <input
          type="number"
          step={0.00001}
          value={draft}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          style={{
            width: 90,
            background: "#1a1a2e",
            color: "#eee",
            border: "1px solid #3498db",
            borderRadius: 4,
            padding: "3px 6px",
            fontFamily: "monospace",
            fontSize: 12,
            textAlign: "right",
          }}
        />
      </div>

      <div style={{ marginTop: 2, paddingLeft: 0 }}>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={0.00001}
          value={localValue}
          onChange={handleSliderChange}
          onPointerUp={commitSlider}
          onKeyUp={commitSlider}
          style={{
            width: "100%",
            accentColor: "#3498db",
            height: 4,
            cursor: "pointer",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "#555",
            marginTop: 1,
          }}
        >
          <span>{sliderMin.toFixed(0)}</span>
          <span>{sliderMax.toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
}
