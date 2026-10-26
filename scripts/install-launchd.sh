#!/bin/zsh
# Run scripts/update.sh every day at 07:30 local time (when the Mac is awake).
# Remove with: launchctl unload ~/Library/LaunchAgents/com.unfarm.update.plist && rm ~/Library/LaunchAgents/com.unfarm.update.plist
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.unfarm.update.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.unfarm.update</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$DIR/scripts/update.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardErrorPath</key><string>$DIR/crawler/raw/launchd.err</string>
  <key>StandardOutPath</key><string>$DIR/crawler/raw/launchd.out</string>
</dict>
</plist>
EOF
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "installed $PLIST"
