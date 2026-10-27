@echo off
setlocal EnableDelayedExpansion
rem Prepara a instalacao da extensao "PokeIdle Central - Autorizar sessao" no navegador escolhido
rem (Chrome, Edge, Brave, Opera, Opera GX ou Vivaldi). Nenhum navegador deixa um programa instalar
rem extensao sozinho: este arquivo deixa tudo pronto e o ultimo passo (3 cliques) e seu.
cd /d "%~dp0"
set "EXT=%~dp0extensao-chrome"
if not exist "%EXT%\manifest.json" (
  echo Nao achei a pasta "extensao-chrome" ao lado deste arquivo.
  pause
  exit /b 1
)

rem ---------------------------------------------------------------- navegadores instalados
set N=0
call :achar "Google Chrome" "chrome://extensions" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe"
call :achar "Microsoft Edge" "edge://extensions" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
call :achar "Brave" "brave://extensions" "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe" "%LocalAppData%\BraveSoftware\Brave-Browser\Application\brave.exe"
call :achar "Opera" "opera://extensions" "%LocalAppData%\Programs\Opera\opera.exe" "%ProgramFiles%\Opera\opera.exe"
call :achar "Opera GX" "opera://extensions" "%LocalAppData%\Programs\Opera GX\opera.exe"
call :achar "Vivaldi" "vivaldi://extensions" "%LocalAppData%\Vivaldi\Application\vivaldi.exe" "%ProgramFiles%\Vivaldi\Application\vivaldi.exe"

if %N%==0 (
  echo Nao achei nenhum navegador compativel ^(Chrome, Edge, Brave, Opera, Opera GX ou Vivaldi^).
  pause
  exit /b 1
)

echo.
echo  Em qual navegador instalar a extensao?
echo.
for /L %%i in (1,1,%N%) do echo    %%i. !NOME%%i!
echo.
set "ESC="
set /p "ESC= Digite o numero e aperte Enter: "
if not defined NOME%ESC% (
  echo Opcao invalida.
  pause
  exit /b 1
)
set "NOME=!NOME%ESC%!"
set "EXE=!EXE%ESC%!"
set "PAG=!PAG%ESC%!"

rem ---------------------------------------------------------------- prepara tudo
<nul set /p "=%EXT%" | clip
start "" explorer "%EXT%"
start "" "%EXE%" "%PAG%"

cls
echo.
echo  ==============================================================
echo   Instalar a extensao do PokeIdle Central no %NOME%
echo  ==============================================================
echo.
echo   A pagina de extensoes foi aberta (%PAG%). Agora:
echo.
echo   1. Ligue o "Modo do desenvolvedor" (no canto da pagina).
echo   2. Clique em "Carregar sem compactacao" / "Carregar descompactada"
echo      (o PRIMEIRO botao, NAO o "Compactar extensao").
echo   3. Na janela que abrir, cole o caminho (Ctrl+V) na barra de
echo      endereco e escolha a pasta:
echo.
echo      %EXT%
echo.
echo      O caminho ja esta copiado. A pasta tambem foi aberta no Explorer.
echo.
echo   Pronto: aparece o card "PokeIdle Central - Autorizar sessao".
echo   Se voce usa mais de um perfil no navegador, faca isso na janela
echo   de cada perfil que for usar com o "Pelo navegador" do app.
echo.
pause
exit /b 0

rem ---------------------------------------------------------------- :achar nome pagina caminho1 caminho2 ...
:achar
set "ACH_NOME=%~1"
set "ACH_PAG=%~2"
shift
shift
:achar_proximo
if "%~1"=="" exit /b 0
if exist "%~1" (
  set /a N+=1
  set "NOME!N!=%ACH_NOME%"
  set "PAG!N!=%ACH_PAG%"
  set "EXE!N!=%~1"
  exit /b 0
)
shift
goto achar_proximo
