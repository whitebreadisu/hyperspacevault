#!/usr/bin/env bash
# BL-256: the promote-prod CI gate. The promoted SHA's own main-push check
# runs for the required jobs must all be green before prod moves. Branch
# protection only proves the PR's checks passed; this proves the merged
# commit's run did (SWU_Platform_Spec.md 2.1 / 2.6).
#
# Required checks: backend, frontend, frontend-e2e-mobile, journeys (BL-279
# WS-3 W3-17), build-and-push (BL-271 Phase E: a docs-only or spec-only SHA
# has no image and is refused here) and deploy-dev (BL-279 WS-3 W3-17: the
# SHA was deployed to dev before it is promoted).
#
# Waits up to CI_GATE_TIMEOUT_SECONDS (default 1800) for in-progress runs, and
# for a required check that has no run yet while the SHA's main `CI` workflow
# run is still in progress (a job still waiting on `needs` has no check run).
# Fails on any non-success conclusion, on a check that is absent once the CI
# run has completed, and when no CI run exists (a docs-only commit has no main
# run -- promote the last code commit instead).
#
# Usage: ci_gate.sh <full-sha>   (needs gh + GH_TOKEN with checks:read and actions:read)
set -euo pipefail

sha="${1:?usage: ci_gate.sh <sha>}"
repo="${GITHUB_REPOSITORY:-whitebreadisu/hyperspacevault}"
# BL-271 Phase E: build-and-push joins the set -- a docs-only SHA (skipped build, no image) is refused
# here with a readable message instead of at `terraform apply` (the pre-E failure mode).
required=(backend frontend frontend-e2e-mobile journeys build-and-push deploy-dev)
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
    echo "::error::CI gate: required check(s) not green for ${sha}: ${failed[*]} -- a 'skipped' build-and-push means a docs-only commit with no image; promote the last code commit instead"
    exit 1
  fi
  if [ "${#missing[@]}" -gt 0 ]; then
    # A job still waiting on `needs` has no check run yet: while the SHA's
    # main CI run is in progress, a missing name is pending, not absent.
    ci_status=$(gh api "repos/${repo}/actions/runs?head_sha=${sha}&event=push&per_page=100"       --jq '[.workflow_runs[] | select(.name == "CI")] | sort_by(.id) | last | .status // "none"')
    if [ "$ci_status" = "completed" ] || [ "$ci_status" = "none" ]; then
      echo "::error::CI gate: no main CI run named [${missing[*]}] for ${sha} -- only a commit that ran the main pipeline (a code change) can be promoted; a docs-only commit has no image either."
      exit 1
    fi
    pending+=("${missing[@]}")
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
