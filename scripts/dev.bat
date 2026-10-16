@echo off
setlocal
chcp 65001 >nul
rem ============================================================
rem  DiskRookie - one-click dev launcher (Windows)
rem  Installs deps if needed, then runs the Tauri dev app
rem  (Rust backend + Vite dev server with hot reload).
rem ============================================================

cd /d "%~dp0.."
set "ROOT=%CD%"
set "DESKTOP=%ROOT%\apps\desktop"
set "FRONTEND=%DESKTOP%\frontend"

echo [DiskRookie] Root: %ROOT%

where node >nul 2>&1 || (echo [ERROR] Node.js not found. Install Node.js 20+ and retry. & pause & exit /b 1)
where cargo >nul 2>&1 || (echo [ERROR] Cargo not found. Install Rust 1.86+ and retry. & pause & exit /b 1)

if not exist "%DESKTOP%\node_modules" (
    echo [DiskRookie] Installing Tauri CLI dependencies...
    call npm --prefix "%DESKTOP%" install || (echo [ERROR] npm install failed. & pause & exit /b 1)
)
if not exist "%FRONTEND%\node_modules" (
    echo [DiskRookie] Installing frontend dependencies...
    call npm --prefix "%FRONTEND%" install || (echo [ERROR] frontend npm install failed. & pause & exit /b 1)
)

if not exist "%ROOT%\.env" (
    echo [DiskRookie] No .env found - OAuth logins stay disabled. Copy .env.example to .env to enable them.
)

rem The app manifest requests administrator (src-tauri\build.rs uses
rem requireAdministrator), so cargo run fails with "os error 740" unless this
rem console is elevated. Relaunch elevated instead of failing confusingly.
fltmc >nul 2>&1
if errorlevel 1 (
    echo [DiskRookie] Administrator rights are required to launch the app.
    echo [DiskRookie] Relaunching this script elevated ^(accept the UAC prompt^)...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)

echo [DiskRookie] Starting tauri dev...
call npm --prefix "%DESKTOP%" run dev
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
    echo.
    echo [ERROR] tauri dev exited with code %CODE%.
    pause
)
exit /b %CODE%
