# Self-hosting

The app is static, so serving it is just handing out files. Any static host works —
these notes cover a container setup, which is what `compose.yaml` in the repository root
is for.

## Container

`compose.yaml` mounts the repository into the official `nginx:alpine` image read-only.
There is no image build, so updating is `git pull` and nothing else.

```
docker compose up -d
```

Defaults to port 8080; change the left-hand number in `compose.yaml` to move it.

### Why four mounts instead of the repository root

```yaml
./index.html   ./web   ./src   ./data/game
```

Mounting the whole repository would expose things that should not be served:

- `.git` exposes the entire commit history
- `data/state_sample.json`, if present, is **real account state**; only `data/game` is public
- `scripts`, `tests`, and `docs` have no reason to reach a browser

Those four paths are exactly what the app fetches — verified: everything it needs
returns 200, and `.git/config`, `state_sample.json`, `*.py`, and `*.test.mjs` all 404.

## Updating

Regenerate data on a workstation, not the server — the workbook and Python environment
live there and the server has no reason to carry those dependencies.

```
workstation:  edit workbook → python scripts/extract_game.py … → git push
server:       sh deploy/update.sh
```

`deploy/update.sh` pulls, and **does nothing further if only static files changed** —
nginx reads them through the bind mount, so a browser refresh is enough. It recreates the
container only when `compose.yaml` or `deploy/nginx.conf` changed.

Any scheduler can run that script; roughly weekly matches the game's patch cadence.

## Network exposure

If you reach the host over a VPN, this service needs no public exposure at all:

- Restrict the port to your LAN and VPN subnets in the host firewall; default deny
- Do not port-forward it on the router
- Make sure your VPN client's `AllowedIPs` covers the subnet the host is on, or the
  internal address will not resolve while connected
- Give the host a static address or a DHCP reservation

### HTTPS

Not required for this app over a trusted network — `localStorage` works over plain HTTP.

It becomes necessary if you want a **PWA** (home screen install, offline). Service
workers require a secure context. A reverse proxy with a certificate covers that; GitHub
Pages provides it automatically.

## Where user data actually lives

**Browser `localStorage`. Not on the server.**

There is no backend, so:

- A desktop browser and a phone browser hold **separate data**. They do not merge
- Clearing site data or using a private window loses it
- Server backups do not include it

To move between devices: **Export** on one, transfer the file, **Import** on the other.
It is around 20 KB. The same applies for routine backups.

> Automatic cross-device sync would mean a storage adapter. The calculation core is kept
> free of I/O so that stays possible — see [`adr/0001-no-backend.md`](adr/0001-no-backend.md).

## Diagnostics

```
docker logs --tail 50 <container>
```

| Symptom | Check |
|---|---|
| Reachable over VPN but nothing loads | Container logs for 404s — a mount path typo is the usual cause |
| "Failed to load data" | `curl http://<host>:8080/data/game/students.json` |
| Icons missing | `web/icons` was never generated or never pushed |
| Only school and rarity filters | `data/game/tags.json` missing |
| Stale page after update | Hard refresh. Icons are cached 30 days by filename |
| Container restart loop | nginx config syntax — first line of the logs |

To roll back, check out an earlier commit; static files take effect immediately.
