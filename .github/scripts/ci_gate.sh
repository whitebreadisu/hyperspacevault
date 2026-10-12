#!/usr/bin/env bash
# BL-256: the promote-prod CI gate. The promoted SHA's own main-push check
# runs for the required jobs must all be green before prod moves. Branch
# protection only proves the PR's checks passed; this proves the merged
# commit's run did (the mobile e2e job finishes after deploy-dev, see
# SWU_Platform_Spec.md 2.1 / 2.6). Waits for in-progress runs up to
# CI_GATE_TIMEOUT_SECONDS (default 1800), fails on any non-success
# conclusion or on a missing run (a docs-only commit has no main run and
# no image -- promote the last code commit instead).
#
# Usage: ci_gate.sh <full-sha>   (needs gh + GH_TOKEN with checks:read)
set -euo pipefail

sha="${1:?usage: ci_gate.sh <sha>}"
repo="${GITHUB_REPOSITORY:-whitebreadisu/hyperspacevault}"
required=(backend frontend frontend-e2e-mobile)
deadline=$(( $(date +%s) + ${CI_GATE_TIMEOUT_SECONDS:-1800} ))

while :; do
  # newest run per name wins (a re-run supersedes its predecessor)
  runs=$(gh api "repos/${repo}/commits/${sha}/check-runs?per_page=100" \
    --jq '.check_runs | sort_by(.id) | .[] | [.name, .status, (.conclusion // "")] | @tsv')
  pending=(); failed=(); missing=()
  for name in "${required[@]}"; do
    line=$(printf '%s\n' "$runs" | awk -F'\t' -v n="$name" '$1 == n' | tail -n 1)
    if [ -z "$line" ]; then missing+=("$name"); continue; fi
    status=$(printf '%s' "$line" | cut -f2)
    conclusion=$(printf '%s' "$line" | cut -f3)
    if [ "$status" != "completed" ]; then
      pending+=("$name")
    elif [ "$conclusion" != "success" ]; then
      failed+=("${name}=${conclusion}")
    fi
  done
  if [ "${#failed[@]}" -gt 0 ]; then
    echo "::error::CI gate: required check(s) not green for ${sha}: ${failed[*]}"
    exit 1
  fi
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "::error::CI gate: no main CI run named [${missing[*]}] for ${sha} -- only a commit that ran the main pipeline (a code change) can be promoted; a docs-only commit has no image either."
    exit 1
  fi
  if [ "${#pending[@]}" -eq 0 ]; then
    echo "CI gate: ${required[*]} all green for ${sha}"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "::error::CI gate: timed out waiting for ${pending[*]} on ${sha}"
    exit 1
  fi
  echo "CI gate: waiting for ${pending[*]} ..."
  sleep 30
done
