#!/bin/sh
# Siapkan env collector: alamat kontrak & RPC boleh datang dari env; kalau
# alamat kosong, dibaca dari volume /state hasil service `deploy` (tunggu dulu).
set -e

: "${STATE_DIR:=/state}"
: "${BATCH_DIR:=/data/batches}"
: "${WAIT_FOR_STATE:=1}"

if [ -z "${CONTRACT_ADDRESS:-}" ]; then
  echo "[collector] CONTRACT_ADDRESS kosong — menunggu ${STATE_DIR}/contract-address.txt"
  i=0
  while [ ! -s "${STATE_DIR}/contract-address.txt" ]; do
    i=$((i + 1))
    if [ "${WAIT_FOR_STATE}" != "1" ] || [ "$i" -gt 120 ]; then
      echo "[collector] alamat kontrak belum tersedia. Kalau pakai Sepolia, isi CONTRACT_ADDRESS di .env."
      exit 1
    fi
    sleep 2
  done
  CONTRACT_ADDRESS=$(tr -d '\r\n' < "${STATE_DIR}/contract-address.txt")
fi

if [ -z "${RPC_URL:-}" ]; then
  if [ -s "${STATE_DIR}/rpc-url.txt" ]; then
    RPC_URL=$(tr -d '\r\n' < "${STATE_DIR}/rpc-url.txt")
  else
    RPC_URL="http://chain:8545"
  fi
fi

export RPC_URL CONTRACT_ADDRESS BATCH_DIR
mkdir -p "$BATCH_DIR"
echo "[collector] RPC=${RPC_URL} kontrak=${CONTRACT_ADDRESS} batch=${BATCH_DIR}"

exec node /repo/integration/backend/collectorService.js "$@"
