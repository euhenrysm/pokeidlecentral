# Segurança

## Como reportar uma falha

Se você encontrou uma falha de segurança, **não abra uma issue pública**. Reporte em privado pela aba **Security** do repositório, com a opção **Report a vulnerability** (relatório privado do GitHub). Assim a correção pode sair antes da divulgação.

Na mensagem, descreva:

- o que a falha permite (por exemplo, vazar cookies, executar código, pular o login);
- os passos para reproduzir;
- a versão do app e o sistema operacional (Windows ou Linux).

## Não envie dados de conta

Não envie no relatório senhas, cookies, tokens, `config.json`, `credenciais.json` nem logs com dados de conta. Se a prova de conceito precisar de algo assim, use dados fictícios ou descreva o caminho sem os valores reais.

## Versões com correção

Só a versão mais recente recebe correções de segurança. Atualize pelas Releases do repositório.

## Escopo

O app roda no computador do usuário e fala com pokeidle.io, twitch.tv, kick.com, raw.githubusercontent.com e GitHub Releases. Falhas no próprio jogo ou nos sites de terceiros devem ser reportadas aos respectivos donos.
