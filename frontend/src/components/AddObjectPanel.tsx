import { useState, useCallback, useEffect } from "react";

interface Props {
  onAdd: (
    label: string,
    position: [number, number, number],
    color: [number, number, number],
  ) => void;
  onCancel: () => void;
  /** Seed XYZ from a scene click; overrides the fields whenever it changes. */
  initialPosition?: [number, number, number];
}

function hexToRgb255(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [230, 100, 30];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function formatCoord(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : "0";
}

/**
 * Panel for creating a new marker object (no point cloud, not linked to any
 * poly) at an arbitrary position with a user-defined label and color.
 */
export function AddObjectPanel({ onAdd, onCancel, initialPosition }: Props) {
  const [label, setLabel] = useState("");
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("0");
  const [colorHex, setColorHex] = useState("#e6641e");

  useEffect(() => {
    if (!initialPosition) return;
    setX(formatCoord(initialPosition[0]));
    setY(formatCoord(initialPosition[1]));
    setZ(formatCoord(initialPosition[2]));
  }, [initialPosition]);

  const handleSubmit = useCallback(() => {
    const nx = Number(x);
    const ny = Number(y);
    const nz = Number(z);
    if (!isFinite(nx) || !isFinite(ny) || !isFinite(nz)) return;
    onAdd(
      label.trim() || "New Object",
      [nx, ny, nz],
      hexToRgb255(colorHex),
    );
  }, [label, x, y, z, colorHex, onAdd]);

  const inputStyle: React.CSSProperties = {
    width: 72,
    background: "#1a1a2e",
    color: "#eee",
    border: "1px solid #3498db",
    borderRadius: 4,
    padding: "3px 6px",
    fontFamily: "monospace",
    fontSize: 12,
    textAlign: "right",
  };

  return (
    <div
      data-overlay
      style={{
        position: "absolute",
        top: 140,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        background: "rgba(0,0,0,0.85)",
        borderRadius: 8,
        padding: "12px 16px",
        color: "#ccc",
        fontFamily: "monospace",
        fontSize: 12,
        minWidth: 210,
        userSelect: "none",
      }}
    >
      <div style={{ color: "#fff", fontWeight: 600, marginBottom: 10, fontSize: 13 }}>
        Add New Object
      </div>

      <Field label="Label" value={label} onChange={setLabel} type="text" style={inputStyle} />
      <Field label="X" value={x} onChange={setX} type="number" style={inputStyle} />
      <Field label="Y" value={y} onChange={setY} type="number" style={inputStyle} />
      <Field label="Z" value={z} onChange={setZ} type="number" style={inputStyle} />

      <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
        <span style={{ display: "inline-block", width: 48, color: "#aaa", fontSize: 11 }}>
          Color
        </span>
        <input
          type="color"
          value={colorHex}
          onChange={(e) => setColorHex(e.target.value)}
          style={{
            width: 40,
            height: 24,
            borderRadius: 4,
            border: "1px solid #3498db",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
          }}
        />
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button type="button" onClick={handleSubmit} style={btnPrimary}>
          Create Object
        </button>
        <button type="button" onClick={onCancel} style={btnSecondary}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
  style,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: "text" | "number";
  style: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
      <span style={{ display: "inline-block", width: 48, color: "#aaa", fontSize: 11 }}>
        {label}
      </span>
      <input
        type={type}
        step={type === "number" ? "any" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={style}
      />
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  flex: 1,
  background: "rgba(52,152,219,0.3)",
  border: "1px solid rgba(52,152,219,0.5)",
  borderRadius: 4,
  color: "#3498db",
  padding: "4px 10px",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: 12,
};

const btnSecondary: React.CSSProperties = {
  flex: 1,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4,
  color: "#888",
  padding: "4px 10px",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: 12,
};
