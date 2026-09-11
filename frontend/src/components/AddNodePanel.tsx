import { useState, useCallback, useEffect } from "react";

interface Props {
  onAdd: (areaId: number, x: number, y: number, z: number, size: number) => void;
  onCancel: () => void;
  /** Seed XYZ from a scene click; overrides the fields whenever it changes. */
  initialPosition?: [number, number, number];
}

function formatCoord(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : "0";
}

/**
 * Modal floating dialog for creating a new topological node (poly).
 * Centered on screen with a dim backdrop; X/Y/Z sit on one row.
 */
export function AddNodePanel({ onAdd, onCancel, initialPosition }: Props) {
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("0");
  const [areaId, setAreaId] = useState("-1");
  const [size, setSize] = useState("1.0");

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
    const nArea = Number(areaId);
    const nSize = Number(size);
    if (!isFinite(nx) || !isFinite(ny) || !isFinite(nz)) return;
    onAdd(nArea, nx, ny, nz, Math.max(0.1, nSize));
  }, [x, y, z, areaId, size, onAdd]);

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

  const smallInput: React.CSSProperties = {
    ...coordInput,
    flex: undefined,
    width: 84,
  };

  return (
    <div data-overlay style={backdrop} onClick={onCancel}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <div style={title}>Add New Node</div>

        {/* Position: X/Y/Z on one row */}
        <div style={sectionLabel}>Position</div>
        <div style={{ display: "flex", gap: 6 }}>
          <AxisField axis="X" value={x} onChange={setX} style={coordInput} />
          <AxisField axis="Y" value={y} onChange={setY} style={coordInput} />
          <AxisField axis="Z" value={z} onChange={setZ} style={coordInput} />
        </div>

        <div style={{ margin: "8px 0 6px", borderTop: "1px solid #333" }} />

        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Area ID" value={areaId} onChange={setAreaId} style={smallInput} />
          <Field label="Size" value={size} onChange={setSize} style={smallInput} />
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button type="button" onClick={handleSubmit} style={btnPrimary}>
            Create Node
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

function Field({
  label,
  value,
  onChange,
  style,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  style: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: "#aaa", fontSize: 11 }}>{label}</span>
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
