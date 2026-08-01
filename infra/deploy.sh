#!/bin/bash
# Deploy the ballhead bot to its prod host.
#
#   ./deploy.sh --host user@1.2.3.4 [--key ~/key.pem] [--ref main] [--dir /home/ec2-user/ballhead_bot] [--app ballhead_bot]
#
# The host runs a git checkout of this repo, so a deploy is a fetch, a
# production install, and a pm2 restart. Idempotent: re-running is the normal
# update path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR/.."
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

HOST=""
KEY=""
REMOTE_DIR="/home/ec2-user/ballhead_bot"
REF="main"
APP="ballhead_bot"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2;;
    --key) KEY="$2"; shift 2;;
    --dir) REMOTE_DIR="$2"; shift 2;;
    --ref) REF="$2"; shift 2;;
    --app) APP="$2"; shift 2;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

if [[ -z "$HOST" ]]; then
  echo "Error: --host is required (e.g. --host ec2-user@1.2.3.4)" >&2
  exit 1
fi

SSH_OPTS=()
[[ -n "$KEY" ]] && SSH_OPTS=(-i "$KEY")

# ssh flattens its command arguments back into a single remote shell string, so
# anything reaching the far side has to be safe as bare shell. These are
# operator-supplied, not hostile, but a ref with a space silently deploys the
# wrong thing, which is worth catching regardless.
if [[ ! "$REF" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo -e "${RED}Refusing --ref with unexpected characters: $REF${NC}" >&2; exit 1
fi
if [[ ! "$REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || [[ "$REMOTE_DIR" == *".."* ]]; then
  echo -e "${RED}Refusing --dir: $REMOTE_DIR${NC}" >&2; exit 1
fi
if [[ ! "$APP" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo -e "${RED}Refusing --app with unexpected characters: $APP${NC}" >&2; exit 1
fi

# Resolve the exact commit up front. The tests below run against the working
# tree, so the working tree has to be the thing that ships -- otherwise a green
# test run says nothing about the commit the host ends up on.
git -C "$REPO_DIR" fetch -q origin "$REF" || {
  echo -e "${RED}origin/$REF does not exist. Push it first.${NC}" >&2; exit 1
}
TARGET_SHA="$(git -C "$REPO_DIR" rev-parse --verify FETCH_HEAD^{commit})"

if [[ -n "$(git -C "$REPO_DIR" status --porcelain)" ]]; then
  echo -e "${RED}Working tree is dirty. Commit or stash first: the tests would${NC}" >&2
  echo -e "${RED}cover code the host is never going to run.${NC}" >&2
  exit 1
fi
if [[ "$(git -C "$REPO_DIR" rev-parse HEAD)" != "$TARGET_SHA" ]]; then
  echo -e "${RED}HEAD is not origin/$REF ($TARGET_SHA). Check out and push $REF first.${NC}" >&2
  exit 1
fi

echo -e "${YELLOW}Running tests...${NC}"
(cd "$REPO_DIR" && npm test >/dev/null)

echo -e "${YELLOW}Deploying $REF ($TARGET_SHA) to $HOST ...${NC}"
ssh "${SSH_OPTS[@]}" "$HOST" bash -s -- "$REMOTE_DIR" "$REF" "$TARGET_SHA" "$APP" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"
REF="$2"
TARGET_SHA="$3"
APP="$4"

# pm2 and node may live under nvm, which a non-interactive ssh shell does not
# load.
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$REMOTE_DIR"
git fetch --prune origin
# Pin the exact commit the tests ran against, not whatever origin/$REF points at
# by the time the host gets here.
git checkout -B "$REF" "$TARGET_SHA"
git reset --hard "$TARGET_SHA"

npm ci --omit=dev

# No ecosystem config in this repo: the pm2 process is managed by name, started
# once by hand as `pm2 start index.js --name <app>`.
pm2 restart "$APP" --update-env
pm2 save
sleep 3
pm2 describe "$APP" | grep -q 'status.*online'
REMOTE

echo -e "${GREEN}[ok] Bot deployed. Logs: ssh $HOST 'pm2 logs $APP'${NC}"
