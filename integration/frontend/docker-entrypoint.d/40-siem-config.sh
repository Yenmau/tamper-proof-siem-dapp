#!/bin/sh
# Tulis config.json dari environment supaya satu image yang sama bisa dipakai
# untuk chain lokal maupun Sepolia (tanpa build ulang).
set -e

: "${RPC_URL:=http://127.0.0.1:8545}"
: "${CONTRACT_ADDRESS:=}"
: "${CHAIN_ID:=31337}"
: "${NETWORK_NAME:=Hardhat lokal}"
: "${POLL_SECONDS:=10}"

cat > /usr/share/nginx/html/config.json <<EOF
{
  "rpcUrl": "${RPC_URL}",
  "contractAddress": "${CONTRACT_ADDRESS}",
  "chainId": ${CHAIN_ID},
  "networkName": "${NETWORK_NAME}",
  "pollSeconds": ${POLL_SECONDS},
  "dataPath": "/data"
}
EOF

echo "[siem-dashboard] config.json -> RPC ${RPC_URL}, kontrak ${CONTRACT_ADDRESS:-'(kosong)'}, chain ${CHAIN_ID}"
