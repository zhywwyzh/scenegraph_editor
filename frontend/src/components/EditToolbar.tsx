import type { EditMode } from "../lib/types";

interface Props {
  editMode: EditMode;
  changeCount: number;
  dirty: boolean;
  exporting: boolean;
  showDiff: boolean;
  showShortcuts: boolean;
  onToggleEdit: () => void;
  onReset: () => void;
  onExport: () => void;
  onAddNode: () => void;
  onShowDiff?: () => void;
  onHideDiff?: () => void;
  onToggleShortcuts: () => void;
}

export function EditToolbar({
  editMode,
  changeCount,
  dirty,
  exporting,
  showDiff,
  showShortcuts,
  onToggleEdit,
  onReset,
  onExport,
  onAddNode,
  onShowDiff,
  onHideDiff,
  onToggleShortcuts,
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
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "monospace",
        fontSize: 14,
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
            onClick={onToggleShortcuts}
            style={showShortcuts ? btnActiveStyle : btnStyle}
            title="Toggle shortcut help panel"
          >
            Shortcuts
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

          {changeCount > 0 && (
            <span style={{ color: "#f90", fontSize: 13 }}>
              {changeCount} changes
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
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  color: "#ccc",
  padding: "5px 14px",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: 14,
};

const btnActiveStyle: React.CSSProperties = {
  ...btnStyle,
  background: "rgba(52,152,219,0.3)",
  border: "1px solid rgba(52,152,219,0.5)",
  color: "#3498db",
};
