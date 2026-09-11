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
 * Modal floating dialog for creating a new marker object.
 * Centered on screen with a dim backdrop; X/Y/Z sit on one row.
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

  const coordInput: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    background: "#1a1a2e",
    color: "#eee",
    border: "1px solid #3498db",
    borderRadius: 4,
    padding: "4px 6px",
    fontFamily: "monospace",
    fontSize: 12,
    textAlign: "right",
  };

  return (
    <div data-overlay style={backdrop} onClick={onCancel}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <div style={title}>Add New Object</div>

        <div style={sectionLabel}>Label</div>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{ ...coordInput, width: "100%", textAlign: "left", boxSizing: "border-box" }}
        />

        <div style={{ ...sectionLabel, marginTop: 8 }}>Position</div>
        <div style={{ display: "flex", gap: 6 }}>
          <AxisField axis="X" value={x} onChange={setX} style={coordInput} />
          <AxisField axis="Y" value={y} onChange={setY} style={coordInput} />
          <AxisField axis="Z" value={z} onChange={setZ} style={coordInput} />
        </div>

        <div style={{ margin: "8px 0 6px", borderTop: "1px solid #333" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#aaa", fontSize: 11 }}>Color</span>
          <input
            type="color"
            value={colorHex}
            onChange={(e) => setColorHex(e.target.value)}
            style={{
              width: 44,
              height: 26,
              borderRadius: 4,
              border: "1px solid #3498db",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
            }}
          />
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button type="button" onClick={handleSubmit} style={btnPrimary}>
            Create Object
          </button>
          <button type="button" onClick={onCancel} style={btnSecondary}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function AxisField({
  axis,
  value,
  onChange,
  style,
}: {
  axis: string;
  value: string;
  onChange: (v: string) => void;
  style: React.CSSProperties;
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ color: "#3498db", fontWeight: 600, fontSize: 11 }}>{axis}</span>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={style}
      />
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  zIndex: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const dialog: React.CSSProperties = {
  background: "rgba(10,10,18,0.95)",
  border: "1px solid rgba(52,152,219,0.4)",
  borderRadius: 10,
  padding: "16px 18px",
  color: "#ccc",
  fontFamily: "monospace",
  fontSize: 12,
  width: 280,
  userSelect: "none",
  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
};

const title: React.CSSProperties = {
  color: "#fff",
  fontWeight: 600,
  fontSize: 14,
  marginBottom: 12,
};

const sectionLabel: React.CSSProperties = {
  color: "#888",
  fontSize: 11,
  marginBottom: 5,
};

const btnPrimary: React.CSSProperties = {
  flex: 1,
  background: "rgba(52,152,219,0.3)",
  border: "1px solid rgba(52,152,219,0.5)",
  borderRadius: 4,
  color: "#3498db",
  padding: "5px 10px",
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
  padding: "5px 10px",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: 12,
};
