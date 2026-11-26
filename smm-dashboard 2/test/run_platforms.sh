#!/usr/bin/env bash
# Tes TikTok, Threads & tampilan gabungan: bash test/run_platforms.sh
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d); export PW="tes-password-123"
MOCK_PORT=4557 node test/mock-graph.js > "$TMP/mock.log" 2>&1 & MOCK=$!
DATA_DIR="$TMP/data" PORT=3102 ADMIN_PASSWORD="$PW" AUTO_SYNC=1 \
  META_GRAPH_BASE=http://127.0.0.1:4557 THREADS_BASE=http://127.0.0.1:4557/threads TIKTOK_BASE=http://127.0.0.1:4557/tiktok \
  TIKTOK_CLIENT_KEY=ck_test TIKTOK_CLIENT_SECRET=cs_test TIKTOK_AUTH_URL=http://127.0.0.1:4557/tiktok/auth \
  TRENDS_RSS_URL=http://127.0.0.1:4557/rss node server.js > "$TMP/server.log" 2>&1 & SRV=$!
trap 'kill $MOCK $SRV 2>/dev/null' EXIT
sleep 1.5
BASE=http://localhost:3102 OUT=${OUT:-/tmp/smm-plat} python3 test/platforms.py
if grep -qE "THGOOD|TTGOOD|RTGOOD|TOKEN_" "$TMP/server.log"; then echo "FAIL token di log"; exit 1; else echo "PASS token tidak ada di log"; fi
if strings "$TMP/data/app.db"* | grep -qE "THGOOD|TTGOOD|RTGOOD"; then echo "FAIL token plaintext"; exit 1; else echo "PASS token Threads/TikTok terenkripsi"; fi
