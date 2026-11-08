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

/** Locale fixed so the result never depends on the host's default locale. */
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Truncate to `max` UTF-16 code units (the ellipsis counts toward `max`), cutting
 * only between whole characters so emoji like 👩‍💻, 🇸🇰 or 👍🏽 never come out broken.
 */
export function truncate(text: string, max = 60): string {
  if (!text) return "";
  if (!(text.length > max)) return text;
  // Same budget as the former slice(0, max - 1), including its negative-index meaning for max < 1.
  const budget = max - 1 < 0 ? Math.max(text.length + max - 1, 0) : max - 1;
  let end = 0;
  for (const { index, segment } of graphemes.segment(text)) {
    if (index + segment.length > budget) break;
    end = index + segment.length;
  }
  return `${text.slice(0, end).trimEnd()}…`;
}

/** Split an array into chunks of `size`. */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`chunk size must be a positive integer, got ${size}`);
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
