import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import type { CSSProperties, RefObject } from "react";
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
import { AddObjectPanel } from "./components/AddObjectPanel";
import { PointCloudLayer, type PcdColorScheme, SCHEME_LABELS } from "./components/PointCloudLayer";
import { GaussianSplatLayer, splatFormatOf, type SplatFormat } from "./components/GaussianSplatLayer";
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
  addDeleteArea,
  addRemoveEdge,
  addAddEdge,
  addMovePoly,
  addUpdateObjectLabel,
  addUpdateObjectFatherPoly,
  addUpdateObjectPosition,
  addUpdateObjectId,
  addDeleteObject,
  addCreatePoly,
  addCreateObject,
  addUpdateObjectOrder,
  addUpdateArea,
  addUpdateObjectColor,
} from "./lib/mutations";
import type {
  SceneData,
  PreprocessedArea,
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

// Cap scene-level point clouds to avoid freezing the UI when parsing/rendering
// very large files (e.g. elec.pcd has 6,559,828 points).
const SCENE_PCD_MAX_POINTS = 2_000_000;

// Per-object clouds are usually smaller, but cap them too so "All Objects"
// cannot OOM the tab when many large clouds are loaded at once.
const OBJECT_PCD_MAX_POINTS = 200_000;

// Load all object clouds with bounded concurrency instead of Promise.all, so a
// single huge cloud doesn't spawn every fetch/parse at the same time.
async function loadObjectsWithLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<any>,
): Promise<any[]> {
  const results: any[] = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = await worker(items[i]);
        } catch (e) {
          results[i] = null;
        }
      }
    },
  );
  await Promise.all(runners);
  return results;
}

// Shared overlay chrome. Most floating panels share the same dark background,
// text colour and monospace font; individual panels only override what differs
// (position, radius, padding, size).
const DARK_PANEL: CSSProperties = {
  background: "rgba(0,0,0,0.82)",
  color: "#ccc",
  fontFamily: "monospace",
  // Subtle accent border + soft shadow give the floating panels a more
  // polished, "designed" feel without changing the dark/blue theme.
  border: "1px solid rgba(52,152,219,0.28)",
  boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
};

const FLOATING_OVERLAY: CSSProperties = {
  ...DARK_PANEL,
  position: "absolute",
};

const HINT_BAR: CSSProperties = {
  ...FLOATING_OVERLAY,
  bottom: 16,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 20,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "7px 10px",
  borderRadius: 6,
  color: "#ddd",
  fontSize: 12,
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

/** Convert an RGB color in 0–1 floats to a `#rrggbb` hex string. */
function rgb01ToHex(rgb: [number, number, number]): string {
  const t = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${t(rgb[0])}${t(rgb[1])}${t(rgb[2])}`;
}

/** Convert a `#rrggbb` hex string to RGB in 0–1 floats. */
function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Convert RGB in 0–255 integers to a `#rrggbb` hex string. */
function rgb255ToHex(rgb: [number, number, number]): string {
  const t = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x)))
      .toString(16)
      .padStart(2, "0");
  return `#${t(rgb[0])}${t(rgb[1])}${t(rgb[2])}`;
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

/** True when two XYZ positions are effectively equal (2-decimal editing). */
function samePosition(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  const EPS = 1e-4;
  return (
    Math.abs(a[0] - b[0]) < EPS &&
    Math.abs(a[1] - b[1]) < EPS &&
    Math.abs(a[2] - b[2]) < EPS
  );
}

/** Apply live (uncommitted) node-position previews on top of committed nodes. */
function applyNodePreview(
  nodes: TopologicalNode[],
  preview: Map<number, [number, number, number]>,
): TopologicalNode[] {
  if (preview.size === 0) return nodes;
  return nodes.map((n) => {
    const p = preview.get(n.id);
    if (!p) return n;
    return { ...n, position: [p[0], p[1], p[2]] as [number, number, number] };
  });
}

/** Apply live (uncommitted) object-position previews on top of committed objects. */
function applyObjectPreview(
  objects: SceneObject[],
  preview: Map<number, [number, number, number]>,
): SceneObject[] {
  if (preview.size === 0) return objects;
  return objects.map((o) => {
    const p = preview.get(o.id);
    if (!p) return o;
    return { ...o, position: [p[0], p[1], p[2]] as [number, number, number] };
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

function effectiveObjects(
  allObjects: SceneObject[],
  m: Mutations,
  polyAreaMap: Map<number, number>,
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
  const positionMap = new Map(
    m.updateObjectPositions.map((u) => [u.id, u.position]),
  );
  const colorMap = new Map(
    m.updateObjectColors.map((u) => [u.id, u.color]),
  );
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
        obj = {
          ...obj,
          fatherPolyId: newFather,
          areaId: polyAreaMap.get(newFather) ?? -1,
        };
      }
      const newPos = positionMap.get(obj.id);
      if (newPos !== undefined) {
        obj = { ...obj, position: [newPos[0], newPos[1], newPos[2]] as [number, number, number] };
      }
      const newColor = colorMap.get(obj.id);
      if (newColor !== undefined) {
        obj = { ...obj, colorHex: rgb255ToHex(newColor) };
      }
      return obj;
    });

  // Synthesise display objects for pending createObjects mutations. Negative
  // temporary ids keep them distinct from real objects; the backend assigns
  // fresh positive ids on export and the reload surfaces the real id.
  let tempObjId = -1;
  const created: SceneObject[] = m.createObjects.map((co) => ({
    id: tempObjId--,
    label: co.label,
    position: [...co.position] as [number, number, number],
    colorHex: rgb255ToHex(co.color),
    areaId: -1,
    fatherPolyId: -1,
    cloudPath: "",
  }));

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
    return [...ordered, ...created];
  }
  return [...result, ...created];
}

// ---- click handler (inside Canvas) ----

type DragKind = "node" | "object";

interface DragTarget {
  kind: DragKind;
  id: number;
}

interface DragSession {
  target: DragTarget;
  pointerId: number;
  startLocal: [number, number, number];
  moved: boolean;
  lastLocal: [number, number, number];
}

function ClickHandler({
  nodes,
  edges,
  objects,
  editMode,
  sceneGroupRef,
  controlsRef,
  onSelectNode,
  onSelectEdge,
  onSelectObject,
  onDoubleClickNode,
  onDoubleClickObject,
  onDeselectAll,
  onHoverTarget,
  selectableKinds,
  onDragPreview,
  onDragCommit,
  onPickPosition,
}: {
  nodes: TopologicalNode[];
  edges: TopologicalEdge[];
  objects: SceneObject[];
  editMode: boolean;
  sceneGroupRef: RefObject<THREE.Group | null>;
  controlsRef: RefObject<any>;
  onSelectNode: (id: number, additive: boolean) => void;
  onSelectEdge: (key: string) => void;
  onSelectObject: (id: number, additive: boolean) => void;
  onDoubleClickNode: (id: number) => void;
  onDoubleClickObject: (id: number) => void;
  onDeselectAll: () => void;
  onHoverTarget: (target: PickTarget) => void;
  selectableKinds: Set<PickKind>;
  onDragPreview: (
    kind: DragKind,
    id: number,
    position: [number, number, number],
  ) => void;
  onDragCommit: (
    kind: DragKind,
    id: number,
    position: [number, number, number],
  ) => void;
  onPickPosition?: (position: [number, number, number]) => void;
}) {
  const { gl, camera } = useThree();

  // Keep the latest props in a ref so the event listeners don't need to be
  // re-registered on every render. During a drag the preview position updates
  // cause the parent to re-render the node/object arrays every pointermove;
  // re-subscribing here would otherwise drop the active drag session.
  const latestRef = useRef({
    nodes,
    edges,
    objects,
    selectableKinds,
    onSelectNode,
    onSelectEdge,
    onSelectObject,
    onDoubleClickNode,
    onDoubleClickObject,
    onDeselectAll,
    onHoverTarget,
    onDragPreview,
    onDragCommit,
    onPickPosition,
  });
  latestRef.current = {
    nodes,
    edges,
    objects,
    selectableKinds,
    onSelectNode,
    onSelectEdge,
    onSelectObject,
    onDoubleClickNode,
    onDoubleClickObject,
    onDeselectAll,
    onHoverTarget,
    onDragPreview,
    onDragCommit,
    onPickPosition,
  };

  const dragRef = useRef<DragSession | null>(null);

  useEffect(() => {
    const canvas = gl.domElement;
    if (!editMode) {
      latestRef.current.onHoverTarget(null);
      canvas.style.cursor = "";
      return;
    }

    const mouseDown = new THREE.Vector2();
    const mouseUp = new THREE.Vector2();

    const targetAt = (e: MouseEvent | PointerEvent): PickTarget => {
      const sceneGroup = sceneGroupRef.current;
      if (!sceneGroup) return null;

      const latest = latestRef.current;
      sceneGroup.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();
      const rect = canvas.getBoundingClientRect();
      return pickTarget({
        nodes: latest.nodes,
        edges: latest.edges,
        objects: latest.objects,
        selectableKinds: latest.selectableKinds,
        camera,
        sceneMatrixWorld: sceneGroup.matrixWorld,
        width: rect.width,
        height: rect.height,
        pointerX: e.clientX - rect.left,
        pointerY: e.clientY - rect.top,
      });
    };

    const positionOf = (
      target: DragTarget,
    ): [number, number, number] | null => {
      const latest = latestRef.current;
      if (target.kind === "node") {
        const node = latest.nodes.find((n) => n.id === target.id);
        return node ? node.position : null;
      }
      const obj = latest.objects.find((o) => o.id === target.id);
      return obj ? obj.position : null;
    };

    // Project the pointer onto the horizontal ground plane at the dragged
    // point's current height, then map back to scene-local coordinates. This
    // keeps the height fixed while the object/node follows the cursor across
    // the floor with a 1:1, natural sensitivity.
    const groundLocalAt = (
      clientX: number,
      clientY: number,
      startLocal: [number, number, number],
    ): [number, number, number] | null => {
      const sceneGroup = sceneGroupRef.current;
      if (!sceneGroup) return null;
      sceneGroup.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();

      const worldStart = new THREE.Vector3(
        startLocal[0],
        startLocal[1],
        startLocal[2],
      ).applyMatrix4(sceneGroup.matrixWorld);
      const plane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        -worldStart.y,
      );

      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const worldCurrent = new THREE.Vector3();
      const hit = raycaster.ray.intersectPlane(plane, worldCurrent);
      if (!hit) return null;

      const localCurrent = sceneGroup.worldToLocal(worldCurrent.clone());
      return [localCurrent.x, localCurrent.y, localCurrent.z];
    };

    // Seed position for the pending "Add Node / Add Object" panel: project the
    // click onto the world ground plane (y = 0), then back to scene-local
    // coordinates. The panel keeps X/Y/Z editable so height can be fine-tuned.
    const groundY0At = (
      clientX: number,
      clientY: number,
    ): [number, number, number] | null => {
      const sceneGroup = sceneGroupRef.current;
      if (!sceneGroup) return null;
      sceneGroup.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();

      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const worldCurrent = new THREE.Vector3();
      const hit = raycaster.ray.intersectPlane(plane, worldCurrent);
      if (!hit) return null;

      const localCurrent = sceneGroup.worldToLocal(worldCurrent.clone());
      return [localCurrent.x, localCurrent.y, localCurrent.z];
    };

    const onPointerDown = (e: PointerEvent) => {
      mouseDown.set(e.clientX, e.clientY);

      const target = targetAt(e);
      if (target?.kind !== "node" && target?.kind !== "object") return;

      const position = positionOf(target);
      if (!position) return;

      dragRef.current = {
        target,
        pointerId: e.pointerId,
        startLocal: position,
        moved: false,
        lastLocal: position,
      };

      // Disable OrbitControls for this gesture so dragging a node/object moves
      // it instead of rotating the camera.
      if (controlsRef.current) controlsRef.current.enabled = false;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
    };

    // Throttle hover picking to one pick per animation frame; pointermove can
    // fire far more often than a frame and each pick is a full projection pass.
    let rafId: number | null = null;
    let lastEvent: PointerEvent | null = null;

    const applyHover = () => {
      rafId = null;
      if (!lastEvent) return;
      const e = lastEvent;
      lastEvent = null;
      const target = targetAt(e);
      latestRef.current.onHoverTarget(target);
      canvas.style.cursor = target ? "pointer" : "";
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && e.pointerId === drag.pointerId) {
        const local = groundLocalAt(e.clientX, e.clientY, drag.startLocal);
        if (local) {
          drag.moved = true;
          drag.lastLocal = local;
          latestRef.current.onDragPreview(drag.target.kind, drag.target.id, local);
        }
        return;
      }

      if (e.buttons !== 0) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        lastEvent = null;
        latestRef.current.onHoverTarget(null);
        canvas.style.cursor = "";
        return;
      }

      lastEvent = e;
      if (rafId === null) {
        rafId = requestAnimationFrame(applyHover);
      }
    };

    const finishDrag = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;

      if (controlsRef.current) controlsRef.current.enabled = true;
      try {
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch {}

      if (drag.moved) {
        latestRef.current.onDragCommit(
          drag.target.kind,
          drag.target.id,
          drag.lastLocal,
        );
      }
    };

    const onLeave = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastEvent = null;
      latestRef.current.onHoverTarget(null);
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

      // In position-pick mode (Add Node / Add Object), any click on the scene
      // seeds the panel position instead of selecting an existing target.
      if (latestRef.current.onPickPosition) {
        const local = groundY0At(e.clientX, e.clientY);
        if (local) latestRef.current.onPickPosition(local);
        return;
      }

      const target = targetAt(e);
      if (target?.kind === "node") {
        e.stopPropagation();
        latestRef.current.onSelectNode(target.id, e.shiftKey || e.ctrlKey || e.metaKey);
        return;
      }
      if (target?.kind === "edge") {
        e.stopPropagation();
        latestRef.current.onSelectEdge(target.key);
        return;
      }
      if (target?.kind === "object") {
        e.stopPropagation();
        latestRef.current.onSelectObject(target.id, e.shiftKey || e.ctrlKey || e.metaKey);
        return;
      }

      latestRef.current.onDeselectAll();
    };

    const onDoubleClick = (e: MouseEvent) => {
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
        latestRef.current.onDoubleClickNode(target.id);
        return;
      }
      if (target?.kind === "object") {
        e.stopPropagation();
        latestRef.current.onDoubleClickObject(target.id);
        return;
      }
    };

    canvas.style.cursor = "";
    canvas.addEventListener("pointerdown", onPointerDown, { capture: true });
    canvas.addEventListener("pointermove", onPointerMove, { capture: true });
    canvas.addEventListener("pointerup", finishDrag, { capture: true });
    canvas.addEventListener("pointercancel", finishDrag, { capture: true });
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick, { capture: true });
    canvas.addEventListener("dblclick", onDoubleClick, { capture: true });
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown, { capture: true });
      canvas.removeEventListener("pointermove", onPointerMove, { capture: true });
      canvas.removeEventListener("pointerup", finishDrag, { capture: true });
      canvas.removeEventListener("pointercancel", finishDrag, { capture: true });
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick, { capture: true });
      canvas.removeEventListener("dblclick", onDoubleClick, { capture: true });
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastEvent = null;
      if (dragRef.current) {
        if (controlsRef.current) controlsRef.current.enabled = true;
        dragRef.current = null;
      }
      canvas.style.cursor = "";
      latestRef.current.onHoverTarget(null);
    };
  }, [editMode, gl, camera, sceneGroupRef, controlsRef]);

  return null;
}

// ---- camera focus (double-click object in list) ----

function CameraFocusController({
  focusRequest,
  sceneGroupRef,
  controlsRef,
  objects,
  nodeMap,
}: {
  focusRequest: { id: number; nonce: number; kind: "object" | "node" } | null;
  sceneGroupRef: RefObject<THREE.Group | null>;
  controlsRef: RefObject<any>;
  objects: SceneObject[];
  nodeMap: Map<number, TopologicalNode>;
}) {
  const camera = useThree((s) => s.camera);
  const lastNonceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    if (lastNonceRef.current === focusRequest.nonce) return;
    lastNonceRef.current = focusRequest.nonce;

    const sceneGroup = sceneGroupRef.current;
    const controls = controlsRef.current;
    if (!sceneGroup || !controls) return;

    if (focusRequest.kind === "node") {
      const node = nodeMap.get(focusRequest.id);
      if (!node) return;

      sceneGroup.updateWorldMatrix(true, false);
      const nodeWorld = sceneGroup.localToWorld(
        new THREE.Vector3(
          node.position[0],
          node.position[1],
          node.position[2],
        ),
      );
      const cameraOffset = camera.position.clone().sub(controls.target);
      controls.target.copy(nodeWorld);
      camera.position.copy(nodeWorld).add(cameraOffset);
      camera.lookAt(nodeWorld);
      controls.update();
      return;
    }

    const object = objects.find((o) => o.id === focusRequest.id);
    if (!object) return;
    const node =
      object.fatherPolyId >= 0
        ? nodeMap.get(object.fatherPolyId)
        : undefined;
    if (!node) return;

    sceneGroup.updateWorldMatrix(true, false);
    const objectWorld = sceneGroup.localToWorld(
      new THREE.Vector3(
        object.position[0],
        object.position[1],
        object.position[2],
      ),
    );
    const nodeWorld = sceneGroup.localToWorld(
      new THREE.Vector3(node.position[0], node.position[1], node.position[2]),
    );

    controls.target.copy(objectWorld);
    camera.position.copy(nodeWorld);
    camera.lookAt(objectWorld);
    controls.update();
  }, [focusRequest, sceneGroupRef, controlsRef, objects, nodeMap, camera]);

  return null;
}

/**
 * Fly-style wheel navigation: scrolling translates the camera along its view
 * direction (the orbit pivot moves with it) instead of OrbitControls' dolly
 * toward a fixed target. No min/max distance limits — you can fly through
 * the scene. OrbitControls still owns rotate/pan; its own zoom is disabled.
 */
function FlyWheelController({
  controlsRef,
}: {
  controlsRef: RefObject<any>;
}) {
  const { gl, camera } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const forward = new THREE.Vector3();

    const onWheel = (e: WheelEvent) => {
      const controls = controlsRef.current;
      if (!controls) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      // Wheel deltas arrive in pixels (mode 0), lines (1) or pages (2).
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= 100;

      // Step scales with the camera→pivot distance: fast when far away,
      // fine-grained up close. Floor of 2 keeps movement alive when the
      // pivot is (almost) at the camera.
      camera.getWorldDirection(forward);
      const dist = camera.position.distanceTo(controls.target);
      const step = -dy * 0.0002 * Math.max(dist, 2);
      forward.multiplyScalar(step);
      camera.position.add(forward);
      controls.target.add(forward);
      controls.update();
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [gl, camera, controlsRef]);

  return null;
}

/**
 * FPS-style look-around: left-drag rotates the view in place (camera position
 * fixed, the orbit pivot rotates with the view direction) instead of orbiting
 * around the pivot. Entity dragging keeps priority: ClickHandler disables
 * OrbitControls for the gesture, and rotation is skipped while controls are
 * disabled. Plain left clicks still reach ClickHandler (select / pick).
 */
function LookRotateController({
  controlsRef,
  rotateSpeed = 1.5,
}: {
  controlsRef: RefObject<any>;
  rotateSpeed?: number;
}) {
  const { gl, camera } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    let active = false;
    let lastX = 0;
    let lastY = 0;
    const offset = new THREE.Vector3();
    const right = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);

    // OrbitControls must not also orbit on left-drag (touch keeps ROTATE).
    const controls0 = controlsRef.current;
    if (controls0) (controls0.mouseButtons as Record<string, number>).LEFT = -1;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType !== "mouse") return;
      const controls = controlsRef.current;
      if (!controls || !controls.enabled) return;
      active = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!active) return;
      const controls = controlsRef.current;
      // ClickHandler disables controls when an entity drag begins — bail out
      // so nodes/objects keep dragging instead of rotating the camera.
      if (!controls || !controls.enabled) {
        active = false;
        return;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (dx === 0 && dy === 0) return;

      // Same direction mapping as OrbitControls: drag right → look right,
      // drag down → look down.
      const yaw = (-2 * Math.PI * dx * rotateSpeed) / canvas.clientHeight;
      const pitch = (-2 * Math.PI * dy * rotateSpeed) / canvas.clientHeight;

      // Rotate the pivot offset about the fixed camera position.
      offset.copy(controls.target).sub(camera.position);
      offset.applyAxisAngle(UP, yaw);
      right.crossVectors(offset, UP);
      if (right.lengthSq() > 1e-8) {
        right.normalize();
        const beforeX = offset.x;
        const beforeY = offset.y;
        const beforeZ = offset.z;
        offset.applyAxisAngle(right, pitch);
        // Clamp near the poles so the view can't flip over zenith/nadir.
        if (Math.abs(offset.y / offset.length()) > 0.995) {
          offset.set(beforeX, beforeY, beforeZ);
        }
      }
      controls.target.copy(camera.position).add(offset);
      controls.update();
    };

    const end = () => {
      active = false;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [gl, camera, controlsRef, rotateSpeed]);

  return null;
}

// ---- scene ----

function Scene({
  effectiveNodes: tNodes,
  effectiveEdges: tEdges,
  effectivePolys,
  effectiveAreas,
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
  onDoubleClickNode,
  onDoubleClickObject,
  onDeselectAll,
  meshOpacity,
  pcdLayers,
  pcdPointSize,
  pcdColorScheme,
  renderMode,
  splatSrc,
  splatFormat,
  onSplatLoadingChange,
  onSplatError,
  nodeSize,
  topoEdgeThickness,
  objectSize,
  objectLineThickness,
  selectableKinds,
  focusRequest,
  onDragPreview,
  onDragCommit,
  onPickPosition,
}: {
  effectiveNodes: TopologicalNode[];
  effectiveEdges: TopologicalEdge[];
  effectivePolys: PreprocessedPoly[];
  effectiveAreas: PreprocessedArea[];
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
  onDoubleClickNode: (id: number) => void;
  onDoubleClickObject: (id: number) => void;
  onDeselectAll: () => void;
  meshOpacity: number;
  pcdLayers: { key: string; positions: Float32Array; colorHex: string }[];
  pcdPointSize: number;
  pcdColorScheme: PcdColorScheme;
  renderMode: "pointcloud" | "3dgs";
  splatSrc: string | null;
  splatFormat: SplatFormat;
  onSplatLoadingChange: (loading: boolean) => void;
  onSplatError: (message: string | null) => void;
  nodeSize: number;
  topoEdgeThickness: number;
  objectSize: number;
  objectLineThickness: number;
  selectableKinds: Set<PickKind>;
  focusRequest: { id: number; nonce: number; kind: "object" | "node" } | null;
  onDragPreview: (
    kind: "node" | "object",
    id: number,
    position: [number, number, number],
  ) => void;
  onDragCommit: (
    kind: "node" | "object",
    id: number,
    position: [number, number, number],
  ) => void;
  onPickPosition?: (position: [number, number, number]) => void;
}) {
  const sceneGroupRef = useRef<THREE.Group>(null);
  const controlsRef = useRef<any>(null);
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
      effectiveAreas.map((a) => (
        <AreaBox
          key={a.id}
          area={a}
          visible={layers.areas}
          selected={a.id === selectedArea}
        />
      )),
    [effectiveAreas, layers.areas, selectedArea],
  );

  return (
    <Canvas style={{ width: "100%", height: "100%" }}>
      <PerspectiveCamera makeDefault position={[12, 25, 20]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 15, 5]} intensity={1.2} />

      <group ref={sceneGroupRef} rotation={[-Math.PI / 2, 0, 0]}>
        <WorldAxes />
        {areaBoxes}
        {layers.areaEdges && <AreaEdges areas={effectiveAreas} visible />}
        {layers.areaCenters && (
          <AreaCenters areas={effectiveAreas} visible />
        )}
        {(layers.polyPoints || layers.polyWireframe) && (
          <PolyhedraAll
            areas={effectiveAreas}
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
        {renderMode === "pointcloud" &&
          pcdLayers.map((layer) => (
            <PointCloudLayer
              key={layer.key}
              positions={layer.positions}
              colorHex={layer.colorHex}
              pointSize={pcdPointSize}
              colorScheme={pcdColorScheme}
            />
          ))}
        {/* 3DGS mode: DropInViewer lives in the same rotated (Z-up→Y-up)
            group as the PCD layers, so coordinates stay aligned across
            render modes. Keyed by src so switching files rebuilds cleanly. */}
        {renderMode === "3dgs" && splatSrc && (
          <GaussianSplatLayer
            key={splatSrc}
            src={splatSrc}
            format={splatFormat}
            onLoadingChange={onSplatLoadingChange}
            onError={onSplatError}
          />
        )}
        {/* Click handler: processes node/edge/object selection. */}
        <ClickHandler
          nodes={layers.topoNodes ? tNodes : []}
          edges={layers.topoEdges ? tEdges : []}
          objects={layers.objects ? tObjects : []}
          editMode={editMode}
          sceneGroupRef={sceneGroupRef}
          controlsRef={controlsRef}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          onSelectObject={onSelectObject}
          onDoubleClickNode={onDoubleClickNode}
          onDoubleClickObject={onDoubleClickObject}
          onDeselectAll={onDeselectAll}
          onHoverTarget={handleHoverTarget}
          selectableKinds={selectableKinds}
          onDragPreview={onDragPreview}
          onDragCommit={onDragCommit}
          onPickPosition={onPickPosition}
        />
      </group>

      <gridHelper args={[80, 80, "#333", "#222"]} />
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.1}
        enableZoom={false}
        rotateSpeed={1.5}
      />
      <FlyWheelController controlsRef={controlsRef} />
      <LookRotateController controlsRef={controlsRef} rotateSpeed={1.5} />
      <CameraFocusController
        focusRequest={focusRequest}
        sceneGroupRef={sceneGroupRef}
        controlsRef={controlsRef}
        objects={tObjects}
        nodeMap={nodeMap}
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
    polyMesh: false,
    topoNodes: true,
    topoEdges: true,
    objects: true,
  });
  const [selectedArea, setSelectedArea] = useState<number | null>(null);
  const [meshOpacity, setMeshOpacity] = useState(0.1);

  // Edit state
  const [editMode, setEditMode] = useState<EditMode>("view");
  // Mirrors editMode for event handlers that need the current value
  // (updaters must stay pure under StrictMode double-invocation).
  const editModeRef = useRef<EditMode>(editMode);
  editModeRef.current = editMode;
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
  const [showAddObjectPanel, setShowAddObjectPanel] = useState(false);
  const [addMode, setAddMode] = useState<"node" | "object" | null>(null);
  const [pickedPosition, setPickedPosition] = useState<
    [number, number, number] | null
  >(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    id: number;
    nonce: number;
    kind: "object" | "node";
  } | null>(null);

  // Live (uncommitted) position previews. Kept outside editHistory so typing
  // / stepping an XYZ axis updates the view immediately without creating an
  // undo entry; blur / Enter still commits through the normal history path.
  const [previewObjectPositions, setPreviewObjectPositions] = useState<
    Map<number, [number, number, number]>
  >(new Map());
  const [previewNodePositions, setPreviewNodePositions] = useState<
    Map<number, [number, number, number]>
  >(new Map());

  // PCD point cloud loading
  // null = none, "all" = all objects, "scene:NAME" = scene PCD, number = specific object
  const [selectedPcd, setSelectedPcd] = useState<string | null>(null);
  const [pcdLayers, setPcdLayers] = useState<{ key: string; positions: Float32Array; colorHex: string }[]>([]);
  const [pcdLoading, setPcdLoading] = useState(false);
  const [scenePcds, setScenePcds] = useState<string[]>([]);
  // Cache parsed scene-level clouds so export reload doesn't re-parse huge files.
  const scenePcdCacheRef = useRef(new Map<string, { positions: Float32Array; colorHex: string }>());

  // Render mode (view mode only; entering edit mode forces "pointcloud").
  // Not persisted: always starts on "pointcloud" regardless of prior choice.
  const [renderMode, setRenderMode] = useState<"pointcloud" | "3dgs">(
    "pointcloud",
  );
  // Active gaussian-splat asset (a file name in pcd/). Not persisted: it is
  // auto-picked from the available list, so a deleted file can never strand
  // the app on a broken selection at startup.
  const [selectedSplat, setSelectedSplat] = useState<string | null>(null);
  const [splatLoading, setSplatLoading] = useState(false);
  const [splatError, setSplatError] = useState<string | null>(null);
  // Split the listing: .pcd stays in the point-cloud dropdown, splat formats
  // (.ply/.splat/.ksplat/.spz) populate the 3DGS selector.
  const pcdSceneFiles = useMemo(() => scenePcds.filter((n) => n.toLowerCase().endsWith(".pcd")), [scenePcds]);
  const splatFiles = useMemo(() => scenePcds.filter((n) => splatFormatOf(n) !== null), [scenePcds]);

  // Display controls
  const [nodeSize, setNodeSize] = useLocalStorageState("disp_nodeSize_v2", 0.1);
  const [topoEdgeThickness, setTopoEdgeThickness] = useLocalStorageState("disp_topoEdge_v2", 2);
  const [objectSize, setObjectSize] = useLocalStorageState("disp_objSize_v2", 0.02);
  const [objectLineThickness, setObjectLineThickness] = useLocalStorageState("disp_objLine_v2", 0.01);
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

  // Fetch available scene-level cloud/splat files
  useEffect(() => {
    fetch("/api/scene-pcds")
      .then((r) => r.json())
      .then((j) => setScenePcds((j.files || []).map((f: any) => f.name)))
      .catch((e) => console.warn("Failed to list scene pcds:", e));
  }, []);

  // 3DGS fallbacks: a renderMode="3dgs" is useless (and would show an empty
  // scene) when no splat assets exist — fall back to pointcloud. Otherwise
  // auto-pick the first splat file once, and keep the selection valid if the
  // underlying file disappears from the listing.
  useEffect(() => {
    if (renderMode === "3dgs" && scenePcds.length > 0 && splatFiles.length === 0) {
      setRenderMode("pointcloud");
    }
  }, [renderMode, scenePcds, splatFiles, setRenderMode]);

  useEffect(() => {
    if (splatFiles.length === 0) {
      setSelectedSplat(null);
      return;
    }
    setSelectedSplat((cur) => (cur && splatFiles.includes(cur) ? cur : splatFiles[0]));
  }, [splatFiles]);

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

  const setObjectPositionPreview = useCallback(
    (id: number, position: [number, number, number]) => {
      setPreviewObjectPositions((prev) => {
        const next = new Map(prev);
        next.set(id, position);
        return next;
      });
    },
    [],
  );

  const clearObjectPositionPreview = useCallback((id: number) => {
    setPreviewObjectPositions((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const setNodePositionPreview = useCallback(
    (id: number, center: [number, number, number]) => {
      setPreviewNodePositions((prev) => {
        const next = new Map(prev);
        next.set(id, center);
        return next;
      });
    },
    [],
  );

  const clearNodePositionPreview = useCallback((id: number) => {
    setPreviewNodePositions((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

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

  // Load PCD point cloud(s) when selection changes.
  // Skipped while the 3DGS renderer is active (nothing to render it into);
  // switching back to pointcloud re-runs this effect and refreshes the data.
  // Existing pcdLayers are intentionally kept so the switch back is instant.
  useEffect(() => {
    if (renderMode !== "pointcloud") return;
    if (selectedPcd === null || !data) {
      setPcdLayers([]);
      return;
    }

    if (selectedPcd === "all") {
      // Load all object clouds with bounded concurrency and per-object caps.
      setPcdLoading(true);
      const objectsWithCloud = data.objects.filter((o) => o.cloudPath);
      loadObjectsWithLimit(objectsWithCloud, 4, (obj) =>
        loadPcd(
          `/api/pcd?snapshot=${encodeURIComponent(snapshot)}&path=${encodeURIComponent(obj.cloudPath)}`,
          OBJECT_PCD_MAX_POINTS,
        )
          .then((r) => ({ key: `obj-${obj.id}`, positions: r.positions, colorHex: obj.colorHex }))
          .catch((e) => {
            console.warn(`PCD load failed for object ${obj.id}:`, e);
            return null;
          }),
      ).then((results) => {
        setPcdLayers(results.filter((r): r is NonNullable<typeof r> => r !== null));
        setPcdLoading(false);
      });
    } else if (selectedPcd.startsWith("scene:")) {
      // Load scene-level PCD
      const name = selectedPcd.slice(6);
      const cached = scenePcdCacheRef.current.get(name);
      if (cached) {
        setPcdLayers([{ key: "scene", positions: cached.positions, colorHex: cached.colorHex }]);
        return;
      }
      setPcdLoading(true);
      loadPcd(`/api/pcd?source=scene&name=${encodeURIComponent(name)}`, SCENE_PCD_MAX_POINTS)
        .then((r) => {
          const layer = { key: "scene", positions: r.positions, colorHex: "#aaccff" };
          scenePcdCacheRef.current.set(name, { positions: r.positions, colorHex: "#aaccff" });
          setPcdLayers([layer]);
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
  }, [renderMode, selectedPcd, snapshot, data]);

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

  const handleDoubleClickObject = useCallback((id: number) => {
    setSelectedObjectIds(new Set([id]));
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setFocusRequest((prev) => ({
      id,
      nonce: (prev?.nonce ?? 0) + 1,
      kind: "object",
    }));
  }, []);

  const handleDoubleClickNode = useCallback((id: number) => {
    setSelectedNodeIds(new Set([id]));
    setSelectedObjectIds(new Set());
    setSelectedEdgeKey(null);
    setFocusRequest((prev) => ({
      id,
      nonce: (prev?.nonce ?? 0) + 1,
      kind: "node",
    }));
  }, []);

  const handleDeselectAll = useCallback(() => {
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setSelectedObjectIds(new Set());
    setPreviewObjectPositions(new Map());
    setPreviewNodePositions(new Map());
  }, []);

  // ---- live dragging of nodes / objects ----

  const handleDragPreview = useCallback(
    (kind: "node" | "object", id: number, position: [number, number, number]) => {
      if (kind === "node") setNodePositionPreview(id, position);
      else setObjectPositionPreview(id, position);
    },
    [setNodePositionPreview, setObjectPositionPreview],
  );

  const handleDragCommit = useCallback(
    (kind: "node" | "object", id: number, position: [number, number, number]) => {
      if (kind === "node") {
        commitEdit((current) => addMovePoly(current, id, position));
        clearNodePositionPreview(id);
      } else {
        commitEdit((current) => addUpdateObjectPosition(current, id, position));
        clearObjectPositionPreview(id);
      }
    },
    [commitEdit, clearNodePositionPreview, clearObjectPositionPreview],
  );

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

  // Short-lived notice pinned to the right side of the edit toolbar
  // (undo/redo feedback), instead of the floating center banner.
  const [toolbarNotice, setToolbarNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!toolbarNotice) return;
    const timeout = window.setTimeout(() => setToolbarNotice(null), 2000);
    return () => window.clearTimeout(timeout);
  }, [toolbarNotice]);

  const handleUndo = useCallback(() => {
    if (editHistory.past.length === 0) {
      setToolbarNotice("Nothing to undo");
      logEvent("undo ignored (empty past)");
      return;
    }
    logEvent("undo", { depth: editHistory.past.length });
    setEditHistory((history) => undoHistory(history));
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setSelectedObjectIds(new Set());
    setToolbarNotice("Undo applied");
  }, [editHistory.past.length]);

  const handleRedo = useCallback(() => {
    if (editHistory.future.length === 0) {
      setToolbarNotice("Nothing to redo");
      logEvent("redo ignored (empty future)");
      return;
    }
    logEvent("redo", { depth: editHistory.future.length });
    setEditHistory((history) => redoHistory(history));
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setSelectedObjectIds(new Set());
    setToolbarNotice("Redo applied");
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
    // State updaters must be pure (StrictMode double-invokes them), so the
    // mode-dependent side effects run in the handler body, not inside
    // setEditMode. editModeRef mirrors the current mode for this read.
    if (editModeRef.current === "edit") {
      // Clear selections when leaving edit mode
      setSelectedNodeIds(new Set());
      setSelectedEdgeKey(null);
      setSelectedObjectIds(new Set());
      setPreviewObjectPositions(new Map());
      setPreviewNodePositions(new Map());
      setEditMode("view");
    } else {
      // The 3DGS splat is a background layer; keep the render mode as-is.
      setEditMode("edit");
    }
  }, []);

  // ---- reset ----

  const handleReset = useCallback(async () => {
    setEditHistory(createHistory(emptyMutations()));
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setSelectedObjectIds(new Set());
    setPreviewObjectPositions(new Map());
    setPreviewNodePositions(new Map());
    setBase("saved");
    setSelectedPcd(null);
    setPcdLayers([]);
    scenePcdCacheRef.current.clear();
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
    setPreviewObjectPositions(new Map());
    setPreviewNodePositions(new Map());
    setBase("saved");
    setError(null);
    setSelectedPcd(null);
    setPcdLayers([]);
    scenePcdCacheRef.current.clear();
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
        updateObjectPositions: currentMutations.updateObjectPositions.length,
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

  // Preview positions only affect what is rendered; they never enter history.
  const previewedTNodes = useMemo(
    () => applyNodePreview(effectiveTNodes, previewNodePositions),
    [effectiveTNodes, previewNodePositions],
  );

  const effectiveTEdges = useMemo(
    () =>
      data
        ? effectiveEdges(data.topoEdges, previewedTNodes, mutations)
        : [],
    [data, mutations, previewedTNodes],
  );

  const effectivePolys = useMemo(
    () => {
      if (!data) return [];
      const deleted = new Set(mutations.deletePolyIds);
      return data.polys.filter((p) => !deleted.has(p.id));
    },
    [data, mutations],
  );

  const effectiveAreas = useMemo(
    () => {
      if (!data) return [];
      const deleted = new Set(mutations.deleteAreaIds);
      const updateMap = new Map(
        mutations.updateAreas.map((u) => [u.id, u]),
      );
      return data.areas
        .filter((a) => !deleted.has(a.id))
        .map((a) => {
          const u = updateMap.get(a.id);
          if (!u) return a;
          return {
            ...a,
            roomLabel: u.roomLabel ?? a.roomLabel,
            colorHex: u.color ? rgb01ToHex(u.color) : a.colorHex,
          };
        });
    },
    [data, mutations],
  );

  const effectiveTObjects = useMemo(() => {
    if (!data) return [];
    const polyAreaMap = new Map(data.polys.map((p) => [p.id, p.areaId]));
    return effectiveObjects(data.objects, mutations, polyAreaMap);
  }, [data, mutations]);

  const previewedTObjects = useMemo(
    () => applyObjectPreview(effectiveTObjects, previewObjectPositions),
    [effectiveTObjects, previewObjectPositions],
  );

  // Count live (uncommitted) previews that actually differ from the committed
  // position. Returning a value back to its committed value removes the diff,
  // so the toolbar's "changed" indicator disappears for a round-trip edit.
  const liveChangedCount = useMemo(() => {
    let count = 0;
    for (const [id, position] of previewObjectPositions) {
      const obj = effectiveTObjects.find((o) => o.id === id);
      if (obj && !samePosition(obj.position, position)) count += 1;
    }
    for (const [id, position] of previewNodePositions) {
      const node = effectiveTNodes.find((n) => n.id === id);
      if (node && !samePosition(node.position, position)) count += 1;
    }
    return count;
  }, [
    previewObjectPositions,
    previewNodePositions,
    effectiveTObjects,
    effectiveTNodes,
  ]);

  const committedMutationCount = mutationCount(mutations);
  // Total unsaved differences shown in the toolbar: committed mutations plus
  // any live position previews that have not been committed yet.
  const changeCount = committedMutationCount + liveChangedCount;

  // Node lookup by id, for showing each object's father-poly node in the list.
  const effectiveNodeMap = useMemo(
    () => new Map(effectiveTNodes.map((n) => [n.id, n])),
    [effectiveTNodes],
  );

  // Edit mode now honors the same user-adjustable layers as view mode.
  const renderedLayers = layers;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {error && <ErrorBanner msg={error} />}

      {/* Edit toolbar */}
      <EditToolbar
        editMode={editMode}
        changeCount={changeCount}
        dirty={dirty}
        exporting={exporting}
        showDiff={showDiff}
        showShortcuts={showShortcuts}
        notice={toolbarNotice}
        onToggleEdit={handleToggleEdit}
        onReset={handleReset}
        onExport={handleExport}
        onAddNode={() => {
          setShowAddObjectPanel(false);
          setPickedPosition(null);
          setAddMode("node");
          setShowAddPanel(true);
        }}
        onAddObject={() => {
          setShowAddPanel(false);
          setPickedPosition(null);
          setAddMode("object");
          setShowAddObjectPanel(true);
        }}
        onShowDiff={() => setShowDiff(true)}
        onHideDiff={() => setShowDiff(false)}
        onToggleShortcuts={() => setShowShortcuts((v) => !v)}
      />

      {connectionNotice && (
        <div
          data-overlay
          role="status"
          style={{
            ...FLOATING_OVERLAY,
            top: 112,
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
            fontSize: 12,
            pointerEvents: "none",
          }}
        >
          {connectionNotice.message}
        </div>
      )}

      {/* Snapshot selector + scene graph summary */}
      {snapshots.length > 0 && snapshot !== "" && (
        <div
          data-overlay
          style={{
            ...FLOATING_OVERLAY,
            top: 76,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 15,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 6,
            background: data ? "rgba(0,0,0,0.82)" : "rgba(0,0,0,0.92)",
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Snapshot:</span>
            <select
              value={snapshot || ""}
              onChange={(e) => handleSwitchSnapshot(e.target.value)}
              style={{
                background: "#222",
                color: "#ddd",
                border: "1px solid #555",
                borderRadius: 4,
                padding: "4px 8px",
                fontFamily: "monospace",
                fontSize: 14,
                maxWidth: 320,
              }}
            >
              {snapshots.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {data && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 12,
                color: "#999",
                alignSelf: "center",
              }}
            >
              <span>
                <b style={{ color: "#fff" }}>{data.polys.length}</b> Polygons
              </span>
              <span>
                <b style={{ color: "#fff" }}>{data.topoEdges.length}</b> Edges
              </span>
              <span>
                <b style={{ color: "#fff" }}>{data.areas.length}</b> Areas
              </span>
            </div>
          )}
        </div>
      )}

      {editMode === "edit" && (
        <div
          data-overlay
          style={{
            position: "absolute",
            top: 54,
            right: 16,
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            width: 340,
            maxHeight: "calc(100vh - 90px)",
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          <ObjectsListPanel
            objects={effectiveTObjects}
            selectedIds={selectedObjectIds}
            onSelect={(id) => {
              if (selectedObjectIds.has(id)) {
                setSelectedObjectIds(new Set());
              } else {
                setSelectedObjectIds(new Set([id]));
              }
              setSelectedNodeIds(new Set());
            }}
            onDoubleClick={(id) => {
              setSelectedObjectIds(new Set([id]));
              setSelectedNodeIds(new Set());
              setSelectedEdgeKey(null);
              setFocusRequest((prev) => ({
                id,
                nonce: (prev?.nonce ?? 0) + 1,
                kind: "object",
              }));
            }}
            onChangeOrder={(order) => {
              commitEdit((current) => addUpdateObjectOrder(current, order));
            }}
          />

          {selectedObjectIds.size === 1 &&
            effectiveTObjects.some((o) => selectedObjectIds.has(o.id)) &&
            (() => {
              const object = effectiveTObjects.find((o) =>
                selectedObjectIds.has(o.id),
              )!;
              const linkedNode =
                object.fatherPolyId >= 0
                  ? effectiveNodeMap.get(object.fatherPolyId)
                  : undefined;
              return (
                <>
                  <ObjectPropertyPanel
                    object={object}
                    existingIds={effectiveTObjects.map((o) => o.id)}
                    onChangeId={(oldId, newId) => {
                      commitEdit((current) =>
                        addUpdateObjectId(current, oldId, newId),
                      );
                      setSelectedObjectIds(new Set([newId]));
                    }}
                    onChangeLabel={(id, label) => {
                      commitEdit((current) =>
                        addUpdateObjectLabel(current, id, label),
                      );
                    }}
                    onChangePosition={(id, position) => {
                      commitEdit((current) =>
                        addUpdateObjectPosition(current, id, position),
                      );
                      clearObjectPositionPreview(id);
                    }}
                    onPreviewPosition={setObjectPositionPreview}
                    onColor={(id, color) => {
                      commitEdit((current) =>
                        addUpdateObjectColor(current, id, color),
                      );
                    }}
                    onDelete={(id) => {
                      commitEdit((current) => addDeleteObject(current, id));
                      setSelectedObjectIds(new Set());
                    }}
                  />
                  {linkedNode && (
                    <NodePropertyPanel
                      node={linkedNode}
                      onChangePosition={(id, center) => {
                        commitEdit((current) =>
                          addMovePoly(current, id, center),
                        );
                        clearNodePositionPreview(id);
                      }}
                      onPreviewPosition={setNodePositionPreview}
                      onDelete={(id) => {
                        commitEdit((current) => addDeletePoly(current, id));
                        setSelectedNodeIds(new Set());
                      }}
                    />
                  )}
                </>
              );
            })()}

          {selectedObjectIds.size !== 1 && selectedNodeIds.size === 1 && (
            <NodePropertyPanel
              node={effectiveTNodes.find((n) => selectedNodeIds.has(n.id))!}
              onChangePosition={(id, center) => {
                commitEdit((current) => addMovePoly(current, id, center));
                clearNodePositionPreview(id);
              }}
              onPreviewPosition={setNodePositionPreview}
              onDelete={(id) => {
                commitEdit((current) => addDeletePoly(current, id));
                setSelectedNodeIds(new Set());
              }}
            />
          )}

          {/* Areas live in the same column (below objects) so the edit
              side panel is a single column instead of an awkward two-column
              layout when there are only a handful of areas. */}
          <AreaListPanel
            areas={effectiveAreas}
            selectedArea={selectedArea}
            onSelect={(id) => setSelectedArea(id)}
            onDelete={(id) => {
              commitEdit((current) => addDeleteArea(current, id));
              if (id === selectedArea) setSelectedArea(null);
            }}
            onRename={(id, label) => {
              commitEdit((current) =>
                addUpdateArea(current, { id, roomLabel: label }),
              );
            }}
            onColor={(id, color) => {
              commitEdit((current) => addUpdateArea(current, { id, color }));
            }}
          />
        </div>
      )}

      {editMode === "edit" && showAddPanel && (
        <AddNodePanel
          initialPosition={pickedPosition ?? undefined}
          onAdd={(areaId, x, y, z, size) => {
            commitEdit((current) =>
              addCreatePoly(current, areaId, [x, y, z], size),
            );
            setShowAddPanel(false);
            setAddMode(null);
            setPickedPosition(null);
          }}
          onCancel={() => {
            setShowAddPanel(false);
            setAddMode(null);
            setPickedPosition(null);
          }}
        />
      )}

      {editMode === "edit" && showAddObjectPanel && (
        <AddObjectPanel
          initialPosition={pickedPosition ?? undefined}
          onAdd={(label, position, color) => {
            commitEdit((current) =>
              addCreateObject(current, label, position, color),
            );
            setShowAddObjectPanel(false);
            setAddMode(null);
            setPickedPosition(null);
          }}
          onCancel={() => {
            setShowAddObjectPanel(false);
            setAddMode(null);
            setPickedPosition(null);
          }}
        />
      )}

      {editMode === "edit" && selectedNodeIds.size === 2 && (
        <div data-overlay style={HINT_BAR}>
          <span>2 nodes selected</span>
          <button type="button" onClick={handleConnectSelected}>
            Connect (E)
          </button>
        </div>
      )}

      {editMode === "edit" && selectedObjectIds.size === 1 && selectedNodeIds.size === 1 && (
        <div data-overlay style={HINT_BAR}>
          <span>Object + Node selected</span>
          <button type="button" onClick={handleConnectObjectToNode}>
            Connect (C)
          </button>
        </div>
      )}

      {editMode === "edit" && showShortcuts && (
        <div
          data-overlay
          style={{
            ...FLOATING_OVERLAY,
            bottom: 16,
            right: 16,
            zIndex: 10,
            borderRadius: 8,
            padding: "14px 18px",
            fontSize: 14,
            maxWidth: 360,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              color: "#fff",
              fontWeight: 600,
              marginBottom: 8,
              fontSize: 16,
            }}
          >
            Shortcuts
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              lineHeight: 1.3,
            }}
          >
            <span style={{ whiteSpace: "nowrap" }}>
              <b style={{ color: "#fff" }}>Del / Backspace</b> — 删除选中项
            </span>
            <span style={{ whiteSpace: "nowrap" }}>
              <b style={{ color: "#fff" }}>E</b> — 连接两个 node 生成 edge
            </span>
            <span style={{ whiteSpace: "nowrap" }}>
              <b style={{ color: "#fff" }}>C</b> — 连接 object 与 node
            </span>
            <span style={{ whiteSpace: "nowrap" }}>
              <b style={{ color: "#fff" }}>Esc</b> — 清空选中
            </span>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Layer toggles — visible in both view and edit mode, always in
              the original top-left position. */}
          <div
            data-overlay
            style={{
              ...FLOATING_OVERLAY,
              top: 54,
              left: 16,
              zIndex: 10,
              borderRadius: 8,
              padding: "16px 20px",
              fontSize: 14,
              minWidth: 260,
              maxHeight: "calc(100vh - 90px)",
              overflowY: "auto",
              userSelect: "none",
            }}
          >
            <div
              style={{
                color: "#fff",
                fontWeight: 600,
                marginBottom: 10,
                fontSize: 16,
              }}
            >
              Layers
            </div>

            {/* Render mode: point cloud or 3DGS gaussian splatting. */}
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
              Render Mode
            </div>
            <select
              value={renderMode}
              onChange={(e) => setRenderMode(e.target.value as "pointcloud" | "3dgs")}
              style={{
                width: "100%",
                background: "#1a1a2e",
                color: "#ddd",
                border: "1px solid #555",
                borderRadius: 4,
                padding: "3px 4px",
                fontFamily: "monospace",
                fontSize: 13,
                marginBottom: 8,
              }}
            >
              <option value="pointcloud">Point Cloud</option>
              <option value="3dgs" disabled={splatFiles.length === 0}>
                Gaussian Splatting {splatFiles.length === 0 ? "(no splat files)" : ""}
              </option>
            </select>

            {renderMode === "3dgs" && (
              <>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
                  Gaussian Splat
                </div>
                <select
                  value={selectedSplat ?? ""}
                  onChange={(e) => setSelectedSplat(e.target.value || null)}
                  style={{
                    width: "100%",
                    background: "#1a1a2e",
                    color: "#ddd",
                    border: "1px solid #555",
                    borderRadius: 4,
                    padding: "3px 4px",
                    fontFamily: "monospace",
                    fontSize: 13,
                  }}
                >
                  {splatFiles.map((name) => (
                    <option key={name} value={name}>
                      ◆ {name}
                    </option>
                  ))}
                </select>
                {splatLoading && (
                  <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>
                    Loading splat…
                  </div>
                )}
                {splatError && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#ff6b6b",
                      marginTop: 3,
                      wordBreak: "break-word",
                    }}
                  >
                    {splatError}
                  </div>
                )}
              </>
            )}

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
            <div style={{ fontSize: 12, color: "#888", marginBottom: 2 }}>
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
                <span style={{ fontSize: 12, color: "#888" }}>
                  {Math.round(meshOpacity * 100)}%
                </span>
              </div>
            )}

            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 12, color: "#888", marginBottom: 2 }}>
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

            {/* PCD point-cloud selector (point-cloud render mode only) */}
            {renderMode === "pointcloud" && (
            <>
            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
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
                fontSize: 13,
              }}
            >
              <option value="">None</option>
              <optgroup label="Scene Clouds">
                {pcdSceneFiles.map((name) => (
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
              <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>
                Loading...
              </div>
            )}
            {pcdLayers.length > 0 && !pcdLoading && (
              <>
                <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>
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
                  fontSize: 12,
                }}
              >
                {Object.entries(SCHEME_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            </>
            )}

            {/* Display tweaks */}
            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
              Selection Filter
            </div>
            <SelectToggle label="Nodes" kind="node" selectableKinds={selectableKinds} toggle={toggleSelectable} />
            <SelectToggle label="Edges" kind="edge" selectableKinds={selectableKinds} toggle={toggleSelectable} />
            <SelectToggle label="Objects" kind="object" selectableKinds={selectableKinds} toggle={toggleSelectable} />

            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
              Display
            </div>
            <Slider label="Node size" value={nodeSize} min={0.02} max={0.50} step={0.01} onChange={setNodeSize} />
            <Slider label="Edge thick" value={topoEdgeThickness} min={0.5} max={4.0} step={0.5} onChange={setTopoEdgeThickness} />
            <Slider label="Object size" value={objectSize} min={0.02} max={0.50} step={0.01} onChange={setObjectSize} />
            <Slider label="Obj line" value={objectLineThickness} min={0.01} max={0.20} step={0.005} onChange={setObjectLineThickness} />

          </div>
        </>
      )}

      {data ? (
        <Scene
          effectiveNodes={previewedTNodes}
          effectiveEdges={effectiveTEdges}
          effectivePolys={effectivePolys}
          effectiveAreas={effectiveAreas}
          effectiveObjects={previewedTObjects}
          layers={renderedLayers}
          selectedArea={selectedArea}
          selectedNodeIds={selectedNodeIds}
          selectedEdgeKey={selectedEdgeKey}
          selectedObjectIds={selectedObjectIds}
          editMode={editMode === "edit"}
          onSelectNode={handleSelectNode}
          onSelectEdge={handleSelectEdge}
          onSelectObject={handleSelectObject}
          onDoubleClickNode={handleDoubleClickNode}
          onDoubleClickObject={handleDoubleClickObject}
          onDeselectAll={handleDeselectAll}
          meshOpacity={meshOpacity}
          pcdLayers={pcdLayers}
          pcdPointSize={pcdPointSize}
          pcdColorScheme={pcdColorScheme}
          renderMode={renderMode}
          splatSrc={
            selectedSplat
              ? `/api/pcd?source=scene&name=${encodeURIComponent(selectedSplat)}`
              : null
          }
          splatFormat={selectedSplat ? (splatFormatOf(selectedSplat) ?? "ply") : "ply"}
          onSplatLoadingChange={setSplatLoading}
          onSplatError={setSplatError}
          nodeSize={nodeSize}
          topoEdgeThickness={topoEdgeThickness}
          objectSize={objectSize}
          objectLineThickness={objectLineThickness}
          selectableKinds={selectableKinds}
          focusRequest={focusRequest}
          onDragPreview={handleDragPreview}
          onDragCommit={handleDragCommit}
          onPickPosition={
            addMode ? (position) => setPickedPosition(position) : undefined
          }
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

      {/* Centered 3DGS rendering indicator */}
      {renderMode === "3dgs" && splatLoading && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            background: "rgba(0,0,0,0.75)",
            borderRadius: 8,
            padding: "12px 20px",
            color: "#fff",
            fontSize: 14,
            fontFamily: "monospace",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          正在渲染 3DGS…
        </div>
      )}

      {/* Export diff panel overlay */}
      {showDiff && snapshot && (
        <ExportDiffPanel snapshot={snapshot} onClose={() => setShowDiff(false)} />
      )}
    </div>
  );
}

// ---- Area list (edit mode, left column) ----

function AreaListPanel({
  areas,
  selectedArea,
  onSelect,
  onDelete,
  onRename,
  onColor,
}: {
  areas: PreprocessedArea[];
  selectedArea: number | null;
  onSelect: (id: number | null) => void;
  onDelete: (id: number) => void;
  onRename: (id: number, label: string) => void;
  onColor: (id: number, color: [number, number, number]) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      data-overlay
      style={{
        ...DARK_PANEL,
        borderRadius: 8,
        padding: "12px 16px",
        fontSize: 14,
        minWidth: 260,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{
            background: "transparent",
            border: "none",
            color: "#888",
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: 13,
            padding: 0,
            width: 16,
          }}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span style={{ color: "#fff", fontWeight: 600, fontSize: 15 }}>
          Areas ({areas.length})
        </span>
      </div>
      {!collapsed && (
        <>
          {areas.length === 0 && (
            <div style={{ color: "#666", fontSize: 12 }}>No areas</div>
          )}
          {areas.map((a) => (
            <AreaRow
              key={a.id}
              area={a}
              selected={a.id === selectedArea}
              onSelect={() => onSelect(a.id === selectedArea ? null : a.id)}
              onDelete={() => onDelete(a.id)}
              onRename={onRename}
              onColor={onColor}
            />
          ))}
        </>
      )}
    </div>
  );
}

function AreaRow({
  area,
  selected,
  onSelect,
  onDelete,
  onRename,
  onColor,
}: {
  area: PreprocessedArea;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (id: number, label: string) => void;
  onColor: (id: number, color: [number, number, number]) => void;
}) {
  const [nameDraft, setNameDraft] = useState(area.roomLabel);
  const [colorDraft, setColorDraft] = useState(area.colorHex);
  const nameCommittedRef = useRef(false);

  useEffect(() => {
    setNameDraft(area.roomLabel);
  }, [area.roomLabel]);
  useEffect(() => {
    setColorDraft(area.colorHex);
  }, [area.colorHex]);

  const commitName = useCallback(() => {
    const v = nameDraft.trim();
    if (!v) {
      setNameDraft(area.roomLabel);
      return;
    }
    if (v !== area.roomLabel) onRename(area.id, v);
  }, [nameDraft, area.roomLabel, area.id, onRename]);

  const commitColor = useCallback(() => {
    if (colorDraft !== area.colorHex) {
      onColor(area.id, hexToRgb01(colorDraft));
    }
  }, [colorDraft, area.colorHex, area.id, onColor]);

  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 6px",
        cursor: "pointer",
        borderRadius: 4,
        background: selected ? "rgba(255,255,255,0.1)" : "transparent",
      }}
    >
      <input
        type="color"
        value={colorDraft}
        onChange={(e) => setColorDraft(e.target.value)}
        onBlur={commitColor}
        onClick={(e) => e.stopPropagation()}
        title={`Change color of Area ${area.id}`}
        style={{
          width: 16,
          height: 16,
          borderRadius: 3,
          flexShrink: 0,
          padding: 0,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "transparent",
          cursor: "pointer",
        }}
      />
      <input
        type="text"
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={() => {
          if (nameCommittedRef.current) {
            nameCommittedRef.current = false;
            return;
          }
          commitName();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            nameCommittedRef.current = true;
            commitName();
            (e.target as HTMLInputElement).blur();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        title={`Rename Area ${area.id}`}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          color: "#ddd",
          border: "1px solid transparent",
          borderRadius: 4,
          padding: "2px 4px",
          fontFamily: "monospace",
          fontSize: 13,
        }}
      />
      <span style={{ color: "#666", fontSize: 12, flexShrink: 0 }}>
        {area.polyIds.length}p
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        style={{
          background: "rgba(180,60,60,0.15)",
          border: "1px solid rgba(220,80,80,0.5)",
          borderRadius: 4,
          color: "#e57373",
          cursor: "pointer",
          fontSize: 12,
          padding: "2px 8px",
          fontFamily: "monospace",
          flexShrink: 0,
        }}
        title={`Delete Area ${area.id} metadata only (keeps its Polys and Objects)`}
      >
        Delete
      </button>
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
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888" }}>
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
        fontSize: 13,
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
