@echo off
REM 给 Windows 上不想开 Git Bash 的人手动跑一次。
REM 与 install-hooks.sh 等价：把本克隆的 core.hooksPath 指向 tools/githooks。
REM
REM 注意：git 钩子本身不能是 .cmd —— git 找的是名为 commit-msg（无扩展名）的
REM 文件，在 Windows 上也用自带的 sh 执行它。能配 .cmd 的只有这个手动安装动作。
setlocal
for /f "delims=" %%i in ('git rev-parse --show-toplevel 2^>nul') do set ROOT=%%i
if "%ROOT%"=="" (
  echo [X] 不在 git 仓库里。
  exit /b 1
)
cd /d "%ROOT%"
if not exist "tools\githooks" (
  echo [X] 找不到 tools\githooks，这不像是本仓库。
  exit /b 1
)
git config core.hooksPath tools/githooks
echo [OK] 已装上 git 钩子（core.hooksPath -^> tools/githooks）。
echo      规则见 CLAUDE.md 与 AGENTS.md。
endlocal
