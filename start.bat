@echo off
chcp 65001 >nul
setlocal

set ROOT=%~dp0
set PORT=3000
set APP_URL=http://localhost:%PORT%

:restart
title Copa Odds - Watchdog (auto-restart)

echo.
echo ====================================================
echo   Copa Odds - Iniciando com watchdog
echo   Auto-restart ativo: se algo cair, reinicia sozinho
echo ====================================================
echo.

:: 1) Mata processos antigos do Next e do proxy Python (porta 54545 / 3000)
echo [START] Limpando processos anteriores...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :54545 ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>&1
)
taskkill /F /IM python.exe >nul 2>&1
echo [START] Limpeza concluida.
echo.

:: 2) Inicia o watchdog (monitora Python + Next.js, reinicia se cair)
::    Usa /B para rodar na MESMA janela (sem abrir 2º cmd)
::    IMPORTANTE: manter o título "CopaOdds-Watchdog" para o taskkill /FI funcionar
echo [START] Iniciando watchdog...
start "CopaOdds-Watchdog" /B /D "%ROOT%" cmd /c "node scripts/watchdog.mjs"

:: 3) Aguarda o Next.js ficar pronto (polling na porta)
::    NOTA: usa !tries! (delayed expansion) dentro do loop para evitar
::    o bug de expansao em tempo de parse do bloco if ( ).
echo [START] Aguardando o Next.js em %APP_URL% ...
setlocal enabledelayedexpansion
set /a tries=0
:waitloop
timeout /t 3 >nul
set /a tries+=1
netstat -ano | findstr :%PORT% | findstr LISTENING >nul 2>&1
if not errorlevel 1 goto server_ready
if !tries! lss 30 goto waitloop
echo [START] Aviso: tempo esgotado aguardando o servidor.
:server_ready

:: 4) Abre a pagina no navegador
echo [START] Abrindo %APP_URL% no navegador...
start "" "%APP_URL%"

echo.
echo ====================================================
echo   Pronto!
echo.
echo   O watchdog monitora os servidores e reinicia
echo   automaticamente se algum deles cair.
echo.
echo   Para encerrar: feche a janela "CopaOdds-Watchdog"
echo   ou pressione Ctrl+C nela.
echo ====================================================
echo.
echo [START] Watchdog em execucao. Monitorando porta %PORT%...

:: 5) Monitora a porta 3000. Se cair, reinicia o watchdog.
:watch_loop
timeout /t 10 >nul
netstat -ano | findstr :%PORT% | findstr LISTENING >nul 2>&1
if not errorlevel 1 goto watch_loop

echo [START] Servidor caiu! Reiniciando watchdog em 3s...
timeout /t 3 >nul

:: Mata a janela do watchdog pelo título (mais robusto que tasklist /v)
taskkill /FI "WINDOWTITLE eq CopaOdds-Watchdog" /F >nul 2>&1

goto restart

endlocal
