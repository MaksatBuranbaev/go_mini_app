#!/usr/bin/env bash
# Все сквозные прогоны подряд. Требует поднятых комнаты, статики и браузера —
# см. README. Прогон на выгрузку сюда не входит: он убивает воркер.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

failed=0
for test in protocol endgame rules sgf watch finish sync skew archive watch-ui polish lobby; do
  echo
  echo "=== $test ==="
  if ! node "$test.mjs"; then
    failed=$((failed + 1))
  fi
done

echo
if [ "$failed" -eq 0 ]; then
  echo "ВСЕ ПРОГОНЫ ЗЕЛЁНЫЕ"
else
  echo "ПРОГОНОВ С ПРОВАЛАМИ: $failed"
fi
exit "$failed"
