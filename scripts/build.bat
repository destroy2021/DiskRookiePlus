@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo    DiskRookie 构建脚本
echo ========================================
echo.

:: 检查 Node.js
echo [1/4] 检查 Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 20+
    pause
    exit /b 1
)
echo [成功] Node.js 已安装: 
node --version
echo.

:: 检查 Rust
echo [2/4] 检查 Rust...
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Rust/Cargo，请先安装 Rust 1.86+
    pause
    exit /b 1
)
echo [成功] Rust 已安装:
rustc --version
echo.

:: 安装前端依赖
echo [3/4] 安装前端依赖...
cd /d "%~dp0..\apps\desktop"
if not exist "node_modules" (
    echo 正在安装前端依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 前端依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo 前端依赖已存在，跳过安装
)
echo.

:: 构建应用
echo [4/4] 开始构建应用...
echo 正在执行 Tauri build...
call npx tauri build --target x86_64-pc-windows-msvc
if %errorlevel% neq 0 (
    echo [错误] 构建失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo    构建完成！
echo    输出目录: target\x86_64-pc-windows-msvc\release\bundle
echo ========================================
pause