# Queuebo

Queuebo is a self-hosted Discord music bot that plays from YouTube and Spotify (including
playlists) with a paginated queue, full playback controls, and automatic source fallback when
YouTube is unavailable. Designed to run on a single always-on home machine — no paid APIs, no
Premium accounts, and no ads.

**Stack:** Lavalink v4 (Java audio node) · discord.js v14 · lavalink-client · TypeScript on Node.js 22.
The architecture and design rationale are summarised in [Architecture](#architecture) below.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running](#running)
- [Commands](#commands)
- [Source fallback](#source-fallback)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)

## Features

- Playback from YouTube and Spotify URLs (track, album, playlist, artist) or a plain search query
- Playlist support — bulk-add every track from a YouTube or Spotify playlist or album
- Paginated queue showing requester, durations, and total time remaining
- Full navigation: skip, previous, seek, jump, pause/resume, shuffle, loop, volume, remove, clear
- Interactive controls under the now-playing message (previous, pause, skip, stop, shuffle, loop)
- Automatic source fallback — if YouTube is blocked or rate-limited, tracks play from SoundCloud with no user action
- Autoplay / radio — queues related tracks automatically when the queue empties
- Lyrics for the current track via LavaLyrics and LRCLIB
- Per-server settings (default volume, autoplay) persisted in a local SQLite database
- Ad-free — Lavalink fetches the raw audio stream directly rather than playing through the YouTube player

## Architecture

Three local processes on one machine, communicating over `localhost`:

```
Discord  <->  Node bot (discord.js)  <->  Lavalink.jar (Java, :2333)  <->  YouTube / Spotify / SoundCloud
```

1. JDK 21 runs `Lavalink.jar` (the audio node on port 2333); it downloads its own plugins on first boot.
2. Node 22 runs this bot, which connects to Lavalink at `localhost:2333` and to Discord.
3. Optionally, a Docker `yt-cipher` container as a YouTube reliability upgrade.

Running on a residential (home) IP is intentional: YouTube rate-limits datacenter IPs
(403/429), so a home connection avoids that bot-flagging without a paid proxy.

## Requirements

| Component | Install (Windows) |
|---|---|
| JDK 21 (Temurin) | `winget install EclipseAdoptium.Temurin.21.JDK` |
| Node.js 22+ | `winget install OpenJS.NodeJS.LTS` |
| NSSM (for the 24/7 service) | `winget install NSSM.NSSM` |
| Docker Desktop (optional) | only for the yt-cipher upgrade |

## Installation

**1. Create the Discord application**

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Under Bot, reset and copy the token (`DISCORD_TOKEN`).
3. Under General Information, copy the Application ID (`CLIENT_ID`).
4. Invite the bot (OAuth2) with scopes `bot` and `applications.commands`, and permissions
   View Channels, Connect, Speak, Send Messages, and Embed Links.

No privileged gateway intents are required; the bot is slash-command only.

**2. Obtain Spotify credentials** (required to resolve Spotify links)

Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
and copy the Client ID and Client Secret.

**3. Install dependencies and configure**

```powershell
npm install
Copy-Item .env.example .env     # then fill in the values
```

**4. Set up Lavalink**

```powershell
./scripts/get-lavalink.ps1
Copy-Item lavalink/application.example.yml lavalink/application.yml
```

See [`lavalink/README.md`](lavalink/README.md) for details and optional reliability upgrades.

**5. Register the slash commands**

Set `DEV_GUILD_ID` in `.env` to your server's ID for instant registration, then:

```powershell
npm run deploy
```

Without `DEV_GUILD_ID`, commands register globally and may take up to an hour to appear.

## Configuration

All configuration lives in `.env` (copied from `.env.example`). Required variables are
validated on startup; the bot exits with a clear message if any are missing.

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Bot token from the Developer Portal |
| `CLIENT_ID` | Yes | Application (client) ID |
| `DEV_GUILD_ID` | No | Server ID for instant slash-command registration |
| `OWNER_ID` | No | Your Discord user ID |
| `LAVALINK_HOST` / `LAVALINK_PORT` | Yes | Lavalink address (default `localhost:2333`) |
| `LAVALINK_PASSWORD` | Yes | Must match `lavalink/application.yml` |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Yes | Spotify API credentials |
| `DEFAULT_VOLUME` | No | Initial volume for new players (0–100, default 80) |
| `DEFAULT_SEARCH_PLATFORM` | No | `ytmsearch` (default), `ytsearch`, or `scsearch` |
| `IDLE_TIMEOUT_MS` | No | Idle timeout before auto-leaving (default 5 minutes) |
| `AUTO_LEAVE_ON_EMPTY` | No | Leave when the channel is empty (default `true`) |
| `YT_*` / `DEEZER_*` | No | Optional reliability upgrades; blank disables them |

## Running

**Development** (two terminals, with auto-reload):

```powershell
# Terminal 1 - Lavalink
cd lavalink ; java -Xmx1g -jar Lavalink.jar
# Terminal 2 - bot
npm run dev
```

**Production (Windows services via NSSM)** — run from an elevated PowerShell:

```powershell
./scripts/install-services.ps1
```

This registers two services, `Lavalink` and `DiscordMusicBot`, that start automatically on
boot (before login), restart on failure, and run headless. Manage them with:

```powershell
nssm restart Lavalink ; nssm restart DiscordMusicBot
nssm status  DiscordMusicBot
./scripts/uninstall-services.ps1     # remove the services
```

## Commands

| Command | Description |
|---|---|
| `/play <query>` | Play a YouTube/Spotify URL (incl. playlist or album), or search a query (shows a top-5 picker) |
| `/queue` | Paginated queue (10 per page) |
| `/nowplaying` | Now playing — progress bar, source, loop, volume |
| `/skip [count]` | Skip the current track (or several) |
| `/previous` | Play the previous track from history |
| `/seek <time>` | Seek to `mm:ss` or a number of seconds |
| `/jump <position>` | Jump to a queue position (tracks in between are removed) |
| `/pause`, `/resume` | Pause or resume playback |
| `/stop` | Stop playback and clear the queue |
| `/shuffle` | Shuffle the queue |
| `/loop <off\|track\|queue>` | Set the repeat mode |
| `/volume <0-100>` | Set the volume (saved per server) |
| `/remove <position>` | Remove one track from the queue |
| `/clear` | Clear the queue (current track keeps playing) |
| `/disconnect` | Disconnect the bot and clear state |
| `/autoplay <on\|off>` | Toggle radio mode when the queue empties |
| `/lyrics` | Show lyrics for the current track |

The now-playing message includes a control panel (previous, pause, skip, stop, shuffle, loop)
that only responds to users in the same voice channel.

## Source fallback

Resilience is layered so a single broken source never stops playback:

1. youtube-source clients — the plugin cycles through multiple YouTube clients in order.
2. LavaSrc provider chain — Spotify and mirrored tracks try each source in turn, ending with
   SoundCloud (`scsearch:`, no authentication), which survives a complete YouTube outage.
3. Bot-level retry — on `trackError` or `trackStuck` the bot re-resolves the same track via a
   different source (up to two attempts) and logs every fallback hop for diagnostics.

To verify: set `plugins.youtube.enabled: false` in `lavalink/application.yml`, restart
Lavalink, and confirm playback continues from SoundCloud (the source switch appears in the log).

## Troubleshooting

| Symptom | Resolution |
|---|---|
| Slash commands don't appear | Run `npm run deploy`; set `DEV_GUILD_ID` for instant registration |
| "I'm already in another voice channel" | The bot is playing elsewhere — use `/disconnect` or join it |
| YouTube fails (403/429) | Enable OAuth or yt-cipher ([`lavalink/README.md`](lavalink/README.md)); SoundCloud fallback works meanwhile |
| Spotify link finds no audio | Verify `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` |
| `/lyrics` returns nothing | Ensure `lavalyrics-plugin` is installed in `application.yml` |
| Lavalink crashes on startup | Check indentation — `plugins:` is a root key, not under `lavalink:` |

Logs are written to `lavalink/logs/` and `logs/` (or the `npm run dev` output).

## Project structure

```
src/
  index.ts            Client + Lavalink bootstrap, login
  config.ts           Typed .env loading and validation
  deploy-commands.ts  Slash-command registration
  lavalink/           Manager, events (Layer-3 fallback), autoplay
  events/             ready, interactionCreate (router), voiceStateUpdate
  commands/           18 slash commands
  ui/                 Embeds and now-playing controls
  lib/                Formatting, pagination, resolution, guards, loaders
  db/                 Per-server settings (better-sqlite3)
```
