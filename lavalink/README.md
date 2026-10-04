# Lavalink — audio node (Windows)

Lavalink is the Java service that actually fetches and streams the audio. The bot
talks to it over `localhost:2333`. The YouTube/Spotify/SoundCloud logic lives here
(in the plugins), so this is the most important part to get right.

## 1. Install JDK 21

```powershell
winget install EclipseAdoptium.Temurin.21.JDK
java -version   # should report 21.x
```

## 2. Get Lavalink.jar

From the repo root:

```powershell
./scripts/get-lavalink.ps1            # latest v4
# or pin a version: ./scripts/get-lavalink.ps1 -Version 4.2.2
```

This drops `Lavalink.jar` into this folder. Lavalink downloads its **plugins**
(youtube-source, LavaSrc, LavaSearch, LavaLyrics) automatically on first boot — you
do not download those manually.

## 3. Configure

```powershell
Copy-Item application.example.yml application.yml
```

The config reads secrets from environment variables (`${LAVALINK_PASSWORD}`,
`${SPOTIFY_CLIENT_ID}`, `${SPOTIFY_CLIENT_SECRET}`). When run as the NSSM service,
those are injected from the project `.env`. For a quick manual test you can also
put literal values in `application.yml` temporarily.

## 4. Run (manual test)

```powershell
$env:LAVALINK_PASSWORD="yourpassword"
$env:SPOTIFY_CLIENT_ID="..."
$env:SPOTIFY_CLIENT_SECRET="..."
java -Xmx1g -jar Lavalink.jar
```

Confirm in the log:
- `Found plugin 'youtube-plugin' ...`, `lavasrc-plugin`, `lavasearch-plugin`, `lavalyrics-plugin`
- A line like `YouTube source initialised with clients: MUSIC, WEB, ...`
- If you see `Failed to resolve <CLIENT> into a Client`, fix the `clients:` list in
  `application.yml` against the [youtube-source clients list](https://github.com/lavalink-devs/youtube-source#available-clients).

Press `Ctrl+C` to stop. For 24/7 operation, install it as a service instead — see
`scripts/install-services.ps1` in the repo root.

## 5. YouTube: remote cipher + OAuth (required since mid-2026)

YouTube now answers most clients with "Sign in to confirm you're not a bot" / "requires
login" or SABR-only formats, and the plugin no longer deciphers YouTube's player scripts
itself. What works: the `TV` client with OAuth plus a remote cipher server — both are
enabled in `application.example.yml`, and `scripts/install-services.ps1` sets them up:

- **Remote cipher (yt-cipher):** installed by `scripts/get-yt-cipher.ps1` and run as the
  `YtCipher` service on `127.0.0.1:8001`. Its password (`YT_CIPHER_PASSWORD`) is generated
  into `.env.local`. (Docker alternative: `docker compose up -d yt-cipher`.)
- **OAuth (burner Google account):** without `YT_OAUTH_REFRESH_TOKEN`, Lavalink logs a URL
  and code; the install script shows them, waits until you sign in at the URL with a
  **throwaway** Google account (never your main one), then saves the logged refresh token
  to `.env.local` and restarts Lavalink. For a new login, delete that line and re-run.

## 6. Updating plugins

When YouTube/Spotify change and playback breaks (typical symptoms: tracks stop a few
seconds in, or fail to load at all), bump the plugin version in `application.yml`
(a one-line edit) and restart Lavalink:

```powershell
nssm restart Lavalink
```

Lavalink downloads the new jar on start and deletes the old version. The bot logs
the versions the server actually runs (`lavalink node connected` → `plugins`).

If a fix is merged upstream but not released yet, pin a **snapshot** build: the
version is the full commit hash from the plugin's `main` branch, served from the
snapshot repository:

```yaml
- dependency: "dev.lavalink.youtube:youtube-plugin:<full 40-character commit hash>"
  repository: "https://maven.lavalink.dev/snapshots"
  snapshot: true
```

`application.yml` is not tracked by git. `scripts/install-services.ps1` copies
`application.example.yml` over it on every run (keeping a `.bak-*` copy), so after
`git pull` just re-run that script — or copy plugin changes by hand.
