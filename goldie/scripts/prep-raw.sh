#!/bin/bash
# Crop the Android system nav bar off each raw capture and stage it where
# `goldie frame` expects it.
#
# The Pixel 8 emulator is 1080x2400; the light 3-button nav bar occupies the
# bottom ~135 px and clashes badly with Helix's dark UI in a marketing tile.
# Cropping it here (rather than capturing in immersive mode) keeps the original
# captures in goldie/captures/ intact.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$DIR/captures"
DST="$DIR/out/raw/iphone-6.9"
mkdir -p "$DST"
for f in "$SRC"/*.png; do
  n=$(basename "$f")
  ffmpeg -y -loglevel error -i "$f" -vf "crop=1080:2265:0:0" "$DST/$n"
  echo "  prep $n"
done
/usr/bin/python3 "$DIR/scripts/write-manifest.py"
