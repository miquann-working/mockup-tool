@echo off
chcp 65001 >nul
echo Starting VPS Agent...
echo Press Ctrl+C to stop.
echo.
node server.js
if %errorlevel% neq 0 (
    echo.
    echo Agent exited with error. Check logs above.
    pause
)
