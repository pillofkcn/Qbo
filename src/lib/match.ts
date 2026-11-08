import type { Track, UnresolvedTrack } from "lavalink-client";

/**
 * Pure helpers for the Layer-3 fallback (spec §3): turn a failed track into a
 * search query, and pick a replacement that is the same song — never a cover,
 * remix or unrelated upload. Skipping a track beats playing the wrong one.
 */

/** What the matcher needs to know about the track that failed. */
export interface TrackMeta {
  title: string;
  author: string;
  durationMs: number;
  isStream: boolean;
  identifier: string;
  sourceName: string;
}

const MAX_CANDIDATES = 10;
/** Share of the original title's words a candidate must contain (all of them for 1–2 words). */
const MIN_TITLE_COVERAGE = 0.75;
/** Allowed length difference: the larger of the two. */
const DURATION_TOLERANCE_MS = 10_000;
const DURATION_TOLERANCE_RATIO = 0.12;
/** SoundCloud serves 30 s previews for some tracks. */
const PREVIEW_MS = 30_000;

const STOPWORDS = new Set(["the", "a", "an", "and", "of", "x", "vs", "with", "by"]);
/** Words that mark a different version of a song, unless the original has them too. */
const VERSION_WORDS = [
  "remix", "cover", "live", "karaoke", "instrumental", "acoustic", "nightcore",
  "sped", "slowed", "reverb", "8d", "mashup", "bootleg",
];

/** Bracketed noise: "(Official Video)", "[Lyrics]", "(feat. X)", "(2011 Remaster)". */
const NOISE_BRACKETS =
  /[([{][^)\]}]*(official|video|audio|lyric|visuali[sz]er|\bhd\b|\bhq\b|\b4k\b|\bmv\b|m\/v|explicit|remaster|feat\.|\bft\.|featuring)[^)\]}]*[)\]}]/gi;
/** A trailing " - Remastered 2011" / " - Radio Edit" style suffix. */
const NOISE_SUFFIX = /\s[-–—]\s[^-–—]*\b(remaster(ed)?|version|edit|mono|stereo)\b[^-–—]*$/i;
const FEATURING = /\s(feat\.?|ft\.?|featuring)\s.*$/i;
/** Channel-name decorations: "Artist - Topic", "ArtistVEVO", "Artist Official". */
const ARTIST_SUFFIX = /(\s*-\s*topic|vevo|\s+official(\s+(channel|artist))?)$/i;

function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // strip diacritics so "Dávid" matches "David"
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => (w.length > 1 || /\d/.test(w)) && !STOPWORDS.has(w));
}

function cleanTitle(title: string): string {
  return title
    .replace(NOISE_BRACKETS, " ")
    .split("|")[0]
    .replace(NOISE_SUFFIX, "")
    .replace(FEATURING, "")
    .trim();
}

function cleanArtist(author: string): string {
  const stripped = author.replace(ARTIST_SUFFIX, "").trim();
  // VEVO channels glue the name together: "RickAstleyVEVO" -> "Rick Astley".
  return /vevo$/i.test(author.trim()) ? stripped.replace(/([a-z])([A-Z])/g, "$1 $2") : stripped;
}

/** Uploads titled "Artist - Title" (lyric channels, re-uploads) carry the artist in the title. */
function artistAndTitle(meta: Pick<TrackMeta, "title" | "author">): { artist: string; title: string } {
  const title = cleanTitle(meta.title);
  const split = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return split ? { artist: split[1], title: split[2] } : { artist: cleanArtist(meta.author), title };
}

/** Search query for finding `meta` on another source, e.g. "Rick Astley Never Gonna Give You Up". */
export function fallbackQuery(meta: TrackMeta): string {
  const { artist, title } = artistAndTitle(meta);
  const titleWords = new Set(words(title));
  const artistWords = words(artist);
  const artistInTitle = artistWords.every((w) => titleWords.has(w));
  return (artistInTitle ? title : `${artist} ${title}`).trim() || meta.title;
}

const isResolved = (track: Track | UnresolvedTrack): track is Track =>
  typeof track.encoded === "string" && !("resolve" in track);

function isPreview(track: Track, original: TrackMeta): boolean {
  if (track.pluginInfo?.isPreview) return true;
  if (track.info.sourceName !== "soundcloud") return false;
  return (
    track.info.identifier.includes("/preview/") ||
    // Unreachable today: pickReplacement's length tolerance already rejects any ~30 s candidate for an original over 45 s.
    (Math.abs(track.info.duration - PREVIEW_MS) <= 1_000 && original.durationMs > 45_000)
  );
}

/**
 * The search result most likely to be the same recording as `original`, or
 * null when none qualifies. `exclude` holds identifiers already tried.
 */
export function pickReplacement(
  original: TrackMeta,
  candidates: readonly (Track | UnresolvedTrack)[],
  exclude: ReadonlySet<string>,
): Track | null {
  const { artist, title } = artistAndTitle(original);
  const titleWords = [...new Set(words(title))];
  if (titleWords.length === 0) return null;
  const artistWords = words(artist);
  const originalWords = new Set(words(original.title));
  const needed =
    titleWords.length <= 2 ? titleWords.length : Math.ceil(titleWords.length * MIN_TITLE_COVERAGE);

  let best: Track | null = null;
  let bestScore = -Infinity;
  for (const [rank, candidate] of candidates.slice(0, MAX_CANDIDATES).entries()) {
    if (!isResolved(candidate)) continue;
    const { info } = candidate;
    if (exclude.has(info.identifier) || info.isStream || !(info.duration > 0)) continue;
    if (isPreview(candidate, original)) continue;

    const candidateWords = new Set(words(`${info.title} ${info.author}`));
    const covered = titleWords.filter((w) => candidateWords.has(w)).length;
    if (covered < needed) continue;
    if (artistWords.length > 0 && !artistWords.some((w) => candidateWords.has(w))) continue;
    const candidateTitleWords = new Set(words(info.title));
    if (VERSION_WORDS.some((w) => candidateTitleWords.has(w) && !originalWords.has(w))) continue;

    let durationScore = 0.5; // unknown original length: neutral
    if (original.durationMs > 0) {
      const delta = Math.abs(info.duration - original.durationMs);
      const tolerance = Math.max(DURATION_TOLERANCE_MS, original.durationMs * DURATION_TOLERANCE_RATIO);
      if (delta > tolerance) continue;
      durationScore = 1 - delta / tolerance;
    }

    const score = 2 * (covered / titleWords.length) + durationScore - 0.05 * rank;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
