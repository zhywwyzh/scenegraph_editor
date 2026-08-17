import { useMemo } from "react";

export type PcdColorScheme = "flat" | "rainbow" | "coolwarm" | "gray" | "xray" | "yray";

interface Props {
  positions: Float32Array | null;
  colorHex: string;
  pointSize: number;
  colorScheme: PcdColorScheme;
}

const SCHEME_LABELS: Record<PcdColorScheme, string> = {
  flat: "Flat (object color)",
  rainbow: "Rainbow (Z height)",
  coolwarm: "Cool-Warm (Z)",
  gray: "Grayscale (Z)",
  xray: "X-Ray (X axis)",
  yray: "Y-Ray (Y axis)",
};

export { SCHEME_LABELS };

/**
 * Renders a point cloud with configurable color scheme.
 * "flat" = single color; other schemes map position to per-point color.
 */
export function PointCloudLayer({ positions, colorHex, pointSize, colorScheme }: Props) {
  const { geom, colors } = useMemo(() => {
    if (!positions || positions.length === 0) return { geom: null, colors: null };
    const count = positions.length / 3;

    if (colorScheme === "flat") {
      return { geom: { positions, count }, colors: null };
    }

    // Compute per-point colors
    const clr = new Float32Array(positions.length);
    applyColorScheme(positions, clr, colorScheme);
    return { geom: { positions, count }, colors: clr };
  }, [positions, colorScheme]);

  if (!geom) return null;

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[geom.positions, 3] as [Float32Array, number]}
          count={geom.count}
        />
        {colors && (
          <bufferAttribute
            attach="attributes-color"
            args={[colors, 3] as [Float32Array, number]}
            count={geom.count}
          />
        )}
      </bufferGeometry>
      <pointsMaterial
        color={colors ? undefined : colorHex}
        size={pointSize}
        sizeAttenuation
        transparent
        opacity={0.7}
        depthTest
        vertexColors={!!colors}
      />
    </points>
  );
}

// ---- color-scheme helpers ----

function applyColorScheme(positions: Float32Array, out: Float32Array, scheme: PcdColorScheme): void {
  const n = positions.length / 3;
  let minV = Infinity, maxV = -Infinity;

  // Determine value axis
  const getVal = (i: number): number => {
    if (scheme === "xray") return positions[i * 3]!;
    if (scheme === "yray") return positions[i * 3 + 1]!;
    return positions[i * 3 + 2]!; // z-height for rainbow/coolwarm/gray
  };

  for (let i = 0; i < n; i++) {
    const v = getVal(i);
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const range = maxV - minV || 1;

  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(1, (getVal(i) - minV) / range));
    const [r, g, b] = schemeFn(scheme, t);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
}

function schemeFn(scheme: PcdColorScheme, t: number): [number, number, number] {
  switch (scheme) {
    case "rainbow":
      return jet(t);
    case "coolwarm":
      return coolWarm(t);
    case "gray":
      return [t, t, t];
    case "xray":
      return jet(t);
    case "yray":
      return jet(t);
    default:
      return [1, 1, 1];
  }
}

// Jet/rainbow colormap (blue → cyan → green → yellow → red)
function jet(t: number): [number, number, number] {
  if (t < 0.125) {
    const s = t / 0.125;
    return [0, 0, 0.5 + s * 0.5];
  }
  if (t < 0.375) {
    const s = (t - 0.125) / 0.25;
    return [0, s, 1];
  }
  if (t < 0.625) {
    const s = (t - 0.375) / 0.25;
    return [s, 1, 1 - s];
  }
  if (t < 0.875) {
    const s = (t - 0.625) / 0.25;
    return [1, 1 - s, 0];
  }
  const s = (t - 0.875) / 0.125;
  return [1 - s * 0.5, 0, 0];
}

// Cool-warm diverging colormap (blue → white → red)
function coolWarm(t: number): [number, number, number] {
  if (t < 0.5) {
    const s = t * 2;
    return [s, s, 1];
  }
  const s = (t - 0.5) * 2;
  return [1, 1 - s, 1 - s];
}
