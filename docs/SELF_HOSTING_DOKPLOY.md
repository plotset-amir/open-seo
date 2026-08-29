# Dokploy Self-Hosting

Run OpenSEO on [Dokploy](https://dokploy.com) as a Compose service, behind
Dokploy's Traefik with a real domain and TLS.

`compose.yaml` is not the file to point Dokploy at: it pulls the published image
(so a fork's own code never runs) and binds port 3001 to `127.0.0.1` (so Traefik
cannot reach it). Use `compose.dokploy.yaml`, which builds from the cloned repo
and exposes the port on `dokploy-network` instead.

## Create the service

1. **Project → Create Service → Compose.**
2. **Provider**: your Git repo and branch. Dokploy clones it and builds in place,
   so this is what makes a fork's commits the code that actually runs.
3. **Compose Path**: `compose.dokploy.yaml`.
4. **Compose Type**: `docker-compose`.

## Environment

Dokploy writes the **Environment** tab to a `.env` beside the compose file, which
the service reads through `env_file`. Everything the app needs goes there — not
into the compose file:

```bash
DATAFORSEO_API_KEY=...          # base64 of login:password — see DATAFORSEO_API_KEY.md
ALLOWED_HOST=seo.example.com    # exactly the domain you attach below
AUTH_MODE=hosted
ALLOWED_EMAILS=you@example.com  # who may create an account; unset blocks everyone
BILLING_DISABLED=true           # hosted logins without the Autumn credit ledger
BETTER_AUTH_URL=https://seo.example.com
BETTER_AUTH_SECRET=...          # 32+ chars: openssl rand -base64 48
GOOGLE_CLIENT_ID=...            # redirect URI https://seo.example.com/api/auth/callback/google
GOOGLE_CLIENT_SECRET=...
BYPASS_EMAIL_VERIFICATION=true  # or the three LOOPS_* ids
```

`AUTH_MODE=local_noauth` has no login at all and must not be paired with a public
domain — the container refuses to start in that combination unless you set
`ALLOW_PUBLIC_NOAUTH=true`. See
[`SELF_HOSTING_DOCKER.md`](./SELF_HOSTING_DOCKER.md#serving-it-over-a-hostname).

## Domain

**Domains** tab → service `open-seo`, port `3001`, your host, HTTPS with
Let's Encrypt. Dokploy writes the Traefik labels for you; the compose file
deliberately carries none, so there is one place that owns routing.

`ALLOWED_HOST` must match that host exactly, or vite preview answers every
proxied request with "Blocked request".

## Deploy

**Deploy**, then watch **Logs**. The first start runs a preflight, applies
migrations, and builds the app inside the container — 1-2 minutes before it
serves. Later deploys skip the build when no build-relevant env changed
(`docker-entrypoint.sh` fingerprints them).

Two things that bite on small VPSes:

- **Memory.** The SSR build is ~7400 modules; give the host at least 2 GB of
  usable RAM or the build is OOM-killed mid-deploy.
- **Health.** The image's `HEALTHCHECK` allows a 300s start period to cover that
  build. A container marked unhealthy in the first minutes is usually still
  building — read the logs before redeploying.

Check what a running instance actually enforces:

```bash
curl -s https://seo.example.com/api/health
```

It reports the auth mode and each config check (hosted mode returns a bare
`{"status":"ok"}` and no detail).

## Persistence

The D1 database is the `open_seo_data` named volume at `/app/.wrangler`. It
survives redeploys, and being a named volume it is visible to Dokploy's volume
backups — set one up there. Deleting the service's volumes deletes every
project, audit, and rank-tracking history with it.

## Scheduled rank checks

Rank-tracking schedules do not run in container mode (there is no Workers cron);
trigger checks from the Rank Tracking page.
