@echo off
chcp 65001 >nul
echo ═══════════════════════════════════════════════
echo   Mockup VPS Agent — Installer
echo ═══════════════════════════════════════════════
echo.

:: ── Check Node.js ──────────────────────────────────────────
echo [1/5] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   Node.js not found!
    echo   Download from: https://nodejs.org/
    echo   Install Node.js LTS and re-run this script.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do echo   Found: %%i

:: ── Check Python ───────────────────────────────────────────
echo [2/5] Checking Python...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo   Python not found!
    echo   Download from: https://www.python.org/downloads/
    echo   Install Python 3.12+ and re-run this script.
    echo   IMPORTANT: Check "Add Python to PATH" during install.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version') do echo   Found: %%i

:: ── Install Python dependencies ────────────────────────────
echo [3/5] Installing Python dependencies...
pip install playwright >nul 2>&1
if %errorlevel% neq 0 (
    echo   pip install playwright FAILED
    pause
    exit /b 1
)
echo   playwright installed

echo   Installing Chromium browser (this may take a few minutes)...
python -m playwright install chromium
if %errorlevel% neq 0 (
    echo   Chromium install FAILED
    pause
    exit /b 1
)
echo   Chromium installed

:: ── Install Node dependencies ──────────────────────────────
echo [4/5] Installing Node.js dependencies...
call npm install --production
if %errorlevel% neq 0 (
    echo   npm install FAILED
    pause
    exit /b 1
)
echo   Node dependencies installed

:: ── Create directories ─────────────────────────────────────
echo [5/5] Creating directories...
if not exist "uploads" mkdir uploads
if not exist "outputs" mkdir outputs
if not exist "cookies" mkdir cookies
if not exist "automation" mkdir automation
echo   Directories ready

:: ── Check .env ─────────────────────────────────────────────
if not exist ".env" (
    echo.
    echo ══════════════════════════════════════════════
    echo   IMPORTANT: Create .env file!
    echo   1. Copy .env.example to .env
    echo   2. Set SECRET_KEY (from Admin Panel)
    echo   3. Set SERVER_URL (Main Server address)
    echo ══════════════════════════════════════════════
    copy .env.example .env >nul 2>&1
    echo   Created .env from template — edit it now!
)

:: ── Check automation files ─────────────────────────────────
if not exist "automation\gemini_worker.py" (
    echo.
    echo ══════════════════════════════════════════════
    echo   IMPORTANT: Copy automation files!
    echo   Copy these files into agent\automation\:
    echo     - gemini_worker.py
    echo     - selectors.json
    echo     - check_session.py (optional)
    echo ══════════════════════════════════════════════
)

echo.
echo ═══════════════════════════════════════════════
echo   Installation complete!
echo   Next steps:
echo     1. Edit .env (set SECRET_KEY and SERVER_URL)
echo     2. Copy automation files (see above)
echo     3. Copy cookie folders into agent\cookies\
echo     4. Run start.bat to start the agent
echo ═══════════════════════════════════════════════
pause
