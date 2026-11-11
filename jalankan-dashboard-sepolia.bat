@echo off
REM ============================================================
REM  Dashboard SOC (http://127.0.0.1:8088) -> kontrak v4.0 Sepolia
REM  Klik dua kali file ini. Butuh Docker Desktop sudah menyala.
REM ============================================================
cd /d "%~dp0"
echo [1/2] Menyalakan stack (chain lokal + victim + collector + mongo + API)...
docker compose --profile local up -d
echo.
echo [2/2] Mengarahkan dashboard ke kontrak Sepolia...
docker compose -f docker-compose.yml -f docker-compose.sepolia.yml --profile local up -d --no-deps dashboard
echo.
echo Selesai. Buka: http://127.0.0.1:8088
echo Kontrak: 0x08129667d39d7e380Ac08d1359FeB5AD85b796e9 (Sepolia)
pause
