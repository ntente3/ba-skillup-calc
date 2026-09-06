#!/bin/sh
# Pull the latest version on the NAS.
#
# nginx reads the files straight through a bind mount, so a restart is usually
# unnecessary: git pull alone takes effect. The container is only recreated
# when deploy/nginx.conf or compose.yaml has changed.
set -e
cd "$(dirname "$0")/.."

before=$(git rev-parse HEAD)
git pull --ff-only
after=$(git rev-parse HEAD)

if [ "$before" = "$after" ]; then
  echo "Already up to date ($after)"
  exit 0
fi

echo "Updated: $before -> $after"
git --no-pager log --oneline "$before..$after" | sed 's/^/    /'

if git diff --name-only "$before" "$after" | grep -qE '^(compose\.yaml|deploy/nginx\.conf)$'; then
  echo "Configuration changed; recreating the container."
  docker compose up -d --force-recreate 2>/dev/null || docker-compose up -d --force-recreate
else
  echo "Static files only; no restart needed - just reload the page."
fi
