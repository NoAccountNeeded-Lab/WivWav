#!/usr/bin/env bash
# sdlc-report.sh — Generate a concise SDLC delivery metrics report.
#
# Queries the GitHub API via the gh CLI to measure:
#   - CI duration (recent workflow runs on main)
#   - Failed-check causes (recent failed CI runs)
#   - PR lead time  (opened → merged)
#   - Review cycle count (number of review-requested events per PR)
#   - Time-to-merge (last review → merged)
#
# Prerequisites:
#   - GitHub CLI installed and authenticated: gh auth status
#   - Repo read access
#
# Usage:
#   bash scripts/sdlc-report.sh [--lookback-days N]
#
# Options:
#   --lookback-days N   How many days of history to analyse (default: 30)
# Environment variables:
#   LOOKBACK_DAYS=N     Equivalent to --lookback-days N

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
LOOKBACK_DAYS="${LOOKBACK_DAYS:-30}"

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --lookback-days)
      LOOKBACK_DAYS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--lookback-days N]" >&2
      exit 1
      ;;
  esac
done

# ── Repo detection ────────────────────────────────────────────────────────────
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
if [[ -z "$REPO" ]]; then
  echo "❌  Could not detect repo. Run this from inside the cloned repository." >&2
  exit 1
fi

# Compute the "since" timestamp — try GNU date first, fall back to BSD date
SINCE=$(date -u --date="${LOOKBACK_DAYS} days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -v-"${LOOKBACK_DAYS}"d +%Y-%m-%dT%H:%M:%SZ)

REPORT_DATE=$(date -u +%Y-%m-%d)

echo "📊  WivWav SDLC Metrics — ${REPO}"
echo "    Report date : ${REPORT_DATE}"
echo "    Period      : last ${LOOKBACK_DAYS} days (since ${SINCE})"
echo ""

# ── Helper: seconds between two ISO-8601 timestamps ──────────────────────────
seconds_between() {
  local start="$1" end="$2"
  local t_start t_end
  t_start=$(date -u -d "$start" +%s 2>/dev/null \
    || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$start" +%s)
  t_end=$(date -u -d "$end" +%s 2>/dev/null \
    || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$end" +%s)
  echo $(( t_end - t_start ))
}

pretty_duration() {
  local secs="$1"
  if [[ $secs -ge 3600 ]]; then
    printf "%dh %dm" $(( secs / 3600 )) $(( (secs % 3600) / 60 ))
  elif [[ $secs -ge 60 ]]; then
    printf "%dm %ds" $(( secs / 60 )) $(( secs % 60 ))
  else
    printf "%ds" "$secs"
  fi
}

failed_job_summary() {
  local run_id="$1"
  local details
  details=$(gh run view "$run_id" \
    --repo "$REPO" \
    --json jobs \
    --jq '
      [
        .jobs[]
        | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out")
        | .name as $job
        | ([
            .steps[]?
            | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out")
            | .name
          ] | if length > 0 then join(", ") else "job conclusion: \(.conclusion)" end) as $steps
        | "\($job): \($steps)"
      ]
      | if length > 0 then join("; ") else "failed job details unavailable" end
    ' 2>/dev/null || echo "failed job details unavailable")

  if [[ -z "$details" || "$details" == "null" ]]; then
    echo "failed job details unavailable"
  else
    echo "$details"
  fi
}

# ── 1. CI duration (CI workflow, main branch) ─────────────────────────────────
echo "## 1. CI Duration  (workflow: CI, branch: main)"

CI_RUNS=$(gh run list \
  --repo "$REPO" \
  --workflow ci.yml \
  --branch main \
  --limit 100 \
  --json databaseId,conclusion,createdAt,updatedAt,status,displayTitle \
  2>/dev/null || echo "[]")

COMPLETED_RUNS=$(echo "$CI_RUNS" | jq --arg since "$SINCE" \
  '[.[] | select(.createdAt >= $since and .status == "completed")]')
TOTAL_COMPLETED=$(echo "$COMPLETED_RUNS" | jq 'length')

if [[ "$TOTAL_COMPLETED" -eq 0 ]]; then
  echo "  No completed CI runs found on main in the last ${LOOKBACK_DAYS} days."
else
  PASSED=$(echo "$COMPLETED_RUNS" | jq '[.[] | select(.conclusion == "success")] | length')
  FAILED=$(echo "$COMPLETED_RUNS" | jq '[.[] | select(.conclusion == "failure")] | length')

  AVG_SECS=0
  DURATION_COUNT=0
  while IFS= read -r run; do
    created=$(echo "$run" | jq -r '.createdAt')
    updated=$(echo "$run" | jq -r '.updatedAt')
    if [[ "$created" != "null" && "$updated" != "null" ]]; then
      dur=$(seconds_between "$created" "$updated")
      AVG_SECS=$(( AVG_SECS + dur ))
      DURATION_COUNT=$(( DURATION_COUNT + 1 ))
    fi
  done < <(echo "$COMPLETED_RUNS" | jq -c '.[] | select(.conclusion == "success")')

  echo "  Runs sampled    : $TOTAL_COMPLETED  (passed: $PASSED, failed: $FAILED)"

  if [[ $DURATION_COUNT -gt 0 ]]; then
    AVG_SECS=$(( AVG_SECS / DURATION_COUNT ))
    echo "  Avg CI duration : $(pretty_duration $AVG_SECS)  (passing runs)"
    if [[ $AVG_SECS -ge 1200 ]]; then
      echo "  ⚠️  THRESHOLD: avg CI ≥ 20 min — investigate build/test optimisation"
    fi
  fi

  if [[ $TOTAL_COMPLETED -gt 0 ]]; then
    FAIL_PCT=$(( FAILED * 100 / TOTAL_COMPLETED ))
    echo "  CI failure rate : ${FAIL_PCT}%"
    if [[ $FAIL_PCT -ge 20 ]]; then
      echo "  ⚠️  THRESHOLD: failure rate ≥ 20% — investigate flaky tests or infra"
    fi
  fi
fi
echo ""

# ── 2. Failed-check causes ────────────────────────────────────────────────────
echo "## 2. Failed-Check Causes  (last 10 failed CI runs in period, any branch)"

FAILED_RUNS=$(gh run list \
  --repo "$REPO" \
  --workflow ci.yml \
  --limit 100 \
  --json databaseId,conclusion,displayTitle,headBranch,createdAt \
  2>/dev/null | jq --arg since "$SINCE" \
    '[.[] | select(.createdAt >= $since and .conclusion == "failure")] | .[0:10]')

FAIL_COUNT=$(echo "$FAILED_RUNS" | jq 'length')
if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo "  No failed CI runs found in the last ${LOOKBACK_DAYS} days. ✅"
else
  echo "  ${FAIL_COUNT} failed run(s):"
  while IFS= read -r run; do
    run_id=$(echo "$run" | jq -r '.databaseId')
    created=$(echo "$run" | jq -r '.createdAt[:10]')
    branch=$(echo "$run" | jq -r '.headBranch')
    title=$(echo "$run" | jq -r '.displayTitle')
    cause=$(failed_job_summary "$run_id")
    echo "  - [${created}] branch=${branch}  ${title}"
    echo "    cause: ${cause}"
  done < <(echo "$FAILED_RUNS" | jq -c '.[]')
fi
echo ""

# ── 3. PR lead time (opened → merged) ────────────────────────────────────────
echo "## 3. PR Lead Time  (opened → merged)"

MERGED_PRS=$(gh pr list \
  --repo "$REPO" \
  --state merged \
  --limit 100 \
  --json number,title,createdAt,mergedAt \
  2>/dev/null || echo "[]")

MERGED_IN_PERIOD=$(echo "$MERGED_PRS" | jq \
  --arg since "$SINCE" \
  '[.[] | select(.mergedAt != null and .mergedAt >= $since)]')

PR_COUNT=$(echo "$MERGED_IN_PERIOD" | jq 'length')

if [[ "$PR_COUNT" -eq 0 ]]; then
  echo "  No merged PRs in the last ${LOOKBACK_DAYS} days."
else
  TOTAL_LEAD=0
  LEAD_COUNT=0
  MIN_LEAD=99999999
  MAX_LEAD=0
  while IFS= read -r pr; do
    created=$(echo "$pr" | jq -r '.createdAt')
    merged=$(echo "$pr" | jq -r '.mergedAt')
    if [[ "$created" != "null" && "$merged" != "null" ]]; then
      dur=$(seconds_between "$created" "$merged")
      TOTAL_LEAD=$(( TOTAL_LEAD + dur ))
      LEAD_COUNT=$(( LEAD_COUNT + 1 ))
      [[ $dur -lt $MIN_LEAD ]] && MIN_LEAD=$dur
      [[ $dur -gt $MAX_LEAD ]] && MAX_LEAD=$dur
    fi
  done < <(echo "$MERGED_IN_PERIOD" | jq -c '.[]')

  echo "  PRs merged     : $PR_COUNT"
  if [[ $LEAD_COUNT -gt 0 ]]; then
    AVG_LEAD=$(( TOTAL_LEAD / LEAD_COUNT ))
    echo "  Avg lead time  : $(pretty_duration $AVG_LEAD)"
    echo "  Min lead time  : $(pretty_duration $MIN_LEAD)"
    echo "  Max lead time  : $(pretty_duration $MAX_LEAD)"
    if [[ $AVG_LEAD -ge 172800 ]]; then
      echo "  ⚠️  THRESHOLD: avg lead time ≥ 2 days — identify review or merge bottlenecks"
    fi
  fi
fi
echo ""

# ── 4. Review cycle count ─────────────────────────────────────────────────────
echo "## 4. Review Cycle Count  (re-review requests per merged PR)"

REVIEW_CYCLES_TOTAL=0
REVIEW_CYCLES_COUNT=0

while IFS= read -r pr_num; do
  # Count "review_requested" timeline events — each beyond the first is a re-request
  EVENTS=$(gh api "repos/${REPO}/issues/${pr_num}/timeline" \
    --paginate \
    --jq '[.[] | select(.event == "review_requested")] | length' \
    2>/dev/null || echo "0")
  REREQUESTS=$(( EVENTS > 1 ? EVENTS - 1 : 0 ))
  REVIEW_CYCLES_TOTAL=$(( REVIEW_CYCLES_TOTAL + REREQUESTS ))
  REVIEW_CYCLES_COUNT=$(( REVIEW_CYCLES_COUNT + 1 ))
done < <(echo "$MERGED_IN_PERIOD" | jq -r '.[].number')

if [[ $REVIEW_CYCLES_COUNT -gt 0 ]]; then
  echo "  PRs analysed   : $REVIEW_CYCLES_COUNT"
  if command -v bc &>/dev/null; then
    AVG_CYCLES=$(echo "scale=1; $REVIEW_CYCLES_TOTAL / $REVIEW_CYCLES_COUNT" | bc)
  else
    AVG_CYCLES=$(( REVIEW_CYCLES_TOTAL * 10 / REVIEW_CYCLES_COUNT ))
    AVG_CYCLES="${AVG_CYCLES%?}.${AVG_CYCLES: -1}"
  fi
  echo "  Avg re-review cycles : ${AVG_CYCLES}"
  # Compare integer part against threshold
  AVG_INT=$(( REVIEW_CYCLES_TOTAL * 10 / REVIEW_CYCLES_COUNT ))
  if [[ $AVG_INT -ge 20 ]]; then
    echo "  ⚠️  THRESHOLD: avg re-review cycles ≥ 2 — tighten pre-review quality gates"
  fi
else
  echo "  No merged PRs to analyse."
fi
echo ""

# ── 5. Time-to-merge (last review → merged) ──────────────────────────────────
echo "## 5. Time-to-Merge  (last review approval → merged)"

TTM_TOTAL=0
TTM_COUNT=0

while IFS= read -r pr_num; do
  merged_at=$(echo "$MERGED_IN_PERIOD" | \
    jq -r --argjson n "$pr_num" '.[] | select(.number == $n) | .mergedAt')

  LAST_REVIEW=$(gh api "repos/${REPO}/pulls/${pr_num}/reviews" \
    --jq '[.[] | select(.state == "APPROVED")] | last | .submitted_at' \
    2>/dev/null || echo "null")

  if [[ "$LAST_REVIEW" != "null" && -n "$LAST_REVIEW" && "$merged_at" != "null" ]]; then
    dur=$(seconds_between "$LAST_REVIEW" "$merged_at")
    if [[ $dur -gt 0 ]]; then
      TTM_TOTAL=$(( TTM_TOTAL + dur ))
      TTM_COUNT=$(( TTM_COUNT + 1 ))
    fi
  fi
done < <(echo "$MERGED_IN_PERIOD" | jq -r '.[].number')

if [[ $TTM_COUNT -gt 0 ]]; then
  AVG_TTM=$(( TTM_TOTAL / TTM_COUNT ))
  echo "  PRs with approval data : $TTM_COUNT"
  echo "  Avg time-to-merge      : $(pretty_duration $AVG_TTM)"
  if [[ $AVG_TTM -ge 86400 ]]; then
    echo "  ⚠️  THRESHOLD: avg TTM ≥ 24h after approval — reduce merge friction"
  fi
else
  echo "  No PRs with approval review data in the period."
fi
echo ""

# ── Summary footer ────────────────────────────────────────────────────────────
echo "────────────────────────────────────────────────────────────────────────"
echo "Metric thresholds — any ⚠️  above means follow-up work is warranted:"
echo ""
echo "  Metric                 Threshold   Action"
echo "  ─────────────────────  ─────────   ──────────────────────────────────────────"
echo "  CI duration            ≥ 20 min    Investigate build/test optimisation"
echo "  CI failure rate        ≥ 20%       Investigate flaky tests or infra issues"
echo "  PR lead time           ≥ 2 days    Identify review or merge bottlenecks"
echo "  Re-review cycles       ≥ 2/PR      Tighten pre-review quality gates"
echo "  Time-to-merge          ≥ 24h       Reduce manual merge friction"
echo ""
echo "To regenerate:"
echo "  make sdlc-report                  # 30-day window (default)"
echo "  make sdlc-report LOOKBACK_DAYS=90 # 90-day window"
echo "  pnpm sdlc:report                  # pnpm equivalent"
