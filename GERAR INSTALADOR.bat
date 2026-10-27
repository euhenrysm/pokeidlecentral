@echo off
rem Gera o instalador do Windows (dist\PokeIdle-Central-Setup-X.Y.Z.exe) com dois cliques, sem abrir o terminal.
cd /d "%~dp0"
where node >nul 2>nul || (echo Precisa do Node.js instalado: https://nodejs.org & pause & exit /b 1)
if not exist "node_modules\electron\package.json" (
  echo Instalando as dependencias, aguarde...
  call npm install || (echo Falhou o npm install. Confira a internet. & pause & exit /b 1)
)
echo Gerando o instalador, aguarde (alguns minutos na primeira vez)...
call npx electron-builder --win nsis --publish never || (echo Nao deu para gerar o instalador. & pause & exit /b 1)
echo.
echo Pronto! O instalador esta na pasta dist.
start "" explorer "%~dp0dist"
pause
