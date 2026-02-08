@echo off
setlocal enabledelayedexpansion

echo Ralphy GitHub issue watcher started.
echo Polling every 60 seconds for issues labeled "ready"...
echo After 60 minutes idle, will run codebase improvements.
echo Press Ctrl+C to stop.
echo.

set IDLE_COUNT=0
set IDLE_THRESHOLD=60
set MODEL=github-copilot/claude-opus-4.6
set REPO=nostria-app/nostria
set LABEL=ready

:loop
echo [%date% %time%] Checking for issues labeled "%LABEL%"...

REM Check for pending GitHub issues using helper script
set TASK_COUNT=0
for /f %%n in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-issues.ps1" -Model "%MODEL%" -Repo "%REPO%" -Label "%LABEL%"') do set TASK_COUNT=%%n

if !TASK_COUNT! GTR 0 (
  echo [%date% %time%] Found !TASK_COUNT! issue^(s^). Running ralphy...
  set IDLE_COUNT=0
  ralphy --opencode --model %MODEL% --github %REPO% --github-label "%LABEL%"
  echo [%date% %time%] Ralphy finished. Waiting 60 seconds...
) else (
  set /a IDLE_COUNT+=1
  echo [%date% %time%] No issues found. Idle count: !IDLE_COUNT!/%IDLE_THRESHOLD%

  if !IDLE_COUNT! GEQ %IDLE_THRESHOLD% (
    echo.
    echo ============================================================
    echo [%date% %time%] Idle for %IDLE_THRESHOLD% minutes. Running codebase improvements...
    echo ============================================================
    echo.
    ralphy --opencode --model %MODEL% --prd IMPROVEMENTS.md --max-iterations 1
    echo [%date% %time%] Improvement task finished.
    set IDLE_COUNT=0
    echo [%date% %time%] Waiting 60 seconds before resuming poll...
  ) else (
    echo [%date% %time%] Waiting 60 seconds...
  )
)

timeout /t 60 /nobreak >nul
goto loop
