/**
 * Vite plugin that adds /api/export and /api/scene-graph endpoints.
 *
 * /api/export —— Applies mutations from the web editor, writes result
 *                to scene_graph_exported/<snapshot>/scene_graph.json.
 * /api/scene-graph —— Serves scene_graph.json (from exported/ if
 *                     available, otherwise from saved/).
 * /api/snapshot —— Returns the latest snapshot name.
 */
import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  renameSync,
  appendFileSync,
  rmSync,
} from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type {
  MovePoly,
  EdgeRef,
  CreatePoly,
  UpdateObjectLabel,
  UpdateObjectFatherPoly,
  UpdateObjectPosition,
  UpdateObjectId,
  Mutations,
  ExportRequest,
} from "../frontend/src/lib/types";

type V3 = [number, number, number];

// ---- JSON helpers ----

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path: string, data: any): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/**
 * A snapshot name is a single directory component (no separators, no "..").
 * Snapshot names flow directly into path joins, so we must reject anything
 * that could escape scene_graph_saved/ or scene_graph_exported/.
 */
function isValidSnapshotName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !name.includes("..") &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

/**
 * Compute an outward-facing unit normal and plane equation constant `d`
 * from three non-collinear points. plane_equation = [nx, ny, nz, d] with
 * d = -(n · p0).
 */
function computePlane(
  p0: V3,
  p1: V3,
  p2: V3,
): { normal: V3; d: number } {
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const az = p1[2] - p0[2];
  const bx = p2[0] - p0[0];
  const by = p2[1] - p0[1];
  const bz = p2[2] - p0[2];

  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz);
  if (len === 0) {
    return { normal: [0, 0, 1], d: -p0[2] };
  }
  nx /= len;
  ny /= len;
  nz /= len;
  return {
    normal: [nx, ny, nz],
    d: -(nx * p0[0] + ny * p0[1] + nz * p0[2]),
  };
}

// ---- Mutation engine ----

function applyMutations(root: any, mutations: Mutations): UpdateObjectId[] {
  applyDeletePolys(root, mutations.deletePolyIds);
  applyDeleteAreas(root, mutations.deleteAreaIds);
  applyMovePolys(root, mutations.movePoly);
  applyRemoveEdges(root, mutations.removeEdges);
  applyAddEdges(root, mutations.addEdges);
  applyCreatePolys(root, mutations.createPoly);
  // Object id renames run first — the frontend rewrites all other object
  // mutations to reference the new id, so they must run after the rename.
  const appliedRenames = applyUpdateObjectIds(root, mutations.updateObjectIds);
  applyUpdateObjectLabels(root, mutations.updateObjectLabels);
  applyUpdateObjectFatherPolys(root, mutations.updateObjectFatherPolys);
  applyUpdateObjectPositions(root, mutations.updateObjectPositions);
  applyDeleteObjects(root, mutations.deleteObjectIds);
  applyObjectOrder(root, mutations.objectOrder);
  rebuildCounters(root);
  return appliedRenames;
}

function applyDeletePolys(root: any, ids: number[]): void {
  if (ids.length === 0) return;
  const idSet = new Set(ids);

  root.polyhedrons = (root.polyhedrons || []).filter(
    (p: any) => !idSet.has(Number(p.id)),
  );

  for (const area of root.areas || []) {
    area.poly_ids = (area.poly_ids || []).filter(
      (pid: any) => !idSet.has(Number(pid)),
    );
  }

  for (const poly of root.polyhedrons || []) {
    poly.edges = (poly.edges || []).filter(
      (e: any) => !idSet.has(Number(e.dst_poly_id)),
    );
    poly.connected_node_ids = (poly.connected_node_ids || []).filter(
      (nid: any) => !idSet.has(Number(nid)),
    );
  }

  for (const obj of root.objects || []) {
    const fp = Number(obj?.edge?.father_poly_id);
    if (idSet.has(fp)) {
      if (!obj.edge) obj.edge = {};
      obj.edge.father_poly_id = -1;
    }
  }

  // Drop vertices that are no longer referenced by any remaining poly
  // (white or black vertex lists). The previous `|| true` kept every
  // vertex, leaving orphans behind after a poly delete.
  root.vertices = (root.vertices || []).filter((v: any) =>
    (root.polyhedrons || []).some(
      (p: any) =>
        (p.white_vertex_ids || []).includes(v.id) ||
        (p.black_vertex_ids || []).includes(v.id),
    ),
  );
}

/**
 * Remove area metadata only: drop the area entries listed in `ids` and
 * strip those ids from every remaining area's neighbor_area_ids. The poly
 * set (and therefore area.poly_ids) is intentionally left untouched — the
 * user only asked to delete the Area grouping, not the Polys/Objects inside.
 */
function applyDeleteAreas(root: any, ids: number[]): void {
  if (!ids || ids.length === 0) return;
  const idSet = new Set(ids.map(Number));
  root.areas = (root.areas || []).filter(
    (a: any) => !idSet.has(Number(a.id)),
  );
  for (const area of root.areas) {
    area.neighbor_area_ids = (area.neighbor_area_ids || []).filter(
      (nid: any) => !idSet.has(Number(nid)),
    );
  }
}

function applyMovePolys(root: any, moves: MovePoly[]): void {
  if (moves.length === 0) return;
  const polyMap = new Map<number, any>();
  for (const p of root.polyhedrons || []) polyMap.set(Number(p.id), p);

  for (const m of moves) {
    const poly = polyMap.get(m.id);
    if (!poly) continue;
    const oldCenter: V3 = poly.center || [0, 0, 0];
    const newCenter: V3 = m.center;
    const dx = newCenter[0] - oldCenter[0];
    const dy = newCenter[1] - oldCenter[1];
    const dz = newCenter[2] - oldCenter[2];

    poly.center = [...newCenter];
    if (poly.origin_center) {
      poly.origin_center = [
        poly.origin_center[0] + dx,
        poly.origin_center[1] + dy,
        poly.origin_center[2] + dz,
      ];
    }
    if (poly.box_min) {
      poly.box_min = [poly.box_min[0] + dx, poly.box_min[1] + dy, poly.box_min[2] + dz];
    }
    if (poly.box_max) {
      poly.box_max = [poly.box_max[0] + dx, poly.box_max[1] + dy, poly.box_max[2] + dz];
    }

    const allVertIds = new Set<number>([
      ...(poly.white_vertex_ids || []),
      ...(poly.black_vertex_ids || []),
    ]);
    const vertexMap = new Map<number, any>();
    for (const v of root.vertices || []) vertexMap.set(v.id, v);

    for (const vid of allVertIds) {
      const v = vertexMap.get(vid);
      if (!v) continue;
      v.position = [
        (v.position?.[0] ?? 0) + dx,
        (v.position?.[1] ?? 0) + dy,
        (v.position?.[2] ?? 0) + dz,
      ];
    }

    for (const fid of poly.facet_ids || []) {
      const facet = (root.facets || []).find((f: any) => f.id === fid);
      if (!facet) continue;
      if (facet.center) {
        facet.center = [facet.center[0] + dx, facet.center[1] + dy, facet.center[2] + dz];
      }
      // Recompute the plane equation / unit normal so they stay consistent
      // with the translated vertex geometry.
      const fvids = facet.vertex_ids || [];
      if (fvids.length >= 3) {
        const a = vertexMap.get(fvids[0]);
        const b = vertexMap.get(fvids[1]);
        const c = vertexMap.get(fvids[2]);
        if (a?.position && b?.position && c?.position) {
          const { normal, d } = computePlane(a.position, b.position, c.position);
          facet.out_unit_normal = normal;
          facet.plane_equation = [normal[0], normal[1], normal[2], d];
        }
      }
    }
  }
}

function applyRemoveEdges(root: any, edges: EdgeRef[]): void {
  if (edges.length === 0) return;
  const edgeSet = new Set(edges.map((e) => `${e.srcId}_${e.dstId}`));
  for (const poly of root.polyhedrons || []) {
    const pid = Number(poly.id);
    poly.edges = (poly.edges || []).filter(
      (e: any) =>
        !edgeSet.has(`${pid}_${e.dst_poly_id}`) &&
        !edgeSet.has(`${e.dst_poly_id}_${pid}`),
    );
    poly.connected_node_ids = (poly.connected_node_ids || []).filter(
      (nid: any) =>
        !edgeSet.has(`${pid}_${nid}`) && !edgeSet.has(`${nid}_${pid}`),
    );
  }
}

function applyAddEdges(root: any, edges: EdgeRef[]): void {
  if (edges.length === 0) return;
  const polyMap = new Map<number, any>();
  for (const p of root.polyhedrons || []) polyMap.set(Number(p.id), p);

  for (const e of edges) {
    const src = polyMap.get(e.srcId);
    const dst = polyMap.get(e.dstId);
    if (!src || !dst) continue;

    const sc: V3 = src.center || [0, 0, 0];
    const dc: V3 = dst.center || [0, 0, 0];
    const length = Math.sqrt(
      (dc[0] - sc[0]) ** 2 + (dc[1] - sc[1]) ** 2 + (dc[2] - sc[2]) ** 2,
    );

    addDirectedEdge(src, e.dstId, length);
    addDirectedEdge(dst, e.srcId, length);
  }
}

function addDirectedEdge(src: any, dstId: number, length: number): void {
  const exists = (src.edges || []).some(
    (edge: any) => Number(edge.dst_poly_id) === dstId,
  );
  if (exists) return;

  if (!src.edges) src.edges = [];
  src.edges.push({
      dst_poly_id: dstId,
      length,
      weight: 1.0,
      is_force_connected: false,
      path: [],
  });
}

function applyCreatePolys(root: any, creates: CreatePoly[]): void {
  if (creates.length === 0) return;

  let maxPolyId = 0;
  for (const p of root.polyhedrons || []) {
    maxPolyId = Math.max(maxPolyId, Number(p.id));
  }
  let maxVertexId = 0;
  for (const v of root.vertices || []) {
    maxVertexId = Math.max(maxVertexId, Number(v.id));
  }
  let maxFacetId = 0;
  for (const f of root.facets || []) {
    maxFacetId = Math.max(maxFacetId, Number(f.id));
  }

  const areaMap = new Map<number, any>();
  for (const a of root.areas || []) areaMap.set(Number(a.id), a);

  for (const cp of creates) {
    maxPolyId += 1;
    const polyId = maxPolyId;

    const s = cp.size * 0.5;
    const cx = cp.center[0], cy = cp.center[1], cz = cp.center[2];

    const vertDefs: V3[] = [
      [cx - s, cy - s, cz - s],
      [cx + s, cy - s, cz - s],
      [cx + s, cy + s, cz - s],
      [cx - s, cy + s, cz - s],
      [cx - s, cy - s, cz + s],
      [cx + s, cy - s, cz + s],
      [cx + s, cy + s, cz + s],
      [cx - s, cy + s, cz + s],
    ];

    const vids: number[] = [];
    for (let i = 0; i < 8; i++) {
      maxVertexId += 1;
      vids.push(maxVertexId);
      if (!root.vertices) root.vertices = [];
      root.vertices.push({
        id: maxVertexId,
        position: [...vertDefs[i]],
        connected_vertex_ids: [],
        type: 0,
        is_critical: false,
        is_visited: false,
      });
    }

    const [v0, v1, v2, v3, v4, v5, v6, v7] = vids;
    const triFaces: [number, number, number][] = [
      [v0, v2, v1], [v0, v3, v2],
      [v4, v5, v6], [v4, v6, v7],
      [v0, v1, v5], [v0, v5, v4],
      [v2, v3, v7], [v2, v7, v6],
      [v0, v4, v7], [v0, v7, v3],
      [v1, v2, v6], [v1, v6, v5],
    ];

    const facetIds: number[] = [];
    for (const tri of triFaces) {
      maxFacetId += 1;
      facetIds.push(maxFacetId);
      const pts = tri.map((vid) => vertDefs[vid - vids[0]]);
      const fc: V3 = [
        (pts[0][0] + pts[1][0] + pts[2][0]) / 3,
        (pts[0][1] + pts[1][1] + pts[2][1]) / 3,
        (pts[0][2] + pts[1][2] + pts[2][2]) / 3,
      ];
      if (!root.facets) root.facets = [];
      const { normal, d } = computePlane(pts[0], pts[1], pts[2]);
      root.facets.push({
        id: maxFacetId,
        vertex_ids: [...tri],
        center: fc,
        out_unit_normal: normal,
        plane_equation: [normal[0], normal[1], normal[2], d],
        master_poly_id: polyId,
        neighbor_facet_ids: [],
        is_linked: false,
        is_visited: false,
        frontier_processed: false,
        index: 0,
      });
    }

    const poly = {
      id: polyId,
      area_id: cp.areaId,
      center: [...cp.center],
      origin_center: [...cp.center],
      white_vertex_ids: [...vids],
      black_vertex_ids: [],
      facet_ids: facetIds,
      edges: [],
      connected_node_ids: [],
      box_min: [cx - s, cy - s, cz - s],
      box_max: [cx + s, cy + s, cz + s],
      radius: s * Math.sqrt(3),
      object_ids: [],
      can_reach: false,
      is_gate: false,
      is_rollbacked: false,
      frontier_ids: [],
      gray_vertex_ids: [],
      candidate_rollback: [],
      parent_frontier_id: -1,
      temp_distance_to_nxt_poly: 0,
    };

    if (!root.polyhedrons) root.polyhedrons = [];
    root.polyhedrons.push(poly);

    const area = areaMap.get(cp.areaId);
    if (area) {
      if (!area.poly_ids) area.poly_ids = [];
      area.poly_ids.push(polyId);

      const polyMin: V3 = [cx - s, cy - s, cz - s];
      const polyMax: V3 = [cx + s, cy + s, cz + s];
      if (!area.box_min || !area.box_max) {
        area.box_min = [...polyMin];
        area.box_max = [...polyMax];
      } else {
        area.box_min = [
          Math.min(Number(area.box_min[0]), polyMin[0]),
          Math.min(Number(area.box_min[1]), polyMin[1]),
          Math.min(Number(area.box_min[2]), polyMin[2]),
        ];
        area.box_max = [
          Math.max(Number(area.box_max[0]), polyMax[0]),
          Math.max(Number(area.box_max[1]), polyMax[1]),
          Math.max(Number(area.box_max[2]), polyMax[2]),
        ];
      }
      area.center = [
        (Number(area.box_min[0]) + Number(area.box_max[0])) / 2,
        (Number(area.box_min[1]) + Number(area.box_max[1])) / 2,
        (Number(area.box_min[2]) + Number(area.box_max[2])) / 2,
      ];
    }
  }
}

function applyUpdateObjectLabels(root: any, updates: UpdateObjectLabel[]): void {
  if (updates.length === 0) return;
  const objMap = new Map<number, any>();
  for (const o of root.objects || []) objMap.set(Number(o.id), o);

  for (const u of updates) {
    const obj = objMap.get(u.id);
    if (!obj) continue;
    obj.label = u.label;
  }
}

function applyDeleteObjects(root: any, ids: number[]): void {
  if (ids.length === 0) return;
  const idSet = new Set(ids);

  // Remove objects
  root.objects = (root.objects || []).filter(
    (o: any) => !idSet.has(Number(o.id)),
  );

  // Clean poly.object_ids references
  for (const poly of root.polyhedrons || []) {
    poly.object_ids = (poly.object_ids || []).filter(
      (oid: any) => !idSet.has(Number(oid)),
    );
  }

  // Clean area.object_ids references
  for (const area of root.areas || []) {
    area.object_ids = (area.object_ids || []).filter(
      (oid: any) => !idSet.has(Number(oid)),
    );
  }

  // Clean cross-object edge references
  for (const obj of root.objects || []) {
    const edge = obj.edge || {};
    const fid = Number(edge.father_object_id ?? -1);
    if (idSet.has(fid)) {
      edge.father_object_id = -1;
      if (!obj.edge) obj.edge = edge;
    }
    edge.child_object_ids = (edge.child_object_ids || []).filter(
      (cid: any) => !idSet.has(Number(cid)),
    );
    if (obj.edge) obj.edge = edge;
  }
}

function applyUpdateObjectFatherPolys(root: any, updates: UpdateObjectFatherPoly[]): void {
  if (updates.length === 0) return;
  const objMap = new Map<number, any>();
  for (const o of root.objects || []) objMap.set(Number(o.id), o);

  for (const u of updates) {
    const obj = objMap.get(u.objectId);
    if (!obj) continue;
    if (!obj.edge) obj.edge = {};
    obj.edge.father_poly_id = u.fatherPolyId;
  }
}

function applyUpdateObjectPositions(root: any, updates: UpdateObjectPosition[]): void {
  if (updates.length === 0) return;
  const objMap = new Map<number, any>();
  for (const o of root.objects || []) objMap.set(Number(o.id), o);

  for (const u of updates) {
    const obj = objMap.get(u.id);
    if (!obj) continue;
    obj.pos = [...u.position] as V3;
  }
}

/**
 * Reorder root.objects to match the frontend drag order. `order` lists
 * effective/current object ids; objects not listed (e.g. missing after a
 * rename edge case) keep their relative position and are appended last.
 */
function applyObjectOrder(root: any, order: number[]): void {
  if (!order?.length) return;
  const objects = root.objects || [];
  const byId = new Map<number, any>();
  for (const o of objects) byId.set(Number(o.id), o);

  const ordered: any[] = [];
  for (const rawId of order) {
    const id = Number(rawId);
    const obj = byId.get(id);
    if (obj) {
      ordered.push(obj);
      byId.delete(id);
    }
  }
  for (const obj of objects) {
    if (byId.has(Number(obj.id))) ordered.push(obj);
  }
  root.objects = ordered;
}

/**
 * Rename objects (oldId → newId), keeping every id reference in sync:
 * objects[].id, areas[].object_ids, polyhedrons[].object_ids,
 * cross-object edges (father_object_id / child_object_ids), and the
 * files.{cloud,obb_axis,obb_corners} path prefixes (object_<id>_* →
 * object_<newId>_*). The actual PCD files are renamed on disk by
 * renameObjectFiles() after copyObjectsDir() — saved/ stays untouched.
 * Skips renames with a duplicate target id, a missing source object,
 * or a new id outside the uint16 target_obj_id contract (0–65535).
 * Returns the list of renames actually applied (in application order).
 */
function applyUpdateObjectIds(root: any, renames: UpdateObjectId[]): UpdateObjectId[] {
  const applied: UpdateObjectId[] = [];
  if (renames.length === 0) return applied;

  for (const r of renames) {
    const oldId = Number(r.oldId);
    const newId = Number(r.newId);
    if (
      !Number.isInteger(oldId) ||
      !Number.isInteger(newId) ||
      oldId === newId ||
      newId < 0 ||
      newId > 65535
    ) {
      continue;
    }

    const objects = root.objects || [];
    const target = objects.find((o: any) => Number(o.id) === oldId);
    if (!target) continue;

    // Skip if another object already uses the new id
    const conflict = objects.some(
      (o: any) => o !== target && Number(o.id) === newId,
    );
    if (conflict) continue;

    target.id = newId;

    // Rewrite files.* path basenames: object_<oldId>_<kind>.pcd → object_<newId>_<kind>.pcd
    const files = target.files || {};
    for (const key of ["cloud", "obb_axis", "obb_corners"]) {
      const p = files[key];
      if (typeof p !== "string" || !p.includes("/")) continue;
      const slash = p.lastIndexOf("/");
      files[key] =
        p.slice(0, slash + 1) +
        p
          .slice(slash + 1)
          .replace(
            new RegExp(`^object_${oldId}_`),
            `object_${newId}_`,
          );
    }

    for (const area of root.areas || []) {
      area.object_ids = (area.object_ids || []).map((oid: any) =>
        Number(oid) === oldId ? newId : Number(oid),
      );
    }
    for (const poly of root.polyhedrons || []) {
      poly.object_ids = (poly.object_ids || []).map((oid: any) =>
        Number(oid) === oldId ? newId : Number(oid),
      );
    }
    for (const obj of objects) {
      const edge = obj.edge || {};
      if (Number(edge.father_object_id) === oldId) {
        edge.father_object_id = newId;
        if (!obj.edge) obj.edge = edge;
      }
      edge.child_object_ids = (edge.child_object_ids || []).map((cid: any) =>
        Number(cid) === oldId ? newId : Number(cid),
      );
      if (obj.edge) obj.edge = edge;
    }

    applied.push({ oldId, newId });
  }
  return applied;
}

function rebuildCounters(root: any): void {
  const counters = root.counters || {};
  counters.area_count = (root.areas || []).length;
  counters.object_count = (root.objects || []).length;
  counters.poly_count = (root.polyhedrons || []).length;
  counters.vertex_count = (root.vertices || []).length;
  counters.facet_count = (root.facets || []).length;
  root.counters = counters;
  root.saved_at = new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ---- file copy (mirror objects/ from saved to exported) ----

/**
 * Copy only the objects/ PCD files referenced by the final scene graph
 * (rather than mirroring every saved/ file and pruning afterwards).
 * `renames` maps new object ids back to their saved-side ids so we copy the
 * original filenames that renameObjectFiles() then renames. Never overwrite
 * an existing file in exported/ — earlier exports may already have renamed
 * files there (object_<oldId>_*.pcd → object_<newId>_*.pcd).
 */
async function copyObjectsDir(
  savedDir: string,
  exportedDir: string,
  root: any,
  renames: UpdateObjectId[],
): Promise<void> {
  const src = join(savedDir, "objects");
  const dst = join(exportedDir, "objects");

  const oldIdByNewId = new Map<number, number>();
  for (const r of renames) {
    oldIdByNewId.set(Number(r.newId), Number(r.oldId));
  }

  const wanted = new Set<string>();
  for (const o of root.objects || []) {
    for (const key of ["cloud", "obb_axis", "obb_corners"]) {
      const p = o?.files?.[key];
      if (typeof p !== "string" || !p.includes("/")) continue;
      const base = p.slice(p.lastIndexOf("/") + 1);
      const m = base.match(/^object_(\d+)_(cloud|obb_axis|obb_corners)\.pcd$/);
      if (!m) {
        wanted.add(base);
        continue;
      }
      const newId = Number(m[1]);
      const oldId = oldIdByNewId.get(newId) ?? newId;
      wanted.add(`object_${oldId}_${m[2]}.pcd`);
    }
  }

  try {
    await mkdir(dst, { recursive: true });
  } catch {
    // objects dir already exists — ok
  }
  for (const f of wanted) {
    const dstFile = join(dst, f);
    try {
      statSync(dstFile);
    } catch {
      try {
        await copyFile(join(src, f), dstFile);
      } catch {
        // source file may not exist (e.g. chained rename) — skip
      }
    }
  }
}

/**
 * Rename object PCD files in exported/objects to match applied id renames.
 * Runs AFTER copyObjectsDir so the original files are present. If a source
 * file is missing in exported/ (e.g. chained renames from a previous
 * export already moved it), it is re-pulled from saved/objects/.
 * saved/ is never modified. Objects without a file for a given kind
 * (e.g. empty cloud) are skipped silently.
 */
function renameObjectFiles(
  savedDir: string,
  exportedDir: string,
  renames: UpdateObjectId[],
): void {
  if (renames.length === 0) return;
  const savedObjects = join(savedDir, "objects");
  const exportedObjects = join(exportedDir, "objects");
  mkdirSync(exportedObjects, { recursive: true });

  for (const r of renames) {
    for (const kind of ["cloud", "obb_axis", "obb_corners"]) {
      const oldName = `object_${r.oldId}_${kind}.pcd`;
      const newName = `object_${r.newId}_${kind}.pcd`;
      const oldPath = join(exportedObjects, oldName);
      let haveOld = true;
      try {
        statSync(oldPath);
      } catch {
        // Not in exported/ yet (or renamed away in an earlier export) —
        // pull the original from saved/.
        try {
          copyFileSync(join(savedObjects, oldName), oldPath);
        } catch {
          haveOld = false; // object has no file of this kind
        }
      }
      if (haveOld) {
        renameSync(oldPath, join(exportedObjects, newName));
      }
    }
  }
}

/**
 * Delete files in exported/objects/ that the final scene_graph.json does not
 * reference. copyObjectsDir re-pulls every saved/ file each export, which
 * resurrects stale files under names that earlier exports renamed away
 * (e.g. object_11_* after 11→12); saved/ may also contain orphans that no
 * JSON ever referenced. Referenced files are kept; everything else goes.
 */
function pruneUnreferencedObjects(exportedDir: string): number {
  const exportedObjects = join(exportedDir, "objects");
  const root = readJson(join(exportedDir, "scene_graph.json"));
  const referenced = new Set<string>();
  for (const o of root.objects || []) {
    for (const key of ["cloud", "obb_axis", "obb_corners"]) {
      const p = o?.files?.[key];
      if (typeof p === "string" && p.includes("/")) {
        referenced.add(p.slice(p.lastIndexOf("/") + 1));
      }
    }
  }
  let removed = 0;
  try {
    for (const f of readdirSync(exportedObjects)) {
      if (!referenced.has(f)) {
        rmSync(join(exportedObjects, f));
        removed++;
      }
    }
  } catch {
    // no objects dir — ok
  }
  return removed;
}

function findLatestSnapshot(baseDir: string): string {
  const entries = readdirSync(baseDir, { withFileTypes: true }).filter((e) => {
    if (!e.isDirectory()) return false;
    try {
      return statSync(join(baseDir, e.name, "scene_graph.json")).isFile();
    } catch {
      return false;
    }
  });
  entries.sort(
    (a, b) =>
      statSync(join(baseDir, b.name)).mtimeMs -
      statSync(join(baseDir, a.name)).mtimeMs,
  );
  return entries[0]?.name ?? "";
}

// ---- HTTP ----

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: any): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(json);
}

// ---- File logger (logs/YYYY-MM-DD_HH-MM-SS.log) ----

let logDir: string | null = null;
let logFileName: string | null = null;

function localTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}

function logToFile(scope: string, event: string, detail?: unknown): void {
  if (!logDir || !logFileName) return;
  try {
    const now = new Date();
    const line =
      `${now.toISOString()} [${scope}] ${event}` +
      (detail !== undefined ? ` ${JSON.stringify(detail)}` : "") +
      "\n";
    appendFileSync(join(logDir, logFileName), line);
  } catch {
    /* logging must never break the request */
  }
}

// ---- Vite plugin ----

export function apiPlugin(): Plugin {
  const PROJECT_ROOT = join(import.meta.dirname, "..");

  // Initialize the log directory on plugin setup. Each `bun run dev` restart
  // gets its own timestamped file: logs/YYYY-MM-DD_HH-MM-SS.log
  logDir = join(PROJECT_ROOT, "logs");
  logFileName = `${localTimestamp(new Date())}.log`;
  mkdirSync(logDir, { recursive: true });
  logToFile("server", "dev server starting");

  return {
    name: "scenegraph-api",
    configureServer(server: ViteDevServer) {
      // Client-side event sink: the web editor POSTs UI events here so they
      // land in the same dated log file as backend events.
      server.middlewares.use(
        "/api/log",
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== "POST") {
            sendJson(res, 405, { success: false, error: "Method not allowed" });
            return;
          }
          try {
            const body = await readBody(req);
            const entry = JSON.parse(body);
            logToFile(
              "client",
              String(entry?.event ?? "unknown"),
              entry?.detail,
            );
            sendJson(res, 200, { success: true });
          } catch (err: any) {
            logToFile("client", "log post failed", { error: err.message });
            sendJson(res, 400, { success: false, error: err.message });
          }
        },
      );

      server.middlewares.use(
        "/api/export",
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method === "OPTIONS") {
            res.writeHead(204, {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            });
            res.end();
            return;
          }

          if (req.method !== "POST") {
            sendJson(res, 405, { success: false, error: "Method not allowed" });
            return;
          }

          try {
            const body = await readBody(req);
            const payload: ExportRequest = JSON.parse(body);
            if (!isValidSnapshotName(payload.snapshot)) {
              sendJson(res, 400, { success: false, error: "Invalid snapshot name" });
              return;
            }
            const t0 = Date.now();
            logToFile("export", "request", {
              snapshot: payload.snapshot,
              base: payload.base,
              renameCount: payload.mutations?.updateObjectIds?.length ?? 0,
            });
            const savedDir = join(
              PROJECT_ROOT,
              "scene_graph_saved",
              payload.snapshot,
            );
            const exportedDir = join(
              PROJECT_ROOT,
              "scene_graph_exported",
              payload.snapshot,
            );

            // Read from exported/ if base is "exported" (file exists), else fall back to saved/
            let sourcePath: string;
            if (payload.base === "exported") {
              const exportedPath = join(exportedDir, "scene_graph.json");
              try { statSync(exportedPath); sourcePath = exportedPath; }
              catch { sourcePath = join(savedDir, "scene_graph.json"); }
            } else {
              sourcePath = join(savedDir, "scene_graph.json");
            }
            const root = readJson(sourcePath);

            const appliedRenames = applyMutations(root, payload.mutations);

            writeJson(join(exportedDir, "scene_graph.json"), root);

            // manifest
            const manifest = {
              format_version: 1,
              save_name: payload.snapshot,
              saved_at: root.saved_at,
              scene_graph_file: "scene_graph.json",
              object_dir: "objects",
              summary: {
                poly_count: (root.polyhedrons || []).length,
                area_count: (root.areas || []).length,
                object_count: (root.objects || []).length,
                saved_cloud_num: (root.objects || []).filter(
                  (o: any) => o?.files?.cloud,
                ).length,
              },
            };
            writeJson(join(exportedDir, "manifest.json"), manifest);

            await copyObjectsDir(savedDir, exportedDir, root, appliedRenames);
            renameObjectFiles(savedDir, exportedDir, appliedRenames);
            const pruned = pruneUnreferencedObjects(exportedDir);

            logToFile("export", "ok", {
              snapshot: payload.snapshot,
              renames: appliedRenames,
              prunedFiles: pruned,
              elapsedMs: Date.now() - t0,
            });
            sendJson(res, 200, { success: true });
          } catch (err: any) {
            logToFile("export", "error", { error: err.message });
            sendJson(res, 500, { success: false, error: err.message });
          }
        },
      );

      server.middlewares.use(
        "/api/snapshot",
        async (_req: IncomingMessage, res: ServerResponse) => {
          try {
            const savedDir = join(PROJECT_ROOT, "scene_graph_saved");
            const name = findLatestSnapshot(savedDir);
            sendJson(res, 200, { snapshot: name });
          } catch (err: any) {
            sendJson(res, 500, { success: false, error: err.message });
          }
        },
      );

      // List all available snapshots from scene_graph_saved/
      server.middlewares.use(
        "/api/snapshots",
        async (_req: IncomingMessage, res: ServerResponse) => {
          try {
            const savedDir = join(PROJECT_ROOT, "scene_graph_saved");
            const entries = readdirSync(savedDir, { withFileTypes: true })
              .filter((e) => e.isDirectory())
              .filter((e) => {
                try { return statSync(join(savedDir, e.name, "scene_graph.json")).isFile(); }
                catch { return false; }
              });

            const snapshots = entries.map((e) => {
              const mpath = join(savedDir, e.name, "manifest.json");
              let meta: any = {};
              try { meta = readJson(mpath); } catch {}
              return {
                name: e.name,
                saved_at: meta.saved_at || "",
                summary: meta.summary || {},
              };
            });
            snapshots.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
            sendJson(res, 200, { snapshots });
          } catch (err: any) {
            sendJson(res, 500, { success: false, error: err.message });
          }
        },
      );

      // Serve scene_graph.json
      //   ?snapshot=X           → exported/ first, fallback saved/
      //   ?snapshot=X&source=saved    → force saved/
      //   ?snapshot=X&source=exported → force exported/ (404 if missing)
      server.middlewares.use(
        "/api/scene-graph",
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== "GET") {
            sendJson(res, 405, { success: false, error: "Method not allowed" });
            return;
          }
          try {
            const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
            const snapshot = url.searchParams.get("snapshot");
            if (!snapshot) {
              sendJson(res, 400, { success: false, error: "Missing snapshot query param" });
              return;
            }
            if (!isValidSnapshotName(snapshot)) {
              sendJson(res, 400, { success: false, error: "Invalid snapshot name" });
              return;
            }

            const savedPath = join(PROJECT_ROOT, "scene_graph_saved", snapshot, "scene_graph.json");
            const exportedPath = join(PROJECT_ROOT, "scene_graph_exported", snapshot, "scene_graph.json");
            const source = url.searchParams.get("source") || "auto";

            let jsonPath: string;
            if (source === "saved") {
              jsonPath = savedPath;
            } else if (source === "exported") {
              if (!statSync(exportedPath).isFile()) {
                sendJson(res, 404, { success: false, error: "No export found" });
                return;
              }
              jsonPath = exportedPath;
            } else {
              try { statSync(exportedPath); jsonPath = exportedPath; }
              catch { jsonPath = savedPath; }
            }

            const data = readFileSync(jsonPath, "utf-8");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(data);
          } catch (err: any) {
            sendJson(res, 500, { success: false, error: err.message });
          }
        },
      );

      // Serve PCD point-cloud files
      // ?snapshot=X&path=objects/object_N_cloud.pcd  → per-object
      // ?source=scene&name=2026-06-29-all-newmap.pcd → top-level scene
      server.middlewares.use(
        "/api/pcd",
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== "GET") {
            sendJson(res, 405, { success: false, error: "Method not allowed" });
            return;
          }
          try {
            const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
            const source = url.searchParams.get("source") || "snapshot";
            let filePath: string;
            if (source === "scene") {
              const name = url.searchParams.get("name");
              if (!name || name.includes("..") || name.includes("/")) {
                sendJson(res, 400, { success: false, error: "Invalid name" });
                return;
              }
              filePath = join(PROJECT_ROOT, "pcd", name);
            } else {
              const snapshot = url.searchParams.get("snapshot");
              const relPath = url.searchParams.get("path");
              if (!snapshot || !isValidSnapshotName(snapshot) || !relPath || relPath.includes("..") || relPath.startsWith("/")) {
                sendJson(res, 400, { success: false, error: "Missing/invalid snapshot or path" });
                return;
              }
              // Prefer exported/ (may contain renamed object files),
              // fall back to saved/ — same order as /api/scene-graph.
              const exportedFile = join(PROJECT_ROOT, "scene_graph_exported", snapshot, relPath);
              try {
                statSync(exportedFile);
                filePath = exportedFile;
              } catch {
                filePath = join(PROJECT_ROOT, "scene_graph_saved", snapshot, relPath);
              }
            }
            const data = readFileSync(filePath);
            res.writeHead(200, {
              "Content-Type": "application/octet-stream",
              "Content-Length": data.length,
            });
            res.end(data);
          } catch (err: any) {
            sendJson(res, 500, { success: false, error: err.message });
          }
        },
      );

      // List scene-level PCD files in top-level pcd/ directory
      server.middlewares.use(
        "/api/scene-pcds",
        async (_req: IncomingMessage, res: ServerResponse) => {
          try {
            const pcdDir = join(PROJECT_ROOT, "pcd");
            const files = readdirSync(pcdDir)
              .filter((f) => f.endsWith(".pcd"))
              .map((f) => ({ name: f }));
            sendJson(res, 200, { files });
          } catch (err: any) {
            sendJson(res, 500, { success: false, error: err.message });
          }
        },
      );
    },
  };
}
