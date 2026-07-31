@echo off
rem QingJian Markdown Reader launcher
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
  start "QingJian" python server.py %*
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "QingJian" py server.py %*
  goto :done
)

echo Python not found. Please install Python 3.9+ first: https://www.python.org/downloads/
pause
:done
