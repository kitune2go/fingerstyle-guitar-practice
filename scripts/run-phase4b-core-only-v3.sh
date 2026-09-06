#!/usr/bin/env bash
set -euo pipefail

START_HEAD="7f2c39e327b056f4236e3470fc2b7aa6d3dc1f9a"
TARGET_BRANCH="feat/measurement-semantics-calibration"
EXPECTED_SUBJECT="Define Phase 4B calibration data boundaries"

set +e
bash _phase4b_core_helper/scripts/apply-phase4b-core-only-v2.sh
status=$?
set -e

# v2 intentionally validates and commits only after syntax/unit/diff/E2E are green.
# Its only remaining failure is the workflow helper checkout appearing as an
# untracked directory in git status. Never bypass any earlier validation error.
if [[ $status -eq 0 ]]; then
  exit 0
fi

if [[ "$(git log -1 --format=%s)" != "$EXPECTED_SUBJECT" ]]; then
  echo "validation failed before the expected atomic commit" >&2
  exit "$status"
fi

if [[ "$(git rev-parse HEAD^)" != "$START_HEAD" ]]; then
  echo "unexpected parent for validated Phase 4B core commit" >&2
  exit 1
fi

rm -rf _phase4b_core_helper _helper

if [[ -n "$(git status --porcelain)" ]]; then
  echo "working tree has changes other than the validation helper" >&2
  git status --short
  exit 1
fi

git diff --check "$START_HEAD"...HEAD
git push origin "HEAD:$TARGET_BRANCH"
