#!/bin/sh
set -e

: "${RPC_URL:=http://127.0.0.1:8545}"
: "${CONTRACT_ADDRESS:=}"
: "${CHAIN_ID:=31337}"
: "${NETWORK_NAME:=Hardhat lokal}"
: "${POLL_SECONDS:=10}"
: "${API_BASE_URL:=}"

if [ -z "${CONTRACT_ADDRESS}" ] && [ -s /state/contract-address.txt ]; then
  CONTRACT_ADDRESS=$(tr -d '\r\n' < /state/contract-address.txt)
  echo "[siem-dashboard] alamat kontrak dari /state: ${CONTRACT_ADDRESS}"
fi

cat > /usr/share/nginx/html/config.json <<EOF
{
  "rpcUrl": "${RPC_URL}",
  "contractAddress": "${CONTRACT_ADDRESS}",
  "chainId": ${CHAIN_ID},
  "networkName": "${NETWORK_NAME}",
  "pollSeconds": ${POLL_SECONDS},
  "apiBase": "${API_BASE_URL}",
  "dataPath": "/data"
}
EOF

echo "[siem-dashboard] config.json -> RPC ${RPC_URL}, kontrak ${CONTRACT_ADDRESS:-'(kosong)'}, chain ${CHAIN_ID}, API ${API_BASE_URL:-'(kosong)'}"

