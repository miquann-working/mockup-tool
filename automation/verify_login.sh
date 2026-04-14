#!/bin/bash
# verify_login.sh — Check if Google login succeeded for an account
# Usage: ./verify_login.sh <email>

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
    echo "Usage: $0 <email>"
    exit 1
fi

COOKIE_DIR="/home/mockup/mockup-tool/agent/cookies/$EMAIL"
VENV="/home/mockup/venv/bin/python3"

echo "Checking login status for: $EMAIL"
echo ""

$VENV -c "
import sqlite3, os, sys

db_paths = [
    '$COOKIE_DIR/Default/Network/Cookies',
    '$COOKIE_DIR/Default/Cookies',
]

db_path = None
for p in db_paths:
    if os.path.isfile(p):
        db_path = p
        break

if not db_path:
    print('❌ No cookie database found!')
    sys.exit(1)

conn = sqlite3.connect(db_path)
c = conn.cursor()

# Check for key auth cookies
auth_names = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID']
c.execute('SELECT name FROM cookies WHERE host_key LIKE \"%google.com\" AND name IN ({})'.format(
    ','.join(['?']*len(auth_names))
), auth_names)

found = [r[0] for r in c.fetchall()]

c.execute('SELECT COUNT(*) FROM cookies')
total = c.fetchone()[0]

conn.close()

print(f'Cookie DB: {db_path}')
print(f'Total cookies: {total}')
print(f'Auth cookies found: {len(found)}/{len(auth_names)}')
print(f'  Present: {found}')
missing = [n for n in auth_names if n not in found]
if missing:
    print(f'  Missing: {missing}')

if len(found) >= 4:
    print()
    print('✅ Login looks GOOD — enough auth cookies present')
else:
    print()
    print('❌ Login INCOMPLETE — missing critical auth cookies')
    print('   Please re-login via noVNC')
"
