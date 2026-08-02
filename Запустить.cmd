@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js не найден.
  echo   Установи его с https://nodejs.org — выбери версию LTS,
  echo   затем запусти этот файл снова.
  echo.
  pause
  exit /b 1
)

node scripts\start.mjs
if errorlevel 1 pause
