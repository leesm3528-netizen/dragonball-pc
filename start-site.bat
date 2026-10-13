@echo off
chcp 65001 >nul
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8000
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:%PORT%"
py -X utf8 web\server.py
pause
