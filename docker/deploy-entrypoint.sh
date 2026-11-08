#!/bin/sh
# Tunggu chain hidup, pastikan kontrak tersedia, lalu tulis alamatnya ke volume
# bersama supaya collector & dashboard bisa memakainya tanpa disalin manual.
#
# Idempoten: kalau /state sudah berisi alamat DAN kontraknya masih ada di chain
# yang sedang jalan, deploy dilewati. Ini penting karena `docker compose up -d`
# ikut menyalakan kembali container `deploy` yang sudah exit — tanpa penjagaan
# ini setiap `up` akan men-deploy kontrak baru dan alamat di /state berpindah,
# sementara collector/dashboard bisa sudah memakai alamat yang lama.
set -e

: "${RPC_URL:=http://chain:8545}"
: "${STATE_DIR:=/state}"
: "${CONTRACT_ADDRESS:=}"

echo "[deploy] menunggu RPC ${RPC_URL} …"
node -e "
const url = process.env.RPC_URL;
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] });
(async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const j = await r.json();
      if (j.result) { console.log('[deploy] chain siap, chainId', j.result); process.exit(0); }
    } catch (_) { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error('[deploy] chain tidak kunjung siap');
  process.exit(1);
})();
"

mkdir -p "$STATE_DIR"

# Alamat tersimpan dari putaran sebelumnya (kalau ada).
TERSIMPAN=""
if [ -s "$STATE_DIR/contract-address.txt" ]; then
  TERSIMPAN=$(tr -d '\r\n' < "$STATE_DIR/contract-address.txt")
fi

# Kontrak masih ada di chain ini? (eth_getCode != "0x")
masih_ada() {
  [ -n "$1" ] || return 1
  HASIL=$(node -e "
const url = process.env.RPC_URL;
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [process.argv[1], 'latest'] });
(async () => {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    const j = await r.json();
    process.stdout.write(String(j.result || '0x'));
  } catch (e) { process.stdout.write('0x'); }
})();
" "$1")
  [ "$HASIL" != "0x" ] && [ -n "$HASIL" ]
}

if [ -n "${CONTRACT_ADDRESS}" ]; then
  echo "[deploy] CONTRACT_ADDRESS di-set lewat env (${CONTRACT_ADDRESS}) — tidak deploy baru"
elif masih_ada "$TERSIMPAN"; then
  CONTRACT_ADDRESS="$TERSIMPAN"
  echo "[deploy] pakai kontrak yang sudah ada di /state (${CONTRACT_ADDRESS}) — tidak deploy baru"
else
  [ -n "$TERSIMPAN" ] && echo "[deploy] alamat lama ${TERSIMPAN} tidak ada lagi di chain (chain baru/restart) — deploy ulang"
  echo "[deploy] deploy SIEMLogger ke ${RPC_URL} …"
  # Hardhat butuh network 'localhost' (lihat hardhat.config.js) — arahkan ke RPC_URL
  OUT=$(cd /repo && npx hardhat run scripts/deploy.js --network localhost 2>&1 || true)
  echo "$OUT"
  CONTRACT_ADDRESS=$(echo "$OUT" | sed -n 's/.*contract address : //p' | head -1)
  [ -n "$CONTRACT_ADDRESS" ] || { echo "[deploy] gagal membaca alamat kontrak"; exit 1; }
fi

printf '%s\n' "$CONTRACT_ADDRESS" > "$STATE_DIR/contract-address.txt"
printf '%s\n' "$RPC_URL" > "$STATE_DIR/rpc-url.txt"
echo "[deploy] alamat kontrak tersimpan: ${STATE_DIR}/contract-address.txt (${CONTRACT_ADDRESS})"
