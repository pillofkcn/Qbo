import type { Client } from "discord.js";
import type {
  LavalinkTrack,
  Player,
  Track,
  TrackEndEvent,
  TrackExceptionEvent,
  TrackStartEvent,
  TrackStuckEvent,
  UnresolvedTrack,
} from "lavalink-client";
import { truncate } from "../lib/format.js";
import { fallbackQuery, pickReplacement, type TrackMeta } from "../lib/match.js";
import { fallbackSearchSources } from "../lib/resolve.js";
import { logger } from "../logger.js";
import { clearNowPlaying, notify } from "../ui/controls.js";
import { errorEmbed, fallbackEmbed } from "../ui/embeds.js";

/**
 * Layer-3 fallback (spec §3). trackError / trackStuck only *record* a failure;
 * recovery starts on the failed track's end event (trackEnd / queueEnd), after
 * lavalink-client has finished its own handling (auto-skip, stop, queueEnd,
 * autoplay), so the player state we act on is settled. The same hook catches
 * tracks that end "finished" long before their duration — a broken stream that
 * never raised an error.
 */

type FailureKind = "error" | "stuck" | "premature";
type EndPayload = TrackEndEvent | TrackStuckEvent | TrackExceptionEvent;

const STATE_KEY = "fallback:state";
const FAILURE_KEY = "fallback:failure";
const START_KEY = "fallback:start";

/** Replacements tried per requested track before giving up. */
const MAX_FALLBACK_ATTEMPTS = 2;
/** A recorded failure must be followed by its end event within this window. */
const FAILURE_TTL_MS = 15_000;
/** A search that never settles stops holding back /play after this. */
const SEARCHING_TTL_MS = 30_000;
/** A "finished" end is premature with more than this left and less than this share played. */
const PREMATURE_MIN_REMAINING_MS = 15_000;
const PREMATURE_MAX_PLAYED_RATIO = 0.8;
/** Resume a replacement a little before the drop-out, and only past this point. */
const REWIND_MS = 2_000;
const MIN_RESUME_MS = 5_000;
/** Resume only when the replacement's length is this close to the original's. */
const RESUME_MAX_DURATION_DELTA_MS = 10_000;

interface FailureRecord {
  key: string;
  kind: "error" | "stuck";
  detail: string;
  playedMs: number;
  at: number;
}

interface StartInfo {
  key: string;
  at: number;
  startPos: number;
}

interface FallbackState {
  /** Generation id: a newer failure or a user action invalidates older searches. */
  id: number;
  phase: "searching" | "playing";
  since: number;
  /** The track the user asked for; every attempt is matched against it. */
  origin: TrackMeta;
  requester: unknown;
  /** Identifiers already tried (origin and replacements). */
  tried: string[];
  attempts: number;
  /** Index into fallbackSearchSources(origin.sourceName). */
  nextSource: number;
  /** The failed track this search is for (de-duplicates end events). */
  failedKey: string;
  resumeAt: number;
  /** The replacement now playing, and where it was started. */
  currentKey?: string;
  startPos?: number;
}

interface FailedTrack {
  key: string;
  kind: FailureKind;
  detail: string;
  meta: TrackMeta;
  requester: unknown;
  played: number;
}

let seq = 0;

/** Identify tracks by source + identifier (event payloads are rebuilt objects). */
const keyOf = (info: { sourceName?: string; identifier?: string }): string =>
  `${info.sourceName ?? "?"}:${info.identifier ?? "?"}`;

const getState = (player: Player): FallbackState | undefined =>
  player.getData<FallbackState | undefined>(STATE_KEY);

function metaOf(track: LavalinkTrack): TrackMeta {
  const { info } = track;
  return {
    title: info.title ?? "",
    author: info.author ?? "",
    durationMs: info.length ?? 0,
    isStream: !!info.isStream,
    identifier: info.identifier ?? "",
    sourceName: info.sourceName ?? "",
  };
}

/**
 * How far into `track` playback got. `player.position` keeps counting from the
 * previous track until Lavalink's first position update (playerUpdateInterval,
 * up to 5 s), so right after a start we extrapolate from our own baseline.
 */
export function playedMs(player: Player, track?: { info?: { sourceName?: string; identifier?: string } }): number {
  const start = player.getData<StartInfo | undefined>(START_KEY);
  if (!start || (track?.info && start.key !== keyOf(track.info))) return player.position;
  const updatedSinceStart = (player.lastPositionChange ?? 0) >= start.at;
  return updatedSinceStart ? player.position : start.startPos + (Date.now() - start.at);
}

/** A stalled track's position stopped moving: use the last one Lavalink reported. */
function lastReportedPosition(player: Player, key: string): number {
  const start = player.getData<StartInfo | undefined>(START_KEY);
  if (start?.key === key && (player.lastPositionChange ?? 0) < start.at) return start.startPos;
  return player.lastPosition;
}

/** Remember why the current track failed; acted upon when its end event arrives. */
export function recordFailure(
  player: Player,
  kind: "error" | "stuck",
  payload: TrackExceptionEvent | TrackStuckEvent,
  detail: string,
): void {
  if (!payload.track?.info) return;
  const key = keyOf(payload.track.info);
  const played = kind === "stuck" ? lastReportedPosition(player, key) : playedMs(player, payload.track);
  player.setData(FAILURE_KEY, { key, kind, detail, playedMs: played, at: Date.now() } satisfies FailureRecord);
}

/** Per-TrackStartEvent bookkeeping: position baseline and recovery-chain lifetime. */
export function noteTrackStart(player: Player, payload: TrackStartEvent): void {
  if (!payload.track?.info) return;
  const key = keyOf(payload.track.info);
  const state = getState(player);
  const isReplacement = state?.phase === "playing" && state.currentKey === key;
  player.setData(START_KEY, {
    key,
    at: Date.now(),
    startPos: isReplacement ? (state?.startPos ?? 0) : 0,
  } satisfies StartInfo);
  // Something other than our replacement started, so that chain is over. A
  // "searching" state survives lavalink-client's own skip to the next track.
  if (state?.phase === "playing" && !isReplacement) player.deleteData(STATE_KEY);
}

/** True while a replacement is being looked up (new /play requests queue behind it). */
export function isRecovering(player: Player): boolean {
  const state = getState(player);
  return state?.phase === "searching" && Date.now() - state.since < SEARCHING_TTL_MS;
}

/** Drop any pending or running recovery — call before user-driven skip/stop/previous/jump. */
export function cancelFallback(player: Player): void {
  player.deleteData(STATE_KEY);
  player.deleteData(FAILURE_KEY);
}

/** Whether `track` just failed and is about to be replaced (autoplay must not jump in). */
export function hasPendingFailure(player: Player, track: Track | UnresolvedTrack | null): boolean {
  if (!track?.info) return false;
  const failure = player.getData<FailureRecord | undefined>(FAILURE_KEY);
  return !!failure && failure.key === keyOf(track.info) && Date.now() - failure.at <= FAILURE_TTL_MS;
}

function takeFailure(player: Player, key: string): FailureRecord | undefined {
  const failure = player.getData<FailureRecord | undefined>(FAILURE_KEY);
  if (!failure || failure.key !== key) return undefined;
  player.deleteData(FAILURE_KEY);
  return Date.now() - failure.at <= FAILURE_TTL_MS ? failure : undefined;
}

function isPremature(meta: TrackMeta, played: number): boolean {
  if (meta.isStream || meta.durationMs <= 0) return false;
  return (
    meta.durationMs - played > PREMATURE_MIN_REMAINING_MS &&
    played < meta.durationMs * PREMATURE_MAX_PLAYED_RATIO
  );
}

const nearlyDone = (meta: TrackMeta, played: number): boolean =>
  meta.durationMs > 0 && meta.durationMs - played <= PREMATURE_MIN_REMAINING_MS;

/**
 * Called for every trackEnd / queueEnd. Decides whether the ended track failed
 * (recorded error or stall, or a premature "finished") and starts recovery.
 * Returns true when recovery owns the now-playing message.
 */
export function handleTrackFinished(
  client: Client,
  player: Player,
  track: Track | UnresolvedTrack | null,
  payload: EndPayload,
): boolean {
  try {
    const ended = payload.track;
    if (!ended?.info) return false;
    const key = keyOf(ended.info);
    const reason =
      payload.type === "TrackEndEvent"
        ? payload.reason
        : payload.type === "TrackStuckEvent"
          ? "stuck"
          : "error";
    const failure = takeFailure(player, key);
    const state = getState(player);

    if (state?.phase === "searching" && state.failedKey === key) return true; // duplicate end event
    if (reason === "cleanup") return false;
    // Stops and replacements are user/bot actions — unless lavalink-client's stuck handler did it.
    if ((reason === "replaced" || reason === "stopped") && failure?.kind !== "stuck") return false;

    const meta = metaOf(ended);
    const played = failure?.playedMs ?? playedMs(player, ended);
    let kind: FailureKind | null =
      failure?.kind ??
      (reason === "loadFailed" || reason === "error" ? "error" : reason === "stuck" ? "stuck" : null);
    const startedHere = player.getData<StartInfo | undefined>(START_KEY)?.key === key;
    if (!kind && reason === "finished" && startedHere && isPremature(meta, played)) kind = "premature";

    if (!kind) {
      // Our replacement played to the end: the chain is done.
      if (state?.phase === "playing" && state.currentKey === key) player.deleteData(STATE_KEY);
      return false;
    }
    if (meta.isStream || nearlyDone(meta, played)) {
      logger.info(
        { guildId: player.guildId, kind, title: meta.title, playedMs: Math.round(played), durationMs: meta.durationMs },
        "playback failure at the very end — not recovering",
      );
      return false;
    }

    const requester =
      track?.info && keyOf(track.info) === key ? track.requester : ended.userData?.requester;
    void runFallback(client, player, {
      key,
      kind,
      detail: failure?.detail ?? reason,
      meta,
      requester,
      played,
    });
    return true;
  } catch (err) {
    logger.error({ err, guildId: player.guildId }, "fallback decision failed");
    return false;
  }
}

async function runFallback(client: Client, player: Player, failed: FailedTrack): Promise<void> {
  const prev = getState(player);
  // A replacement failed too: same chain, same attempt budget.
  const chain = prev?.phase === "playing" && prev.currentKey === failed.key ? prev : undefined;
  const resumeAt = failed.played - REWIND_MS >= MIN_RESUME_MS ? failed.played - REWIND_MS : 0;
  const state: FallbackState = chain
    ? {
        ...chain,
        id: ++seq,
        phase: "searching",
        since: Date.now(),
        failedKey: failed.key,
        tried: [...chain.tried, failed.meta.identifier],
        resumeAt: resumeAt || chain.resumeAt,
        currentKey: undefined,
        startPos: undefined,
      }
    : {
        id: ++seq,
        phase: "searching",
        since: Date.now(),
        origin: failed.meta,
        requester: failed.requester,
        tried: [failed.meta.identifier],
        attempts: 0,
        nextSource: 0,
        failedKey: failed.key,
        resumeAt,
      };
  player.setData(STATE_KEY, state); // supersedes any older search

  const log = { guildId: player.guildId, title: state.origin.title, failedSource: failed.meta.sourceName };
  // Structured fallback-hop log — this is how the owner diagnoses breakage (spec §12).
  logger.warn(
    {
      ...log,
      kind: failed.kind,
      detail: failed.detail,
      identifier: failed.meta.identifier,
      playedMs: Math.round(failed.played),
      durationMs: failed.meta.durationMs,
      attempt: state.attempts + 1,
      maxAttempts: MAX_FALLBACK_ATTEMPTS,
    },
    "playback failure — trying fallback",
  );

  try {
    if (state.attempts >= MAX_FALLBACK_ATTEMPTS) {
      await giveUp(client, player, state, "no working source");
      return;
    }

    const sources = fallbackSearchSources(state.origin.sourceName);
    const query = fallbackQuery(state.origin);
    let pick: Track | null = null;
    while (!pick && state.nextSource < sources.length) {
      const source = sources[state.nextSource++];
      const res = await player.search({ query, source }, state.requester).catch((err: unknown) => {
        logger.warn({ ...log, err, source }, "fallback search failed");
        return null;
      });
      const owner = ownership(client, player, state.id);
      if (owner !== "mine") {
        logger.info({ ...log, owner }, "fallback abandoned");
        if (owner === "cancelled") await settleIdle(client, player);
        return;
      }
      const candidates = res?.tracks ?? [];
      pick = pickReplacement(state.origin, candidates, new Set(state.tried));
      logger.info(
        { ...log, source, query, results: candidates.length, picked: pick?.info.title ?? null, pickedFrom: pick?.info.author },
        "fallback search",
      );
    }
    if (!pick) {
      await giveUp(client, player, state, "no matching version found on another source");
      return;
    }

    // lavalink-client has fully handled the failed track's end by now, so the player is:
    //  - idle after queueEnd                      -> current is null
    //  - auto-skipped to the next queued track    -> current is that (interrupted) track
    //  - repeat replayed the broken track         -> current is the failed track: just replace it
    const current = player.queue.current;
    const interrupted = current?.info && keyOf(current.info) !== failed.key ? current : null;
    const position = resumePosition(pick, state);
    state.phase = "playing";
    state.currentKey = keyOf(pick.info);
    state.startPos = position;
    state.attempts += 1;
    state.tried.push(pick.info.identifier);

    // No await in between: play() sets queue.current and add() inserts synchronously,
    // so no Lavalink event can see the queue half-updated. The interrupted track
    // plays right after the replacement instead of being lost.
    const started = player.play({ clientTrack: pick, position, paused: false });
    const requeued = interrupted ? player.queue.add(interrupted, 0) : undefined;
    try {
      await started;
    } catch (err) {
      logger.error({ ...log, err }, "failed to start the replacement");
      player.queue.current = current; // Lavalink still plays the previous track (or nothing)
      await requeued;
      if (interrupted && player.queue.tracks[0] === interrupted) await player.queue.splice(0, 1);
      await giveUp(client, player, state, "the replacement failed to start");
      return;
    }
    await requeued;

    logger.info(
      {
        ...log,
        recoveredVia: pick.info.sourceName,
        replacement: pick.info.title,
        identifier: pick.info.identifier,
        resumeAtMs: position,
        requeued: interrupted?.info.title ?? null,
        attempt: state.attempts,
      },
      "fallback playing replacement",
    );
    await notify(client, player, fallbackEmbed(state.origin, pick, position));
  } finally {
    // Never leave a stale "searching" state behind — it holds back /play.
    const latest = getState(player);
    if (latest?.id === state.id && latest.phase === "searching") player.deleteData(STATE_KEY);
  }
}

function ownership(
  client: Client,
  player: Player,
  id: number,
): "mine" | "cancelled" | "superseded" | "gone" {
  if (client.lavalink.getPlayer(player.guildId) !== player) return "gone";
  const state = getState(player);
  if (!state) return "cancelled";
  return state.id === id ? "mine" : "superseded";
}

/** Resume where the original dropped out, when the replacement is the same length. */
function resumePosition(pick: Track, state: FallbackState): number {
  const { resumeAt, origin } = state;
  const { duration, isSeekable, isStream } = pick.info;
  if (resumeAt <= 0 || !isSeekable || isStream || !(duration > 0) || !(origin.durationMs > 0)) return 0;
  if (Math.abs(duration - origin.durationMs) > RESUME_MAX_DURATION_DELTA_MS) return 0;
  if (resumeAt >= duration - PREMATURE_MIN_REMAINING_MS) return 0;
  return Math.floor(resumeAt);
}

async function giveUp(client: Client, player: Player, state: FallbackState, why: string): Promise<void> {
  if (getState(player)?.id === state.id) player.deleteData(STATE_KEY);
  logger.error(
    { guildId: player.guildId, title: state.origin.title, why, attempts: state.attempts },
    "fallback exhausted — skipping track",
  );
  await notify(
    client,
    player,
    errorEmbed(`Couldn't play **${truncate(state.origin.title, 80)}** — ${why}. Skipping.`),
  );
  await settleIdle(client, player);
}

/** After a failed or cancelled recovery: continue the queue unless lavalink-client already did. */
async function settleIdle(client: Client, player: Player): Promise<void> {
  if (client.lavalink.getPlayer(player.guildId) !== player || player.queue.current) return;
  if (player.queue.tracks.length > 0) {
    await player
      .play({ paused: false })
      .catch((err: unknown) => logger.error({ err, guildId: player.guildId }, "failed to continue the queue"));
    return;
  }
  await clearNowPlaying(client, player);
}
