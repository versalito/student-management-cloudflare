#!/usr/bin/env bash
# ============================================================================
# perf-probe.sh — đo p50/p95 7 endpoint nóng (PERF_OPTIMIZATION_SPEC.md §8)
#
# CÁCH DÙNG:
#   npm run build && npm start -- -p 3112 &
#   ./scripts/perf-probe.sh http://localhost:3112 20
#
# Tham số:
#   $1 = base URL (mặc định http://localhost:3000)
#   $2 = số lần lặp (mặc định 20)
#   $3 = ngưỡng p95 tính bằng ms (tùy chọn) — vượt ngưỡng thì exit 1 (CI gate)
#   $4 = ngày dùng cho /api/schedule & /api/attendance (mặc định hôm nay)
#
# Output: p50/p95 (giây) + kích thước payload của từng endpoint.
# Exit code: 0 nếu mọi endpoint đạt ngưỡng (hoặc không đặt ngưỡng), 1 nếu vượt.
# ============================================================================
set -euo pipefail

BASE="${1:-http://localhost:3000}"
ROUNDS="${2:-20}"
BUDGET_MS="${3:-}"
PROBE_DATE="${4:-$(date +%Y-%m-%d)}"

ENDPOINTS=(
  "/api/students?page=1&limit=50"
  "/api/teachers"
  "/api/classes"
  "/api/schedule?date=${PROBE_DATE}"
  "/api/attendance?date=${PROBE_DATE}"
  "/api/audit?page=1&limit=25"
  "/api/notifications?userId=ST001&role=STUDENT"
)

printf "%-52s %8s %8s %10s\n" "ENDPOINT" "p50" "p95" "BYTES"
printf '%.0s-' {1..82}
printf "\n"

failed=0

for path in "${ENDPOINTS[@]}"; do
  times_file=$(mktemp)

  # 1 lần warm-up (bỏ qua) rồi mới đo, tránh tính cold start/route compile.
  curl -s -o /dev/null "$BASE$path"

  for _ in $(seq 1 "$ROUNDS"); do
    curl -s -o /dev/null -w "%{time_total}\n" "$BASE$path" >> "$times_file"
  done

  bytes=$(curl -s -o /dev/null -w "%{size_download}" "$BASE$path")

  read -r p50 p95 < <(sort -n "$times_file" | awk -v n="$ROUNDS" '
    { v[NR] = $1 }
    END {
      p50 = int(n * 0.50); if (p50 < 1) p50 = 1
      p95 = int(n * 0.95); if (p95 < 1) p95 = 1
      if (p95 > n) p95 = n
      printf "%.3f %.3f\n", v[p50], v[p95]
    }')

  printf "%-52s %8s %8s %10s\n" "$path" "$p50" "$p95" "$bytes"

  if [ -n "$BUDGET_MS" ]; then
    p95_ms=$(awk -v s="$p95" 'BEGIN { printf "%d", s * 1000 }')
    if [ "$p95_ms" -gt "$BUDGET_MS" ]; then
      printf "  ✗ p95 %s ms > budget %s ms\n" "$p95_ms" "$BUDGET_MS" >&2
      failed=1
    fi
  fi

  rm -f "$times_file"
done

if [ "$failed" -ne 0 ]; then
  printf "\nFAIL: có endpoint vượt budget p95 = %s ms\n" "$BUDGET_MS" >&2
  exit 1
fi
