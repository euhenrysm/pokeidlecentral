// Regras do sniper e da captura, iguais no PC (formulário e aba Captura) e no celular. A central monta e
// confere com estas funções, e o painel do celular (processo principal) confere o pedido com as mesmas listas.
// Sem DOM: no navegador da central fica em `window.Regras`; no Node (painel e testes), é um módulo comum.
(function (raiz) {
  'use strict';

  // Bolas da captura e poções da loja do jogo (preço fixo em Coins por unidade).
  const NOMES_BOLA = { 1: 'Poké Ball', 2: 'Great Ball', 3: 'Super Ball', 4: 'Ultra Ball', 5: 'Beast Ball' };
  const POCOES_LOJA = [[200, 'Small Potion', 50], [201, 'Great Potion', 150], [202, 'Ultra Potion', 400], [203, 'Hyper Potion', 800], [204, 'Ultimate Potion', 1500], [70070, 'Golden Potion', 2500]];
  const MOEDAS_MEDIA = ['orb', 'gold', 'ambas'];
  const ID_REGRA = /^[\w-]{1,64}$/;
  const CONTAS = 4; // contas da central (as 4 abas de jogo)
  const LIMITE = {
    teto: 1e12, qtd: 100000, vendas: 10000, itemId: 1e9, desconto: 95,
    margemMs: 2500, varreduraMin: 10, varreduraMax: 120, abaixoDe: 100000, limiteCompras: 10000,
    minutosMin: 1, minutosMax: 60
  };
  // Campos que o celular pode mandar. Pokémon só tem os de teto e limite (criar pokémon fica no PC).
  const CAMPOS_ITEM = ['id', 'tipo', 'alvo', 'itemId', 'modo', 'desconto', 'moedaMedia', 'minVendas', 'aprovar', 'maxGold', 'maxGemas', 'maxQtd'];
  const CAMPOS_POKEMON = ['id', 'tipo', 'maxGold', 'maxGemas', 'maxQtd'];
  const CAMPOS_CAPTURA = ['ativo', 'modo', 'ballId', 'reposicao'];
  const CAMPOS_REPOSICAO = ['ativo', 'id', 'abaixoDe', 'qtd', 'limite'];

  const inteiro = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
  const texto = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
  const erro = (motivo) => ({ erro: motivo });
  const valor = (v) => ({ valor: v });
  const idsBolaLoja = (lojaBolas) => (Array.isArray(lojaBolas) && lojaBolas.length
    ? lojaBolas.map((b) => b.id)
    : Object.keys(NOMES_BOLA).map(Number));
  const gerarId = () => globalThis.crypto.randomUUID();

  // Tetos e limite. No fixo, pelo menos um teto (Coins ou Gemas); na média, o teto é uma trava extra e é opcional.
  function erroTetos(modo, d) {
    if (!inteiro(d.maxGold, 0, LIMITE.teto)) return 'Teto em Coins inválido.';
    if (!inteiro(d.maxGemas, 0, LIMITE.teto)) return 'Teto em Gemas inválido.';
    if (!inteiro(d.maxQtd, 0, LIMITE.qtd)) return 'Limite de unidades inválido.';
    if (modo === 'fixo' && !d.maxGold && !d.maxGemas) return 'Defina um teto em Coins ou em Gemas.';
    return null;
  }

  // Campos de uma regra de item (os mesmos do formulário do PC). Devolve o motivo ou null.
  function erroRegraItem(d) {
    if (!texto(d.alvo, 60)) return 'Nome do item muito longo ou com caracteres inválidos.';
    if (!inteiro(d.itemId, 0, LIMITE.itemId)) return 'ID do item inválido.';
    if (d.modo !== 'fixo' && d.modo !== 'media') return 'Escolha o tipo de preço.';
    if (d.modo === 'fixo' && !d.alvo && !d.itemId) return 'Informe o nome ou o ID do item.';
    if (d.modo === 'media') {
      if (!inteiro(d.desconto, 1, LIMITE.desconto)) return 'O desconto deve ficar entre 1 e 95%.';
      if (!MOEDAS_MEDIA.includes(d.moedaMedia)) return 'Moeda inválida.';
      if (!inteiro(d.minVendas, 0, LIMITE.vendas)) return 'Mín. de vendas inválido.';
      if (typeof d.aprovar !== 'boolean') return 'Pedir aprovação deve ser sim ou não.';
    }
    return erroTetos(d.modo, d);
  }

  // Monta a regra de item a partir dos campos. `anterior` (ao editar) mantém o id, o liga/desliga e as compradas.
  function regraDeItem(dados, anterior) {
    const d = { alvo: '', itemId: 0, ...dados };
    const motivo = erroRegraItem(d);
    if (motivo) return erro(motivo);
    const regra = {
      id: anterior ? anterior.id : gerarId(),
      ativa: anterior ? anterior.ativa : true,
      tipo: 'item',
      alvo: d.alvo,
      itemId: d.itemId,
      modo: d.modo,
      maxGold: d.maxGold,
      maxGemas: d.maxGemas,
      maxQtd: d.maxQtd,
      compradas: anterior ? anterior.compradas || 0 : 0
    };
    if (d.modo === 'media') Object.assign(regra, { desconto: d.desconto, moedaMedia: d.moedaMedia, minVendas: d.minVendas, aprovar: d.aprovar });
    return valor(regra);
  }

  // Troca só o teto e o limite de uma regra de pokémon (o resto dela fica como está).
  function regraDePokemonComTetos(anterior, d) {
    if (!anterior || anterior.tipo !== 'pokemon') return erro('Essa regra não é de pokémon.');
    const motivo = erroTetos('fixo', d);
    if (motivo) return erro(motivo);
    return valor({ ...anterior, maxGold: d.maxGold, maxGemas: d.maxGemas, maxQtd: d.maxQtd });
  }

  // Regra vinda do celular: só os campos da lista, com tipos e limites. Não aceita `compradas` nem `ativa`.
  function validarRegraDoCelular(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return erro('Regra inválida.');
    if (r.tipo !== 'item' && r.tipo !== 'pokemon') return erro('Tipo de regra inválido.');
    const editando = r.id !== undefined;
    if (editando && (typeof r.id !== 'string' || !ID_REGRA.test(r.id))) return erro('Regra inválida.');
    if (!editando && r.tipo !== 'item') return erro('Regra de pokémon só pode ser criada no PC. No celular, dá para editar o teto e o limite.');
    const permitidos = r.tipo === 'pokemon' ? CAMPOS_POKEMON : CAMPOS_ITEM;
    const estranho = Object.keys(r).find((k) => !permitidos.includes(k));
    if (estranho) return erro(`Campo não aceito: ${estranho}.`);
    const v = {};
    for (const k of permitidos) if (r[k] !== undefined) v[k] = r[k];
    if (v.alvo !== undefined && !texto(v.alvo, 60)) return erro('Nome do item muito longo ou com caracteres inválidos.');
    if (v.itemId !== undefined && !inteiro(v.itemId, 0, LIMITE.itemId)) return erro('ID do item inválido.');
    if (v.modo !== undefined && v.modo !== 'fixo' && v.modo !== 'media') return erro('Tipo de preço inválido.');
    if (v.desconto !== undefined && !inteiro(v.desconto, 1, LIMITE.desconto)) return erro('O desconto deve ficar entre 1 e 95%.');
    if (v.moedaMedia !== undefined && !MOEDAS_MEDIA.includes(v.moedaMedia)) return erro('Moeda inválida.');
    if (v.minVendas !== undefined && !inteiro(v.minVendas, 0, LIMITE.vendas)) return erro('Mín. de vendas inválido.');
    if (v.aprovar !== undefined && typeof v.aprovar !== 'boolean') return erro('Pedir aprovação deve ser sim ou não.');
    if (v.maxGold !== undefined && !inteiro(v.maxGold, 0, LIMITE.teto)) return erro('Teto em Coins inválido.');
    if (v.maxGemas !== undefined && !inteiro(v.maxGemas, 0, LIMITE.teto)) return erro('Teto em Gemas inválido.');
    if (v.maxQtd !== undefined && !inteiro(v.maxQtd, 0, LIMITE.qtd)) return erro('Limite de unidades inválido.');
    return valor(v);
  }

  // Margem e varredura do sniper (valem para todas as contas).
  function validarOpcoesSniper(p) {
    if (!p || typeof p !== 'object') return erro('Opções inválidas.');
    if (!inteiro(p.margemMs, 0, LIMITE.margemMs)) return erro('A margem deve ficar entre 0 e 2500 ms.');
    if (!inteiro(p.varreduraSeg, LIMITE.varreduraMin, LIMITE.varreduraMax)) return erro('A varredura deve ficar entre 10 e 120 s.');
    return valor({ margemMs: p.margemMs, varreduraSeg: p.varreduraSeg });
  }

  // Parcial da captura (o que muda): ligar, modo, bola e reposição. Bola da reposição: as da loja do jogo
  // (ou 1 a 5, se a loja ainda não chegou). Poção: as da lista da loja.
  function validarParcialCaptura(p, lojaBolas) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return erro('Ação de captura inválida.');
    const estranho = Object.keys(p).find((k) => !CAMPOS_CAPTURA.includes(k));
    if (estranho) return erro(`Campo não aceito: ${estranho}.`);
    const v = {};
    if (p.ativo !== undefined) {
      if (typeof p.ativo !== 'boolean') return erro('Ligar ou desligar deve ser sim ou não.');
      v.ativo = p.ativo;
    }
    if (p.modo !== undefined) {
      if (p.modo !== 'capturar' && p.modo !== 'sempre') return erro('Modo de captura inválido.');
      v.modo = p.modo;
    }
    if (p.ballId !== undefined) {
      if (!Object.keys(NOMES_BOLA).map(Number).includes(p.ballId)) return erro('Bola inválida.');
      v.ballId = p.ballId;
    }
    if (p.reposicao !== undefined) {
      if (!p.reposicao || typeof p.reposicao !== 'object' || Array.isArray(p.reposicao)) return erro('Reposição inválida.');
      const rep = {};
      for (const tipo of Object.keys(p.reposicao)) {
        if (tipo !== 'bola' && tipo !== 'pocao') return erro(`Reposição desconhecida: ${tipo}.`);
        const sub = p.reposicao[tipo];
        if (!sub || typeof sub !== 'object' || Array.isArray(sub)) return erro('Reposição inválida.');
        const fora = Object.keys(sub).find((k) => !CAMPOS_REPOSICAO.includes(k));
        if (fora) return erro(`Campo não aceito: ${fora}.`);
        const s = {};
        if (sub.ativo !== undefined) {
          if (typeof sub.ativo !== 'boolean') return erro('Ligar ou desligar a reposição deve ser sim ou não.');
          s.ativo = sub.ativo;
        }
        if (sub.id !== undefined) {
          const ids = tipo === 'bola' ? idsBolaLoja(lojaBolas) : POCOES_LOJA.map(([id]) => id);
          if (!ids.includes(sub.id)) return erro(tipo === 'bola' ? 'Essa bola não está na loja.' : 'Poção inválida.');
          s.id = sub.id;
        }
        if (sub.abaixoDe !== undefined) {
          if (!inteiro(sub.abaixoDe, 1, LIMITE.abaixoDe)) return erro('"Abaixo de" deve ficar entre 1 e 100000.');
          s.abaixoDe = sub.abaixoDe;
        }
        if (sub.qtd !== undefined) {
          if (!inteiro(sub.qtd, 1, LIMITE.qtd)) return erro('A quantidade por compra deve ficar entre 1 e 100000.');
          s.qtd = sub.qtd;
        }
        if (sub.limite !== undefined) {
          if (!inteiro(sub.limite, 0, LIMITE.limiteCompras)) return erro('O limite de compras deve ficar entre 0 e 10000.');
          s.limite = sub.limite;
        }
        rep[tipo] = s;
      }
      v.reposicao = rep;
    }
    if (!Object.keys(v).length) return erro('Nada para mudar.');
    return valor(v);
  }

  // Radar, lives e configuração pelo celular. Os mesmos limites das telas do PC (aba Mercado, Lives e Config).
  const QUALIDADES_LIVES = ['chat', '160p30', '360p30', '480p30', 'auto'];
  const ESCALAS_INTERFACE = ['auto', 1, 0.9, 0.8, 0.75];
  const PLATAFORMAS_LIVE = ['twitch', 'kick', 'ambas'];
  const CANAL = /^[\w.-]{1,60}$/;
  const objeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const campoFora = (p, permitidos) => Object.keys(p).find((k) => !permitidos.includes(k));
  const bool = (v, msg) => (typeof v === 'boolean' ? null : erro(msg));

  // Radar de ofertas: ligar, conta, desconto, moeda, vendas, atualização automática e minutos (só o que mudou).
  function validarRadarDoCelular(p) {
    if (!objeto(p)) return erro('Ação do radar inválida.');
    const fora = campoFora(p, ['ativo', 'conta', 'desconto', 'moedaMedia', 'minVendas', 'auto', 'minutos']);
    if (fora) return erro(`Campo não aceito: ${fora}.`);
    const v = {};
    if (p.ativo !== undefined) { const e = bool(p.ativo, 'Ligar ou desligar o radar deve ser sim ou não.'); if (e) return e; v.ativo = p.ativo; }
    if (p.conta !== undefined) { if (!inteiro(p.conta, 0, CONTAS - 1)) return erro('Conta do radar inválida.'); v.conta = p.conta; }
    if (p.desconto !== undefined) { if (!inteiro(p.desconto, 1, LIMITE.desconto)) return erro('O desconto deve ficar entre 1 e 95%.'); v.desconto = p.desconto; }
    if (p.moedaMedia !== undefined) { if (!MOEDAS_MEDIA.includes(p.moedaMedia)) return erro('Moeda inválida.'); v.moedaMedia = p.moedaMedia; }
    if (p.minVendas !== undefined) { if (!inteiro(p.minVendas, 0, LIMITE.vendas)) return erro('Mín. de vendas inválido.'); v.minVendas = p.minVendas; }
    if (p.auto !== undefined) { const e = bool(p.auto, 'Atualizar sozinha deve ser sim ou não.'); if (e) return e; v.auto = p.auto; }
    if (p.minutos !== undefined) { if (!inteiro(p.minutos, LIMITE.minutosMin, LIMITE.minutosMax)) return erro('Atualizar a cada 1 a 60 min.'); v.minutos = p.minutos; }
    if (!Object.keys(v).length) return erro('Nada para mudar.');
    return valor(v);
  }

  // Lives: qualidade da Twitch, conta que abre as lives, manter (conferir a cada 5 min) e abrir sozinha.
  function validarLivesDoCelular(p) {
    if (!objeto(p)) return erro('Ação de lives inválida.');
    const fora = campoFora(p, ['autoLive', 'manterLives', 'qualidadeLives', 'contaLives']);
    if (fora) return erro(`Campo não aceito: ${fora}.`);
    const v = {};
    if (p.manterLives !== undefined) { const e = bool(p.manterLives, 'Conferir as lives deve ser sim ou não.'); if (e) return e; v.manterLives = p.manterLives; }
    if (p.qualidadeLives !== undefined) { if (!QUALIDADES_LIVES.includes(p.qualidadeLives)) return erro('Qualidade inválida.'); v.qualidadeLives = p.qualidadeLives; }
    if (p.contaLives !== undefined) { if (!inteiro(p.contaLives, 0, CONTAS - 1)) return erro('Conta das lives inválida.'); v.contaLives = p.contaLives; }
    if (p.autoLive !== undefined) {
      if (!objeto(p.autoLive)) return erro('Abrir sozinha: dados inválidos.');
      const dentro = campoFora(p.autoLive, ['ativo', 'conta']);
      if (dentro) return erro(`Campo não aceito: ${dentro}.`);
      const a = {};
      if (p.autoLive.ativo !== undefined) { const e = bool(p.autoLive.ativo, 'Abrir sozinha deve ser sim ou não.'); if (e) return e; a.ativo = p.autoLive.ativo; }
      if (p.autoLive.conta !== undefined) { if (!inteiro(p.autoLive.conta, 0, CONTAS - 1)) return erro('Conta do abrir sozinha inválida.'); a.conta = p.autoLive.conta; }
      if (!Object.keys(a).length) return erro('Nada para mudar.');
      v.autoLive = a;
    }
    if (!Object.keys(v).length) return erro('Nada para mudar.');
    return valor(v);
  }

  // Abrir lives: Twitch, Kick ou as duas. Com canal, abre só aquela live (que tem de estar no ar).
  function validarLiveAbrir(p) {
    if (!objeto(p)) return erro('Ação de live inválida.');
    const fora = campoFora(p, ['plataforma', 'canal']);
    if (fora) return erro(`Campo não aceito: ${fora}.`);
    if (!PLATAFORMAS_LIVE.includes(p.plataforma)) return erro('Plataforma inválida.');
    if (p.canal === undefined) return valor({ plataforma: p.plataforma });
    if (p.plataforma === 'ambas') return erro('Para abrir uma live, escolha a Twitch ou a Kick.');
    if (typeof p.canal !== 'string' || !CANAL.test(p.canal)) return erro('Canal inválido.');
    return valor({ plataforma: p.plataforma, canal: p.canal });
  }

  // Configuração que o celular muda: escala da interface e som (mudo) de cada conta. Nada de login.
  function validarConfigDoCelular(p) {
    if (!objeto(p)) return erro('Ação de configuração inválida.');
    const fora = campoFora(p, ['escalaInterface', 'mudo']);
    if (fora) return erro(`Campo não aceito: ${fora}.`);
    const v = {};
    if (p.escalaInterface !== undefined) {
      if (!ESCALAS_INTERFACE.includes(p.escalaInterface)) return erro('Escala inválida.');
      v.escalaInterface = p.escalaInterface;
    }
    if (p.mudo !== undefined) {
      if (!objeto(p.mudo)) return erro('Som: dados inválidos.');
      const dentro = campoFora(p.mudo, ['conta', 'valor']);
      if (dentro) return erro(`Campo não aceito: ${dentro}.`);
      if (!inteiro(p.mudo.conta, 0, CONTAS - 1)) return erro('Conta do som inválida.');
      const e = bool(p.mudo.valor, 'Mudo deve ser sim ou não.');
      if (e) return e;
      v.mudo = { conta: p.mudo.conta, valor: p.mudo.valor };
    }
    if (!Object.keys(v).length) return erro('Nada para mudar.');
    return valor(v);
  }

  const api = {
    NOMES_BOLA, POCOES_LOJA, MOEDAS_MEDIA, ID_REGRA, LIMITE, CONTAS, QUALIDADES_LIVES, ESCALAS_INTERFACE,
    erroTetos, regraDeItem, regraDePokemonComTetos, validarRegraDoCelular, validarOpcoesSniper, validarParcialCaptura,
    validarRadarDoCelular, validarLivesDoCelular, validarLiveAbrir, validarConfigDoCelular
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.Regras = api;
})(typeof window !== 'undefined' ? window : globalThis);
