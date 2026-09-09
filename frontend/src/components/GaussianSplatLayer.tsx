import { useEffect, useRef } from "react";
import * as THREE from "three";
import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";

export type SplatFormat = "ply" | "splat" | "ksplat" | "spz";

const FORMAT_TO_SCENE_FORMAT: Record<SplatFormat, number> = {
  ply: GaussianSplats3D.SceneFormat.Ply,
  splat: GaussianSplats3D.SceneFormat.Splat,
  ksplat: GaussianSplats3D.SceneFormat.KSplat,
  spz: GaussianSplats3D.SceneFormat.Spz,
};

export function splatFormatOf(name: string): SplatFormat | null {
  const m = /\.(ply|splat|ksplat|spz)$/i.exec(name);
  return m ? (m[1].toLowerCase() as SplatFormat) : null;
}

/**
 * 3DGS render layer for the R3F canvas.
 *
 * Uses the library's DropInViewer (a THREE.Group subclass), mounted inside a
 * plain <group> so the splat scene shares the host scene graph — same camera,
 * same OrbitControls, and (crucially) the same Z-up→Y-up rotated group as
 * the PCD layers, keeping coordinates aligned between render modes. No
 * self-driven RAF: sorting is driven by the host render loop through the
 * viewer's internal onBeforeRender callback mesh.
 *
 * The viewer is created inside the effect (not useMemo) so each effect run —
 * including React StrictMode's double mount — owns a fresh instance that its
 * cleanup can dispose safely.
 */
export function GaussianSplatLayer({
  src,
  format,
  onLoadingChange,
  onError,
}: {
  src: string;
  format: SplatFormat;
  onLoadingChange?: (loading: boolean) => void;
  onError?: (message: string | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const parent = groupRef.current;
    if (!parent) return;

    const viewer = new GaussianSplats3D.DropInViewer({
      // Avoid SharedArrayBuffer / cross-origin-isolation requirements
      // (the Vite dev server sends no COOP/COEP headers).
      sharedMemoryForWorkers: false,
      gpuAcceleratedSort: false,
      integerBasedSort: false,
    });

    let disposed = false;
    let attached = false;
    onLoadingChange?.(true);
    onError?.(null);

    viewer
      .addSplatScene(src, {
        format: FORMAT_TO_SCENE_FORMAT[format],
        showLoadingUI: false,
      })
      .then(() => {
        if (disposed) return;
        parent.add(viewer);
        attached = true;
        onLoadingChange?.(false);
      })
      .catch((e: unknown) => {
        if (disposed) return;
        onLoadingChange?.(false);
        onError?.(e instanceof Error ? e.message : String(e));
      });

    return () => {
      disposed = true;
      if (attached) parent.remove(viewer);
      // DropInViewer has no dispose of its own — dispose the internal
      // Viewer to free workers/GPU resources. A rejection here is expected
      // during teardown (in-flight download) and is only logged; the next
      // mount's effect re-asserts the loading state on its own.
      try {
        void viewer.viewer.dispose().catch((e: unknown) => {
          console.warn("Gaussian splat viewer dispose failed:", e);
        });
      } catch (e) {
        console.warn("Gaussian splat viewer dispose threw:", e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, format]);

  return <group ref={groupRef} />;
}
