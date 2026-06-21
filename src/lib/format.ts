/** Formatting helpers: durations, progress bars, truncation, time parsing. */

/** Convert milliseconds to `m:ss` or `h:mm:ss`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** A text progress bar with a knob, e.g. `▬▬▬🔘▬▬▬▬▬`. */
export function progressBar(position: number, duration: number, size = 18): string {
  if (!Number.isFinite(duration) || duration <= 0) return "🔴 LIVE";
  const ratio = Math.min(Math.max(position / duration, 0), 1);
  const idx = Math.min(Math.round(ratio * (size - 1)), size - 1);
  let bar = "";
  for (let i = 0; i < size; i++) bar += i === idx ? "🔘" : "▬";
  return bar;
}

/** Truncate to `max` chars with an ellipsis. */
export function truncate(text: string, max = 60): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Split an array into chunks of `size`. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Parse a user time string into milliseconds.
 * Accepts plain seconds (`90`), `mm:ss` (`1:30`) or `h:mm:ss` (`1:02:03`).
 * Returns null on malformed input.
 */
export function parseTimeToMs(input: string): number | null {
  const s = input.trim();
  if (s === "") return null;
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const parts = s.split(":").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.length === 2) return (nums[0] * 60 + nums[1]) * 1000;
  return (nums[0] * 3600 + nums[1] * 60 + nums[2]) * 1000;
}
