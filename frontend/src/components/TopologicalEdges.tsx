import { useMemo } from "react";
import { Line } from "@react-three/drei";
import type { TopologicalEdge } from "../lib/types";

interface Props {
  edges: TopologicalEdge[];
  visible: boolean;
  selectedArea: number | null;
  selectedEdgeKey: string | null;
  hoveredEdgeKey: string | null;
  edgeThickness: number;
}

/**
 * Inter-node adjacency lines with vertexColors.
 * edgeThickness controls opacity and linewidth.
 */
export function TopologicalEdges({
  edges,
  visible,
  selectedArea,
  selectedEdgeKey,
  hoveredEdgeKey,
  edgeThickness,
}: Props) {
  const lines = useMemo(() => {
    const pos = new Float32Array(edges.length * 2 * 3);
    const col = new Float32Array(edges.length * 2 * 3);

    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const bo = i * 6;
      pos[bo] = e.srcPos[0]; pos[bo + 1] = e.srcPos[1]; pos[bo + 2] = e.srcPos[2];
      pos[bo + 3] = e.dstPos[0]; pos[bo + 4] = e.dstPos[1]; pos[bo + 5] = e.dstPos[2];

      const [sR, sG, sB] = hexRgb(e.srcColorHex);
      const [dR, dG, dB] = hexRgb(e.dstColorHex);
      col[bo] = sR; col[bo + 1] = sG; col[bo + 2] = sB;
      col[bo + 3] = dR; col[bo + 4] = dG; col[bo + 5] = dB;
    }
    return { positions: pos, colors: col, count: edges.length * 2 };
  }, [edges]);

  const selectedLine = useMemo(
    () => findEdgePoints(edges, selectedEdgeKey),
    [selectedEdgeKey, edges],
  );
  const hoveredLine = useMemo(
    () =>
      hoveredEdgeKey !== selectedEdgeKey
        ? findEdgePoints(edges, hoveredEdgeKey)
        : null,
    [hoveredEdgeKey, selectedEdgeKey, edges],
  );

  if (!visible || lines.count === 0) return null;

  return (
    <>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines.positions, 3] as [Float32Array, number]} count={lines.count} />
          <bufferAttribute attach="attributes-color" args={[lines.colors, 3] as [Float32Array, number]} count={lines.count} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={selectedArea !== null ? 0.25 * edgeThickness : 0.45 * edgeThickness} linewidth={edgeThickness} depthTest />
      </lineSegments>

      {hoveredLine && (
        <Line
          points={hoveredLine}
          color="#00e5ff"
          lineWidth={2 + edgeThickness}
          transparent
          opacity={0.95}
          depthTest={false}
        />
      )}

      {selectedLine && (
        <Line
          points={selectedLine}
          color="#ff3333"
          lineWidth={2 + edgeThickness}
          transparent
          opacity={0.95}
          depthTest
        />
      )}
    </>
  );
}

function findEdgePoints(
  edges: TopologicalEdge[],
  key: string | null,
): [[number, number, number], [number, number, number]] | null {
  if (!key) return null;
  const [a, b] = key.split("_").map(Number);
  const e = edges.find(
    (x) =>
      (x.srcId === a && x.dstId === b) ||
      (x.srcId === b && x.dstId === a),
  );
  if (!e) return null;
  return [e.srcPos, e.dstPos];
}

function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}
