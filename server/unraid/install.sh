#!/bin/bash
# The board as an Unraid app: build the image here, write the Docker tab's template
# and create the container the way its Apply does. Run as root from a checkout (or a copy of server/):
#   bash server/unraid/install.sh [--staging] [--new] [tag]
# --new starts an empty board when the data folder holds no database yet.
# A tag ending -<commit> (0.8.16-dev-86b0d444) or ASKERDO_COMMIT names the server tree's commit, which /health reports.
# ASKERDO_PORT, ASKERDO_DATA_DIR, ASKERDO_BACKUP_DIR and ASKERDO_TZ set the app's values;
# unset, a rerun keeps what the app's template holds, else the defaults below.
set -euo pipefail
cd "$(dirname "$0")/../.."

STAGING=0; NEW=0
while [ $# -gt 0 ]; do
  case "$1" in
    --staging) STAGING=1; shift ;;
    --new) NEW=1; shift ;;
    *) break ;;
  esac
done
TAG="${1:-$(date +%Y%m%d-%H%M%S)}"
if [ "$STAGING" = 1 ]; then
  NAME=AskerDo-staging; SLUG=askerdo-staging; DEF_PORT=17481; IMAGE="askerdo-board:staging-$TAG"
else
  NAME=AskerDo; SLUG=askerdo; DEF_PORT=17480; IMAGE="askerdo-board:$TAG"
fi
IP="$(ip route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
TPL="/boot/config/plugins/dockerMan/templates-user/my-$NAME.xml"

# a value set in the Docker tab survives the rerun that is an upgrade
saved() { [ -f "$TPL" ] && sed -n "s#.*Target=\"$1\"[^>]*>\([^<]*\)</Config>.*#\1#p" "$TPL" | head -n 1 || true; }
PORT="${ASKERDO_PORT:-$(saved 17480)}"; PORT="${PORT:-$DEF_PORT}"
DATA="${ASKERDO_DATA_DIR:-$(saved /data)}"; DATA="${DATA:-/mnt/cache/appdata/$SLUG}"
BACKUPS="${ASKERDO_BACKUP_DIR:-$(saved /backups)}"; BACKUPS="${BACKUPS:-/mnt/user/backups/$SLUG}"
TZONE="${ASKERDO_TZ:-$(saved TZ)}"; TZONE="${TZONE:-UTC}"

# the database sits on the pool path; a mistyped folder would start an empty board, so only --new makes one
if [ ! -f "$DATA/askerdo.db" ]; then
  [ "$NEW" = 1 ] || { echo "no $DATA/askerdo.db: place the board's database there, or pass --new for an empty board" >&2; exit 1; }
  mkdir -p "$DATA" && chown 99:100 "$DATA"
fi
mkdir -p "$BACKUPS" && chown 99:100 "$BACKUPS"

# the server tree's commit rides the image for /health: ASKERDO_COMMIT, else a tag ending -<sha>;
# with neither, a build.json left by an earlier run goes, so the board never names a commit it is not
COMMIT="${ASKERDO_COMMIT:-$(printf '%s' "$TAG" | sed -n 's/.*-\([0-9a-f]\{7,40\}\)$/\1/p')}"
if [ -n "$COMMIT" ]; then
  printf '%s' "$COMMIT" | grep -qx '[0-9a-f]\{7,40\}' || { echo "ASKERDO_COMMIT $COMMIT is not a commit hash" >&2; exit 1; }
  printf '{\n  "commit": "%s"\n}\n' "$COMMIT" > server/build.json
else
  rm -f server/build.json
fi

docker build -f server/Dockerfile -t "$IMAGE" .
# root runs this, so server/ goes back to its folder's owner and a later copy over it still writes
chown -R --reference=. server

sed -e "s#@NAME@#$NAME#g" -e "s#@IMAGE@#$IMAGE#g" -e "s#@PORT@#$PORT#g" -e "s#@DATA@#$DATA#g" \
  -e "s#@BACKUPS@#$BACKUPS#g" -e "s#@TZ@#$TZONE#g" -e "s#@ICON@#http://$IP:$PORT/web/icon.png#g" \
  server/unraid/askerdo.xml > "$TPL"
# the Docker tab draws the cached icon, so it shows before the board first answers
cp server/web/assets/icon.png "/var/lib/docker/unraid/images/$NAME-icon.png"
rm -f "/usr/local/emhttp/state/plugins/dynamix.docker.manager/images/$NAME-icon.png"

# the command Apply would run, from Unraid's own template reader, so the labels match its apps
CMD="$(php server/unraid/command.php "$TPL")"
if docker container inspect "$NAME" >/dev/null 2>&1; then
  docker stop -t 10 "$NAME" >/dev/null 2>&1 || true
  docker rm "$NAME" >/dev/null
fi
eval "$CMD"
docker start "$NAME" >/dev/null

# the real board starts with the array, as an app with autostart on does
if [ "$STAGING" = 0 ]; then
  AUTO=/var/lib/docker/unraid-autostart
  grep -qx "$NAME\( .*\)\?" "$AUTO" 2>/dev/null || echo "$NAME" >> "$AUTO"
fi

echo "$NAME runs $IMAGE on port $PORT${COMMIT:+, server commit $COMMIT}"
