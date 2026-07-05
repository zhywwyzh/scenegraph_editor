import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import type { RefObject } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { AreaBox } from "./components/AreaBoxes";
import { AreaEdges } from "./components/AreaEdges";
import { AreaCenters } from "./components/AreaCenters";
import { PolyhedraAll } from "./components/PolyhedraAll";
import { PolyMesh } from "./components/PolyMesh";
import { TopologicalNodes } from "./components/TopologicalNodes";
import { TopologicalEdges } from "./components/TopologicalEdges";
import { WorldAxes } from "./components/WorldAxes";
import { EditToolbar } from "./components/EditToolbar";
import { ExportDiffPanel } from "./components/ExportDiffPanel";
import { NodePropertyPanel } from "./components/NodePropertyPanel";
import { loadSceneGraph } from "./lib/scene-loader";
import { pickTarget } from "./lib/picking";
import type { PickTarget } from "./lib/picking";
import {
  isConnectShortcut,
  isRedoShortcut,
  isUndoShortcut,
} from "./lib/shortcuts";
import {
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
} from "./lib/history";
import {
  emptyMutations,
  mutationCount,
  edgeKey,
  addDeletePoly,
  addRemoveEdge,
  addAddEdge,
  addMovePoly,
} from "./lib/mutations";
import type {
  SceneData,
  PreprocessedPoly,
  TopologicalNode,
  TopologicalEdge,
  Mutations,
  EditMode,
  ExportResponse,
} from "./lib/types";

// ---- layers ----

interface Layers {
  areas: boolean;
  areaEdges: boolean;
  areaCenters: boolean;
  polyPoints: boolean;
  polyWireframe: boolean;
  polyMesh: boolean;
  topoNodes: boolean;
  topoEdges: boolean;
}

type LayerKey = keyof Layers;

const EDIT_ONLY_LAYERS: Layers = {
  areas: false,
  areaEdges: false,
  areaCenters: false,
  polyPoints: false,
  polyWireframe: false,
  polyMesh: false,
  topoNodes: true,
  topoEdges: true,
};

interface ConnectionNotice {
  kind: "success" | "info" | "error";
  message: string;
}

// ---- helpers ----

function vDist(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function effectiveNodes(
  allNodes: TopologicalNode[],
  m: Mutations,
): TopologicalNode[] {
  const deleted = new Set(m.deletePolyIds);
  const moveMap = new Map(m.movePoly.map((mp) => [mp.id, mp.center]));
  return allNodes
    .filter((n) => !deleted.has(n.id))
    .map((n) => {
      const newCenter = moveMap.get(n.id);
      if (newCenter) {
        return { ...n, position: [...newCenter] };
      }
      return n;
    });
}

function effectiveEdges(
  allEdges: TopologicalEdge[],
  nodes: TopologicalNode[],
  m: Mutations,
): TopologicalEdge[] {
  const deleted = new Set(m.deletePolyIds);
  const removed = new Set(m.removeEdges.map((e) => edgeKey(e.srcId, e.dstId)));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const existing = allEdges.flatMap((e) => {
    if (deleted.has(e.srcId) || deleted.has(e.dstId)) return [];
    if (removed.has(edgeKey(e.srcId, e.dstId))) return [];
    const src = nodeMap.get(e.srcId);
    const dst = nodeMap.get(e.dstId);
    if (!src || !dst) return [];
    return [{
      ...e,
      length: vDist(src.position, dst.position),
      srcPos: src.position,
      dstPos: dst.position,
      srcColorHex: src.colorHex,
      dstColorHex: dst.colorHex,
      crossArea: src.areaId !== dst.areaId,
    }];
  });

  const added: TopologicalEdge[] = [];
  for (const ae of m.addEdges) {
    if (deleted.has(ae.srcId) || deleted.has(ae.dstId)) continue;
    const src = nodeMap.get(ae.srcId);
    const dst = nodeMap.get(ae.dstId);
    if (!src || !dst) continue;
    const key = edgeKey(ae.srcId, ae.dstId);
    if (removed.has(key)) continue;
    if (existing.some((e) => edgeKey(e.srcId, e.dstId) === key)) continue;
    if (added.some((e) => edgeKey(e.srcId, e.dstId) === key)) continue;
    added.push({
      srcId: ae.srcId,
      dstId: ae.dstId,
      length: vDist(src.position, dst.position),
      srcPos: src.position,
      dstPos: dst.position,
      srcColorHex: src.colorHex,
      dstColorHex: dst.colorHex,
      crossArea: src.areaId !== dst.areaId,
    });
  }

  return [...existing, ...added];
}

// ---- click handler (inside Canvas) ----

function ClickHandler({
  nodes,
  edges,
  editMode,
  sceneGroupRef,
  onSelectNode,
  onSelectEdge,
  onDeselectAll,
  onHoverTarget,
}: {
  nodes: TopologicalNode[];
  edges: TopologicalEdge[];
  editMode: boolean;
  sceneGroupRef: RefObject<THREE.Group | null>;
  onSelectNode: (id: number, additive: boolean) => void;
  onSelectEdge: (key: string) => void;
  onDeselectAll: () => void;
  onHoverTarget: (target: PickTarget) => void;
}) {
  const { gl, camera } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    if (!editMode) {
      onHoverTarget(null);
      canvas.style.cursor = "";
      return;
    }

    const mouseDown = new THREE.Vector2();
    const mouseUp = new THREE.Vector2();

    const targetAt = (e: MouseEvent | PointerEvent): PickTarget => {
      const sceneGroup = sceneGroupRef.current;
      if (!sceneGroup) return null;

      sceneGroup.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();
      const rect = canvas.getBoundingClientRect();
      return pickTarget({
        nodes,
        edges,
        camera,
        sceneMatrixWorld: sceneGroup.matrixWorld,
        width: rect.width,
        height: rect.height,
        pointerX: e.clientX - rect.left,
        pointerY: e.clientY - rect.top,
      });
    };

    const onDown = (e: MouseEvent) => {
      mouseDown.set(e.clientX, e.clientY);
    };

    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0) {
        onHoverTarget(null);
        canvas.style.cursor = "";
        return;
      }

      const target = targetAt(e);
      onHoverTarget(target);
      canvas.style.cursor = target ? "pointer" : "";
    };

    const onLeave = () => {
      onHoverTarget(null);
      canvas.style.cursor = "";
    };

    const onClick = (e: MouseEvent) => {
      mouseUp.set(e.clientX, e.clientY);
      if (mouseDown.distanceTo(mouseUp) > 3) return; // drag, not click

      const el = e.target as HTMLElement;
      if (
        el.closest("[data-overlay]") ||
        el.tagName === "BUTTON" ||
        el.tagName === "INPUT" ||
        el.tagName === "LABEL"
      )
        return;

      const target = targetAt(e);
      if (target?.kind === "node") {
        e.stopPropagation();
        onSelectNode(target.id, e.shiftKey || e.ctrlKey || e.metaKey);
        return;
      }
      if (target?.kind === "edge") {
        e.stopPropagation();
        onSelectEdge(target.key);
        return;
      }

      onDeselectAll();
    };

    canvas.style.cursor = "";
    canvas.addEventListener("mousedown", onDown, { capture: true });
    canvas.addEventListener("pointermove", onMove, { capture: true });
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick, { capture: true });
    return () => {
      canvas.removeEventListener("mousedown", onDown, { capture: true });
      canvas.removeEventListener("pointermove", onMove, { capture: true });
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick, { capture: true });
      canvas.style.cursor = "";
      onHoverTarget(null);
    };
  }, [
    editMode,
    nodes,
    edges,
    gl,
    camera,
    sceneGroupRef,
    onSelectNode,
    onSelectEdge,
    onDeselectAll,
    onHoverTarget,
  ]);

  return null;
}

// ---- scene ----

function Scene({
  data,
  effectiveNodes: tNodes,
  effectiveEdges: tEdges,
  effectivePolys,
  layers,
  selectedArea,
  selectedNodeIds,
  selectedEdgeKey,
  editMode,
  onSelectNode,
  onSelectEdge,
  onDeselectAll,
  meshOpacity,
}: {
  data: SceneData;
  effectiveNodes: TopologicalNode[];
  effectiveEdges: TopologicalEdge[];
  effectivePolys: PreprocessedPoly[];
  layers: Layers;
  selectedArea: number | null;
  selectedNodeIds: Set<number>;
  selectedEdgeKey: string | null;
  editMode: boolean;
  onSelectNode: (id: number, additive: boolean) => void;
  onSelectEdge: (key: string | null) => void;
  onDeselectAll: () => void;
  meshOpacity: number;
}) {
  const sceneGroupRef = useRef<THREE.Group>(null);
  const [hoverTarget, setHoverTarget] = useState<PickTarget>(null);
  const handleHoverTarget = useCallback((target: PickTarget) => {
    setHoverTarget((current) => {
      if (current === null || target === null) return current === target ? current : target;
      if (current.kind !== target.kind) return target;
      if (current.kind === "node" && target.kind === "node" && current.id === target.id) return current;
      if (current.kind === "edge" && target.kind === "edge" && current.key === target.key) return current;
      return target;
    });
  }, []);

  const areaBoxes = useMemo(
    () =>
      data.areas.map((a) => (
        <AreaBox
          key={a.id}
          area={a}
          visible={layers.areas}
          selected={a.id === selectedArea}
        />
      )),
    [data, layers.areas, selectedArea],
  );

  return (
    <Canvas style={{ width: "100%", height: "100%" }}>
      <PerspectiveCamera makeDefault position={[12, 25, 20]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 15, 5]} intensity={1.2} />

      <group ref={sceneGroupRef} rotation={[-Math.PI / 2, 0, 0]}>
        <WorldAxes />
        {areaBoxes}
        {layers.areaEdges && <AreaEdges areas={data.areas} visible />}
        {layers.areaCenters && (
          <AreaCenters areas={data.areas} visible />
        )}
        {(layers.polyPoints || layers.polyWireframe) && (
          <PolyhedraAll
            data={data}
            effectivePolys={effectivePolys}
            visible={layers.polyPoints}
            showWireframe={layers.polyWireframe}
            selectedArea={selectedArea}
          />
        )}
        {layers.polyMesh && (
          <PolyMesh
            polys={effectivePolys}
            visible
            opacity={meshOpacity}
            selectedArea={selectedArea}
          />
        )}
        {layers.topoEdges && (
          <TopologicalEdges
            edges={tEdges}
            visible
            selectedArea={selectedArea}
            selectedEdgeKey={selectedEdgeKey}
            hoveredEdgeKey={hoverTarget?.kind === "edge" ? hoverTarget.key : null}
          />
        )}
        {layers.topoNodes && (
          <TopologicalNodes
            nodes={tNodes}
            visible
            selectedArea={selectedArea}
            selectedNodeIds={selectedNodeIds}
            hoveredNodeId={hoverTarget?.kind === "node" ? hoverTarget.id : null}
          />
        )}
        {/* Click handler: processes node/edge selection. */}
        <ClickHandler
          nodes={layers.topoNodes ? tNodes : []}
          edges={layers.topoEdges ? tEdges : []}
          editMode={editMode}
          sceneGroupRef={sceneGroupRef}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          onDeselectAll={onDeselectAll}
          onHoverTarget={handleHoverTarget}
        />
      </group>

      <gridHelper args={[80, 80, "#333", "#222"]} />
      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        maxDistance={400}
        minDistance={1}
      />
    </Canvas>
  );
}

// ---- app ----

export function App() {
  const [data, setData] = useState<SceneData | null>(null);
  const [snapshot, setSnapshot] = useState<string>("");
  const [snapshots, setSnapshots] = useState<{ name: string; saved_at: string; summary: any }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState<Layers>({
    areas: true,
    areaEdges: false,
    areaCenters: false,
    polyPoints: false,
    polyWireframe: false,
    polyMesh: true,
    topoNodes: true,
    topoEdges: true,
  });
  const [selectedArea, setSelectedArea] = useState<number | null>(null);
  const [meshOpacity, setMeshOpacity] = useState(0.1);

  // Edit state
  const [editMode, setEditMode] = useState<EditMode>("view");
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<number>>(
    new Set(),
  );
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [editHistory, setEditHistory] = useState(() =>
    createHistory(emptyMutations()),
  );
  const [showDiff, setShowDiff] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [base, setBase] = useState<"saved" | "exported">("saved");
  const [connectionNotice, setConnectionNotice] =
    useState<ConnectionNotice | null>(null);

  const mutations = editHistory.present;

  const dirty = mutationCount(mutations) > 0;

  const commitEdit = useCallback(
    (update: (current: Mutations) => Mutations) => {
      setEditHistory((history) =>
        commitHistory(history, update(history.present)),
      );
    },
    [],
  );

  // Phase 1: list all snapshots
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch("/api/snapshots");
        const json = await resp.json();
        const list = json.snapshots || [];
        setSnapshots(list);
        if (list.length > 0) {
          setSnapshot(list[0].name); // triggers Phase 2
        } else {
          setError("No snapshots found");
          setLoading(false);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
  }, []);

  // Phase 2: load scene graph for selected snapshot
  useEffect(() => {
    if (!snapshot) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sceneData = await loadSceneGraph(`/api/scene-graph?snapshot=${snapshot}`);
        setData(sceneData);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [snapshot]);

  // ---- node selection ----

  const handleSelectNode = useCallback(
    (id: number, additive: boolean) => {
      setSelectedNodeIds((prev) => {
        const next = new Set(additive ? prev : []);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setSelectedEdgeKey(null);
    },
    [],
  );

  // ---- edge selection ----

  const handleSelectEdge = useCallback((key: string | null) => {
    setSelectedEdgeKey(key);
    setSelectedNodeIds(new Set());
  }, []);

  const handleDeselectAll = useCallback(() => {
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
  }, []);

  const handleConnectSelected = useCallback(() => {
    const ids = [...selectedNodeIds];
    if (ids.length !== 2) {
      setConnectionNotice({
        kind: "error",
        message: `Select exactly two nodes (currently ${ids.length})`,
      });
      return;
    }

    const [srcId, dstId] = ids;
    const key = edgeKey(srcId, dstId);
    const sourceHasEdge =
      data?.topoEdges.some((edge) => edgeKey(edge.srcId, edge.dstId) === key) ??
      false;
    const pendingRemoval = mutations.removeEdges.some(
      (edge) => edgeKey(edge.srcId, edge.dstId) === key,
    );
    const pendingAddition = mutations.addEdges.some(
      (edge) => edgeKey(edge.srcId, edge.dstId) === key,
    );

    if ((sourceHasEdge && !pendingRemoval) || pendingAddition) {
      setConnectionNotice({
        kind: "info",
        message: `Nodes ${srcId} and ${dstId} are already connected`,
      });
    } else {
      commitEdit((current) => {
        if (
          current.removeEdges.some(
            (edge) => edgeKey(edge.srcId, edge.dstId) === key,
          )
        ) {
          return {
            ...current,
            removeEdges: current.removeEdges.filter(
              (edge) => edgeKey(edge.srcId, edge.dstId) !== key,
            ),
          };
        }
        return addAddEdge(current, { srcId, dstId });
      });
      setConnectionNotice({
        kind: "success",
        message: `Connected nodes ${srcId} ↔ ${dstId}`,
      });
    }

    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(key);
  }, [commitEdit, data, mutations, selectedNodeIds]);

  useEffect(() => {
    if (!connectionNotice) return;
    const timeout = window.setTimeout(() => setConnectionNotice(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [connectionNotice]);

  const handleUndo = useCallback(() => {
    if (editHistory.past.length === 0) {
      setConnectionNotice({ kind: "info", message: "Nothing to undo" });
      return;
    }
    setEditHistory((history) => undoHistory(history));
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setConnectionNotice({ kind: "info", message: "Undo applied" });
  }, [editHistory.past.length]);

  const handleRedo = useCallback(() => {
    if (editHistory.future.length === 0) {
      setConnectionNotice({ kind: "info", message: "Nothing to redo" });
      return;
    }
    setEditHistory((history) => redoHistory(history));
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setConnectionNotice({ kind: "info", message: "Redo applied" });
  }, [editHistory.future.length]);

  // ---- keyboard ----

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      if (e.key === "Escape") {
        handleDeselectAll();
        return;
      }

      if (editMode !== "edit") return;

      if (isUndoShortcut(e)) {
        e.preventDefault();
        if (!e.repeat) handleUndo();
        return;
      }

      if (isRedoShortcut(e)) {
        e.preventDefault();
        if (!e.repeat) handleRedo();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedEdgeKey) {
          const [a, b] = selectedEdgeKey.split("_").map(Number);
          commitEdit((current) =>
            addRemoveEdge(current, { srcId: a, dstId: b }),
          );
          setSelectedEdgeKey(null);
        } else if (selectedNodeIds.size > 0) {
          commitEdit((current) => {
            let nextMutations = current;
            for (const nid of selectedNodeIds) {
              nextMutations = addDeletePoly(nextMutations, nid);
            }
            return nextMutations;
          });
          setSelectedNodeIds(new Set());
        }
        return;
      }

      if (isConnectShortcut(e)) {
        e.preventDefault();
        if (!e.repeat) handleConnectSelected();
        return;
      }

    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    editMode,
    selectedNodeIds,
    selectedEdgeKey,
    handleDeselectAll,
    handleConnectSelected,
    handleUndo,
    handleRedo,
    commitEdit,
  ]);

  // ---- edit mode toggle ----

  const handleToggleEdit = useCallback(() => {
    setEditMode((prev) => {
      if (prev === "edit") {
        // Clear selections when leaving edit mode
        setSelectedNodeIds(new Set());
        setSelectedEdgeKey(null);
        return "view";
      }
      return "edit";
    });
  }, []);

  // ---- reset ----

  const handleReset = useCallback(async () => {
    setEditHistory(createHistory(emptyMutations()));
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setBase("saved");
    if (snapshot) {
      try {
        setLoading(true);
        const freshData = await loadSceneGraph(
          `/api/scene-graph?snapshot=${snapshot}&source=saved`,
        );
        setData(freshData);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
  }, [snapshot]);

  // ---- snapshot switching ----

  const handleSwitchSnapshot = useCallback((name: string) => {
    if (name === snapshot || !name) return;
    setSnapshot(name);
    setData(null);
    setEditHistory(createHistory(emptyMutations()));
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setBase("saved");
    setError(null);
  }, [snapshot]);

  // ---- export ----

  const handleExport = useCallback(async () => {
    if (!dirty || exporting || !snapshot) return;
    setExporting(true);
    try {
      const resp = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot, mutations, base }),
      });
      const json: ExportResponse = await resp.json();
      if (!json.success) {
        setError(`Export failed: ${json.error}`);
        return;
      }
      // Reload data (will serve from exported/ now)
      const newData = await loadSceneGraph(`/api/scene-graph?snapshot=${snapshot}`);
      setData(newData);
      setEditHistory(createHistory(emptyMutations()));
      setSelectedNodeIds(new Set());
      setSelectedEdgeKey(null);
      setBase("exported");
      setError(null);
    } catch (e: any) {
      setError(`Export error: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }, [dirty, exporting, snapshot, mutations, base]);

  // ---- layer toggle ----

  const toggle = useCallback((key: LayerKey) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ---- derived effective data for display ----

  const effectiveTNodes = useMemo(
    () => (data ? effectiveNodes(data.topoNodes, mutations) : []),
    [data, mutations],
  );

  const effectiveTEdges = useMemo(
    () =>
      data
        ? effectiveEdges(data.topoEdges, effectiveTNodes, mutations)
        : [],
    [data, mutations, effectiveTNodes],
  );

  const effectivePolys = useMemo(
    () => {
      if (!data) return [];
      const deleted = new Set(mutations.deletePolyIds);
      return data.polys.filter((p) => !deleted.has(p.id));
    },
    [data, mutations],
  );

  const renderedLayers = editMode === "edit" ? EDIT_ONLY_LAYERS : layers;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {error && <ErrorBanner msg={error} />}

      {/* Edit toolbar */}
      <EditToolbar
        editMode={editMode}
        mutationCount={mutationCount(mutations)}
        dirty={dirty}
        exporting={exporting}
        showDiff={showDiff}
        onToggleEdit={handleToggleEdit}
        onReset={handleReset}
        onExport={handleExport}
        onShowDiff={() => setShowDiff(true)}
        onHideDiff={() => setShowDiff(false)}
      />

      {connectionNotice && (
        <div
          data-overlay
          role="status"
          style={{
            position: "absolute",
            top: 54,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            padding: "8px 14px",
            borderRadius: 6,
            background:
              connectionNotice.kind === "success"
                ? "rgba(20, 110, 65, 0.94)"
                : connectionNotice.kind === "error"
                  ? "rgba(150, 45, 45, 0.94)"
                  : "rgba(105, 85, 20, 0.94)",
            color: "#fff",
            fontFamily: "monospace",
            fontSize: 12,
            pointerEvents: "none",
          }}
        >
          {connectionNotice.message}
        </div>
      )}

      {/* Snapshot selector */}
      {snapshots.length > 0 && snapshot !== "" && (
        <div
          data-overlay
          style={{
            position: "absolute",
            top: 44,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 15,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: data ? "rgba(0,0,0,0.82)" : "rgba(0,0,0,0.92)",
            borderRadius: 6,
            padding: "4px 10px",
            color: "#ccc",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          <span>Snapshot:</span>
          <select
            value={snapshot || ""}
            onChange={(e) => handleSwitchSnapshot(e.target.value)}
            style={{
              background: "#222",
              color: "#ddd",
              border: "1px solid #555",
              borderRadius: 4,
              padding: "2px 6px",
              fontFamily: "monospace",
              fontSize: 12,
              maxWidth: 280,
            }}
          >
            {snapshots.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
                {s.summary?.poly_count != null
                  ? `  · ${s.summary.poly_count}p`
                  : ""}
              </option>
            ))}
          </select>
          {data && (
            <span style={{ color: "#666", fontSize: 10 }}>
              {data.polys.length}p / {data.areas.length}a /{" "}
              {data.topoEdges.length}e
            </span>
          )}
        </div>
      )}

      {editMode === "edit" && selectedNodeIds.size === 1 && (
        <NodePropertyPanel
          node={effectiveTNodes.find((n) => selectedNodeIds.has(n.id))!}
          onChangePosition={(id, center) => {
            commitEdit((current) => addMovePoly(current, id, center));
          }}
        />
      )}

      {editMode === "edit" && selectedNodeIds.size === 2 && (
        <div
          data-overlay
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 10px",
            borderRadius: 6,
            background: "rgba(0,0,0,0.82)",
            color: "#ddd",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          <span>2 nodes selected</span>
          <button type="button" onClick={handleConnectSelected}>
            Connect (E)
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Layer toggles */}
          {editMode !== "edit" && (
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
              minWidth: 200,
              userSelect: "none",
              }}
            >
            <div
              style={{
                color: "#fff",
                fontWeight: 600,
                marginBottom: 8,
                fontSize: 13,
              }}
            >
              Layers
            </div>

            <Toggle
              label="Area Boxes"
              k="areas"
              layers={layers}
              toggle={toggle}
            />
            <Toggle
              label="Area Edges"
              k="areaEdges"
              layers={layers}
              toggle={toggle}
            />
            <Toggle
              label="Area Centers"
              k="areaCenters"
              layers={layers}
              toggle={toggle}
            />

            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>
              Polyhedra
            </div>
            <Toggle
              label="Poly Points"
              k="polyPoints"
              layers={layers}
              toggle={toggle}
            />
            <Toggle
              label="Poly Wireframe"
              k="polyWireframe"
              layers={layers}
              toggle={toggle}
            />
            <Toggle
              label="Poly Mesh"
              k="polyMesh"
              layers={layers}
              toggle={toggle}
            />
            {layers.polyMesh && (
              <div style={{ paddingLeft: 20, marginTop: 2, marginBottom: 4 }}>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={Math.round(meshOpacity * 100)}
                  onChange={(e) =>
                    setMeshOpacity(Number(e.target.value) / 100)
                  }
                  style={{
                    width: "100%",
                    accentColor: "#3498db",
                    height: 4,
                  }}
                />
                <span style={{ fontSize: 10, color: "#888" }}>
                  {Math.round(meshOpacity * 100)}%
                </span>
              </div>
            )}

            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>
              Topology Graph
            </div>
            <Toggle
              label="Topo Nodes"
              k="topoNodes"
              layers={layers}
              toggle={toggle}
            />
            <Toggle
              label="Topo Edges"
              k="topoEdges"
              layers={layers}
              toggle={toggle}
            />

            </div>
          )}

          {/* Area list */}
          <div
            data-overlay
            style={{
              position: "absolute",
              bottom: 16,
              left: 16,
              zIndex: 10,
              background: "rgba(0,0,0,0.75)",
              borderRadius: 8,
              padding: "10px 14px",
              color: "#ccc",
              fontFamily: "monospace",
              fontSize: 12,
              maxHeight: "40vh",
              overflowY: "auto",
              minWidth: 170,
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
              Areas ({data.areas.length})
            </div>
            {data.areas.map((a) => (
              <div
                key={a.id}
                onClick={() =>
                  setSelectedArea(a.id === selectedArea ? null : a.id)
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "2px 4px",
                  cursor: "pointer",
                  borderRadius: 4,
                  background:
                    a.id === selectedArea
                      ? "rgba(255,255,255,0.1)"
                      : "transparent",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    flexShrink: 0,
                    backgroundColor: a.colorHex,
                    border: "1px solid rgba(255,255,255,0.15)",
                  }}
                />
                <span>{a.roomLabel || `A${a.id}`}</span>
                <span
                  style={{ color: "#666", marginLeft: "auto", fontSize: 10 }}
                >
                  {a.polyIds.length}p
                </span>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div
            style={{
              position: "absolute",
              bottom: 16,
              right: 16,
              zIndex: 10,
              background: "rgba(0,0,0,0.6)",
              borderRadius: 6,
              padding: "6px 12px",
              color: "#888",
              fontFamily: "monospace",
              fontSize: 11,
            }}
          >
            Polys: {effectiveTNodes.length} &middot; Nodes:{" "}
            {effectiveTNodes.length} &middot; TopoEdges:{" "}
            {effectiveTEdges.length}
          </div>
        </>
      )}

      {data ? (
        <Scene
          data={data}
          effectiveNodes={effectiveTNodes}
          effectiveEdges={effectiveTEdges}
          effectivePolys={effectivePolys}
          layers={renderedLayers}
          selectedArea={selectedArea}
          selectedNodeIds={selectedNodeIds}
          selectedEdgeKey={selectedEdgeKey}
          editMode={editMode === "edit"}
          onSelectNode={handleSelectNode}
          onSelectEdge={handleSelectEdge}
          onDeselectAll={handleDeselectAll}
          meshOpacity={meshOpacity}
        />
      ) : loading ? (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            color: "#666",
            fontSize: 14,
            fontFamily: "monospace",
          }}
        >
          Loading...
        </div>
      ) : null}

      {/* Export diff panel overlay */}
      {showDiff && snapshot && (
        <ExportDiffPanel snapshot={snapshot} onClose={() => setShowDiff(false)} />
      )}
    </div>
  );
}

// ---- Toggle & ErrorBanner ----

function Toggle({
  label,
  k,
  layers,
  toggle,
}: {
  label: string;
  k: LayerKey;
  layers: Layers;
  toggle: (k: LayerKey) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "2px 0",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={layers[k]}
        onChange={() => toggle(k)}
        style={{ accentColor: "#3498db" }}
      />
      <span>{label}</span>
    </label>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 48,
        left: 16,
        zIndex: 20,
        background: "rgba(200,0,0,0.85)",
        color: "#fff",
        padding: "8px 16px",
        borderRadius: 6,
        fontSize: 13,
        fontFamily: "monospace",
      }}
    >
      {msg}
    </div>
  );
}
