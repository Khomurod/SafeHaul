#!/bin/bash
# Installs the dependencies tests, lint and the build need when a Claude Code
# cloud session starts, so no session begins with checks that cannot run.
#
# Cloud only: on a developer's own machine the dependencies are already there.
# Every other agent follows the install row in AGENTS.md §4 instead.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Install one tree only when its manifest, its lockfile or this script changed
# since the install last succeeded. The hook runs at every start, resume, clear
# and compact, and holds the first message until it ends.
install_tree() {
  local dir="$1"
  local hashes="$dir/node_modules/.session-start.sha256"
  if sha256sum --check --status "$hashes" 2>/dev/null; then
    return 0
  fi
  # Delete the old hashes first, so a failed install runs again next time.
  rm -f "$hashes"
  # `npm ci`, not `npm install`: it never rewrites the lockfile, so the working
  # tree stays clean.
  (cd "$dir" && npm ci --no-audit --no-fund)
  sha256sum .claude/hooks/session-start.sh "$dir/package.json" "$dir/package-lock.json" > "$hashes" \
    || rm -f "$hashes"
}

install_tree .
install_tree functions
