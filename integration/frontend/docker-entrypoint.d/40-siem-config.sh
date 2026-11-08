#!/bin/sh
# Tulis config.json dari environment supaya satu image yang sama bisa dipakai
# untuk chain lokal maupun Sepolia (tanpa build ulang).
#
# Alamat kontrak: pakai env CONTRACT_ADDRESS kalau diisi (profil Sepolia);
# kalau kosong (profil lokal) ambil dari volume /state hasil service `deploy`.
# Dibaca di sini, bukan di skrip terpisah: entrypoint nginx menjalankan setiap
# /docker-entrypoint.d/*.sh sebagai proses anak, jadi `export` dari skrip lain
# tidak sampai ke sini.
set -e

: "${RPC_URL:=http://127.0.0.1:8545}"
: "${CONTRACT_ADDRESS:=}"
: "${CHAIN_ID:=31337}"
: "${NETWORK_NAME:=Hardhat lokal}"
: "${POLL_SECONDS:=10}"

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
  "dataPath": "/data"
}
EOF

echo "[siem-dashboard] config.json -> RPC ${RPC_URL}, kontrak ${CONTRACT_ADDRESS:-'(kosong)'}, chain ${CHAIN_ID}"
