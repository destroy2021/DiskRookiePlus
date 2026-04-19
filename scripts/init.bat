@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo    DiskRookie 项目环境初始化
echo ========================================
echo    提示: 直接按回车 = 跳过 (默认N)
echo ========================================
echo.

setlocal enabledelayedexpansion

:: 默认选项为 N
set "DEFAULT=N"

:: ============================================
:: [1/6] 检查 Rust 环境
:: ============================================
echo [1/6] 检查 Rust 环境...
where rustup >nul 2>&1
if %errorlevel% neq 0 (
    echo [提示] 未检测到 Rust。
    set /p install_rust="是否自动安装 Rust? (Y/N): "
    if /i "!install_rust!"=="Y" (
        echo 正在安装 rustup...
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
        if !errorlevel! neq 0 (
            echo [错误] Rust 安装失败，请手动安装
            pause
            exit /b 1
        )
        call rustup default stable
    ) else (
        echo [跳过] Rust 安装，请手动安装后继续
        pause
        exit /b 1
    )
)
echo [成功] Rust 已安装:
rustc --version
cargo --version
echo.

:: ============================================
:: [2/6] 更新 Rust 工具链
:: ============================================
echo [2/6] 检查 Rust 工具链更新...
set "update_rust="
set /p "update_rust=是否更新 Rust 工具链? [N] (Y/N): "
if /i "!update_rust!"=="Y" (
    echo 正在更新 Rust 工具链...
    call rustup update stable
    call rustup target add x86_64-pc-windows-msvc
) else (
    echo [跳过] Rust 工具链更新
)
echo.

:: ============================================
:: [3/6] 检查 Tauri CLI
:: ============================================
echo [3/6] 检查 Tauri CLI...
where cargo-tauri >nul 2>&1
if %errorlevel% neq 0 (
    echo [提示] 未检测到 Tauri CLI。
    set "install_tauri="
    set /p "install_tauri=是否安装 Tauri CLI? [N] (Y/N): "
    if /i "!install_tauri!"=="Y" (
        echo 正在安装 Tauri CLI...
        call cargo install tauri-cli --locked
        if !errorlevel! neq 0 (
            echo [错误] Tauri CLI 安装失败
            pause
            exit /b 1
        )
    ) else (
        echo [跳过] Tauri CLI 安装
    )
) else (
    echo Tauri CLI 已安装。
    set "update_tauri="
    set /p "update_tauri=是否更新 Tauri CLI? [N] (Y/N): "
    if /i "!update_tauri!"=="Y" (
        echo 正在更新 Tauri CLI...
        call cargo install tauri-cli --locked
    ) else (
        echo [跳过] Tauri CLI 更新
    )
)
echo.

:: ============================================
:: [4/6] 检查 Node.js
:: ============================================
echo [4/6] 检查 Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 20+
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)
echo [成功] Node.js 已安装:
node --version
npm --version
echo.

:: ============================================
:: [5/6] 初始化前端环境
:: ============================================
echo [5/6] 初始化前端环境...
cd /d "%~dp0..\apps\desktop\frontend"
if %errorlevel% neq 0 (
    echo [错误] 无法进入前端目录
    pause
    exit /b 1
)

:: 使用 npm ci 安装前端依赖（CLEAN INSTALL，适合发布构建）
if exist "node_modules" (
    set "clean_deps="
    set /p "clean_deps=node_modules 已存在，是否重新安装 (npm ci)? [N] (Y/N): "
    if /i "!clean_deps!"=="Y" (
        echo 正在清理并重新安装前端依赖 (npm ci)...
        call npm ci
        if !errorlevel! neq 0 (
            echo [错误] 前端依赖安装失败，尝试使用 npm install...
            call npm install
            if !errorlevel! neq 0 (
                echo [错误] 前端依赖安装失败
                pause
                exit /b 1
            )
        )
    ) else (
        echo [跳过] 前端依赖重新安装
    )
) else (
    echo 正在安装前端依赖 (npm ci)...
    call npm ci
    if !errorlevel! neq 0 (
        echo [错误] npm ci 失败，尝试使用 npm install...
        call npm install
        if !errorlevel! neq 0 (
            echo [错误] 前端依赖安装失败
            pause
            exit /b 1
        )
    )
)
echo.

:: 构建前端
set "build_frontend="
set /p "build_frontend=是否构建前端 (npm run build)? [N] (Y/N): "
if /i "!build_frontend!"=="Y" (
    echo 正在构建前端...
    call npm run build
    if !errorlevel! neq 0 (
        echo [错误] 前端构建失败
        pause
        exit /b 1
    )
    echo [成功] 前端构建完成
) else (
    echo [跳过] 前端构建
)
echo.

:: 安装 Tauri 应用层依赖
echo 正在安装 Tauri 应用层依赖...
cd /d "%~dp0..\apps\desktop"
if %errorlevel% neq 0 (
    echo [错误] 无法进入 Tauri 应用目录
    pause
    exit /b 1
)
call npm install
if !errorlevel! neq 0 (
    echo [错误] Tauri 应用层依赖安装失败
    pause
    exit /b 1
)
echo [成功] Tauri 应用层依赖已安装
echo.

:: ============================================
:: [6/6] 安装 VS Code 推荐插件
:: ============================================
echo [6/6] 检查 VS Code 插件...
where code >nul 2>&1
if %errorlevel% equ 0 (
    set "install_plugins="
    set /p "install_plugins=是否安装/更新 VS Code 推荐插件? [N] (Y/N): "
    if /i "!install_plugins!"=="Y" (
        echo 正在安装推荐插件...
        call code --install-extension rust-lang.rust-analyzer
        call code --install-extension vadimcn.vscode-lldb
        call code --install-extension bradlc.vscode-tailwindcss
    ) else (
        echo [跳过] VS Code 插件安装
    )
) else (
    echo [提示] 未检测到 VS Code，跳过插件安装
)
echo.

:: ============================================
:: 复制环境变量文件
:: ============================================
echo [完成] 检查环境变量配置...
cd /d "%~dp0.."
if %errorlevel% neq 0 (
    echo [错误] 无法返回项目根目录
    pause
    exit /b 1
)
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env"
        echo [提示] 已从 .env.example 创建 .env 文件，请编辑填入你的 OAuth 密钥
    )
) else (
    echo [成功] .env 文件已存在
)
echo.

echo ========================================
echo    环境初始化完成！
echo    现在可以运行 run_dev.bat 开始开发
echo ========================================
pause
