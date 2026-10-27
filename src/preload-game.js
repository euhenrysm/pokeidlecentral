// Preload de cada conta do jogo. Instala o motor no contexto da página ANTES dos scripts do jogo
// (para enxergar o WebSocket desde a conexão) e faz a ponte motor <-> central.
const { contextBridge, ipcRenderer } = require('electron');

// Tudo dentro desta função roda no mundo da página. Ela é serializada pelo Electron, então não
// pode usar nada de fora dela.
function motor() {
  if (window.__pcMotor) return;

  const JANELA_SORTEIO_MS = 3000;
  const S = (window.__pcMotor = {
    ativo: false,
    regras: [],
    margemMs: 800,
    varreduraSeg: 20,
    ws: null,
    desvio: null,           // Date.now() - servidorAgora
    gold: -1,
    gemas: -1,
    diamantes: -1,
    itens: {},              // itemId -> nome, do catálogo do welcome
    ofertas: new Map(),     // offerId -> { estado, em, regraId, timer }
    pendentes: new Map(),   // offerId -> { an, regra, qtd } esperando a central liberar
    ultimoDisparo: null,    // { id, regraId, qtd, em, nome }
    twitch: null,
    kick: null,
    timerVarredura: null
  });

  // Telemetria da sessão (o que o Dashboard mostra).
  const novaTelemetria = () => ({
    inicio: Date.now(),
    goldGanho: 0,
    xpTreinador: 0,
    xpPokemon: 0,
    abates: 0,
    capturas: 0,
    shiniesVistos: 0,
    shiniesCapturados: 0,
    drops: { boss: 0, chave: 0, shinyStone: 0, bike: 0, ovoShiny: 0, mystic: 0 },
    // O que a hunt consumiu nesta sessão: bolas pelo arremesso, poções e revives pela queda no estoque.
    gastos: { bolas: 0, pocoes: 0, revives: 0, porBola: {}, porPocao: {} },
    amostras: []
  });
  const T = (S.tel = novaTelemetria());
  // evXp/evOuro: o jogo já mandou XP/ouro no evento de abate; aí o saldo do estado só serve de reserva.
  const perfil = { nick: '', nivel: null, hunt: '', ultimoGold: null, ultimoXp: null, evXp: false, evOuro: false };
  const vistos = new Map();       // chave do pokémon/slot -> quando (evita contar o mesmo evento duas vezes)
  const diag = { estado: null, eventos: {}, amostras: {} };
  // Pokémon em campo e estoque que a hunt consome (o cartão do Dashboard).
  const ativo = { id: null, nome: '', nivel: null, hp: null, hpMax: null, looktype: null, shiny: false, especieId: null };
  const estoque = { pocao: null, bola: null, ultimaBola: null };

  const postar = (tipo, dados) => window.postMessage({ __pcMotor: true, tipo, dados }, '*');
  const log = (nivel, msg, extra) => postar('log', { em: Date.now(), nivel, msg, ...(extra || {}) });
  const agoraServidor = () => Date.now() - (S.desvio ?? 0);

  // ---------------------------------------------------------- WebSocket do jogo
  const WSOriginal = window.WebSocket;
  const sendOriginal = WSOriginal.prototype.send;

  function anexar(ws) {
    if (!ws || ws.__pc) return;
    ws.__pc = true;
    S.ws = ws;
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      let p;
      try { p = JSON.parse(ev.data); } catch { return; }
      try { aoPacote(p); } catch (e) { log('erro', 'Falha ao ler pacote: ' + e.message); }
    });
    ws.addEventListener('close', () => { if (S.ws === ws) S.ws = null; status(); });
    status();
  }

  window.WebSocket = class extends WSOriginal {
    constructor(...args) { super(...args); anexar(this); }
  };
  WSOriginal.prototype.send = function (...args) { anexar(this); return sendOriginal.apply(this, args); };

  function enviar(obj) {
    const ws = S.ws;
    if (!ws || ws.readyState !== 1) return false;
    sendOriginal.call(ws, JSON.stringify(obj));
    return true;
  }

  // ---------------------------------------------------------- Leitura dos pacotes
  function aoPacote(p) {
    if (!p || typeof p !== 'object') return;
    const t = p.t || '';
    const est = p.estado || (p.payload && p.payload.estado) || (t === 'estado' ? p : null);

    const sa = Number((est && est.servidorAgora) ?? p.servidorAgora);
    if (sa > 1e12) S.desvio = Date.now() - sa;

    const fonteSaldo = est || p;
    if (typeof fonteSaldo.gold === 'number') {
      // Gold/h sai da variação do saldo: só o que entra conta (gasto e compra não descontam).
      if (!perfil.evOuro && perfil.ultimoGold != null && fonteSaldo.gold > perfil.ultimoGold) T.goldGanho += fonteSaldo.gold - perfil.ultimoGold;
      perfil.ultimoGold = fonteSaldo.gold;
      S.gold = fonteSaldo.gold;
    }
    if (typeof fonteSaldo.orbs === 'number') S.gemas = fonteSaldo.orbs;
    if (typeof fonteSaldo.diamonds === 'number') S.diamantes = fonteSaldo.diamonds;
    if (est) lerPerfil(est);
    if (est) estadoCru = { ...estadoCru, ...est };
    if (est && t !== 'welcome') mesclarEstado(est);
    anotarCaidos(p.mobs || (p.campo && p.campo.mobs));
    if (t === 'batalha' && Array.isArray(p.ev)) for (const e of p.ev) if (e) aoEventoBatalha(e);

    // O bloco do Bônus Twitch/Kick vem no estado: é dele que a central lê quem está ao vivo.
    const tw = (est && est.twitch) ?? p.twitch;
    if (tw !== undefined && JSON.stringify(tw) !== JSON.stringify(S.twitch)) {
      S.twitch = tw;
      postar('lives', { twitch: S.twitch, kick: S.kick });
    }
    const kk = (est && est.kick) ?? p.kick;
    if (kk !== undefined && JSON.stringify(kk) !== JSON.stringify(S.kick)) {
      S.kick = kk;
      postar('lives', { twitch: S.twitch, kick: S.kick });
    }

    if (t === 'welcome') {
      if (Array.isArray(p.catalogoBolas)) {
        lojaBolas = p.catalogoBolas.filter((b) => b && b.compravel && Number(b.priceGold) > 0)
          .map((b) => ({ id: Number(b.id), nome: b.nome || BOLAS[b.id] || `Bola ${b.id}`, preco: Number(b.priceGold) }));
      }
      for (const lista of [p.itensNossos, p.mercado && p.mercado.catalogo]) {
        if (Array.isArray(lista)) for (const it of lista) if (it && it.id) S.itens[it.id] = it.name || it.nome || '';
      }
      if (Array.isArray(p.hunts)) {
        amostrar('hunt', p.hunts.find((h) => h && h.area === 'outland') || p.hunts[0]);
        for (const h of p.hunts) if (h && h.slug) huntsPorSlug.set(h.slug, h);
      }
      dadosHunts.tabelaTipos = p.tabelaTipos || dadosHunts.tabelaTipos;
      dadosHunts.tiposBoost = p.tiposBoost || dadosHunts.tiposBoost;
      if (p.chanceBossToken != null) dadosHunts.chanceBossToken = Number(p.chanceBossToken);
      if (Array.isArray(p.outlandTiers)) dadosHunts.outlandTiers = p.outlandTiers;
      if (p.casas) dadosHunts.chanceFragChave = Number(p.casas.fragmento && p.casas.fragmento.chanceDrop) || null;
      if (p.shinyStone) dadosHunts.chanceFragShiny = Number(p.shinyStone.chanceDrop) || null;
      if (p.bicicletas) dadosHunts.chanceFragBicicleta = Number(p.bicicletas.fragmento && p.bicicletas.fragmento.chanceDrop) || null;
      if (p.estado) mesclarEstado({ ...p.estado, cheio: true });
      // Fragmentos, tickets, Mega Stones etc. só existem aqui (o catálogo público não os conhece).
      if (Array.isArray(p.itensNossos)) {
        postar('itensNossos', p.itensNossos.filter((it) => it && it.id).map((it) => ({
          id: it.id, name: it.name || it.nome || '', icon: it.icon || '', category: it.category || it.categoria || ''
        })));
      }
      return;
    }

    if (t === 'market') return aoMercado(p);

    // Para calibrar: o que o servidor manda logo depois de um disparo (é aí que vem o aviso do sorteio).
    if (S.ultimoDisparo && Date.now() - S.ultimoDisparo.em < 12000 && t !== 'estado' && t !== 'campo') {
      const chave = t + ':' + (p.aba || (Array.isArray(p.ev) ? p.ev.map((e) => e && e.k).join(',') : ''));
      if (!diag.aposDisparo) diag.aposDisparo = {};
      if (!diag.aposDisparo[chave] && Object.keys(diag.aposDisparo).length < 40) {
        diag.aposDisparo[chave] = JSON.stringify(p).slice(0, 400);
        postar('diagnostico', diag);
      }
    }

    if (t === 'erro' && S.ultimoDisparo && Date.now() - S.ultimoDisparo.em < 8000) {
      const motivo = p.msg || p.mensagem || p.chave || 'recusado pelo servidor';
      log('recusado', `${S.ultimoDisparo.nome}: ${motivo}`, { id: S.ultimoDisparo.id });
      fecharSorteio(S.ultimoDisparo.id, /sorte|sortei|perdeu|lottery/i.test(motivo) ? 'perdeu' : 'recusado', motivo);
    }

    if (t === 'batalha' && Array.isArray(p.ev)) {
      for (const e of p.ev) {
        if (!e || String(e.k || e.t || '') !== 'marketComprado') continue;
        const d = S.ultimoDisparo;
        // A descrição do jogo às vezes vem só com ícone ("1× 💎"): com o disparo em mãos, o texto sai completo.
        const texto = d ? `Comprado: ${d.qtd}× ${d.nome} por ${preco(d.preco)} ${rotuloMoeda(d.moeda)}${d.qtd > 1 ? ' cada' : ''}` : (e.descricao || 'Compra confirmada');
        log('comprado', texto, d ? { id: d.id } : {});
        if (d) fecharSorteio(d.id, 'ganhou', e.descricao || '', { total: Number(e.total) > 0 ? Number(e.total) : undefined });
        if (d && d.regraId && Date.now() - d.em < 15000) postar('comprado', { regraId: d.regraId, qtd: d.qtd });
      }
    }
  }

  // ---------------------------------------------------------- Telemetria
  const primeiroNumero = (...vals) => vals.find((v) => typeof v === 'number' && isFinite(v));
  const titulo = (slug) => String(slug).split(/[_-]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  function lerPerfil(est) {
    const eu = est.eu || est.treinador || {};
    if (!diag.estado) {
      // Para calibrar: os nomes dos campos que o jogo realmente manda (sem os valores).
      diag.estado = { estado: Object.keys(est).slice(0, 120), eu: Object.keys(eu).slice(0, 80) };
      postar('diagnostico', diag);
    }
    const nick = est.nick || eu.nick || est.nome || eu.nome;
    if (typeof nick === 'string') perfil.nick = nick;
    const nivel = primeiroNumero(est.nivel, eu.nivel, est.level, eu.level, est.lvl);
    if (nivel != null) perfil.nivel = nivel;

    const xp = primeiroNumero(est.xpTotal, eu.xpTotal, est.xp, eu.xp, est.xpTreinador, eu.xpTreinador);
    if (xp != null) {
      if (!perfil.evXp && perfil.ultimoXp != null && xp > perfil.ultimoXp) T.xpTreinador += xp - perfil.ultimoXp;
      perfil.ultimoXp = xp;
    }

    lerAtivo(est);
    lerEstoque(est);
    if ('outlandTier' in est) perfil.outlandTier = Number(est.outlandTier) || 0;
    if (est.noCentro === true || est.huntSlug === 'centro_pokemon') perfil.huntSlug = 'centro_pokemon';
    else if (est.huntSlug) perfil.huntSlug = est.huntSlug;
  }

  // Guarda um pedaço do formato real dos blocos usados no cartão, para calibrar os campos.
  function amostrar(chave, valor) {
    if (valor === undefined || diag.amostras[chave]) return;
    diag.amostras[chave] = JSON.stringify(valor).slice(0, 700);
    postar('diagnostico', diag);
  }

  function lerAtivo(est) {
    const lista = Array.isArray(est.pokemons) ? est.pokemons : null;
    amostrar('activeId', est.activeId);
    if (lista && lista.length) amostrar('pokemon', lista.find((x) => x && x.id === est.activeId) || lista[0]);
    if (est.activeId != null) ativo.id = est.activeId;
    const pk = lista && lista.find((x) => x && x.id === ativo.id);
    if (!pk) return;
    ativo.nome = pk.apelido || pk.nome || pk.especie || pk.speciesName || pk.name || ativo.nome;
    const nv = primeiroNumero(pk.level, pk.nivel, pk.lvl);
    if (nv != null) ativo.nivel = nv;
    const hp = primeiroNumero(pk.hp, pk.hpAtual, pk.vida);
    const hpMax = primeiroNumero(pk.maxHp, pk.hpMax, pk.vidaMax, pk.hpMaximo);
    if (hp != null) ativo.hp = hp;
    if (hpMax != null) ativo.hpMax = hpMax;
    ativo.shiny = Boolean(pk.shiny || pk.isShiny);
    ativo.especieId = primeiroNumero(pk.speciesId, pk.especieId, pk.pokeId, pk.especie_id);
    const look = primeiroNumero(pk.looktype, pk.lookType, pk.lt, pk.look);
    if (look != null) gerarSprite(look);
  }

  // Quantidade por id, aceitando lista [{id, qtd}] ou objeto {id: qtd}.
  function quantidades(bloco) {
    const out = {};
    if (Array.isArray(bloco)) {
      for (const it of bloco) if (it && it.id != null) out[it.id] = Number(it.qtd ?? it.quantidade ?? it.q ?? it.n ?? 0);
    } else if (bloco && typeof bloco === 'object') {
      for (const [id, v] of Object.entries(bloco)) out[id] = typeof v === 'number' ? v : Number(v && (v.qtd ?? v.quantidade ?? v.q ?? 0));
    }
    return out;
  }

  const BOLAS = { 1: 'Poké Ball', 2: 'Great Ball', 3: 'Super Ball', 4: 'Ultra Ball', 5: 'Beast Ball' };

  // Nomes das poções que o catálogo do welcome às vezes não traz.
  const NOMES_POCAO = { 200: 'Small Potion', 201: 'Great Potion', 202: 'Ultra Potion', 203: 'Hyper Potion', 204: 'Ultimate Potion', 70070: 'Golden Potion' };
  let automacao = null;
  const estoqueAnterior = {}; // id -> quantidade na última leitura (para medir o gasto)

  function lerEstoque(est) {
    if (est.automation && typeof est.automation === 'object') automacao = est.automation;
    const bolas = est.balls ? quantidades(est.balls) : null;
    const itens = est.items ? quantidades(est.items) : null;
    if (itens) for (const id of Object.keys(POCOES_LOJA)) if (itens[id] != null) itensInventario[id] = itens[id];
    if (bolas) Object.assign(bolasInventario, bolas);
    if (est.loja && 'vip' in est.loja) perfil.vip = Boolean(est.loja.vip);

    // A bola e a poção mostradas são as que a automação do jogo vai gastar: a primeira da lista com estoque.
    if (bolas) {
      const ordem = (automacao && Array.isArray(automacao.ballIds) && automacao.ballIds.length) ? automacao.ballIds : [5, 4, 3, 2, 1];
      const id = ordem.find((b) => (bolas[b] || 0) > 0) ?? ordem[0];
      estoque.bola = { id: Number(id), nome: BOLAS[id] || `Bola ${id}`, qtd: bolas[id] || 0 };
    }
    if (itens) {
      const pocoes = new Set([200, 201, 202, 203, 204, 70070, ...((automacao && automacao.potionIds) || [])].map(Number));
      const revives = new Set([205, 206, ...((automacao && automacao.reviveIds) || [])].map(Number));
      for (const id of [...pocoes, ...revives]) {
        const atual = itens[id] || 0;
        const antes = estoqueAnterior[id];
        if (antes != null && atual < antes) {
          const usado = antes - atual;
          if (pocoes.has(id)) { T.gastos.pocoes += usado; T.gastos.porPocao[id] = (T.gastos.porPocao[id] || 0) + usado; }
          else T.gastos.revives += usado;
        }
        estoqueAnterior[id] = atual;
      }
      const ordem = (automacao && Array.isArray(automacao.potionIds) && automacao.potionIds.length) ? automacao.potionIds : [70070, 204, 203, 202, 201, 200];
      const id = ordem.find((x) => (itens[x] || 0) > 0);
      estoque.pocao = id != null
        ? { nome: S.itens[id] || NOMES_POCAO[id] || 'Poção', qtd: itens[id] }
        : { nome: 'Poção', qtd: 0 };
    }
    lerBuffs(est);
  }

  // ---------------------------------------------------------- Buffs ativos (a faixa "Sessão" do jogo)
  const buffs = { xpTr: null, xpPk: null, itens: [] };
  let loja = null;
  let guild = null;

  // O estado chega em pedaços: guarda o último de cada bloco, para um pedaço só com a loja não
  // apagar as partes do bônus (Twitch, Kick, guild...) da faixa.
  let bonusXp = null;
  let kickBloco = null;
  const ROTULO_BUFF = {
    vip: 'VIP', xp: 'XP Boost', pokexp: 'XP Pokémon', loot: 'Loot', captura: 'Captura', shiny: 'Shiny Lure',
    twitch: 'Twitch', kick: 'Kick', guild: 'Guild', guildBoost: 'Boost da Guild', evento: 'Evento', atrasados: 'Atrasados'
  };
  // O mesmo boost tem nomes diferentes na loja e no bônus de XP: junta pelo tipo.
  function tipoDoBuff(id) {
    const k = String(id || '').toLowerCase();
    if (k.includes('vip')) return 'vip';
    if (k.includes('atrasad')) return 'atrasados';
    if (k.includes('twitch')) return 'twitch';
    if (k.includes('kick')) return 'kick';
    if (k.includes('guild') && (k.includes('boost') || k.includes('banco'))) return 'guildBoost';
    if (k.includes('guild')) return 'guild';
    if (k.includes('event')) return 'evento';
    if (k.includes('pok')) return 'pokexp';
    if (k.includes('loot')) return 'loot';
    if (k.includes('captur') || k.includes('catch')) return 'captura';
    if (k.includes('shiny') || k.includes('lure')) return 'shiny';
    if (k === 'xp' || k.includes('exp') || k.includes('xpboost')) return 'xp';
    return k || 'outro';
  }

  function lerBuffs(est) {
    if (est.loja && typeof est.loja === 'object') loja = est.loja;
    if (est.guild !== undefined) guild = est.guild;
    if (est.bonusXp !== undefined) bonusXp = est.bonusXp;
    if (est.kick !== undefined) kickBloco = est.kick;
    if (est.bonusXp) diag.amostras.bonusXpUltimo = JSON.stringify(est.bonusXp).slice(0, 700);
    amostrar('loja', est.loja);

    const agora = agoraServidor();
    const b = bonusXp;
    if (b && typeof b === 'object') {
      buffs.xpTr = Number(b.tr) || null;
      buffs.xpPk = Number(b.pk) || null;
    }

    const porTipo = new Map();
    const juntar = (id, dados) => {
      const tipo = tipoDoBuff(id);
      const atual = porTipo.get(tipo) || { id: tipo, rotulo: ROTULO_BUFF[tipo] || String(id), tr: null, pk: null, ate: null };
      for (const [k, v] of Object.entries(dados)) if (v != null && atual[k] == null) atual[k] = v;
      porTipo.set(tipo, atual);
    };
    // Bônus de XP do servidor: cada parte com o multiplicador dela (é dali que sai o % de cada uma).
    for (const x of (b && Array.isArray(b.partes) ? b.partes : [])) {
      if (Number(x.ate) > 0 && x.ate <= agora) continue;
      juntar(x.id, { tr: Number(x.tr) || null, pk: Number(x.pk) || null, ate: Number(x.ate) || null, lives: x.lives || null });
    }
    // Loja: VIP, boosts com o prazo (inclusive os que não mexem no XP: loot, captura, shiny).
    if (loja && loja.vip) juntar('vip', { ate: Number(loja.vipAte) || null });
    for (const [chave, ate] of Object.entries((loja && loja.boosts) || {})) {
      if (Number(ate) > agora) juntar(chave, { ate: Number(ate) });
    }
    if (loja && loja.atrasados) juntar('atrasados', { tr: Number(loja.atrasados.mult) || null });
    if (guild && Number(guild.boostAte) > agora) juntar('guildBoost', { ate: Number(guild.boostAte) });

    // Resgates de pontos do canal na Kick (kick.bonus: { tipo: até quando }): cada um é um boost à parte.
    // O de XP é o mesmo "kick" do bônus de XP; captura e shiny não mexem no XP e só aparecem aqui.
    const pctKick = Number(kickBloco && kickBloco.pct) || 15;
    for (const [tipo, ate] of Object.entries((kickBloco && kickBloco.bonus) || {})) {
      if (!(Number(ate) > agora)) continue;
      const t = String(tipo).toLowerCase();
      if (t.includes('xp') || t.includes('exp')) {
        juntar('kick', { ate: Number(ate), tr: 1 + pctKick / 100, pk: 1 + pctKick / 100 });
        const k = porTipo.get('kick'); if (k) k.rotulo = 'Kick · XP';
      } else {
        const id = t.includes('shiny') || t.includes('lure') ? 'kickShiny' : t.includes('captur') || t.includes('catch') ? 'kickCaptura' : 'kick_' + t;
        porTipo.set(id, { id, rotulo: id === 'kickShiny' ? 'Kick · Secret Lure' : id === 'kickCaptura' ? 'Kick · Captura' : `Kick · ${tipo}`,
          tr: null, pk: null, ate: Number(ate), efeitoTexto: `+${pctKick}%` });
      }
    }

    const ordem = ['vip', 'xp', 'pokexp', 'twitch', 'kick', 'guild', 'guildBoost', 'evento', 'atrasados', 'loot', 'captura', 'shiny', 'kickCaptura', 'kickShiny'];
    buffs.itens = [...porTipo.values()].sort((a, b2) => {
      const ia = ordem.indexOf(a.id); const ib = ordem.indexOf(b2.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }


  // Desenha o pokémon com o módulo de sprites do próprio jogo e manda os quadros para a central.
  let modSprites = null;
  let lookPedido = null;
  async function gerarSprite(looktype) {
    if (looktype === lookPedido) return;
    lookPedido = looktype;
    ativo.looktype = looktype;
    try {
      modSprites = modSprites || (await import('/sprites.mjs'));
      const sprite = await modSprites.carregarOutfit(looktype);
      const quadros = sprite ? modSprites.quadrosDe(sprite, 3) : [];
      const imagens = [];
      for (const q of quadros.slice(0, 8)) {
        const img = sprite.imagens[q.pagina];
        if (!img) continue;
        const cv = document.createElement('canvas');
        cv.width = q.w;
        cv.height = q.h;
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, q.x, q.y, q.w, q.h, 0, 0, q.w, q.h);
        imagens.push(cv.toDataURL('image/png'));
      }
      if (lookPedido === looktype) postar('sprite', { looktype, especieId: ativo.especieId, shiny: ativo.shiny, quadros: imagens });
    } catch (err) {
      log('aviso', 'Não consegui desenhar o sprite do pokémon: ' + err.message);
    }
  }

  const huntsPorSlug = new Map();
  // ---------------------------------------------------------- Onde caçar (aba Hunts da central)
  // Os números de XP/h, ouro/h e abates/h são os do Hunt Analyser do próprio jogo (o mesmo do Mapa),
  // com o estado completo da conta e os boosts dela. Por cima, o que é desta conta: liberada pelo
  // nível do treinador, a vantagem de tipo do pokémon ativo e o ritmo real medido na hunt atual.
  const dadosHunts = { tabelaTipos: null, tiposBoost: [] };
  let mesclador = null;
  let filaEstado = [];
  let estadoCompleto = null;
  // Última leitura crua do estado: a aba Controle usa só se o estado mesclado ainda não existir.
  let estadoCru = {};
  let ritmoHunt = null;
  import('/shared/estado-delta.mjs').then((m) => {
    mesclador = m.criarMescladorDeEstado();
    for (const parte of filaEstado.splice(0)) mesclarEstado(parte);
  }).catch(() => { filaEstado = null; });
  function mesclarEstado(parte) {
    if (!mesclador) { if (filaEstado) filaEstado.push(parte); return; }
    try { const eu = mesclador(parte); if (eu) estadoCompleto = eu; } catch { /* pedaço fora de ordem */ }
  }

  // Catálogo de espécies com a MESMA receita do jogo (carregarCatalogoEspecies do app.js, que espelha o
  // content.mjs do servidor): espelho + novos + Outland novos + formas (Rattata de Alola #4019, Heat Rotom
  // #8479…), renumeração da Outland legada para #2001+, looktypes do lab, auditoria dos atributos base e as
  // variantes da Outland herdando os atributos da espécie-base. Os módulos de /shared são os do próprio jogo.
  // Sem as formas e sem a renumeração, hunts com espécies novas davam erro no cálculo e sumiam da aba.
  let tiposDasEspecies = null;
  async function carregarTipos() {
    if (tiposDasEspecies) return tiposDasEspecies;
    const baixarJson = (arq) => fetch(`/assets/${arq}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [base, novos, outland, formas, lab, ovr] = await Promise.all(['creatures.json', 'creatures-novos.json',
      'creatures-outland-novos.json', 'creatures-formas.json', 'creatures-sprites-lab.json', 'creatures-audit-overrides.json'].map(baixarJson));
    const lista = [];
    for (const j of [base, novos, outland, formas]) if (j && Array.isArray(j.creatures)) lista.push(...j.creatures.map((c) => ({ ...c })));
    try { (await import('/shared/outland.mjs')).aplicarRemapOutlandLista(lista); } catch { /* módulo mudou: segue sem renumerar */ }
    const acharTodos = (id) => lista.filter((c) => c.pokeId === id);
    for (const p of (lab && lab.patches) || []) for (const c of acharTodos(p.pokeId)) if (p.looktype) c.looktype = p.looktype;
    for (const o of (ovr && ovr.overrides) || []) {
      for (const c of acharTodos(o.pokeId)) {
        for (const k of ['baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed']) if (typeof o[k] === 'number') c[k] = o[k];
        if (Array.isArray(o.attacks)) c.attacks = o.attacks.map((x) => ({ ...x }));
      }
    }
    try { (await import('/shared/herdar-base-outland.mjs')).herdarBaseOutland(lista); } catch { /* idem */ }
    // Como no jogo, a última ficha de cada número vale (o laço do app.js faz especies.set em ordem).
    const mapa = new Map();
    for (const c of lista) if (c && c.pokeId) mapa.set(c.pokeId, { ...c, tipos: [c.type1, c.type2].filter(Boolean), nome: c.name || '' });
    return (tiposDasEspecies = mapa);
  }


  // A aba do mapa de uma hunt, pela mesma regra do jogo: a hunt que declara `regiao` manda nela; a
  // Outland vai pela área; o resto pela geração do pokémon com mais pontos de spawn, dentro da área
  // (Kanto e Johto na área kanto; Hoenn em diante na área orre).
  const FAIXA_GERACAO = [[1, 151, 'kanto'], [152, 251, 'johto'], [252, 386, 'hoenn'], [387, 493, 'sinnoh'], [494, 649, 'unova'],
    [650, 721, 'kalos'], [722, 809, 'alola'], [810, 905, 'galar'], [906, 1025, 'paldea']];
  function regiaoDaHunt(h) {
    if (h.regiao) return h.regiao;
    if (h.area === 'outland') return 'outland';
    const peso = new Map();
    for (const e of h.especies || []) {
      const id = Number(e.pokeId);
      const dex = id <= 1025 ? id : id % 1000;
      const g = (FAIXA_GERACAO.find(([a, b]) => dex >= a && dex <= b) || [])[2];
      if (g) peso.set(g, (peso.get(g) || 0) + (Number(e.pontos) || 1));
    }
    let ger = ''; let max = -1;
    for (const [g, n] of peso) if (n > max) { ger = g; max = n; }
    if (h.area === 'kanto') return ger === 'johto' ? 'johto' : 'kanto';
    return ger && ger !== 'kanto' && ger !== 'johto' ? ger : 'hoenn';
  }

  // As regiões do mapa do jogo, na ordem em que aparecem, com o nível que o treinador precisa para entrar.
  const REGIOES = [
    { id: 'kanto', rotulo: 'Kanto', nivel: 1 }, { id: 'outland', rotulo: 'Outland', nivel: 150 },
    { id: 'johto', rotulo: 'Johto', nivel: 200 }, { id: 'hoenn', rotulo: 'Hoenn', nivel: 500 },
    { id: 'sinnoh', rotulo: 'Sinnoh', nivel: 1000 }, { id: 'unova', rotulo: 'Unova', nivel: 5000 },
    { id: 'kalos', rotulo: 'Kalos', nivel: 10000 }, { id: 'alola', rotulo: 'Alola', nivel: 25000 },
    { id: 'galar', rotulo: 'Galar', nivel: 40000 }, { id: 'paldea', rotulo: 'Paldea', nivel: 75000 }
  ];

  // Degrau da Outland que vale para a conta (o escolhido, podado pelo nível), como na ficha do jogo.
  function degrauOutland(tiers, eu) {
    const nivel = Number(eu.level) || 0;
    const escolhido = tiers.find((x) => x.tier === Number(eu.outlandTier)) || tiers[0];
    if (escolhido && nivel >= escolhido.nivel) return escolhido;
    for (let i = tiers.length - 1; i >= 0; i--) if (nivel >= tiers[i].nivel) return tiers[i];
    return tiers[0] || { tier: 1, mult: 1, rotulo: 'Outland 1' };
  }

  async function analisarHunts() {
    const an = await import('/hunt-analyser.mjs');
    let tiersPadrao = []; let chanceOvo = () => 0;
    try { tiersPadrao = (await import('/shared/outland-tiers.mjs')).OUTLAND_TIERS || []; } catch { /* sem a tabela */ }
    try { chanceOvo = (await import('/shared/ovo-shiny.mjs')).chanceFragmentoOvoShiny || chanceOvo; } catch { /* sem o ovo */ }
    let diagonal = {};
    try { diagonal = (await import('/shared/tipo-efetividade.mjs')).DIAGONAL_DE_TIPOS || {}; } catch { /* sem diagonal */ }
    const catalogo = await carregarTipos();
    const eu = estadoCompleto || {};
    const nivelTreinador = Number(eu.level ?? perfil.nivel) || 0;
    const tiers = dadosHunts.outlandTiers || tiersPadrao;
    const degrau = degrauOutland(tiers, eu);
    const mult = Number(degrau && degrau.mult) || 1;
    const rotuloDegrau = (degrau && degrau.rotulo) || `Outland ${degrau ? degrau.tier : 1}`;
    const ctx = {
      especies: catalogo, tabelaTipos: dadosHunts.tabelaTipos || {}, eu,
      tiposBoost: dadosHunts.tiposBoost || [], farmEventoPct: Number(eu.evento && eu.evento.farmPct) || 0
    };
    const saida = [];
    for (const h of huntsPorSlug.values()) {
      if (!h || !Array.isArray(h.especies) || !h.especies.length || h.slug === 'centro_pokemon') continue;
      // O pokémon principal (mais pontos de spawn) define as fraquezas e resistências da ficha.
      const principal = [...h.especies].sort((a, b) => b.pontos - a.pontos)[0];
      const espPrincipal = catalogo.get(principal && principal.pokeId) || {};
      let r;
      try {
        const faltam = h.especies.filter((e) => !catalogo.has(e.pokeId)).map((e) => e.nome || e.pokeId);
        if (faltam.length) throw new Error(`espécie fora do catálogo: ${faltam.slice(0, 3).join(', ')}`);
        r = an.analisarHunt(h, ctx, espPrincipal.tipos || []);
      } catch (err) {
        // Antes a hunt sumia sem aviso. Agora fica registrada (Registro e telemetria-debug.json) para corrigir.
        diag.huntsComErro = diag.huntsComErro || {};
        if (!diag.huntsComErro[h.slug]) { diag.huntsComErro[h.slug] = String(err && err.message || err); log('aviso', `Hunts: não deu para calcular ${h.nome || h.slug} (${diag.huntsComErro[h.slug]}).`); postar('diagnostico', diag); }
        continue;
      }
      const nivel = Number(h.nivel ?? h.level) || 0;
      // Drops de cada espécie (do mais comum ao mais raro) e, na Outland, os raros pelo degrau da conta.
      const drops = h.especies.map((e) => {
        const esp = catalogo.get(e.pokeId);
        const itens = esp ? an.listaDropsEspecie(esp).slice(0, 8).map((d) => ({ n: d.name, pct: d.pct })) : [];
        return { pokeId: e.pokeId, nome: (esp && esp.name) || e.nome || '', itens };
      }).filter((d) => d.itens.length);
      const raros = [];
      if (h.area === 'outland') {
        raros.push({ n: 'Bronze Boss Token', chance: (dadosHunts.chanceBossToken ?? 0.0005) * mult });
        raros.push({ n: 'Fragmento de Chave', chance: (dadosHunts.chanceFragChave ?? 0.000005) * mult });
        raros.push({ n: 'Fragmento de Shiny Stone', chance: (dadosHunts.chanceFragShiny ?? 0.000005) * mult });
        raros.push({ n: 'Fragmento de Bicicleta', chance: (dadosHunts.chanceFragBicicleta ?? 0.000005) * mult });
      }
      const ovo = Number(chanceOvo({ area: h.area, nivel })) || 0;
      if (ovo > 0) raros.push({ n: 'Fragmento de Ovo Shiny', chance: ovo });
      saida.push({
        slug: h.slug, nome: h.nome || h.name || h.slug, area: h.area || '', regiao: regiaoDaHunt(h),
        nivel, liberada: nivel <= nivelTreinador || nivelTreinador === 0,
        xpTrH: r.xpTreinadorH, xpPkH: r.xpPokemonH, goldH: r.goldH, killsH: r.killsH,
        fracos: r.tiposFracos || [], resiste: r.tiposResiste || [], tiposPrincipal: espPrincipal.tipos || [],
        drops, raros,
        // As espécies da hunt com os tipos: a central calcula a vantagem do pokémon que você escolher.
        especies: h.especies.map((e) => {
          const c = catalogo.get(e.pokeId) || {};
          return { pokeId: e.pokeId, pontos: e.pontos, nome: c.nome || '', tipos: c.tipos || [] };
        }),
        atual: h.slug === perfil.huntSlug
      });
    }
    // Ritmo real: abates/h desde que a conta entrou na hunt atual (só depois de 3 min, antes disso é ruído).
    let ritmo = null;
    if (ritmoHunt && ritmoHunt.slug === perfil.huntSlug && Date.now() - ritmoHunt.em >= 180_000) {
      const killsReal = ((T.abates - ritmoHunt.abates) / (Date.now() - ritmoHunt.em)) * 3_600_000;
      const daAtual = saida.find((x) => x.atual);
      if (daAtual && daAtual.killsH) ritmo = { killsReal: Math.round(killsReal), fator: Math.round((killsReal / daAtual.killsH) * 100) / 100, slug: perfil.huntSlug };
    }
    // Seus pokémons (equipe e depot), do mais alto para o mais baixo, para escolher qual avaliar.
    const ativoId = eu.activeId ?? ativo.id;
    const pokemons = (Array.isArray(eu.pokemons) ? eu.pokemons : [])
      .filter((x) => x && x.id != null)
      .map((x) => ({ id: x.id, nome: x.apelido || x.nome || '', speciesId: x.speciesId, nivel: Number(x.level) || 0, tipos: x.tipos || [], shiny: Boolean(x.shiny), ativo: x.id === ativoId }))
      .sort((a, b) => Number(b.ativo) - Number(a.ativo) || b.nivel - a.nivel)
      .slice(0, 300);
    return { hunts: saida, nivelTreinador, pokemons, ativoId, tabelaTipos: ctx.tabelaTipos, diagonal, ritmo, outland: { tier: degrau && degrau.tier, rotulo: rotuloDegrau, mult }, em: Date.now() };
  }




  // "Parasect · Kanto · Nv 50" / "Furious Scizor · Outland 2 · Nv 150": o mesmo jeito do Modo Economia.
  // O número da Outland só entra em hunt da Outland (o tier fica guardado no estado mesmo fora dela).
  function descreverHunt() {
    const slug = perfil.huntSlug;
    if (!slug) return '';
    if (slug === 'centro_pokemon') return 'Centro Pokémon';
    const h = huntsPorSlug.get(slug);
    const nome = (h && (h.nome || h.name)) || perfil.huntNome || titulo(slug);
    if (!h) return nome;
    const area = String(h.area || h.regiao || '');
    const regiao = area === 'outland' ? `Outland ${perfil.outlandTier || 1}` : titulo(h.regiao || area);
    const nivel = primeiroNumero(h.nivel, h.level, h.nivelRecomendado);
    return [nome, regiao, nivel ? `Nv ${nivel.toLocaleString('pt-BR')}` : null].filter(Boolean).join(' · ');
  }

  // Drops raros do Dashboard. Primeiro pelo id do item (os fragmentos têm id fixo no jogo), depois pelo nome,
  // sem acento. Os nomes do jogo vêm em inglês: "Bicycle Fragment" antes não casava com "bicicleta"/"bike", e
  // "Mega Shiny Stone Fragment" era contado como fragmento de Shiny Stone.
  const DROP_POR_ID = { 70011: 'chave', 70012: 'shinyStone', 70013: 'bike', 70017: 'ovoShiny' };
  function classificarDrop(d, qtd) {
    const porId = DROP_POR_ID[Number(d && (d.itemId ?? d.id))];
    if (porId) { T.drops[porId] += qtd; return; }
    const n = String(nomeDoItem(d) || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (n.includes('boss token')) T.drops.boss += qtd;
    else if (n.includes('mystic ticket')) T.drops.mystic += qtd;
    else if (n.includes('ovo shiny') || n.includes('shiny egg')) T.drops.ovoShiny += qtd;
    else if (n.includes('mega')) { /* fragmentos de Mega Stone não entram nos raros do Dashboard */ }
    else if (n.includes('shiny stone')) T.drops.shinyStone += qtd;
    else if (n.includes('chave') || n.includes('key fragment')) T.drops.chave += qtd;
    else if (/bicicleta|bicycle|bike/.test(n) && /fragment/.test(n)) T.drops.bike += qtd;
    else if (/fragment|token|ticket/.test(n)) {
      // Raro que o app ainda não conhece: fica no diagnóstico (telemetria-debug.json) para ajustar.
      diag.dropsSemClasse = diag.dropsSemClasse || {};
      if (!(n in diag.dropsSemClasse) && Object.keys(diag.dropsSemClasse).length < 40) { diag.dropsSemClasse[n] = Number(d && (d.itemId ?? d.id)) || null; postar('diagnostico', diag); }
    }
  }

  const nomeDoItem = (d) => d.nome || d.name || d.itemNome || S.itens[d.itemId] || '';
  const ehShiny = (e) => Boolean(e.shiny || e.isShiny || e.lookShiny || (e.pokemon && (e.pokemon.shiny || e.pokemon.isShiny)));

  function primeiraVez(chave) {
    const agora = Date.now();
    if (vistos.has(chave) && agora - vistos.get(chave) < 5000) return false;
    vistos.set(chave, agora);
    if (vistos.size > 300) for (const [k, em] of vistos) if (agora - em > 10000) vistos.delete(k);
    return true;
  }

  function aoEventoBatalha(e) {
    const k = String(e.k || e.t || '');
    if (k && !diag.eventos[k] && Object.keys(diag.eventos).length < 60) {
      diag.eventos[k] = JSON.stringify(e).slice(0, 300);
      postar('diagnostico', diag);
    }
    const alvo = (e.pokemon && e.pokemon.id) || e.slot || e.s || '';

    if (k === 'hunt' && e.slug) { perfil.huntSlug = e.slug; perfil.huntNome = e.nome || ''; ritmoHunt = { slug: e.slug, em: Date.now(), abates: T.abates }; }
    else if (k === 'centro') perfil.huntSlug = 'centro_pokemon';

    // HP do nosso pokémon: o golpe do selvagem traz o HP que sobrou no alvo (o nosso).
    if (k === 'ataque' && e.por === 'selvagem' && typeof e.hpAlvo === 'number') ativo.hp = e.hpAlvo;
    if (k === 'levelup' && e.quem === 'pokemon' && (e.id == null || e.id === ativo.id) && typeof e.level === 'number') ativo.nivel = e.level;
    if (k === 'bola') {
      // Cada arremesso gasta uma bola: é o número exato do "Gastos" do jogo.
      T.gastos.bolas++;
      if (e.ballId != null) T.gastos.porBola[e.ballId] = (T.gastos.porBola[e.ballId] || 0) + 1;
    }
    if (k === 'morte' && e.quem === 'selvagem' && e.slot != null && !e.safari) anotarCaidos([{ s: e.slot, xr: 30000 }]);
    if (k === 'bola') aoResultadoBola(e);
    if (k === 'capturado') aoCapturado(e);
    if (k === 'bola' && e.ballId != null) {
      estoque.ultimaBola = Number(e.ballId);
      if (estoque.bola && estoque.bola.id === estoque.ultimaBola && estoque.bola.qtd > 0) estoque.bola.qtd--;
    }

    if ((k === 'morte' || k === 'kill' || k === 'derrota' || k === 'monstro_morto') && (!e.quem || e.quem === 'selvagem')) {
      T.abates++;
      const xpTr = Number(e.xpTreinador ?? e.xp ?? 0);
      const xpPk = Number(e.xpPokemon ?? e.xp ?? 0);
      if (xpTr > 0) { perfil.evXp = true; T.xpTreinador += xpTr; }
      if (xpPk > 0) T.xpPokemon += xpPk;
      const ouro = Number(e.ouro ?? e.gold ?? 0);
      if (ouro > 0) { perfil.evOuro = true; T.goldGanho += ouro; }
      if (Array.isArray(e.drops)) for (const d of e.drops) if (d) classificarDrop(d, Number(d.qtd || d.quantidade || 1));
    } else if (k === 'xp') {
      const v = Number(e.qtd || e.valor || e.xp || 0);
      if (v > 0 && (e.tipo === 'treinador' || e.dest === 'treinador')) { if (!perfil.evXp) T.xpTreinador += v; }
      else if (v > 0) T.xpPokemon += v;
    } else if (k === 'drop' || k === 'item') {
      classificarDrop(e, Number(e.qtd || e.quantidade || 1));
    }

    // Avisos do sorteio (INFERIDO, sem captura do jogo). Não trazem id: valem para o último disparo.
    if (k === 'aviso' && e.msg === 'market.sorteio' && S.ultimoDisparo) log('info', 'Entrou no sorteio do anúncio.', { id: S.ultimoDisparo.id });
    if (k === 'aviso' && e.msg === 'market.sorteioPerdeu' && S.ultimoDisparo) fecharSorteio(S.ultimoDisparo.id, 'perdeu', 'Sorteio perdido (aviso do jogo)');

    // O shiny só se revela no arremesso da bola: é aí que ele conta como "visto".
    if (k === 'bola' && ehShiny(e) && primeiraVez('visto:' + alvo)) T.shiniesVistos++;
    const capturou = k === 'capturado' || k === 'captura' || k === 'catch' || (k === 'bola' && (e.sucesso === true || e.sucesso === 1 || e.success));
    if (capturou && primeiraVez('cap:' + alvo)) {
      T.capturas++;
      if (ehShiny(e)) {
        T.shiniesCapturados++;
        if (T.shiniesVistos < T.shiniesCapturados) T.shiniesVistos = T.shiniesCapturados;
      }
    }
  }

  // Taxa por hora: janela dos últimos 15 min (ou a sessão inteira, se for mais curta).
  function porHora(campo) {
    const agora = Date.now();
    const janela = T.amostras.filter((a) => agora - a.em <= 15 * 60_000);
    const base = janela.length ? janela[0] : { em: T.inicio, gold: 0, xp: 0 };
    const dt = agora - base.em;
    if (dt < 30_000) return null;
    const atual = campo === 'gold' ? T.goldGanho : T.xpTreinador;
    return Math.round(((atual - base[campo]) / dt) * 3_600_000);
  }
  setInterval(() => {
    T.amostras.push({ em: Date.now(), gold: T.goldGanho, xp: T.xpTreinador });
    if (T.amostras.length > 40) T.amostras.shift();
  }, 30_000);

  function aoMercado(p) {
    const aba = p.aba || '';
    if (aba === 'historicoGlobal') return aoHistoricoGlobal(p);
    if (aba.startsWith('historico') || aba === 'meus' || aba === 'cancelado') return;

    if (aba === 'itens' && p.resumo) {
      // As médias chegam por categoria: junta, para não perder as das outras.
      if (p.medias && typeof p.medias === 'object') S.medias = { ...(S.medias || {}), ...p.medias };
      if (coleta && coleta.atual && !ehResumoGeral(p.resumo)) aoResumoDaColeta(p);
      if (!S.ativo && !S.radar) return;
      pedirItensAbaixoDaMedia(p.resumo);
      for (const r of regrasAtivas('item')) {
        if (r.modo === 'media') continue;
        const id = Number(r.itemId) || idPorNome(r.alvo);
        if (!id) continue;
        const resumo = p.resumo[id] || p.resumo[String(id)];
        if (!resumo) continue;
        if (Number(r.maxGold) > 0 && Number(resumo.minGold) > 0 && resumo.minGold <= r.maxGold) {
          enviar({ t: 'market.item', itemId: id, moeda: 'gold' });
        }
        if (Number(r.maxGemas) > 0 && Number(resumo.minOrb) > 0 && resumo.minOrb <= r.maxGemas) {
          enviar({ t: 'market.item', itemId: id, moeda: 'orb' });
        }
      }
      return;
    }

    let lista = [];
    if (aba === 'item' && Array.isArray(p.linhas)) {
      const itemId = Number(p.itemId || 0);
      lista = p.linhas.map((l) => ({ ...l, itemId: l.itemId || itemId, moeda: l.moeda || p.moeda }));
    } else {
      for (const k of ['anuncios', 'itens', 'linhas']) if (Array.isArray(p[k])) lista = lista.concat(p[k]);
      if (p.anuncio && typeof p.anuncio === 'object') lista.push(p.anuncio);
    }
    if ((S.ativo || S.radar) && lista.length) avaliar(lista);
  }

  // ---------------------------------------------------------- Histórico global do mercado (aba Mercado)
  // A central pede a página 0 de tempos em tempos, só com a aba Mercado aberta. O formato da resposta é
  // INFERIDO (não há captura): cada linha é validada sozinha, e uma linha ruim sai sem derrubar a página.
  // Quando o formato não bate, o exemplo vai para o arquivo de depuração (telemetria-debug.json).
  function aoHistoricoGlobal(p) {
    if (Number(p.pagina) > 0) return;
    if (!Array.isArray(p.linhas)) amostrar('historicoEnvelope', p);
    const brutas = Array.isArray(p.linhas) ? p.linhas : [];
    amostrar('historicoGlobal', brutas[0]);
    const linhas = [];
    let descartadas = 0;
    for (const l of brutas) {
      const v = validarLinhaGlobal(l);
      if (v) linhas.push(v);
      else { descartadas++; amostrar('historicoDescartado', l); }
    }
    postar('historicoGlobal', { pagina: 0, temMais: Boolean(p.temMais), linhas, descartadas, em: Date.now() });
  }

  // Uma linha do histórico global, ou nulo se não bater com o formato. Vendedor e comprador não saem
  // daqui: são dados de outros jogadores e a tela não precisa deles.
  function validarLinhaGlobal(l) {
    if (!l || typeof l !== 'object') return null;
    const id = Number(l.id);
    const moeda = l.moeda === 'gold' || l.moeda === 'orb' ? l.moeda : null;
    const bruto = Number(l.bruto);
    let em = Number(l.em);
    // Pelo formato provável, em é milissegundos. Se vier em segundos, converte.
    if (Number.isFinite(em) && em > 1e9 && em < 1e11) em *= 1000;
    if (!(Number.isInteger(id) && id > 0) || !moeda || !(bruto >= 0) || !(em >= 1e12)) return null;
    return {
      id, tipo: typeof l.tipo === 'string' ? l.tipo : '', moeda,
      descricao: typeof l.descricao === 'string' ? l.descricao.slice(0, 200) : '',
      bruto: Math.round(bruto), em: Math.round(em),
      nome: l.ficha && typeof l.ficha.nome === 'string' ? l.ficha.nome.slice(0, 80) : ''
    };
  }

  // Pedido da central. Sem conexão com o jogo, avisa a central para mostrar "indisponível".
  function pedirHistoricoGlobal() {
    if (!enviar({ t: 'market.historicoGlobal', pagina: 0 })) postar('historicoGlobal', { falhou: true, em: Date.now() });
  }

  // ---------------------------------------------------------- Regras
  const norm = (s) => String(s || '').trim().toLowerCase();

  // Nome do item → id. Procura nos itens que a conta recebeu do jogo, nos que apareceram em anúncios do
  // mercado e no catálogo público (/assets/items.json). Antes só a lista da conta valia: um item do RMT que não
  // está nela (ex.: "AoE TM Disk Piece", id 40530) deixava a regra sem id, e o sniper nunca pedia os anúncios.
  const itensPublicos = new Map(); // nome normalizado -> id
  fetch('/assets/items.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
    for (const it of (j && (j.items || j)) || []) if (it && it.id && it.name) itensPublicos.set(norm(it.name), Number(it.id));
  }).catch(() => {});
  function idPorNome(nome) {
    const alvo = norm(nome);
    if (!alvo) return 0;
    for (const [id, n] of Object.entries(S.itens)) if (norm(n) === alvo) return Number(id);
    return itensPublicos.get(alvo) || 0;
  }

  // Regras em jogo agora: as do sniper (se ligado) e o radar de ofertas da aba Mercado (se ligado).
  function regrasEmJogo() {
    const lista = S.ativo ? S.regras.slice() : [];
    if (S.radar) lista.push(S.radar);
    return lista;
  }
  function regrasAtivas(tipo) {
    return regrasEmJogo().filter((r) => r.ativa && r.tipo === tipo && r.tipo !== 'diamante' && !(Number(r.maxQtd) > 0 && (r.compradas || 0) >= r.maxQtd));
  }

  function lerAnuncio(a) {
    const ficha = a.ficha || {};
    const itemId = Number(a.itemId || ficha.itemId || 0);
    // Diamantes saíram do mercado do jogo; se algum anúncio de diamante aparecer, ele não vira pokémon nem item.
    const ehDiamante = a.tipo === 'diamante' || Boolean(ficha.diamante);
    const ehItem = !ehDiamante && (itemId > 0 || a.tipo === 'item' || Boolean(a.itemNome));
    // Anúncio de item com nome: o app aprende o nome daquele id (serve para regras escritas pelo nome).
    if (ehItem && itemId && !S.itens[itemId] && (ficha.nome || a.itemNome)) S.itens[itemId] = ficha.nome || a.itemNome;
    const nome = ehDiamante ? 'Diamantes' : ehItem
      ? (S.itens[itemId] || a.itemNome || a.nome || `Item #${itemId}`)
      : (a.pokemonNome || ficha.nome || a.nome || '');
    const notaBruta = ficha.nota ?? a.nota;
    const ivs = ficha.ivs || a.ivs;
    const ivTotal = primeiroNumero(ficha.ivTotal, a.ivTotal, ivs && typeof ivs === 'object'
      ? Object.values(ivs).reduce((t, v) => t + (Number(v) || 0), 0) : undefined);
    if (!ehItem) amostrar('anuncioPokemon', a);
    return {
      speciesId: Number(ficha.speciesId ?? a.speciesId ?? a.especieId ?? 0),
      nivel: primeiroNumero(ficha.level, a.level, ficha.nivel, a.nivel),
      qualidade: primeiroNumero(ficha.quality, a.quality, ficha.qualidade, a.qualidade),
      ivTotal: ivTotal ?? null,
      tmElemental: Boolean(ficha.tmElemental || a.tmElemental),
      tmAoe: Boolean(ficha.tmAoe || a.tmAoe),
      id: Number(a.id),
      ehItem,
      ehDiamante,
      itemId,
      nome,
      preco: Number(a.preco) || 0,
      qtd: Number(a.qtd) || 1,
      moeda: norm(a.moeda || 'gold'),
      compravelEm: Number(a.compravelEm || 0),
      shiny: Boolean(a.shiny || ficha.shiny || a.isShiny || ficha.isShiny),
      potencia: Number(a.potencia || ficha.potencia || 1),
      nota: notaBruta == null ? null : Number(notaBruta),
      aberto: !(a.estado && a.estado !== 'aberto') && !a.comprador
    };
  }

  // Faixa mín–máx: campo vazio não filtra; valor desconhecido no anúncio não passa num filtro ligado.
  const temValor = (v) => v !== '' && v != null && isFinite(Number(v)) && Number(v) !== 0;
  function dentro(valor, min, max) {
    if (temValor(min) && !(valor != null && valor >= Number(min))) return false;
    if (temValor(max) && !(valor != null && valor <= Number(max))) return false;
    return true;
  }
  // Pela numeração do jogo: variantes de Outland são #2001–#2999, Megas #3001–#3999, cópias de Orre 13000 + dex.
  const dexBase = (id) => (id > 13000 && id < 14100 ? id - 13000 : id);
  const ehOutland = (an) => an.speciesId >= 2001 && an.speciesId <= 2999;
  const ehMega = (an) => (an.speciesId >= 3001 && an.speciesId <= 3999) || /^mega /i.test(an.nome);
  const LENDARIOS = new Set([144, 145, 146, 150, 151, 243, 244, 245, 249, 250, 251, 377, 378, 379, 380, 381, 382, 383, 384, 385,
    386, 480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, 494, 638, 639, 640, 641, 642, 643, 644, 645, 646,
    647, 648, 649, 716, 717, 718, 719, 720, 721, 772, 773, 785, 786, 787, 788, 789, 790, 791, 792, 793, 794, 795, 796, 797, 798,
    799, 800, 801, 802, 803, 804, 805, 806, 807, 808, 809, 888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898, 905, 1001, 1002,
    1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1014, 1015, 1016, 1017, 1024, 1025]);
  const ehLendario = (an) => LENDARIOS.has(dexBase(an.speciesId));

  // ---------------------------------------------------------- Regra "abaixo da média"
  // Média de venda de 7 dias do item na moeda do anúncio: { media, unidades } (vem no resumo da vitrine).
  const mediaDe = (itemId, moeda) => {
    const m = S.medias && (S.medias[itemId] || S.medias[String(itemId)]);
    const x = m && m[moeda];
    return x && Number(x.media) > 0 ? { media: Number(x.media), unidades: Number(x.unidades) || 0 } : null;
  };
  const moedaAceita = (regra, moeda) => (regra.moedaMedia || 'orb') === 'ambas' || (regra.moedaMedia || 'orb') === moeda;
  // Preço máximo aceito: média × (1 − desconto), e só se a média tiver vendas suficientes na semana.
  function limiteDaMedia(regra, itemId, moeda) {
    if (!moedaAceita(regra, moeda)) return null;
    const m = mediaDe(itemId, moeda);
    if (!m || m.unidades < (Number(regra.minVendas) || 0)) return null;
    const desconto = Math.min(95, Math.max(1, Number(regra.desconto) || 30));
    let limite = Math.floor(m.media * (1 - desconto / 100));
    const teto = Number(moeda === 'orb' ? regra.maxGemas : regra.maxGold) || 0;
    if (teto > 0) limite = Math.min(limite, teto);
    return limite > 0 ? limite : null;
  }
  const regraDoItem = (regra, itemId, nome) => {
    const id = Number(regra.itemId) || idPorNome(regra.alvo);
    if (regra.modo === 'media' && !id && !regra.alvo) return true; // qualquer item do RMT
    return id ? id === itemId : norm(regra.alvo) === norm(nome);
  };

  // Pelo resumo (o menor preço de cada item), pede os vendedores só dos itens que já estão abaixo do limite.
  function pedirItensAbaixoDaMedia(resumo) {
    const pedidos = [];
    for (const r of regrasAtivas('item')) {
      if (r.modo !== 'media') continue;
      for (const [chave, res] of Object.entries(resumo)) {
        const id = Number(chave);
        if (!res || !regraDoItem(r, id, S.itens[id])) continue;
        for (const [moeda, campo] of [['orb', 'minOrb'], ['gold', 'minGold']]) {
          const limite = limiteDaMedia(r, id, moeda);
          if (limite && Number(res[campo]) > 0 && Number(res[campo]) <= limite && !pedidos.some((x) => x.id === id && x.moeda === moeda)) {
            pedidos.push({ id, moeda });
          }
        }
      }
    }
    // Poucos pedidos por varredura, espaçados, para não martelar o servidor.
    pedidos.slice(0, 8).forEach((x, n) => setTimeout(() => enviar({ t: 'market.item', itemId: x.id, moeda: x.moeda }), 250 * n));
  }

  function casa(regra, an) {
    // Diamantes saíram do Mercado da Comunidade: regras antigas do tipo 'diamante' não casam com nada.
    if (regra.tipo === 'diamante') return false;
    if (regra.tipo === 'item') {
      if (!an.ehItem) return false;
      if (!regraDoItem(regra, an.itemId, an.nome)) return false;
      if (regra.modo === 'media') {
        const limite = limiteDaMedia(regra, an.itemId, an.moeda);
        return limite != null && an.preco <= limite;
      }
    } else {
      if (an.ehItem || an.ehDiamante) return false;
      if (regra.especieId && an.speciesId ? an.speciesId !== Number(regra.especieId) : (regra.alvo && norm(regra.alvo) !== norm(an.nome))) return false;
      if (regra.semOutland !== false && ehOutland(an)) return false;
      if (regra.soShiny && !an.shiny) return false;
      if (regra.soP5 && an.potencia < 5) return false;
      if (regra.soMega && !ehMega(an)) return false;
      if (regra.soLendario && !ehLendario(an)) return false;
      if (regra.soTmElemental && !an.tmElemental) return false;
      if (regra.soTmAoe && !an.tmAoe) return false;
      if (!dentro(an.nivel, regra.nivelMin, regra.nivelMax)) return false;
      if (!dentro(an.potencia, regra.potenciaMin, regra.potenciaMax)) return false;
      if (!dentro(an.ivTotal, regra.ivMin, regra.ivMax)) return false;
      if (!dentro(an.qualidade, regra.qualidadeMin, regra.qualidadeMax)) return false;
      if (!dentro(an.nota, regra.notaMin, regra.notaMax)) return false;
    }
    if (an.moeda === 'gold') return Number(regra.maxGold) > 0 && an.preco <= Number(regra.maxGold);
    if (an.moeda === 'orb') return Number(regra.maxGemas) > 0 && an.preco <= Number(regra.maxGemas);
    return false;
  }

  function saldoDe(moeda) {
    return moeda === 'gold' ? S.gold : moeda === 'orb' ? S.gemas : -1;
  }
  // Quanto já está comprometido em compras que ainda vão sair (aguardando a central, agendadas, ou disparadas
  // há menos de 20 s, que o jogo só desconta depois de confirmar). Sem isso, dois anúncios na mesma varredura
  // passavam do saldo.
  function reservado(moeda) {
    let total = 0;
    for (const p of S.pendentes.values()) if (p.an.moeda === moeda) total += p.an.preco * p.qtd;
    const agora = Date.now();
    for (const o of S.ofertas.values()) {
      if (o.moeda !== moeda || !o.custo) continue;
      if (o.estado === 'agendado' || (o.estado === 'disparado' && agora - (o.disparadoEm || 0) < 20_000)) total += o.custo;
    }
    return total;
  }

  function avaliar(lista) {
    for (const bruto of lista) {
      const an = lerAnuncio(bruto);
      if (!an.id || !an.aberto || S.ofertas.has(an.id)) continue;
      const regra = regrasEmJogo().find((r) => r.ativa && casa(r, an));
      if (!regra) continue;

      let qtd = an.ehItem || an.ehDiamante ? an.qtd : 1;
      if (Number(regra.maxQtd) > 0) qtd = Math.min(qtd, regra.maxQtd - (regra.compradas || 0));
      const saldo = saldoDe(an.moeda);
      if (saldo >= 0 && an.preco > 0) qtd = Math.min(qtd, Math.floor(Math.max(0, saldo - reservado(an.moeda)) / an.preco));
      if (qtd <= 0) {
        S.ofertas.set(an.id, { estado: 'sem_saldo', em: Date.now() });
        log('aviso', `${an.nome} por ${preco(an.preco)} ${rotuloMoeda(an.moeda)}: saldo ou limite da regra insuficiente.`, { id: an.id });
        continue;
      }
      if (regra.aprovar) sugerir(an, regra, qtd);
      else reivindicar(an, regra, qtd);
    }
  }

  // Regra com "pedir aprovação": a oferta vira sugestão na central e só é comprada se o jogador aprovar.
  const sugestoes = new Map(); // offerId -> { an, regra, qtd, em }
  function sugerir(an, regra, qtd) {
    S.ofertas.set(an.id, { estado: 'sugerido', em: Date.now(), regraId: regra.id });
    sugestoes.set(an.id, { an, regra, qtd, em: Date.now() });
    const md = an.ehItem ? mediaDe(an.itemId, an.moeda) : null;
    postar('sugestao', {
      id: an.id, nome: an.nome, itemId: an.itemId, preco: an.preco, moeda: an.moeda, qtd,
      media: md ? Math.round(md.media) : null, pctMedia: md ? Math.round((an.preco / md.media) * 100) : null,
      compravelEm: an.compravelEm || 0, agoraServidor: agoraServidor(), regraId: regra.id
    });
    log('info', `Sugestão: ${qtd}× ${an.nome} por ${preco(an.preco)} ${rotuloMoeda(an.moeda)}` +
      (md ? ` (${Math.round((an.preco / md.media) * 100)}% da média)` : '') + ' — aguardando sua aprovação.', { id: an.id });
    // Sugestão velha: o anúncio provavelmente já foi vendido.
    for (const [id, sg] of sugestoes) if (Date.now() - sg.em > 30 * 60_000) sugestoes.delete(id);
  }

  // A central arbitra entre as contas: cada anúncio só pode ser disputado por uma delas.
  function reivindicar(an, regra, qtd) {
    S.ofertas.set(an.id, { estado: 'aguardando', em: Date.now(), regraId: regra.id });
    S.pendentes.set(an.id, { an, regra, qtd });
    postar('reivindicar', { id: an.id });
  }

  const rotuloMoeda = (m) => (m === 'orb' ? 'Gemas' : 'Coins');

  // ---------------------------------------------------------- Histórico de sorteios
  const sorteios = new Map(); // offerId -> registro
  function abrirSorteio(reg) {
    const r = { ...reg, em: Date.now(), resultado: 'aguardando', motivo: '' };
    sorteios.set(reg.id, r);
    postar('sorteio', r);
    // Sem confirmação nem recusa em 20 s: o jogo não respondeu nada que o app reconheça.
    r.timer = setTimeout(() => fecharSorteio(reg.id, 'sem resposta', ''), 20_000);
  }
  function fecharSorteio(id, resultado, motivo, extra) {
    const r = sorteios.get(id);
    if (!r || r.resultado !== 'aguardando') return;
    clearTimeout(r.timer);
    r.resultado = resultado;
    r.motivo = motivo;
    // Dados que o jogo confirma no resultado (por exemplo, o total cobrado numa compra).
    Object.assign(r, extra || {});
    const { timer, ...publico } = r;
    postar('sorteio', publico);
    if (sorteios.size > 200) sorteios.delete(sorteios.keys().next().value);
  }
  const preco = (n) => Number(n).toLocaleString('pt-BR');

  // ---------------------------------------------------------- Disparo
  // Um pedido por anúncio, dentro da janela do sorteio, pelo relógio do SERVIDOR.
  function agendar(an, regra, qtd) {
    const reg = { estado: 'agendado', em: Date.now(), regraId: regra.id, timer: null, moeda: an.moeda, custo: an.preco * qtd };
    S.ofertas.set(an.id, reg);

    const aprovado = Boolean(regra.__aprovado);
    // Origem para o histórico de compras: o sniper automático, ou uma oferta que você aprovou.
    const origem = aprovado ? (regra.id === 'radar' ? 'radar aprovado' : 'regra aprovada') : 'sniper';
    const alvo = an.ehDiamante ? 'diamante' : an.ehItem ? 'item' : 'pokemon';
    const passo = () => {
      if (!S.ativo && !aprovado) { reg.estado = 'cancelado'; return; }
      const alvo = an.compravelEm ? an.compravelEm + S.margemMs : 0;
      const falta = alvo - agoraServidor();
      // Acorda 1 s antes para recalcular com o desvio mais recente; o disparo final é curto.
      if (falta > 1500) { reg.timer = setTimeout(passo, falta - 1000); return; }
      if (falta > 0) { reg.timer = setTimeout(disparar, falta); return; }
      disparar();
    };

    const disparar = () => {
      if (!aprovado) {
        if (!S.ativo) { reg.estado = 'cancelado'; return; }
        const r = S.regras.find((x) => x.id === regra.id);
        if (!r || !r.ativa) { reg.estado = 'cancelado'; return; }
      }
      const ok = enviar({ t: 'market.comprar', id: an.id, qtd, preco: an.preco, moeda: an.moeda });
      reg.estado = ok ? 'disparado' : 'falhou';
      if (ok) reg.disparadoEm = Date.now();
      if (!ok) { log('erro', `Sem conexão para comprar ${an.nome}.`, { id: an.id }); return; }
      S.ultimoDisparo = { id: an.id, regraId: regra.id, qtd, em: Date.now(), nome: an.nome, preco: an.preco, moeda: an.moeda, origem, alvo };
      const atraso = an.compravelEm ? agoraServidor() - an.compravelEm : null;
      const quando = atraso == null ? 'sem retenção'
        : atraso <= JANELA_SORTEIO_MS ? `+${Math.round(atraso)} ms após liberar (dentro do sorteio)`
        : `${atraso < 120_000 ? `${Math.round(atraso / 1000)} s` : `${Math.round(atraso / 60_000)} min`} após liberar (compra direta)`;
      log('disparo', `${qtd}× ${an.nome} por ${preco(an.preco)} ${rotuloMoeda(an.moeda)} — ${quando}`, { id: an.id });
      abrirSorteio({
        id: an.id, nome: an.nome, preco: an.preco, moeda: an.moeda, qtd, origem, alvo, regraId: regra.id,
        tipo: atraso != null && atraso <= JANELA_SORTEIO_MS ? 'sorteio' : 'direta'
      });
    };

    const espera = an.compravelEm ? Math.max(0, an.compravelEm - agoraServidor()) : 0;
    const md = an.ehItem ? mediaDe(an.itemId, an.moeda) : null;
    const daMedia = md ? ` (${Math.round((an.preco / md.media) * 100)}% da média de ${preco(Math.round(md.media))})` : '';
    log('agendado', `${an.nome} por ${preco(an.preco)} ${rotuloMoeda(an.moeda)}${daMedia}` +
      (espera > 0 ? ` — libera em ${Math.ceil(espera / 1000)} s` : ''), { id: an.id });
    passo();
  }

  // ---------------------------------------------------------- Varredura
  function varrer() {
    if (!S.ativo || !S.ws || S.ws.readyState !== 1) return;
    if (regrasAtivas('item').length) enviar({ t: 'market.itens' });
    regrasAtivas('pokemon').forEach((r, i) => {
      setTimeout(() => {
        if (!S.ativo) return;
        const faixa = (v) => (temValor(v) ? String(v) : '');
        enviar({
          t: 'market.listar',
          tipo: 'pokemon',
          ordem: 'recentes',
          moeda: '',
          busca: r.especieId ? '' : (r.alvo || ''),
          criterios: [],
          elementos: [],
          categoria: '',
          soShiny: Boolean(r.soShiny),
          soP5: Boolean(r.soP5),
          soMega: Boolean(r.soMega),
          soLendario: Boolean(r.soLendario),
          soTmElemental: Boolean(r.soTmElemental),
          soTmAoe: Boolean(r.soTmAoe),
          semOutland: r.semOutland !== false,
          nivelMin: faixa(r.nivelMin), nivelMax: faixa(r.nivelMax),
          potenciaMin: faixa(r.potenciaMin), potenciaMax: faixa(r.potenciaMax),
          ivMin: faixa(r.ivMin), ivMax: faixa(r.ivMax),
          qualidadeMin: faixa(r.qualidadeMin), qualidadeMax: faixa(r.qualidadeMax),
          notaMin: faixa(r.notaMin), notaMax: faixa(r.notaMax),
          pagina: 0,
          especieId: Number(r.especieId) || 0
        });
      }, 400 * (i + 1));
    });
    // Esquece anúncios antigos para não crescer sem limite.
    const corte = Date.now() - 10 * 60_000;
    for (const [id, o] of S.ofertas) if (o.em < corte && o.estado !== 'agendado') S.ofertas.delete(id);
  }

  function reiniciarVarredura() {
    clearInterval(S.timerVarredura);
    S.timerVarredura = null;
    if (!S.ativo) return;
    S.timerVarredura = setInterval(varrer, Math.max(10, Number(S.varreduraSeg) || 20) * 1000);
    varrer();
  }

  // ---------------------------------------------------------- Preços para a aba Mercado (só itens raros)
  // Uma categoria por vez, nas mesmas categorias do Mercado da Comunidade do jogo. A resposta de preços
  // não diz a categoria: por isso vai uma de cada vez. (Diamantes saíram do mercado do jogo.)
  const CATEGORIAS_RARAS = ['box', 'casa', 'bicicleta', 'skin', 'fragment', 'boss', 'ticket'];
  // O resumo de TODOS os itens (pedido do radar/sniper) traz os comuns, de id baixo; o das categorias raras, não.
  const ehResumoGeral = (resumo) => Object.keys(resumo).some((k) => Number(k) < 1000);
  let coleta = null;
  function coletarPrecos() {
    if (coleta) clearTimeout(coleta.timer);
    coleta = { fila: CATEGORIAS_RARAS.slice(), atual: null, resumo: {}, medias: {}, categoria: {}, emItens: {}, timer: null };
    proximaColeta();
  }
  function proximaColeta() {
    const c = coleta;
    if (!c) return;
    clearTimeout(c.timer);
    let ok;
    if (c.fila.length) {
      c.atual = c.fila.shift();
      ok = enviar({ t: 'market.itens', categoria: c.atual });
    } else {
      coleta = null;
      // emItens: a hora em que cada item chegou na resposta da sua categoria (a tabela mostra "há N min").
      postar('precos', { resumo: c.resumo, medias: c.medias, categoria: c.categoria, emItens: c.emItens, em: Date.now() });
      return;
    }
    if (!ok) { coleta = null; postar('precos', { erro: 'Conta sem conexão com o jogo.' }); return; }
    c.timer = setTimeout(proximaColeta, 5000); // sem resposta: segue para a próxima
  }
  function aoResumoDaColeta(p) {
    const c = coleta;
    Object.assign(c.resumo, p.resumo);
    Object.assign(c.medias, p.medias || {});
    const agora = Date.now();
    for (const k of Object.keys(p.resumo)) { c.categoria[k] = c.atual; c.emItens[k] = agora; }
    proximaColeta();
  }
  // ---------------------------------------------------------- Reposição automática (aba Captura)
  // Quando a bola ou a poção escolhida fica abaixo do limite, compra a quantidade escolhida na LOJA do
  // jogo, por Coins (o mesmo pedido do botão Comprar da loja: { t: 'shop.buy', kind, id, qty }). Só compra
  // se tiver Coins para o lote inteiro, espera o estoque subir antes de pedir de novo e respeita o limite
  // de compras por sessão (0 = sempre que precisar).
  const POCOES_LOJA = { 200: { nome: 'Small Potion', preco: 50 }, 201: { nome: 'Great Potion', preco: 150 }, 202: { nome: 'Ultra Potion', preco: 400 }, 203: { nome: 'Hyper Potion', preco: 800 }, 204: { nome: 'Ultimate Potion', preco: 1500 }, 70070: { nome: 'Golden Potion', preco: 2500 } };
  let lojaBolas = [];
  const itensInventario = {};
  const REP = {
    bola: { ativo: false, id: 1, abaixoDe: 50, qtd: 1000, limite: 0, compras: 0, pedidoEm: 0, estoqueAntes: null, aviso: null, ultima: null },
    pocao: { ativo: false, id: 200, abaixoDe: 50, qtd: 1000, limite: 0, compras: 0, pedidoEm: 0, estoqueAntes: null, aviso: null, ultima: null }
  };
  function produto(tipo, id) {
    if (tipo === 'bola') { const b = lojaBolas.find((x) => x.id === Number(id)); return b ? { nome: b.nome, preco: b.preco } : null; }
    return POCOES_LOJA[id] || null;
  }
  // O estoque vem do ESTADO COMPLETO da conta (o mesmo que o jogo usa: `eu.items[id] ?? 0`): item que não
  // aparece no inventário vale 0. Antes, poção zerada nunca era lida e a reposição nunca disparava.
  function estoqueDe(tipo, id) {
    const fonte = estadoCompleto && (tipo === 'bola' ? estadoCompleto.balls : estadoCompleto.items);
    if (fonte && typeof fonte === 'object') {
      const v = fonte[id] ?? fonte[String(id)];
      if (v == null) return 0;
      return typeof v === 'number' ? v : Number(v.qtd ?? v.quantidade ?? v.q ?? 0) || 0;
    }
    return tipo === 'bola' ? bolasInventario[id] : itensInventario[id];
  }
  function conferirReposicao() {
    if (!S.ws || S.ws.readyState !== 1) return;
    for (const tipo of ['bola', 'pocao']) {
      const r = REP[tipo];
      if (!r.ativo) continue;
      const tem = estoqueDe(tipo, r.id);
      if (tem == null) continue; // ainda não leu o inventário
      // Pedido em andamento: confirma quando o estoque sobe; sem subir em 20 s, libera para tentar de novo.
      if (r.pedidoEm) {
        if (tem > (r.estoqueAntes ?? tem)) {
          r.compras++;
          r.ultima = { qtd: r.qtd, em: Date.now() };
          r.pedidoEm = 0;
          log('comprado', `Reposição: comprou ${preco(r.qtd)}× ${produto(tipo, r.id)?.nome || ''} na loja (${r.compras}${r.limite ? '/' + r.limite : ''}).`);
          // Compra confirmada pelo aumento do estoque: entra no histórico de compras (em Coins).
          const comprado = produto(tipo, r.id);
          const precoUnit = comprado ? comprado.preco : 0;
          postar('compra', {
            id: `loja-${tipo}-${r.id}`, em: Date.now(), origem: 'reposição na loja', alvo: 'item', tipo: 'loja',
            nome: comprado ? comprado.nome : `Item ${r.id}`, qtd: r.qtd, preco: precoUnit, total: precoUnit * r.qtd,
            moeda: 'gold', resultado: 'ganhou'
          });
        } else if (Date.now() - r.pedidoEm > 20_000) {
          r.pedidoEm = 0;
          r.aviso = 'A loja não confirmou a última compra; tenta de novo em seguida.';
        }
        continue;
      }
      if (tem >= r.abaixoDe) { r.aviso = null; continue; }
      if (r.limite > 0 && r.compras >= r.limite) { r.aviso = `Limite de ${r.limite} compra(s) nesta sessão atingido.`; continue; }
      const prod = produto(tipo, r.id);
      if (!prod) { r.aviso = 'Este item não está à venda na loja.'; continue; }
      const custo = prod.preco * r.qtd;
      if (!(S.gold >= custo)) { r.aviso = `Sem Coins para ${preco(r.qtd)}× ${prod.nome} (precisa de ${preco(custo)}).`; continue; }
      if (!enviar({ t: 'shop.buy', kind: tipo === 'bola' ? 'ball' : 'item', id: Number(r.id), qty: Number(r.qtd) })) continue;
      r.pedidoEm = Date.now();
      r.estoqueAntes = tem;
      r.aviso = null;
      log('info', `Reposição: ${prod.nome} em ${preco(tem)} (abaixo de ${preco(r.abaixoDe)}), comprando ${preco(r.qtd)} por ${preco(custo)} Coins.`);
    }
  }
  setInterval(conferirReposicao, 3000);

  // ---------------------------------------------------------- Lançar bolas (aba Captura da central)
  // Uma bola em cada pokémon derrotado enquanto ele está caído no chão, com o mesmo pedido do clique
  // do jogo ({ t: 'ball.throw', ballId, slot }). O servidor aceita uma bola por caído: se ela falhar,
  // o pokémon foge. "Até capturar" desliga sozinho na primeira captura; "pra sempre" segue até você
  // desligar. Sem a bola escolhida, ou com a conta desconectada, fica em pausa e volta sozinho.
  // A bola sai NA HORA em que o pokémon cai (como o "Lançar sem Parar" do VIP); o intervalo mínimo só
  // evita mandar vários no mesmo milissegundo quando o time derruba vários de uma vez.
  const INTERVALO_LANCE_MS = 150;
  const bolasInventario = {};
  const CAP = {
    ativo: false, modo: 'capturar', ballId: 1,
    fila: [], jaLancou: new Map(), ultimo: 0, pausa: null,
    lancadas: 0, capturas: 0, chance: null, ultimaEm: 0, ultimaCaptura: null, desdeCaptura: 0,
    respostas: 0, perdidos: 0
  };

  function anotarCaidos(mobs) {
    if (!CAP.ativo || !Array.isArray(mobs)) return;
    const agora = Date.now();
    for (const m of mobs) {
      if (!m || m.s == null || !(Number(m.xr) > 3000)) continue;
      // O jogo reaproveita os slots: o mesmo número só vale de novo depois que o corpo anterior sumiu.
      const antes = CAP.jaLancou.get(m.s);
      if (antes && agora - antes < 32_000) continue;
      CAP.jaLancou.set(m.s, agora);
      CAP.fila.push({ slot: m.s, ate: agora + Number(m.xr) - 1500 });
    }
    lancarProxima();
  }

  function lancarProxima() {
    if (!CAP.ativo) return;
    const agora = Date.now();
    // Caído que passou do tempo sem levar bola: conta como perdido (aparece no rodapé da aba Captura).
    while (CAP.fila.length && CAP.fila[0].ate < agora) { CAP.fila.shift(); CAP.perdidos++; }
    if (agora - CAP.ultimo < INTERVALO_LANCE_MS) return;
    if (!CAP.fila.length) return;
    if (!((bolasInventario[CAP.ballId] || 0) > 0)) { CAP.pausa = 'sem_bola'; CAP.fila = []; return; }
    const { slot } = CAP.fila.shift();
    if (!enviar({ t: 'ball.throw', ballId: CAP.ballId, slot })) { CAP.pausa = 'desconectada'; CAP.fila = []; return; }
    CAP.pausa = null;
    CAP.ultimo = agora;
    CAP.ultimaEm = agora;
    CAP.lancadas++;
    CAP.desdeCaptura++;
  }
  setInterval(lancarProxima, 50);

  function aoResultadoBola(e) {
    if (CAP.ativo) CAP.respostas++;
    if (e.chance != null) CAP.chance = Number(e.chance);
    if (e.ballId != null && bolasInventario[e.ballId] > 0) bolasInventario[e.ballId]--;
  }

  function aoCapturado(e) {
    const pk = e.pokemon || {};
    if (CAP.ativo || CAP.desdeCaptura) {
      CAP.capturas++;
      CAP.ultimaCaptura = { nome: pk.nome || '', shiny: Boolean(pk.shiny), bolas: CAP.desdeCaptura, em: Date.now() };
      CAP.desdeCaptura = 0;
    }
    if (CAP.ativo && CAP.modo === 'capturar') {
      CAP.ativo = false;
      CAP.fila = [];
      log('comprado', `Captura: ${pk.nome || 'pokémon'} capturado. "Jogar até capturar" desligou sozinho.`);
      postar('captura', { desligou: true, ultimaCaptura: CAP.ultimaCaptura });
    }
    status();
  }

  // ---------------------------------------------------------- Controle pelo celular (aba Controle do painel)
  // A conta manda à central uma lista pronta (hunts, time, depósito e mochila), no máximo a cada 5 s e só
  // quando ela muda. O conteúdo não tem horário nem contador, para dar para comparar com a última enviada.
  const euDaConta = () => estadoCompleto || (estadoCru.eu || estadoCru.treinador || estadoCru);
  // Slots do time que o jogo aceita. O estado não traz o limite nem a base dos números: confirmar no jogo.
  const SLOTS_TIME = [1, 2, 3, 4, 5, 6];
  const nivelDoTreinador = () => Number(euDaConta().level ?? perfil.nivel) || 0;
  // Liberada quando o nível da hunt e o da região cabem no treinador (sem nível lido, libera tudo).
  const nivelDaRegiao = (id) => (REGIOES.find((r) => r.id === id) || { nivel: 0 }).nivel;
  const huntLiberada = (h) => {
    const n = nivelDoTreinador();
    if (n === 0) return true;
    return (Number(h.nivel ?? h.level) || 0) <= n && nivelDaRegiao(regiaoDaHunt(h)) <= n;
  };
  const pokemonsDaConta = () => (Array.isArray(euDaConta().pokemons) ? euDaConta().pokemons : []).filter((x) => x && x.id != null);
  const ativoDaConta = () => euDaConta().activeId ?? ativo.id;
  // Pokémon no time tem slot; sem slot, está no depósito.
  const naEquipe = (x) => primeiroNumero(x.slot) != null;
  const nomeDoPokemon = (x) => x.apelido || x.nome || x.especie || x.speciesName || x.name || 'Pokémon';
  const nomeDoItemControle = (id) => S.itens[id] || NOMES_POCAO[id] || (POCOES_LOJA[id] && POCOES_LOJA[id].nome) || `Item ${id}`;
  const nomeDaBola = (id) => BOLAS[id] || (lojaBolas.find((b) => b.id === Number(id)) || {}).nome || `Bola ${id}`;
  const quantidadeDe = (tipo, id) => quantidades(tipo === 'ball' ? euDaConta().balls : euDaConta().items)[id] || 0;
  const slotLivre = () => {
    const usados = new Set(pokemonsDaConta().filter(naEquipe).map((x) => primeiroNumero(x.slot)));
    return SLOTS_TIME.find((s) => !usados.has(s)) ?? null;
  };

  function montarControle() {
    const eu = euDaConta();
    const n = nivelDoTreinador();
    // Por região, na ordem do mapa do jogo, e dentro da região do nível mais baixo para o mais alto.
    const ordemRegiao = (id) => { const i = REGIOES.findIndex((r) => r.id === id); return i < 0 ? REGIOES.length : i; };
    const hunts = [...huntsPorSlug.values()]
      .filter((h) => h && h.slug && h.slug !== 'centro_pokemon')
      .map((h) => ({
        slug: String(h.slug), nome: String(h.nome || h.name || h.slug), nivel: Number(h.nivel ?? h.level) || 0,
        regiao: regiaoDaHunt(h), liberada: huntLiberada(h), atual: h.slug === perfil.huntSlug
      }))
      .sort((a, b) => ordemRegiao(a.regiao) - ordemRegiao(b.regiao) || a.nivel - b.nivel);
    // Região trancada quando o treinador ainda não chegou ao nível dela (sem nível lido, nada é trancado).
    const regioes = REGIOES.map((r) => ({ id: r.id, rotulo: r.rotulo, nivel: r.nivel, trancada: n > 0 && n < r.nivel }));
    const ativoId = ativoDaConta();
    const pokemons = pokemonsDaConta().map((x) => ({
      id: Number(x.id), nome: nomeDoPokemon(x),
      nivel: primeiroNumero(x.level, x.nivel, x.lvl) ?? null,
      hp: primeiroNumero(x.hp, x.hpAtual, x.vida) ?? null,
      hpMax: primeiroNumero(x.maxHp, x.hpMax, x.vidaMax, x.hpMaximo) ?? null,
      shiny: Boolean(x.shiny || x.isShiny), ativo: Number(x.id) === Number(ativoId), slot: primeiroNumero(x.slot) ?? null
    }));
    const equipe = pokemons.filter((x) => x.slot != null).sort((a, b) => a.slot - b.slot);
    const deposito = pokemons.filter((x) => x.slot == null)
      .sort((a, b) => (b.nivel || 0) - (a.nivel || 0))
      .slice(0, 30)
      .map(({ id, nome, nivel }) => ({ id, nome, nivel }));
    const itens = Object.entries(quantidades(eu.items)).filter(([, q]) => q > 0)
      .map(([id, q]) => ({ id: Number(id), nome: nomeDoItemControle(Number(id)), qtd: q, tipo: 'item' }));
    const bolas = Object.entries(quantidades(eu.balls)).filter(([, q]) => q > 0)
      .map(([id, q]) => ({ id: Number(id), nome: nomeDaBola(Number(id)), qtd: q, tipo: 'ball' }));
    return { hunts, regioes, equipe, deposito, mochila: [...itens, ...bolas] };
  }

  let controleEnviado = null;
  let controleEm = 0;
  function enviarControle() {
    const agora = Date.now();
    if (agora - controleEm < 5000) return;
    const dados = montarControle();
    const chave = JSON.stringify(dados);
    if (chave === controleEnviado) return;
    controleEnviado = chave;
    controleEm = agora;
    postar('controle', dados);
  }
  setInterval(enviarControle, 1000);

  // Ações que o celular pede. A central manda { tipo: 'acaoJogo', acao, params, pedido }. Antes de mandar a
  // mensagem ao jogo, confere com o estado da conta: hunt liberada, pokémon na equipe ou no depósito, slot
  // livre e item com quantidade na mochila. Devolve { ok, motivo }.
  function acaoDoCelular(c) {
    const p = c.params || {};
    const falha = (motivo) => ({ ok: false, motivo });
    const mandar = (msg, texto) => {
      if (!enviar(msg)) return falha('Conta sem conexão com o jogo.');
      log('info', `Celular: ${texto}.`);
      return { ok: true, motivo: null };
    };
    const pokemon = () => pokemonsDaConta().find((x) => Number(x.id) === Number(p.pokemonId));
    switch (c.acao) {
      case 'hunt': {
        const h = huntsPorSlug.get(String(p.slug));
        if (!h || h.slug === 'centro_pokemon') return falha('Essa hunt não existe nesta conta.');
        if (!huntLiberada(h)) return falha('Hunt bloqueada: o treinador ainda não chegou ao nível dela ou ao da região.');
        if (h.slug === perfil.huntSlug) return falha('A conta já está nesta hunt.');
        return mandar({ t: 'hunt.select', slug: h.slug }, `trocou para a hunt ${h.nome || h.name || h.slug}`);
      }
      case 'ativo': {
        const pk = pokemon();
        if (!pk) return falha('Esse pokémon não está nesta conta.');
        if (!naEquipe(pk)) return falha('Esse pokémon está no depósito: ponha-o no time antes.');
        if (Number(ativoDaConta()) === Number(pk.id)) return falha('Ele já é o pokémon ativo.');
        return mandar({ t: 'team.active', pokemonId: Number(pk.id) }, `${nomeDoPokemon(pk)} virou o pokémon ativo`);
      }
      case 'paraTime': {
        const pk = pokemon();
        if (!pk) return falha('Esse pokémon não está nesta conta.');
        if (naEquipe(pk)) return falha('Esse pokémon já está no time.');
        const slot = slotLivre();
        if (slot == null) return falha('O time está cheio: tire um pokémon antes.');
        return mandar({ t: 'team.move', pokemonId: Number(pk.id), slot }, `${nomeDoPokemon(pk)} foi para o time`);
      }
      case 'usarItem': {
        const id = Number(p.itemId);
        if (!(quantidadeDe('item', id) > 0)) return falha('Esse item não está na mochila.');
        return mandar({ t: 'item.use', itemId: id }, `usou ${nomeDoItemControle(id)}`);
      }
      case 'descartar': {
        // Bola: o valor do campo "tipo" no jogo ainda não foi confirmado, então só itens são descartados.
        if (p.tipo !== 'item') return falha(p.tipo === 'ball' ? 'Descartar bola ainda não está liberado pelo celular.' : 'Tipo de item inválido.');
        const id = Number(p.id);
        const qtd = Number(p.qtd);
        if (!(qtd > 0) || !(quantidadeDe('item', id) >= qtd)) return falha('A mochila não tem essa quantidade.');
        return mandar({ t: 'bolsa.descartar', tipo: 'item', id, qtd }, `descartou ${qtd}× ${nomeDoItemControle(id)}`);
      }
      case 'centro':
        return mandar({ t: 'centro.ir' }, 'foi ao Centro Pokémon');
      case 'curar':
        return mandar({ t: 'centro.curar' }, 'curou os pokémons no Centro Pokémon');
      default:
        return falha('Ação desconhecida.');
    }
  }

  // ---------------------------------------------------------- Status e comandos da central
  function status() {
    let agendados = 0;
    for (const o of S.ofertas.values()) if (o.estado === 'agendado') agendados++;
    postar('status', {
      tel: {
        inicio: T.inicio,
        nick: perfil.nick,
        nivel: perfil.nivel,
        hunt: descreverHunt(),
        xpH: porHora('xp'),
        goldH: porHora('gold'),
        abates: T.abates,
        capturas: T.capturas,
        shiniesVistos: T.shiniesVistos,
        shiniesCapturados: T.shiniesCapturados,
        drops: T.drops,
        ativo: { nome: ativo.nome, nivel: ativo.nivel, hp: ativo.hp, hpMax: ativo.hpMax, looktype: ativo.looktype, shiny: ativo.shiny },
        estoque: { pocao: estoque.pocao, bola: estoque.bola },
        gastos: T.gastos,
        buffs: { xpTr: buffs.xpTr, xpPk: buffs.xpPk, itens: buffs.itens, agoraServidor: agoraServidor() }
      },
      conectado: Boolean(S.ws && S.ws.readyState === 1),
      captura: {
        ativo: CAP.ativo, modo: CAP.modo, ballId: CAP.ballId, pausa: CAP.pausa,
        lancadas: CAP.lancadas, capturas: CAP.capturas, chance: CAP.chance, ultimaEm: CAP.ultimaEm,
        respostas: CAP.respostas, perdidos: CAP.perdidos,
        ultimaCaptura: CAP.ultimaCaptura, vip: Boolean(perfil.vip), bolas: { ...bolasInventario },
        pocoes: Object.fromEntries(Object.keys(POCOES_LOJA).map((id) => [id, estoqueDe('pocao', id)]).filter(([, q]) => q != null)),
        lojaBolas,
        reposicao: Object.fromEntries(['bola', 'pocao'].map((k) => [k, { compras: REP[k].compras, aviso: REP[k].aviso, ultima: REP[k].ultima, pendente: Boolean(REP[k].pedidoEm) }]))
      },
      desvioMs: S.desvio,
      gold: S.gold,
      gemas: S.gemas,
      diamantes: S.diamantes,
      ativo: S.ativo,
      agendados
    });
  }
  setInterval(status, 3000);

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || !ev.data.__pcCentral) return;
    const c = ev.data.cmd || {};
    if (c.tipo === 'captura') {
      for (const k of ['bola', 'pocao']) {
        const cfg = (c.reposicao && c.reposicao[k]) || {};
        const r = REP[k];
        const antes = r.ativo;
        r.ativo = Boolean(cfg.ativo);
        r.id = Number(cfg.id) || r.id;
        r.abaixoDe = Math.max(1, Number(cfg.abaixoDe) || 50);
        r.qtd = Math.max(1, Math.min(100000, Number(cfg.qtd) || 1000));
        r.limite = Math.max(0, Number(cfg.limite) || 0);
        if (r.ativo !== antes) log('info', `Reposição de ${k === 'bola' ? 'bola' : 'poção'} ${r.ativo ? 'ligada' : 'desligada'}.`);
      }
      const estava = CAP.ativo;
      CAP.ativo = Boolean(c.ativo);
      CAP.modo = c.modo === 'sempre' ? 'sempre' : 'capturar';
      CAP.ballId = Number(c.ballId) || 1;
      CAP.pausa = null;
      if (!CAP.ativo) CAP.fila = [];
      if (CAP.ativo !== estava) log('info', CAP.ativo ? `Lançar bolas ligado (${CAP.modo === 'sempre' ? 'pra sempre' : 'até capturar'}, ${BOLAS[CAP.ballId] || 'bola ' + CAP.ballId}).` : 'Lançar bolas desligado.');
      status();
    } else if (c.tipo === 'sniper') {
      const estavaAtivo = S.ativo;
      S.ativo = Boolean(c.ativo);
      S.regras = Array.isArray(c.regras) ? c.regras : [];
      // 0 é um valor válido (dispara no instante da liberação); só valor ausente/inválido volta ao padrão.
      S.margemMs = Number.isFinite(Number(c.margemMs)) && c.margemMs !== '' && c.margemMs != null ? Math.min(2500, Math.max(0, Number(c.margemMs))) : 800;
      S.varreduraSeg = Number(c.varreduraSeg) || 20;
      if (!S.ativo) {
        for (const o of S.ofertas.values()) if (o.timer) clearTimeout(o.timer);
        S.ofertas.clear();
        S.pendentes.clear();
      }
      if (S.ativo !== estavaAtivo) log('info', S.ativo ? 'Sniper ligado nesta conta.' : 'Sniper desligado nesta conta.');
      reiniciarVarredura();
      status();
    } else if (c.tipo === 'reivindicacao') {
      const p = S.pendentes.get(c.id);
      S.pendentes.delete(c.id);
      if (!p || (!S.ativo && !p.regra.__aprovado)) return;
      if (c.ok) agendar(p.an, p.regra, p.qtd);
      else {
        S.ofertas.set(p.an.id, { estado: 'outra_conta', em: Date.now() });
        log('info', `${p.an.nome}: outra conta sua já está neste anúncio, esta fica de fora.`, { id: p.an.id });
      }
    } else if (c.tipo === 'aprovarSugestao') {
      const sg = sugestoes.get(c.id);
      sugestoes.delete(c.id);
      if (!sg) { log('aviso', 'Essa sugestão expirou: o anúncio não está mais na memória. Ele aparece de novo na próxima varredura se ainda estiver à venda.'); return; }
      // Saldo pode ter mudado desde a sugestão.
      const saldo = saldoDe(sg.an.moeda);
      const qtd = saldo >= 0 && sg.an.preco > 0 ? Math.min(sg.qtd, Math.floor(saldo / sg.an.preco)) : sg.qtd;
      if (qtd <= 0) { log('aviso', `${sg.an.nome}: saldo insuficiente para comprar.`, { id: c.id }); return; }
      log('info', `Aprovado: ${qtd}× ${sg.an.nome}.`, { id: c.id });
      reivindicar(sg.an, { ...sg.regra, aprovar: false, __aprovado: true }, qtd);
    } else if (c.tipo === 'analisarHunts') {
      analisarHunts().then((r) => postar('hunts', r), (err) => postar('hunts', { erro: err.message }));
    } else if (c.tipo === 'radar') {
      S.radar = c.ativo ? {
        id: 'radar', ativa: true, tipo: 'item', alvo: '', itemId: 0, modo: 'media', aprovar: true,
        desconto: Number(c.desconto) || 30, moedaMedia: c.moedaMedia || 'orb', minVendas: Number(c.minVendas) || 0,
        maxGold: 0, maxGemas: 0, maxQtd: 0
      } : null;
    } else if (c.tipo === 'ignorarSugestao') {
      sugestoes.delete(c.id);
    } else if (c.tipo === 'varrerPrecos') {
      coletarPrecos();
    } else if (c.tipo === 'resetSessao') {
      Object.assign(T, novaTelemetria());
      status();
    } else if (c.tipo === 'pedirHistoricoGlobal') {
      pedirHistoricoGlobal();
    } else if (c.tipo === 'pedirLives') {
      postar('lives', { twitch: S.twitch, kick: S.kick });
    } else if (c.tipo === 'acaoJogo') {
      let r;
      try { r = acaoDoCelular(c); } catch (err) { r = { ok: false, motivo: 'Falha ao executar: ' + err.message }; }
      postar('acaoResultado', { pedido: c.pedido, ok: r.ok, motivo: r.motivo });
    }
  });
}

contextBridge.executeInMainWorld({ func: motor });

// Motor -> central
window.addEventListener('message', (ev) => {
  if (ev.source !== window || !ev.data || !ev.data.__pcMotor) return;
  ipcRenderer.sendToHost('motor', ev.data.tipo, ev.data.dados);
});

// Central -> motor
ipcRenderer.on('central', (_e, cmd) => {
  window.postMessage({ __pcCentral: true, cmd }, '*');
});
