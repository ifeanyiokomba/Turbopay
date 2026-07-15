#!/bin/bash
cd /home/z/my-project
while true; do
  if ! pgrep -f "next dev -p 3000" > /dev/null 2>&1; then
    echo "[$(date)] Starting dev server..." >> /home/z/my-project/dev-watchdog.log
    cd /home/z/my-project && nohup bun run dev > /home/z/my-project/dev.log 2>&1 &
    sleep 10
  fi
  sleep 5
done
