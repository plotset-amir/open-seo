# Docker Self-Hosting

Run OpenSEO locally with Docker.

In Docker mode, OpenSEO defaults to `AUTH_MODE=local_noauth` (no auth checks, local admin user `admin@localhost`). Only expose it behind your own auth-protected reverse proxy, tunnel, or private network — or set a real auth mode in `.env` (see [Serving it over a hostname](#serving-it-over-a-hostname)).

The default `compose.yaml` uses the published GHCR image:

- `ghcr.io/every-app/open-seo:latest`

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose)
- A DataForSEO API key (see [`DATAFORSEO_API_KEY.md`](./DATAFORSEO_API_KEY.md))

## Quickstart

```bash
cp .env.example .env
```

Set `DATAFORSEO_API_KEY` in `.env` using the [DataForSEO setup guide](./DATAFORSEO_API_KEY.md), then start OpenSEO:

```bash
docker compose up -d
```

Open `http://localhost:<PORT>` (default `3001`). The first start builds the app and may take 1-2 minutes; follow progress with `docker compose logs -f`.

Optional env values:

- `PORT` (defaults to `3001`)
- `ALLOWED_HOST` (single reverse-proxy hostname to allow in Vite preview)
- `AUTH_MODE` (defaults to `local_noauth`; set `hosted` or `cloudflare_access` in `.env` to run with real logins)
- `OPEN_SEO_IMAGE` (defaults to `ghcr.io/every-app/open-seo:latest`)
- `OPENROUTER_API_KEY` (required for AI features such as SAM; see [OpenRouter](https://openrouter.ai/settings/keys))

If you are putting Docker behind a reverse proxy or a temporary tunnel, remember that Docker self-hosting runs with app auth disabled. Only expose it behind your own auth-protected reverse proxy, tunnel, or private network, and add the public hostname before restarting:

```bash
ALLOWED_HOST=yourdomain.com docker compose up -d
```

You can also persist it in `.env`.

### Running your own build

`compose.yaml` pins the published image, so a fork's own commits never reach the
container — a local patch or an instance-specific auth gate silently does
nothing while upstream's build serves. Layer the build override to run what is
actually checked out:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

It builds `Dockerfile.selfhost` from this directory and tags it `open-seo:local`,
so `docker images` never leaves it ambiguous which build a container came from.
Re-run the same command after every `git pull` on your fork.

### Serving it over a hostname

`local_noauth` has no login: every visitor is resolved as the same admin user,
with your projects and your instance-wide DataForSEO balance. Because
`ALLOWED_HOST` is what makes the app answer to anything but localhost, the boot
preflight refuses to start `local_noauth` once that host is set. Pick one:

- **Give it real logins** — `AUTH_MODE=hosted` (email/password + Google, with
  `ALLOWED_EMAILS` deciding who may register; see the hosted block in
  `.env.example`) or `AUTH_MODE=cloudflare_access` (see
  [`SELF_HOSTING_CLOUDFLARE.md`](./SELF_HOSTING_CLOUDFLARE.md)).
- **Say the hostname is private** — `ALLOW_PUBLIC_NOAUTH=true`, for a LAN or
  Tailscale name, or a proxy that already authenticates in front of OpenSEO.

Confirm what a running instance is actually enforcing with
`curl http://localhost:3001/api/health` — it reports `authMode` and the same
checks the preflight ran.

## Telemetry

OpenSEO collects anonymized telemetry for core usage events: heartbeats with aggregate counts (installs, users, projects, feature usage) tied to a random install ID, sent every 5 minutes during the first two hours after install, then at most once daily. Telemetry also includes failed setup check names and statuses, never values or error messages. No URLs, keywords, prompts, emails, or IP-derived location are collected, and idle installs send nothing.

To disable it, set `OPENSEO_TELEMETRY_DISABLED=1` (or `DO_NOT_TRACK=1`) in `.env`, then run `docker compose up -d --force-recreate open-seo`.

## Pin to a specific image tag

Set `OPEN_SEO_IMAGE` in `.env` and restart:

```bash
OPEN_SEO_IMAGE=ghcr.io/every-app/open-seo:v1.2.3
docker compose up -d
```

## Build your own image locally

If you are testing local code changes, build and run a local tag:

```bash
docker build -f Dockerfile.selfhost -t open-seo:local .
OPEN_SEO_IMAGE=open-seo:local docker compose up -d
```

## Common commands

- Restart service after env changes:

```bash
docker compose up -d open-seo
```

- Pull latest published image and restart:

```bash
docker compose pull && docker compose up -d
```

- Stop:

```bash
docker compose down
```

## Health and troubleshooting

Startup checks appear in `docker compose logs` before the build. Once running, `/api/health` reports configuration and database status, and `docker compose ps` reports container health.

## Troubleshooting environment variables

To confirm Docker Compose is using the expected environment variables:

```bash
docker compose config
```

Check that `AUTH_MODE` is the mode you intended, and that `DATAFORSEO_API_KEY` is the base64
encoded value of your DataForSEO email and API password in this format:
`email:password`.

If you changed `.env`, recreate the container so Compose reapplies it:

```bash
docker compose up -d --force-recreate open-seo
```
