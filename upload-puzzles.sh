#!/bin/bash
# Upload all images in ./puzzles and ./daily_puzzles to the Railway deployment.
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

TOTAL_SUCCESS=0
TOTAL_FAIL=0

# Uploads every image in $1 (local dir) to $2 (admin endpoint path, e.g. admin/puzzles)
upload_dir() {
  local dir="$1"
  local admin_path="$2"

  if [ ! -d "$dir" ]; then
    echo "Skipping $dir (not found)"
    return
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

upload_dir "./puzzles" "admin/puzzles"
upload_dir "./daily_puzzles" "admin/daily-puzzles"

echo "Done: $TOTAL_SUCCESS uploaded, $TOTAL_FAIL failed."
