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

// ---------------------------------------------------------------------------
// Single-instance in-page cache.
//
// Loading a Gaussian splat scene (fetch + parse + GPU texture upload) is the
// expensive part — for a ~450MB PLY it takes many seconds. The library keeps
// the parsed buffers and uploaded textures alive as long as the DropInViewer
// instance lives, and simply re-attaching a kept-alive viewer renders
// instantly (no network, no re-parse, no texture re-upload).
//
// So we cache exactly ONE viewer (the currently-selected file). Unmounting a
// layer detaches the viewer from its parent group but does NOT dispose it, so
// toggling render mode back reuses it. Switching to a different file replaces
// the cached entry and disposes the previous one.
// ---------------------------------------------------------------------------

interface CacheEntry {
  src: string;
  format: SplatFormat;
  viewer: GaussianSplats3D.DropInViewer;
  ready: Promise<void>;
}

let cache: CacheEntry | null = null;

function createViewer(src: string, format: SplatFormat): CacheEntry {
  const viewer = new GaussianSplats3D.DropInViewer({
    // Avoid SharedArrayBuffer / cross-origin-isolation requirements
    // (the Vite dev server sends no COOP/COEP headers).
    sharedMemoryForWorkers: false,
    gpuAcceleratedSort: false,
    integerBasedSort: false,
  });
  const ready = viewer
    .addSplatScene(src, {
      format: FORMAT_TO_SCENE_FORMAT[format],
      showLoadingUI: false,
    })
    .then(() => undefined);
  return { src, format, viewer, ready };
}

/** Get the cached viewer for `src`, creating (and caching) it if needed. */
function getViewer(src: string, format: SplatFormat): CacheEntry {
  if (cache && cache.src === src) {
    return cache;
  }
  // Replacing the cache with a different file: dispose the previous viewer to
  // free its GPU textures / workers. Only the single current entry is kept.
  if (cache) {
    try {
      void cache.viewer.viewer.dispose().catch(() => undefined);
    } catch {
      /* teardown may throw during in-flight download; ignore */
    }
  }
  cache = createViewer(src, format);
  return cache;
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
 * The viewer is kept in a module-level single-instance cache (see above), so
 * unmounting this layer only detaches the viewer — switching back re-renders
 * instantly without re-downloading/re-parsing the scene.
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

    let disposed = false;
    let attached = false;

    // Reuse (or create) the cached viewer for this file.
    const entry = getViewer(src, format);

    onLoadingChange?.(true);
    onError?.(null);

    entry.ready
      .then(() => {
        if (disposed) return;
        parent.add(entry.viewer);
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
      // Detach only — do NOT dispose. The cached viewer stays alive so
      // toggling render mode back renders instantly from its GPU buffers.
      if (attached) parent.remove(entry.viewer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, format]);

  return <group ref={groupRef} />;
}
