#!/bin/bash
echo "Starting VPS Agent..."
echo "Press Ctrl+C to stop."
echo
cd "$(dirname "$0")"
node server.js
