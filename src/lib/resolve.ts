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
 * Layer-3 fallback (spec §3): search sources to try, in order, after a track
 * fails. A YouTube failure first tries YouTube Music — another upload of the
 * same song usually plays when one video is blocked — then SoundCloud (no-auth,
 * survives a full YouTube outage). A SoundCloud failure goes back to YouTube.
 */
export function fallbackSearchSources(failedSourceName?: string): SearchPlatform[] {
  switch ((failedSourceName ?? "").toLowerCase()) {
    case "soundcloud":
      return ["ytmsearch", "ytsearch"];
    default: // youtube, youtubemusic, spotify (mirrored via YouTube), others
      return ["ytmsearch", "scsearch"];
  }
}
