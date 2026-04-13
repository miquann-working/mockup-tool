@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ═══════════════════════════════════════════════
echo   Mockup VPS Agent — Quick Setup
echo ═══════════════════════════════════════════════
echo.

:: ── Get parameters ─────────────────────────────────────────
if "%~1"=="" (
    echo Usage:  setup.bat  SERVER_URL  SECRET_KEY  [PORT]
    echo.
    echo Example:
    echo   setup.bat  http://192.168.1.100:4000  abc123def456  5001
    echo.
    echo   SERVER_URL  = Main Server address (no trailing slash^)
    echo   SECRET_KEY  = Paste from Admin Panel ^> VPS ^> Key
    echo   PORT        = Agent port (default: 5001^)
    echo.
    pause
    exit /b 1
)

set "SERVER_URL=%~1"
set "SECRET_KEY=%~2"
set "AGENT_PORT=%~3"

if "%SECRET_KEY%"=="" (
    echo ERROR: SECRET_KEY is required!
    echo Usage: setup.bat SERVER_URL SECRET_KEY [PORT]
    pause
    exit /b 1
)

if "%AGENT_PORT%"=="" set "AGENT_PORT=5001"

echo   Server:  %SERVER_URL%
echo   Key:     %SECRET_KEY:~0,8%...
echo   Port:    %AGENT_PORT%
echo.

:: ── Check Node.js ──────────────────────────────────────────
echo [1/6] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   ERROR: Node.js not found!
    echo   Download from: https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do echo   Found: %%i

:: ── Check Python ───────────────────────────────────────────
echo [2/6] Checking Python...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo   ERROR: Python not found!
    echo   Download from: https://www.python.org/downloads/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version') do echo   Found: %%i

:: ── Install dependencies ───────────────────────────────────
echo [3/6] Installing Python dependencies...
pip install playwright >nul 2>&1
echo   Installing Chromium browser...
python -m playwright install chromium
if %errorlevel% neq 0 (
    echo   WARNING: Chromium install had issues, continuing...
)

echo [4/6] Installing Node.js dependencies...
call npm install --production >nul 2>&1
if %errorlevel% neq 0 (
    echo   npm install FAILED
    pause
    exit /b 1
)
echo   Dependencies installed

:: ── Create directories ─────────────────────────────────────
echo [5/6] Creating directories...
if not exist "uploads" mkdir uploads
if not exist "outputs" mkdir outputs
if not exist "cookies" mkdir cookies
if not exist "automation" mkdir automation
echo   Directories ready

:: ── Write .env ─────────────────────────────────────────────
echo [6/6] Writing .env...
(
    echo AGENT_PORT=%AGENT_PORT%
    echo SECRET_KEY=%SECRET_KEY%
    echo SERVER_URL=%SERVER_URL%
    echo MAX_CONCURRENT=3
    echo PYTHON_BIN=python
    echo HEADLESS=1
) > .env
echo   .env created

:: ── Check automation files ─────────────────────────────────
if not exist "automation\gemini_worker.py" (
    echo.
    echo ══════════════════════════════════════════════
    echo   WARNING: automation\gemini_worker.py missing!
    echo   Copy gemini_worker.py + selectors.json
    echo   into the automation\ folder.
    echo ══════════════════════════════════════════════
)

:: ── Verify connection ──────────────────────────────────────
echo.
echo Verifying connection to server...
node -e "fetch('%SERVER_URL%/api/vps/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret_key:'%SECRET_KEY%'})}).then(r=>{if(r.ok)console.log('  OK: Connected and authenticated!');else console.log('  WARN: Server responded '+r.status)}).catch(e=>console.log('  WARN: Could not reach server: '+e.message))"

echo.
echo ═══════════════════════════════════════════════
echo   Setup complete!
echo.
echo   To start:  start.bat
echo   To stop:   stop.bat
echo ═══════════════════════════════════════════════
pause
