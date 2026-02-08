@echo off
setlocal

:: Usage: close_issue.bat ISSUE_NUMBER
:: Example: close_issue.bat 388

set REPO=nostria-app/nostria
set ISSUE=%1

if "%ISSUE%"=="" (
  echo You must provide an issue number.
  exit /b 1
)

curl -X PATCH ^
  -H "Authorization: Bearer %GITHUB_TOKEN%" ^
  -H "Accept: application/vnd.github+json" ^
  -H "Content-Type: application/json" ^
  https://api.github.com/repos/%REPO%/issues/%ISSUE% ^
  -d "{\"state\":\"closed\"}"

endlocal
