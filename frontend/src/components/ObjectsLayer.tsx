import { useMemo } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { SceneObject, TopologicalNode } from "../lib/types";

interface Props {
  objects: SceneObject[];
  /** Effective nodes keyed by id, for looking up father_poly positions. */
  nodeMap: Map<number, TopologicalNode>;
  visible: boolean;
  selectedArea: number | null;
  selectedObjectIds: Set<number>;
  hoveredObjectId: number | null;
}

/**
 * Renders scene objects as colored spheres with labels and
 * connection lines to their father-poly nodes.
 */
export function ObjectsLayer({
  objects,
  nodeMap,
  visible,
  selectedArea,
  selectedObjectIds,
  hoveredObjectId,
}: Props) {
  // Batch-render spheres grouped by area for performance
  const groups = useMemo(() => {
    const byArea = new Map<number, SceneObject[]>();
    for (const o of objects) {
      const key = o.areaId;
      if (!byArea.has(key)) byArea.set(key, []);
      byArea.get(key)!.push(o);
    }
    return [...byArea.entries()].map(([areaId, objs]) => {
      const pos = new Float32Array(objs.length * 3);
      for (let i = 0; i < objs.length; i++) {
        pos[i * 3] = objs[i].position[0];
        pos[i * 3 + 1] = objs[i].position[1];
        pos[i * 3 + 2] = objs[i].position[2];
      }
      const dimmed = selectedArea !== null && selectedArea !== areaId;
      return { areaId, positions: pos, color: objs[0]?.colorHex ?? "#e66", dimmed };
    });
  }, [objects, selectedArea]);

  const selectedObjects = useMemo(
    () => objects.filter((o) => selectedObjectIds.has(o.id)),
    [objects, selectedObjectIds],
  );

  const hoveredObject = useMemo(
    () =>
      hoveredObjectId !== null && !selectedObjectIds.has(hoveredObjectId)
        ? objects.find((o) => o.id === hoveredObjectId) ?? null
        : null,
    [objects, hoveredObjectId, selectedObjectIds],
  );

  // Connection lines: object → father_poly node
  const connectionLines = useMemo(() => {
    const lines: { objPos: [number, number, number]; nodePos: [number, number, number]; objId: number }[] = [];
    for (const o of objects) {
      if (o.fatherPolyId < 0) continue;
      const node = nodeMap.get(o.fatherPolyId);
      if (!node) continue;
      lines.push({ objPos: o.position, nodePos: node.position, objId: o.id });
    }
    return lines;
  }, [objects, nodeMap]);

  if (!visible) return null;

  return (
    <>
      {/* Batch spheres */}
      {groups.map(({ areaId, positions, color, dimmed }) => (
        <points key={`obj-${areaId}`}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[positions, 3] as [Float32Array, number]}
              count={positions.length / 3}
            />
          </bufferGeometry>
          <pointsMaterial
            color={color}
            size={0.15}
            sizeAttenuation
            transparent
            opacity={dimmed ? 0.2 : 0.9}
            depthTest
          />
        </points>
      ))}

      {/* Selected object highlights */}
      {selectedObjects.map((o) => (
        <mesh key={`obj-sel-${o.id}`} position={o.position}>
          <sphereGeometry args={[0.25, 16, 10]} />
          <meshBasicMaterial color="#ffaa00" transparent opacity={0.9} depthTest />
        </mesh>
      ))}

      {/* Hovered object highlight */}
      {hoveredObject && (
        <mesh position={hoveredObject.position}>
          <sphereGeometry args={[0.22, 16, 10]} />
          <meshBasicMaterial
            color="#00e5ff"
            transparent
            opacity={0.95}
            depthTest={false}
          />
        </mesh>
      )}

      {/* Connection cylinders: object → father_poly (green, thick) */}
      {connectionLines.map(({ objPos, nodePos, objId }) => (
        <ConnectionCylinder
          key={`conn-${objId}`}
          start={objPos}
          end={nodePos}
        />
      ))}

      {/* 3D HTML labels */}
      {objects.map((o) => {
        const labelPos: [number, number, number] = [
          o.position[0],
          o.position[1],
          o.position[2] + 0.25,
        ];
        const isSelected = selectedObjectIds.has(o.id);
        return (
          <Html
            key={`label-${o.id}`}
            position={labelPos}
            center
            style={{
              color: isSelected ? "#ffaa00" : "#ccc",
              fontSize: 10,
              fontFamily: "monospace",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              textShadow: "0 0 4px rgba(0,0,0,0.8)",
            }}
          >
            {o.label} [{o.id}]
          </Html>
        );
      })}
    </>
  );
}

// ---- cylinder between two points ----

function ConnectionCylinder({
  start,
  end,
}: {
  start: [number, number, number];
  end: [number, number, number];
}) {
  const sx = start[0], sy = start[1], sz = start[2];
  const ex = end[0], ey = end[1], ez = end[2];

  const mid: [number, number, number] = [
    (sx + ex) / 2,
    (sy + ey) / 2,
    (sz + ez) / 2,
  ];

  const dx = ex - sx;
  const dy = ey - sy;
  const dz = ez - sz;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length < 1e-6) return null;

  // Direction unit vector
  const nx = dx / length;
  const ny = dy / length;
  const nz = dz / length;

  // Quaternion from default cylinder axis (Y-up) to direction vector
  const quaternion = new THREE.Quaternion();
  quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(nx, ny, nz),
  );

  return (
    <mesh position={mid} quaternion={quaternion}>
      <cylinderGeometry args={[0.04, 0.04, length, 6]} />
      <meshBasicMaterial color="#22cc44" transparent opacity={0.75} depthTest />
    </mesh>
  );
}
