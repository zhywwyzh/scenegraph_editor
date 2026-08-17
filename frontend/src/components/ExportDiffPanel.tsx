import { useEffect, useState, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { loadSceneGraph } from "../lib/scene-loader";
import type { SceneData } from "../lib/types";
import { TopologicalNodes } from "./TopologicalNodes";
import { TopologicalEdges } from "./TopologicalEdges";
import { WorldAxes } from "./WorldAxes";

interface Props {
  snapshot: string;
  onClose: () => void;
}

// ---- bidirectional camera sync ----

interface CamState {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  target: THREE.Vector3;
}

type Side = "left" | "right";

function SyncedControls({
  side,
  syncState,
  masterLock,
}: {
  side: Side;
  syncState: React.MutableRefObject<CamState>;
  masterLock: React.MutableRefObject<Side | null>;
}) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    const el = gl.domElement;
    const onDown = () => {
      masterLock.current = side;
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [gl, side, masterLock]);

  useFrame(() => {
    const ctr = controlsRef.current;
    if (!ctr) return;

    if (masterLock.current === side) {
      syncState.current.position.copy(camera.position);
      syncState.current.quaternion.copy(camera.quaternion);
      syncState.current.target.copy(ctr.target);
    } else if (masterLock.current !== null) {
      camera.position.copy(syncState.current.position);
      camera.quaternion.copy(syncState.current.quaternion);
      ctr.target.copy(syncState.current.target);
      ctr.update();
    }
  });

  return <OrbitControls ref={controlsRef} enableDamping={false} />;
}

// ---- stats bar ----

function StatsBar({ label, data, color }: { label: string; data: SceneData; color: string }) {
  return (
    <div style={{
      position: "absolute", bottom: 8, left: 8, zIndex: 5,
      display: "flex", alignItems: "center", gap: 6,
      background: "rgba(0,0,0,0.65)", borderRadius: 4, padding: "3px 8px",
      color, fontFamily: "monospace", fontSize: 11,
    }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span>|</span>
      <span>{data.topoNodes.length}p</span>
      <span>{data.topoEdges.length}e</span>
    </div>
  );
}

// ---- main panel ----

export function ExportDiffPanel({ snapshot, onClose }: Props) {
  const [saved, setSaved] = useState<SceneData | null>(null);
  const [exported, setExported] = useState<SceneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const syncState = useRef<CamState>({
    position: new THREE.Vector3(12, 25, 20),
    quaternion: new THREE.Quaternion(),
    target: new THREE.Vector3(0, 0, 0),
  });
  const masterLock = useRef<Side | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, e] = await Promise.all([
          loadSceneGraph(`/api/scene-graph?snapshot=${snapshot}&source=saved`),
          loadSceneGraph(`/api/scene-graph?snapshot=${snapshot}&source=exported`),
        ]);
        setSaved(s);
        setExported(e);
      } catch (err: any) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [snapshot]);

  if (loading) {
    return (
      <div style={overlayStyle}>
        <div style={{ color: "#888", fontFamily: "monospace", fontSize: 14 }}>
          Loading data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={overlayStyle}>
        <div style={{ color: "#c33", fontFamily: "monospace", fontSize: 14 }}>
          {error.includes("404") ? "No export found for this snapshot." : error}
        </div>
        <button onClick={onClose} style={closeBtnStyle}>Close</button>
      </div>
    );
  }

  if (!saved || !exported) return null;

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 30,
      display: "flex", flexDirection: "column",
      background: "#111",
    }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
        padding: "6px 12px", background: "#1a1a1a",
        color: "#aaa", fontFamily: "monospace", fontSize: 12,
      }}>
        <span style={{ color: "#fff", fontWeight: 600 }}>
          {snapshot}
        </span>
        <span style={{ color: "#555" }}>—</span>
        <span style={{ color: "#888" }}>use mouse on either side, cameras stay in sync</span>
        <span style={{ color: "#333" }}>|</span>
        <button onClick={onClose} style={closeBtnStyle}>Close</button>
      </div>

      {/* Two-column canvases */}
      <div style={{ display: "flex", flex: 1 }}>
        <div style={{ flex: 1, position: "relative", borderRight: "1px solid #333" }}>
          <StatsBar label="SAVED" data={saved} color="#888" />
          <Canvas>
            <PerspectiveCamera makeDefault position={[12, 25, 20]} />
            <SyncedControls side="left" syncState={syncState} masterLock={masterLock} />
            <ambientLight intensity={0.8} />
            <directionalLight position={[10, 15, 5]} intensity={1.2} />
            <WorldAxes />
            <group rotation={[-Math.PI / 2, 0, 0]}>
              <gridHelper args={[80, 80, "#333", "#222"]} />
            </group>
            <TopologicalNodes nodes={saved.topoNodes} visible selectedArea={null} selectedNodeIds={new Set()} hoveredNodeId={null} nodeSize={0.12} />
            <TopologicalEdges edges={saved.topoEdges} visible selectedArea={null} selectedEdgeKey={null} hoveredEdgeKey={null} edgeThickness={1} />
          </Canvas>
        </div>
        <div style={{ flex: 1, position: "relative" }}>
          <StatsBar label="EXPORTED" data={exported} color="#ddd" />
          <Canvas>
            <PerspectiveCamera makeDefault position={[12, 25, 20]} />
            <SyncedControls side="right" syncState={syncState} masterLock={masterLock} />
            <ambientLight intensity={0.8} />
            <directionalLight position={[10, 15, 5]} intensity={1.2} />
            <WorldAxes />
            <group rotation={[-Math.PI / 2, 0, 0]}>
              <gridHelper args={[80, 80, "#333", "#222"]} />
            </group>
            <TopologicalNodes nodes={exported.topoNodes} visible selectedArea={null} selectedNodeIds={new Set()} hoveredNodeId={null} nodeSize={0.12} />
            <TopologicalEdges edges={exported.topoEdges} visible selectedArea={null} selectedEdgeKey={null} hoveredEdgeKey={null} edgeThickness={1} />
          </Canvas>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "absolute", inset: 0, zIndex: 30,
  display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", gap: 16,
  background: "#111",
};

const closeBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.1)",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  color: "#ccc",
  padding: "3px 12px",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: 12,
};
