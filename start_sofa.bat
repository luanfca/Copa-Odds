@echo off
cd /d "C:\Users\LuanADM\Desktop\Projetos\Odds ao vivo"
echo Killing old Python processes...
taskkill /f /im python.exe 2>nul
timeout /t 3 /nobreak >nul
echo Starting SofaScore server...
start /B python scripts\sofascore_server.py
echo Server started on port 54545
