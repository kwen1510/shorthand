#!/bin/zsh
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

DEFAULT_PORT=4174
PORT=""

open_app_url() {
  local url="$1"

  if /usr/bin/open -Ra "Google Chrome" >/dev/null 2>&1; then
    /usr/bin/open -a "Google Chrome" "$url"
    return
  fi

  if /usr/bin/open -Ra "Microsoft Edge" >/dev/null 2>&1; then
    /usr/bin/open -a "Microsoft Edge" "$url"
    return
  fi

  /usr/bin/open "$url"
}

is_shorthand_running() {
  local url="http://127.0.0.1:$DEFAULT_PORT"
  /usr/bin/curl -fsS --max-time 1 "$url" 2>/dev/null | /usr/bin/grep -q "Shorthand"
}

if is_shorthand_running; then
  echo "Shorthand is already running."
  echo "Opening http://127.0.0.1:$DEFAULT_PORT"
  open_app_url "http://127.0.0.1:$DEFAULT_PORT"
  exit 0
fi

for candidate in {4174..4194}; do
  if ! /usr/sbin/lsof -nP -iTCP:"$candidate" -sTCP:LISTEN >/dev/null 2>&1; then
    PORT="$candidate"
    break
  fi
done

if [[ -z "$PORT" ]]; then
  echo "No local port was available between 4174 and 4194."
  echo "Close another local server and try again."
  read "?Press Return to close this window."
  exit 1
fi

URL="http://127.0.0.1:$PORT"

echo "Starting Shorthand from:"
echo "$APP_DIR"
echo
echo "Opening $URL"
echo "Keep this Terminal window open while using the app."
echo "Press Control-C here to stop the app."
echo

(sleep 1 && open_app_url "$URL") &
exec /usr/bin/env python3 serve.py --port "$PORT"
