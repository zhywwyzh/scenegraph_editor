import { useMemo } from "react";
import type { TopologicalNode } from "../lib/types";

interface Props {
  nodes: TopologicalNode[];
  visible: boolean;
  selectedArea: number | null;
  selectedNodeIds: Set<number>;
  hoveredNodeId: number | null;
  nodeSize: number;
}

/**
 * Topological nodes rendered as batch points.
 * Selected and hovered nodes get highlight spheres.
 */
export function TopologicalNodes({
  nodes,
  visible,
  selectedArea,
  selectedNodeIds,
  hoveredNodeId,
  nodeSize,
}: Props) {
  const groups = useMemo(() => {
    const byArea = new Map<number, TopologicalNode[]>();
    for (const n of nodes) {
      const key = n.areaId;
      if (!byArea.has(key)) byArea.set(key, []);
      byArea.get(key)!.push(n);
    }
    return [...byArea.entries()].map(([areaId, ns]) => {
      const pos = new Float32Array(ns.length * 3);
      for (let i = 0; i < ns.length; i++) {
        pos[i * 3] = ns[i].position[0];
        pos[i * 3 + 1] = ns[i].position[1];
        pos[i * 3 + 2] = ns[i].position[2];
      }
      const dimmed = selectedArea !== null && selectedArea !== areaId;
      return { areaId, positions: pos, color: ns[0]?.colorHex ?? "#888", dimmed };
    });
  }, [nodes, selectedArea]);

  const selectedNodes = useMemo(
    () => nodes.filter((n) => selectedNodeIds.has(n.id)),
    [nodes, selectedNodeIds],
  );

  const hoveredNode = useMemo(
    () =>
      hoveredNodeId !== null && !selectedNodeIds.has(hoveredNodeId)
        ? nodes.find((n) => n.id === hoveredNodeId) ?? null
        : null,
    [nodes, hoveredNodeId, selectedNodeIds],
  );

  if (!visible) return null;

  const selRadius = nodeSize * 1.35;
  const hovRadius = nodeSize * 1.15;

  return (
    <>
      {/* Batch points */}
      {groups.map(({ areaId, positions, color, dimmed }) => (
        <points key={areaId}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3] as [Float32Array, number]} count={positions.length / 3} />
          </bufferGeometry>
          <pointsMaterial
            color={color}
            size={nodeSize}
            sizeAttenuation
            transparent
            opacity={dimmed ? 0.2 : 0.85}
            depthTest
          />
        </points>
      ))}

      {/* Selected node highlights */}
      {selectedNodes.map((n) => (
        <mesh key={`sel-${n.id}`} position={n.position}>
          <sphereGeometry args={[selRadius, 16, 10]} />
          <meshBasicMaterial color="#ffaa00" transparent opacity={0.9} depthTest />
        </mesh>
      ))}

      {hoveredNode && (
        <mesh position={hoveredNode.position}>
          <sphereGeometry args={[hovRadius, 16, 10]} />
          <meshBasicMaterial
            color="#00e5ff"
            transparent
            opacity={0.95}
            depthTest={false}
          />
        </mesh>
      )}
    </>
  );
}
