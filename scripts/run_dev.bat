@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo    DiskRookie Dev Launcher
echo ========================================
echo.

:: Check Node.js
echo [1/3] Check Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] Node.js not found, please install Node.js 20+
    pause
    exit /b 1
)
echo [OK] Node.js installed
node --version
echo.

:: Check Rust
echo [2/3] Check Rust...
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] Rust/Cargo not found, please install Rust 1.86+
    pause
    exit /b 1
)
echo [OK] Rust installed
rustc --version
echo.

:: Install desktop deps
echo [3/3] Check desktop dependencies...
cd /d "%~dp0..\apps\desktop"
if not exist "node_modules" (
    echo Installing desktop dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [Error] Desktop dependencies install failed
        pause
        exit /b 1
    )
) else (
    echo Desktop dependencies already installed
)
echo.

set "DEV_MODE=%~1"
set "OPT_MODE=%~2"

if /i "%DEV_MODE%"=="tauri-clean" (
    set "DEV_MODE=tauri"
    set "OPT_MODE=clean"
)

if /i "%DEV_MODE%"=="tauri" (
    if /i "%OPT_MODE%"=="clean" (
        set "DISKROOKIE_TARGET_OPT_AGGRESSIVE=1"
        echo [target-opt] Aggressive cleanup enabled for this run
        echo.
    )
    echo ========================================
    echo    Start Full Tauri Dev Mode
    echo    Hint: Rust + Frontend will start
    if /i "%OPT_MODE%"=="clean" (
        echo    Extra: aggressive target/debug cleanup enabled
    )
    echo ========================================
    echo.
    call npm run dev:tauri
) else (
    echo ========================================
    echo    Start Fast Frontend Dev Mode
    echo    Hint: no Rust compile by default
    echo    Run run_dev.bat tauri for full mode
    echo    Run run_dev.bat tauri clean to force cleanup
    echo ========================================
    echo.
    call npm run dev
)

pause
