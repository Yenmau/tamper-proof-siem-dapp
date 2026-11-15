@echo off
cd /d "%~dp0"
echo Menghentikan semua container (data tidak dihapus)...
docker compose -f docker-compose.yml -f docker-compose.sepolia.yml --profile local down
echo.
echo Selesai. Untuk menyalakan lagi: klik dua kali
echo   jalankan-dashboard-sepolia.bat   (mode Sepolia)
echo   atau jalankan:  docker compose --profile local up -d   (mode chain lokal)
pause

