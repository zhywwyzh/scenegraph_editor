import type { PreprocessedArea, PreprocessedPoly, TopologicalNode, TopologicalEdge, SceneData } from "./types";

function hex(r: number, g: number, b: number): string {
  const t = (x: number) => ((x * 255) | 0).toString(16).padStart(2, "0");
  return `#${t(r)}${t(g)}${t(b)}`;
}

function c3(v: any, fb: number): number {
  const n = Number(v);
  return isFinite(n) ? n : fb;
}

function asV3(v: any): [number, number, number] {
  return [c3(v?.[0], 0), c3(v?.[1], 0), c3(v?.[2], 0)];
}

export async function loadSceneGraph(path: string): Promise<SceneData> {
  const resp = await fetch(path, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to load ${path}: ${resp.status}`);
  const root = await resp.json();

  // Vertex map: {position, connected_vertex_ids}
  const vmap = new Map<number, { pos: [number, number, number]; conn: number[] }>();
  for (const v of root.vertices || []) {
    vmap.set(v.id, { pos: v.position, conn: v.connected_vertex_ids || [] });
  }

  // Area color lookup
  const areaColors = new Map<number, [number, number, number]>();
  for (const a of root.areas || []) {
    areaColors.set(a.id, [c3(a.color?.[0], 0.5), c3(a.color?.[1], 0.5), c3(a.color?.[2], 0.5)]);
  }

  // Areas
  const areas: PreprocessedArea[] = (root.areas || []).map((a: any) => ({
    id: a.id,
    roomLabel: a.room_label || "Unknown",
    colorHex: hex(c3(a.color?.[0], 0.5), c3(a.color?.[1], 0.5), c3(a.color?.[2], 0.5)),
    boxMin: asV3(a.box_min),
    boxMax: asV3(a.box_max),
    center: asV3(a.center),
    neighborIds: (a.neighbor_area_ids || []).map(Number),
    polyIds: (a.poly_ids || []).map(Number),
  }));

  // Polys
  const polys: PreprocessedPoly[] = (root.polyhedrons || []).map((p: any) => {
    const vids = [...(p.white_vertex_ids || []), ...(p.black_vertex_ids || [])];
    const positions = new Float32Array(vids.length * 3);
    const idxMap = new Map<number, number>();
    for (let i = 0; i < vids.length; i++) {
      const v = vmap.get(vids[i]);
      if (!v) continue;
      idxMap.set(vids[i], i);
      positions[i * 3] = v.pos[0];
      positions[i * 3 + 1] = v.pos[1];
      positions[i * 3 + 2] = v.pos[2];
    }

    // Internal wireframe (vertex → vertex)
    const edgeSet = new Set<string>();
    const idSet = new Set(vids);
    for (const vid of vids) {
      const v = vmap.get(vid);
      if (!v) continue;
      for (const cid of v.conn) {
        if (!idSet.has(cid)) continue;
        edgeSet.add([vid, cid].sort().join("_"));
      }
    }
    const ep: number[] = [];
    for (const k of edgeSet) {
      const [a, b] = k.split("_").map(Number);
      const ai = idxMap.get(a), bi = idxMap.get(b);
      if (ai !== undefined && bi !== undefined) ep.push(ai, bi);
    }

    const aid = p.area_id != null && p.area_id >= 0 ? p.area_id : 0xffffffff;
    const col = aid !== 0xffffffff
      ? (areaColors.get(aid) ?? [0.5, 0.5, 0.5])
      : [0.4, 0.4, 0.4];

    return {
      id: p.id,
      areaId: aid,
      colorHex: hex(col[0], col[1], col[2]),
      center: [c3(p.center?.[0], 0), c3(p.center?.[1], 0), c3(p.center?.[2], 0)],
      positions,
      edgeIndices: new Uint32Array(ep),
      adjacentPolyIds: (p.edges || []).map((e: any) => Number(e.dst_poly_id)),
      gatewayNodeIds: (p.connected_node_ids || []).map(Number),
    };
  });

  // Topological nodes
  const topoNodes: TopologicalNode[] = polys.map((p) => ({
    id: p.id,
    areaId: p.areaId,
    position: p.center,
    colorHex: p.colorHex,
  }));

  // Topological edges
  const polyMap = new Map<number, { center: [number, number, number]; areaId: number; colorHex: string }>();
  for (const p of polys) polyMap.set(p.id, { center: p.center, areaId: p.areaId, colorHex: p.colorHex });

  const edgeMap = new Map<string, { srcId: number; dstId: number; length: number; crossArea: boolean }>();
  const addEdge = (s: number, d: number) => {
    const src = polyMap.get(s);
    const dst = polyMap.get(d);
    if (!src || !dst) return;
    const key = [s, d].sort().join("_");
    if (edgeMap.has(key)) return;
    const dx = dst.center[0] - src.center[0];
    const dy = dst.center[1] - src.center[1];
    const dz = dst.center[2] - src.center[2];
    edgeMap.set(key, { srcId: s, dstId: d, length: Math.sqrt(dx * dx + dy * dy + dz * dz), crossArea: src.areaId !== dst.areaId });
  };
  for (const p of polys) {
    for (const dp of p.adjacentPolyIds) addEdge(p.id, dp);
    for (const dp of p.gatewayNodeIds) addEdge(p.id, dp);
  }

  const topoEdges: TopologicalEdge[] = [...edgeMap.values()].map((e) => {
    const src = polyMap.get(e.srcId)!;
    const dst = polyMap.get(e.dstId)!;
    return {
      srcId: e.srcId, dstId: e.dstId, length: e.length,
      srcPos: src.center, dstPos: dst.center,
      srcColorHex: src.colorHex, dstColorHex: dst.colorHex,
      crossArea: e.crossArea,
    };
  });

  return { areas, polys, topoNodes, topoEdges };
}
