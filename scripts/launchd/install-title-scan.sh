#!/bin/bash
# Install the Real Estate OS title-scan as a macOS LaunchAgent.
# Runs every 30 min while your Mac is awake, scans the last 2 days of
# Gmail for new title-company emails, auto-dispositions what it can
# match, and queues the rest into /transactions "Needs review".
#
# Usage:
#   ./scripts/launchd/install-title-scan.sh
#
# Uninstall:
#   launchctl unload ~/Library/LaunchAgents/com.reos.title-scan.plist
#   rm ~/Library/LaunchAgents/com.reos.title-scan.plist

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
TEMPLATE="$SCRIPT_DIR/com.reos.title-scan.plist.template"
TARGET="$HOME/Library/LaunchAgents/com.reos.title-scan.plist"

if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo "ERROR: $PROJECT_ROOT/.env not found"
    exit 1
fi

SECRET=$(grep '^SCAN_SCHEDULE_SECRET=' "$PROJECT_ROOT/.env" | sed 's/^SCAN_SCHEDULE_SECRET=//; s/^"//; s/"$//' || true)
if [ -z "$SECRET" ]; then
    echo "ERROR: SCAN_SCHEDULE_SECRET is not set in .env"
    echo "Run:  openssl rand -hex 32   and add as SCAN_SCHEDULE_SECRET=<value>"
    exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$HOME/Library/Logs"

# Render template
sed -e "s|__SCAN_SECRET__|$SECRET|g" \
    -e "s|__USER__|$USER|g" \
    "$TEMPLATE" > "$TARGET"

chmod 600 "$TARGET"

# Reload if already installed
if launchctl list | grep -q com.reos.title-scan; then
    echo "Reloading existing LaunchAgent..."
    launchctl unload "$TARGET" 2>/dev/null || true
fi

launchctl load "$TARGET"

echo "✓ Installed LaunchAgent: com.reos.title-scan"
echo "  Runs every 30 min while the Mac is awake"
echo "  Logs: ~/Library/Logs/reos-title-scan.log"
echo ""
echo "To see next fire:   launchctl list com.reos.title-scan"
echo "To tail logs:       tail -f ~/Library/Logs/reos-title-scan.log"
echo "To stop:            launchctl unload $TARGET"
