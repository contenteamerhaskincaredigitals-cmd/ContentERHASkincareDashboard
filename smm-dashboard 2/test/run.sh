#!/usr/bin/env bash
# Jalankan seluruh tes: bash test/run.sh
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
export PW="tes-password-123"
MOCK_PORT=4555 node test/mock-graph.js > "$TMP/mock.log" 2>&1 &
MOCK=$!
DATA_DIR="$TMP/data" PORT=3100 ADMIN_USER=admin ADMIN_PASSWORD="$PW" AUTO_SYNC=0 \
  META_GRAPH_BASE=http://127.0.0.1:4555 THREADS_BASE=http://127.0.0.1:4555/threads TIKTOK_BASE=http://127.0.0.1:4555/tiktok TIKTOK_CLIENT_KEY=ck_test TIKTOK_CLIENT_SECRET=cs_test TIKTOK_AUTH_URL=http://127.0.0.1:4555/tiktok/auth TRENDS_RSS_URL=http://127.0.0.1:4555/rss \
  node server.js > "$TMP/server.log" 2>&1 &
SRV=$!
trap 'kill $MOCK $SRV 2>/dev/null' EXIT
sleep 1.5
BASE=http://localhost:3100 OUT=${OUT:-/tmp/smm-test} python3 test/e2e.py
echo "--- cek token tidak ada di log server / database plaintext"
if grep -q "TOKEN_" "$TMP/server.log"; then echo "FAIL token muncul di log"; exit 1; else echo "PASS token tidak ada di log"; fi
if strings "$TMP/data/app.db"* | grep -q "TOKEN_"; then echo "FAIL token tersimpan plaintext"; exit 1; else echo "PASS token tersimpan terenkripsi"; fi
