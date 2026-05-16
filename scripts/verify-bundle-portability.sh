#!/usr/bin/env bash
# Bundle portability gate (C12).
#
# Walks every `.omnitron-build` directory under the trees that omnitron
# produces, scans the bundled .js for absolute developer paths, and
# fails with a non-zero exit code if any are found.
#
# Run from CI after `pnpm build` — bundles must be environment-independent
# before they ship.
#
# Usage:
#   ./scripts/verify-bundle-portability.sh [PATH ...]
#
# When no PATH is given, scans the standard locations:
#   apps/*/.omnitron-build, packages/*/.omnitron-build,
#   and the developer's project tree at /Users/taaliman/projects.
#
# Exit codes:
#   0 — clean
#   1 — at least one bundle leaks a dev path

set -euo pipefail

# Patterns that are NEVER acceptable in a production bundle. Using
# anchored quoted character classes so we don't false-positive on
# substrings like "/Users-Manual.md" or comments referencing /home in
# documentation strings — bundles tend to have these only in require
# arguments.
PATTERNS=(
  '"/Users/[^"]*"'
  "'/Users/[^']*'"
  '"/home/[^"]*"'
  "'/home/[^']*'"
  '"[A-Za-z]:\\\\[^"]*"'
)

ROOTS=()
if [[ $# -gt 0 ]]; then
  ROOTS=("$@")
else
  for d in apps/*/.omnitron-build packages/*/.omnitron-build; do
    [[ -d "$d" ]] && ROOTS+=("$d")
  done
fi

if [[ ${#ROOTS[@]} -eq 0 ]]; then
  echo "verify-bundle-portability: no .omnitron-build directories found — skipping"
  exit 0
fi

bad=0
for root in "${ROOTS[@]}"; do
  while IFS= read -r -d '' file; do
    for pat in "${PATTERNS[@]}"; do
      # `grep -E` for ERE; -l prints filename only; we redirect stderr
      # so missing-file errors don't leak.
      if grep -E -l "$pat" "$file" >/dev/null 2>&1; then
        echo "FAIL $file: contains pattern $pat"
        grep -E -n -m 3 "$pat" "$file" | head -3 | sed 's/^/    /'
        bad=$((bad + 1))
      fi
    done
  done < <(find "$root" -type f -name '*.js' -print0)
done

if [[ $bad -gt 0 ]]; then
  echo
  echo "verify-bundle-portability: $bad bundle file(s) leak developer paths"
  exit 1
fi

echo "verify-bundle-portability: all clean"
exit 0
