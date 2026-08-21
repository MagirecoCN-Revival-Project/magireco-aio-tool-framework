@echo off
REM 给 Windows 上不想开 Git Bash 的人手动跑一次。
REM 与 install-hooks.sh 等价：把本克隆的 core.hooksPath 指向 tools/githooks。
REM
REM 注意：git 钩子本身不能是 .cmd —— git 找的是名为 commit-msg（无扩展名）的
REM 文件，在 Windows 上也用自带的 sh 执行它。能配 .cmd 的只有这个手动安装动作。
setlocal

REM 这个文件本身是 UTF-8（里面有中文）。cmd.exe 默认代码页是 936(GBK)，
REM 直接跑会把下面每一行 echo 打成乱码。先切到 65001，跑完切回去——
REM 不切回去的话，这个控制台窗口后面跑别的老工具可能反过来出问题。
for /f "tokens=2 delims=:" %%a in ('chcp') do set "OLDCP=%%a"
set "OLDCP=%OLDCP: =%"
chcp 65001 >nul
for /f "delims=" %%i in ('git rev-parse --show-toplevel 2^>nul') do set ROOT=%%i
if "%ROOT%"=="" (
  echo [X] 不在 git 仓库里。
  goto :fail
)
cd /d "%ROOT%"
if not exist "tools\githooks" (
  echo [X] 找不到 tools\githooks，这不像是本仓库。
  goto :fail
)
git config core.hooksPath tools/githooks
REM 关掉路径转义：本仓库的 ADR 文件名是中文，默认设置下 git 会把它们打成
REM 八进制转义（\350\207\252…），看起来像编码坏了。与 hooksPath 一样是本地配置。
git config core.quotepath false
echo [OK] 已装上 git 钩子（core.hooksPath -^> tools/githooks）。
echo [OK] 已关掉 core.quotepath（中文文件名不再显示成八进制转义）。
echo      规则见 CLAUDE.md 与 AGENTS.md。
if defined OLDCP chcp %OLDCP% >nul
endlocal
exit /b 0

:fail
if defined OLDCP chcp %OLDCP% >nul
endlocal
exit /b 1
