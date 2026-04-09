#!/bin/bash
# Delete puzzles from the Railway deployment that no longer exist locally.
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

PUZZLES_DIR="./puzzles"
DELETE=0
SKIP=0
FAIL=0

echo "Fetching remote puzzle list from $RAILWAY_URL/api/puzzles ..."
remote_json=$(curl -sf "$RAILWAY_URL/api/puzzles")
if [ $? -ne 0 ]; then
  echo "Failed to fetch remote puzzle list."
  exit 1
fi

# Extract filenames from paths like "puzzles/1.jpg"
remote_files=$(echo "$remote_json" | python3 -c "
import json, sys
puzzles = json.load(sys.stdin)
for p in puzzles:
    print(p.split('/')[-1])
")

echo ""
while IFS= read -r filename; do
  [ -z "$filename" ] && continue
  local_path="$PUZZLES_DIR/$filename"
  if [ -f "$local_path" ]; then
    SKIP=$((SKIP + 1))
    continue
  fi

  echo -n "Deleting $filename (not in local puzzles/) ... "
  encoded=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$filename")
  response=$(curl -s -o /dev/null -w "%{http_code}" \
    -X DELETE "$RAILWAY_URL/admin/puzzles/$encoded" \
    -H "x-upload-secret: $UPLOAD_SECRET")

  if [ "$response" = "200" ]; then
    echo "OK"
    DELETE=$((DELETE + 1))
  else
    echo "FAILED (HTTP $response)"
    FAIL=$((FAIL + 1))
  fi
done <<< "$remote_files"

echo ""
echo "Done: $DELETE deleted, $SKIP kept (exist locally), $FAIL failed."
