/**
 * Generic PCD (Point Cloud Data) loader.
 *
 * Parses the header to locate x/y/z fields regardless of field order
 * or padding. Supports both simple (object) and complex (scene) layouts.
 */

export interface PcdMeta {
  points: number;
  fields: string[];
  /** Byte offset of x, y, z within each point record. */
  xOff: number;
  yOff: number;
  zOff: number;
  /** Total bytes per point record (stride). */
  stride: number;
}

export interface PcdResult {
  positions: Float32Array;
  meta: PcdMeta;
}

export async function loadPcd(url: string): Promise<PcdResult> {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`PCD load failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return parsePcdBuffer(buf);
}

export function parsePcdBuffer(buf: ArrayBuffer): PcdResult {
  const view = new DataView(buf);
  const headerEnd = findHeaderEnd(view);
  const header = new TextDecoder().decode(new Uint8Array(buf, 0, headerEnd));
  const meta = parseHeader(header);
  const dataOffset = headerEnd + 1; // skip \n after "DATA binary"

  const positions = new Float32Array(meta.points * 3);
  const le = isLittleEndian(view, dataOffset, meta.points, meta.stride, meta.xOff);

  for (let i = 0; i < meta.points; i++) {
    const base = dataOffset + i * meta.stride;
    positions[i * 3] = view.getFloat32(base + meta.xOff, le);
    positions[i * 3 + 1] = view.getFloat32(base + meta.yOff, le);
    positions[i * 3 + 2] = view.getFloat32(base + meta.zOff, le);
  }

  return { positions, meta };
}

function findHeaderEnd(view: DataView): number {
  let text = "";
  for (let i = 0; i < Math.min(view.byteLength, 8192); i++) {
    text += String.fromCharCode(view.getUint8(i));
    if (text.includes("DATA binary\n")) return i;
  }
  throw new Error("Could not find PCD header end marker");
}

function parseHeader(header: string): PcdMeta {
  const lines = header.split("\n");

  let points = 0;
  const fieldNames: string[] = [];
  const sizes: number[] = [];
  const types: string[] = [];
  const counts: number[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const key = parts[0];
    if (key === "POINTS") points = parseInt(parts[1]!, 10);
    if (key === "FIELDS") fieldNames.push(...parts.slice(1));
    if (key === "SIZE") sizes.push(...parts.slice(1).map(Number));
    if (key === "TYPE") types.push(...parts.slice(1));
    if (key === "COUNT") counts.push(...parts.slice(1).map(Number));
  }

  if (points <= 0) throw new Error(`Invalid PCD point count: ${points}`);

  // Compute byte offsets for each named field
  const offsets = new Map<string, number>();
  let off = 0;
  for (let i = 0; i < fieldNames.length; i++) {
    offsets.set(fieldNames[i]!, off);
    const byteSize = (sizes[i] ?? 4) * (counts[i] ?? 1);
    off += byteSize;
  }
  const stride = off;

  const xOff = offsets.get("x");
  const yOff = offsets.get("y");
  const zOff = offsets.get("z");
  if (xOff === undefined || yOff === undefined || zOff === undefined) {
    throw new Error(`PCD missing x/y/z fields. Found: ${fieldNames.join(", ")}`);
  }

  return { points, fields: fieldNames, xOff, yOff, zOff, stride };
}

function isLittleEndian(
  view: DataView,
  offset: number,
  points: number,
  stride: number,
  xOff: number,
): boolean {
  if (points === 0) return true;
  const xLe = view.getFloat32(offset + xOff, true);
  // Heuristic: if the value is absurdly large, it's probably BE
  if (!isFinite(xLe) || Math.abs(xLe) > 1e9) return false;
  return true;
}
