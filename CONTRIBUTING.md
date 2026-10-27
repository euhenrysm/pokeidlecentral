# Como contribuir

Obrigado pelo interesse. Contribuições são bem-vindas: correções, melhorias, documentação e testes em Linux e Windows.

## Rodar o projeto

Precisa de [Node.js](https://nodejs.org/) (LTS) e internet na primeira vez.

    npm install
    npm start

No Windows, dê dois cliques em `ABRIR POKEIDLE CENTRAL.bat`. No Linux, use `./ABRIR.sh`.

Antes de enviar uma mudança, rode a checagem de sintaxe:

    npm run check

## Testes

Os testes usam só o executor nativo do Node (`node:test`), sem dependências, e ficam em `test/`:

    npm test

Eles rodam o motor do jogo (`src/preload-game.js`) num mundo falso, sem Electron, sem navegador e sem internet. O harness em `test/harness/motor.js` tira o `function motor()` do arquivo e o executa com WebSocket, fetch e relógio de mentira; o teste controla o tempo (`avancar`), manda pacotes do servidor e comandos da central, e confere o que o motor enviou. Quando um teste mostrar um comportamento que parece bug, ele vem marcado com `ATENÇÃO:` e descreve o que o código faz hoje; ao corrigir o motor, inverta a expectativa desse teste.

O `npm run check` roda a checagem de sintaxe e, no fim, os testes. O padrão `test/*.test.js` é o que o Node 22 aceita (`node --test test/` não funciona nele).

## Estilo

- **JavaScript puro**, sem build step, sem TypeScript e sem frameworks de interface. O código roda como está.
- **Comentários em português**, curtos, explicando o porquê quando não for óbvio.
- **Commits pequenos**, cada um com uma mudança só, e mensagem clara em português descrevendo o que mudou e por quê.
- Mantenha Windows e Linux funcionando. Se mexer em caminhos, processos ou instaladores, teste nos dois ou diga no pedido que não testou.

## Não adicione ao repositório

- **Arte, sprites ou imagens do jogo** (PokéIdle ou Pokémon). Os sprites são baixados pelo app na hora de usar.
- **Dados pessoais e de conta**: `config.json`, `credenciais.json`, cookies, logs, prints com usuário ou senha.
- **Arquivos gerados**: `node_modules/`, `dist/`, instaladores (`.exe`, `.AppImage`, `.deb`) e `.zip`.

## Antes de abrir um pull request

1. Rode `npm run check` e confirme que passa.
2. Descreva o que mudou e como testou.
3. Se a mudança toca o login de contas, as sessões ou o envio de dados, diga isso explicitamente.

## Licença

Ao contribuir, você concorda que sua contribuição fica sob a mesma licença do projeto, a [GPL-3.0-only](LICENSE).

## Falhas de segurança

Não abra issue pública para falhas de segurança. Veja [SECURITY.md](SECURITY.md).
