# Deploying Agora to Fly.io

This deploys the **marketplace** (registry + public catalog) to Fly.io. Sellers
self-host their own provider services and register them with the deployed
registry. Buyers run the MCP locally and point it at the deployed registry.

## What gets deployed

| Service | App name | Public URL after deploy | What it does |
|---|---|---|---|
| `registry/` | `agora-registry` | `https://agora-registry.fly.dev` | Catalog + signed-write API + transaction ledger + peer review |
| `web/` | `agora-web` | `https://agora-web.fly.dev` | Public read-only browser catalog |

What stays local: `mcp/`, `dashboard/`, `buyer/`, sellers (`provider/`,
`agents/*`).

## Prerequisites

- `flyctl` installed and authenticated: `fly auth login`
- A funded Fly.io account ($0–5/mo at hackathon traffic levels)
- This repo cloned locally

## File layout

The Dockerfiles and Fly configs live at the **repo root**, not inside
`registry/` or `web/`. They need the whole monorepo as the Docker build
context (the npm workspaces depend on each other), and Fly always uses the
fly.toml's directory as the build context.

```
Dockerfile.registry   # multi-stage build for registry/
Dockerfile.web        # multi-stage build for web/
fly.registry.toml     # registry app config
fly.web.toml          # web app config
.dockerignore         # shared — keeps node_modules, .next, *.db, .env* out
```

All deploy commands run from the repo root and pass `-c fly.<app>.toml`.

## One-time setup

### 1. Create the registry app and its persistent volume

```bash
# from the repo root
fly apps create agora-registry --org personal

# 1 GB volume in the primary region for SQLite. Single volume, single region.
fly volumes create agora_registry_data --region fra --size 1 --yes -a agora-registry

# Required — admin endpoints fail secure (503) if ADMIN_SECRET is unset.
fly secrets set ADMIN_SECRET="$(openssl rand -hex 32)" -a agora-registry --stage

# Signing secret for cross-service signed requests (review escrow, slashing).
fly secrets set AGORA_REGISTRY_SECRET="$(openssl rand -hex 32)" -a agora-registry --stage
```

### 2. Deploy the registry

```bash
# --ha=false enforces a single machine. SQLite + multi-machine = corruption.
# --remote-only builds in Fly's depot (no local Docker needed).
fly deploy -c fly.registry.toml --ha=false --remote-only -a agora-registry
```

First deploy takes ~3–5 min (Docker build + image push + machine boot).
Migrations apply automatically on first boot — watch `fly logs -a agora-registry`
if you want to see them.

Verify:

```bash
curl https://agora-registry.fly.dev/api/v1/health
# → {"ok":true,"service":"agora-registry","db":"ok",...}
```

### 3. Create the web app

```bash
# still from the repo root
fly apps create agora-web --org personal

# Point web at the deployed registry.
fly secrets set AGORA_REGISTRY_URL="https://agora-registry.fly.dev" -a agora-web --stage

fly deploy -c fly.web.toml --remote-only -a agora-web
```

Web is stateless — safe to scale horizontally if you ever need to. First
deploy ~2–3 min.

Verify in a browser: <https://agora-web.fly.dev>

---

## Custom domain (optional)

Once the `*.fly.dev` URLs are working, point your own domain at them.

```bash
# Registry — say api.youragora.com
fly certs create -a agora-registry api.youragora.com

# Web — say youragora.com
fly certs create -a agora-web youragora.com
```

Add the DNS records Fly tells you to add (an A/AAAA record + CNAME for cert
validation). After DNS propagates and the cert validates, update the web
secret to point at the custom registry domain:

```bash
fly secrets set -a agora-web AGORA_REGISTRY_URL="https://api.youragora.com"
```

Web auto-redeploys on secret change.

---

## Pointing local services at the deployed marketplace

Self-hosted **sellers** — set in `provider/.env.local` (or whichever seller
service):

```
AGORA_REGISTRY_URL=https://agora-registry.fly.dev
```

The seller will self-register with the deployed registry on first
heartbeat.

Local **MCP** (in `~/.claude/mcp_servers.json` or wherever you wire it):

```json
{
  "env": {
    "AGORA_REGISTRY_URL": "https://agora-registry.fly.dev"
  }
}
```

The MCP discovers services from the deployed registry and pays sellers
directly via Lightning (no payments touch the marketplace).

---

## Operational notes

### Backups

The registry's SQLite DB lives at `/data/registry.db` on the Fly volume.
Snapshot before risky changes:

```bash
fly ssh console -a agora-registry
# inside the container:
sqlite3 /data/registry.db ".backup /data/registry.backup-$(date +%Y%m%d).db"
exit

# pull the backup down
fly ssh sftp shell -a agora-registry
get /data/registry.backup-YYYYMMDD.db
```

Fly volumes have daily snapshots out of the box (7-day retention by
default). Configure with `fly volumes update`.

### Rotating the admin secret

```bash
fly secrets set -a agora-registry ADMIN_SECRET="$(openssl rand -hex 32)"
# auto-redeploys; previously-issued admin secrets stop working immediately
```

### Logs

```bash
fly logs -a agora-registry
fly logs -a agora-web
```

### Scaling caveat

The registry **must stay at exactly one machine** because of SQLite. The web
can be scaled freely. To increase resources for the registry instead of
adding instances:

```bash
fly scale vm shared-cpu-2x --memory 1024 -a agora-registry
```

If you outgrow single-instance SQLite, the migration path is **Turso**
(SQLite-compatible, distributed, drop-in via libsql) or **Postgres** (rewrite
better-sqlite3 calls and migrations to a Postgres driver).

### Cost expectations

At hackathon traffic levels (≤ 1,000 req/day):
- Registry (1× shared-cpu-1x, 512MB, 1GB volume): ~$2/mo
- Web (1× shared-cpu-1x, 256MB, no volume): ~$0–2/mo (auto-stops on idle)

Fly's free allowance covers most of this if you stay under thresholds.

---

## Troubleshooting

**`fly deploy` fails on `npm ci`** — probably a stale `package-lock.json`.
Run `npm install` locally to regenerate, commit, redeploy.

**Registry boots but `/api/v1/health` returns `db: down`** — the volume
isn't mounted or the container can't write to `/data`. Check:
`fly ssh console -a agora-registry`, then `ls -la /data`. Should show the
volume mounted with `node` user owning it. The Dockerfile chowns `/data`
to `node:node` at image build — if that doesn't take, check the Fly volume's
permissions.

**Admin endpoints return 503** — `ADMIN_SECRET` env var isn't set or is
shorter than 16 chars. `fly secrets set` it again.

**Web returns 500 on every page** — `AGORA_REGISTRY_URL` isn't set on
the web app, or it's pointing at a registry that's down. Confirm with:
`fly secrets list -a agora-web` and `curl <registry>/api/v1/health`.

**Build fails inside Docker on `better-sqlite3`** — the prebuild fetcher
couldn't reach its CDN. The Dockerfile installs `python3 make g++` as a
fallback so npm can compile from source. If that also fails, check Docker
network connectivity from the build machine.
