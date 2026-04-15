#!/bin/bash
# stop_login.sh — Stop noVNC + VNC + Chromium after login done
# Gracefully close Chromium first so cookies flush to disk

echo "Sending SIGTERM to Chromium (graceful close)..."
pkill -TERM -f "chromium.*user-data-dir=/home/mockup/mockup-tool/agent/cookies" 2>/dev/null || true

# Wait up to 10 seconds for Chromium to flush cookies and exit
for i in $(seq 1 10); do
    if ! pgrep -f "chromium.*user-data-dir=/home/mockup/mockup-tool/agent/cookies" > /dev/null 2>&1; then
        echo "Chromium exited after ${i}s"
        break
    fi
    sleep 1
done

# Force kill if still running
pkill -9 -f "chromium.*user-data-dir=/home/mockup/mockup-tool/agent/cookies" 2>/dev/null || true

pkill -f "x11vnc.*5900" 2>/dev/null || true
pkill -f "websockify.*6080" 2>/dev/null || true
echo "✓ Stopped VNC, noVNC, and Chromium"
