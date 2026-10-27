#!/usr/bin/env bash
# Prepara a extensão "PokeIdle Central - Autorizar sessão" (login pelo Chrome/Chromium/Brave/Edge/Vivaldi).
# Nenhum navegador deixa um programa instalar extensão sozinho: este script abre a página e o último passo é seu.
AQUI="$(dirname "$(readlink -f "$0")")"
EXT="$AQUI/extensao-chrome"
[ -f "$EXT/manifest.json" ] || EXT="$AQUI/../extensao-chrome"
[ -f "$EXT/manifest.json" ] || { echo 'Não achei a pasta "extensao-chrome".'; exit 1; }
EXT="$(readlink -f "$EXT")"

NOMES=(); CMDS=(); PAGS=()
achar() { # nome pagina cmd1 cmd2 ...
  local nome="$1" pag="$2"; shift 2
  for c in "$@"; do if command -v "$c" >/dev/null 2>&1; then NOMES+=("$nome"); CMDS+=("$c"); PAGS+=("$pag"); return; fi; done
}
achar "Google Chrome" "chrome://extensions" google-chrome-stable google-chrome
achar "Chromium" "chrome://extensions" chromium chromium-browser
achar "Microsoft Edge" "edge://extensions" microsoft-edge-stable microsoft-edge
achar "Brave" "brave://extensions" brave-browser brave
achar "Vivaldi" "vivaldi://extensions" vivaldi-stable vivaldi
achar "Opera" "opera://extensions" opera
[ ${#NOMES[@]} -gt 0 ] || { echo "Não achei nenhum navegador compatível."; exit 1; }

echo; echo " Em qual navegador instalar a extensão?"; echo
for i in "${!NOMES[@]}"; do echo "   $((i+1)). ${NOMES[$i]}"; done
echo; read -r -p " Digite o número e aperte Enter: " ESC
IDX=$((ESC-1))
[ -n "${NOMES[$IDX]}" ] || { echo "Opção inválida."; exit 1; }

# copia o caminho, se houver ferramenta de área de transferência
if command -v wl-copy >/dev/null 2>&1; then printf %s "$EXT" | wl-copy
elif command -v xclip >/dev/null 2>&1; then printf %s "$EXT" | xclip -selection clipboard
elif command -v xsel >/dev/null 2>&1; then printf %s "$EXT" | xsel -ib; fi
xdg-open "$EXT" >/dev/null 2>&1 &
nohup "${CMDS[$IDX]}" "${PAGS[$IDX]}" >/dev/null 2>&1 &

cat <<MSG

 ==============================================================
  Instalar a extensão do PokeIdle Central no ${NOMES[$IDX]}
 ==============================================================
  A página de extensões foi aberta (${PAGS[$IDX]}). Agora:
   1. Ligue o "Modo do desenvolvedor" (canto da página).
   2. Clique em "Carregar sem compactação" (o PRIMEIRO botão).
   3. Escolha esta pasta:

      $EXT

  Pronto: aparece o card "PokeIdle Central - Autorizar sessão".
  Com mais de um perfil, faça isso na janela de cada perfil usado.
MSG
