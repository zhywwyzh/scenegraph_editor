import { useState, useCallback } from "react";

interface Props {
  onAdd: (areaId: number, x: number, y: number, z: number, size: number) => void;
  onCancel: () => void;
}

/**
 * Panel for creating a new topological node (poly) at an arbitrary position.
 */
export function AddNodePanel({ onAdd, onCancel }: Props) {
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("0");
  const [areaId, setAreaId] = useState("-1");
  const [size, setSize] = useState("1.0");

  const handleSubmit = useCallback(() => {
    const nx = Number(x);
    const ny = Number(y);
    const nz = Number(z);
    const nArea = Number(areaId);
    const nSize = Number(size);
    if (!isFinite(nx) || !isFinite(ny) || !isFinite(nz)) return;
    onAdd(nArea, nx, ny, nz, Math.max(0.1, nSize));
  }, [x, y, z, areaId, size, onAdd]);

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
        top: 54,
        right: 16,
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
        Add New Node
      </div>

      <Field label="X" value={x} onChange={setX} style={inputStyle} />
      <Field label="Y" value={y} onChange={setY} style={inputStyle} />
      <Field label="Z" value={z} onChange={setZ} style={inputStyle} />

      <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />

      <Field label="Area ID" value={areaId} onChange={setAreaId} style={inputStyle} />
      <Field label="Size" value={size} onChange={setSize} style={inputStyle} />

      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button type="button" onClick={handleSubmit} style={btnPrimary}>
          Create Node
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
  style,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  style: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
      <span style={{ display: "inline-block", width: 48, color: "#aaa", fontSize: 11 }}>
        {label}
      </span>
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
