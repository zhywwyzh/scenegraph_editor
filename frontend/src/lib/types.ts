/**
 * Scene Graph Data Model
 *
 *  Area ──┬── Poly (convex free-space cell)
 *         │    ├── internal vertices (white + black)
 *         │    ├── internal wireframe (vertex→vertex edgeIndices)
 *         │    ├── adjacentPolyIds   (edges[].dst_poly_id — intra-area path planning)
 *         │    ├── gatewayNodeIds    (connected_node_ids — cross-area gateways)
 *         └── neighbor_area_ids (Area→Area)
 *
 *  TopologicalNode  — poly center, top-level renderable, CRUD target
 *  TopologicalEdge  — Poly↔Poly adjacency (from edges[] + connected_node_ids[])
 *  SceneObject      — annotated object in the scene (label, position, point cloud)
 */

export interface PreprocessedArea {
  id: number;
  roomLabel: string;
  colorHex: string;
  boxMin: [number, number, number];
  boxMax: [number, number, number];
  center: [number, number, number];
  neighborIds: number[];
  polyIds: number[];
}

export interface PreprocessedPoly {
  id: number;
  areaId: number;
  colorHex: string;
  center: [number, number, number];
  /** N*3 convex-hull vertex positions (white + black) */
  positions: Float32Array;
  /** Internal wireframe: [a0,b0, a1,b1, ...] index pairs into positions[] */
  edgeIndices: Uint32Array;
  /** Adjacent poly IDs from edges[].dst_poly_id */
  adjacentPolyIds: number[];
  /** Gateway poly IDs from connected_node_ids[] */
  gatewayNodeIds: number[];
}

/** Poly center as a first-class graph node — CRUD target */
export interface TopologicalNode {
  id: number; // == polyId
  areaId: number;
  position: [number, number, number];
  colorHex: string;
}

/** Inter-node adjacency: Poly↔Poly (from edges[] + connected_node_ids[]) */
export interface TopologicalEdge {
  srcId: number;
  dstId: number;
  length: number;
  srcPos: [number, number, number];
  dstPos: [number, number, number];
  srcColorHex: string;
  dstColorHex: string;
  crossArea: boolean;
}

/** Annotated object in the scene: label, position, point-cloud reference */
export interface SceneObject {
  id: number;
  label: string;
  position: [number, number, number];
  colorHex: string;
  areaId: number;
  /** father_poly_id from edge — the poly this object sits in */
  fatherPolyId: number;
  /** Relative path to the point cloud file, e.g. "objects/object_0_cloud.pcd" */
  cloudPath: string;
}

export interface SceneData {
  areas: PreprocessedArea[];
  polys: PreprocessedPoly[];
  topoNodes: TopologicalNode[];
  topoEdges: TopologicalEdge[];
  objects: SceneObject[];
}

// ---- Mutations (sent to backend on export) ----

export interface MovePoly {
  id: number;
  center: [number, number, number];
}

export interface EdgeRef {
  srcId: number;
  dstId: number;
}

export interface CreatePoly {
  areaId: number;
  center: [number, number, number];
  size: number;
}

export interface UpdateObjectLabel {
  id: number;
  label: string;
}

export interface UpdateObjectFatherPoly {
  objectId: number;
  fatherPolyId: number;
}

export interface UpdateObjectPosition {
  id: number;
  position: [number, number, number];
}

export interface UpdateObjectId {
  oldId: number;
  newId: number;
}

export interface UpdateArea {
  id: number;
  roomLabel?: string;
  /** RGB color in 0–1 float per channel, matching the raw area.color format */
  color?: [number, number, number];
}

export interface UpdateObjectColor {
  id: number;
  /** RGB color in 0–255 integer per channel, matching the raw object.color format */
  color: [number, number, number];
}

export interface Mutations {
  deletePolyIds: number[];
  deleteAreaIds: number[];
  movePoly: MovePoly[];
  removeEdges: EdgeRef[];
  addEdges: EdgeRef[];
  createPoly: CreatePoly[];
  updateObjectLabels: UpdateObjectLabel[];
  updateObjectFatherPolys: UpdateObjectFatherPoly[];
  updateObjectPositions: UpdateObjectPosition[];
  updateObjectIds: UpdateObjectId[];
  deleteObjectIds: number[];
  /** Desired order of effective/current object ids for export */
  objectOrder: number[];
  updateAreas: UpdateArea[];
  updateObjectColors: UpdateObjectColor[];
}

export interface ExportRequest {
  snapshot: string;
  mutations: Mutations;
  base: "saved" | "exported";
}

export interface ExportResponse {
  success: boolean;
  error?: string;
}

export type EditMode = "view" | "edit";
