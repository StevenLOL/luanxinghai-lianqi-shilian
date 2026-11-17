@echo off
chcp 65001 >nul
REM 05_launch_game.bat —— 双击即启动本地 fighter 游戏(起 HTTP 服务 + 打开浏览器)
REM 原理见 scripts/05_launch_local_game.py 顶部注释
cd /d "%~dp0.."
python scripts\05_launch_local_game.py
pause
