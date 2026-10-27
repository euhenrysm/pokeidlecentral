# Privacidade

O PokéIdle Central guarda tudo no seu computador. Não há servidor do autor do app: não existe conta do PokéIdle Central, cadastro, telemetria nem análise de uso enviada para fora.

## O que fica no seu computador

Pasta de dados:

- **Windows:** `%APPDATA%\pokeidle-central`
- **Linux:** `~/.config/pokeidle-central`

Lá ficam:

- **`config.json`**: configurações da central (nomes das contas, zoom, regras do sniper, reposição de bolas e poções etc.).
- **`credenciais.json`**: usuário e senha salvos por conta. As senhas são **criptografadas pelo sistema** (DPAPI no Windows, chaveiro no Linux) e nunca ficam em texto puro. Sem chaveiro no Linux, o app não salva a senha.
- **Sessões de navegador** (`persist:conta1` a `persist:conta4`): cookies das contas do PokéIdle, da Twitch e da Kick. São o que mantém você logado sem pedir a senha de novo. Esses cookies de login ficam salvos por até 30 dias.
- **Caches**: sprites das espécies, catálogo de itens e espécies, e a lista de itens próprios das contas.
- **Arquivos de diagnóstico**: `telemetria-debug.json` e `lives-debug.json`, com campos do jogo para calibrar o app. Ficam só no seu computador.

Os cookies das contas não saem do computador. A única exceção é a extensão de navegador descrita abaixo, que só envia a sessão para o app quando você autoriza.

## Com quem o app conversa

O app só faz conexões com estes serviços:

| Serviço | Para quê |
| --- | --- |
| `pokeidle.io` | o jogo (abas Jogo, Mercado e Sniper), catálogos públicos de itens e espécies, sprites |
| `www.twitch.tv` e `kick.com` | páginas das lives e das telas de login e vínculo de cada conta |
| `raw.githubusercontent.com` (PokeAPI) | imagens da Pokédex, para o Dashboard |
| GitHub Releases | procurar e baixar atualizações do próprio app |
| `api.github.com` | ler o número total de downloads das Releases, mostrado na aba Config (a cada 6 h; não envia nada sobre você) |
| `fonts.googleapis.com` e `fonts.gstatic.com` | fontes da interface, carregadas do Google |

Nenhum desses serviços recebe a sua configuração, senhas, cookies ou logs do app, além do que o próprio site já recebe quando você entra nele, como faria num navegador.

Conexões locais: a extensão do navegador conversa com o app pelo próprio computador (`127.0.0.1`, portas 47731 a 47735). Nada disso sai da sua máquina. O painel no celular, quando ligado, escuta na rede local (portas 47740 a 47745), só para aparelhos da sua rede.

## Painel no celular

Opcional e desligado por padrão (aba **Config**). Ligado, o app abre uma página na rede Wi-Fi local, com os números das contas: nomes, nível, ouro e gemas, XP/h, abates, capturas, pokémon em campo, estoque de poção e bola, drops raros, e a lista de hunts, time, depósito e mochila de cada conta. Não mostra nem envia senhas, cookies, logins nem ids internos.

O painel também **controla** as contas: troca de hunt, ativa pokémon, põe pokémon no time, usa e descarta itens, vai ao Centro, cura e liga ou desliga sniper e captura. Por isso o QR (ou o código dentro dele) deve ser tratado como uma senha: quem o tiver pode mexer nas suas contas enquanto o painel estiver ligado. Não compartilhe o QR. Não há compra nem venda no mercado pelo celular.

O acesso depende de um código aleatório que muda a cada ligada e em "Gerar novo código" (o código antigo deixa de valer na hora). Ele fica só na memória do app e dentro do QR, e não é gravado em disco. Nada disso vai para a internet: a página só responde a aparelhos da sua rede local.

## Senhas

- O app preenche a senha **só no site do próprio serviço** (pokeidle.io, twitch.tv ou kick.com). Se a página não for desse site, ele não preenche.
- A senha nunca aparece de volta na tela.

## Extensão do navegador

A extensão "PokéIdle Central - Autorizar sessão" tem permissão para ler os cookies de pokeidle.io, twitch.tv e kick.com no navegador onde você a instalou. Ela só envia uma sessão para o app quando você clica em **Autorizar** no aviso dela. A entrega é direta para o seu computador, com um código de uso único que vale 5 minutos. Veja o código em `extensao-chrome/`.

## Suas escolhas

- Para apagar tudo, feche o app e apague a pasta de dados indicada acima. Isso remove logins, senhas salvas e configurações.
- Para tirar a extensão, remova-a em `chrome://extensions` (ou no navegador que você usou).

## Não publique dados pessoais

Ao reportar um problema ou pedir ajuda, **nunca** envie em issues, fóruns ou chats:

- `config.json`, `credenciais.json`
- cookies ou o conteúdo de `persist:conta*`
- logs e arquivos `*-debug.json`
- prints ou textos que mostrem usuário, senha, token ou e-mail

Se precisar mostrar um erro, copie só a mensagem de erro e tire qualquer dado de conta.
