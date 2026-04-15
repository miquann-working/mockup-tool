#!/bin/bash
# start_login.sh — Start noVNC + open Chromium for Google login
# Usage: ./start_login.sh <email>
# Admin opens http://<VPS_IP>:6080/vnc.html in browser to interact

set -e

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
    echo "Usage: $0 <email>"
    echo "Example: $0 rosewatts1991@gmail.com"
    exit 1
fi

COOKIE_DIR="/home/mockup/mockup-tool/agent/cookies/$EMAIL"
VNC_PORT=5900
NOVNC_PORT=6080
DISPLAY_NUM=:99

# Ensure cookie dir exists
mkdir -p "$COOKIE_DIR"

# Only reset profile if --reset flag is passed
if [ "${2:-}" = "--reset" ] && [ -d "$COOKIE_DIR/Default" ]; then
    echo "Resetting browser profile (keeping exported_cookies.json)..."
    # Backup exported cookies if exists
    if [ -f "$COOKIE_DIR/exported_cookies.json" ]; then
        cp "$COOKIE_DIR/exported_cookies.json" /tmp/exported_cookies_backup.json
    fi
    if [ -f "$COOKIE_DIR/cookie_platform.txt" ]; then
        cp "$COOKIE_DIR/cookie_platform.txt" /tmp/cookie_platform_backup.txt
    fi
    # Remove old profile
    rm -rf "$COOKIE_DIR"
    mkdir -p "$COOKIE_DIR"
    # Restore backups
    if [ -f /tmp/exported_cookies_backup.json ]; then
        mv /tmp/exported_cookies_backup.json "$COOKIE_DIR/exported_cookies.json"
    fi
    if [ -f /tmp/cookie_platform_backup.txt ]; then
        mv /tmp/cookie_platform_backup.txt "$COOKIE_DIR/cookie_platform.txt"
    fi
fi

# Kill any existing x11vnc / novnc / chromium
pkill -f "x11vnc.*$VNC_PORT" 2>/dev/null || true
pkill -f "websockify.*$NOVNC_PORT" 2>/dev/null || true
pkill -f "chromium.*user-data-dir=$COOKIE_DIR" 2>/dev/null || true
sleep 1

# Ensure Xvfb is running
if ! pgrep -f "Xvfb $DISPLAY_NUM" > /dev/null; then
    Xvfb $DISPLAY_NUM -screen 0 1280x900x24 &
    sleep 1
fi

export DISPLAY=$DISPLAY_NUM

# Start x11vnc on the Xvfb display
x11vnc -display $DISPLAY_NUM -rfbport $VNC_PORT -nopw -shared -forever -bg -quiet 2>/dev/null

# Start noVNC (websocket proxy)
NOVNC_DIR=$(find /usr/share -maxdepth 1 -name "novnc" -type d 2>/dev/null | head -1)
if [ -z "$NOVNC_DIR" ]; then
    NOVNC_DIR="/usr/share/novnc"
fi

websockify --web="$NOVNC_DIR" $NOVNC_PORT localhost:$VNC_PORT --daemon 2>/dev/null

# Get Playwright Chromium path
PW_CHROMIUM=$(find /home/mockup/.cache/ms-playwright -name "chrome" -path "*/chrome-linux*/chrome" -type f 2>/dev/null | head -1)

if [ -z "$PW_CHROMIUM" ]; then
    PW_CHROMIUM=$(/home/mockup/venv/bin/python3 -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    print(p.chromium.executable_path)
" 2>/dev/null)
fi

if [ -z "$PW_CHROMIUM" ]; then
    echo "ERROR: Cannot find Playwright Chromium!"
    exit 1
fi

echo "Using Chromium: $PW_CHROMIUM"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  LOGIN GOOGLE ACCOUNT: $EMAIL"
echo "║                                                              ║"
echo "║  Mở link này trong browser:                                  ║"
echo "║  👉 http://$(hostname -I | awk '{print $1}'):$NOVNC_PORT/vnc.html  ║"
echo "║                                                              ║"
echo "║  Sau khi login xong & Gemini hiện → đóng terminal này       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Launch Chromium with the cookie profile, navigate to Google login
$PW_CHROMIUM \
    --user-data-dir="$COOKIE_DIR" \
    --no-sandbox \
    --disable-setuid-sandbox \
    --disable-gpu \
    --disable-software-rasterizer \
    --disable-dev-shm-usage \
    --password-store=basic \
    --lang=vi-VN \
    --window-size=1280,900 \
    --window-position=0,0 \
    --no-first-run \
    --no-default-browser-check \
    --disable-translate \
    --disable-sync \
    --user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
    "https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn&flowEntry=ServiceLogin&continue=https://gemini.google.com/app" \
    &

CHROME_PID=$!
echo "Chromium PID: $CHROME_PID"
echo "Đang chờ login... (Ctrl+C khi xong)"

# Wait for user to finish
wait $CHROME_PID 2>/dev/null || true
