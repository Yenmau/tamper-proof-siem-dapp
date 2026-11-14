@echo off
REM ============================================================
REM  Stack Tamper-Proof SIEM - MODE CHAIN LOKAL (chainId 31337)
REM  Untuk demo alarm tampering: serangan log -> alarm on-chain.
REM  Klik dua kali file ini. Butuh Docker Desktop sudah menyala.
REM  Aman dijalankan setelah laptop baru dinyalakan: service `deploy`
REM  akan men-deploy ulang kontrak karena chain lokal tidak menyimpan state.
REM ============================================================
cd /d "%~dp0"
echo [1/1] Menyalakan stack mode chain lokal (chain + deploy + victim + collector + mongo + API + dashboard)...
docker compose --profile local up -d
echo.
echo Selesai. Buka: http://127.0.0.1:8088
echo Dashboard memakai kontrak chain LOKAL (Hardhat, chainId 31337).
echo Untuk demo alarm, ikuti bagian "Demo alarm" di STATUS.md.
pause
