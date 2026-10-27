// O que mudou em cada versão. A central mostra um cartão com as versões novas desde a última que você
// viu (uma vez por versão). Para a próxima atualização: acrescente a versão no topo da lista.
window.NOVIDADES = [
  {
    versao: '0.3.0',
    itens: [
      ['Grátis e de código aberto', 'O PokeIdle Central agora é grátis e de código aberto (GPL-3.0): sem ativação, com o código no GitHub. Também roda no Linux.'],
      ['Histórico do mercado', 'Suas compras e sorteios ficam guardados entre aberturas, com filtros e o total gasto. E o Mercado mostra as vendas recentes e os itens mais vendidos nas últimas 24 h.'],
      ['Preços com data', 'Cada preço do Mercado mostra quando foi lido e diferencia "sem oferta", "não lido" e "desatualizado".'],
      ['Painel no celular', 'Na Config, ligue o painel e escaneie o QR: os números das contas no celular, na mesma rede Wi-Fi, só para ver.'],
      ['Tela', 'Escala da interface (Automático, 100%, 90%, 80%, 75%) e a janela abre onde você deixou.'],
      ['Lives', 'Botões "Abrir só Twitch" e "Abrir só Kick".'],
      ['Golden Potion', 'A reposição automática agora compra a Golden Potion (2.500 Coins).'],
      ['Correções', 'Hunts com os pokémons e formas novas do jogo; Fragmento de Bicicleta volta a contar no Dashboard; regra de item pelo nome no Sniper (ex.: AoE TM Disk Piece); o Sniper reserva o saldo entre compras. A compra de diamantes saiu, porque o jogo tirou os diamantes do mercado.']
    ]
  },
  {
    versao: '0.2.32',
    itens: [
      ['Reposição de poção', 'Corrigido: a poção não era comprada quando o estoque chegava a zero. Agora a reposição lê o estoque igual ao jogo e compra mesmo com 0.'],
      ['Hunts no padrão novo do jogo', 'A aba Hunts usa as regiões do mapa atual (Kanto, Outland, Johto, Hoenn, Sinnoh, Unova, Kalos, Alola, Galar e Paldea), com filtro de nível e XP/h calculado com a XP de cada espécie.'],
      ['Ficha da hunt', 'Clique numa hunt para ver as fraquezas e resistências do pokémon principal, os drops de cada espécie com a chance e os raros: na Outland pelo seu degrau, e o Fragmento de Ovo Shiny de Unova em diante.']
    ]
  },
  {
    versao: '0.2.31',
    itens: [
      ['Reposição automática', 'Na aba Captura, cada conta pode comprar bola e poção sozinha na loja do jogo, por Coins, quando o estoque ficar abaixo do número que você escolher. Escolha qual bola e qual poção, a quantidade de cada compra e quantas vezes pode comprar (0 = sempre que precisar). Só compra se tiver Coins para o lote inteiro.'],
      ['Registro de compras', 'A compra de diamantes no Sniper agora aparece completa no Registro, com quantidade, nome e preço.']
    ]
  },
  {
    versao: '0.2.3',
    itens: [
      ['Bola na hora', 'Na aba Captura, a bola agora sai no instante em que o pokémon cai, como o "Lançar sem Parar" do VIP. Mesmo matando rápido, nenhum caído fica sem bola, e o rodapé avisa se algum escapar.'],
      ['Mercado só com itens raros', 'A tabela de preços mostra só Boxes, Casas, Bicicletas, Skins, Fragmentos, Boss Tokens, Tickets e Diamantes, com filtro por categoria e os mais baratos em relação à média primeiro.'],
      ['Diamantes', 'O preço do diamante (por unidade, em Coins e em Gemas) aparece no Mercado, e o Sniper ganhou o tipo de regra "Diamantes": teto por diamante ou abaixo da média, com compra parcial do lote.']
    ]
  },
  {
    versao: '0.2.2',
    itens: [
      ['Aba Captura', 'Lança uma bola em cada pokémon derrotado enquanto ele está caído no chão, em cada conta. Escolha "Jogar até capturar" (desliga sozinho na primeira captura) ou "Jogar pra sempre", e a bola, puxando a quantidade do inventário. Funciona com o app minimizado, em qualquer aba.'],
      ['Abre na aba Jogo', 'O app agora abre sempre na aba Jogo, para as contas carregarem e a verificação anti-robô aparecer.'],
      ['Ícone da Super Ball', 'A Super Ball voltou a aparecer com o ícone certo no Dashboard.'],
      ['Novidades', 'Este cartão: depois de cada atualização ele mostra o que mudou.']
    ]
  },
  {
    versao: '0.2.1',
    itens: [
      ['Sem notificações do Windows', 'Ofertas do radar esperando aprovação aparecem como um número na aba Mercado.'],
      ['Procurar atualização', 'Na aba Config, um botão para procurar versão nova na hora.']
    ]
  },
  {
    versao: '0.2.0',
    itens: [
      ['Instalador', 'O app vem com instalador e atualização automática.'],
      ['Visual novo', 'Tema escuro, Dashboard 2×2 sem rolagem, imagens da Pokédex e janela com cantos arredondados.']
    ]
  }
];
