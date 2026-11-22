@echo off
title Cara de Leao - Projecao
cd /d "%~dp0"
echo.
echo   Iniciando o Cara de Leao - Projecao...
echo   Deixe esta janela aberta durante o culto (pode minimizar).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ponte\ponte.ps1"
echo.
pause
