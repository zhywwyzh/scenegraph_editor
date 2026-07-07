import type { Mutations, EdgeRef } from "./types";

export function emptyMutations(): Mutations {
  return {
    deletePolyIds: [],
    movePoly: [],
    removeEdges: [],
    addEdges: [],
    createPoly: [],
    updateObjectLabels: [],
    updateObjectFatherPolys: [],
    deleteObjectIds: [],
  };
}

export function mutationCount(m: Mutations): number {
  return (
    m.deletePolyIds.length +
    m.movePoly.length +
    m.removeEdges.length +
    m.addEdges.length +
    m.createPoly.length +
    m.updateObjectLabels.length +
    m.updateObjectFatherPolys.length +
    m.deleteObjectIds.length
  );
}

/** Deduplicate an edge key "minId_maxId" */
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function addDeletePoly(m: Mutations, id: number): Mutations {
  if (m.deletePolyIds.includes(id)) return m;
  const mp = shallowCopy(m);
  mp.deletePolyIds = [...mp.deletePolyIds, id];
  return mp;
}

export function addRemoveEdge(m: Mutations, e: EdgeRef): Mutations {
  const key = edgeKey(e.srcId, e.dstId);
  if (m.removeEdges.some((r) => edgeKey(r.srcId, r.dstId) === key)) return m;
  const n = shallowCopy(m);
  n.removeEdges = [...n.removeEdges, { ...e }];
  return n;
}

export function addMovePoly(
  m: Mutations,
  id: number,
  center: [number, number, number],
): Mutations {
  const n = shallowCopy(m);
  const idx = n.movePoly.findIndex((mp) => mp.id === id);
  if (idx >= 0) {
    n.movePoly[idx] = { id, center: [...center] };
  } else {
    n.movePoly = [...n.movePoly, { id, center: [...center] }];
  }
  return n;
}

export function addAddEdge(m: Mutations, e: EdgeRef): Mutations {
  const key = edgeKey(e.srcId, e.dstId);
  if (m.addEdges.some((a) => edgeKey(a.srcId, a.dstId) === key)) return m;
  const n = shallowCopy(m);
  n.addEdges = [...n.addEdges, { ...e }];
  return n;
}

export function addCreatePoly(
  m: Mutations,
  areaId: number,
  center: [number, number, number],
  size: number,
): Mutations {
  const n = shallowCopy(m);
  n.createPoly = [...n.createPoly, { areaId, center: [...center] as [number, number, number], size }];
  return n;
}

// ---- object mutations ----

/** Add or replace an object-label update. Deduplicates by object id. */
export function addUpdateObjectLabel(
  m: Mutations,
  id: number,
  label: string,
): Mutations {
  const n = shallowCopy(m);
  const idx = n.updateObjectLabels.findIndex((u) => u.id === id);
  if (idx >= 0) {
    n.updateObjectLabels[idx] = { id, label };
  } else {
    n.updateObjectLabels = [...n.updateObjectLabels, { id, label }];
  }
  return n;
}

/** Update an object's father_poly connection. Deduplicates by object id. */
export function addUpdateObjectFatherPoly(
  m: Mutations,
  objectId: number,
  fatherPolyId: number,
): Mutations {
  const n = shallowCopy(m);
  const idx = n.updateObjectFatherPolys.findIndex((u) => u.objectId === objectId);
  if (idx >= 0) {
    n.updateObjectFatherPolys[idx] = { objectId, fatherPolyId };
  } else {
    n.updateObjectFatherPolys = [...n.updateObjectFatherPolys, { objectId, fatherPolyId }];
  }
  return n;
}

/** Mark an object for deletion. Deduplicates by id. */
export function addDeleteObject(m: Mutations, id: number): Mutations {
  if (m.deleteObjectIds.includes(id)) return m;
  const n = shallowCopy(m);
  n.deleteObjectIds = [...n.deleteObjectIds, id];
  return n;
}

function shallowCopy(m: Mutations): Mutations {
  return {
    deletePolyIds: [...m.deletePolyIds],
    movePoly: m.movePoly.map((x) => ({ ...x })),
    removeEdges: m.removeEdges.map((x) => ({ ...x })),
    addEdges: m.addEdges.map((x) => ({ ...x })),
    createPoly: m.createPoly.map((x) => ({ areaId: x.areaId, center: [...x.center] as [number, number, number], size: x.size })),
    updateObjectLabels: m.updateObjectLabels.map((x) => ({ ...x })),
    updateObjectFatherPolys: m.updateObjectFatherPolys.map((x) => ({ ...x })),
    deleteObjectIds: [...m.deleteObjectIds],
  };
}
