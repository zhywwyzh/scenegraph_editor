import { useMemo } from "react";
import type { PreprocessedArea, PreprocessedPoly } from "../lib/types";

interface Props {
  areas: PreprocessedArea[];
  effectivePolys: PreprocessedPoly[];
  visible: boolean;
  showWireframe: boolean;
  selectedArea: number | null;
}

interface PolyGroup {
  areaId: number;
  colorHex: string;
  positions: Float32Array;
  colors: Float32Array;
  wireframeVerts: Float32Array[];
}

function buildGroup(
  areaId: number,
  colorHex: string,
  areaPolys: PreprocessedPoly[],
  showWireframe: boolean,
): PolyGroup {
  let totalVerts = 0;
  for (const p of areaPolys) totalVerts += p.positions.length / 3;
  const mpos = new Float32Array(totalVerts * 3);
  const mcol = new Float32Array(totalVerts * 3);
  let off = 0;
  const wf: Float32Array[] = [];

  for (const p of areaPolys) {
    const n = p.positions.length / 3;
    if (n === 0) continue;
    mpos.set(p.positions, off * 3);
    const [cr, cg, cb] = hexRgb(p.colorHex);
    for (let j = 0; j < n; j++) {
      mcol[(off + j) * 3] = cr; mcol[(off + j) * 3 + 1] = cg; mcol[(off + j) * 3 + 2] = cb;
    }
    if (showWireframe && p.edgeIndices.length > 0) {
      const w = new Float32Array(p.edgeIndices.length * 3);
      for (let k = 0; k < p.edgeIndices.length; k += 2) {
        const a = p.edgeIndices[k] * 3, b = p.edgeIndices[k + 1] * 3, d = k * 3;
        w[d] = p.positions[a]; w[d + 1] = p.positions[a + 1]; w[d + 2] = p.positions[a + 2];
        w[d + 3] = p.positions[b]; w[d + 4] = p.positions[b + 1]; w[d + 5] = p.positions[b + 2];
      }
      wf.push(w);
    }
    off += n;
  }

  return { areaId, colorHex, positions: mpos, colors: mcol, wireframeVerts: wf };
}

/** Merged per-area poly vertex point cloud + optional internal wireframe. */
export function PolyhedraAll({ areas, effectivePolys, visible, showWireframe, selectedArea }: Props) {
  const groups = useMemo(() => {
    const areaById = new Map(areas.map((a) => [a.id, a]));
    const areaGroups = areas.map((area) => {
      const areaPolys = effectivePolys.filter((p) => p.areaId === area.id || (p.areaId === 0xffffffff && selectedArea === area.id));
      return buildGroup(area.id, area.colorHex, areaPolys, showWireframe);
    });

    // Polys whose area was deleted (metadata only) keep rendering as a
    // neutral gray group so the user still sees the retained topology.
    const orphanPolys = effectivePolys.filter(
      (p) => p.areaId !== 0xffffffff && !areaById.has(p.areaId),
    );
    const orphanGroup = orphanPolys.length > 0
      ? buildGroup(-1, "#888888", orphanPolys, showWireframe)
      : null;

    return orphanGroup ? [...areaGroups, orphanGroup] : areaGroups;
  }, [areas, effectivePolys, showWireframe, selectedArea]);

  if (!visible) return null;

  return (
    <>
      {groups.map((g) => {
        const dimmed = selectedArea !== null && selectedArea !== g.areaId;
        if (g.positions.length === 0) return null;
        return (
          <group key={g.areaId}>
            <points visible={!dimmed || selectedArea === g.areaId}>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[g.positions, 3] as [Float32Array, number]} count={g.positions.length / 3} />
                <bufferAttribute attach="attributes-color" args={[g.colors, 3] as [Float32Array, number]} count={g.colors.length / 3} />
              </bufferGeometry>
              <pointsMaterial size={0.04} vertexColors sizeAttenuation transparent opacity={dimmed ? 0.15 : 0.7} depthWrite />
            </points>
            {showWireframe && g.wireframeVerts.map((wv, wi) => (
              <lineSegments key={wi} visible={!dimmed}>
                <bufferGeometry>
                  <bufferAttribute attach="attributes-position" args={[wv, 3] as [Float32Array, number]} count={wv.length / 3} />
                </bufferGeometry>
                <lineBasicMaterial color={g.colorHex} transparent opacity={dimmed ? 0.08 : 0.3} />
              </lineSegments>
            ))}
          </group>
        );
      })}
    </>
  );
}

function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}
