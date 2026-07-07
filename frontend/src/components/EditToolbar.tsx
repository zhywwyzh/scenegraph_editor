import type { EditMode } from "../lib/types";

interface Props {
  editMode: EditMode;
  mutationCount: number;
  dirty: boolean;
  exporting: boolean;
  showDiff: boolean;
  onToggleEdit: () => void;
  onReset: () => void;
  onExport: () => void;
  onAddNode: () => void;
  onShowDiff?: () => void;
  onHideDiff?: () => void;
}

export function EditToolbar({
  editMode,
  mutationCount,
  dirty,
  exporting,
  showDiff,
  onToggleEdit,
  onReset,
  onExport,
  onAddNode,
  onShowDiff,
  onHideDiff,
}: Props) {
  const editing = editMode === "edit";

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        background: "rgba(0,0,0,0.85)",
        borderRadius: 8,
        padding: "6px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "monospace",
        fontSize: 12,
        userSelect: "none",
      }}
    >
      <button
        onClick={onToggleEdit}
        style={editing ? btnActiveStyle : btnStyle}
      >
        {editing ? "Editing" : "Edit"}
      </button>

      {!editing && !showDiff && onShowDiff && (
        <>
          <span style={{ color: "#888" }}>|</span>
          <button onClick={onShowDiff} style={btnStyle}>
            Diff
          </button>
        </>
      )}

      {editing && (
        <>
          <span style={{ color: "#888" }}>|</span>

          <button onClick={onAddNode} style={btnStyle} title="Add a new node at arbitrary XYZ">
            Add Node
          </button>

          <button
            onClick={onReset}
            style={btnStyle}
            title="Discard all changes and reload"
          >
            Reset
          </button>

          <button
            onClick={onExport}
            disabled={!dirty || exporting}
            style={{
              ...btnStyle,
              opacity: dirty && !exporting ? 1 : 0.4,
              cursor: dirty && !exporting ? "pointer" : "not-allowed",
            }}
          >
            {exporting ? "Exporting..." : "Export"}
          </button>

          {mutationCount > 0 && (
            <span style={{ color: "#f90", fontSize: 11 }}>
              {mutationCount} changes
            </span>
          )}
        </>
      )}

      {showDiff && onHideDiff && (
        <>
          <span style={{ color: "#888" }}>|</span>
          <button onClick={onHideDiff} style={btnActiveStyle}>
            Diff
          </button>
        </>
      )}

      {editing && (
        <span style={{ color: "#666", fontSize: 10, marginLeft: 4 }}>
          Del=delete &middot; E=connect &middot; C=obj↔node &middot; Esc=clear
        </span>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  color: "#ccc",
  padding: "3px 10px",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: 12,
};

const btnActiveStyle: React.CSSProperties = {
  ...btnStyle,
  background: "rgba(52,152,219,0.3)",
  border: "1px solid rgba(52,152,219,0.5)",
  color: "#3498db",
};
