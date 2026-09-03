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
import { ObjectsLayer } from "./components/ObjectsLayer";
import { ObjectPropertyPanel } from "./components/ObjectPropertyPanel";
import { ObjectsListPanel } from "./components/ObjectsListPanel";
import { AddNodePanel } from "./components/AddNodePanel";
import { PointCloudLayer, type PcdColorScheme, SCHEME_LABELS } from "./components/PointCloudLayer";
import { loadSceneGraph } from "./lib/scene-loader";
import { loadPcd } from "./lib/pcd-loader";
import { logEvent } from "./lib/logger";
import { pickTarget } from "./lib/picking";
import type { PickTarget, PickKind } from "./lib/picking";
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
  addUpdateObjectLabel,
  addUpdateObjectFatherPoly,
  addUpdateObjectId,
  addDeleteObject,
  addCreatePoly,
  addUpdateObjectOrder,
} from "./lib/mutations";
import type {
  SceneData,
  PreprocessedPoly,
  TopologicalNode,
  TopologicalEdge,
  SceneObject,
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
  objects: boolean;
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
  objects: true,
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

function makeSyntheticNode(
  center: [number, number, number],
  areaId: number,
  id: number,
): TopologicalNode {
  return { id, areaId, position: center, colorHex: "#3498db" };
}

function effectiveNodes(
  allNodes: TopologicalNode[],
  m: Mutations,
): TopologicalNode[] {
  const deleted = new Set(m.deletePolyIds);
  const moveMap = new Map(m.movePoly.map((mp) => [mp.id, mp.center]));

  const existing = allNodes
    .filter((n) => !deleted.has(n.id))
    .map((n) => {
      const newCenter = moveMap.get(n.id);
      if (newCenter) {
        return { ...n, position: [newCenter[0], newCenter[1], newCenter[2]] as [number, number, number] };
      }
      return n;
    });

  // Synthesise display nodes for pending createPoly mutations
  let tempId = -1;
  const created: TopologicalNode[] = [];
  for (const cp of m.createPoly) {
    created.push(makeSyntheticNode(cp.center as [number, number, number], cp.areaId, tempId--));
  }

  return [...existing, ...created];
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

function effectiveObjects(
  allObjects: SceneObject[],
  m: Mutations,
): SceneObject[] {
  // Apply id renames as a flat injective mapping originalId → finalId.
  // addUpdateObjectId already resolves effective ids back to the original
  // id, so each entry is independent and must NOT be chain-followed here
  // (chain-following collapses swaps/cycles into duplicate ids).
  const idMap = new Map<number, number>();
  for (const r of m.updateObjectIds) {
    idMap.set(r.oldId, r.newId);
  }
  const deleted = new Set(m.deleteObjectIds);
  const labelMap = new Map(m.updateObjectLabels.map((u) => [u.id, u.label]));
  const fatherPolyMap = new Map(m.updateObjectFatherPolys.map((u) => [u.objectId, u.fatherPolyId]));
  const result = allObjects
    .filter((o) => {
      const id = idMap.get(o.id) ?? o.id;
      return !deleted.has(id);
    })
    .map((o) => {
      let obj = o;
      const newId = idMap.get(o.id);
      if (newId !== undefined) {
        obj = { ...obj, id: newId };
      }
      const newLabel = labelMap.get(obj.id);
      if (newLabel !== undefined) {
        obj = { ...obj, label: newLabel };
      }
      const newFather = fatherPolyMap.get(obj.id);
      if (newFather !== undefined) {
        obj = { ...obj, fatherPolyId: newFather };
      }
      return obj;
    });

  // Apply the user-defined object order (effective/current ids) when set.
  const order = m.objectOrder ?? [];
  if (order.length > 0) {
    const byId = new Map(result.map((o) => [o.id, o]));
    const ordered: SceneObject[] = [];
    for (const id of order) {
      const obj = byId.get(id);
      if (obj) {
        ordered.push(obj);
        byId.delete(id);
      }
    }
    // Preserve any objects not present in objectOrder (e.g. after rename
    // edge cases) in their current relative order.
    for (const obj of result) {
      if (byId.has(obj.id)) ordered.push(obj);
    }
    return ordered;
  }
  return result;
}

// ---- click handler (inside Canvas) ----

function ClickHandler({
  nodes,
  edges,
  objects,
  editMode,
  sceneGroupRef,
  onSelectNode,
  onSelectEdge,
  onSelectObject,
  onDeselectAll,
  onHoverTarget,
  selectableKinds,
}: {
  nodes: TopologicalNode[];
  edges: TopologicalEdge[];
  objects: SceneObject[];
  editMode: boolean;
  sceneGroupRef: RefObject<THREE.Group | null>;
  onSelectNode: (id: number, additive: boolean) => void;
  onSelectEdge: (key: string) => void;
  onSelectObject: (id: number, additive: boolean) => void;
  onDeselectAll: () => void;
  onHoverTarget: (target: PickTarget) => void;
  selectableKinds: Set<PickKind>;
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
        objects,
        selectableKinds,
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
      if (target?.kind === "object") {
        e.stopPropagation();
        onSelectObject(target.id, e.shiftKey || e.ctrlKey || e.metaKey);
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
    objects,
    gl,
    camera,
    sceneGroupRef,
    onSelectNode,
    onSelectEdge,
    onSelectObject,
    onDeselectAll,
    onHoverTarget,
    selectableKinds,
  ]);

  return null;
}

// ---- scene ----

function Scene({
  data,
  effectiveNodes: tNodes,
  effectiveEdges: tEdges,
  effectivePolys,
  effectiveObjects: tObjects,
  layers,
  selectedArea,
  selectedNodeIds,
  selectedEdgeKey,
  selectedObjectIds,
  editMode,
  onSelectNode,
  onSelectEdge,
  onSelectObject,
  onDeselectAll,
  meshOpacity,
  pcdLayers,
  pcdPointSize,
  pcdColorScheme,
  nodeSize,
  topoEdgeThickness,
  objectSize,
  objectLineThickness,
  selectableKinds,
}: {
  data: SceneData;
  effectiveNodes: TopologicalNode[];
  effectiveEdges: TopologicalEdge[];
  effectivePolys: PreprocessedPoly[];
  effectiveObjects: SceneObject[];
  layers: Layers;
  selectedArea: number | null;
  selectedNodeIds: Set<number>;
  selectedEdgeKey: string | null;
  selectedObjectIds: Set<number>;
  editMode: boolean;
  onSelectNode: (id: number, additive: boolean) => void;
  onSelectEdge: (key: string | null) => void;
  onSelectObject: (id: number, additive: boolean) => void;
  onDeselectAll: () => void;
  meshOpacity: number;
  pcdLayers: { key: string; positions: Float32Array; colorHex: string }[];
  pcdPointSize: number;
  pcdColorScheme: PcdColorScheme;
  nodeSize: number;
  topoEdgeThickness: number;
  objectSize: number;
  objectLineThickness: number;
  selectableKinds: Set<PickKind>;
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

  // Node lookup map for object→father_poly connection lines
  const nodeMap = useMemo(
    () => new Map(tNodes.map((n) => [n.id, n])),
    [tNodes],
  );

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
            edgeThickness={topoEdgeThickness}
          />
        )}
        {layers.topoNodes && (
          <TopologicalNodes
            nodes={tNodes}
            visible
            selectedArea={selectedArea}
            selectedNodeIds={selectedNodeIds}
            hoveredNodeId={hoverTarget?.kind === "node" ? hoverTarget.id : null}
            nodeSize={nodeSize}
          />
        )}
        {layers.objects && (
          <ObjectsLayer
            objects={tObjects}
            nodeMap={nodeMap}
            visible
            selectedArea={selectedArea}
            selectedObjectIds={selectedObjectIds}
            hoveredObjectId={hoverTarget?.kind === "object" ? hoverTarget.id : null}
            objectSize={objectSize}
            lineThickness={objectLineThickness}
          />
        )}
        {pcdLayers.map((layer) => (
          <PointCloudLayer
            key={layer.key}
            positions={layer.positions}
            colorHex={layer.colorHex}
            pointSize={pcdPointSize}
            colorScheme={pcdColorScheme}
          />
        ))}
        {/* Click handler: processes node/edge/object selection. */}
        <ClickHandler
          nodes={layers.topoNodes ? tNodes : []}
          edges={layers.topoEdges ? tEdges : []}
          objects={layers.objects ? tObjects : []}
          editMode={editMode}
          sceneGroupRef={sceneGroupRef}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          onSelectObject={onSelectObject}
          onDeselectAll={onDeselectAll}
          onHoverTarget={handleHoverTarget}
          selectableKinds={selectableKinds}
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

function useLocalStorageState<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(`sge_${key}`);
      if (stored !== null) return JSON.parse(stored) as T;
    } catch {}
    return fallback;
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try { localStorage.setItem(`sge_${key}`, JSON.stringify(v)); } catch {}
    },
    [key],
  );
  return [value, set];
}

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
    objects: true,
  });
  const [selectedArea, setSelectedArea] = useState<number | null>(null);
  const [meshOpacity, setMeshOpacity] = useState(0.1);

  // Edit state
  const [editMode, setEditMode] = useState<EditMode>("view");
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<number>>(
    new Set(),
  );
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [selectedObjectIds, setSelectedObjectIds] = useState<Set<number>>(
    new Set(),
  );
  const [editHistory, setEditHistory] = useState(() =>
    createHistory(emptyMutations()),
  );
  const [showDiff, setShowDiff] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [base, setBase] = useState<"saved" | "exported">("saved");
  const [connectionNotice, setConnectionNotice] =
    useState<ConnectionNotice | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);

  // PCD point cloud loading
  // null = none, "all" = all objects, "scene:NAME" = scene PCD, number = specific object
  const [selectedPcd, setSelectedPcd] = useState<string | null>(null);
  const [pcdLayers, setPcdLayers] = useState<{ key: string; positions: Float32Array; colorHex: string }[]>([]);
  const [pcdLoading, setPcdLoading] = useState(false);
  const [scenePcds, setScenePcds] = useState<string[]>([]);

  // Display controls
  const [nodeSize, setNodeSize] = useLocalStorageState("disp_nodeSize", 0.12);
  const [topoEdgeThickness, setTopoEdgeThickness] = useLocalStorageState("disp_topoEdge", 1);
  const [objectSize, setObjectSize] = useLocalStorageState("disp_objSize", 0.15);
  const [objectLineThickness, setObjectLineThickness] = useLocalStorageState("disp_objLine", 0.04);
  const [pcdColorScheme, setPcdColorScheme] = useLocalStorageState<PcdColorScheme>("disp_pcdScheme", "flat");
  const [pcdPointSize, setPcdPointSize] = useLocalStorageState("disp_pcdPtSize", 0.06);

  // Selection filter
  const [selectableKinds, setSelectableKinds] = useState<Set<PickKind>>(
    new Set(["node", "edge", "object"] as PickKind[]),
  );
  const toggleSelectable = useCallback((k: PickKind) => {
    setSelectableKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  // Fetch available scene-level PCDs
  useEffect(() => {
    fetch("/api/scene-pcds")
      .then((r) => r.json())
      .then((j) => setScenePcds((j.files || []).map((f: any) => f.name)))
      .catch(() => {});
  }, []);

  const mutations = editHistory.present;

  const dirty = mutationCount(mutations) > 0;

  // Keep a ref to the latest mutations so handleExport always sees the
  // freshest state — clicking Export blurs any focused inline input, whose
  // commit may not be visible to the click handler's closure yet.
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;

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

  // Load PCD point cloud(s) when selection changes
  useEffect(() => {
    if (selectedPcd === null || !data) {
      setPcdLayers([]);
      return;
    }

    if (selectedPcd === "all") {
      // Load all object clouds in parallel
      setPcdLoading(true);
      const objectsWithCloud = data.objects.filter((o) => o.cloudPath);
      Promise.all(
        objectsWithCloud.map((obj) =>
          loadPcd(`/api/pcd?snapshot=${encodeURIComponent(snapshot)}&path=${encodeURIComponent(obj.cloudPath)}`)
            .then((r) => ({ key: `obj-${obj.id}`, positions: r.positions, colorHex: obj.colorHex }))
            .catch((e) => {
              console.warn(`PCD load failed for object ${obj.id}:`, e);
              return null;
            })
        ),
      ).then((results) => {
        setPcdLayers(results.filter((r): r is NonNullable<typeof r> => r !== null));
        setPcdLoading(false);
      });
    } else if (selectedPcd.startsWith("scene:")) {
      // Load scene-level PCD
      const name = selectedPcd.slice(6);
      setPcdLoading(true);
      loadPcd(`/api/pcd?source=scene&name=${encodeURIComponent(name)}`)
        .then((r) => {
          setPcdLayers([{ key: "scene", positions: r.positions, colorHex: "#aaccff" }]);
          setPcdLoading(false);
        })
        .catch((e) => {
          console.warn("Scene PCD load failed:", e);
          setPcdLayers([]);
          setPcdLoading(false);
        });
    } else {
      // Load single object cloud
      const objId = Number(selectedPcd);
      const obj = data.objects.find((o) => o.id === objId);
      if (!obj || !obj.cloudPath) {
        setPcdLayers([]);
        return;
      }
      const url = `/api/pcd?snapshot=${encodeURIComponent(snapshot)}&path=${encodeURIComponent(obj.cloudPath)}`;
      setPcdLoading(true);
      loadPcd(url)
        .then((result) => {
          setPcdLayers([{ key: `obj-${obj.id}`, positions: result.positions, colorHex: obj.colorHex }]);
          setPcdLoading(false);
        })
        .catch((e) => {
          console.warn("PCD load failed:", e);
          setPcdLayers([]);
          setPcdLoading(false);
        });
    }
  }, [selectedPcd, snapshot, data]);

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
      // Keep object selection when Shift+clicking (additive) so
      // the user can select 1 object + 1 node for reconnection.
      if (!additive) setSelectedObjectIds(new Set());
    },
    [],
  );

  // ---- edge selection ----

  const handleSelectEdge = useCallback((key: string | null) => {
    setSelectedEdgeKey(key);
    setSelectedNodeIds(new Set());
    setSelectedObjectIds(new Set());
  }, []);

  // ---- object selection ----

  const handleSelectObject = useCallback(
    (id: number, additive: boolean) => {
      setSelectedObjectIds((prev) => {
        const next = new Set(additive ? prev : []);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      // Keep node selection when Shift+clicking so the user can
      // select 1 object + 1 node for reconnection.
      if (!additive) setSelectedNodeIds(new Set());
      setSelectedEdgeKey(null);
    },
    [],
  );

  const handleDeselectAll = useCallback(() => {
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setSelectedObjectIds(new Set());
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

  // ---- object ↔ node connection ----

  const handleConnectObjectToNode = useCallback(() => {
    const objIds = [...selectedObjectIds];
    const nodeIds = [...selectedNodeIds];
    if (objIds.length !== 1 || nodeIds.length !== 1) return;

    const objectId = objIds[0];
    const fatherPolyId = nodeIds[0];

    commitEdit((current) =>
      addUpdateObjectFatherPoly(current, objectId, fatherPolyId),
    );
    setConnectionNotice({
      kind: "success",
      message: `Object ${objectId} connected to Poly ${fatherPolyId}`,
    });
    setSelectedObjectIds(new Set());
    setSelectedNodeIds(new Set());
  }, [commitEdit, selectedObjectIds, selectedNodeIds]);

  useEffect(() => {
    if (!connectionNotice) return;
    const timeout = window.setTimeout(() => setConnectionNotice(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [connectionNotice]);

  const handleUndo = useCallback(() => {
    if (editHistory.past.length === 0) {
      setConnectionNotice({ kind: "info", message: "Nothing to undo" });
      logEvent("undo ignored (empty past)");
      return;
    }
    logEvent("undo", { depth: editHistory.past.length });
    setEditHistory((history) => undoHistory(history));
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setSelectedObjectIds(new Set());
    setConnectionNotice({ kind: "info", message: "Undo applied" });
  }, [editHistory.past.length]);

  const handleRedo = useCallback(() => {
    if (editHistory.future.length === 0) {
      setConnectionNotice({ kind: "info", message: "Nothing to redo" });
      logEvent("redo ignored (empty future)");
      return;
    }
    logEvent("redo", { depth: editHistory.future.length });
    setEditHistory((history) => redoHistory(history));
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setSelectedObjectIds(new Set());
    setConnectionNotice({ kind: "info", message: "Redo applied" });
  }, [editHistory.future.length]);

  // ---- keyboard ----

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Undo/redo shortcuts must pass through even when an input is focused,
      // otherwise the browser's native per-input text undo swallows them and
      // the global edit history becomes unreachable. Blurring first commits
      // (or reverts) any pending inline edit; commitEdit/handleUndo both use
      // functional setState so the committed entry is then undone correctly.
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        if (editMode === "edit" && isUndoShortcut(e)) {
          e.preventDefault();
          (e.target as HTMLElement).blur();
          if (!e.repeat) handleUndo();
          return;
        }
        if (editMode === "edit" && isRedoShortcut(e)) {
          e.preventDefault();
          (e.target as HTMLElement).blur();
          if (!e.repeat) handleRedo();
          return;
        }
        return;
      }

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
        } else if (selectedObjectIds.size > 0) {
          commitEdit((current) => {
            let nextMutations = current;
            for (const oid of selectedObjectIds) {
              nextMutations = addDeleteObject(nextMutations, oid);
            }
            return nextMutations;
          });
          setSelectedObjectIds(new Set());
        }
        return;
      }

      if (isConnectShortcut(e)) {
        e.preventDefault();
        if (!e.repeat) handleConnectSelected();
        return;
      }

      // C = connect object to selected node
      if (e.key === "c" && !e.ctrlKey && !e.metaKey) {
        if (selectedObjectIds.size === 1 && selectedNodeIds.size === 1) {
          e.preventDefault();
          if (!e.repeat) handleConnectObjectToNode();
        }
        return;
      }

    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    editMode,
    selectedNodeIds,
    selectedEdgeKey,
    selectedObjectIds,
    handleDeselectAll,
    handleConnectSelected,
    handleConnectObjectToNode,
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
        setSelectedObjectIds(new Set());
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
    setSelectedObjectIds(new Set());
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
    setSelectedObjectIds(new Set());
    setBase("saved");
    setError(null);
  }, [snapshot]);

  // ---- export ----

  const handleExport = useCallback(async () => {
    // Read from ref: a blur-committed inline edit may be newer than the
    // `mutations` value captured in this callback's closure.
    const currentMutations = mutationsRef.current;
    if (mutationCount(currentMutations) === 0 || exporting || !snapshot) {
      logEvent("export skipped", { dirty: mutationCount(currentMutations) > 0, exporting, snapshot: !!snapshot });
      return;
    }
    setExporting(true);
    logEvent("export start", {
      snapshot,
      base,
      counts: {
        deletePolyIds: currentMutations.deletePolyIds.length,
        movePoly: currentMutations.movePoly.length,
        removeEdges: currentMutations.removeEdges.length,
        addEdges: currentMutations.addEdges.length,
        createPoly: currentMutations.createPoly.length,
        updateObjectLabels: currentMutations.updateObjectLabels.length,
        updateObjectFatherPolys: currentMutations.updateObjectFatherPolys.length,
        updateObjectIds: currentMutations.updateObjectIds.length,
        deleteObjectIds: currentMutations.deleteObjectIds.length,
      },
    });
    try {
      const resp = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot, mutations: currentMutations, base }),
      });
      const json: ExportResponse = await resp.json();
      if (!json.success) {
        setError(`Export failed: ${json.error}`);
        logEvent("export failed", { error: json.error });
        return;
      }
      logEvent("export ok", { snapshot });
      // Reload data (will serve from exported/ now)
      const newData = await loadSceneGraph(`/api/scene-graph?snapshot=${snapshot}`);
      setData(newData);
      setEditHistory(createHistory(emptyMutations()));
      setSelectedNodeIds(new Set());
      setSelectedEdgeKey(null);
      setSelectedObjectIds(new Set());
      setBase("exported");
      setError(null);
    } catch (e: any) {
      setError(`Export error: ${e.message}`);
      logEvent("export error", { error: e.message });
    } finally {
      setExporting(false);
    }
  }, [exporting, snapshot, base]);

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

  const effectiveTObjects = useMemo(
    () => (data ? effectiveObjects(data.objects, mutations) : []),
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
        onAddNode={() => setShowAddPanel(true)}
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

      {editMode === "edit" && (
        <ObjectsListPanel
          objects={effectiveTObjects}
          existingIds={effectiveTObjects.map((o) => o.id)}
          selectedIds={selectedObjectIds}
          onSelect={(id) => setSelectedObjectIds(new Set([id]))}
          onChangeId={(oldId, newId) => {
            commitEdit((current) => addUpdateObjectId(current, oldId, newId));
            setSelectedObjectIds(new Set([newId]));
          }}
          onChangeLabel={(id, label) => {
            commitEdit((current) => addUpdateObjectLabel(current, id, label));
          }}
          onChangeOrder={(order) => {
            commitEdit((current) => addUpdateObjectOrder(current, order));
          }}
        />
      )}

      {editMode === "edit" && selectedNodeIds.size === 1 && (
        <NodePropertyPanel
          node={effectiveTNodes.find((n) => selectedNodeIds.has(n.id))!}
          onChangePosition={(id, center) => {
            commitEdit((current) => addMovePoly(current, id, center));
          }}
        />
      )}

      {editMode === "edit" && selectedObjectIds.size === 1 &&
        effectiveTObjects.some((o) => selectedObjectIds.has(o.id)) && (
        <ObjectPropertyPanel
          object={effectiveTObjects.find((o) => selectedObjectIds.has(o.id))!}
          existingIds={effectiveTObjects.map((o) => o.id)}
          onChangeId={(oldId, newId) => {
            commitEdit((current) => addUpdateObjectId(current, oldId, newId));
            setSelectedObjectIds(new Set([newId]));
          }}
          onChangeLabel={(id, label) => {
            commitEdit((current) => addUpdateObjectLabel(current, id, label));
          }}
          onDelete={(id) => {
            commitEdit((current) => addDeleteObject(current, id));
            setSelectedObjectIds(new Set());
          }}
        />
      )}

      {editMode === "edit" && showAddPanel && (
        <AddNodePanel
          onAdd={(areaId, x, y, z, size) => {
            commitEdit((current) =>
              addCreatePoly(current, areaId, [x, y, z], size),
            );
            setShowAddPanel(false);
          }}
          onCancel={() => setShowAddPanel(false)}
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

      {editMode === "edit" && selectedObjectIds.size === 1 && selectedNodeIds.size === 1 && (
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
          <span>Object + Node selected</span>
          <button type="button" onClick={handleConnectObjectToNode}>
            Connect (C)
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
            <Toggle
              label="Objects"
              k="objects"
              layers={layers}
              toggle={toggle}
            />

            {/* PCD point-cloud selector */}
            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>
              Point Cloud
            </div>
            <select
              value={selectedPcd ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedPcd(v === "" ? null : v);
              }}
              style={{
                width: "100%",
                background: "#1a1a2e",
                color: "#ddd",
                border: "1px solid #555",
                borderRadius: 4,
                padding: "3px 4px",
                fontFamily: "monospace",
                fontSize: 11,
              }}
            >
              <option value="">None</option>
              <optgroup label="Scene Clouds">
                {scenePcds.map((name) => (
                  <option key={`scene:${name}`} value={`scene:${name}`}>
                    ◆ {name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All Objects">
                <option value="all">★ All Objects</option>
              </optgroup>
              <optgroup label="Per Object">
                {data.objects.map((o) => (
                  <option key={o.id} value={String(o.id)}>
                    [{o.id}] {o.label}
                  </option>
                ))}
              </optgroup>
            </select>
            {pcdLoading && (
              <div style={{ fontSize: 10, color: "#888", marginTop: 3 }}>
                Loading...
              </div>
            )}
            {pcdLayers.length > 0 && !pcdLoading && (
              <>
                <div style={{ fontSize: 10, color: "#888", marginTop: 3 }}>
                  {pcdLayers.reduce((s, l) => s + l.positions.length / 3, 0)} points
                </div>
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={Math.round(pcdPointSize * 100)}
                  onChange={(e) => setPcdPointSize(Number(e.target.value) / 100)}
                  style={{ width: "100%", accentColor: "#3498db", height: 4 }}
                />
              </>
            )}

            {/* PCD color scheme */}
            <div style={{ marginTop: 6 }}>
              <select
                value={pcdColorScheme}
                onChange={(e) => setPcdColorScheme(e.target.value as PcdColorScheme)}
                style={{
                  width: "100%",
                  background: "#1a1a2e",
                  color: "#ddd",
                  border: "1px solid #555",
                  borderRadius: 4,
                  padding: "2px 4px",
                  fontFamily: "monospace",
                  fontSize: 10,
                }}
              >
                {Object.entries(SCHEME_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {/* Display tweaks */}
            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>
              Selection Filter
            </div>
            <SelectToggle label="Nodes" kind="node" selectableKinds={selectableKinds} toggle={toggleSelectable} />
            <SelectToggle label="Edges" kind="edge" selectableKinds={selectableKinds} toggle={toggleSelectable} />
            <SelectToggle label="Objects" kind="object" selectableKinds={selectableKinds} toggle={toggleSelectable} />

            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>
              Display
            </div>
            <Slider label="Node size" value={nodeSize} min={0.02} max={0.50} step={0.01} onChange={setNodeSize} />
            <Slider label="Edge thick" value={topoEdgeThickness} min={0.5} max={4.0} step={0.5} onChange={setTopoEdgeThickness} />
            <Slider label="Object size" value={objectSize} min={0.02} max={0.50} step={0.01} onChange={setObjectSize} />
            <Slider label="Obj line" value={objectLineThickness} min={0.01} max={0.20} step={0.005} onChange={setObjectLineThickness} />

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
          effectiveObjects={effectiveTObjects}
          layers={renderedLayers}
          selectedArea={selectedArea}
          selectedNodeIds={selectedNodeIds}
          selectedEdgeKey={selectedEdgeKey}
          selectedObjectIds={selectedObjectIds}
          editMode={editMode === "edit"}
          onSelectNode={handleSelectNode}
          onSelectEdge={handleSelectEdge}
          onSelectObject={handleSelectObject}
          onDeselectAll={handleDeselectAll}
          meshOpacity={meshOpacity}
          pcdLayers={pcdLayers}
          pcdPointSize={pcdPointSize}
          pcdColorScheme={pcdColorScheme}
          nodeSize={nodeSize}
          topoEdgeThickness={topoEdgeThickness}
          objectSize={objectSize}
          objectLineThickness={objectLineThickness}
          selectableKinds={selectableKinds}
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

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginTop: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#888" }}>
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#3498db", height: 4 }}
      />
    </div>
  );
}

function SelectToggle({
  label,
  kind,
  selectableKinds,
  toggle,
}: {
  label: string;
  kind: PickKind;
  selectableKinds: Set<PickKind>;
  toggle: (k: PickKind) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "2px 0",
        cursor: "pointer",
        fontSize: 11,
      }}
    >
      <input
        type="checkbox"
        checked={selectableKinds.has(kind)}
        onChange={() => toggle(kind)}
        style={{ accentColor: "#3498db" }}
      />
      <span style={{ color: selectableKinds.has(kind) ? "#ccc" : "#555" }}>
        {label}
      </span>
    </label>
  );
}

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
