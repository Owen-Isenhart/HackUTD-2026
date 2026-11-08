#!/usr/bin/env bash
# Stops the dev services started by dev_up.sh (agent, calls API, dummy recommendation service).
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { (\$_.CommandLine -like '*-m src.agent*' -or \$_.CommandLine -like '*src.main:app*' -or \$_.CommandLine -like '*app:app --port 9000*') -and \$_.Name -match 'python|uv|nohup' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" 2>/dev/null
echo "dev services stopped"
