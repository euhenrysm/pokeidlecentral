// Painel no celular: um servidor HTTP na rede local que mostra os números das contas e deixa o celular
// controlar o app (contas, hunts, mercado, lives, registro e configuração). Só liga quando o interruptor da
// aba Config está ligado (ou ao abrir o app, se estava ligado). O código de acesso é como uma senha.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Regras e listas (bolas, poções, limites) iguais às do PC: o celular não manda nada fora delas.
const Regras = require('./renderer/regras');

// Gera o QR code do endereço. Se a biblioteca faltar, a Config mostra só o endereço em texto.
let qrcode = null;
try { qrcode = require('qrcode-generator'); } catch { qrcode = null; }

// Portas fixas: se a primeira estiver ocupada, tenta as seguintes.
const PORTAS = [47740, 47741, 47742, 47743, 47744, 47745];
const MAX_POR_SEGUNDO = 10; // pedidos por IP a cada segundo (passou disso: 429)
const MAX_ACOES_POR_SEGUNDO = 2; // ações (POST /api/acao) por IP a cada segundo, além do limite geral (passou disso: 429)
const TEMPO_ACAO_MS = 5000; // quanto a página espera a central confirmar uma ação (passou disso: 504)
const MAX_IPS = 8; // IPs diferentes com pedidos nos últimos 60 s (passou disso: 429)
const JANELA_IPS_MS = 60_000;
const MAX_CORPO = 8 * 1024; // corpo maior que isso: 413; qualquer outro corpo: 400 (só o POST /api/acao recebe corpo)
const MAX_CORPO_ACAO = 2 * 1024; // corpo de uma ação: até 2 KB (passou disso: 413)
const ACOES = ['hunt', 'ativo', 'paraTime', 'usarItem', 'descartar', 'centro', 'curar', 'sniper', 'captura',
  'sniperRegraSalvar', 'sniperRegraApagar', 'sniperRegraAtiva', 'sniperOpcoes', 'capturaConfig',
  'huntsAtualizar', 'liveAbrir', 'livesOpcoes', 'radarOpcoes', 'configOpcoes'];
const MAX_REGRAS = 200; // regras de uma conta que vão ao celular
const MAX_CATALOGO = 1000; // itens do RMT que o celular recebe (GET /api/catalogo)
const MAX_EQUIPE = 12;
const MAX_DEPOSITO = 30;
const MAX_HUNTS = 600; // hunts de uma conta: na aba Controle (snapshot) e na análise (GET /api/hunts)
const MAX_REGIOES = 20;
const MAX_MOCHILA = 200;
const MAX_LINHAS_REGISTRO = 100; // linhas do Registro por conta (GET /api/registro)
const MAX_PRECOS = 150; // itens do mercado (GET /api/mercado)
const MAX_OFERTAS = 30; // ofertas do radar que esperam aprovação
const MAX_COMPRAS = 50; // últimas compras do histórico
const MAX_LIVES = 80; // lives (no ar e fora) que o celular recebe
const MAX_IMAGEM = 300_000; // tamanho máximo de uma imagem embutida (data:) no snapshot
const MAX_CONTAS = Regras.CONTAS;
const ROTAS_DADOS = ['/api/estado', '/api/catalogo', '/api/hunts', '/api/registro', '/api/mercado'];
const HOSTS_IMAGEM = ['raw.githubusercontent.com', 'pokeidle.io'];
const REGEX_IMAGEM_EMBUTIDA = /^data:image\/(png|gif|webp|jpeg);base64,[A-Za-z0-9+/=]+$/;

// Cabeçalhos de todas as respostas. Sem CORS: página de outro site não consegue ler a resposta.
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https://raw.githubusercontent.com https://pokeidle.io; connect-src 'self'"
};

let servidor = null;
let ip = '';
let porta = 0;
let token = ''; // só em memória: muda a cada ligada e em "Gerar novo código"
let subindo = null; // ligada em andamento (um clique duplo não sobe dois servidores)
let ultimoSnapshot = null; // { geradoEm, sniper, contas }
let catalogoAtual = null; // [{ id, nome, grupo }] do RMT, mandado pela central ao ligar e ao mudar (null: ainda não veio)
// Detalhes que a central manda só quando mudam (não vão no snapshot de 3 s): análise de hunts por conta,
// registro por conta, e mercado (preços, ofertas e compras). Só o último de cada.
let huntsDaConta = [null, null, null, null];
let registroDaConta = [[], [], [], []];
let mercadoAtual = null;
const sockets = new Set();
const pedidosPorIp = new Map(); // ip -> { inicio, n }
const acoesPorIp = new Map(); // ip -> { inicio, n }: ações por segundo
const ipsAtivos = new Map(); // ip -> quando fez o último pedido
let paginaCache = null;
let aoAcao = null; // quem executa as ações (o app): recebe { conta, acao, params } e devolve { ok, motivo }

// Primeiro IPv4 privado (10/8, 172.16/12 ou 192.168/16) que não seja interno: o endereço que o celular usa.
function ipDaRede() {
  const redes = os.networkInterfaces();
  for (const nome of Object.keys(redes)) {
    for (const end of redes[nome] || []) {
      const ipv4 = end.family === 'IPv4' || end.family === 4;
      if (ipv4 && !end.internal && ehPrivado(end.address)) return end.address;
    }
  }
  return null;
}
// Endereço do Tailscale (rede privada entre os seus aparelhos, 100.64.0.0/10): é o que o celular usa fora de casa.
function ipTailscale() {
  const redes = os.networkInterfaces();
  for (const nome of Object.keys(redes)) {
    for (const end of redes[nome] || []) {
      const ipv4 = end.family === 'IPv4' || end.family === 4;
      if (ipv4 && !end.internal && ehTailscale(end.address)) return end.address;
    }
  }
  return null;
}
function ehTailscale(endereco) {
  const [a, b] = String(endereco).split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}
function ehPrivado(endereco) {
  const [a, b] = String(endereco).split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function novoToken() {
  return crypto.randomBytes(32).toString('hex');
}
// O código fica guardado (cifrado pelo sistema, pela main) para o atalho do celular continuar valendo depois de
// fechar e abrir o app. Só muda em "Gerar novo código". Sem guarda (testes), cada ligada gera um código novo.
let guardaToken = null; // { ler(): string|null, gravar(t) }
function definirGuardaToken(g) { guardaToken = g && typeof g.ler === 'function' && typeof g.gravar === 'function' ? g : null; }
function tokenGuardadoOuNovo() {
  let t = null;
  try { t = guardaToken && guardaToken.ler(); } catch { t = null; }
  if (typeof t === 'string' && /^[0-9a-f]{64}$/.test(t)) return t;
  t = novoToken();
  try { if (guardaToken) guardaToken.gravar(t); } catch { /* sem guarda: vale só nesta sessão */ }
  return t;
}
function tokenValido(cabecalho) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(String(cabecalho || ''));
  if (!m || !token) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Limite simples em memória: pedidos por segundo de cada IP e quantos IPs diferentes estão usando a página.
function dentroDoLimite(origem) {
  const agora = Date.now();
  for (const [k, quando] of ipsAtivos) if (agora - quando > JANELA_IPS_MS) ipsAtivos.delete(k);
  for (const k of pedidosPorIp.keys()) if (!ipsAtivos.has(k)) pedidosPorIp.delete(k);
  if (!ipsAtivos.has(origem) && ipsAtivos.size >= MAX_IPS) return false;
  ipsAtivos.set(origem, agora);
  let janela = pedidosPorIp.get(origem);
  if (!janela || agora - janela.inicio >= 1000) {
    janela = { inicio: agora, n: 0 };
    pedidosPorIp.set(origem, janela);
  }
  janela.n++;
  return janela.n <= MAX_POR_SEGUNDO;
}

// Limite das ações: no máximo MAX_ACOES_POR_SEGUNDO por IP a cada segundo.
function dentroDoLimiteAcao(origem) {
  const agora = Date.now();
  let janela = acoesPorIp.get(origem);
  if (!janela || agora - janela.inicio >= 1000) {
    janela = { inicio: agora, n: 0 };
    acoesPorIp.set(origem, janela);
  }
  janela.n++;
  return janela.n <= MAX_ACOES_POR_SEGUNDO;
}

// Só os campos da lista fechada passam, com texto sem caracteres de controle e com tamanho máximo.
const texto = (v, max) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return s || null;
};
// Quantidades, taxas e tempos nunca são negativos: o que vier fora disso (ex.: -1 antes do primeiro dado) vira vazio.
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
// Imagem só de data:image (PNG/GIF/WebP/JPEG em base64) ou https de dois domínios fixos, sem parâmetros.
const imagem = (v) => {
  if (typeof v !== 'string') return null;
  if (v.startsWith('data:image/')) return v.length <= MAX_IMAGEM && REGEX_IMAGEM_EMBUTIDA.test(v) ? v : null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && HOSTS_IMAGEM.includes(u.hostname) && !u.search && !u.hash ? u.href : null;
  } catch {
    return null;
  }
};
const item = (x) => (x && typeof x === 'object' ? { nome: texto(x.nome, 60), qtd: numero(x.qtd) } : null);
// Ids do jogo: inteiros não negativos. Qualquer outra coisa vira null e a linha sai da lista.
const inteiroId = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
// Trecho de uma lista: no máximo `max` itens, cada um pelo `f`, sem os que vierem vazios.
const trecho = (v, max, f) => (Array.isArray(v) ? v.slice(0, max).map((x) => (x && typeof x === 'object' ? f(x) : null)).filter(Boolean) : []);

// Região: só id curto de letras minúsculas (kanto, johto...). Qualquer outra coisa vira vazio.
const idRegiao = (v) => (typeof v === 'string' && /^[a-z]{1,20}$/.test(v) ? v : null);
// Números arredondados (taxas por hora da análise de hunts): inteiro não negativo ou vazio.
const inteiroPositivo = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const contaValida = (v) => Number.isSafeInteger(v) && v >= 0 && v < MAX_CONTAS;

// Lista da aba Controle (vem do motor, pela central). Só os campos abaixo passam.
function sanitizarControle(c) {
  if (!c || typeof c !== 'object') return null;
  const pokemon = (x) => {
    const id = inteiroId(x.id);
    return id === null ? null : { id, nome: texto(x.nome, 60) || 'Pokémon', nivel: numero(x.nivel), hp: numero(x.hp), hpMax: numero(x.hpMax), shiny: x.shiny === true, ativo: x.ativo === true, slot: numero(x.slot) };
  };
  return {
    hunts: trecho(c.hunts, MAX_HUNTS, (h) => {
      const slug = texto(h.slug, 60);
      return slug ? { slug, nome: texto(h.nome, 60) || slug, regiao: idRegiao(h.regiao), nivel: numero(h.nivel), liberada: h.liberada === true, atual: h.atual === true } : null;
    }),
    regioes: trecho(c.regioes, MAX_REGIOES, (r) => {
      const id = idRegiao(r.id);
      return id ? { id, rotulo: texto(r.rotulo, 30) || id, nivel: numero(r.nivel), trancada: r.trancada === true } : null;
    }),
    equipe: trecho(c.equipe, MAX_EQUIPE, pokemon),
    deposito: trecho(c.deposito, MAX_DEPOSITO, (x) => {
      const id = inteiroId(x.id);
      return id === null ? null : { id, nome: texto(x.nome, 60) || 'Pokémon', nivel: numero(x.nivel) };
    }),
    mochila: trecho(c.mochila, MAX_MOCHILA, (x) => {
      const id = inteiroId(x.id);
      const qtd = numero(x.qtd);
      if (id === null || !qtd) return null;
      return { id, nome: texto(x.nome, 60) || 'Item', qtd, tipo: x.tipo === 'ball' ? 'ball' : 'item' };
    })
  };
}

// Regra do sniper, só com os campos que a aba Sniper usa. `compradas` sai aqui, mas o celular nunca a manda de volta.
const regraSnap = (r) => {
  if (!r || typeof r !== 'object') return null;
  const id = typeof r.id === 'string' && Regras.ID_REGRA.test(r.id) ? r.id : null;
  if (id === null || (r.tipo !== 'item' && r.tipo !== 'pokemon')) return null;
  return {
    id,
    tipo: r.tipo,
    ativa: r.ativa !== false,
    alvo: texto(r.alvo, 60) || '',
    itemId: inteiroId(r.itemId) ?? 0,
    modo: r.modo === 'media' ? 'media' : 'fixo',
    desconto: numero(r.desconto),
    moedaMedia: texto(r.moedaMedia, 10),
    minVendas: numero(r.minVendas),
    aprovar: r.aprovar === true,
    maxGold: numero(r.maxGold) ?? 0,
    maxGemas: numero(r.maxGemas) ?? 0,
    maxQtd: numero(r.maxQtd) ?? 0,
    compradas: numero(r.compradas) ?? 0,
    resumo: texto(r.resumo, 200) || ''
  };
};
const sanitizarSniper = (s) => (s && typeof s === 'object' ? { margemMs: numero(s.margemMs), varreduraSeg: numero(s.varreduraSeg) } : null);
// Aba Captura: o que a conta lança e a reposição (configuração), e o status que o PC mostra.
const sanitizarCaptura = (x) => {
  if (!x || typeof x !== 'object') return null;
  const reposicao = (r) => {
    const d = r && typeof r === 'object' ? r : {};
    return { ativo: d.ativo === true, id: inteiroId(d.id) ?? 0, abaixoDe: numero(d.abaixoDe), qtd: numero(d.qtd), limite: numero(d.limite) };
  };
  const bola = (b) => {
    const id = b && typeof b === 'object' ? inteiroId(b.id) : null;
    return id === null ? null : { id, nome: texto(b.nome, 30) || 'Bola', qtd: numero(b.qtd) ?? 0 };
  };
  const loja = (b) => {
    const id = b && typeof b === 'object' ? inteiroId(b.id) : null;
    return id === null ? null : { id, nome: texto(b.nome, 30) || 'Item', preco: numero(b.preco) };
  };
  const status = (s) => {
    const d = s && typeof s === 'object' ? s : {};
    return { aviso: texto(d.aviso, 160), pendente: d.pendente === true, compras: numero(d.compras), ultimaQtd: numero(d.ultimaQtd), ultimaEm: numero(d.ultimaEm) };
  };
  const rep = x.reposicao && typeof x.reposicao === 'object' ? x.reposicao : {};
  const rs = x.reposicaoStatus && typeof x.reposicaoStatus === 'object' ? x.reposicaoStatus : {};
  const uc = x.ultimaCaptura && typeof x.ultimaCaptura === 'object'
    ? { nome: texto(x.ultimaCaptura.nome, 60) || '', shiny: x.ultimaCaptura.shiny === true, bolas: numero(x.ultimaCaptura.bolas) ?? 0 }
    : null;
  const est = x.estoqueRep && typeof x.estoqueRep === 'object' ? x.estoqueRep : {};
  return {
    ativo: x.ativo === true,
    modo: x.modo === 'sempre' ? 'sempre' : 'capturar',
    ballId: inteiroId(x.ballId) ?? 1,
    reposicao: { bola: reposicao(rep.bola), pocao: reposicao(rep.pocao) },
    pausa: texto(x.pausa, 30),
    lancadas: numero(x.lancadas),
    capturas: numero(x.capturas),
    perdidos: numero(x.perdidos),
    chance: numero(x.chance),
    ultimaEm: numero(x.ultimaEm),
    ultimaCaptura: uc,
    bolas: trecho(x.bolas, 10, bola),
    lojaBolas: trecho(x.lojaBolas, 20, loja),
    lojaPocoes: trecho(x.lojaPocoes, 20, loja),
    estoqueRep: { bola: numero(est.bola), pocao: numero(est.pocao) },
    reposicaoStatus: { bola: status(rs.bola), pocao: status(rs.pocao) }
  };
};

// Análise de uma hunt (aba Hunts): só o que a lista do celular usa. Taxas arredondadas.
const sanitizarHunt = (h) => {
  const slug = texto(h.slug, 60);
  if (!slug) return null;
  const tipos = (lista) => trecho(lista, 18, (x) => {
    const tipo = texto(x.tipo, 20);
    const mult = numero(x.mult);
    return tipo && mult !== null ? { tipo, mult } : null;
  });
  return {
    slug,
    nome: texto(h.nome, 60) || slug,
    regiao: idRegiao(h.regiao),
    nivel: numero(h.nivel),
    liberada: h.liberada === true,
    atual: h.atual === true,
    xpTrH: inteiroPositivo(h.xpTrH),
    xpPkH: inteiroPositivo(h.xpPkH),
    goldH: inteiroPositivo(h.goldH),
    killsH: inteiroPositivo(h.killsH),
    fracos: tipos(h.fracos),
    resiste: tipos(h.resiste)
  };
};
// Linha do registro: hora, nível (info, aviso ou erro) e texto curto.
const NIVEIS_REGISTRO = ['info', 'aviso', 'erro'];
const sanitizarLinha = (l) => {
  const msg = texto(l.msg, 200);
  return msg ? { em: numero(l.em), nivel: NIVEIS_REGISTRO.includes(l.nivel) ? l.nivel : 'info', msg } : null;
};
const MOEDAS_OFERTA = ['orb', 'gold'];
const ESTADOS_PRECO = ['disp', 'sem_oferta', 'nao_lido', 'desatualizado'];
const RESULTADOS_COMPRA = ['ganhou', 'perdeu', 'recusado', 'sem resposta', 'aguardando'];
const sanitizarPreco = (p) => {
  const id = inteiroId(p.id);
  if (id === null) return null;
  const estado = (v) => (ESTADOS_PRECO.includes(v) ? v : 'nao_lido');
  return {
    id,
    nome: texto(p.nome, 60) || 'Item',
    cat: texto(p.cat, 20) || '',
    qtd: numero(p.qtd),
    eG: estado(p.eG),
    eO: estado(p.eO),
    gold: numero(p.gold),
    gema: numero(p.gema),
    goldUlt: numero(p.goldUlt),
    gemaUlt: numero(p.gemaUlt),
    mediaGema: numero(p.mediaGema),
    vendasGema: numero(p.vendasGema),
    em: numero(p.em)
  };
};
const sanitizarOferta = (o) => {
  const nome = texto(o.nome, 60);
  return nome ? {
    conta: texto(o.conta, 40) || '',
    nome,
    qtd: numero(o.qtd) ?? 1,
    preco: numero(o.preco),
    moeda: MOEDAS_OFERTA.includes(o.moeda) ? o.moeda : 'gold',
    pctMedia: numero(o.pctMedia),
    media: numero(o.media),
    origem: texto(o.origem, 20) || '',
    recebidaEm: numero(o.recebidaEm),
    liberaEm: numero(o.liberaEm)
  } : null;
};
const sanitizarCompra = (c) => {
  const nome = texto(c.nome, 60);
  return nome ? {
    em: numero(c.em),
    conta: texto(c.conta, 40) || '',
    nome,
    qtd: numero(c.qtd) ?? 1,
    preco: numero(c.preco),
    total: numero(c.total),
    moeda: MOEDAS_OFERTA.includes(c.moeda) ? c.moeda : 'gold',
    origem: texto(c.origem, 30) || '',
    resultado: RESULTADOS_COMPRA.includes(c.resultado) ? c.resultado : 'sem resposta'
  } : null;
};
const sanitizarRadar = (r) => {
  if (!r || typeof r !== 'object') return null;
  return {
    ativo: r.ativo === true,
    conta: contaValida(r.conta) ? r.conta : 0,
    desconto: numero(r.desconto),
    moedaMedia: ['orb', 'gold', 'ambas'].includes(r.moedaMedia) ? r.moedaMedia : 'orb',
    minVendas: numero(r.minVendas),
    auto: r.auto === true,
    minutos: numero(r.minutos)
  };
};
// Lives: a conta que abre, a qualidade, as opções (abrir sozinha e conferir) e a lista de canais.
const sanitizarLives = (l) => {
  if (!l || typeof l !== 'object') return null;
  const al = l.autoLive && typeof l.autoLive === 'object' ? l.autoLive : {};
  return {
    contaLives: contaValida(l.contaLives) ? l.contaLives : 0,
    qualidade: texto(l.qualidade, 20) || '160p30',
    manterLives: l.manterLives !== false,
    autoLive: { ativo: al.ativo === true, conta: contaValida(al.conta) ? al.conta : 0 },
    lista: trecho(l.lista, MAX_LIVES, (x) => {
      const nome = texto(x.nome, 60);
      const plataforma = x.plataforma === 'kick' || x.plataforma === 'twitch' ? x.plataforma : null;
      return nome && plataforma ? { plataforma, nome, aoVivo: x.aoVivo === true, viewers: numero(x.viewers) ?? 0 } : null;
    })
  };
};

function sanitizarConta(c) {
  const d = c && typeof c === 'object' ? c : {};
  const p = d.pokemon && typeof d.pokemon === 'object' ? d.pokemon : null;
  const nomePk = p ? texto(p.nome, 60) : null;
  return {
    nome: texto(d.nome, 40),
    online: d.online === true,
    nick: texto(d.nick, 40),
    nivel: numero(d.nivel),
    hunt: texto(d.hunt, 160),
    sessaoMs: numero(d.sessaoMs),
    pokemon: nomePk
      ? { nome: nomePk, nivel: numero(p.nivel), hp: numero(p.hp), hpMax: numero(p.hpMax), shiny: p.shiny === true, imagem: imagem(p.imagem) }
      : null,
    gold: numero(d.gold),
    gemas: numero(d.gemas),
    xpHora: numero(d.xpHora),
    goldHora: numero(d.goldHora),
    abates: numero(d.abates),
    capturas: numero(d.capturas),
    pocao: item(d.pocao),
    bola: item(d.bola),
    drops: Array.isArray(d.drops) ? d.drops.slice(0, 12).map(item).filter((x) => x && x.nome) : [],
    sniperLigado: d.sniperLigado === true,
    capturaLigada: d.capturaLigada === true,
    mudo: d.mudo === true,
    fila: numero(d.fila),
    gastos: d.gastos && typeof d.gastos === 'object' ? { pocoes: numero(d.gastos.pocoes), bolas: numero(d.gastos.bolas) } : null,
    shinies: d.shinies && typeof d.shinies === 'object' ? { vistos: numero(d.shinies.vistos), capturados: numero(d.shinies.capturados) } : null,
    xpBonus: numero(d.xpBonus),
    ultimoSniper: d.ultimoSniper && typeof d.ultimoSniper === 'object'
      ? { nivel: texto(d.ultimoSniper.nivel, 10) || 'info', msg: texto(d.ultimoSniper.msg, 200) || '' }
      : null,
    controle: sanitizarControle(d.controle),
    regras: trecho(d.regras, MAX_REGRAS, regraSnap),
    captura: sanitizarCaptura(d.captura)
  };
}

// A central manda o snapshot a cada 3 s; o painel guarda só o último.
function guardarSnapshot(dados) {
  if (!servidor || !dados || !Array.isArray(dados.contas)) return;
  ultimoSnapshot = {
    geradoEm: Date.now(),
    sniper: sanitizarSniper(dados.sniper),
    versao: texto(dados.versao, 20) || '',
    escala: dados.escala === 'auto' || [1, 0.9, 0.8, 0.75].includes(dados.escala) ? dados.escala : 'auto',
    lives: sanitizarLives(dados.lives),
    contas: dados.contas.slice(0, MAX_CONTAS).map(sanitizarConta)
  };
}

// Detalhes sob demanda: a central manda quando algo muda (análise de hunts de uma conta, registro de uma
// conta, ou o mercado inteiro). Cada envio troca o anterior daquele tipo.
function guardarHunts(c, dados) {
  if (!servidor || !contaValida(c) || !dados || !Array.isArray(dados.hunts)) return;
  huntsDaConta[c] = {
    em: numero(dados.em),
    nivelTreinador: numero(dados.nivelTreinador),
    fatorRitmo: numero(dados.fatorRitmo),
    hunts: trecho(dados.hunts, MAX_HUNTS, sanitizarHunt)
  };
}
function guardarRegistro(c, linhas) {
  if (!servidor || !contaValida(c) || !Array.isArray(linhas)) return;
  registroDaConta[c] = trecho(linhas.slice(-MAX_LINHAS_REGISTRO), MAX_LINHAS_REGISTRO, sanitizarLinha);
}
function guardarMercado(dados) {
  if (!servidor || !dados || typeof dados !== 'object') return;
  mercadoAtual = {
    geradoEm: Date.now(),
    leituraEm: numero(dados.leituraEm),
    leituraConta: texto(dados.leituraConta, 40) || '',
    limiteMs: numero(dados.limiteMs),
    radar: sanitizarRadar(dados.radar),
    precos: trecho(dados.precos, MAX_PRECOS, sanitizarPreco),
    ofertas: trecho(dados.ofertas, MAX_OFERTAS, sanitizarOferta),
    compras: trecho(dados.compras, MAX_COMPRAS, sanitizarCompra)
  };
}
// Uma mensagem da central com um detalhe (tipo: hunts, registro ou mercado).
function guardarDetalhe(d) {
  if (!d || typeof d !== 'object') return;
  if (d.tipo === 'hunts') guardarHunts(d.conta, d.dados);
  else if (d.tipo === 'registro') guardarRegistro(d.conta, d.linhas);
  else if (d.tipo === 'mercado') guardarMercado(d.dados);
}

// Catálogo do RMT (o mesmo que o seletor do PC mostra). Não é segredo; só vai ao celular quando ele pede.
// Some junto com o painel (desligar): a central manda de novo ao ligar.
function guardarCatalogo(lista) {
  if (!servidor || !Array.isArray(lista)) return;
  catalogoAtual = lista.slice(0, MAX_CATALOGO).map((x) => {
    const id = x && typeof x === 'object' ? inteiroId(x.id) : null;
    const nome = id === null ? null : texto(x.nome, 60);
    return nome ? { id, nome, grupo: texto(x.grupo, 20) || '' } : null;
  }).filter(Boolean);
}

function respostaEstado() {
  if (!ultimoSnapshot) return { geradoEm: null, idadeMs: null, sniper: null, versao: '', escala: 'auto', lives: null, contas: [] };
  const s = ultimoSnapshot;
  return { geradoEm: s.geradoEm, idadeMs: Date.now() - s.geradoEm, sniper: s.sniper, versao: s.versao, escala: s.escala, lives: s.lives, contas: s.contas };
}

// Respostas dos detalhes (GET /api/hunts?conta=N, /api/registro[?conta=N], /api/mercado).
function respostaHunts(c) {
  const d = huntsDaConta[c];
  return d ? { pronto: true, em: d.em, nivelTreinador: d.nivelTreinador, fatorRitmo: d.fatorRitmo, hunts: d.hunts }
    : { pronto: false, em: null, nivelTreinador: null, fatorRitmo: null, hunts: [] };
}
// Registro mais novo primeiro; sem conta, as contas juntas (até 200 linhas).
function respostaRegistro(c) {
  const lista = c === null
    ? registroDaConta.flatMap((linhas, i) => linhas.map((l) => ({ ...l, conta: i })))
    : registroDaConta[c].map((l) => ({ ...l, conta: c }));
  return { linhas: lista.sort((a, b) => (b.em || 0) - (a.em || 0)).slice(0, c === null ? 200 : MAX_LINHAS_REGISTRO) };
}
function respostaMercado() {
  return mercadoAtual ? { pronto: true, ...mercadoAtual }
    : { pronto: false, geradoEm: null, leituraEm: null, leituraConta: '', limiteMs: null, radar: null, precos: [], ofertas: [], compras: [] };
}
// Conta na consulta: 0 a 3 (qualquer outra coisa é recusada); vazio é "sem conta".
const contaDaConsulta = (v) => (/^[0-9]$/.test(v || '') && contaValida(Number(v)) ? Number(v) : null);

// Bolas da loja da conta (para conferir a reposição); vazio até a central mandar a loja.
function lojaBolasDaConta(conta) {
  const c = ultimoSnapshot && ultimoSnapshot.contas[conta];
  return c && c.captura ? c.captura.lojaBolas : [];
}

function paginaHtml() {
  if (paginaCache === null) paginaCache = fs.readFileSync(path.join(__dirname, 'painel-celular.html'), 'utf8');
  return paginaCache;
}

// Campos de cada ação. Só estes passam; o resto do corpo é ignorado. centro e curar não têm campos.
// As ações de sniper e captura usam as mesmas regras do PC (regras.js): campo fora da lista, recusa.
function validarAcao(c, consulta = { lojaBolas: () => [] }) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { erro: 'pedido inválido' };
  const conta = contaValida(c.conta) ? c.conta : null;
  if (conta === null) return { erro: 'conta inválida' };
  if (typeof c.acao !== 'string' || !ACOES.includes(c.acao)) return { erro: 'ação desconhecida' };
  const params = {};
  switch (c.acao) {
    case 'hunt': {
      const slug = c.slug;
      if (typeof slug !== 'string' || !slug.length || slug.length > 60 || /[\u0000-\u001f\u007f]/.test(slug)) return { erro: 'hunt inválida' };
      params.slug = slug;
      break;
    }
    case 'ativo':
    case 'paraTime': {
      const id = inteiroId(c.pokemonId);
      if (id === null) return { erro: 'pokémon inválido' };
      params.pokemonId = id;
      break;
    }
    case 'usarItem': {
      const id = inteiroId(c.itemId);
      if (id === null) return { erro: 'item inválido' };
      params.itemId = id;
      break;
    }
    case 'descartar': {
      const id = inteiroId(c.id);
      const qtd = Number.isSafeInteger(c.qtd) && c.qtd >= 1 && c.qtd <= 100000 ? c.qtd : null;
      if (c.tipo !== 'item' && c.tipo !== 'ball') return { erro: 'tipo de item inválido' };
      if (id === null || qtd === null) return { erro: 'item ou quantidade inválidos' };
      params.tipo = c.tipo;
      params.id = id;
      params.qtd = qtd;
      break;
    }
    case 'sniper':
    case 'captura': {
      if (typeof c.ligado !== 'boolean') return { erro: 'ligado deve ser true ou false' };
      params.ligado = c.ligado;
      break;
    }
    case 'sniperRegraSalvar': {
      const v = Regras.validarRegraDoCelular(c.regra);
      if (v.erro) return { erro: v.erro };
      params.regra = v.valor;
      break;
    }
    case 'sniperRegraApagar':
    case 'sniperRegraAtiva': {
      if (typeof c.id !== 'string' || !Regras.ID_REGRA.test(c.id)) return { erro: 'regra inválida' };
      params.id = c.id;
      if (c.acao === 'sniperRegraAtiva') {
        if (typeof c.ativa !== 'boolean') return { erro: 'ativa deve ser true ou false' };
        params.ativa = c.ativa;
      }
      break;
    }
    case 'sniperOpcoes': {
      const v = Regras.validarOpcoesSniper({ margemMs: c.margemMs, varreduraSeg: c.varreduraSeg });
      if (v.erro) return { erro: v.erro };
      Object.assign(params, v.valor);
      break;
    }
    case 'capturaConfig': {
      const v = Regras.validarParcialCaptura(c.parcial, consulta.lojaBolas(conta));
      if (v.erro) return { erro: v.erro };
      params.parcial = v.valor;
      break;
    }
    // Análise de hunts: sem campos. A conta tem de estar conectada (confere o app).
    case 'huntsAtualizar':
      break;
    case 'liveAbrir': {
      const v = Regras.validarLiveAbrir({ plataforma: c.plataforma, canal: c.canal });
      if (v.erro) return { erro: v.erro };
      Object.assign(params, v.valor);
      break;
    }
    case 'livesOpcoes':
    case 'radarOpcoes':
    case 'configOpcoes': {
      const v = c.acao === 'livesOpcoes' ? Regras.validarLivesDoCelular(c.parcial)
        : c.acao === 'radarOpcoes' ? Regras.validarRadarDoCelular(c.parcial)
          : Regras.validarConfigDoCelular(c.parcial);
      if (v.erro) return { erro: v.erro };
      params.parcial = v.valor;
      break;
    }
    default:
      break;
  }
  return { acao: { conta, acao: c.acao, params } };
}

// Lê o corpo até o limite. Passou do limite: 'grande' (e o resto é descartado).
function lerCorpo(req, limite, cb) {
  let total = 0;
  const pedacos = [];
  let feito = false;
  req.on('data', (p) => {
    if (feito) return;
    total += p.length;
    if (total > limite) { feito = true; cb('grande'); return; }
    pedacos.push(p);
  });
  req.on('end', () => { if (!feito) { feito = true; cb(null, Buffer.concat(pedacos).toString('utf8')); } });
  req.on('error', () => { if (!feito) { feito = true; cb('erro'); } });
}

// POST /api/acao: valida, entrega à central e responde com o que ela confirmou (ou 504 se demorar).
function acaoHttp(req, res, responder, origem) {
  // Corpo grande pelo cabeçalho: recusado antes de qualquer outra coisa.
  if (Number(req.headers['content-length'] || 0) > MAX_CORPO_ACAO) {
    res.setHeader('Connection', 'close');
    return responder(413, { ok: false, motivo: 'pedido grande demais' });
  }
  if (req.method !== 'POST') return responder(405, { ok: false, motivo: 'método não permitido' }, { Allow: 'POST' });
  if (!tokenValido(req.headers.authorization)) return responder(401, { ok: false, motivo: 'código inválido' });
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
    return responder(415, { ok: false, motivo: 'envie o pedido como application/json' });
  }
  // O limite de ações conta só os pedidos válidos, os que de fato chegariam à central.
  lerCorpo(req, MAX_CORPO_ACAO, (erro, texto) => {
    if (erro === 'grande') {
      res.setHeader('Connection', 'close');
      return responder(413, { ok: false, motivo: 'pedido grande demais' });
    }
    if (erro) return responder(400, { ok: false, motivo: 'pedido inválido' });
    let corpo;
    try { corpo = JSON.parse(texto); } catch { return responder(400, { ok: false, motivo: 'JSON inválido' }); }
    const v = validarAcao(corpo, { lojaBolas: lojaBolasDaConta });
    if (v.erro) return responder(400, { ok: false, motivo: v.erro });
    if (!aoAcao) return responder(503, { ok: false, motivo: 'O app ainda não está pronto para ações.' });
    if (!dentroDoLimiteAcao(origem)) return responder(429, { ok: false, motivo: 'ações demais: espere 1 s' });

    let timer = null;
    const espera = new Promise((resolve) => { timer = setTimeout(() => resolve(null), TEMPO_ACAO_MS); });
    const central = Promise.resolve()
      .then(() => aoAcao(v.acao))
      .catch(() => ({ ok: false, motivo: 'Não consegui falar com a central.' }));
    Promise.race([central, espera]).then((r) => {
      clearTimeout(timer);
      if (!r) return responder(504, { ok: false, motivo: 'A central não respondeu a tempo. Confira se o app está aberto.' });
      return responder(200, { ok: r.ok === true, motivo: r.motivo || null });
    });
  });
}

function atender(req, res) {
  const origem = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const responder = (status, corpo, cabec = {}) => {
    res.writeHead(status, { ...CABECALHOS, 'Content-Type': 'application/json; charset=utf-8', ...cabec });
    res.end(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
  };
  if (!dentroDoLimite(origem)) return responder(429, { ok: false, motivo: 'muitas requisições' });
  if (String(req.url || '').split('?')[0] === '/api/acao') return acaoHttp(req, res, responder, origem);

  const tamanho = Number(req.headers['content-length'] || 0);
  if (req.headers['transfer-encoding'] || tamanho > 0) {
    res.setHeader('Connection', 'close');
    return responder(tamanho > MAX_CORPO ? 413 : 400, { ok: false, motivo: 'esta página não recebe corpo' });
  }
  if (req.method !== 'GET') return responder(405, { ok: false, motivo: 'método não permitido' }, { Allow: 'GET' });

  let url;
  try {
    url = new URL(req.url || '/', 'http://painel.local');
  } catch {
    return responder(400, { ok: false, motivo: 'pedido inválido' });
  }
  const caminho = url.pathname;
  // A página não tem dados: o código vem no fragmento da URL (#t=...), que o navegador não envia aqui.
  if (caminho === '/') return responder(200, paginaHtml(), { 'Content-Type': 'text/html; charset=utf-8' });
  if (!ROTAS_DADOS.includes(caminho)) return responder(404, { ok: false, motivo: 'não encontrado' });
  if (!tokenValido(req.headers.authorization)) return responder(401, { ok: false, motivo: 'código inválido' });
  if (caminho === '/api/catalogo') return responder(200, catalogoAtual ? { pronto: true, itens: catalogoAtual } : { pronto: false, itens: [] });
  if (caminho === '/api/mercado') return responder(200, respostaMercado());
  if (caminho === '/api/registro') {
    // Sem ?conta=, mostra as quatro contas juntas; com ?conta=, só a conta pedida (0 a 3).
    if (!url.searchParams.has('conta')) return responder(200, respostaRegistro(null));
    const c = contaDaConsulta(url.searchParams.get('conta'));
    return c === null ? responder(400, { ok: false, motivo: 'conta inválida' }) : responder(200, respostaRegistro(c));
  }
  if (caminho === '/api/hunts') {
    const c = contaDaConsulta(url.searchParams.get('conta'));
    return c === null ? responder(400, { ok: false, motivo: 'conta inválida' }) : responder(200, respostaHunts(c));
  }
  return responder(200, respostaEstado());
}

function escutar(p) {
  return new Promise((resolve, reject) => {
    const s = http.createServer(atender);
    s.keepAliveTimeout = 5_000;
    s.on('connection', (sock) => {
      sockets.add(sock);
      sock.on('close', () => sockets.delete(sock));
    });
    s.once('error', reject);
    s.listen(p, '0.0.0.0', () => {
      s.off('error', reject);
      s.on('error', () => {}); // erro depois de ligado não derruba o app
      resolve(s);
    });
  });
}

// O QR leva o endereço e o código juntos: http://IP:PORTA/#t=TOKEN (o fragmento não vai ao servidor).
function qrDoCodigo(endereco = ip) {
  if (!qrcode || !servidor || !endereco) return null;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(`http://${endereco}:${porta}/#t=${token}`);
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 4, margin: 2 });
    return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
  } catch {
    return null;
  }
}

function resposta() {
  // Fora de casa: o Tailscale é procurado a cada consulta (pode ter sido ligado depois do painel).
  const ts = ipTailscale();
  return {
    ok: true, ligado: true, url: ip ? `http://${ip}:${porta}` : null, qr: qrDoCodigo(ip),
    urlFora: ts ? `http://${ts}:${porta}` : null, qrFora: ts ? qrDoCodigo(ts) : null, motivo: null
  };
}
function desligado() {
  return { ok: true, ligado: false, url: null, qr: null, urlFora: null, qrFora: null, motivo: null };
}
function semLigar(motivo) {
  token = '';
  return { ok: false, ligado: false, url: null, qr: null, urlFora: null, qrFora: null, motivo };
}

async function subir() {
  const rede = ipDaRede();
  if (!rede && !ipTailscale()) return semLigar('Não achei um endereço de rede (Wi-Fi ou cabo) neste computador. Conecte-o à rede e ligue o painel de novo.');
  token = tokenGuardadoOuNovo();
  for (const p of PORTAS) {
    try {
      servidor = await escutar(p);
    } catch (err) {
      if (err.code === 'EADDRINUSE') continue;
      return semLigar(`Não consegui abrir a porta ${p}: ${err.message}`);
    }
    porta = p;
    ip = rede;
    return resposta();
  }
  return semLigar('As portas 47740 a 47745 estão ocupadas por outro programa. Feche o programa que as usa e ligue o painel de novo.');
}

// Liga o servidor (ou devolve o endereço atual, se já está ligado).
function ligar() {
  if (servidor) return Promise.resolve(resposta());
  if (!subindo) subindo = subir().finally(() => { subindo = null; });
  return subindo;
}

// Desliga: fecha o servidor e as conexões abertas, e apaga o código e o último snapshot.
function desligar() {
  const s = servidor;
  servidor = null;
  if (s) s.close();
  for (const sock of sockets) sock.destroy();
  sockets.clear();
  token = '';
  ip = '';
  porta = 0;
  ultimoSnapshot = null;
  catalogoAtual = null;
  huntsDaConta = [null, null, null, null];
  registroDaConta = [[], [], [], []];
  mercadoAtual = null;
  pedidosPorIp.clear();
  acoesPorIp.clear();
  ipsAtivos.clear();
  return desligado();
}

// Gera um código novo: o antigo deixa de valer na hora.
function novoCodigo() {
  if (!servidor) return semLigar('O painel está desligado. Ligue-o primeiro.');
  token = novoToken();
  try { if (guardaToken) guardaToken.gravar(token); } catch { /* vale só nesta sessão */ }
  return resposta();
}

function estado() {
  return servidor ? resposta() : desligado();
}

// Quem executa as ações (o app, pela central). Sem ele, o POST /api/acao responde 503.
function definirAcao(fn) {
  aoAcao = typeof fn === 'function' ? fn : null;
}

// Só para os testes: sobe o servidor numa porta livre, com um código novo, sem procurar a rede local.
async function subirParaTestes() {
  token = novoToken();
  servidor = await escutar(0);
  porta = servidor.address().port;
  ip = '127.0.0.1';
  return { porta, token };
}

module.exports = { definirGuardaToken, ligar, desligar, novoCodigo, estado, guardarSnapshot, guardarCatalogo, guardarDetalhe, definirAcao, subirParaTestes, _ehTailscale: ehTailscale };
