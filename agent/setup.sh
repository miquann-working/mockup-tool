#!/bin/bash
set -e

echo "═══════════════════════════════════════════════"
echo "  Mockup VPS Agent — Ubuntu Quick Setup"
echo "═══════════════════════════════════════════════"
echo

# ── Get parameters ─────────────────────────────────────────
if [ -z "$1" ]; then
    echo "Usage:  ./setup.sh  SERVER_URL  SECRET_KEY  [PORT]"
    echo
    echo "Example:"
    echo "  ./setup.sh  http://192.168.1.100:4000  abc123def456  5001"
    echo
    echo "  SERVER_URL  = Main Server address (no trailing slash)"
    echo "  SECRET_KEY  = Paste from Admin Panel > VPS > Key"
    echo "  PORT        = Agent port (default: 5001)"
    echo
    exit 1
fi

SERVER_URL="$1"
SECRET_KEY="$2"
AGENT_PORT="${3:-5001}"

if [ -z "$SECRET_KEY" ]; then
    echo "ERROR: SECRET_KEY is required!"
    echo "Usage: ./setup.sh SERVER_URL SECRET_KEY [PORT]"
    exit 1
fi

echo "  Server:  $SERVER_URL"
echo "  Key:     ${SECRET_KEY:0:8}..."
echo "  Port:    $AGENT_PORT"
echo

# ── Check Node.js ──────────────────────────────────────────
echo "[1/7] Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "  ERROR: Node.js not found!"
    echo "  Install: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
    exit 1
fi
echo "  Found: $(node -v)"

# ── Check Python ───────────────────────────────────────────
echo "[2/7] Checking Python..."
PYTHON_BIN=""
if command -v python3 &> /dev/null; then
    PYTHON_BIN="python3"
elif command -v python &> /dev/null; then
    PYTHON_BIN="python"
else
    echo "  ERROR: Python not found!"
    echo "  Install: sudo apt install -y python3 python3-pip"
    exit 1
fi
echo "  Found: $($PYTHON_BIN --version)"

# ── Install system dependencies for Chromium ───────────────
echo "[3/7] Installing system dependencies for Chromium..."
if command -v apt &> /dev/null; then
    sudo apt update -qq
    sudo apt install -y -qq libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
        libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libxshmfence1 \
        libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libcups2 \
        libxss1 libxtst6 fonts-liberation 2>/dev/null || \
    sudo apt install -y -qq libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
        libgbm1 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
        libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libcups2 \
        libxss1 libxtst6 fonts-liberation 2>/dev/null
    echo "  System deps installed"
else
    echo "  WARNING: apt not found, skipping system deps. Install Chromium deps manually."
fi

# ── Install Python dependencies ────────────────────────────
echo "[4/7] Installing Python dependencies..."
$PYTHON_BIN -m pip install --quiet playwright 2>/dev/null || pip3 install --quiet playwright
echo "  Installing Chromium browser..."
$PYTHON_BIN -m playwright install chromium
echo "  Chromium installed"

# ── Install Node.js dependencies ───────────────────────────
echo "[5/7] Installing Node.js dependencies..."
npm install --production --silent
echo "  Dependencies installed"

# ── Create directories ─────────────────────────────────────
echo "[6/7] Creating directories..."
mkdir -p uploads outputs cookies automation
echo "  Directories ready"

# ── Write .env ─────────────────────────────────────────────
echo "[7/7] Writing .env..."
cat > .env << EOF
AGENT_PORT=$AGENT_PORT
SECRET_KEY=$SECRET_KEY
SERVER_URL=$SERVER_URL
MAX_CONCURRENT=3
PYTHON_BIN=$PYTHON_BIN
HEADLESS=1
EOF
echo "  .env created"

# ── Check automation files ─────────────────────────────────
if [ ! -f "automation/gemini_worker.py" ]; then
    echo
    echo "══════════════════════════════════════════════"
    echo "  WARNING: automation/gemini_worker.py missing!"
    echo "  Copy gemini_worker.py + selectors.json"
    echo "  into the automation/ folder."
    echo "══════════════════════════════════════════════"
fi

# ── Make scripts executable ────────────────────────────────
chmod +x start.sh stop.sh 2>/dev/null || true

# ── Verify connection ──────────────────────────────────────
echo
echo "Verifying connection to server..."
node -e "fetch('${SERVER_URL}/api/vps/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret_key:'${SECRET_KEY}'})}).then(r=>{if(r.ok)console.log('  OK: Connected and authenticated!');else console.log('  WARN: Server responded '+r.status)}).catch(e=>console.log('  WARN: Could not reach server: '+e.message))"

echo
echo "═══════════════════════════════════════════════"
echo "  Setup complete!"
echo
echo "  To start:  ./start.sh"
echo "  To stop:   ./stop.sh"
echo "  Systemd:   sudo cp mockup-agent.service /etc/systemd/system/"
echo "             sudo systemctl enable --now mockup-agent"
echo "═══════════════════════════════════════════════"
