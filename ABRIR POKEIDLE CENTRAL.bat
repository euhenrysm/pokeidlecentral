@echo off
rem Abre o PokeIdle Central sem precisar do PowerShell.
cd /d "%~dp0"
if not exist "node_modules\electron\package.json" (
  echo Instalando o app pela primeira vez, aguarde...
  call npm install
)
rem O npm novo bloqueia scripts de instalacao: o do Electron e o que baixa o electron.exe. Se faltou, baixa aqui.
if not exist "node_modules\electron\dist\electron.exe" (
  echo Baixando o Electron, aguarde...
  node node_modules\electron\install.js
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Nao deu para baixar o Electron. Confira a internet e abra este arquivo de novo.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
