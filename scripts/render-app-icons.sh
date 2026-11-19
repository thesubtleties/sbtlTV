#!/usr/bin/env bash
# Renders the app icon SVGs (packages/electron/assets/icon/*.svg) to the PNGs electron-builder and the window use.
# electron-builder makes the .icns (mac) and .ico (Windows) from these PNGs at build time.
# Needs rsvg-convert (librsvg). Run after editing an icon SVG, and commit the PNGs.
set -euo pipefail
cd "$(dirname "$0")/../packages/electron/assets/icon"
rsvg-convert -w 1024 -h 1024 icon-mac.svg -o icon-mac.png   # mac.icon
rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png           # win.icon (and the .ico sizes)
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png          # linux.icon, the window icon
ls -la *.png
