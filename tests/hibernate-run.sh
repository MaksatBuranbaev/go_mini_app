#!/usr/bin/env bash
# Прогон теста на выгрузку комнаты целиком: партия, убийство воркера, проверка.
# Воркер после теста остаётся поднятым — он нужен остальным прогонам.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

kill_worker() {
  powershell.exe -NoProfile -Command "
    Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" |
      Where-Object { \$_.CommandLine -match 'wrangler' } |
      ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-Process -Name workerd -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  " >/dev/null 2>&1 || true
  sleep 2
}

start_worker() {
  (cd "$ROOT" && nohup corepack pnpm --filter @go/room dev >/dev/null 2>&1 &)
  for _ in $(seq 1 60); do
    if curl -s -m 2 http://127.0.0.1:8787/health >/dev/null; then return 0; fi
    sleep 1
  done
  echo "воркер не поднялся" >&2
  exit 1
}

echo "--- партия до выгрузки ---"
ROOM=$(cd "$HERE" && node hibernate.mjs play | sed -n 's/^ROOM=//p')
echo "комната: $ROOM"

echo "--- выгружаем комнату ---"
kill_worker
start_worker

echo "--- после выгрузки ---"
cd "$HERE" && node hibernate.mjs resume "$ROOM"
