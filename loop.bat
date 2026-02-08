@echo off
echo Ralphy GitHub issue watcher started.
echo Polling every 60 seconds for issues labeled "ready"...
echo Press Ctrl+C to stop.
echo.

:loop
echo [%date% %time%] Running ralphy...
ralphy --opencode --model github-copilot/claude-opus-4.6 --github nostria-app/nostria --github-label "ready"
echo [%date% %time%] Ralphy finished. Waiting 60 seconds...
timeout /t 60 /nobreak >nul
goto loop
