@echo off
echo Stopping VPS Agent...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "LISTENING" ^| findstr ":5001 "') do (
    echo   Killing process PID %%a
    taskkill /PID %%a /F >nul 2>&1
)
echo Done.
