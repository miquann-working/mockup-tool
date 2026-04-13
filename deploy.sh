#!/bin/bash
# ============================================
# Deploy script - Chạy trên VM để pull code mới và restart services
# Usage:
#   Backend VM:  bash deploy.sh backend
#   Agent VM:    bash deploy.sh agent
# ============================================

set -e

ROLE="${1:-agent}"
PROJECT_DIR="/home/mockup/mockup-tool"

echo "============================================"
echo "  Deploy: $ROLE"
echo "  Dir: $PROJECT_DIR"
echo "============================================"

cd "$PROJECT_DIR"

# Pull code mới
echo "[1/3] Pulling latest code..."
git pull origin main
echo "  Done."

if [ "$ROLE" = "backend" ]; then
    echo "[2/3] Restarting backend + frontend..."

    # Check if pm2 is available
    if command -v pm2 &>/dev/null; then
        pm2 restart all
        echo "  PM2 restart all done."
    else
        # Manual restart
        echo "  Restarting backend..."
        pkill -f "node src/index.js" || true
        cd "$PROJECT_DIR/backend"
        nohup node src/index.js > /tmp/backend.log 2>&1 &
        echo "  Backend started (PID: $!)"

        echo "  Restarting frontend..."
        pkill -f "next" || true
        cd "$PROJECT_DIR/frontend"
        nohup npx next start -p 3000 > /tmp/frontend.log 2>&1 &
        echo "  Frontend started (PID: $!)"
    fi

elif [ "$ROLE" = "agent" ]; then
    echo "[2/3] Restarting agent..."

    if command -v pm2 &>/dev/null; then
        pm2 restart agent
        echo "  PM2 restart agent done."
    else
        pkill -f "node server.js" || true
        cd "$PROJECT_DIR/agent"
        nohup node server.js > /tmp/agent.log 2>&1 &
        echo "  Agent started (PID: $!)"
    fi
fi

echo "[3/3] Verifying..."
sleep 2

if [ "$ROLE" = "backend" ]; then
    curl -s http://localhost:4000/api/health 2>/dev/null && echo "  Backend: OK" || echo "  Backend: checking..."
    curl -s http://localhost:3000 >/dev/null 2>&1 && echo "  Frontend: OK" || echo "  Frontend: checking..."
elif [ "$ROLE" = "agent" ]; then
    AGENT_PORT=$(grep AGENT_PORT "$PROJECT_DIR/agent/.env" 2>/dev/null | cut -d= -f2 || echo "5001")
    curl -s "http://localhost:${AGENT_PORT}/agent/health" 2>/dev/null && echo "" || echo "  Agent: checking..."
fi

echo ""
echo "============================================"
echo "  Deploy $ROLE complete!"
echo "============================================"
