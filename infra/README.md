# infra/ — Server simulasi (Jobdesk #3, DevOps)

Server Linux "korban" di Docker untuk proyek Tamper-Proof SIEM:
**rsyslog** (mencatat log), **OpenSSH** (target brute force Red Team), dan
**log-shipper** (Node.js) yang memotong `auth.log` menjadi **file batch**.
Ketiganya dijalankan otomatis oleh supervisord (restart sendiri kalau mati).

> Penting: `sshd` dijalankan sebagai `sshd -D` **tanpa** flag `-e`. Dengan `-e`
> sshd menulis log ke stderr container, sehingga baris `Failed password` /
> `Invalid user` tidak masuk `auth.log` dan percobaan brute force tidak pernah
> ter-batch. Sudah diuji: dengan `-D` saja, `Failed password for victim from …`
> muncul di `/var/log/auth.log` dan ikut jadi batch.

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

> Kalau yang diinginkan **stack lengkap** (chain + collector + dashboard),
> jalankan `docker compose --profile local up -d --build` dari **root repo**
> (lihat `README.md` bagian 🐳). Jangan menjalankan kedua compose bersamaan:
> nama container (`siem-victim`), port 2222, dan folder `siem-batches` sama.

Mode berdiri sendiri (hanya server korban, untuk kerja #3):

    cd infra
    docker compose up -d --build
    docker exec siem-victim supervisorctl status     # 3 service harus RUNNING
    docker inspect --format '{{.State.Health.Status}}' siem-victim   # healthy

Port SSH sengaja hanya di-bind ke **127.0.0.1:2222** (bukan ke seluruh jaringan),
karena akun di dalamnya memakai password lemah.

Kalau mengubah config supervisord saat container sudah jalan, `supervisorctl
restart <program>` saja **tidak cukup** — supervisord menyimpan config di memori.
Pakai `docker compose restart` atau `supervisorctl reread && supervisorctl update`.

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
- Container berjalan sebagai **root** karena `sshd`, `rsyslogd`, dan `supervisord`
  butuh menulis ke `/var/log` dan membuka port 22. Ini server korban, bukan
  container produksi.
- Baris log yang masuk **sebelum** shipper sempat jalan (beberapa ratus milidetik
  saat boot) sengaja dilewati; shipper mencetak `lewati N byte log lama`.
- Nama batch memakai timestamp detik + nomor urut. Nomor urut di-reset saat
  container restart, jadi shipper memeriksa dulu: kalau nama sudah ada, nomor
  dinaikkan supaya batch lama (yang mungkin sudah direkam on-chain) tidak tertimpa.
- Reset bersih: `docker compose down -v` lalu hapus isi `infra/siem-batches/` (kecuali `.gitkeep`).
