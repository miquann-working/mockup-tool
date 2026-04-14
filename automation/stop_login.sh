#!/bin/bash
# stop_login.sh — Stop noVNC + VNC + Chromium after login done
pkill -f "x11vnc.*5900" 2>/dev/null || true
pkill -f "websockify.*6080" 2>/dev/null || true
pkill -f "chromium.*user-data-dir=/home/mockup/mockup-tool/agent/cookies" 2>/dev/null || true
echo "✓ Stopped VNC, noVNC, and Chromium"
