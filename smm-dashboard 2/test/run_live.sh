#!/usr/bin/env bash
# Tes English + live auto-sync: bash test/run_live.sh
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d); export PW="tes-password-123"
MOCK_PORT=4556 node test/mock-graph.js > "$TMP/mock.log" 2>&1 & MOCK=$!
DATA_DIR="$TMP/data" PORT=3101 ADMIN_PASSWORD="$PW" AUTO_SYNC=1 \
  META_GRAPH_BASE=http://127.0.0.1:4556 THREADS_BASE=http://127.0.0.1:4556/threads TIKTOK_BASE=http://127.0.0.1:4556/tiktok TIKTOK_CLIENT_KEY=ck_test TIKTOK_CLIENT_SECRET=cs_test TIKTOK_AUTH_URL=http://127.0.0.1:4556/tiktok/auth TRENDS_RSS_URL=http://127.0.0.1:4556/rss node server.js > "$TMP/server.log" 2>&1 & SRV=$!
trap 'kill $MOCK $SRV 2>/dev/null' EXIT
sleep 1.5
BASE=http://localhost:3101 OUT=${OUT:-/tmp/smm-live} python3 test/en_live.py
