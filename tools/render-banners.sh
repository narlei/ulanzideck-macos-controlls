#!/bin/sh
# Rasterize resources/*.svg to store PNGs at exact sizes with Chrome headless.
set -e
cd "$(dirname "$0")/.."
node tools/gen-banners.mjs
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1600,800 --screenshot="$PWD/resources/cover.png" "file://$PWD/resources/cover.svg"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=2400,1600 --screenshot="$PWD/resources/banner1.png" "file://$PWD/resources/banner1.svg"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=2400,1600 --screenshot="$PWD/resources/banner2.png" "file://$PWD/resources/banner2.svg"
sips -g pixelWidth -g pixelHeight resources/cover.png resources/banner1.png resources/banner2.png
