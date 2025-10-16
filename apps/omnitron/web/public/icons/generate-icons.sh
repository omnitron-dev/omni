#!/bin/bash

# Check if ImageMagick (convert) is available
if ! command -v convert &> /dev/null; then
    echo "ImageMagick not found. Skipping PNG generation."
    echo "Install with: brew install imagemagick"
    exit 0
fi

SIZES=(72 96 128 144 152 192 384 512)

for size in "${SIZES[@]}"; do
    convert icon.svg -resize ${size}x${size} icon-${size}x${size}.png
    echo "Generated icon-${size}x${size}.png"
done

echo "All icons generated successfully!"
