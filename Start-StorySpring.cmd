@echo off
cd /d "%~dp0"
if exist ".env" set "STORYSPRING_ENV_FILE=%CD%\.env"
node server/index.mjs
pause
