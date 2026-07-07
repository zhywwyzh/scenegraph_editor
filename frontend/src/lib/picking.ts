import * as THREE from "three";
import type { TopologicalEdge, TopologicalNode, SceneObject } from "./types";

export const NODE_PICK_RADIUS_PX = 10;
export const EDGE_PICK_RADIUS_PX = 7;
export const OBJECT_PICK_RADIUS_PX = 10;

export type PickTarget =
  | { kind: "node"; id: number }
  | { kind: "edge"; key: string }
  | { kind: "object"; id: number }
  | null;

interface PickOptions {
  nodes: TopologicalNode[];
  edges: TopologicalEdge[];
  objects?: SceneObject[];
  camera: THREE.Camera;
  sceneMatrixWorld: THREE.Matrix4;
  width: number;
  height: number;
  pointerX: number;
  pointerY: number;
  nodeRadiusPx?: number;
  edgeRadiusPx?: number;
  objectRadiusPx?: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

interface Candidate {
  target: Exclude<PickTarget, null>;
  score: number;
  depth: number;
}

/** Project a scene-local point to canvas-local pixels. */
export function projectLocalPoint(
  point: [number, number, number],
  sceneMatrixWorld: THREE.Matrix4,
  camera: THREE.Camera,
  width: number,
  height: number,
): ProjectedPoint | null {
  const projected = new THREE.Vector3(...point)
    .applyMatrix4(sceneMatrixWorld)
    .project(camera);

  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return null;
  if (projected.z < -1 || projected.z > 1) return null;

  return {
    x: (projected.x + 1) * 0.5 * width,
    y: (1 - projected.y) * 0.5 * height,
    depth: projected.z,
  };
}

/** Pick the closest visible node or edge using zoom-independent pixel radii. */
export function pickTarget({
  nodes,
  edges,
  objects,
  camera,
  sceneMatrixWorld,
  width,
  height,
  pointerX,
  pointerY,
  nodeRadiusPx = NODE_PICK_RADIUS_PX,
  edgeRadiusPx = EDGE_PICK_RADIUS_PX,
  objectRadiusPx = OBJECT_PICK_RADIUS_PX,
}: PickOptions): PickTarget {
  if (width <= 0 || height <= 0) return null;

  let best: Candidate | null = null;

  // Cache keyed by "n_<id>" / "o_<id>" to avoid collisions between
  // nodes and objects that share the same numeric id range.
  const projCache = new Map<string, ProjectedPoint | null>();
  const projectPoint = (
    key: string,
    position: [number, number, number],
  ): ProjectedPoint | null => {
    const cached = projCache.get(key);
    if (cached !== undefined) return cached;
    const point = projectLocalPoint(
      position,
      sceneMatrixWorld,
      camera,
      width,
      height,
    );
    projCache.set(key, point);
    return point;
  };

  for (const node of nodes) {
    const point = projectPoint(`n_${node.id}`, node.position);
    if (!point) continue;

    const distance = Math.hypot(pointerX - point.x, pointerY - point.y);
    if (distance > nodeRadiusPx) continue;
    best = chooseBetter(best, {
      target: { kind: "node", id: node.id },
      score: distance / nodeRadiusPx,
      depth: point.depth,
    });
  }

  for (const edge of edges) {
    const start = projectPoint(`n_${edge.srcId}`, edge.srcPos);
    const end = projectPoint(`n_${edge.dstId}`, edge.dstPos);
    if (!start || !end) continue;

    const distance = pointToSegmentDistance(
      pointerX,
      pointerY,
      start.x,
      start.y,
      end.x,
      end.y,
    );
    if (distance > edgeRadiusPx) continue;

    best = chooseBetter(best, {
      target: { kind: "edge", key: canonicalEdgeKey(edge.srcId, edge.dstId) },
      score: distance / edgeRadiusPx,
      depth: (start.depth + end.depth) * 0.5,
    });
  }

  // Object picking — similar to node picking
  for (const obj of objects ?? []) {
    const point = projectPoint(`o_${obj.id}`, obj.position);
    if (!point) continue;

    const distance = Math.hypot(pointerX - point.x, pointerY - point.y);
    if (distance > objectRadiusPx) continue;
    best = chooseBetter(best, {
      target: { kind: "object", id: obj.id },
      score: distance / objectRadiusPx,
      depth: point.depth,
    });
  }

  return best?.target ?? null;
}

function chooseBetter(current: Candidate | null, next: Candidate): Candidate {
  if (!current) return next;
  const delta = next.score - current.score;
  if (delta < -1e-6) return next;
  if (Math.abs(delta) > 1e-6) return current;

  if (next.target.kind !== current.target.kind) {
    return next.target.kind === "node" ? next : current;
  }
  return next.depth < current.depth ? next : current;
}

function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function canonicalEdgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}
