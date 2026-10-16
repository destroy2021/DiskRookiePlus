@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
rem ============================================================
rem  DiskRookie - release build (Windows x86_64)
rem  Builds frontend + Tauri app and copies installers into
rem  release-artifacts\ named like the GitHub Actions release.
rem
rem  Usage:
rem    scripts\build-release.bat              ^<- MSI + NSIS installers
rem    scripts\build-release.bat --no-bundle  ^<- bare .exe only
rem ============================================================

cd /d "%~dp0.."
set "ROOT=%CD%"
set "DESKTOP=%ROOT%\apps\desktop"
set "TARGET=x86_64-pc-windows-msvc"
set "BUNDLE=%ROOT%\target\%TARGET%\release\bundle"
set "ARGS=%*"
if "%ARGS%"=="" set "ARGS=--target %TARGET%"

where node >nul 2>&1 || (echo [ERROR] Node.js not found. Install Node.js 20+ and retry. & pause & exit /b 1)
where cargo >nul 2>&1 || (echo [ERROR] Cargo not found. Install Rust 1.86+ and retry. & pause & exit /b 1)
if not exist "%DESKTOP%\node_modules" (
    echo [DiskRookie] Installing Tauri CLI dependencies...
    call npm --prefix "%DESKTOP%" install || (echo [ERROR] npm install failed. & pause & exit /b 1)
)
if not exist "%DESKTOP%\frontend\node_modules" (
    echo [DiskRookie] Installing frontend dependencies...
    call npm --prefix "%DESKTOP%\frontend" install || (echo [ERROR] frontend npm install failed. & pause & exit /b 1)
)

rem Version comes from tauri.conf.json, the single source of truth the CI also uses.
rem Parsed with node (UTF-8 safe); Windows PowerShell would mangle the non-ASCII fields.
for /f "usebackq delims=" %%v in (`node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version"`) do set "VERSION=%%v"
if "%VERSION%"=="" (echo [ERROR] Could not read version from tauri.conf.json. & pause & exit /b 1)
echo [DiskRookie] Building DiskRookie v%VERSION% (%ARGS%)

call npm --prefix "%DESKTOP%" run build -- %ARGS%
if errorlevel 1 (echo. & echo [ERROR] Build failed. & pause & exit /b 1)

rem Collect installers, MSI preferred, falling back to the NSIS setup .exe.
set "ARTIFACTS=%ROOT%\release-artifacts"
if exist "%ARTIFACTS%" rmdir /s /q "%ARTIFACTS%"
mkdir "%ARTIFACTS%"
set "FOUND="
for %%f in ("%BUNDLE%\msi\*.msi") do if exist "%%~ff" (copy /y "%%~ff" "%ARTIFACTS%\DiskRookie-Windows-x86_64-v%VERSION%%%~xf" >nul & set "FOUND=1")
for %%f in ("%BUNDLE%\nsis\*.exe") do if exist "%%~ff" (copy /y "%%~ff" "%ARTIFACTS%\DiskRookie-Windows-x86_64-Setup-v%VERSION%%%~xf" >nul & set "FOUND=1")

if not defined FOUND (
    if exist "%ROOT%\target\%TARGET%\release\ai-disk-desktop.exe" (
        echo [DiskRookie] No installer built (--no-bundle). Bare executable:
        echo   %ROOT%\target\%TARGET%\release\ai-disk-desktop.exe
        pause
        exit /b 0
    )
    echo [ERROR] No installer found under %BUNDLE%.
    pause
    exit /b 1
)
echo.
echo [DiskRookie] Done. Artifacts:
dir /b "%ARTIFACTS%"
echo Location: %ARTIFACTS%
pause
