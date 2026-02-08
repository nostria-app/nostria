@echo off
REM Wrapper to launch the PowerShell loop script.
REM The actual logic is in loop.ps1.
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0loop.ps1" %*
