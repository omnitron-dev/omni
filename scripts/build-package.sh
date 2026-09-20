#!/usr/bin/env bash
#
# Build a package without taking its `dist` away first.
#
# Every package script was `rm -rf dist && tsc`, which leaves the package
# WITHOUT A BUILD for as long as the compile takes — minutes, for titan. The
# daos stand runs out of these directories: a worker that restarts inside that
# window cannot resolve the module, and what it reports is a missing import
# rather than "somebody is building".
#
# Compile into a sibling, then swap. The window where `dist` does not exist is
# the gap between two renames on the same filesystem.
#
#   scripts/build-package.sh [tsc args…]
#
# Run from the package directory. Defaults to `-p ./tsconfig.json`.
set -euo pipefail

pkg="$(basename "$PWD")"
args=("$@")
if [ ${#args[@]} -eq 0 ]; then
  args=(-p ./tsconfig.json)
fi

rm -rf dist.next dist.old node_modules/.tmp

# `--outDir` overrides whatever the tsconfig says, and declarations follow it
# unless `declarationDir` is set explicitly — checked per package before this
# script was adopted.
npx tsc "${args[@]}" --outDir dist.next

if [ ! -d dist.next ]; then
  echo "build-package: $pkg produced no dist.next — refusing to swap" >&2
  exit 1
fi

if [ -d dist ]; then
  mv dist dist.old
fi
mv dist.next dist
rm -rf dist.old

echo "build-package: $pkg built and swapped"
