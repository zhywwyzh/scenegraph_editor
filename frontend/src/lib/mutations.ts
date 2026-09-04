import type { Mutations, EdgeRef, UpdateArea, UpdateObjectColor } from "./types";

export function emptyMutations(): Mutations {
  return {
    deletePolyIds: [],
    deleteAreaIds: [],
    movePoly: [],
    removeEdges: [],
    addEdges: [],
    createPoly: [],
    updateObjectLabels: [],
    updateObjectFatherPolys: [],
    updateObjectPositions: [],
    updateObjectIds: [],
    deleteObjectIds: [],
    objectOrder: [],
    updateAreas: [],
    updateObjectColors: [],
  };
}

export function mutationCount(m: Mutations): number {
  return (
    m.deletePolyIds.length +
    m.deleteAreaIds.length +
    m.movePoly.length +
    m.removeEdges.length +
    m.addEdges.length +
    m.createPoly.length +
    m.updateObjectLabels.length +
    m.updateObjectFatherPolys.length +
    m.updateObjectPositions.length +
    m.updateObjectIds.length +
    m.deleteObjectIds.length +
    (m.objectOrder?.length ? 1 : 0) +
    m.updateAreas.length +
    m.updateObjectColors.length
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

export function addDeleteArea(m: Mutations, id: number): Mutations {
  if (m.deleteAreaIds.includes(id)) return m;
  const n = shallowCopy(m);
  n.deleteAreaIds = [...n.deleteAreaIds, id];
  return n;
}

/** Add or replace an area label/color update. Deduplicates by area id. */
export function addUpdateArea(
  m: Mutations,
  patch: UpdateArea,
): Mutations {
  const n = shallowCopy(m);
  const idx = n.updateAreas.findIndex((u) => u.id === patch.id);
  const merged: UpdateArea = idx >= 0
    ? {
        id: patch.id,
        roomLabel: patch.roomLabel ?? n.updateAreas[idx].roomLabel,
        color: patch.color
          ? ([...patch.color] as [number, number, number])
          : n.updateAreas[idx].color,
      }
    : {
        id: patch.id,
        roomLabel: patch.roomLabel,
        color: patch.color ? ([...patch.color] as [number, number, number]) : undefined,
      };
  if (idx >= 0) {
    n.updateAreas[idx] = merged;
  } else {
    n.updateAreas = [...n.updateAreas, merged];
  }
  return n;
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

/** Add or replace an object-position update. Deduplicates by object id. */
export function addUpdateObjectPosition(
  m: Mutations,
  id: number,
  position: [number, number, number],
): Mutations {
  const n = shallowCopy(m);
  const idx = n.updateObjectPositions.findIndex((u) => u.id === id);
  if (idx >= 0) {
    n.updateObjectPositions[idx] = { id, position: [...position] as [number, number, number] };
  } else {
    n.updateObjectPositions = [...n.updateObjectPositions, { id, position: [...position] as [number, number, number] }];
  }
  return n;
}

/** Add or replace an object-color update. Deduplicates by object id. */
export function addUpdateObjectColor(
  m: Mutations,
  id: number,
  color: [number, number, number],
): Mutations {
  const n = shallowCopy(m);
  const idx = n.updateObjectColors.findIndex((u) => u.id === id);
  const clamped = color.map((c) =>
    Math.max(0, Math.min(255, Math.round(c))),
  ) as [number, number, number];
  if (idx >= 0) {
    n.updateObjectColors[idx] = { id, color: clamped };
  } else {
    n.updateObjectColors = [...n.updateObjectColors, { id, color: clamped }];
  }
  return n;
}

/** Mark an object for deletion. Deduplicates by id. */
export function addDeleteObject(m: Mutations, id: number): Mutations {
  if (m.deleteObjectIds.includes(id)) return m;
  const n = shallowCopy(m);
  n.deleteObjectIds = [...m.deleteObjectIds, id];
  n.objectOrder = (n.objectOrder ?? []).filter((oid) => oid !== id);
  return n;
}

/** Set the desired export order of object ids (effective/current ids). */
export function addUpdateObjectOrder(
  m: Mutations,
  order: number[],
): Mutations {
  const n = shallowCopy(m);
  n.objectOrder = [...order];
  return n;
}

/**
 * Rename an object (oldId → newId). Because the backend applies
 * updateObjectIds before every other object mutation, any pending
 * mutation still referencing oldId is rewritten to newId here.
 */
export function addUpdateObjectId(
  m: Mutations,
  oldId: number,
  newId: number,
): Mutations {
  const n = shallowCopy(m);

  // Rewrite pending object mutations that still reference oldId
  n.updateObjectLabels = n.updateObjectLabels.map((u) =>
    u.id === oldId ? { ...u, id: newId } : u,
  );
  n.updateObjectFatherPolys = n.updateObjectFatherPolys.map((u) =>
    u.objectId === oldId ? { ...u, objectId: newId } : u,
  );
  n.updateObjectPositions = n.updateObjectPositions.map((u) =>
    u.id === oldId ? { ...u, id: newId } : u,
  );
  n.updateObjectColors = n.updateObjectColors.map((u) =>
    u.id === oldId ? { ...u, id: newId } : u,
  );
  n.deleteObjectIds = n.deleteObjectIds.map((id) => (id === oldId ? newId : id));
  n.objectOrder = (n.objectOrder ?? []).map((id) =>
    id === oldId ? newId : id,
  );

  // Merge with an existing rename chain: a→oldId becomes a→newId
  const chainedIdx = n.updateObjectIds.findIndex((u) => u.newId === oldId);
  if (chainedIdx >= 0) {
    n.updateObjectIds[chainedIdx] = {
      ...n.updateObjectIds[chainedIdx],
      newId,
    };
    return n;
  }

  const idx = n.updateObjectIds.findIndex((u) => u.oldId === oldId);
  if (idx >= 0) {
    n.updateObjectIds[idx] = { oldId, newId };
  } else {
    n.updateObjectIds = [...n.updateObjectIds, { oldId, newId }];
  }
  return n;
}

function shallowCopy(m: Mutations): Mutations {
  return {
    deletePolyIds: [...m.deletePolyIds],
    deleteAreaIds: [...m.deleteAreaIds],
    movePoly: m.movePoly.map((x) => ({ ...x })),
    removeEdges: m.removeEdges.map((x) => ({ ...x })),
    addEdges: m.addEdges.map((x) => ({ ...x })),
    createPoly: m.createPoly.map((x) => ({ areaId: x.areaId, center: [...x.center] as [number, number, number], size: x.size })),
    updateObjectLabels: m.updateObjectLabels.map((x) => ({ ...x })),
    updateObjectFatherPolys: m.updateObjectFatherPolys.map((x) => ({ ...x })),
    updateObjectPositions: m.updateObjectPositions.map((x) => ({
      id: x.id,
      position: [...x.position] as [number, number, number],
    })),
    updateObjectIds: m.updateObjectIds.map((x) => ({ ...x })),
    deleteObjectIds: [...m.deleteObjectIds],
    objectOrder: [...(m.objectOrder ?? [])],
    updateAreas: m.updateAreas.map((x) => ({
      id: x.id,
      roomLabel: x.roomLabel,
      color: x.color ? ([...x.color] as [number, number, number]) : undefined,
    })),
    updateObjectColors: m.updateObjectColors.map((x) => ({
      id: x.id,
      color: [...x.color] as [number, number, number],
    })),
  };
}
