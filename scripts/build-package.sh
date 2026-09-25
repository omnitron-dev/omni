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
# — unless `declarationDir` is set, in which case tsc writes them THERE, the
# swap below throws that directory away, and the package ships with no types.
# The comment here once said this was «checked per package before this script
# was adopted». It was not true for `packages/testing`, whose tsconfig said
# `declarationDir: ./dist`: every clean clone built it with 0 `.d.ts`, and a
# developer's checkout hid it with declarations left over from a build before
# this script (measured 2026-09-25, a daos release refused because paysys
# could not resolve `@omnitron-dev/testing/async`). So it is checked, here.
if npx tsc "${args[@]}" --showConfig | grep -q '"declarationDir"'; then
  echo "build-package: $pkg sets declarationDir — its declarations would land outside dist.next and be thrown away by the swap. Remove it (they follow --outDir)." >&2
  exit 1
fi
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
