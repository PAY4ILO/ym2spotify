#!/usr/bin/env sh
# Запуск на macOS и Linux. Windows — файл «Запустить.cmd».
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js не найден. Установи его с https://nodejs.org (версия LTS) и запусти снова."
  echo
  exit 1
fi

exec node scripts/start.mjs
