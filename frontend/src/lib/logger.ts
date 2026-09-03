/**
 * Lightweight event logger. Mirrors key UI events to the browser console and
 * to the backend log file (logs/YYYY-MM-DD.log) via a fire-and-forget POST,
 * so issues like failed exports or broken undo can be diagnosed after the fact.
 */

let seq = 0;

export function logEvent(event: string, detail?: unknown): void {
  const entry = {
    t: new Date().toISOString(),
    seq: ++seq,
    event,
    detail,
  };
  // Always visible in the browser DevTools console
  console.log("[scenegraph-editor]", entry.event, detail ?? "");

  // Best-effort persistence on the backend; never blocks or throws
  try {
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
