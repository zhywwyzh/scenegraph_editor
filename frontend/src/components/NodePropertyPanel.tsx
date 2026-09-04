import { useState, useEffect, useCallback, useRef } from "react";
import type { TopologicalNode } from "../lib/types";

interface Props {
  node: TopologicalNode;
  onChangePosition: (id: number, center: [number, number, number]) => void;
  onDelete: (id: number) => void;
}

type Axis = "x" | "y" | "z";

/**
 * Property panel shown when exactly one topological node is selected in edit mode.
 * Displays node metadata and allows editing X/Y/Z position and deleting the node.
 */
export function NodePropertyPanel({ node, onChangePosition, onDelete }: Props) {
  const [localX, setLocalX] = useState(node.position[0]);
  const [localY, setLocalY] = useState(node.position[1]);
  const [localZ, setLocalZ] = useState(node.position[2]);

  // Reset local state when the selected node changes
  useEffect(() => {
    setLocalX(node.position[0]);
    setLocalY(node.position[1]);
    setLocalZ(node.position[2]);
  }, [node.id, node.position[0], node.position[1], node.position[2]]);

  const nodePos = node.position;

  // Commit a single-axis change to history
  const commitAxis = useCallback(
    (axis: Axis, value: number) => {
      const center: [number, number, number] = [...nodePos];
      const idx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
      center[idx] = value;
      onChangePosition(node.id, center);
    },
    [node.id, nodePos, onChangePosition],
  );

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
        Node Properties
      </div>

      {/* Read-only metadata */}
      <Row label="ID" value={String(node.id)} />
      <Row label="Area ID" value={String(node.areaId)} />

      <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />

      <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
        Position
      </div>

      <AxisRow
        axis="x"
        localValue={localX}
        setLocal={setLocalX}
        commitAxis={commitAxis}
      />
      <AxisRow
        axis="y"
        localValue={localY}
        setLocal={setLocalY}
        commitAxis={commitAxis}
      />
      <AxisRow
        axis="z"
        localValue={localZ}
        setLocal={setLocalZ}
        commitAxis={commitAxis}
      />

      <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />

      <button
        type="button"
        onClick={() => onDelete(node.id)}
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
        Delete Node
      </button>
    </div>
  );
}

// ---- AxisRow ----

function AxisRow({
  axis,
  localValue,
  setLocal,
  commitAxis,
}: {
  axis: Axis;
  localValue: number;
  setLocal: (v: number) => void;
  commitAxis: (axis: Axis, value: number) => void;
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

  // Commit on blur / Enter for number input
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

  // Slider: update local preview on change, but only commit one history
  // entry when the drag/keyboard interaction ends (pointerup / keyup).
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
      {/* Label + number input */}
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

      {/* Slider */}
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

// ---- Row (read-only key-value) ----

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
