#!/bin/bash
# Upload all images in ./puzzles to the Railway deployment.
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

PUZZLES_DIR="./puzzles"
SUCCESS=0
FAIL=0

for file in "$PUZZLES_DIR"/*; do
  [ -f "$file" ] || continue
  filename=$(basename "$file")
  ext="${filename##*.}"
  ext_lower=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
  case "$ext_lower" in jpg|jpeg|png|gif|webp|svg) ;;
    *) continue ;;
  esac

  echo -n "Uploading $filename ... "
  encoded=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$filename")
  response=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT "$RAILWAY_URL/admin/puzzles/$encoded" \
    -H "x-upload-secret: $UPLOAD_SECRET" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@$file")

  if [ "$response" = "200" ]; then
    echo "OK"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "FAILED (HTTP $response)"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "Done: $SUCCESS uploaded, $FAIL failed."
