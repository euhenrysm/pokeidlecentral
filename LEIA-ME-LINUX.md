# PokéIdle Central: versão Linux

App com as 4 contas do PokéIdle lado a lado, sniper do Mercado, captura e painel de lives. As funções são as mesmas do Windows.

## Rodar pelo código
Precisa de [Node.js](https://nodejs.org/) (LTS) e internet na primeira vez.

    ./ABRIR.sh

Na primeira vez instala as dependências. Se o sandbox do sistema estiver bloqueado (Ubuntu 24.04+), o script abre com `--no-sandbox` sozinho.

## Gerar o instalador (AppImage e .deb)

    npm install
    npm run instalador:linux

Os arquivos saem em `dist/`: `PokeIdle-Central-<versão>-linux.AppImage` e `.deb`.
AppImage: `chmod +x` e abrir. Se não abrir no Ubuntu 24.04+, rode com `--no-sandbox`.

## Dados e logins
- Tudo fica em `~/.config/pokeidle-central`.
- **Salvar senha** na aba Config precisa de um chaveiro (GNOME Keyring ou KWallet). Sem ele o app recusa salvar. Sem senha salva funciona: faça o login à mão uma vez.
- **Login pelo Google ("Pelo navegador")**: rode `./INSTALAR-EXTENSAO.sh` uma vez (Chrome, Chromium, Edge, Brave, Vivaldi, Opera).

## Atualização
Baixe a versão nova na página de Releases e instale por cima. Os dados ficam na mesma pasta, então logins e regras continuam.

## Problemas comuns
- **Janela com fundo preto nos cantos:** sem compositor, abra com `POKEIDLE_OPACO=1 ./ABRIR.sh`.
- **Só uma cópia aberta:** duas cópias brigam pela mesma pasta de dados; o app já bloqueia a segunda.
- **Falhou o login do jogo (Cloudflare):** tente de novo; se persistir, faça o login pelo navegador (extensão).
