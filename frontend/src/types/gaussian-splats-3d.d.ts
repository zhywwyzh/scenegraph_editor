/**
 * Minimal type declarations for @mkkellogg/gaussian-splats-3d (the package
 * ships no .d.ts). Only the surface used by GaussianSplatLayer is declared.
 */
declare module "@mkkellogg/gaussian-splats-3d" {
  import * as THREE from "three";

  export interface ViewerOptions {
    rootElement?: HTMLElement | null;
    threeScene?: unknown;
    cameraUp?: [number, number, number];
    initialCameraPosition?: [number, number, number];
    initialCameraLookAt?: [number, number, number];
    sharedMemoryForWorkers?: boolean;
    gpuAcceleratedSort?: boolean;
    integerBasedSort?: boolean;
    dynamicScene?: boolean;
    selfDrivenMode?: boolean;
    useBuiltInControls?: boolean;
    dropInMode?: boolean;
  }

  export const SceneFormat: {
    Splat: number;
    KSplat: number;
    Ply: number;
    Spz: number;
  };

  export interface AddSplatSceneOptions {
    format?: number;
    showLoadingUI?: boolean;
    rotation?: [number, number, number, number];
    position?: [number, number, number];
    scale?: [number, number, number];
    splatAlphaRemovalThreshold?: number;
    onProgress?: (percentComplete: number, percentLabel: string) => void;
  }

  export class Viewer {
    constructor(options?: ViewerOptions);
    addSplatScene(path: string, options?: AddSplatSceneOptions): Promise<unknown>;
    removeSplatScenes(indexes: number[], showLoadingUI?: boolean): Promise<unknown>;
    start(): void;
    stop(): void;
    dispose(): Promise<unknown>;
    camera: any;
    renderer: any;
    splatMesh: any;
    raycaster: any;
  }

  /**
   * Drop-in viewer: extends THREE.Group so it can be added directly to a
   * scene / attached via R3F <primitive>. It drives sorting through an
   * onBeforeRender callback mesh, so it renders inside the host scene's
   * normal render loop (no self-driven RAF, no built-in controls).
   */
  export class DropInViewer extends THREE.Group {
    constructor(options?: ViewerOptions);
    addSplatScene(path: string, options?: AddSplatSceneOptions): Promise<unknown>;
    removeSplatScene(index: number, showLoadingUI?: boolean): Promise<unknown>;
    removeSplatScenes(indexes: number[], showLoadingUI?: boolean): Promise<unknown>;
    getSceneCount(): number;
    /** The internal Viewer; dispose() frees workers/GPU resources. */
    viewer: Viewer;
    splatMesh: any;
  }
}
