import type { SearchPlatform } from "lavalink-client";

/** Is the string a parseable URL? (URLs are handed to Lavalink as-is for detection.) */
export function isURL(input: string): boolean {
  try {
    const u = new URL(input.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Decide the search source for `/play`:
 *  - URLs -> undefined (let Lavalink auto-detect YouTube/Spotify/SoundCloud links).
 *  - plain queries -> the configured default platform (e.g. ytmsearch).
 */
export function searchSourceFor(
  query: string,
  defaultPlatform: SearchPlatform,
): SearchPlatform | undefined {
  return isURL(query) ? undefined : defaultPlatform;
}

/** Pretty source label + emoji for embeds, derived from a track's `sourceName`. */
export function sourceLabel(sourceName?: string): { emoji: string; name: string } {
  switch ((sourceName ?? "").toLowerCase()) {
    case "youtube":
      return { emoji: "📺", name: "YouTube" };
    case "youtubemusic":
      return { emoji: "🎵", name: "YouTube Music" };
    case "spotify":
      return { emoji: "🟢", name: "Spotify" };
    case "soundcloud":
      return { emoji: "🟠", name: "SoundCloud" };
    case "deezer":
      return { emoji: "🎧", name: "Deezer" };
    case "applemusic":
      return { emoji: "🍎", name: "Apple Music" };
    case "bandcamp":
      return { emoji: "🔵", name: "Bandcamp" };
    case "twitch":
      return { emoji: "🟣", name: "Twitch" };
    case "http":
      return { emoji: "🔗", name: "Direct" };
    default:
      return { emoji: "🎶", name: sourceName ?? "Unknown" };
  }
}

/**
 * Layer-3 fallback (spec §3): pick a DIFFERENT search prefix than the one that
 * just failed, so a re-resolve doesn't hit the same broken path. YouTube
 * failures fall back to SoundCloud (no-auth, survives a full YT outage);
 * everything else falls back to YouTube Music.
 */
export function altSearchSource(failedSourceName?: string): SearchPlatform {
  switch ((failedSourceName ?? "").toLowerCase()) {
    case "youtube":
    case "youtubemusic":
    case "spotify": // mirrored via YT by default — try SoundCloud instead
      return "scsearch";
    case "soundcloud":
      return "ytmsearch";
    default:
      return "scsearch";
  }
}
