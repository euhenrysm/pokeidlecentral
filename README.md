<div align="center">

# PokéIdle Central

**As 4 contas do PokéIdle lado a lado, com sniper do mercado, captura, hunts, lives e painel no celular.**
Para Windows e Linux. Grátis e de código aberto.

[![Versão](https://img.shields.io/github/v/release/euhenrysm/pokeidlecentral?label=vers%C3%A3o&color=d4f55a&labelColor=18191b)](https://github.com/euhenrysm/pokeidlecentral/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/euhenrysm/pokeidlecentral/total?label=downloads&color=8fe36b&labelColor=18191b)](https://github.com/euhenrysm/pokeidlecentral/releases)
[![Licença](https://img.shields.io/badge/licen%C3%A7a-GPL--3.0-ffb547?labelColor=18191b)](LICENSE)
[![Plataformas](https://img.shields.io/badge/Windows%20%7C%20Linux-3d3e44?labelColor=18191b)](#instala%C3%A7%C3%A3o)

[**⬇ Baixar a última versão**](https://github.com/euhenrysm/pokeidlecentral/releases/latest)

</div>

> **Projeto independente e não oficial.** Este app não é afiliado, patrocinado nem aprovado pelo PokéIdle, pela Nintendo ou pela The Pokémon Company. Pokémon e os nomes relacionados são marcas dos seus donos. Veja [TRADEMARKS.md](TRADEMARKS.md).

## Recursos

| | |
|---|---|
| **Dashboard** | Os números de cada conta em 4 cartões: pokémon em campo, XP/h, Gold/h, abates, capturas, drops raros, buffs ativos e o estado do sniper. |
| **Jogo** | As 4 contas lado a lado, cada uma em uma sessão separada (login do jogo, da Twitch e da Kick). |
| **Sniper** | Compra anúncios do Mercado da Comunidade por regras de item ou de pokémon, no relógio do servidor, com um sniper por conta e árbitro entre elas. |
| **Captura** | Lança bolas nos pokémons derrotados enquanto estão caídos, com reposição automática de bolas e poções (inclusive Golden Potion) na loja do jogo. |
| **Hunts** | Todas as hunts por XP, ouro e abates, com vantagem de tipo, risco e caminho de up para o seu pokémon, com o catálogo de espécies do próprio jogo. |
| **Mercado** | Preços dos itens raros com a hora de cada leitura, radar de ofertas abaixo da média, histórico das suas compras e as vendas das últimas 24 h. |
| **Lives** | Quem está ao vivo, abertura automática, "Abrir só Twitch/Kick" e conferência periódica para o player não travar. |
| **Painel no celular** | Os números das contas e o controle de cada conta (hunt, time, mochila, Centro, sniper e captura) no celular, pela rede Wi-Fi de casa, com QR code e código de acesso. |
| **Config** | Logins por conta (PokéIdle, Twitch e Kick), login pelo navegador para contas Google, escala da interface e som. |

## Instalação

### Windows

1. Baixe `PokeIdle-Central-Setup-X.Y.Z.exe` na página [Releases](https://github.com/euhenrysm/pokeidlecentral/releases).
2. Dê dois cliques. O instalador é para o seu usuário (não pede administrador) e cria o atalho na área de trabalho.
3. O Windows pode avisar "O Windows protegeu o computador", porque o app não é assinado digitalmente. Clique em "Mais informações" > "Executar assim mesmo".

### Linux

Baixe na página [Releases](https://github.com/euhenrysm/pokeidlecentral/releases):

- **AppImage** (`PokeIdle-Central-X.Y.Z-linux.AppImage`): dê permissão de execução (`chmod +x`) e abra. Em distribuições com o sandbox do sistema bloqueado (Ubuntu 24.04+), abra com `--no-sandbox`.
- **.deb** (`PokeIdle-Central-X.Y.Z-linux.deb`): instale com o gerenciador de pacotes da sua distribuição.

O `LEIA-ME-LINUX.md` tem os detalhes da versão Linux.

## Rodar pelo código-fonte

Precisa de [Node.js](https://nodejs.org/) (versão LTS) e internet na primeira vez.

### Windows

Dê dois cliques em **ABRIR POKEIDLE CENTRAL.bat**. Na primeira vez ele instala o que falta sozinho.

Ou, no terminal, dentro da pasta do projeto:

    npm install
    npm start

### Linux

    ./ABRIR.sh

Na primeira vez instala as dependências. Se o sandbox do sistema estiver bloqueado, o script abre com `--no-sandbox` sozinho. Para uma janela sem transparência (sem compositor gráfico), use `POKEIDLE_OPACO=1 ./ABRIR.sh`.

Ou, equivalente: `npm install` e `npm start`.

## Gerar os instaladores

No Windows, dá para gerar o instalador com dois cliques em **GERAR INSTALADOR.bat** (ele instala o que falta e abre a pasta `dist`). Pelo terminal:

    npm install
    npm run instalador        # Windows: dist/PokeIdle-Central-Setup-X.Y.Z.exe
    npm run instalador:linux  # Linux: dist/PokeIdle-Central-X.Y.Z-linux.AppImage e .deb

Para lançar uma versão: suba o número em `package.json`, acrescente o cartão em `src/renderer/novidades.js` e envie uma tag `vX.Y.Z` para o GitHub. O workflow **Instaladores** (`.github/workflows/build.yml`) roda os testes, gera o instalador do Windows e o AppImage/.deb do Linux e publica na Release da tag. À mão, `npm run publicar` (Windows) e `npm run publicar:linux` (Linux) fazem o mesmo com a variável `GH_TOKEN`.

Para checar a sintaxe dos arquivos JavaScript, rode `npm run check`.

## Onde ficam os dados

- **Windows:** `%APPDATA%\pokeidle-central`
- **Linux:** `~/.config/pokeidle-central`

Lá ficam a configuração (`config.json`), as senhas salvas (`credenciais.json`, criptografadas pelo sistema), as sessões de login, os caches de sprites e catálogo, o histórico de compras (`historico-compras.json`) e as vendas recentes do mercado (`historico-global.json`). Desinstalar ou atualizar o app não apaga essa pasta. Veja [PRIVACY.md](PRIVACY.md).

## Config: logins por conta

Na aba **Config**, cada conta tem três logins: PokéIdle, Twitch e Kick.

- **Salvar** guarda o usuário e a senha. A senha é criptografada pelo sistema (DPAPI no Windows, chaveiro no Linux) e nunca aparece de volta na tela. No Linux, sem chaveiro (GNOME Keyring ou KWallet) o app recusa salvar a senha.
- **Entrar** abre a página de login na sessão daquela conta e preenche usuário e senha. A verificação anti-robô (Cloudflare) e o botão de entrar ficam com você.
- A senha só é preenchida no site do próprio serviço (pokeidle.io, twitch.tv, kick.com).
- Sem senha salva também funciona: faça o login na mão uma vez e ele fica salvo naquela conta.

### Login pelo Google ("Pelo navegador")

O Google bloqueia login com conta Google dentro de apps. Para essas contas, use o login que já está no seu navegador:

1. **Uma vez só:** instale a extensão. No Windows, rode `INSTALAR EXTENSAO NO CHROME.bat`. No Linux, rode `./INSTALAR-EXTENSAO.sh`. Os dois scripts perguntam o navegador e abrem a página de extensões dele. Também dá para fazer à mão: abra `chrome://extensions`, ligue o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e escolha a pasta `extensao-chrome` deste app.
2. Na aba Config, escolha em **"Pelo navegador" abre em** o navegador e o perfil daquela conta, e clique em **Pelo navegador** no serviço desejado. O app abre o site ali.
3. Faça login lá, se ainda não estiver logado, e clique em **Autorizar** no aviso da extensão.

Se o aviso não aparecer: confira se a extensão está ligada em `chrome://extensions` (depois de atualizar o app, clique no ↻ dela) e se o app está aberto. A extensão pergunta ao app pelas portas 47731 a 47735 do próprio computador.

A sessão daquele site vai para a conta do app. Ela vai direto pelo próprio computador (127.0.0.1), com um código que vale uma vez só por 5 minutos, e o app só aceita cookies do próprio site.

Para logar **contas diferentes** do mesmo site, marque no aviso "tirar a sessão deste navegador". A extensão apaga a sessão do navegador **sem sair da conta**, e aí dá para entrar com a próxima. Não clique em **Sair** numa conta que foi para o app: isso encerra a sessão no servidor e desconecta o app também.

## Janela

A janela não usa a moldura do sistema: tem cantos arredondados, e o topo do app faz o papel da barra de título. Arraste pelo topo para mover e dê dois cliques para maximizar. Os botões de minimizar, maximizar e fechar ficam no canto direito. Para redimensionar, puxe qualquer borda ou canto.

## Dashboard

O app abre na aba **Jogo**, para as contas carregarem e a verificação anti-robô aparecer. O Dashboard é a tela de acompanhamento: os números de cada conta, separados, sem precisar olhar os jogos. Cada cartão mostra:

- o **pokémon em campo**, com nível e barra de HP. A imagem é a da Pokédex (PokeAPI, nº 1 a 1025, normal ou shiny), baixada uma vez e guardada no cache. O que não está na Pokédex, e o caso de estar sem internet, usam o sprite do próprio jogo;
- **poções e bolas gastas na sessão**, com o estoque restante embaixo, em vermelho quando está acabando;
- nick, nível, se está online, saldo de ouro e gemas;
- XP/h, Gold/h, abates e capturas, com o botão **Zerar** para recomeçar os contadores da sessão;
- drops raros (Boss Token, fragmentos, Shiny Stone, Bicicleta, Ovo Shiny e Mystic Ticket);
- os **buffs ativos**, com o % e o tempo que falta;
- shinies vistos e capturados, e o último evento do sniper.

O botão **↗** abre o jogo daquela conta na aba **Jogo**. Gold/h vem da variação do saldo; XP/h e taxas usam os últimos 15 minutos.

Os nomes de alguns campos do jogo ainda estão sendo calibrados: o app salva os campos reais em `%APPDATA%\pokeidle-central\telemetria-debug.json` (no Linux, `~/.config/pokeidle-central/`). Se algum número ficar zerado com a conta farmando, esse arquivo mostra o motivo.

## Painel no celular

Na aba **Config**, ligue o **Painel no celular** para ver os números das contas no celular: pokémon em campo, ouro, XP/h, abates, capturas e drops raros. Cada conta também pode ser controlada pelo celular (veja abaixo).

- **Desligado por padrão.** Ligado, a Config mostra o endereço (`http://IP-do-computador:47740`) e um QR code. Aponte a câmera do celular para o QR: o código de acesso vai dentro dele, então não precisa digitar nada.
- **Só na mesma rede Wi-Fi**, com o app aberto. A porta é a 47740 (se estiver ocupada, a 47741 até a 47745). O Windows pode pedir para liberar o app no firewall: aceite para redes privadas.
- **O QR é como uma senha.** Quem tiver o QR vê os números das suas contas e pode controlá-las (trocar hunt, time, usar itens, ir ao Centro, ligar sniper e captura). Não vê senhas nem logins. Não divulgue o QR. Para trocar o acesso, clique em **Gerar novo código**: o QR antigo deixa de valer na hora e derruba quem estiver usando a página. Ao abrir o app com o painel ligado, um código novo também é gerado.
- Os números atualizam a cada 3 s. Se o app fechar ou o painel for desligado, a página mostra "Desconectado".

### Controlar pelo celular

Na página do celular, cada conta tem o botão **Controlar**, que abre a conta com estas abas:

- **Hunt**: as hunts liberadas pelo nível do treinador, com busca. A atual vem marcada. Toque numa hunt e confirme para trocar.
- **Time**: o time (com **Ativar** para o pokémon ativo) e o depósito (com **Pôr no time**, pelos de maior nível).
- **Mochila**: itens com busca. **Usar** e **Descartar** (com a quantidade que você escolher) pedem confirmação. Bolas aparecem só com a quantidade; elas não são descartadas pelo celular.
- **Centro**: **Ir ao Centro** e **Curar**.
- **Automação**: liga e desliga o **Sniper** e a **Captura** daquela conta, pelos mesmos interruptores da central.

Cada ação mostra na hora se a central confirmou ou por que recusou (conta sem conexão, hunt bloqueada, time cheio, item sem quantidade). Não há compra nem venda no mercado pelo celular. As ações valem para a conta que está logada no jogo, então quem acompanha o PC vê a mudança na hora.

## Contas (aba Jogo)

- Cada quadro é uma sessão separada (`persist:conta1` a `persist:conta4`): login do jogo, da Twitch e da Kick ficam separados por conta e salvos entre aberturas.
- Botões de cada quadro: renomear, zoom, recarregar e **⤢** para pôr a conta em tela cheia.
- O jogo continua rodando com o app minimizado ou em outra aba da central.

## Sniper

Como o mercado funciona (Wiki do jogo): todo anúncio fica retido por **2 min**. Os pedidos que chegam nos **3 s** seguintes à liberação entram num **sorteio com chance igual**, e vale **um pedido por jogador**. Ser mais rápido dentro da janela não dá vantagem.

O que o sniper faz para não perder nenhum sorteio:

- Calcula a liberação pelo **relógio do servidor** (`servidorAgora`), e não pelo relógio do computador.
- Manda **um** pedido por anúncio, `margem` ms depois da liberação (padrão 800 ms, com folga dentro da janela de 3 s).
- Varre o mercado com os filtros do próprio servidor (shiny, P5, nome) a cada N segundos (padrão 20 s; com 2 min de retenção, não precisa ser mais rápido).
- Limita a quantidade pelo saldo e pelo limite de cada regra; o contador sobe quando o jogo confirma a compra.
- **Um sniper por conta**, cada um com as suas regras e o seu liga/desliga (aba Sniper > escolha a conta). Margem e varredura valem para todas.
- A central é o **árbitro**: por padrão, se duas contas acharem o mesmo anúncio, só a primeira dispara. Ligando **Permitir várias contas no mesmo sorteio**, todas as contas com a regra entram (cada uma com um pedido). Confira antes se as regras do jogo permitem.

Na regra de **Item**, o botão **Escolher item do RMT…** abre a lista de tudo que o Mercado da Comunidade aceita, com os ícones do jogo, busca e abas: pedras, Shiny Stones, Mega Stones, TM, fragmentos, tickets, ovos, casas e bikes. Clicar num item preenche o nome e o ID. Os itens do catálogo público aparecem sempre; os próprios do jogo aparecem depois que uma conta conecta, e ficam salvos.

### Abaixo da média (itens)

No quadro **Preço** de uma regra de item, **Abaixo da média de 7 dias** troca o teto fixo por um limite relativo: o sniper compra quando o anúncio estiver pelo menos **Desconto mínimo** % abaixo do preço médio vendido do item nos últimos 7 dias (a mesma "Média vendida" do jogo).

- **Moeda**: Gemas, Coins ou as duas.
- **Mín. de vendas na semana**: ignora itens com poucas vendas, em que a média não diz nada (padrão 5).
- Sem item escolhido, a regra vale para **qualquer item do RMT**.
- Os tetos em Coins/Gemas e o limite de unidades continuam como trava extra. Numa regra de qualquer item, vale pôr um limite de unidades.
- **Pedir minha aprovação** (ligado por padrão): em vez de comprar, a oferta aparece em **Ofertas para aprovar**, na aba Mercado, com um aviso. **Comprar** dispara (na hora, ou na liberação se o anúncio ainda estiver retido); **Ignorar** descarta, e o mesmo anúncio não volta a ser sugerido. Sugestões com mais de 30 minutos somem da lista.
- O Registro mostra quanto o anúncio estava em relação à média, por exemplo "(67% da média de 225)".

### Editar regras

**Editar** devolve a regra ao formulário; **Salvar alterações** troca a antiga mantendo o contador de compradas e o liga/desliga. **Cancelar edição** volta ao formulário vazio.

| Campo | Uso |
| --- | --- |
| Tipo | Item ou Pokémon |
| Nome | nome exato do item ou da espécie (Pokémon pode ficar vazio se houver filtro) |
| ID do item | opcional, mais preciso que o nome |
| Escolher pokémon… | abre a lista das 1.025 espécies com o sprite do jogo (busca, abas por região e lendários) |
| Raridade | só shiny, apenas P5, Mega Evolução, lendários, com TM Elemental, com TM AoE (shiny só se vende em Gemas) |
| Omitir variantes de Outland | ligado por padrão: as variantes #2001+ nunca são compradas |
| Faixas | mín–máx de nível, potência, IV total, qualidade e nota, iguais às do Mercado do jogo |
| Teto em Coins / Gemas | preço máximo por unidade; 0 = não compra naquela moeda |
| Limite de unidades | 0 = sem limite |

Dica: a chance em cada sorteio é 1 dividido pelo número de participantes, então itens e faixas de preço menos disputados rendem mais vitórias.

### Sorteios e Registro

- **Sorteios** lista cada disparo do sniper: conta, item, preço, se foi sorteio ou compra direta e o resultado (ganhou, perdeu, recusado, sem resposta), com o placar no topo. Os disparos ficam salvos no histórico de compras (veja [Mercado](#mercado)), então a lista continua de uma abertura para outra. **Limpar** só esconde os sorteios da lista; o histórico continua salvo.
- O **Registro** mostra o que o app está fazendo agora (agendamentos, disparos, avisos). Ele não é salvo: some ao fechar o app.
- Os botões **Todas · Conta 1…4** filtram os Sorteios e o Registro por conta; trocar a conta no Sniper leva o filtro junto.
- Os avisos `market.sorteio` e `market.sorteioPerdeu` do jogo são INFERIDOS (não há captura que confirme o nome). O aviso de perda marca o disparo como "perdeu". Sem nenhum dos avisos, a compra confirmada marca como "ganhou", a recusa do servidor marca como "recusado", e um disparo sem resposta em 20 s fica como "sem resposta".

## Captura (lançar bolas)

A aba **Captura** lança uma bola em cada pokémon derrotado enquanto ele está caído no chão (30 s), como se você clicasse. Cada conta tem o seu cartão:

- **Interruptor:** liga e desliga só naquela conta. Vem desligado.
- **Modo:**
  - **Jogar até capturar:** desliga sozinho na primeira captura.
  - **Jogar pra sempre:** segue até você desligar.
- **Bola:** escolha uma das bolas do inventário da conta, com a quantidade. Bola zerada aparece apagada.
- **Como lança:**
  - A bola sai no instante em que o pokémon cai, como o "Lançar sem Parar" do VIP. Só espera 0,15 s entre duas bolas, quando vários caem juntos.
  - O servidor aceita uma bola por pokémon caído; se ela falhar, ele foge. Lançamento que o servidor ignora não gasta bola.
  - Se algum caído escapar sem bola, o rodapé mostra quantos.
  - Funciona com o app minimizado e em qualquer aba.
- **Reposição automática:** cada cartão tem uma linha para a **bola** e outra para a **poção**:
  - **O que comprar:** a bola ou o tipo de poção, com o preço da loja.
  - **Quando comprar:** ao ficar **abaixo de** um número, por exemplo 50.
  - **Quanto comprar:** a quantidade de cada compra, por exemplo 1000.
  - **Limite:** o máximo de vezes nesta sessão, onde 0 quer dizer sempre que precisar.
  - A compra é na **loja do jogo**, por Coins, na hora e sem sorteio.
  - Só compra se tiver Coins para o lote inteiro, e espera o estoque subir antes de pedir de novo.
- **Pausa sozinho:** quando a bola escolhida acaba ou a conta cai. Volta quando ela reconectar.
- **Conta com VIP:** o cartão sugere o "Lançar até Capturar" do próprio jogo, que roda no servidor mesmo com o app fechado.

## Hunts (onde caçar)

A aba **Hunts** mostra, para a conta escolhida, todas as hunts com **XP do treinador/h, XP do pokémon/h, ouro/h e abates/h**. Os números saem do **Hunt Analyser do próprio jogo** (o mesmo do Mapa), com o estado e os boosts da conta. Por cima, o que é só da conta:

- **Só liberadas**: esconde as hunts acima do nível do treinador (marcadas como "trancada").
- **Pokémon**: escolha qual dos seus pokémons vai caçar (o em campo vem marcado). Vantagem, risco e caminho são calculados para ele.
- **Caminho de up**: a melhor hunt agora para esse pokémon (entre os níveis mais altos que ele aguenta, a de melhor vantagem) e os próximos degraus de nível de hunt, com o nível de pokémon e de treinador que cada um pede.
- **Vantagem**: efetividade média dos tipos do pokémon escolhido contra as espécies da hunt, já amplificada como na hunt (×5,5, ×2,5, ×1, ×0,33…).
- **Risco**: a hunt passa de 125% do nível do pokémon escolhido. Dá para esconder essas hunts.
- **Ajustar ao meu ritmo**: depois de uns 3 minutos numa hunt, o app mede os abates/h reais e corrige todos os números pela diferença em relação à estimativa do jogo.
- Ordena por XP do treinador, XP do pokémon, ouro ou vantagem; filtra por região e por nome. A hunt atual aparece destacada.
- **Regiões:** as mesmas abas do mapa do jogo, na ordem do jogo: Kanto, Outland (Nv 150), Johto (Nv 200), Hoenn (500), Sinnoh (1.000), Unova (5.000), Kalos (10.000), Alola (25.000), Galar (40.000) e Paldea (75.000). Hunt sem região declarada entra pela regra do jogo: a Outland pela área, as outras pela geração do pokémon com mais pontos de spawn.
- **Filtro de nível:** mostra só as hunts entre o nível mínimo e o máximo que você digitar.
- **XP/h:** o cálculo usa o catálogo completo de espécies, com a XP de cada uma, como o Hunt Analyser do jogo.
- **Ficha (clique na hunt):**
  - tipos do pokémon principal, a que ele é fraco e o que ele resiste;
  - drops de cada espécie, do mais comum ao mais raro, com a chance;
  - raros da área: na Outland, Boss Token e os fragmentos de Chave, Shiny Stone e Bicicleta, pela chance do seu degrau; de Unova em diante, o Fragmento de Ovo Shiny.

## Mercado

A tabela de preços mostra só os itens raros, nas mesmas categorias do Mercado da Comunidade do jogo: Boxes, Casas, Bicicletas, Skins, Fragmentos, Boss Tokens e Tickets. Os chips de cima filtram por categoria, e a ordem é dos mais baratos em relação à média para os mais caros. (Diamantes não são mais vendidos no Mercado da Comunidade do jogo; o app não lê nem compra diamantes no RMT.)

A aba **Mercado** lê, pela conta escolhida, o menor anúncio de cada item em Coins e em Gemas e calcula, já com a comissão de 15%:

- **Coins por Gema**: quantas Coins custa cada Gema líquida comprando o item em Coins e revendendo em Gemas (menor = melhor);
- **Coins por Gema vendida**: o caminho contrário, comprar em Gemas e revender em Coins (maior = melhor).

**Radar de ofertas** (barra no topo da aba): sem precisar criar regra, a cada leitura de preços procura anúncios pelo menos X% abaixo da média de 7 dias (moeda e mínimo de vendas configuráveis) e mostra em **Ofertas para aprovar**. Nada é comprado sem o seu **Comprar**; funciona com o sniper desligado. **Atualizar sozinha** relê os preços a cada N minutos (padrão 2).

É o menor preço da vitrine, não um preço garantido: confira a quantidade à venda e o histórico de vendas no jogo antes de operar.

**Data de cada preço.** Cada item mostra quando foi lido ("agora", "há 3 min"). Em cada moeda, a célula tem um destes estados:

- **sem oferta**: o jogo respondeu e não há anúncio (0 anúncios ou preço nulo);
- **não lido**: o jogo ainda não mandou o preço daquele item. Os itens das categorias raras que o catálogo conhece aparecem assim até a primeira leitura, e campo que não veio na resposta também fica assim;
- **desatualizado** (cinza, em itálico): a última leitura tem mais de 2 × o intervalo de atualização (padrão 2 min, ou seja, 4 min). Item que some de uma resposta mantém a última leitura e vira desatualizado, em vez de sumir.

A tabela se redesenha a cada 30 s enquanto a aba está aberta. As datas não são salvas: ao reabrir o app, tudo volta a "não lido" até a primeira leitura.

**Mercado nas últimas 24 h.** Pela conta que lê os preços, a aba pede a página 0 do histórico de vendas ao abrir e depois a cada minuto, só com a aba aberta. Mostra as 50 vendas mais recentes (hora, descrição e total, sem vendedor nem comprador) e os **mais vendidos** do dia, agrupados pelo nome do item, com quantidade, número de vendas, total por moeda e preço médio. As vendas ficam em `historico-global.json` (24 h, até 5.000 linhas). Se nada chegar em 2 min, aparece "Histórico global indisponível agora". O formato dessa resposta é INFERIDO: se a lista ficar vazia com a conta logada, veja `telemetria-debug.json`, que guarda o exemplo do que não bateu.

**Histórico de compras.** Cada disparo do sniper (inclusive os que você aprovou) e cada compra da reposição na loja fica em `historico-compras.json` (até 2.000, os mais recentes). A seção mostra os registros com filtro por conta (Todas ou Conta 1…4) e por período (24 h, 7 dias ou tudo), 50 por vez com **Carregar mais**, e o gasto por moeda no período. Sorteio perdido e recusado não gastam nada. "Sem resposta" pode ter comprado: confira no jogo.

## Lives

- A lista de canais oficiais e quem está ao vivo vêm do painel **Bônus Twitch** do próprio jogo, em cada conta logada.
- O app não mostra notificações do sistema. Ofertas do radar esperando aprovação aparecem como um número na aba **Mercado**.
- **Assistir** abre a live na sessão da conta escolhida. **Abrir todas** abre todas as lives no ar de uma vez, e **Abrir só Twitch** e **Abrir só Kick** fazem o mesmo só com as lives daquela plataforma (mesma conta e mesma qualidade). O botão fica apagado quando não há live no ar daquela plataforma.
- **Abrir sozinha a live que entrar no ar** abre a live nova, visível, em **uma** conta escolhida, se ela estiver logada na Twitch (ou com a Kick vinculada no jogo). Vale só para lives que começarem com o app aberto; as outras contas continuam com o **Abrir todas**.
- Vincule a Twitch/Kick de cada conta pela tela do próprio jogo, dentro do quadro daquela conta.
- A live da Twitch abre com o **chat ao lado**: o bônus conta quem está no chat (logado). O cartão de cada conta mostra qual Twitch está logada no app e avisa se não for a vinculada no jogo.
- **Conferir a cada 5 min** (ligado por padrão, em Assistindo): de 5 em 5 minutos fecha as lives abertas que o jogo diz que saíram do ar e recarrega (F5) as que seguem no ar, para o player e o chat não travarem e continuarem pontuando. O horário e o resultado da última conferência aparecem ao lado do botão.
- **Qualidade das lives da Twitch** (padrão 160p): abre só o player da Twitch (bem mais leve que a página inteira) na qualidade escolhida. **Só chat** nem abre o vídeo, o mais leve. Medido por live: página inteira ~1.020 MB, 160p ~680 MB, só chat ~430 MB. Na Kick o vídeo continua, porque os pontos do canal só sobem assistindo.

## Som

**Som dos jogos**, no topo, muta ou liga as 4 contas de uma vez; o 🔊 de cada quadro da aba Jogo muta só aquela conta. A escolha fica salva.

## Novidades

Depois de cada atualização, a primeira abertura mostra um cartão com o que mudou, uma vez só por versão. Em instalação nova ele não aparece. O texto fica em `src/renderer/novidades.js`; para a próxima versão, acrescente uma entrada no topo da lista.

## Atualizações

- No Windows, as versões saem pelo GitHub Releases (`euhenrysm/pokeidlecentral`). O app procura versão nova ao abrir e a cada 6 h, e baixa em segundo plano.
- Cada arquivo é conferido pelo SHA-512 do `latest.yml`.
- O app avisa no topo com **Reiniciar e atualizar**; se você não clicar, a atualização instala ao fechar. Nada é apagado: logins e regras continuam.
- A atualização automática só roda no app empacotado. Rodando pelo código-fonte (`npm start`), o app não procura nem baixa nada.

## Limites conhecidos

- Os nomes dos campos do mercado e do bloco `twitch` foram tirados do cliente público do jogo; se o jogo mudar o formato, o sniper ou a lista de lives podem parar de reconhecer os dados (o registro mostra o que está acontecendo).
- Testado sem login: as 4 sessões abrem o jogo e o motor responde. O motor foi testado com um servidor simulado (relógio do computador 5 s adiantado, disparo a +815 ms da liberação, limite de unidades, árbitro entre contas), mas nenhuma compra real foi feita.
- A configuração fica em `config.json` dentro da pasta de dados (veja "Onde ficam os dados").
- Abra o app **uma vez só**. Duas cópias abertas brigam pela mesma pasta de dados e o login da segunda não é salvo. O app já impede uma segunda abertura, mas cópias antigas, de antes dessa trava, precisam ser fechadas.
- A versão Linux é menos testada que a do Windows. Veja `LEIA-ME-LINUX.md`.

## Contribuir

Veja [CONTRIBUTING.md](CONTRIBUTING.md). Para reportar falhas de segurança, veja [SECURITY.md](SECURITY.md). Sobre dados pessoais e o que o app acessa, veja [PRIVACY.md](PRIVACY.md).

## Licença

Copyright (C) 2026 Henrique Ferreira.

Este programa é software livre: você pode redistribuí-lo e/ou modificá-lo sob os termos da GNU General Public License versão 3, conforme publicada pela Free Software Foundation. O texto completo está em [LICENSE](LICENSE). O programa é distribuído sem nenhuma garantia.
