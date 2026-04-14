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
PW_CHROMIUM=$(/home/mockup/venv/bin/python3 -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    print(p.chromium.executable_path)
" 2>/dev/null)

if [ -z "$PW_CHROMIUM" ]; then
    PW_CHROMIUM=$(find /home/mockup/.cache/ms-playwright -name "chromium-*" -path "*/chrome-linux/chrome" 2>/dev/null | head -1)
fi

if [ -z "$PW_CHROMIUM" ]; then
    echo "ERROR: Cannot find Playwright Chromium. Using system chromium."
    PW_CHROMIUM="chromium-browser"
fi

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
    "https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn&flowEntry=ServiceLogin&continue=https://gemini.google.com/app" \
    2>/dev/null &

CHROME_PID=$!
echo "Chromium PID: $CHROME_PID"
echo "Đang chờ login... (Ctrl+C khi xong)"

# Wait for user to finish
wait $CHROME_PID 2>/dev/null || true
