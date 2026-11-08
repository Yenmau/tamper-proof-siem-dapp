#!/bin/sh
# Siapkan env API off-chain: alamat kontrak boleh datang dari env, kalau kosong
# dibaca dari volume /state (hasil service `deploy`). Sama polanya dengan
# collector-entrypoint.sh supaya tidak ada alamat yang disalin manual.
set -e

: "${STATE_DIR:=/state}"
: "${PORT:=8089}"
: "${WAIT_FOR_STATE:=1}"

if [ -z "${CONTRACT_ADDRESS:-}" ]; then
  echo "[api] CONTRACT_ADDRESS kosong — menunggu ${STATE_DIR}/contract-address.txt"
  i=0
  while [ ! -s "${STATE_DIR}/contract-address.txt" ]; do
    i=$((i + 1))
    if [ "${WAIT_FOR_STATE}" != "1" ] || [ "$i" -gt 120 ]; then
      echo "[api] alamat kontrak belum tersedia. Kalau pakai Sepolia, isi CONTRACT_ADDRESS di .env."
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

export RPC_URL CONTRACT_ADDRESS PORT
echo "[api] RPC=${RPC_URL} kontrak=${CONTRACT_ADDRESS} port=${PORT}"

exec node /repo/integration/backend/api/server.js "$@"
