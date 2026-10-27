#!/usr/bin/env bash
# Abre o PokeIdle Central pelo código-fonte. Na primeira vez instala o que falta.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
if [ ! -f node_modules/electron/package.json ] || [ ! -f node_modules/qrcode-generator/package.json ]; then
  echo "Instalando o app pela primeira vez, aguarde..."
  npm install || { echo "Falhou o npm install (precisa de Node 18+ e internet)."; exit 1; }
fi
# O npm novo bloqueia scripts de instalação: o do Electron é o que baixa o binário. Se faltou, baixa aqui.
if [ ! -f node_modules/electron/path.txt ]; then
  echo "Baixando o Electron, aguarde..."
  node node_modules/electron/install.js || { echo "Não deu para baixar o Electron."; exit 1; }
fi
ARGS=()
# Ubuntu 24.04+ e outras distros bloqueiam o sandbox do Chromium para quem não é root.
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] || [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = "0" ]; then
  echo "Sandbox do sistema bloqueado: abrindo com --no-sandbox."
  ARGS+=(--no-sandbox)
fi
exec node_modules/.bin/electron . "${ARGS[@]}" "$@"
