import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Track, UnresolvedTrack } from "lavalink-client";
import { fallbackQuery, pickReplacement, type TrackMeta } from "../src/lib/match.js";

function meta(title: string, author: string, durationMs = 213_000): TrackMeta {
  return { title, author, durationMs, isStream: false, identifier: "original", sourceName: "youtube" };
}

interface CandidateOpts {
  identifier?: string;
  sourceName?: string;
  isStream?: boolean;
  isPreview?: boolean;
}

/** A resolved search result, shaped like what lavalink-client returns. */
function candidate(title: string, author: string, duration: number, opts: CandidateOpts = {}): Track {
  return {
    encoded: "QAAA",
    info: {
      title,
      author,
      duration,
      identifier: opts.identifier ?? `${title}@${duration}`,
      sourceName: opts.sourceName ?? "deezer",
      isStream: opts.isStream ?? false,
    },
    pluginInfo: opts.isPreview ? { isPreview: true } : {},
  } as unknown as Track;
}

const none = new Set<string>();

describe("fallbackQuery", () => {
  it("strips video noise and takes the artist from an 'Artist - Title' upload", () => {
    assert.equal(
      fallbackQuery(meta("Rick Astley - Never Gonna Give You Up (Official Video)", "Rick Astley")),
      "Rick Astley Never Gonna Give You Up",
    );
  });

  it("prefers the artist in the title over the uploading channel", () => {
    assert.equal(fallbackQuery(meta("Daft Punk - One More Time", "Best Lyrics HD")), "Daft Punk One More Time");
  });

  it("turns a VEVO channel name into the artist", () => {
    assert.equal(fallbackQuery(meta("Never Gonna Give You Up", "RickAstleyVEVO")), "Rick Astley Never Gonna Give You Up");
  });

  it("drops ' - Topic' from auto-generated channels", () => {
    assert.equal(fallbackQuery(meta("Hello", "Adele - Topic")), "Adele Hello");
  });

  it("removes featured artists, bracketed or not", () => {
    assert.equal(fallbackQuery(meta("Stay (feat. Justin Bieber)", "The Kid LAROI")), "The Kid LAROI Stay");
    assert.equal(fallbackQuery(meta("Stay feat. Justin Bieber", "The Kid LAROI")), "The Kid LAROI Stay");
  });

  it("removes a trailing remaster suffix", () => {
    assert.equal(fallbackQuery(meta("Bohemian Rhapsody - Remastered 2011", "Queen")), "Queen Bohemian Rhapsody");
  });

  it("cuts everything after a '|'", () => {
    assert.equal(fallbackQuery(meta("Blinding Lights | Live at the Grammys promo", "The Weeknd")), "The Weeknd Blinding Lights");
  });

  it("does not repeat the artist when the title already contains it", () => {
    assert.equal(fallbackQuery(meta("Adele Hello", "Adele")), "Adele Hello");
  });

  it("falls back to the raw title when cleaning leaves nothing", () => {
    assert.equal(fallbackQuery(meta("(Official Video)", "")), "(Official Video)");
  });
});

describe("pickReplacement", () => {
  const song = meta("Never Gonna Give You Up", "Rick Astley", 213_000);
  const exact = () => candidate("Never Gonna Give You Up", "Rick Astley", 213_000);

  it("returns null when there are no candidates", () => {
    assert.equal(pickReplacement(song, [], none), null);
  });

  it("returns null when the original title has no usable words", () => {
    assert.equal(pickReplacement(meta("!!!", "Rick Astley"), [candidate("!!!", "Rick Astley", 213_000)], none), null);
  });

  it("picks the single candidate that is the same song", () => {
    const only = exact();
    assert.equal(pickReplacement(song, [only], none), only);
  });

  it("skips candidates that were already tried", () => {
    const tried = exact();
    assert.equal(pickReplacement(song, [tried], new Set([tried.info.identifier])), null);
  });

  it("skips streams, zero-length and unresolved results", () => {
    const stream = candidate("Never Gonna Give You Up", "Rick Astley", 213_000, { isStream: true });
    const zero = candidate("Never Gonna Give You Up", "Rick Astley", 0);
    const unresolved = {
      info: { title: "Never Gonna Give You Up", author: "Rick Astley", duration: 213_000, identifier: "u" },
      resolve: async () => {},
    } as unknown as UnresolvedTrack;
    assert.equal(pickReplacement(song, [stream, zero, unresolved], none), null);
  });

  it("skips previews flagged by the plugin or by a SoundCloud preview URL", () => {
    const flagged = candidate("Never Gonna Give You Up", "Rick Astley", 213_000, { isPreview: true });
    const scPreview = candidate("Never Gonna Give You Up", "Rick Astley", 213_000, {
      sourceName: "soundcloud",
      identifier: "https://cf-preview-media.sndcdn.com/preview/0/30/abc.mp3",
    });
    assert.equal(pickReplacement(song, [flagged, scPreview], none), null);
  });

  it("rejects other versions (remix, live, ...) of the song", () => {
    const remix = candidate("Never Gonna Give You Up (Remix)", "Rick Astley", 213_000);
    const live = candidate("Never Gonna Give You Up - Live", "Rick Astley", 213_000);
    assert.equal(pickReplacement(song, [remix, live], none), null);
  });

  it("accepts a version word when the original has it too", () => {
    const remix = candidate("Never Gonna Give You Up (Remix)", "Rick Astley", 213_000);
    assert.equal(pickReplacement(meta("Never Gonna Give You Up (Remix)", "Rick Astley"), [remix], none), remix);
  });

  it("rejects the right title by the wrong artist", () => {
    assert.equal(pickReplacement(song, [candidate("Never Gonna Give You Up", "Some Tribute Band", 213_000)], none), null);
  });

  it("needs three quarters of the title's words when it has more than two", () => {
    // 5 title words -> 4 must match.
    const three = candidate("Never Gonna Give", "Rick Astley", 213_000);
    const four = candidate("Never Gonna Give You", "Rick Astley", 213_000);
    assert.equal(pickReplacement(song, [three], none), null);
    assert.equal(pickReplacement(song, [four], none), four);
  });

  it("allows 12% length difference on long tracks", () => {
    // 213 s * 12% = 25.56 s
    const inside = candidate("Never Gonna Give You Up", "Rick Astley", 213_000 + 25_560);
    const outside = candidate("Never Gonna Give You Up", "Rick Astley", 213_000 + 25_561);
    assert.equal(pickReplacement(song, [inside], none), inside);
    assert.equal(pickReplacement(song, [outside], none), null);
  });

  it("allows at least 10 s length difference on short tracks", () => {
    const short = meta("Never Gonna Give You Up", "Rick Astley", 60_000); // 12% would be only 7.2 s
    const inside = candidate("Never Gonna Give You Up", "Rick Astley", 70_000);
    const outside = candidate("Never Gonna Give You Up", "Rick Astley", 70_001);
    assert.equal(pickReplacement(short, [inside], none), inside);
    assert.equal(pickReplacement(short, [outside], none), null);
  });

  it("accepts any length when the original length is unknown", () => {
    const anyLength = candidate("Never Gonna Give You Up", "Rick Astley", 999_000);
    assert.equal(pickReplacement(meta("Never Gonna Give You Up", "Rick Astley", 0), [anyLength], none), anyLength);
  });

  it("looks only at the first ten candidates", () => {
    const noise = Array.from({ length: 10 }, (_, i) => candidate(`Unrelated ${i}`, "Someone Else", 213_000));
    const tenth = exact();
    assert.equal(pickReplacement(song, [...noise.slice(0, 9), tenth], none), tenth);
    assert.equal(pickReplacement(song, [...noise, exact()], none), null);
  });

  it("prefers a closer length over a higher search rank", () => {
    const first = candidate("Never Gonna Give You Up", "Rick Astley", 213_000 + 20_000);
    const second = candidate("Never Gonna Give You Up", "Rick Astley", 213_000);
    assert.equal(pickReplacement(song, [first, second], none), second);
  });

  it("keeps the higher-ranked one when two candidates are equally good", () => {
    const first = exact();
    const second = exact();
    assert.equal(pickReplacement(song, [first, second], none), first);
  });
});
