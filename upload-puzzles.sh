#!/bin/bash
# Sync ./puzzles and ./daily_puzzles to the Railway deployment: deletes any
# remote file that no longer exists locally, then uploads everything local.
# Usage: ./upload-puzzles.sh
#
# Required env vars (or edit defaults below):
#   RAILWAY_URL   — e.g. https://your-app.up.railway.app
#   UPLOAD_SECRET — must match the UPLOAD_SECRET set in Railway environment variables

RAILWAY_URL="${RAILWAY_URL:-}"
UPLOAD_SECRET="${UPLOAD_SECRET:-}"

if [ -z "$RAILWAY_URL" ] || [ -z "$UPLOAD_SECRET" ]; then
  echo "Set RAILWAY_URL and UPLOAD_SECRET before running:"
  echo "  RAILWAY_URL=https://your-app.up.railway.app UPLOAD_SECRET=yourSecret ./upload-puzzles.sh"
  exit 1
fi

TOTAL_DELETE=0
TOTAL_SKIP=0
TOTAL_SUCCESS=0
TOTAL_FAIL=0

# Deletes remote files under $2 (admin endpoint path) that aren't present in
# $1 (local dir), then uploads every image in $1 to $2.
sync_dir() {
  local dir="$1"
  local admin_path="$2"

  if [ ! -d "$dir" ]; then
    echo "Skipping $dir (not found)"
    return
  fi

  echo "Fetching remote list from $RAILWAY_URL/$admin_path ..."
  remote_json=$(curl -sf -H "x-upload-secret: $UPLOAD_SECRET" "$RAILWAY_URL/$admin_path")
  if [ $? -ne 0 ]; then
    echo "Failed to fetch remote list from $admin_path."
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
  else
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
  fi

  echo "Uploading $dir/ -> $admin_path ..."
  for file in "$dir"/*; do
    [ -f "$file" ] || continue
    filename=$(basename "$file")
    ext="${filename##*.}"
    ext_lower=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
    case "$ext_lower" in jpg|jpeg|png|gif|webp|svg) ;;
      *) continue ;;
    esac

    echo -n "  $filename ... "
    encoded=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$filename")
    response=$(curl -s -o /dev/null -w "%{http_code}" \
      -X PUT "$RAILWAY_URL/$admin_path/$encoded" \
      -H "x-upload-secret: $UPLOAD_SECRET" \
      -H "Content-Type: application/octet-stream" \
      --data-binary "@$file")

    if [ "$response" = "200" ]; then
      echo "OK"
      TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
    else
      echo "FAILED (HTTP $response)"
      TOTAL_FAIL=$((TOTAL_FAIL + 1))
    fi
  done
  echo ""
}

sync_dir "./puzzles" "admin/puzzles"
sync_dir "./daily_puzzles" "admin/daily-puzzles"

echo "Done: $TOTAL_DELETE deleted, $TOTAL_SKIP kept, $TOTAL_SUCCESS uploaded, $TOTAL_FAIL failed."
