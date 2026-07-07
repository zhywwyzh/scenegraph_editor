import { useState, useEffect, useCallback } from "react";
import type { TopologicalNode } from "../lib/types";

interface Props {
  node: TopologicalNode;
  onChangePosition: (id: number, center: [number, number, number]) => void;
}

type Axis = "x" | "y" | "z";

/**
 * Property panel shown when exactly one topological node is selected in edit mode.
 * Displays node metadata and allows editing X/Y/Z position.
 */
export function NodePropertyPanel({ node, onChangePosition }: Props) {
  const [localX, setLocalX] = useState(node.position[0]);
  const [localY, setLocalY] = useState(node.position[1]);
  const [localZ, setLocalZ] = useState(node.position[2]);

  // Reset local state when the selected node changes
  useEffect(() => {
    setLocalX(node.position[0]);
    setLocalY(node.position[1]);
    setLocalZ(node.position[2]);
  }, [node.id, node.position[0], node.position[1], node.position[2]]);

  const localByAxis = { x: localX, y: localY, z: localZ };
  const setLocalByAxis = { x: setLocalX, y: setLocalY, z: setLocalZ };
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
        Node Properties
      </div>

      {/* Read-only metadata */}
      <Row label="ID" value={String(node.id)} />
      <Row label="Area ID" value={String(node.areaId)} />

      <div style={{ margin: "8px 0 6px", borderTop: "1px solid #333" }} />

      <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>
        Position
      </div>

      <AxisRow
        axis="x"
        localValue={localX}
        setLocal={setLocalX}
        nodePos={nodePos}
        commitAxis={commitAxis}
      />
      <AxisRow
        axis="y"
        localValue={localY}
        setLocal={setLocalY}
        nodePos={nodePos}
        commitAxis={commitAxis}
      />
      <AxisRow
        axis="z"
        localValue={localZ}
        setLocal={setLocalZ}
        nodePos={nodePos}
        commitAxis={commitAxis}
      />

    </div>
  );
}

// ---- AxisRow ----

function AxisRow({
  axis,
  localValue,
  setLocal,
  nodePos,
  commitAxis,
}: {
  axis: Axis;
  localValue: number;
  setLocal: (v: number) => void;
  nodePos: [number, number, number];
  commitAxis: (axis: Axis, value: number) => void;
}) {
  const idx = axis === "x" ? 0 : axis === "y" ? 1 : 2;

  // Commit on blur / Enter for number input
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocal(Number(e.target.value));
    },
    [setLocal],
  );

  const handleInputBlur = useCallback(() => {
    commitAxis(axis, localValue);
  }, [axis, localValue, commitAxis]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        commitAxis(axis, localValue);
        (e.target as HTMLInputElement).blur();
      }
    },
    [axis, localValue, commitAxis],
  );

  // Slider: commit on every change for real-time 3D feedback
  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      setLocal(v);
      commitAxis(axis, v);
    },
    [axis, setLocal, commitAxis],
  );

  const sliderMin = Math.min(localValue - 10, -100);
  const sliderMax = Math.max(localValue + 10, 100);

  return (
    <div style={{ marginBottom: 4 }}>
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
            fontSize: 11,
            textTransform: "uppercase",
          }}
        >
          {axis}
        </span>
        <input
          type="number"
          step={0.1}
          value={localValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          style={{
            width: 72,
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
      <div style={{ marginTop: 3, paddingLeft: 0 }}>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={0.05}
          value={localValue}
          onChange={handleSliderChange}
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
            fontSize: 9,
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
        padding: "2px 0",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 42,
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
