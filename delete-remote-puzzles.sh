#!/bin/bash
# Delete puzzles from the Railway deployment that no longer exist locally,
# for both ./puzzles and ./daily_puzzles.
# Usage: ./delete-remote-puzzles.sh
#
# Required env vars (or edit defaults below):
#   RAILWAY_URL   — e.g. https://your-app.up.railway.app
#   UPLOAD_SECRET — must match the UPLOAD_SECRET set in Railway environment variables

RAILWAY_URL="${RAILWAY_URL:-}"
UPLOAD_SECRET="${UPLOAD_SECRET:-}"

if [ -z "$RAILWAY_URL" ] || [ -z "$UPLOAD_SECRET" ]; then
  echo "Set RAILWAY_URL and UPLOAD_SECRET before running:"
  echo "  RAILWAY_URL=https://your-app.up.railway.app UPLOAD_SECRET=yourSecret ./delete-remote-puzzles.sh"
  exit 1
fi

TOTAL_DELETE=0
TOTAL_SKIP=0
TOTAL_FAIL=0

# Deletes remote files under $2 (admin endpoint path, e.g. admin/puzzles)
# that aren't present in $1 (local dir).
delete_missing() {
  local dir="$1"
  local admin_path="$2"

  echo "Fetching remote list from $RAILWAY_URL/$admin_path ..."
  remote_json=$(curl -sf -H "x-upload-secret: $UPLOAD_SECRET" "$RAILWAY_URL/$admin_path")
  if [ $? -ne 0 ]; then
    echo "Failed to fetch remote list from $admin_path."
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    return
  fi

  # Extract filenames from paths like "puzzles/1.jpg" or "daily_puzzles/d001.jpeg"
  remote_files=$(echo "$remote_json" | python3 -c "
import json, sys
puzzles = json.load(sys.stdin)
for p in puzzles:
    print(p.split('/')[-1])
")

  while IFS= read -r filename; do
    [ -z "$filename" ] && continue
    local_path="$dir/$filename"
    if [ -f "$local_path" ]; then
      TOTAL_SKIP=$((TOTAL_SKIP + 1))
      continue
    fi

    echo -n "Deleting $filename (not in local $dir/) ... "
    encoded=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$filename")
    response=$(curl -s -o /dev/null -w "%{http_code}" \
      -X DELETE "$RAILWAY_URL/$admin_path/$encoded" \
      -H "x-upload-secret: $UPLOAD_SECRET")

    if [ "$response" = "200" ]; then
      echo "OK"
      TOTAL_DELETE=$((TOTAL_DELETE + 1))
    else
      echo "FAILED (HTTP $response)"
      TOTAL_FAIL=$((TOTAL_FAIL + 1))
    fi
  done <<< "$remote_files"
  echo ""
}

delete_missing "./puzzles" "admin/puzzles"
delete_missing "./daily_puzzles" "admin/daily-puzzles"

echo "Done: $TOTAL_DELETE deleted, $TOTAL_SKIP kept (exist locally), $TOTAL_FAIL failed."
