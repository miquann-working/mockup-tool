#!/bin/bash
echo "Stopping VPS Agent..."

# Read port from .env
PORT=$(grep AGENT_PORT .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
PORT=${PORT:-5001}

# Find and kill process on that port
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
    echo "  Killing process PID $PID on port $PORT"
    kill $PID 2>/dev/null
    sleep 1
    # Force kill if still running
    kill -9 $PID 2>/dev/null || true
    echo "Done."
else
    echo "  No process found on port $PORT"
fi
