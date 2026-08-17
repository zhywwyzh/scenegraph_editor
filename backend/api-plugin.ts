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
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { readdir, copyFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

// ---- types (mirror frontend/src/lib/types.ts) ----

interface MovePoly {
  id: number;
  center: [number, number, number];
}

interface EdgeRef {
  srcId: number;
  dstId: number;
}

interface CreatePoly {
  areaId: number;
  center: [number, number, number];
  size: number;
}

interface UpdateObjectLabel {
  id: number;
  label: string;
}

interface UpdateObjectFatherPoly {
  objectId: number;
  fatherPolyId: number;
}

interface Mutations {
  deletePolyIds: number[];
  movePoly: MovePoly[];
  removeEdges: EdgeRef[];
  addEdges: EdgeRef[];
  createPoly: CreatePoly[];
  updateObjectLabels: UpdateObjectLabel[];
  updateObjectFatherPolys: UpdateObjectFatherPoly[];
  deleteObjectIds: number[];
}

interface ExportRequest {
  snapshot: string;
  mutations: Mutations;
  base?: "saved" | "exported";
}

type V3 = [number, number, number];

// ---- JSON helpers ----

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path: string, data: any): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

// ---- Mutation engine ----

function applyMutations(root: any, mutations: Mutations): void {
  applyDeletePolys(root, mutations.deletePolyIds);
  applyMovePolys(root, mutations.movePoly);
  applyRemoveEdges(root, mutations.removeEdges);
  applyAddEdges(root, mutations.addEdges);
  applyCreatePolys(root, mutations.createPoly);
  applyUpdateObjectLabels(root, mutations.updateObjectLabels);
  applyUpdateObjectFatherPolys(root, mutations.updateObjectFatherPolys);
  applyDeleteObjects(root, mutations.deleteObjectIds);
  rebuildCounters(root);
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

  root.vertices = (root.vertices || []).filter(
    (v: any) =>
      !root.polyhedrons.some(
        (p: any) =>
          (p.white_vertex_ids || []).includes(v.id) ||
          (p.black_vertex_ids || []).includes(v.id),
      ) || true,
  );
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
      if (!facet || !facet.center) continue;
      facet.center = [facet.center[0] + dx, facet.center[1] + dy, facet.center[2] + dz];
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
      root.facets.push({
        id: maxFacetId,
        vertex_ids: [...tri],
        center: fc,
        out_unit_normal: [0, 0, 1],
        plane_equation: [0, 0, 1, -fc[2]],
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

async function copyObjectsDir(savedDir: string, exportedDir: string): Promise<void> {
  const src = join(savedDir, "objects");
  const dst = join(exportedDir, "objects");
  try {
    const entries = await readdir(src);
    await mkdir(dst, { recursive: true });
    for (const f of entries) {
      await copyFile(join(src, f), join(dst, f));
    }
  } catch {
    // no objects dir — ok
  }
}

function findLatestSnapshot(baseDir: string): string {
  const entries = readdirSync(baseDir, { withFileTypes: true }).filter(
    (e) =>
      e.isDirectory() &&
      statSync(join(baseDir, e.name, "scene_graph.json")).isFile(),
  );
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

// ---- Vite plugin ----

export function apiPlugin(): Plugin {
  const PROJECT_ROOT = join(import.meta.dirname, "..");

  return {
    name: "scenegraph-api",
    configureServer(server: ViteDevServer) {
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

            applyMutations(root, payload.mutations);

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

            await copyObjectsDir(savedDir, exportedDir);

            sendJson(res, 200, { success: true });
          } catch (err: any) {
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
              if (!snapshot || !relPath || relPath.includes("..") || relPath.startsWith("/")) {
                sendJson(res, 400, { success: false, error: "Missing/invalid snapshot or path" });
                return;
              }
              filePath = join(PROJECT_ROOT, "scene_graph_saved", snapshot, relPath);
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
