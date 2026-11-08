# infra/ — Server simulasi (Jobdesk #3, DevOps)

Server Linux "korban" di Docker untuk proyek Tamper-Proof SIEM:
**rsyslog** (mencatat log), **OpenSSH** (target brute force Red Team), dan
**log-shipper** (Node.js) yang memotong `auth.log` menjadi **file batch**.
Ketiganya dijalankan otomatis oleh supervisord (restart sendiri kalau mati).

## Alur
```
SSH gagal -> rsyslog -> /var/log/auth.log -> shipper -> infra/siem-batches/auth-<waktu>-NNN.log
                                                            |
                              merkleCollector.js record / watch (backend #2)
```
Tiap batch = 1 file yang tidak diubah lagi, dengan `logId` sendiri
(`victim-server/auth-<waktu>-NNN`, juga dicatat di `siem-batches/index.ndjson`).
Batch dibuat tiap `BATCH_SIZE` baris (default 20) atau tiap `FLUSH_INTERVAL_MS` (default 30 dtk).

## Jalankan
    cd infra
    docker compose up -d --build
    docker exec siem-victim supervisorctl status     # 3 service harus RUNNING

## Buat log
    ssh -p 2222 victim@localhost                     # password salah -> tercatat
    # atau log palsu (PowerShell):
    1..20 | % { docker exec siem-victim logger -p auth.info -t sshd "Failed password for invalid user u$_ from 10.0.0.$_ port 22 ssh2" }

## Sambung ke backend (dari root repo)
    # PowerShell
    $f  = (Get-ChildItem infra\siem-batches\auth-*.log | Select-Object -First 1).FullName
    $id = "victim-server/" + [IO.Path]::GetFileNameWithoutExtension($f)
    node integration\backend\merkleCollector.js record $f $id --no-db
    node integration\backend\merkleCollector.js watch  $f $id 5 --no-db

Konfigurasi `.env` backend (RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY) lihat `integration/README.md`.
Uji lokal tanpa testnet: `npx hardhat node` + `npx hardhat run scripts/deploy.js --network localhost`.

## Simulasi serangan (untuk Red Team)
    # ubah 1 karakter di batch -> watch jadi TAMPERED
    docker exec siem-victim sh -c "sed -i 's/user u5 /user u9 /' /siem-batches/<nama-batch>.log"
    # hapus batch -> alarm LOG_FILE_MISSING
    docker exec siem-victim rm /siem-batches/<nama-batch>.log
    # kosongkan auth.log -> shipper mencetak ALERT
    docker exec siem-victim sh -c ": > /var/log/auth.log"

## Catatan
- Akun `victim:password123` dan `admin:admin` sengaja lemah, hanya untuk simulasi.
- Tidak ada private key di Docker; `record` dijalankan backend (#2) dengan akun SOC_ANALYST.
- Reset bersih: `docker compose down -v` lalu hapus isi `infra/siem-batches/` (kecuali `.gitkeep`).
