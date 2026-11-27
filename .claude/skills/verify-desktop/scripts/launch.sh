#!/bin/bash
# Launches the dev desktop build next to the user's own Folio, without
# touching it: its own user-data-dir (settings, window state, recent
# folders), its own HOME (so marks go to <scratch>/home/.folio, not
# ~/.folio), and a CDP port to drive it from puppeteer.
#
# Usage: launch.sh <scratch-dir> [workspace] [port]
#   <scratch-dir>  where its data goes; created if missing
#   [workspace]    the folder to open (default: the repo's workspace/)
#   [port]         CDP port (default 9333)
# Build first (`npm run build` in desktop/). Prints the PID; the app's
# output goes to <scratch-dir>/electron.log.

set -euo pipefail
scratch=${1:?usage: launch.sh <scratch-dir> [workspace] [port]}
repo=$(cd "$(dirname "$0")/../../../.." && pwd)
workspace=${2:-$repo/workspace}
port=${3:-9333}
desktop=$repo/desktop

[ -d "$desktop/node_modules" ] || { echo "No node_modules in $desktop: run \`npm ci\` in frontend/ and desktop/ first." >&2; exit 1; }
[ -f "$desktop/dist/desktop/src/main.js" ] || { echo "No build in $desktop/dist: run \`npm run build\` in desktop/ first." >&2; exit 1; }
workspace=$(cd "$workspace" && pwd)

mkdir -p "$scratch/data" "$scratch/home" "$scratch/shots"
scratch=$(cd "$scratch" && pwd)
# Start from the given workspace every time; the rest of the settings keep
# their defaults
printf '{\n  "workspace": "%s",\n  "theme": "light"\n}\n' "$workspace" > "$scratch/data/settings.json"

unset ELECTRON_RUN_AS_NODE
cd "$desktop"
# bash as the agent command: the agent panel opens a shell, not a real
# Claude Code session
HOME="$scratch/home" FOLIO_AGENT_COMMAND=bash \
  nohup ./node_modules/.bin/electron . --user-data-dir="$scratch/data" --remote-debugging-port="$port" \
  > "$scratch/electron.log" 2>&1 &
pid=$!

for _ in $(seq 1 60); do
  curl -fs "http://127.0.0.1:$port/json/version" > /dev/null 2>&1 && { echo "$pid"; exit 0; }
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.5
done
echo "Electron didn't open CDP on port $port; see $scratch/electron.log" >&2
kill "$pid" 2>/dev/null || true
exit 1
