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
# Xác thực: mọi endpoint đều yêu cầu phiên đăng nhập, nên script tự đăng nhập
# lấy cookie (PROBE_USERNAME/PROBE_PASSWORD) hoặc dùng PROBE_COOKIE có sẵn.
# Không có thông tin đăng nhập thì mọi request trả 401 và số đo vô nghĩa —
# script dừng ngay thay vì in ra bảng toàn 62 byte.
#
# Output: p50/p95 (giây) + kích thước payload của từng endpoint.
# Exit code: 0 nếu mọi endpoint đạt ngưỡng (hoặc không đặt ngưỡng), 1 nếu vượt.
# ============================================================================
set -euo pipefail

BASE="${1:-http://localhost:3000}"
ROUNDS="${2:-20}"
BUDGET_MS="${3:-}"
PROBE_DATE="${4:-$(date +%Y-%m-%d)}"

COOKIE="${PROBE_COOKIE:-}"
if [ -z "$COOKIE" ]; then
  PROBE_USERNAME="${PROBE_USERNAME:-admin}"
  PROBE_PASSWORD="${PROBE_PASSWORD:-admin123}"
  login_body=$(printf '{"username":"%s","password":"%s"}' "$PROBE_USERNAME" "$PROBE_PASSWORD")
  login_headers=$(curl -s -D - -o /dev/null -X POST "$BASE/api/auth/login" \
    -H 'content-type: application/json' -d "$login_body")
  COOKIE=$(printf '%s' "$login_headers" | tr -d '\r' | awk 'tolower($1) == "set-cookie:" { print $2; exit }' | cut -d';' -f1)
  if [ -z "$COOKIE" ]; then
    printf 'Không đăng nhập được (%s) — kiểm tra PROBE_USERNAME/PROBE_PASSWORD hoặc PROBE_COOKIE\n' "$BASE" >&2
    exit 2
  fi
fi

ENDPOINTS=(
  "/api/students?page=1&limit=50"
  "/api/teachers"
  "/api/classes"
  "/api/schedule?date=${PROBE_DATE}"
  "/api/attendance?date=${PROBE_DATE}"
  "/api/audit?page=1&limit=25"
  "/api/notifications?userId=ST001&role=STUDENT"
  # Phase 2.1: một request thay cho schedule+teachers+classes+students của calendar.
  "/api/bootstrap?scope=slots,classes,teachers,shifts,students&date=${PROBE_DATE}"
)

printf "%-72s %8s %8s %10s\n" "ENDPOINT" "p50" "p95" "BYTES"
printf '%.0s-' {1..102}
printf "\n"

failed=0

for path in "${ENDPOINTS[@]}"; do
  times_file=$(mktemp)

  # 1 lần warm-up (bỏ qua) rồi mới đo, tránh tính cold start/route compile.
  # Đo trên response lỗi (401 hết phiên, 500) là số vô nghĩa — dừng ngay.
  warm_code=$(curl -s -o /dev/null -H "cookie: $COOKIE" -w "%{http_code}" "$BASE$path")
  if [ "$warm_code" != "200" ]; then
    printf "  ✗ %s trả HTTP %s ở lần warm-up — dừng đo\\n" "$path" "$warm_code" >&2
    exit 2
  fi

  for _ in $(seq 1 "$ROUNDS"); do
    curl -s -o /dev/null -w "%{time_total}\n" -H "cookie: $COOKIE" "$BASE$path" >> "$times_file"
  done

  read -r http_code bytes < <(curl -s -o /dev/null -H "cookie: $COOKIE" \
    -w "%{http_code} %{size_download}\n" "$BASE$path")
  if [ "$http_code" != "200" ]; then
    printf "  ✗ %s trả HTTP %s — dừng đo\\n" "$path" "$http_code" >&2
    exit 2
  fi

  read -r p50 p95 < <(sort -n "$times_file" | awk -v n="$ROUNDS" '
    { v[NR] = $1 }
    END {
      p50 = int(n * 0.50); if (p50 < 1) p50 = 1
      p95 = int(n * 0.95); if (p95 < 1) p95 = 1
      if (p95 > n) p95 = n
      printf "%.3f %.3f\n", v[p50], v[p95]
    }')

  printf "%-72s %8s %8s %10s\n" "$path" "$p50" "$p95" "$bytes"

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
