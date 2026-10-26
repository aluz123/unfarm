#!/bin/sh
# Bundle the current public lists into the extension and zip it for release.
set -e
cd "$(dirname "$0")/.."
mkdir -p extension/data dist
cp data/fingerprints.json data/farms.json extension/data/
rm -f dist/unfarm-extension.zip
(cd extension && zip -qr ../dist/unfarm-extension.zip . -x '.*')
echo "dist/unfarm-extension.zip ($(du -h dist/unfarm-extension.zip | cut -f1))"
