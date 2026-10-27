// Interface da central: as 4 contas, o sniper e as lives.
const GAME_URL = 'https://pokeidle.io/app';
const PARTICOES = ['persist:conta1', 'persist:conta2', 'persist:conta3', 'persist:conta4'];
const MAX_LOG = 400;

let config = null;
const contas = [];        // { el, webview, info, estado, lives }
const estadoLives = {};   // "plataforma:canal" -> { plataforma, nome, aoVivo, viewers }
let livesCarregadas = false;
let twitchLogado = [false, false, false, false];
let twitchUsuario = ['', '', '', ''];
let livesMudas = false;
let editando = 0;         // conta cujo sniper está aberto na aba Sniper
const reivindicados = new Map(); // offerId -> { conta, em }: um anúncio, uma conta
// Celular: o Registro de cada conta (últimas 100 linhas) e o que mudou desde o último envio ao painel.
const registroCelular = [[], [], [], []];
const celularSujo = { hunts: new Set(), registro: new Set(), mercado: false };
let mercadoEnviadoEm = 0;
let versaoApp = '';

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null) e.append(f);
  return e;
}

const fmt = (n) => (typeof n === 'number' && n >= 0 ? n.toLocaleString('pt-BR') : '—');

async function salvar(parcial) {
  config = await window.central.setConfig(parcial);
}

// ------------------------------------------------------------------ Abas

document.querySelectorAll('.abas button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.abas button').forEach((x) => x.classList.toggle('ativa', x === b));
    document.querySelectorAll('.vista').forEach((v) => v.classList.toggle('ativa', v.id === `vista-${b.dataset.vista}`));
    if (b.dataset.vista === 'mercado') aoAbrirMercado();
    garantirVerificacao();
  });
});

// A verificação anti-robô da Cloudflare só é desenhada se a página do jogo carregar VISÍVEL. Por isso
// o app abre na aba Jogo; se a conta carregou fora da tela (outra aba aberta antes de terminar), a que
// aparecer ainda na tela de login é recarregada uma vez, já visível. Conta logada nunca é recarregada.
const contaVisivel = (c) => $('#vista-contas').classList.contains('ativa') &&
  (!$('#grade').classList.contains('solo') || c.el.classList.contains('foco'));
function garantirVerificacao() {
  setTimeout(() => {
    for (const c of contas) {
      if (!c.pronta || c.carregouVisivel || (c.estado && c.estado.conectado) || !contaVisivel(c)) continue;
      c.carregouVisivel = true;
      c.webview.reload();
    }
  }, 50);
}

// ------------------------------------------------------------------ Contas

function montarContas() {
  const grade = $('#grade');
  PARTICOES.forEach((particao, i) => {
    const webview = el('webview', { src: GAME_URL, partition: particao, allowpopups: true });
    const info = el('span', { class: 'info' }, 'carregando…');
    const tagSniper = el('span', { class: 'tag-sniper' });
    const nome = el('input', { class: 'nome', value: config.contas[i].nome, maxlength: 20 });
    nome.addEventListener('change', () => {
      const lista = config.contas.map((c, j) => (j === i ? { ...c, nome: nome.value || `Conta ${i + 1}` } : c));
      salvar({ contas: lista });
      atualizarSeletorConta();
    });

    const zoom = (delta) => {
      const z = Math.min(2, Math.max(0.4, Math.round((config.zoom[i] + delta) * 10) / 10));
      webview.setZoomFactor(z);
      salvar({ zoom: config.zoom.map((v, j) => (j === i ? z : v)) });
    };
    const botaoSom = el('button', { title: 'Mutar o som deste jogo', onclick: () => definirMudo(i, !(config.mudo || [])[i]) });
    const foco = el('button', { title: 'Tela cheia nesta conta' }, '⤢');
    foco.addEventListener('click', () => {
      const solo = grade.classList.contains('solo') && cartao.classList.contains('foco');
      grade.classList.toggle('solo', !solo);
      contas.forEach((c) => c.el.classList.toggle('foco', !solo && c.el === cartao));
      garantirVerificacao();
    });

    const cartao = el('div', { class: 'conta' },
      el('div', { class: 'barra-conta' },
        nome,
        tagSniper,
        info,
        el('button', { title: 'Diminuir zoom', onclick: () => zoom(-0.1) }, '−'),
        el('button', { title: 'Aumentar zoom', onclick: () => zoom(0.1) }, '+'),
        botaoSom,
        el('button', { title: 'Recarregar', onclick: () => webview.reload() }, '↻'),
        foco),
      webview);

    const conta = { el: cartao, webview, info, tagSniper, botaoSom, estado: null, lives: null, pronta: false };
    contas.push(conta);

    webview.addEventListener('dom-ready', () => {
      conta.pronta = true;
      // Carregou já na tela: a verificação foi desenhada, não precisa recarregar.
      conta.carregouVisivel = contaVisivel(conta);
      webview.setZoomFactor(config.zoom[i] || 1);
      webview.setAudioMuted(Boolean((config.mudo || [])[i]));
      enviarSniper();
      enviarCaptura(i);
      webview.send('central', { tipo: 'pedirLives' });
    });
    webview.addEventListener('ipc-message', (ev) => {
      if (ev.channel !== 'motor') return;
      const [tipo, dados] = ev.args;
      aoMotor(i, tipo, dados);
    });

    grade.append(cartao);
  });
}

// ------------------------------------------------------------------ Som dos jogos

function desenharSom() {
  const mudo = config.mudo || [];
  contas.forEach((c, i) => {
    c.botaoSom.textContent = mudo[i] ? '🔇' : '🔊';
    c.botaoSom.classList.toggle('ativa', Boolean(mudo[i]));
  });
  const todos = contas.length && contas.every((_, i) => mudo[i]);
  $('#mutar-jogos').textContent = todos ? '🔇 Jogos mudos' : '🔊 Som dos jogos';
  $('#mutar-jogos').classList.toggle('ativa', todos);
}

async function definirMudo(i, valor) {
  const mudo = [0, 1, 2, 3].map((j) => (j === i ? valor : Boolean((config.mudo || [])[j])));
  await salvar({ mudo });
  if (contas[i].pronta) contas[i].webview.setAudioMuted(valor);
  desenharSom();
}

$('#mutar-jogos').addEventListener('click', async () => {
  const todos = contas.every((_, i) => (config.mudo || [])[i]);
  await salvar({ mudo: [!todos, !todos, !todos, !todos] });
  contas.forEach((c) => c.pronta && c.webview.setAudioMuted(!todos));
  desenharSom();
});

function aoMotor(i, tipo, dados) {
  const conta = contas[i];
  if (tipo === 'status') {
    if (!conta.estado || conta.estado.conectado !== dados.conectado) {
      console.info(`[central] ${config.contas[i].nome}: ${dados.conectado ? 'conectada ao servidor' : 'sem conexão'}`);
    }
    conta.estado = { ...dados, recebidoEm: Date.now() };
    conta.info.textContent = dados.conectado
      ? `${fmt(dados.gold)} Coins · ${fmt(dados.gemas)} Gemas · ${fmt(dados.diamantes)} 💎` +
        (dados.ativo ? ` · ${dados.agendados} na fila` : '')
      : 'desconectado';
    atualizarResumo();
    pedirDashboard();
  } else if (tipo === 'captura') {
    // "Jogar até capturar" capturou e desligou sozinho no motor: grava o interruptor desligado.
    if (dados.desligou) {
      config.captura.contas[i] = { ...config.captura.contas[i], ativo: false };
      salvar({ captura: config.captura });
      desenharCaptura();
    }
  } else if (tipo === 'controle') {
    // Lista da aba Controle do celular (hunts, time, depósito e mochila): só guarda, o snapshot leva.
    conta.controle = dados;
  } else if (tipo === 'acaoResultado') {
    // Resposta do motor a uma ação pedida pelo celular.
    const resolver = acoesJogoEmCurso.get(dados.pedido);
    if (resolver) { acoesJogoEmCurso.delete(dados.pedido); resolver(dados); }
  } else if (tipo === 'sprite') {
    receberSprite(conta, dados);
  } else if (tipo === 'itensNossos') {
    window.central.salvarItensNossos(dados);
    catalogo.nossos = dados;
    catalogo.pronto = false;
  } else if (tipo === 'sugestao') {
    receberSugestao(i, dados);
  } else if (tipo === 'sorteio') {
    registrarSorteio(i, dados);
  } else if (tipo === 'compra') {
    // Compra da reposição na loja (o sniper manda pelo "sorteio").
    guardarCompra(registroDeCompra(dados, i));
  } else if (tipo === 'historicoGlobal') {
    receberHistoricoGlobal(i, dados);
  } else if (tipo === 'hunts') {
    receberHunts(i, dados);
  } else if (tipo === 'precos') {
    receberPrecos(i, dados);
  } else if (tipo === 'diagnostico') {
    conta.diagnostico = dados;
    window.central.salvarDebugTelemetria(contas.map((c) => c.diagnostico || null));
  } else if (tipo === 'log') {
    adicionarLog(i, dados);
    if (['disparo', 'comprado', 'recusado', 'agendado'].includes(dados.nivel)) {
      conta.ultimoSniper = dados;
      pedirDashboard();
    }
  } else if (tipo === 'reivindicar') {
    // Árbitro entre as contas: quem achou o anúncio primeiro fica com ele; as outras ficam de fora
    // para nunca entrarem duas contas suas no mesmo sorteio.
    const corte = Date.now() - 10 * 60_000;
    for (const [id, r] of reivindicados) if (r.em < corte) reivindicados.delete(id);
    const dono = reivindicados.get(dados.id);
    const ok = config.sniper.mesmoSorteio || !dono || dono.conta === i;
    if (!dono) reivindicados.set(dados.id, { conta: i, em: Date.now() });
    conta.webview.send('central', { tipo: 'reivindicacao', id: dados.id, ok });
  } else if (tipo === 'comprado') {
    const regras = config.sniper.contas[i].regras.map((r) =>
      r.id === dados.regraId ? { ...r, compradas: (r.compradas || 0) + (dados.qtd || 1) } : r);
    salvarConta(i, { regras }).then(() => { desenharRegras(); enviarSniper(); });
  } else if (tipo === 'lives') {
    conta.lives = dados;
    window.central.salvarDebugLives(contas.map((c) => c.lives));
    atualizarLives();
  }
}

function atualizarResumo() {
  const r = $('#resumo-contas');
  r.replaceChildren(...contas.map((c, i) =>
    el('span', {}, el('span', { class: 'ponto' + (c.estado && c.estado.conectado ? ' on' : '') }), config.contas[i].nome)));
}

// ------------------------------------------------------------------ Dashboard

// Ícones carregados do próprio site do jogo (não vão junto com o app).
const ICONE = {
  ouro: 'https://pokeidle.io/assets/site/assets/ui/moeda-ouro.png',
  gema: 'https://pokeidle.io/img/moeda-gema.png',
  diamante: 'https://pokeidle.io/img/moeda-diamante.png',
  xp: 'https://pokeidle.io/assets/site/assets/loja/exp.png',
  shiny: 'https://pokeidle.io/assets/site/assets/loja/shinysecretlure.png',
  bola: 'https://pokeidle.io/assets/site/assets/ui/ball-ultra.png',
  abate: 'https://pokeidle.io/assets/site/assets/ui/trofeu-1.png',
  boss: 'https://pokeidle.io/assets/site/assets/items/bronze_boss_token.png',
  chave: 'https://pokeidle.io/img/itens/fragmento-chave.png',
  shinyStone: 'https://pokeidle.io/img/itens/shiny-stone.png',
  bike: 'https://pokeidle.io/img/itens/fragmento-bicicleta.png',
  ovoShiny: 'https://pokeidle.io/img/itens/fragmento-ovo-shiny.png',
  mystic: 'https://pokeidle.io/img/itens/mystic-ticket.png',
  sniper: 'https://pokeidle.io/img/ball-beast.png',
  pocao: 'https://pokeidle.io/img/itens/golden-potion.png',
  vip: 'https://pokeidle.io/assets/site/assets/loja/vip.png',
  loot: 'https://pokeidle.io/assets/site/assets/loja/loot.png',
  captura: 'https://pokeidle.io/assets/site/assets/loja/catch.png',
  boost: 'https://pokeidle.io/assets/site/assets/loja/boost.png'
};

// Cada buff ativo vira um selo: ícone da loja do jogo, o % dele no XP (quando mexe no XP) e o tempo que falta.
const ICONE_DO_BUFF = { vip: 'vip', xp: 'xp', pokexp: 'xp', loot: 'loot', captura: 'captura', shiny: 'shiny' };
function descreverBuff(b, agoraServidor) {
  const pct = (m) => (Number(m) > 1 ? `+${(Math.round((Number(m) - 1) * 1000) / 10).toLocaleString('pt-BR')}%` : '');
  let efeito = '';
  if (b.tr && b.pk && Math.abs(b.tr - b.pk) > 1e-6) efeito = b.tr > 1 ? `${pct(b.tr)} / pk ${pct(b.pk)}` : `pk ${pct(b.pk)}`;
  else efeito = pct(b.tr || b.pk);
  if (b.id === 'atrasados' && b.tr) efeito = `×${b.tr}`;
  if (b.efeitoTexto) efeito = b.efeitoTexto;
  if (b.id === 'twitch' && b.lives > 1) efeito += ` (${b.lives} lives)`;

  let falta = '';
  if (b.ate) {
    const ms = b.ate - agoraServidor;
    if (ms > 5 * 365 * 86_400_000) falta = 'permanente';
    else if (ms > 86_400_000) falta = `${Math.floor(ms / 86_400_000)}d`;
    else if (ms > 3_600_000) falta = `${Math.floor(ms / 3_600_000)}h${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')}`;
    else if (ms > 0) falta = `${Math.ceil(ms / 60_000)}min`;
  }
  const classe = b.id === 'vip' ? 'vip' : b.id === 'twitch' ? 'twitch' : String(b.id).startsWith('kick') ? 'kick' : '';
  const glifo = () => (classe === 'twitch' || classe === 'kick'
    ? el('span', { class: 'glifo' }, classe === 'twitch' ? 'T' : 'K')
    : ICONE_DO_BUFF[b.id] ? ico(ICONE_DO_BUFF[b.id], 'ico-buff') : ico('boost', 'ico-buff'));
  return { efeito, falta, classe, glifo, resta: b.ate ? b.ate - agoraServidor : Infinity };
}
function seloBuff(b, agoraServidor) {
  const { efeito, falta, classe, glifo } = descreverBuff(b, agoraServidor);
  return el('span', { class: 'buff ' + classe, title: [b.rotulo, efeito, falta].filter(Boolean).join(' · ') },
    glifo(), el('span', {}, b.rotulo), efeito ? el('b', { class: 'efeito' }, efeito) : null, falta ? el('small', {}, falta) : null);
}

// Bônus da mesma origem (os resgates da Kick, a guild e o boost da guild) viram um selo só;
// passando o mouse aparece a lista com cada um, o efeito e o tempo que falta.
const GRUPO_DO_BUFF = (id) => (String(id).startsWith('kick') ? 'kick' : id === 'guild' || id === 'guildBoost' ? 'guild' : null);
const NOME_DO_GRUPO = { kick: 'Kick', guild: 'Guild' };
function selosDeBuffs(itens, agoraServidor) {
  const grupos = new Map();
  const ordem = [];
  for (const b of itens) {
    const g = GRUPO_DO_BUFF(b.id);
    if (!g) { ordem.push(b); continue; }
    if (!grupos.has(g)) { grupos.set(g, []); ordem.push(g); }
    grupos.get(g).push(b);
  }
  return ordem.map((x) => {
    if (typeof x !== 'string') return seloBuff(x, agoraServidor);
    const lista = grupos.get(x);
    if (lista.length === 1) return seloBuff(lista[0], agoraServidor);
    const desc = lista.map((b) => ({ b, ...descreverBuff(b, agoraServidor) }));
    const efeitos = [...new Set(desc.map((d) => d.efeito).filter(Boolean))];
    const menor = desc.reduce((a, d) => (d.resta < a.resta ? d : a));
    const selo = el('span', { class: 'buff grupo tem-dica ' + desc[0].classe },
      desc[0].glifo(), el('span', {}, NOME_DO_GRUPO[x]),
      el('b', { class: 'efeito' }, efeitos.length === 1 ? `${efeitos[0]} ×${lista.length}` : `${lista.length} bônus`),
      menor.falta ? el('small', {}, menor.falta) : null);
    selo._dica = { titulo: `${NOME_DO_GRUPO[x]} · ${lista.length} bônus ativos`, linhas: desc.map((d) => [d.b.rotulo, d.efeito, d.falta]) };
    return selo;
  });
}

// Dica flutuante dos selos agrupados: fica no body (não é cortada pelo painel) e sobrevive ao redesenho do painel.
const dicaBuff = { el: null, x: 0, y: 0 };
function mostrarDicaBuff(alvo) {
  if (!dicaBuff.el) { dicaBuff.el = el('div', { class: 'dica-buff' }); document.body.append(dicaBuff.el); }
  const d = dicaBuff.el;
  if (!alvo || !alvo._dica) { d.style.display = 'none'; return; }
  d.replaceChildren(el('b', {}, alvo._dica.titulo),
    ...alvo._dica.linhas.map(([r, e, f]) => el('div', { class: 'linha' }, el('span', {}, r), el('b', {}, e || ''), el('small', {}, f || ''))));
  d.style.display = 'block';
  const r = alvo.getBoundingClientRect();
  const larg = d.offsetWidth; const alt = d.offsetHeight;
  d.style.left = `${Math.max(6, Math.min(r.left, innerWidth - larg - 6))}px`;
  d.style.top = `${r.bottom + 6 + alt > innerHeight ? r.top - alt - 6 : r.bottom + 6}px`;
}
document.addEventListener('mousemove', (ev) => {
  dicaBuff.x = ev.clientX; dicaBuff.y = ev.clientY;
  mostrarDicaBuff(ev.target.closest && ev.target.closest('.tem-dica'));
});
// Depois de redesenhar o painel o selo é outro elemento: reaponta a dica para o que está sob o mouse.
function reapontarDicaBuff() {
  if (!dicaBuff.el || dicaBuff.el.style.display === 'none') return;
  const sob = document.elementFromPoint(dicaBuff.x, dicaBuff.y);
  mostrarDicaBuff(sob && sob.closest('.tem-dica'));
}
const ICONE_BOLA = {
  1: 'https://pokeidle.io/assets/site/assets/ui/ball-poke.png',
  2: 'https://pokeidle.io/assets/site/assets/ui/ball-great.png',
  3: 'https://pokeidle.io/img/ball-super.png',
  4: 'https://pokeidle.io/assets/site/assets/ui/ball-ultra.png',
  5: 'https://pokeidle.io/img/ball-beast.png'
};
const ico = (nome, classe = 'ico') => el('img', { class: classe, src: ICONE[nome], alt: '', draggable: 'false' });

const DROPS = [
  ['boss', 'Boss Token'], ['chave', 'Frag. Chave'], ['shinyStone', 'Frag. Shiny Stone'],
  ['bike', 'Frag. Bicicleta'], ['ovoShiny', 'Frag. Ovo Shiny'], ['mystic', 'Mystic Ticket']
];
const curto = (n) => {
  if (typeof n !== 'number' || n < 0) return '—';
  if (n >= 1e9) return (n / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'B';
  if (n >= 1e6) return (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'M';
  if (n >= 1e4) return (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
  return n.toLocaleString('pt-BR');
};
// Taxa por hora: null = menos de 30 s de dados ainda.
const taxa = (n, online) => (!online ? '—' : n == null ? 'calculando…' : curto(n) + '/h');
const duracao = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

let dashboardPendente = false;
function pedirDashboard() {
  if (dashboardPendente) return;
  dashboardPendente = true;
  requestAnimationFrame(() => { dashboardPendente = false; desenharDashboard(); desenharCaptura(); reapontarDicaBuff(); });
}

function kpi(icone, rotulo, valor, extra, classe = '') {
  return el('div', { class: 'kpi ' + classe },
    icone ? ico(icone, 'ico-kpi') : null,
    el('div', { class: 'kpi-txt' }, el('small', {}, rotulo), el('b', {}, valor), extra ? el('span', {}, extra) : null));
}

function desenharDashboard() {
  const est = contas.map((c) => c.estado || {});

  $('#cartoes-contas').replaceChildren(...contas.map((c, i) => {
    const e = est[i];
    const t = e.tel || {};
    const at = t.ativo || {};
    const stq = t.estoque || {};
    const nome = config.contas[i].nome;
    const sniper = config.sniper.contas[i];
    const ult = c.ultimoSniper;
    const on = Boolean(e.conectado);
    const pctHp = at.hp != null && at.hpMax ? Math.max(0, Math.min(100, Math.round((at.hp / at.hpMax) * 100))) : null;

    // O sprite é um <img> fixo por conta: o laço de animação troca só o src dele.
    if (!c.spriteEl) c.spriteEl = el('img', { class: 'sprite', alt: '', draggable: 'false' });
    // A cena é o destaque do cartão: o pokémon em campo, com a hunt numa placa e o tempo de sessão por cima.
    const cena = el('div', { class: 'cena' + (at.shiny ? ' shiny' : '') },
      c.sprite && c.sprite.quadros.length ? c.spriteEl : el('span', { class: 'sem-sprite' }, on ? '…' : '—'),
      el('span', { class: 'cena-tempo', title: 'Tempo desta sessão' }, '⏱ ', on && t.inicio ? duracao(Date.now() - t.inicio) : '—'),
      el('span', { class: 'cena-hunt', title: t.hunt || 'sem hunt' }, '📍 ', t.hunt || 'sem hunt'));

    const iconeBola = stq.bola ? el('img', { class: 'ico-kpi', src: ICONE_BOLA[stq.bola.id] || ICONE.bola, alt: '' }) : ico('bola', 'ico-kpi');
    const caixa = (icone, rotulo, valor, classe = '', extra = null) =>
      el('div', { class: 'kpi ' + classe }, icone,
        el('div', { class: 'kpi-txt' }, el('small', {}, rotulo),
          // "29,18M/h": o número grande e o "/h" pequeno ao lado.
          el('b', {}, typeof valor === 'string' && valor.endsWith('/h') ? [valor.slice(0, -2), el('small', {}, '/h')] : valor),
          extra ? el('span', { class: 'kpi-extra' }, extra) : null));
    // Gasto da sessão em destaque; o estoque fica como lembrete (vermelho quando está acabando).
    const gs = t.gastos || {};
    const restam = (x, limite) => x ? el('span', { class: x.qtd < limite ? 'acabando' : '' }, `${x.nome} · restam ${fmt(x.qtd)}`) : null;

    const drops = DROPS.map(([k, rotulo]) => {
      const n = (t.drops && t.drops[k]) || 0;
      return el('div', { class: 'mini' + (n ? ' tem' : ''), title: rotulo }, ico(k, 'ico-drop'), el('b', {}, String(n)));
    });
    drops.push(
      el('div', { class: 'mini' + (t.shiniesVistos ? ' tem' : ''), title: 'Shinies vistos' }, ico('shiny', 'ico-drop'), el('b', {}, String(t.shiniesVistos || 0))),
      el('div', { class: 'mini' + (t.shiniesCapturados ? ' tem shiny' : ''), title: 'Shinies capturados' }, ico('bola', 'ico-drop'), el('b', {}, String(t.shiniesCapturados || 0))));

    const bf = t.buffs;
    const pctXp = (m) => `+${(Math.round((m - 1) * 1000) / 10).toLocaleString('pt-BR')}%`;
    // Os bônus que mexem no XP (VIP, boosts, Twitch, Kick XP, guild, evento…) ficam dentro do selo XP;
    // passando o mouse nele aparece cada um com o % e o tempo que falta. Os outros seguem como selos.
    const agoraBf = bf ? bf.agoraServidor + (Date.now() - (e.recebidoEm || Date.now())) : Date.now();
    const itensBf = (bf && bf.itens) || [];
    const ehDeXp = (b) => !b.efeitoTexto && (Number(b.tr) > 1 || Number(b.pk) > 1);
    const deXp = itensBf.filter(ehDeXp);
    const outros = itensBf.filter((b) => !ehDeXp(b));
    const seloXp = el('span', { class: 'buff-xp' + (deXp.length ? ' tem-dica' : '') + (bf && bf.xpTr > 1 ? '' : ' neutro'), title: deXp.length ? null : 'Bônus de XP total (o mesmo do jogo)' }, 'XP ',
      el('b', {}, bf && bf.xpTr ? pctXp(bf.xpTr) : on ? '…' : '—'),
      bf && bf.xpPk && Math.abs(bf.xpPk - bf.xpTr) > 1e-6 ? el('small', {}, ` / pokémon ${pctXp(bf.xpPk)}`) : null,
      deXp.length ? el('small', {}, ` · ${deXp.length} bônus ▾`) : null);
    if (deXp.length) {
      seloXp._dica = {
        titulo: `XP total ${pctXp(bf.xpTr || 1)}` + (bf.xpPk && Math.abs(bf.xpPk - bf.xpTr) > 1e-6 ? ` · pokémon ${pctXp(bf.xpPk)}` : ''),
        linhas: deXp.map((b) => { const d = descreverBuff(b, agoraBf); return [b.rotulo, d.efeito, d.falta]; })
      };
    }
    const faixaBuffs = el('div', { class: 'dash-buffs' }, seloXp,
      ...(outros.length ? selosDeBuffs(outros, agoraBf)
        : deXp.length ? [] : [el('span', { class: 'sem-buff' }, on ? 'nenhum buff ativo' : '')]));

    return el('div', { class: 'cartao-dash' + (on ? '' : ' off') },
      el('div', { class: 'dash-topo' },
        el('div', { class: 'avatar' }, (t.nick || nome).charAt(0).toUpperCase()),
        el('div', { class: 'dash-nome' },
          el('b', {}, t.nick || nome),
          el('div', { class: 'selos' },
            el('span', { class: 'status ' + (on ? 'on' : 'off') }, on ? 'Online' : 'Offline'),
            t.nivel != null ? el('span', { class: 'selo-nv' }, `Treinador Nv ${fmt(t.nivel)}`) : null,
            t.nick && nome !== t.nick ? el('span', { class: 'selo-nv' }, nome) : null)),
        el('span', { class: 'saldos' },
          el('span', { class: 'pilula', title: 'Ouro' }, ico('ouro'), curto(e.gold)),
          el('span', { class: 'pilula', title: 'Gemas' }, ico('gema'), curto(e.gemas))),
        el('button', { class: 'redondo', title: 'Ver o jogo desta conta', 'aria-label': 'Ver o jogo desta conta', onclick: () => verJogo(i) }, '↗')),

      faixaBuffs,

      el('div', { class: 'dash-corpo' },
        cena,
        el('div', { class: 'dash-info' },
          el('div', { class: 'pk-linha' },
            el('b', { class: 'pk-nome' }, at.nome || (on ? 'Pokémon em campo' : '—')),
            el('span', { class: 'pk-nv' }, at.nivel != null ? `Nv. ${fmt(at.nivel)}` : '')),
          el('div', { class: 'hp' },
            el('small', {}, 'HP'),
            el('div', { class: 'barra' }, el('div', { class: 'cheio' + (pctHp != null && pctHp < 30 ? ' baixo' : ''), style: `width:${pctHp ?? 0}%` })),
            el('small', {}, pctHp != null ? `${pctHp}%` : '—')),
          el('div', { class: 'dash-taxas' },
            caixa(ico('xp', 'ico-kpi'), 'XP/h', taxa(t.xpH, on)),
            caixa(ico('ouro', 'ico-kpi'), 'Gold/h', taxa(t.goldH, on)),
            caixa(ico('pocao', 'ico-kpi'), 'Poções gastas', on ? fmt(gs.pocoes || 0) : '—', stq.pocao && stq.pocao.qtd < 20 ? 'alerta' : '',
              restam(stq.pocao, 20)),
            caixa(iconeBola, 'Bolas gastas', on ? fmt(gs.bolas || 0) : '—', stq.bola && stq.bola.qtd < 50 ? 'alerta' : '',
              restam(stq.bola, 50))))),

      el('div', { class: 'dash-drops' }, ...drops),

      el('div', { class: 'dash-sniper' },
        el('span', { class: 'sniper-mini' + (sniper.ativo ? ' on' : '') }, ico('sniper'),
          sniper.ativo ? `Sniper ligado · ${e.agendados || 0} na fila` : 'Sniper desligado'),
        ult ? el('span', { class: 'dash-ultimo ' + ult.nivel, title: ult.msg }, ult.msg) : el('span', { class: 'dash-ultimo' }),
        el('button', { class: 'discreto', title: 'Zera os contadores desta sessão', onclick: () => c.pronta && c.webview.send('central', { tipo: 'resetSessao' }) }, 'Zerar')));
  }));
}

// O pokémon do Dashboard: a imagem nossa (Pokédex, nº 1 a 1025, normal ou shiny) quando existe;
// senão o sprite do próprio jogo, que cobre as variantes de Outland, as cópias de Orre e o que o jogo
// adicionar depois. Sem internet também fica o do jogo.
const spritesNossos = new Map(); // "dex:s" -> Promise<dataURL|null>
function dexDoSprite(d) {
  const id = Number(d.especieId);
  if (id >= 1 && id <= 1025) return id;
  const look = Number(d.looktype) - 60000;
  return !d.especieId && look >= 1 && look <= 1025 ? look : null;
}
// A imagem da Pokédex tem muita margem transparente: corta para o pokémon ocupar a cena inteira.
async function apararSprite(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = el('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width; let y0 = c.height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (px[(y * c.width + x) * 4 + 3] < 8) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const out = el('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
function spriteNosso(dex, shiny) {
  const k = `${dex}:${shiny ? 's' : ''}`;
  if (!spritesNossos.has(k)) {
    spritesNossos.set(k, window.central.spriteNosso(dex, shiny)
      .then((url) => (url ? apararSprite(url) : null))
      .catch(() => null));
  }
  return spritesNossos.get(k);
}
function receberSprite(conta, dados) {
  conta.spritePedido = dados;
  const usar = (s) => {
    if (conta.spritePedido !== dados) return; // já trocou de pokémon
    conta.sprite = s;
    conta.spriteQuadro = 0;
    if (conta.spriteEl && s.quadros.length) conta.spriteEl.src = s.quadros[0];
    if (conta.spriteEl) conta.spriteEl.classList.toggle('do-jogo', !s.nosso);
    pedirDashboard();
  };
  const dex = dexDoSprite(dados);
  if (!dex) return usar(dados);
  spriteNosso(dex, dados.shiny).then((url) => usar(url ? { ...dados, quadros: [url], nosso: true } : dados));
}

// Anima os sprites do Dashboard no mesmo ritmo do jogo (220 ms por quadro).
setInterval(() => {
  for (const c of contas) {
    if (!c.sprite || !c.sprite.quadros.length || !c.spriteEl) continue;
    c.spriteQuadro = ((c.spriteQuadro || 0) + 1) % c.sprite.quadros.length;
    c.spriteEl.src = c.sprite.quadros[c.spriteQuadro];
  }
}, 220);

function verJogo(i) {
  irPara('contas');
  $('#grade').classList.add('solo');
  contas.forEach((c, j) => c.el.classList.toggle('foco', j === i));
  garantirVerificacao();
}

// ------------------------------------------------------------------ Catálogo de itens do RMT

const catalogo = { base: [], nossos: [], pronto: false, lista: [], aba: 'todos', ao: null };

// O mesmo caminho que o jogo monta para o ícone de um item.
function iconeDoItem(icon) {
  const i = String(icon || '');
  if (!i) return '';
  if (i.startsWith('/img/')) return 'https://pokeidle.io' + i;
  if (i.startsWith('/assets/site/')) return 'https://pokeidle.io' + i;
  if (i.startsWith('/assets/')) return 'https://pokeidle.io/assets/site' + i;
  if (i.startsWith('site/assets/')) return 'https://pokeidle.io/assets/' + i;
  return 'https://pokeidle.io/assets/site/assets/items/' + i;
}

// O que o Mercado da Comunidade aceita (Wiki): pedras, TMs, tickets, Boss Token, Mega Stones,
// fragmentos, Ovo Shiny, casas, bicicletas e caixas. Loot de pokémon e consumíveis de loja não vão.
const FORA_DO_RMT = /potion|revive|escape rope|exp\.? share|name tag|chocadeira|absorb bulb|beast ball|mystery egg|skin|pacote|ficha pvp/i;
function grupoDoItem(it) {
  const n = it.name.toLowerCase();
  if (/mega/.test(n) && /stone/.test(n)) return 'mega';
  if (/fragment|fragmento/.test(n)) return 'fragmentos';
  if (/ticket|token/.test(n)) return 'tickets';
  if (/tm disk|tm piece|disk piece/.test(n) || it.category === 'tm') return 'tm';
  if (/shiny stone/.test(n)) return 'shiny';
  if (it.category === 'stone' || /stone$/.test(n)) return 'pedras';
  if (/ovo|egg/.test(n)) return 'ovos';
  if (/casa|house|bicicleta|bike|caixa|box/.test(n)) return 'pecas';
  return 'outros';
}
const GRUPOS = [
  ['todos', 'Todos'], ['pedras', 'Pedras'], ['shiny', 'Shiny Stones'], ['mega', 'Mega Stones'], ['tm', 'TM'],
  ['fragmentos', 'Fragmentos'], ['tickets', 'Tickets'], ['ovos', 'Ovos'], ['pecas', 'Casas e bikes'], ['outros', 'Outros']
];

async function carregarCatalogo() {
  if (catalogo.pronto) return;
  const { base, nossos } = await window.central.catalogo();
  catalogo.base = base || [];
  if (!catalogo.nossos.length) catalogo.nossos = nossos || [];
  const vistos = new Set();
  const lista = [];
  const juntar = (it, origem) => {
    if (!it || !it.id || !it.name || vistos.has(it.id)) return;
    if (FORA_DO_RMT.test(it.name)) return;
    // Do catálogo público: pedras, TMs e as peças de TM (que o jogo marca como loot, mas o RMT negocia).
    if (origem === 'base' && !['stone', 'tm'].includes(it.category) && grupoDoItem(it) !== 'tm') return;
    vistos.add(it.id);
    lista.push({ id: it.id, name: it.name, icone: iconeDoItem(it.icon), grupo: grupoDoItem(it) });
  };
  for (const it of catalogo.nossos) juntar(it, 'nossos');
  for (const it of catalogo.base) juntar(it, 'base');
  lista.sort((a, b) => a.name.localeCompare(b.name));
  catalogo.lista = lista;
  catalogo.pronto = true;
  if (celularLigado) enviarCatalogoCelular();
}

function desenharCatalogo() {
  const busca = $('#catalogo-busca').value.trim().toLowerCase();
  const itens = catalogo.lista.filter((it) =>
    (catalogo.aba === 'todos' || it.grupo === catalogo.aba) && (!busca || it.name.toLowerCase().includes(busca)));
  $('#catalogo-abas').replaceChildren(...GRUPOS.map(([id, rotulo]) => {
    const n = id === 'todos' ? catalogo.lista.length : catalogo.lista.filter((it) => it.grupo === id).length;
    if (!n) return '';
    return el('button', { class: catalogo.aba === id ? 'ativa' : '', onclick: () => { catalogo.aba = id; desenharCatalogo(); } }, `${rotulo} (${n})`);
  }));
  $('#catalogo-grade').replaceChildren(...itens.map((it) =>
    el('button', { class: 'item-rmt', title: `${it.name} (id ${it.id})`, onclick: () => { fecharCatalogo(); catalogo.ao && catalogo.ao(it); } },
      it.icone ? el('img', { src: it.icone, alt: '', loading: 'lazy' }) : el('span', { class: 'sem-icone' }, '?'),
      el('span', {}, it.name))));
  $('#catalogo-nota').textContent = catalogo.nossos.length
    ? `${itens.length} itens.`
    : `${itens.length} itens. Fragmentos, tickets e Mega Stones aparecem depois que uma conta conectar ao jogo.`;
}

async function abrirCatalogo(aoEscolher) {
  catalogo.ao = aoEscolher;
  await carregarCatalogo();
  $('#catalogo').hidden = false;
  $('#catalogo-busca').value = '';
  desenharCatalogo();
  $('#catalogo-busca').focus();
}
function fecharCatalogo() { $('#catalogo').hidden = true; }

$('#catalogo-busca').addEventListener('input', desenharCatalogo);
$('#catalogo-fechar').addEventListener('click', fecharCatalogo);
$('#catalogo').addEventListener('click', (e) => { if (e.target.id === 'catalogo') fecharCatalogo(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharCatalogo(); });

// ------------------------------------------------------------------ Filtros e seletor de pokémon

// As mesmas faixas do Mercado do jogo (nomes de campo iguais aos que ele manda ao servidor).
const FAIXAS_REGRA = [
  ['Nível', 'nivelMin', 'nivelMax'], ['Potência', 'potenciaMin', 'potenciaMax'], ['IV', 'ivMin', 'ivMax'],
  ['Qualidade', 'qualidadeMin', 'qualidadeMax'], ['Nota', 'notaMin', 'notaMax']
];
const numeroOuVazio = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return String(v ?? '').trim() === '' || !isFinite(n) ? '' : n;
};
function lerFiltrosPokemon(f) {
  const r = {
    especieId: Number(f.get('especieId')) || 0,
    soShiny: f.get('soShiny') === 'on',
    soP5: f.get('soP5') === 'on',
    soMega: f.get('soMega') === 'on',
    soLendario: f.get('soLendario') === 'on',
    soTmElemental: f.get('soTmElemental') === 'on',
    soTmAoe: f.get('soTmAoe') === 'on',
    semOutland: f.get('semOutland') === 'on'
  };
  for (const [, a, b] of FAIXAS_REGRA) { r[a] = numeroOuVazio(f.get(a)); r[b] = numeroOuVazio(f.get(b)); }
  return r;
}
const temFiltroPokemon = (r) => r.soShiny || r.soP5 || r.soMega || r.soLendario || r.soTmElemental || r.soTmAoe ||
  FAIXAS_REGRA.some(([, a, b]) => r[a] !== '' && r[a] != null && r[a] !== 0 || r[b] !== '' && r[b] != null && r[b] !== 0);

// Lendários e míticos (Pokédex nacional, Ultra Beasts inclusive), para a aba do seletor.
const LENDARIOS = new Set([144, 145, 146, 150, 151, 243, 244, 245, 249, 250, 251, 377, 378, 379, 380, 381, 382, 383, 384, 385, 386,
  480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, 494, 638, 639, 640, 641, 642, 643, 644, 645, 646, 647,
  648, 649, 716, 717, 718, 719, 720, 721, 772, 773, 785, 786, 787, 788, 789, 790, 791, 792, 793, 794, 795, 796, 797, 798, 799,
  800, 801, 802, 803, 804, 805, 806, 807, 808, 809, 888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898, 905, 1001, 1002, 1003,
  1004, 1005, 1006, 1007, 1008, 1009, 1010, 1014, 1015, 1016, 1017, 1024, 1025]);
const GERACOES = [[1, 151, 'Kanto'], [152, 251, 'Johto'], [252, 386, 'Hoenn'], [387, 493, 'Sinnoh'], [494, 649, 'Unova'],
  [650, 721, 'Kalos'], [722, 809, 'Alola'], [810, 905, 'Galar'], [906, 1025, 'Paldea']];
const geracaoDe = (id) => (GERACOES.find(([a, b]) => id >= a && id <= b) || [0, 0, ''])[2];

const especies = { lista: [], pronto: false, aba: 'todos', ao: null, sprites: new Map(), pedidos: new Set(), timer: null };

async function carregarEspecies() {
  if (especies.pronto) return;
  especies.lista = await window.central.especies();
  especies.pronto = especies.lista.length > 0;
}

// Sprite da espécie: pedido em lote ao processo principal (que desenha com o módulo do jogo e guarda em cache).
function spriteDaEspecie(id, classe) {
  const img = el('img', { class: classe, alt: '', 'data-especie': String(id) });
  const pronto = especies.sprites.get(id);
  if (pronto) img.src = pronto;
  else if (pronto === undefined) pedirSprite(id);
  return img;
}
function pedirSprite(id) {
  especies.pedidos.add(id);
  if (especies.timer) return;
  especies.timer = setTimeout(async () => {
    const ids = [...especies.pedidos].slice(0, 60);
    ids.forEach((x) => especies.pedidos.delete(x));
    especies.timer = null;
    const r = await window.central.sprites(ids);
    for (const x of ids) {
      const url = r[x] || null;
      especies.sprites.set(x, url);
      if (url) document.querySelectorAll(`img[data-especie="${x}"]`).forEach((i) => { i.src = url; });
      else document.querySelectorAll(`img[data-especie="${x}"]`).forEach((i) => i.classList.add('sem-sprite-img'));
    }
    if (especies.pedidos.size) pedirSprite([...especies.pedidos][0]);
  }, 120);
}

// Só pede o sprite de quem aparece na tela.
const observadorSprites = new IntersectionObserver((entradas) => {
  for (const e of entradas) {
    if (!e.isIntersecting) continue;
    const id = Number(e.target.dataset.especie);
    observadorSprites.unobserve(e.target);
    if (!especies.sprites.has(id)) pedirSprite(id);
  }
}, { root: null, rootMargin: '200px' });

function desenharEspecies() {
  const busca = $('#especies-busca').value.trim().toLowerCase();
  const abas = [['todos', 'Todos'], ['lendarios', '👑 Lendários'], ...GERACOES.map(([, , g]) => [g, g])];
  const filtrar = (aba) => especies.lista.filter((e) =>
    (aba === 'todos' || (aba === 'lendarios' ? LENDARIOS.has(e.id) : geracaoDe(e.id) === aba)));
  $('#especies-abas').replaceChildren(...abas.map(([id, rotulo]) =>
    el('button', { class: especies.aba === id ? 'ativa' : '', onclick: () => { especies.aba = id; desenharEspecies(); } },
      `${rotulo} (${filtrar(id).length})`)));
  const lista = filtrar(especies.aba).filter((e) =>
    !busca || e.nome.toLowerCase().includes(busca) || String(e.id) === busca.replace('#', ''));
  $('#especies-grade').replaceChildren(...lista.map((e) => {
    const img = el('img', { alt: '', 'data-especie': String(e.id) });
    const pronto = especies.sprites.get(e.id);
    if (pronto) img.src = pronto;
    else if (pronto === null) img.classList.add('sem-sprite-img');
    else observadorSprites.observe(img);
    return el('button', { class: 'item-rmt especie' + (LENDARIOS.has(e.id) ? ' lendario' : ''), title: `#${e.id} ${e.nome}`,
      onclick: () => { fecharEspecies(); especies.ao && especies.ao(e); } },
      img, el('span', {}, el('small', {}, `#${e.id}`), e.nome));
  }));
  $('#especies-nota').textContent = especies.pronto
    ? `${lista.length} espécies. As variantes de Outland não aparecem aqui.`
    : 'Não consegui carregar a lista de espécies (sem internet?).';
}

async function abrirEspecies(aoEscolher) {
  especies.ao = aoEscolher;
  await carregarEspecies();
  $('#especies').hidden = false;
  $('#especies-busca').value = '';
  desenharEspecies();
  $('#especies-busca').focus();
}
function fecharEspecies() { $('#especies').hidden = true; }
$('#especies-busca').addEventListener('input', desenharEspecies);
$('#especies-fechar').addEventListener('click', fecharEspecies);
$('#especies-qualquer').addEventListener('click', () => { fecharEspecies(); especies.ao && especies.ao(null); });
$('#especies').addEventListener('click', (e) => { if (e.target.id === 'especies') fecharEspecies(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharEspecies(); });

// ------------------------------------------------------------------ Sugestões para aprovar

const sugestoesPendentes = []; // { conta, id, nome, itemId, preco, moeda, qtd, media, pctMedia, compravelEm, recebidaEm, offset }

function receberSugestao(i, s) {
  if (sugestoesPendentes.some((x) => x.conta === i && x.id === s.id)) return;
  sugestoesPendentes.unshift({ ...s, conta: i, recebidaEm: Date.now(), offset: Date.now() - s.agoraServidor });
  celularSujo.mercado = true;
  desenharSugestoes();
}

function resolverSugestao(s, aprovar) {
  const c = contas[s.conta];
  if (c && c.pronta) c.webview.send('central', { tipo: aprovar ? 'aprovarSugestao' : 'ignorarSugestao', id: s.id });
  const k = sugestoesPendentes.indexOf(s);
  if (k >= 0) sugestoesPendentes.splice(k, 1);
  celularSujo.mercado = true;
  desenharSugestoes();
}

function desenharSugestoes() {
  // Sugestão com mais de 30 min sai da lista: o anúncio provavelmente já foi vendido.
  for (let k = sugestoesPendentes.length - 1; k >= 0; k--) {
    if (Date.now() - sugestoesPendentes[k].recebidaEm > 30 * 60_000) sugestoesPendentes.splice(k, 1);
  }
  const lista = filtroConta === 'todas' ? sugestoesPendentes : sugestoesPendentes.filter((x) => x.conta === filtroConta);
  $('#contagem-sugestoes').textContent = lista.length ? `${lista.length} para aprovar` : '';
  const seloMercado = $('#selo-mercado');
  seloMercado.textContent = String(sugestoesPendentes.length);
  seloMercado.hidden = !sugestoesPendentes.length;
  if (!lista.length) {
    return $('#sugestoes').replaceChildren(el('p', { class: 'vazio' }, 'Nenhuma oferta agora. Ligue o Radar de ofertas (ou uma regra "abaixo da média" com aprovação).'));
  }
  $('#sugestoes').replaceChildren(...lista.map((s) => {
    const it = catalogo.lista.find((x) => x.id === Number(s.itemId));
    const falta = s.compravelEm ? s.compravelEm - (Date.now() - s.offset) : 0;
    const quando = falta > 0 ? `libera em ${Math.ceil(falta / 1000)} s (entra no sorteio)` : 'liberado: compra na hora';
    return el('div', { class: 'sugestao', 'data-conta': String(s.conta) },
      it && it.icone ? el('img', { src: it.icone, alt: '' }) : el('span', { class: 'sem-icone' }, '?'),
      el('div', { class: 'desc' },
        el('b', {}, `${s.qtd > 1 ? s.qtd + '× ' : ''}${s.nome}`),
        el('small', {}, `${config.contas[s.conta].nome} · ${s.regraId === 'radar' ? 'radar' : 'regra'} · ${quando} · há ${Math.max(0, Math.round((Date.now() - s.recebidaEm) / 60_000))} min`)),
      el('div', { class: 'preco-sug' },
        el('b', {}, `${Number(s.preco).toLocaleString('pt-BR')} ${s.moeda === 'orb' ? 'Gemas' : 'Coins'}`),
        s.pctMedia != null ? el('small', { class: s.pctMedia <= 50 ? 'muito-barato' : '' }, `${s.pctMedia}% da média de ${Number(s.media).toLocaleString('pt-BR')}`) : null),
      el('button', { class: 'comprar', onclick: () => resolverSugestao(s, true) }, 'Comprar'),
      el('button', { class: 'discreto', onclick: () => resolverSugestao(s, false) }, 'Ignorar'));
  }));
}
setInterval(() => { if (sugestoesPendentes.length) desenharSugestoes(); }, 5000);

// ------------------------------------------------------------------ Histórico de sorteios

const ROTULO_RESULTADO = { aguardando: 'aguardando…', ganhou: 'ganhou', perdeu: 'perdeu', recusado: 'recusado', 'sem resposta': 'sem resposta' };
const ROTULO_HISTORICO = { ganhou: 'comprou', perdeu: 'perdeu o sorteio', recusado: 'recusado', 'sem resposta': 'sem resposta' };
const ORIGEM_LOJA = 'reposição na loja';
const nomeMoeda = (m) => (m === 'orb' ? 'Gemas' : 'Coins');
const numBR = (n) => Number(n || 0).toLocaleString('pt-BR');
const dataHora = (em) => new Date(em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const vistaAtiva = (nome) => $(`#vista-${nome}`).classList.contains('ativa');

// ------------------------------------------------------------------ Histórico de compras
// Compras e disparos do sniper, do radar aprovado e da reposição na loja. Ficam em historico-compras.json
// (até 2.000, os mais recentes). A aba Sniper mostra os sorteios; a aba Mercado mostra o histórico completo.

let compras = [];
// Disparos que ainda esperam o resultado do jogo: aparecem em Sorteios, mas não são salvos até terminarem.
const sorteiosAbertos = new Map();

// Um disparo ou uma compra da loja, no formato que o histórico guarda.
function registroDeCompra(r, conta) {
  const qtd = Number(r.qtd) || 1;
  const preco = Number(r.preco) || 0;
  return {
    uid: r.uid || `${conta}:${r.id}:${r.em}`,
    em: Number(r.em) || Date.now(),
    conta,
    origem: r.origem || 'sniper',
    regraId: r.regraId || null,
    tipo: r.tipo || (r.origem === ORIGEM_LOJA ? 'loja' : 'direta'),
    alvo: r.alvo || 'item',
    nome: String(r.nome || 'Item').slice(0, 120),
    qtd,
    preco,
    total: r.total != null && Number.isFinite(Number(r.total)) ? Number(r.total) : qtd * preco,
    moeda: r.moeda === 'orb' ? 'orb' : 'gold',
    resultado: r.resultado || 'sem resposta',
    motivo: String(r.motivo || '').slice(0, 200)
  };
}

// Guarda um registro final (ganhou, perdeu, recusado ou sem resposta) e atualiza as duas telas.
function guardarCompra(registro) {
  compras = [registro, ...compras.filter((c) => c.uid !== registro.uid)].sort((a, b) => b.em - a.em).slice(0, 2000);
  celularSujo.mercado = true;
  window.central.registrarCompras([registro]);
  desenharSorteios();
  desenharHistoricoCompras();
}

// Resultado de um disparo. "aguardando" fica só na tela de Sorteios; o resultado final vai para o histórico.
function registrarSorteio(i, s) {
  const chave = `${i}:${s.id}:${s.em}`;
  if (s.resultado === 'aguardando') {
    sorteiosAbertos.set(chave, { ...s, conta: i, uid: chave });
    return desenharSorteios();
  }
  sorteiosAbertos.delete(chave);
  guardarCompra(registroDeCompra({ ...s, uid: chave }, i));
}

// Sorteios: os disparos do sniper (a reposição da loja fica só no histórico). "Limpar" esconde da lista
// a partir de agora; o histórico continua salvo.
function desenharSorteios() {
  const corte = Number(config.sorteiosOcultosAte) || 0;
  const lista = [...sorteiosAbertos.values(), ...compras]
    .filter((s) => s.origem !== ORIGEM_LOJA && s.em > corte && (filtroConta === 'todas' || s.conta === filtroConta))
    .sort((a, b) => b.em - a.em)
    .slice(0, 200);
  const conta = (r) => lista.filter((x) => x.resultado === r).length;
  $('#placar-sorteios').textContent = lista.length
    ? `ganhou ${conta('ganhou')} · perdeu ${conta('perdeu')} · recusado ${conta('recusado')} · sem resposta ${conta('sem resposta')}`
    : '';
  if (!lista.length) return $('#sorteios').replaceChildren(el('p', { class: 'vazio' }, 'Nenhum disparo ainda.'));
  $('#sorteios').replaceChildren(...lista.map((s) => el('div', { class: 'linha-sorteio ' + s.resultado.replace(' ', '-'), 'data-conta': String(s.conta) },
    el('span', { class: 'hora' }, new Date(s.em).toLocaleTimeString('pt-BR')),
    el('span', { class: 'conta-log' }, (config.contas[s.conta] || {}).nome || `Conta ${s.conta + 1}`),
    el('span', { class: 'nome' }, `${s.qtd > 1 ? s.qtd + '× ' : ''}${s.nome}`),
    el('span', {}, `${numBR(s.preco)} ${nomeMoeda(s.moeda)}`),
    el('span', { class: 'tipo' }, s.tipo === 'sorteio' ? 'sorteio' : 'direta'),
    el('b', { class: 'resultado', title: s.motivo || '' }, ROTULO_RESULTADO[s.resultado] || s.resultado))));
}

// Sorteios antigos (que ficavam no config.json) passam para o histórico de compras, uma vez só.
async function migrarSorteiosAntigos() {
  const antigos = (config.sorteios || []).filter((s) => s && s.resultado && s.resultado !== 'aguardando');
  if (!antigos.length) return;
  const uids = new Set(compras.map((c) => c.uid));
  const novos = antigos
    .map((s) => registroDeCompra({ ...s, uid: `antigo:${s.conta}:${s.id}:${s.em}` }, Number(s.conta) || 0))
    .filter((r) => !uids.has(r.uid));
  compras = [...novos, ...compras].sort((a, b) => b.em - a.em).slice(0, 2000);
  if (novos.length) window.central.registrarCompras(novos);
  await salvar({ sorteios: [] });
}

async function carregarHistoricos() {
  try {
    compras = ((await window.central.historicoCompras()) || []).filter((c) => c && c.uid);
    for (const l of (await window.central.historicoGlobal()) || []) if (l && l.id != null) historicoGlobal.set(l.id, l);
    await migrarSorteiosAntigos();
  } catch (err) {
    console.error('[central] não consegui ler o histórico:', err);
  }
}

// Histórico de compras na aba Mercado: filtro por conta e por período, 50 por vez, com totais gastos por moeda.
const PERIODOS_HISTORICO = [['24h', '24 h', 24 * 3600_000], ['7d', '7 dias', 7 * 24 * 3600_000], ['tudo', 'Tudo', 0]];
const PAGINA_HISTORICO = 50;
const filtroHistorico = { conta: 'todas', periodo: '7d', visiveis: PAGINA_HISTORICO };

function desenharHistoricoCompras() {
  const trocar = (campo, valor) => { filtroHistorico[campo] = valor; filtroHistorico.visiveis = PAGINA_HISTORICO; desenharHistoricoCompras(); };
  $('#hist-contas').replaceChildren(...[['todas', 'Todas'], ...config.contas.map((c, j) => [j, c.nome])].map(([v, nome]) =>
    el('button', { class: filtroHistorico.conta === v ? 'ativa' : '', onclick: () => trocar('conta', v) }, nome)));
  $('#hist-periodo').replaceChildren(...PERIODOS_HISTORICO.map(([v, nome]) =>
    el('button', { class: filtroHistorico.periodo === v ? 'ativa' : '', onclick: () => trocar('periodo', v) }, nome)));

  const periodo = PERIODOS_HISTORICO.find((p) => p[0] === filtroHistorico.periodo) || PERIODOS_HISTORICO[0];
  const corte = periodo[2] ? Date.now() - periodo[2] : 0;
  const filtradas = compras.filter((c) => c.em >= corte && (filtroHistorico.conta === 'todas' || c.conta === filtroHistorico.conta));
  // Gasto = só o que foi comprado. Sorteio perdido e recusado não gastam nada.
  const ganhas = filtradas.filter((c) => c.resultado === 'ganhou');
  const gasto = (moeda) => ganhas.filter((c) => c.moeda === moeda).reduce((t, c) => t + c.total, 0);
  const perdidos = filtradas.filter((c) => c.resultado === 'perdeu').length;
  $('#hist-totais').replaceChildren(
    'Gasto: ', el('b', {}, `${numBR(gasto('gold'))} Coins`), ' · ', el('b', {}, `${numBR(gasto('orb'))} Gemas`),
    el('small', {}, ` · ${ganhas.length} compra(s)${perdidos ? ` · ${perdidos} sorteio(s) perdido(s)` : ''}`));

  const visiveis = filtradas.slice(0, filtroHistorico.visiveis);
  $('#hist-lista').replaceChildren(...(visiveis.length ? visiveis.map((c) => el('div', {
    class: 'hist-linha ' + c.resultado.replace(' ', '-'), 'data-conta': String(c.conta)
  },
    el('span', { class: 'hora' }, dataHora(c.em)),
    el('span', { class: 'conta-log' }, (config.contas[c.conta] || {}).nome || 'conta removida'),
    el('span', { class: 'nome' }, `${c.qtd > 1 ? c.qtd + '× ' : ''}${c.nome}`, el('small', {}, ` · ${c.origem}`)),
    el('span', {}, `${numBR(c.preco)} ${nomeMoeda(c.moeda)}`),
    el('span', {}, `${numBR(c.total)} ${nomeMoeda(c.moeda)}`),
    el('b', { class: 'resultado' }, ROTULO_HISTORICO[c.resultado] || c.resultado))) : [el('p', { class: 'vazio' }, 'Nenhuma compra neste período.')]));
  $('#hist-mais').hidden = filtradas.length <= visiveis.length;
  $('#hist-contagem').textContent = filtradas.length ? `${visiveis.length} de ${filtradas.length}` : '';
}

// ------------------------------------------------------------------ Mercado nas últimas 24 h (aba Mercado)
// Vendas do mercado do jogo, lidas pela conta que lê os preços. Só com a aba Mercado aberta, pede a página
// 0 ao abrir e a cada minuto. Vendedor e comprador não são guardados nem mostrados.
const HG_JANELA_MS = 24 * 3600_000;
const HG_INTERVALO_MS = 60_000;
const HG_ESPERA_MS = 120_000;
const historicoGlobal = new Map(); // id -> venda (últimas 24 h), salva em historico-global.json
const hgEstado = { leitor: -1, pediuEm: 0, recebidoEm: 0, falhou: false };

function podarHistoricoGlobal() {
  const corte = Date.now() - HG_JANELA_MS;
  for (const [id, l] of historicoGlobal) if (l.em < corte) historicoGlobal.delete(id);
}

// Pede a página 0 à conta que lê o mercado (a escolhida na aba Mercado).
function pedirHistoricoGlobal() {
  const i = Number($('#mercado-conta').value) || 0;
  const c = contas[i];
  hgEstado.falhou = !c || !c.pronta || !(c.estado && c.estado.conectado);
  if (!hgEstado.falhou) {
    hgEstado.leitor = i;
    hgEstado.pediuEm = Date.now();
    c.webview.send('central', { tipo: 'pedirHistoricoGlobal' });
  }
  desenharHistoricoGlobal();
}

// Resposta do jogo: junta as vendas novas (pelo id) e guarda só as das últimas 24 h.
function receberHistoricoGlobal(i, dados) {
  if (dados.falhou) { hgEstado.falhou = true; return desenharHistoricoGlobal(); }
  if (i !== hgEstado.leitor) return;
  const corte = Date.now() - HG_JANELA_MS;
  const novas = (dados.linhas || []).filter((l) => l && l.id != null && l.em >= corte);
  for (const l of novas) historicoGlobal.set(l.id, l);
  podarHistoricoGlobal();
  hgEstado.recebidoEm = Date.now();
  hgEstado.falhou = false;
  if (novas.length) window.central.registrarGlobal(novas);
  desenharHistoricoGlobal();
}

function desenharHistoricoGlobal() {
  podarHistoricoGlobal();
  const agora = Date.now();
  const linhas = [...historicoGlobal.values()];
  const esperando = hgEstado.pediuEm > 0 && hgEstado.recebidoEm < hgEstado.pediuEm;
  const indisponivel = hgEstado.falhou || (esperando && agora - hgEstado.pediuEm > HG_ESPERA_MS);
  $('#hg-status').textContent = indisponivel ? 'Histórico global indisponível agora'
    : hgEstado.recebidoEm ? `atualizado às ${new Date(hgEstado.recebidoEm).toLocaleTimeString('pt-BR')} · ${linhas.length} venda(s) em 24 h`
    : 'aguardando a primeira leitura';

  const recentes = [...linhas].sort((a, b) => b.em - a.em).slice(0, 50);
  $('#hg-recentes').replaceChildren(...(recentes.length ? recentes.map((l) => el('div', { class: 'hg-linha' },
    el('span', { class: 'hora' }, new Date(l.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })),
    el('span', { class: 'nome' }, l.descricao || l.nome || '—'),
    el('b', {}, `${numBR(l.bruto)} ${nomeMoeda(l.moeda)}`))) : [el('p', { class: 'vazio' }, 'Nenhuma venda nas últimas 24 h ainda.')]));

  // Mais vendidos: só vendas de item com quantidade e nome na descrição ("12 × Nome"). Agrupa pelo nome.
  const grupos = new Map();
  for (const l of linhas) {
    if (l.tipo !== 'item') continue;
    const m = /^\s*([\d.]+)\s*[×x]\s*(.+?)\s*$/.exec(l.descricao || '');
    const qtd = m ? Number(m[1].replace(/\./g, '')) : 0;
    if (!m || !(qtd > 0)) continue;
    const g = grupos.get(m[2]) || { nome: m[2], vendas: 0, qtd: 0, total: { gold: 0, orb: 0 }, qtdMoeda: { gold: 0, orb: 0 } };
    g.vendas++;
    g.qtd += qtd;
    g.total[l.moeda] += l.bruto;
    g.qtdMoeda[l.moeda] += qtd;
    grupos.set(m[2], g);
  }
  const top = [...grupos.values()].sort((a, b) => b.qtd - a.qtd || b.vendas - a.vendas || a.nome.localeCompare(b.nome)).slice(0, 10);
  $('#hg-top').replaceChildren(...(top.length ? top.map((g) => el('div', { class: 'hg-linha top' },
    el('span', { class: 'nome' }, g.nome, el('small', {}, ` · ${g.vendas} venda(s)`)),
    el('span', {}, `${numBR(g.qtd)} un.`),
    el('span', { class: 'media' }, [
      g.qtdMoeda.gold ? `${numBR(Math.floor(g.total.gold / g.qtdMoeda.gold))} Coins/un.` : null,
      g.qtdMoeda.orb ? `${numBR(Math.floor(g.total.orb / g.qtdMoeda.orb))} Gemas/un.` : null
    ].filter(Boolean).join(' · ') || '—'),
    el('b', {}, [g.total.gold ? `${numBR(g.total.gold)} Coins` : null, g.total.orb ? `${numBR(g.total.orb)} Gemas` : null].filter(Boolean).join(' · ')))) : [el('p', { class: 'vazio' }, 'Nenhum item com quantidade nas vendas de 24 h.')]));
}

// Ao abrir a aba Mercado: pede o histórico global agora e a cada minuto enquanto ela estiver aberta.
function aoAbrirMercado() {
  pedirHistoricoGlobal();
  desenharHistoricoCompras();
}
setInterval(() => { if (vistaAtiva('mercado')) pedirHistoricoGlobal(); }, HG_INTERVALO_MS);

// Filtro por conta dos Sorteios e do Registro ("todas" ou o índice da conta).
let filtroConta = 'todas';
function definirFiltroConta(valor) {
  filtroConta = valor;
  for (const id of ['#log', '#sorteios']) {
    const caixa = $(id);
    for (let j = 0; j < 4; j++) caixa.classList.toggle(`so-conta-${j}`, valor === j);
  }
  desenharFiltroConta();
  desenharSorteios();
  desenharSugestoes();
}
function desenharFiltroConta() {
  $('#filtro-conta').replaceChildren(
    el('span', { class: 'rotulo' }, 'Mostrar:'),
    ...[['todas', 'Todas'], ...config.contas.map((c, j) => [j, c.nome])].map(([v, nome]) =>
      el('button', { class: filtroConta === v ? 'ativa' : '', onclick: () => definirFiltroConta(v) }, nome)));
}

// ------------------------------------------------------------------ Hunts: onde caçar

const hunts = { dados: [null, null, null, null] };

function pedirHunts() {
  const i = Number($('#hunts-conta').value) || 0;
  const c = contas[i];
  if (!c || !c.pronta || !(c.estado && c.estado.conectado)) {
    $('#hunts-tabela').replaceChildren(el('p', { class: 'vazio' }, 'Essa conta não está conectada ao jogo.'));
    return;
  }
  if (!hunts.dados[i]) $('#hunts-tabela').replaceChildren(el('p', { class: 'vazio' }, 'Calculando…'));
  c.webview.send('central', { tipo: 'analisarHunts' });
}

async function receberHunts(i, dados) {
  await carregarEspecies();
  if (dados.erro) {
    if (Number($('#hunts-conta').value) === i) $('#hunts-tabela').replaceChildren(el('p', { class: 'vazio' }, `Não deu para calcular: ${dados.erro}`));
    return;
  }
  hunts.dados[i] = dados;
  celularSujo.hunts.add(i);
  if (Number($('#hunts-conta').value) === i) desenharHunts();
}

// As regiões do mapa do jogo (1.326), na mesma ordem das abas dele, com o nível em que cada uma abre.
const REGIOES_HUNT = [
  ['kanto', 'Kanto', 1], ['outland', 'Outland', 150], ['johto', 'Johto', 200], ['hoenn', 'Hoenn', 500],
  ['sinnoh', 'Sinnoh', 1000], ['unova', 'Unova', 5000], ['kalos', 'Kalos', 10000], ['alola', 'Alola', 25000],
  ['galar', 'Galar', 40000], ['paldea', 'Paldea', 75000]
];
const NOME_REGIAO = Object.fromEntries(REGIOES_HUNT.map(([id, nome]) => [id, nome]));
// Hunt sem a região nova (dado antigo): cai na aba pela área.
const regiaoDaHunt = (h) => h.regiao || (h.area === 'outland' ? 'outland' : h.area === 'kanto' ? 'kanto' : '');
const rotuloRegiao = (h) => NOME_REGIAO[regiaoDaHunt(h)] || h.regiao || h.area || '—';
hunts.regiao = '';
hunts.aberta = null;
const pctDrop = (p) => (p >= 1 ? `${p.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : `${p.toLocaleString('pt-BR', { maximumSignificantDigits: 2 })}%`);
const chanceRara = (c) => `${(c * 100).toLocaleString('pt-BR', { maximumSignificantDigits: 2 })}% · 1 em ${fmt(Math.round(1 / c))}`;
const pokemonEscolhido = [null, null, null, null]; // id do pokémon avaliado em cada conta

// A mesma regra do jogo (shared/tipo-efetividade.mjs): a tabela traz o resto, a diagonal mora à parte.
function efetividadeTipos(atq, def1, def2, tabela, diagonal) {
  const linha = tabela[String(atq).toUpperCase()] || {};
  const contra = (def) => (String(def).toUpperCase() === String(atq).toUpperCase() ? (diagonal[String(atq).toUpperCase()] ?? 1) : (linha[String(def).toUpperCase()] ?? 1));
  let v = contra(def1);
  if (def2 && def2 !== def1) v *= contra(def2);
  return v;
}
// Na hunt a efetividade é amplificada (Wiki > Tipos): ×2 vira ×2,5, ×4 vira ×5,5, ×0,5 vira ×0,333.
const AMPLIFICADA = new Map([[0, 0], [0.25, 0.167], [0.5, 0.333], [1, 1], [2, 2.5], [4, 5.5]]);
const amplificarHunt = (v) => AMPLIFICADA.get(Math.round(v * 100) / 100) ?? v;

// Efetividade média (pelos pontos de spawn) do melhor golpe dos tipos do pokémon contra as espécies da hunt.
function vantagemNaHunt(hunt, tipos, d) {
  if (!tipos || !tipos.length) return null;
  let soma = 0; let peso = 0;
  for (const e of hunt.especies || []) {
    if (!e.tipos || !e.tipos.length) continue;
    const melhor = Math.max(...tipos.map((t) => efetividadeTipos(t, e.tipos[0], e.tipos[1] || null, d.tabelaTipos || {}, d.diagonal || {})));
    soma += amplificarHunt(melhor) * e.pontos; peso += e.pontos;
  }
  return peso ? Math.round((soma / peso) * 100) / 100 : null;
}

// O sprite da espécie: as cópias de Orre são 13000 + dex, e as variantes de Outland vêm pelo nome da base.
let dexPorNome = null;
function dexDaEspecie(e) {
  const id = Number(e.pokeId);
  if (id > 0 && id <= 1025) return id;
  if (id > 13000 && id <= 14025) return id - 13000;
  if (!dexPorNome) {
    dexPorNome = new Map();
    for (const x of especies.lista) dexPorNome.set(x.nome.toLowerCase(), x.id);
  }
  const nome = String(e.nome || '').toLowerCase();
  if (dexPorNome.has(nome)) return dexPorNome.get(nome);
  const semPrefixo = nome.split(' ').slice(1).join(' ');
  return dexPorNome.get(semPrefixo) || null;
}
const principalDaHunt = (h) => [...(h.especies || [])].sort((a, b) => b.pontos - a.pontos)[0] || null;
function spriteDaHunt(h, classe) {
  const p = principalDaHunt(h);
  const dex = p ? dexDaEspecie(p) : null;
  return dex ? spriteDaEspecie(dex, classe) : el('span', { class: classe + ' sem-sprite-hunt' }, '·');
}

function preencherPokemons(i, d) {
  const sel = $('#hunts-pokemon');
  const lista = d.pokemons || [];
  if (!lista.length) { sel.replaceChildren(el('option', { value: '' }, 'sem pokémons')); return null; }
  if (!lista.some((p) => p.id === pokemonEscolhido[i])) pokemonEscolhido[i] = (lista.find((p) => p.ativo) || lista[0]).id;
  sel.replaceChildren(...lista.map((p) => el('option', { value: String(p.id) },
    `${p.ativo ? '★ ' : ''}${p.shiny ? '✨' : ''}${p.nome} · Nv ${fmt(p.nivel)} · ${(p.tipos || []).join('/')}${p.ativo ? ' (em campo)' : ''}`)));
  sel.value = String(pokemonEscolhido[i]);
  return lista.find((p) => p.id === pokemonEscolhido[i]);
}

function desenharHunts() {
  const i = Number($('#hunts-conta').value) || 0;
  const d = hunts.dados[i];
  if (!d) return;
  const pk = preencherPokemons(i, d);
  const ordem = $('#hunts-ordem').value;
  const regiao = hunts.regiao;
  const nivelMin = Number($('#hunts-nivel-min').value) || 0;
  const nivelMax = Number($('#hunts-nivel-max').value) || 0;
  const busca = $('#hunts-busca').value.trim().toLowerCase();
  const usarRitmo = $('#hunts-ritmo').checked && d.ritmo && d.ritmo.fator > 0;
  const fator = usarRitmo ? d.ritmo.fator : 1;
  const nivelPk = (pk && pk.nivel) || 0;
  const limiteSeguro = nivelPk * 1.25;
  const risco = (h) => nivelPk > 0 && h.nivel > limiteSeguro;

  const todas = d.hunts.map((h) => ({
    ...h, vantagem: vantagemNaHunt(h, pk && pk.tipos, d),
    xpTrH: h.xpTrH * fator, xpPkH: h.xpPkH * fator, goldH: h.goldH * fator, killsH: h.killsH * fator
  }));
  const linhas = todas
    .filter((h) => (!$('#hunts-liberadas').checked || h.liberada) && (!regiao || regiaoDaHunt(h) === regiao) &&
      (!nivelMin || h.nivel >= nivelMin) && (!nivelMax || h.nivel <= nivelMax) &&
      (!$('#hunts-sem-risco').checked || !risco(h)) && (!busca || h.nome.toLowerCase().includes(busca)))
    .sort((a, b) => (b[ordem] ?? -1) - (a[ordem] ?? -1) || (b.vantagem ?? 0) - (a.vantagem ?? 0));

  $('#hunts-info').textContent = [
    `Treinador Nv ${fmt(d.nivelTreinador)}`,
    pk ? `avaliando ${pk.nome} Nv ${fmt(pk.nivel)} (${(pk.tipos || []).join('/')}) · seguro até hunt Nv ${fmt(Math.floor(limiteSeguro))}` : null,
    d.ritmo ? `ritmo real na hunt atual: ${fmt(d.ritmo.killsReal)} abates/h (${Math.round(d.ritmo.fator * 100)}% do estimado)` : 'ritmo real: fique uns 3 min numa hunt para o app medir',
    `calculado às ${new Date(d.em).toLocaleTimeString('pt-BR')}`
  ].filter(Boolean).join(' · ');

  desenharCaminho(todas, d, pk, limiteSeguro);
  desenharRegioesHunt(todas);

  if (!linhas.length) return $('#hunts-tabela').replaceChildren(el('p', { class: 'vazio' }, 'Nenhuma hunt com esses filtros.'));
  $('#hunts-tabela').replaceChildren(el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, '#'), el('th', {}, 'Hunt'), el('th', {}, 'Região'), el('th', {}, 'Nv'),
      el('th', {}, 'XP treinador/h'), el('th', {}, 'XP pokémon/h'), el('th', {}, 'Ouro/h'), el('th', {}, 'Abates/h'),
      el('th', { title: 'Efetividade média dos tipos do pokémon escolhido contra as espécies da hunt' }, 'Vantagem'), el('th', {}, ''))),
    el('tbody', {}, ...linhas.slice(0, 200).flatMap((h, n) => [el('tr', { class: (h.atual ? 'atual ' : '') + (n < 3 ? 'destaque ' : '') + 'clicavel' + (hunts.aberta === h.slug ? ' aberta' : ''),
      title: 'Clique para ver a ficha da hunt', onclick: () => { hunts.aberta = hunts.aberta === h.slug ? null : h.slug; desenharHunts(); } },
      el('td', {}, String(n + 1)),
      el('td', { class: 'item' }, spriteDaHunt(h, 'ico-hunt'), h.nome, h.atual ? el('small', {}, ' · você está aqui') : null),
      el('td', {}, rotuloRegiao(h)),
      el('td', {}, fmt(h.nivel)),
      el('td', { class: 'calc' }, curto(Math.round(h.xpTrH))),
      el('td', {}, curto(Math.round(h.xpPkH))),
      el('td', {}, curto(Math.round(h.goldH))),
      el('td', {}, fmt(Math.round(h.killsH))),
      el('td', {}, seloVantagem(h.vantagem)),
      el('td', {}, !h.liberada ? el('span', { class: 'vant imune' }, 'trancada') : risco(h) ? el('span', { class: 'vant fraca', title: 'A hunt passa de 125% do nível do pokémon escolhido' }, '⚠ risco') : '')),
    hunts.aberta === h.slug ? el('tr', { class: 'ficha-linha' }, el('td', { colspan: '10' }, fichaHunt(h, d))) : null].filter(Boolean)))));
}

// Os chips das regiões, com quantas hunts cada uma tem (contando os filtros de nível e "só liberadas").
function desenharRegioesHunt(todas) {
  const conta = {};
  for (const h of todas) { const r = regiaoDaHunt(h); conta[r] = (conta[r] || 0) + 1; }
  $('#hunts-regioes').replaceChildren(
    el('button', { class: 'cat' + (!hunts.regiao ? ' on' : ''), onclick: () => { hunts.regiao = ''; desenharHunts(); } }, 'Todas'),
    ...REGIOES_HUNT.filter(([id]) => conta[id]).map(([id, nome, nivel]) =>
      el('button', { class: 'cat' + (hunts.regiao === id ? ' on' : ''), title: `Abre no Nv ${fmt(nivel)}`, onclick: () => { hunts.regiao = id; desenharHunts(); } },
        nome, el('small', {}, ` ${conta[id]}`))));
}

// A ficha da hunt, como o Hunt Analyser do mapa do jogo: tipos do pokémon principal, fraquezas e
// resistências, os drops de cada espécie e os raros (na Outland, pela chance do seu degrau).
function fichaHunt(h, d) {
  const tipos = (lista, classe) => lista.length
    ? el('div', { class: 'ficha-tipos ' + classe }, ...lista.map((x) => el('span', { class: 'tipo-chip' }, x.tipo, el('em', {}, ` ×${String(x.mult).replace('.', ',')}`))))
    : el('small', { class: 'nota' }, 'nenhum');
  const raros = h.raros || [];
  return el('div', { class: 'ficha-hunt' },
    el('div', { class: 'ficha-col' },
      el('b', {}, `${h.nome} · ${rotuloRegiao(h)} · Nv ${fmt(h.nivel)}`),
      h.tiposPrincipal && h.tiposPrincipal.length ? el('small', { class: 'nota' }, `Pokémon principal: ${h.tiposPrincipal.join(' / ')}`) : null,
      el('div', { class: 'ficha-sec' }, 'Fraco a'), tipos(h.fracos || [], 'bom'),
      el('div', { class: 'ficha-sec' }, 'Resiste a'), tipos(h.resiste || [], 'ruim'),
      raros.length ? el('div', { class: 'ficha-sec' }, h.area === 'outland' && d.outland ? `Raros · ${d.outland.rotulo}${d.outland.mult > 1 ? ` (×${d.outland.mult})` : ''}` : 'Raros') : null,
      raros.length ? el('ul', { class: 'ficha-drops' }, ...raros.map((r) => el('li', {}, el('span', {}, r.n), el('b', {}, chanceRara(r.chance))))) : null),
    el('div', { class: 'ficha-col ficha-drops-col' },
      el('div', { class: 'ficha-sec' }, 'Drops'),
      (h.drops || []).length ? el('div', { class: 'ficha-especies' }, ...(h.drops || []).map((e) =>
        el('div', { class: 'ficha-especie' },
          el('div', { class: 'ficha-especie-nome' }, (dexDaEspecie({ pokeId: e.pokeId, nome: e.nome }) ? spriteDaEspecie(dexDaEspecie({ pokeId: e.pokeId, nome: e.nome }), 'ico-hunt') : null), e.nome || `#${e.pokeId}`),
          el('ul', { class: 'ficha-drops' }, ...e.itens.map((x) => el('li', {}, el('span', {}, x.n), el('b', {}, x.pct > 0 ? pctDrop(x.pct) : 'nunca cai')))))))
        : el('small', { class: 'nota' }, 'Sem drops nesta hunt.')));
}

function seloVantagem(v) {
  if (v == null) return el('span', { class: 'vant neutra' }, '—');
  const classe = v >= 2.5 ? 'forte' : v > 1 ? 'boa' : v === 1 ? 'neutra' : v > 0 ? 'fraca' : 'imune';
  return el('span', { class: 'vant ' + classe }, `×${String(v).replace('.', ',')}`);
}

// O caminho de up do pokémon escolhido: a melhor hunt agora (o nível mais alto que ele aguenta, com a
// melhor vantagem nesse nível) e os próximos degraus de nível de hunt, com o que cada um pede.
function desenharCaminho(todas, d, pk, limiteSeguro) {
  const caixa = $('#hunts-caminho');
  if (!pk) return caixa.replaceChildren();
  const melhorDoNivel = (lista) => lista.sort((a, b) => (b.vantagem ?? 0) - (a.vantagem ?? 0) || b.xpTrH - a.xpTrH)[0];
  const niveis = [...new Set(todas.map((h) => h.nivel))].sort((a, b) => a - b);
  const podeAgora = niveis.filter((n) => n <= limiteSeguro && n <= d.nivelTreinador);
  // Agora: entre os 3 níveis mais altos que ele aguenta, a hunt com melhor vantagem (vantagem ×1 ou mais).
  const candidatas = todas.filter((h) => h.liberada && podeAgora.slice(-3).includes(h.nivel));
  const boas = candidatas.filter((h) => (h.vantagem ?? 1) >= 1);
  const agora = (boas.length ? boas : candidatas).sort((a, b) => b.xpTrH * Math.min(b.vantagem ?? 1, 2.5) - a.xpTrH * Math.min(a.vantagem ?? 1, 2.5))[0];
  const proximos = niveis.filter((n) => n > (agora ? agora.nivel : 0)).slice(0, 4)
    .map((n) => melhorDoNivel(todas.filter((h) => h.nivel === n))).filter(Boolean);

  const cartao = (h, titulo, requisito) => el('div', { class: 'passo' + (titulo === 'Melhor agora' ? ' agora' : '') },
    el('small', { class: 'titulo-passo' }, titulo),
    el('div', { class: 'passo-hunt' }, spriteDaHunt(h, 'ico-passo'),
      el('div', {}, el('b', {}, h.nome), el('small', {}, `${rotuloRegiao(h)} · Nv ${fmt(h.nivel)}`))),
    el('div', { class: 'passo-num' }, el('span', {}, `${curto(Math.round(h.xpTrH))} XP/h`), seloVantagem(h.vantagem)),
    requisito ? el('small', { class: 'requisito' }, requisito) : null);

  caixa.replaceChildren(
    el('div', { class: 'titulo-caminho' }, `Caminho de up de ${pk.nome} (Nv ${fmt(pk.nivel)})`),
    el('div', { class: 'passos' },
      agora ? cartao(agora, 'Melhor agora', agora.atual ? 'você já está aqui' : null) : el('p', { class: 'vazio' }, 'Nenhuma hunt liberada e segura para esse pokémon.'),
      ...proximos.map((h, n) => {
        const pede = [];
        if (h.nivel > limiteSeguro) pede.push(`pokémon Nv ${fmt(Math.ceil(h.nivel / 1.25))}`);
        if (!h.liberada) pede.push(`treinador Nv ${fmt(h.nivel)}`);
        return cartao(h, `Próximo ${n + 1}`, pede.length ? `pede ${pede.join(' e ')}` : 'já dá');
      })));
}

function montarHunts() {
  const sel = $('#hunts-conta');
  sel.replaceChildren(...config.contas.map((c, i) => el('option', { value: String(i) }, c.nome)));
  sel.addEventListener('change', () => { if (hunts.dados[Number(sel.value)]) desenharHunts(); pedirHunts(); });
  $('#hunts-pokemon').addEventListener('change', (e) => {
    pokemonEscolhido[Number(sel.value) || 0] = Number(e.target.value) || e.target.value;
    desenharHunts();
  });
  $('#hunts-atualizar').addEventListener('click', pedirHunts);
  for (const id of ['#hunts-ordem', '#hunts-liberadas', '#hunts-ritmo', '#hunts-sem-risco', '#hunts-nivel-min', '#hunts-nivel-max']) $(id).addEventListener('change', desenharHunts);
  $('#hunts-busca').addEventListener('input', desenharHunts);
  document.querySelector('.abas button[data-vista="hunts"]').addEventListener('click', pedirHunts);
}

// ------------------------------------------------------------------ Mercado: preços do RMT

const mercado = { lidos: new Map(), em: null, conta: 0, medias: {}, filtro: '' };
// As mesmas categorias do Mercado da Comunidade do jogo (só as raras). Diamantes saíram do mercado do jogo.
const CATEGORIAS_MERCADO = [
  ['', 'Todas'], ['box', 'Boxes'], ['casa', 'Casas'], ['bicicleta', 'Bicicletas'], ['skin', 'Skins'],
  ['fragment', 'Fragmentos'], ['boss', 'Boss Tokens'], ['ticket', 'Tickets']
];
const COMISSAO = 0.15;

function atualizarPrecos(manual) {
  const i = Number($('#mercado-conta').value);
  const c = contas[i];
  if (!c || !c.pronta || !(c.estado && c.estado.conectado)) {
    if (manual) $('#mercado-tabela').replaceChildren(el('p', { class: 'vazio' }, 'Essa conta não está conectada ao jogo.'));
    $('#radar-status').textContent = 'Conta escolhida sem conexão com o jogo.';
    return;
  }
  if (manual && !mercado.em) $('#mercado-tabela').replaceChildren(el('p', { class: 'vazio' }, 'Pedindo os preços ao jogo…'));
  mercado.ultimaVez = Date.now();
  c.webview.send('central', { tipo: 'varrerPrecos' });
}

// Opções do radar (aba Mercado e celular): o padrão, o que está salvo, e o que a tela mostra.
const RADAR_PADRAO = { ativo: false, conta: 0, desconto: 30, moedaMedia: 'orb', minVendas: 5, auto: true, minutos: 2 };
const radarAtual = () => ({ ...RADAR_PADRAO, ...(config.radar || {}) });
function desenharRadar() {
  const rd = radarAtual();
  $('#mercado-conta').value = String(rd.conta);
  $('#radar-ativo').checked = rd.ativo;
  $('#radar-desconto').value = rd.desconto;
  $('#radar-moeda').value = rd.moedaMedia;
  $('#radar-vendas').value = rd.minVendas;
  $('#radar-auto').checked = rd.auto;
  $('#radar-minutos').value = rd.minutos;
}
// Salva as opções do radar e aplica na hora. Vale para a aba Mercado e para o celular (mesmo caminho).
async function salvarRadar(parcial) {
  await salvar({ radar: { ...radarAtual(), ...parcial } });
  desenharRadar();
  enviarSniper();
  if (config.radar.ativo) atualizarPrecos(false);
  celularSujo.mercado = true;
}
function lerRadarDaTela() {
  return {
    ativo: $('#radar-ativo').checked,
    conta: Number($('#mercado-conta').value),
    desconto: Math.min(95, Math.max(1, Number($('#radar-desconto').value) || 30)),
    moedaMedia: $('#radar-moeda').value,
    minVendas: Math.max(0, Number($('#radar-vendas').value) || 0),
    auto: $('#radar-auto').checked,
    minutos: Math.min(60, Math.max(1, Number($('#radar-minutos').value) || 2))
  };
}

function montarMercado() {
  const sel = $('#mercado-conta');
  sel.replaceChildren(...config.contas.map((c, i) => el('option', { value: String(i) }, c.nome)));
  desenharRadar();
  for (const id of ['#radar-ativo', '#radar-desconto', '#radar-moeda', '#radar-vendas', '#radar-auto', '#radar-minutos', '#mercado-conta']) {
    $(id).addEventListener('change', () => salvarRadar(lerRadarDaTela()));
  }
  $('#mercado-atualizar').addEventListener('click', () => atualizarPrecos(true));
  // Os "há N min" e o "desatualizado" envelhecem sozinhos: redesenha a tabela a cada 30 s, só com a aba aberta.
  setInterval(() => {
    if (vistaAtiva('mercado')) { if (mercado.em) desenharMercado(); desenharHistoricoGlobal(); }
  }, 30_000);
  // Atualização automática: a tabela e o radar usam a mesma leitura de preços.
  setInterval(() => {
    const r = config.radar || {};
    if (!(r.auto || r.ativo)) return;
    if (Date.now() - (mercado.ultimaVez || 0) >= (Number(r.minutos) || 2) * 60_000) atualizarPrecos(false);
  }, 15_000);
  $('#mercado-ambas').addEventListener('change', desenharMercado);
  // "Limpar" só esconde os sorteios da lista; o histórico de compras continua salvo.
  $('#limpar-sorteios').addEventListener('click', async () => { await salvar({ sorteiosOcultosAte: Date.now() }); desenharSorteios(); });
  $('#hist-mais').addEventListener('click', () => { filtroHistorico.visiveis += PAGINA_HISTORICO; desenharHistoricoCompras(); });
  $('#limpar-sugestoes').addEventListener('click', () => { [...sugestoesPendentes].forEach((s) => resolverSugestao(s, false)); });
}

async function receberPrecos(i, dados) {
  if (dados.erro) return $('#mercado-tabela').replaceChildren(el('p', { class: 'vazio' }, dados.erro));
  // Cada item guarda a sua última leitura (campos, valores e hora). Item que some de uma resposta
  // mantém a leitura antiga e vira "desatualizado" depois do limite, em vez de sumir da tabela.
  const emItens = dados.emItens || {};
  for (const [id, r] of Object.entries(dados.resumo || {})) {
    if (r && typeof r === 'object') mercado.lidos.set(Number(id), leituraDe(r, emItens[id] || dados.em, (dados.categoria || {})[id]));
  }
  mercado.medias = dados.medias || {};
  mercado.em = dados.em;
  mercado.conta = i;
  celularSujo.mercado = true;
  const r = config.radar || {};
  $('#radar-status').textContent = `Preços lidos às ${new Date(dados.em).toLocaleTimeString('pt-BR')}` +
    (r.ativo ? ` · radar procurando ${r.desconto}% abaixo da média` : '') +
    (r.auto || r.ativo ? ` · próxima leitura em ${r.minutos || 2} min` : '');
  await carregarCatalogo();
  desenharMercado();
}

const primeiroNum = (...v) => v.map(Number).find((n) => isFinite(n) && n > 0) ?? null;
// Número válido (zero conta) ou nulo.
const numeroOuNulo = (...v) => v.find((x) => typeof x === 'number' && isFinite(x) && x >= 0) ?? null;

// Leitura de um item no resumo do jogo: quando chegou, se o jogo mandou cada campo de preço (mesmo
// que nulo) e o menor valor. "anuncios" zero quer dizer que não há anúncio nenhum.
function leituraDe(r, em, cat) {
  const campos = { gold: ['minGold', 'gold', 'menorGold'], orb: ['minOrb', 'orb', 'minGema', 'menorOrb'] };
  const campo = {};
  const valor = {};
  for (const [moeda, nomes] of Object.entries(campos)) {
    campo[moeda] = nomes.some((n) => n in r);
    valor[moeda] = numeroOuNulo(...nomes.map((n) => r[n]));
  }
  return {
    em, cat: cat || '', nome: r.nome || r.name || '', anuncios: numeroOuNulo(r.anuncios), campo, valor,
    qtd: primeiroNum(r.qtd, r.quantidade, r.total, r.ofertas, r.anuncios)
  };
}
const SEM_LEITURA = { em: null, campo: {}, anuncios: null, valor: {} };

// Estado do preço de um item numa moeda. A ordem importa: desatualizado vence os outros.
//   disp           preço lido
//   sem_oferta     o jogo respondeu, mas sem anúncio (anuncios 0 ou campo de preço nulo)
//   nao_lido       o item nunca apareceu, ou o jogo não mandou o campo dessa moeda
//   desatualizado  a última leitura é mais antiga que o limite
function estadoDoPreco(l, moeda, agora, limiteMs) {
  if (!l || l.em == null) return 'nao_lido';
  if (agora - l.em > limiteMs) return 'desatualizado';
  if (!l.campo[moeda]) return 'nao_lido';
  if (l.anuncios === 0 || l.valor[moeda] == null) return 'sem_oferta';
  return 'disp';
}
const ROTULO_ESTADO = { sem_oferta: 'sem oferta', nao_lido: 'não lido' };
// Desatualizado: sem leitura há mais de 2 × o intervalo configurado no radar (padrão 2 min).
const limiteDesatualizado = () => (Number((config.radar || {}).minutos) || 2) * 2 * 60_000;

function tempoDesde(em) {
  const min = Math.floor((Date.now() - em) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h`;
}

// Categoria de um item do catálogo pelo nome (usada só para os itens ainda não lidos).
function categoriaDoItem(nome) {
  const n = String(nome || '').toLowerCase();
  if (/fragment|fragmento/.test(n)) return 'fragment';
  if (/token/.test(n)) return 'boss';
  if (/ticket/.test(n)) return 'ticket';
  if (/casa|house/.test(n)) return 'casa';
  if (/bicicleta|bike/.test(n)) return 'bicicleta';
  if (/caixa|box/.test(n)) return 'box';
  return '';
}
// Itens das categorias raras que o catálogo do jogo conhece: aparecem como "não lido" até entrarem numa leitura.
function candidatosNaoLidos() {
  return (catalogo.lista || [])
    .filter((it) => ['pecas', 'fragmentos', 'tickets'].includes(it.grupo))
    .map((it) => ({ id: it.id, nome: it.name, icone: it.icone, cat: categoriaDoItem(it.name) }))
    .filter((c) => c.cat);
}

function desenharCategoriasMercado() {
  const contagem = {};
  for (const l of mercado.lidos.values()) if (l.cat) contagem[l.cat] = (contagem[l.cat] || 0) + 1;
  $('#mercado-cats').replaceChildren(...CATEGORIAS_MERCADO.map(([id, nome]) =>
    el('button', { class: 'cat' + (mercado.filtro === id ? ' on' : ''), onclick: () => { mercado.filtro = id; desenharMercado(); } },
      nome, id && mercado.em ? el('small', {}, ` ${contagem[id] || 0}`) : null)));
}

// Uma linha da tabela: o estado e o valor de cada moeda, e as contas que dependem dos dois preços.
function linhaDoMercado(base, l, agora, limite) {
  const eG = estadoDoPreco(l, 'gold', agora, limite);
  const eO = estadoDoPreco(l, 'orb', agora, limite);
  const gold = eG === 'disp' ? l.valor.gold : null;
  const gema = eO === 'disp' ? l.valor.orb : null;
  const ambos = gold != null && gema != null && gema > 0;
  return {
    ...base, eG, eO, gold, gema, ambos,
    goldUlt: l.valor.gold ?? null, gemaUlt: l.valor.orb ?? null, em: l.em,
    // Comprar em Coins e revender em Gemas: Coins gastas por Gema líquida recebida.
    coinsPorGema: ambos ? gold / (gema * (1 - COMISSAO)) : null,
    // Comprar em Gemas e revender em Coins: Coins líquidas recebidas por Gema gasta.
    coinsPorGemaVendida: ambos ? (gold * (1 - COMISSAO)) / gema : null
  };
}

// As linhas do mercado (lidas e as raras ainda não lidas), na ordem da tabela. Usada pela aba e pelo celular.
function linhasDoMercado(filtro, soAmbas) {
  const agora = Date.now();
  const limite = limiteDesatualizado();
  const linhas = [];
  // Itens lidos (que podem já estar desatualizados) e os das categorias raras ainda não lidos.
  const pendentes = new Map(candidatosNaoLidos().map((c) => [c.id, c]));
  for (const id of new Set([...mercado.lidos.keys(), ...pendentes.keys()])) {
    const l = mercado.lidos.get(id);
    const cand = pendentes.get(id);
    const cat = l ? l.cat : cand.cat;
    if (filtro && cat !== filtro) continue;
    const it = catalogo.lista.find((x) => x.id === id)
      || [...catalogo.nossos, ...catalogo.base].filter((x) => x && x.id === id).map((x) => ({ name: x.name, icone: iconeDoItem(x.icon) }))[0];
    const md = ((mercado.medias || {})[id] || {}).orb || {};
    const row = linhaDoMercado({
      id, cat, nome: (it && it.name) || (l && l.nome) || (cand && cand.nome) || `Item #${id}`, icone: it && it.icone,
      qtd: l ? l.qtd : null, mediaGema: md.media || null, vendasGema: md.unidades || 0
    }, l || SEM_LEITURA, agora, limite);
    if (soAmbas && !row.ambos) continue;
    linhas.push(row);
  }
  // Os mais baratos em relação à média primeiro; sem média, pelo Coins por Gema. Sem preço vai para o fim.
  const pct = (l) => (l.mediaGema && l.gema ? l.gema / l.mediaGema : Infinity);
  linhas.sort((a, b) => pct(a) - pct(b) || (a.coinsPorGema ?? Infinity) - (b.coinsPorGema ?? Infinity));
  return linhas;
}

function desenharMercado() {
  desenharCategoriasMercado();
  if (!mercado.em) return;
  const soAmbas = $('#mercado-ambas').checked;
  const filtro = mercado.filtro;
  const NOME_CAT = Object.fromEntries(CATEGORIAS_MERCADO);
  const limite = limiteDesatualizado();
  const linhas = linhasDoMercado(filtro, soAmbas);
  if (!linhas.length) {
    return $('#mercado-tabela').replaceChildren(el('p', { class: 'vazio' },
      soAmbas ? 'Nenhum item desta categoria à venda nas duas moedas agora. Desmarque "Só itens à venda nas duas moedas" para ver todos.' : 'Nenhum anúncio nesta categoria agora.'));
  }

  const num = (n, casas = 0) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: casas }));
  const atualizado = new Date(mercado.em).toLocaleTimeString('pt-BR');
  // Preço de uma moeda: o valor, "sem oferta", "não lido" ou o último valor marcado como desatualizado.
  const celulaPreco = (estado, valor, ultimo) => {
    if (estado === 'disp') return el('td', {}, num(valor));
    if (estado === 'desatualizado') {
      return el('td', { class: 'desatualizado', title: `sem leitura há mais de ${Math.round(limite / 60_000)} min` },
        ultimo != null ? [num(ultimo), el('small', {}, ' · desatualizado')] : 'desatualizado');
    }
    return el('td', { class: 'sem-dado' }, ROTULO_ESTADO[estado]);
  };
  const celulaLido = (em) => el('td', { class: 'quando', title: em ? new Date(em).toLocaleString('pt-BR') : 'nunca lido nesta sessão' },
    em ? tempoDesde(em) : '—');
  $('#mercado-tabela').replaceChildren(
    el('p', { class: 'nota' }, `${linhas.length} ${linhas.length === 1 ? 'item' : 'itens'} · preços pela ${config.contas[mercado.conta].nome}, última leitura às ${atualizado}`),
    el('p', { class: 'nota legenda' }, `Sem oferta: o jogo respondeu sem anúncio. Não lido: o jogo ainda não mandou o preço. Desatualizado: sem leitura há mais de ${Math.round(limite / 60_000)} min (2 × o intervalo).`),
    el('table', {},
      el('thead', {}, el('tr', {},
        el('th', {}, 'Item'), el('th', {}, 'Menor em Coins'), el('th', {}, 'Menor em Gemas'),
        el('th', { title: 'Preço médio vendido em Gemas nos últimos 7 dias (unidades vendidas)' }, 'Média 7d em Gemas'),
        el('th', { title: 'Menor anúncio em Gemas comparado à média de 7 dias' }, '% da média'),
        el('th', { title: 'Comprar em Coins e revender em Gemas (menor = melhor)' }, 'Coins por Gema'),
        el('th', { title: 'Comprar em Gemas e revender em Coins (maior = melhor)' }, 'Coins por Gema vendida'),
        el('th', { title: 'Quando o preço foi lido pela última vez' }, 'Lido'))),
      el('tbody', {}, ...linhas.map((l, n) => el('tr', {
        class: [n < 5 && l.mediaGema && l.gema && l.gema / l.mediaGema <= 0.85 ? 'destaque' : '', l.em == null ? 'nao-lido' : ''].filter(Boolean).join(' ')
      },
        el('td', { class: 'item' }, l.icone ? el('img', { src: l.icone, alt: '' }) : null, l.nome,
          el('small', {}, [NOME_CAT[l.cat] && !filtro ? ` · ${NOME_CAT[l.cat]}` : '', l.qtd ? ` · ${num(l.qtd)} à venda` : ''].join(''))),
        celulaPreco(l.eG, l.gold, l.goldUlt),
        celulaPreco(l.eO, l.gema, l.gemaUlt),
        el('td', {}, l.mediaGema ? `${num(l.mediaGema)} (${num(l.vendasGema)} un.)` : '—'),
        el('td', { class: l.mediaGema && l.gema && l.gema / l.mediaGema <= 0.7 ? 'barato' : '' }, l.mediaGema && l.gema ? `${Math.round((l.gema / l.mediaGema) * 100)}%` : '—'),
        el('td', { class: 'calc' }, num(l.coinsPorGema)),
        el('td', { class: 'calc' }, num(l.coinsPorGemaVendida)),
        celulaLido(l.em))))));
}

// ------------------------------------------------------------------ Sniper

function salvarConta(i, parcial) {
  const lista = config.sniper.contas.map((c, j) => (j === i ? { ...c, ...parcial } : c));
  return salvar({ sniper: { ...config.sniper, contas: lista } });
}

function enviarSniper() {
  const sn = config.sniper;
  contas.forEach((c, i) => {
    const meu = sn.contas[i];
    c.el.classList.toggle('sniper', meu.ativo);
    c.tagSniper.textContent = meu.ativo ? 'SNIPER ON' : '';
    if (!meu.ativo) for (const [id, r] of reivindicados) if (r.conta === i) reivindicados.delete(id);
    if (!c.pronta) return;
    const rd = config.radar || {};
    c.webview.send('central', {
      tipo: 'radar',
      ativo: Boolean(rd.ativo) && Number(rd.conta) === i,
      desconto: rd.desconto, moedaMedia: rd.moedaMedia, minVendas: rd.minVendas
    });
    c.webview.send('central', {
      tipo: 'sniper',
      ativo: meu.ativo,
      regras: meu.regras,
      margemMs: sn.margemMs,
      varreduraSeg: sn.varreduraSeg
    });
  });
  const ligados = sn.contas.filter((c) => c.ativo).length;
  const selo = $('#selo-sniper');
  selo.textContent = ligados ? String(ligados) : 'off';
  selo.classList.toggle('on', ligados > 0);
}

// ------------------------------------------------------------------ Captura: lançar bolas

// Bolas, poções e regras do sniper/captura: o mesmo código que o painel do celular usa (regras.js).
const { NOMES_BOLA, POCOES_LOJA } = window.Regras;
const REPOSICAO_PADRAO = () => ({
  bola: { ativo: false, id: 1, abaixoDe: 50, qtd: 1000, limite: 0 },
  pocao: { ativo: false, id: 200, abaixoDe: 50, qtd: 1000, limite: 0 }
});

function enviarCaptura(i) {
  const cfg = config.captura.contas[i];
  const c = contas[i];
  if (c && c.pronta) c.webview.send('central', { tipo: 'captura', ativo: cfg.ativo, modo: cfg.modo, ballId: cfg.ballId, reposicao: cfg.reposicao || REPOSICAO_PADRAO() });
}

async function mudarCaptura(i, parcial) {
  config.captura.contas[i] = { ...config.captura.contas[i], ...parcial };
  await salvar({ captura: config.captura });
  enviarCaptura(i);
  desenharCaptura();
}

const haQuanto = (ms) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

function textoCaptura(cfg, e, cap) {
  const on = Boolean(e.conectado);
  if (cfg.ativo && !on) return { classe: '', txt: ['Pausado: a conta está desconectada. Volta sozinho quando ela reconectar.'] };
  if (!on) return { classe: '', txt: ['Conta desconectada'] };
  if (cfg.ativo && cap.pausa === 'sem_bola') return { classe: 'alerta', txt: [`Pausado: acabou a ${NOMES_BOLA[cfg.ballId] || 'bola escolhida'}. Escolha outra bola ou compre mais.`] };
  if (cfg.ativo) {
    if (!cap.lancadas) return { classe: 'lancando', txt: ['Ligado · esperando um pokémon cair'] };
    const partes = ['Lançando · ', el('b', {}, fmt(cap.lancadas)), ' bolas nesta sessão · ', el('b', {}, fmt(cap.capturas)), cap.capturas === 1 ? ' captura' : ' capturas'];
    if (cap.chance != null) partes.push(` · chance ${(cap.chance * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
    if (cap.ultimaEm) partes.push(` · última há ${haQuanto(Date.now() - cap.ultimaEm)}`);
    if (cap.perdidos) partes.push(' · ', el('b', { class: 'perdidos' }, fmt(cap.perdidos)), ' sem bola');
    return { classe: 'lancando', txt: partes };
  }
  if (cap.ultimaCaptura && cap.ultimaCaptura.nome) {
    return { classe: '', txt: ['Desligado · na última vez capturou ', el('b', {}, cap.ultimaCaptura.nome + (cap.ultimaCaptura.shiny ? ' ✨' : '')),
      ` com ${fmt(cap.ultimaCaptura.bolas)} ${cap.ultimaCaptura.bolas === 1 ? 'bola' : 'bolas'}`] };
  }
  return { classe: '', txt: ['Desligado'] };
}

function desenharCaptura() {
  const grade = $('#captura-grade');
  if (!grade || !config.captura) return;
  const ligadas = config.captura.contas.filter((c) => c.ativo).length;
  $('#selo-captura').textContent = String(ligadas);
  $('#selo-captura').hidden = !ligadas;
  if (!$('#vista-captura').classList.contains('ativa')) return; // só desenha com a aba aberta
  // Não redesenha enquanto você digita num campo da reposição (o redesenho tiraria o foco).
  const foco = document.activeElement;
  if (foco && grade.contains(foco) && (foco.tagName === 'INPUT' || foco.tagName === 'SELECT')) return;

  grade.replaceChildren(...contas.map((c, i) => {
    const cfg = config.captura.contas[i];
    const e = c.estado || {};
    const t = e.tel || {};
    const cap = e.captura || {};
    const on = Boolean(e.conectado);
    const nome = config.contas[i].nome;
    const bolas = cap.bolas || {};
    // As bolas que a conta tem (e a escolhida, mesmo zerada, para você ver que acabou).
    const ids = Object.keys(NOMES_BOLA).map(Number).filter((id) => (bolas[id] || 0) > 0 || id === cfg.ballId);
    const status = textoCaptura(cfg, e, cap);

    return el('div', { class: 'cap' + (on ? '' : ' off') },
      el('div', { class: 'cap-topo' },
        el('div', { class: 'avatar' }, (t.nick || nome).charAt(0).toUpperCase()),
        el('b', {}, t.nick || nome),
        el('span', { class: 'status ' + (on ? 'on' : 'off') }, on ? 'Online' : 'Offline'),
        el('span', { class: 'selo-nv' }, nome),
        el('label', { class: 'direita' }, cfg.ativo ? 'Ligado' : 'Desligado',
          el('button', { class: 'chave' + (cfg.ativo ? ' on' : ''), role: 'switch', 'aria-checked': String(cfg.ativo), title: cfg.ativo ? 'Desligar nesta conta' : 'Ligar nesta conta',
            onclick: () => mudarCaptura(i, { ativo: !cfg.ativo }) }))),
      cap.vip ? el('div', { class: 'aviso-vip' }, el('b', {}, 'Esta conta tem VIP. '),
        'Use o "Lançar até Capturar" do próprio jogo: ele roda no servidor, até com o app fechado.') : null,
      el('div', {},
        el('div', { class: 'rotulo' }, 'Modo'),
        el('div', { class: 'modos' },
          el('button', { class: cfg.modo === 'capturar' ? 'on' : '', title: 'Desliga sozinho na primeira captura', onclick: () => mudarCaptura(i, { modo: 'capturar' }) }, 'Jogar até capturar'),
          el('button', { class: cfg.modo === 'sempre' ? 'on' : '', title: 'Continua lançando até você desligar', onclick: () => mudarCaptura(i, { modo: 'sempre' }) }, 'Jogar pra sempre'))),
      el('div', {},
        el('div', { class: 'rotulo' }, 'Bola'),
        el('div', { class: 'bolas' }, ...(ids.length ? ids : [1]).map((id) => {
          const q = bolas[id] || 0;
          return el('button', { class: 'bola' + (id === cfg.ballId ? ' on' : '') + (q ? '' : ' vazia'), title: `${NOMES_BOLA[id]}: você tem ${fmt(q)}`,
            onclick: () => mudarCaptura(i, { ballId: id }) },
          el('img', { src: ICONE_BOLA[id], alt: '' }), NOMES_BOLA[id], el('small', {}, on ? fmt(q) : '—'));
        }))),
      linhasReposicao(i, cfg, cap, on),
      el('div', { class: 'cap-rodape ' + status.classe }, el('span', { class: 'ponto' }), ...status.txt));
  }));
}

// Reposição automática: uma linha para a bola e outra para a poção, com o que comprar, quando e quanto.
function linhasReposicao(i, cfg, cap, on) {
  const rep = cfg.reposicao || REPOSICAO_PADRAO();
  const st = cap.reposicao || {};
  const mudar = (tipo, parcial) => mudarCaptura(i, { reposicao: { ...rep, [tipo]: { ...rep[tipo], ...parcial } } });
  const numero = (tipo, campo, min, titulo) => el('input', { type: 'number', min: String(min), value: String(rep[tipo][campo]), title: titulo, class: 'rep-num',
    onchange: (ev) => mudar(tipo, { [campo]: Math.max(min, Number(ev.target.value) || 0) }) });
  const lojaBolas = (cap.lojaBolas && cap.lojaBolas.length) ? cap.lojaBolas : Object.entries(NOMES_BOLA).map(([id, nome]) => ({ id: Number(id), nome, preco: null }));
  const opcoes = {
    bola: lojaBolas.map((b) => [b.id, b.nome, b.preco]),
    pocao: POCOES_LOJA
  };
  const estoque = { bola: cap.bolas || {}, pocao: cap.pocoes || {} };
  const linha = (tipo, rotulo) => {
    const r = rep[tipo];
    const s = st[tipo] || {};
    const tem = estoque[tipo][r.id];
    const prod = opcoes[tipo].find(([id]) => id === Number(r.id));
    const custo = prod && prod[2] ? prod[2] * r.qtd : null;
    let info = '';
    if (s.aviso) info = s.aviso;
    else if (s.pendente) info = 'Comprando…';
    else if (s.ultima) info = `Comprou ${fmt(s.ultima.qtd)} às ${new Date(s.ultima.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${fmt(s.compras || 0)} ${s.compras === 1 ? 'compra' : 'compras'} nesta sessão`;
    else if (r.ativo) info = `Compra quando ficar abaixo de ${fmt(r.abaixoDe)}${custo ? ` · ${fmt(custo)} Coins por compra` : ''}`;
    return el('div', { class: 'rep-linha' + (r.ativo ? ' on' : '') },
      el('button', { class: 'chave mini' + (r.ativo ? ' on' : ''), role: 'switch', 'aria-checked': String(r.ativo), title: r.ativo ? 'Desligar' : 'Ligar', onclick: () => mudar(tipo, { ativo: !r.ativo }) }),
      el('b', {}, rotulo),
      el('select', { class: 'rep-item', title: 'O que comprar', onchange: (ev) => mudar(tipo, { id: Number(ev.target.value) }) },
        ...opcoes[tipo].map(([id, nome, preco]) => el('option', { value: String(id), selected: id === Number(r.id) },
          `${nome}${preco ? ` · ${fmt(preco)} Coins` : ''}`))),
      el('span', { class: 'rep-tem' }, on && tem != null ? `tem ${fmt(tem)}` : ''),
      el('label', {}, 'abaixo de', numero(tipo, 'abaixoDe', 1, 'Compra quando o estoque ficar abaixo deste número')),
      el('label', {}, 'comprar', numero(tipo, 'qtd', 1, 'Quantidade de cada compra')),
      el('label', {}, 'máx.', numero(tipo, 'limite', 0, 'Quantas compras nesta sessão (0 = sempre que precisar)'), el('small', {}, 'vezes')),
      info ? el('small', { class: 'rep-info' + (s.aviso ? ' aviso' : '') }, info) : null);
  };
  return el('div', { class: 'reposicao' },
    el('div', { class: 'rotulo' }, 'Reposição automática na loja do jogo'),
    linha('bola', 'Bola'),
    linha('pocao', 'Poção'));
}

function montarCaptura() {
  // Configs antigas (sem a aba Captura) ganham o padrão desligado.
  if (!config.captura || !Array.isArray(config.captura.contas) || config.captura.contas.length !== 4) {
    config.captura = { contas: [0, 1, 2, 3].map(() => ({ ativo: false, modo: 'capturar', ballId: 1 })) };
  }
  // Configs da 0.2.2 (sem reposição) ganham o padrão desligado.
  for (const c of config.captura.contas) if (!c.reposicao) c.reposicao = REPOSICAO_PADRAO();
  document.querySelector('.abas button[data-vista="captura"]').addEventListener('click', () => setTimeout(desenharCaptura, 0));
  desenharCaptura();
}

// ------------------------------------------------------------------ Novidades (depois de atualizar)

const versaoMaior = (a, b) => {
  const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number);
  for (let k = 0; k < 3; k++) if ((pa[k] || 0) !== (pb[k] || 0)) return (pa[k] || 0) > (pb[k] || 0);
  return false;
};

async function mostrarNovidades() {
  const lista = window.NOVIDADES || [];
  const { versao } = await window.central.infoAtualizacao();
  const vista = config.novidadesVistas;
  if (!versao || vista === versao) return;
  // Instalação do zero não é atualização: só guarda a versão, sem cartão.
  if (!vista && (await window.central.configNova())) { salvar({ novidadesVistas: versao }); return; }
  // As versões novas desde a última vista; na primeira vez, só a atual.
  const novas = vista ? lista.filter((n) => versaoMaior(n.versao, vista) && !versaoMaior(n.versao, versao)) : lista.filter((n) => n.versao === versao);
  if (!novas.length) { salvar({ novidadesVistas: versao }); return; }
  // Aparece uma vez só por versão: fica marcada como vista já ao abrir (fechar o app sem clicar não traz de volta).
  salvar({ novidadesVistas: versao });
  const fechar = () => fundo.remove();
  const fundo = el('div', { class: 'novidades-fundo', onclick: (ev) => { if (ev.target === fundo) fechar(); } },
    el('div', { class: 'novidades', role: 'dialog', 'aria-label': 'Novidades' },
      el('div', { class: 'novidades-topo' },
        el('span', { class: 'novidades-versao' }, `Versão ${versao}`),
        el('h2', {}, 'O que mudou')),
      ...novas.map((n) => el('section', {},
        novas.length > 1 ? el('h3', {}, `Versão ${n.versao}`) : null,
        el('ul', {}, ...n.itens.map(([titulo, texto]) => el('li', {}, el('b', {}, titulo), el('span', {}, texto)))))),
      el('button', { class: 'novidades-ok', onclick: fechar }, 'Entendi')));
  document.body.append(fundo);
  fundo.querySelector('.novidades-ok').focus();
}

function atualizarSeletorConta() {
  const sel = $('#sn-conta');
  sel.replaceChildren(...config.contas.map((c, i) =>
    el('option', { value: String(i) }, `${c.nome}${config.sniper.contas[i].ativo ? ' (ligado)' : ''}`)));
  sel.value = String(editando);
  $('#sn-ativo').checked = config.sniper.contas[editando].ativo;
}

function montarSniper() {
  atualizarSeletorConta();
  const sn = config.sniper;
  $('#sn-margem').value = sn.margemMs;
  $('#sn-varredura').value = sn.varreduraSeg;
  $('#sn-mesmo').checked = Boolean(sn.mesmoSorteio);
  $('#sn-mesmo').addEventListener('change', (e) => aplicar({ mesmoSorteio: e.target.checked }));

  const aplicar = async (parcial) => {
    await salvar({ sniper: { ...config.sniper, ...parcial } });
    enviarSniper();
  };
  $('#sn-conta').addEventListener('change', (e) => {
    if (regraEmEdicao) $('#cancelar-edicao').click();
    editando = Number(e.target.value);
    definirFiltroConta(editando);
    atualizarSeletorConta();
    desenharRegras();
  });
  $('#sn-ativo').addEventListener('change', async (e) => {
    await salvarConta(editando, { ativo: e.target.checked });
    enviarSniper();
    atualizarSeletorConta();
  });
  $('#sn-margem').addEventListener('change', (e) =>
    aplicar({ margemMs: Math.min(2500, Math.max(0, Number(e.target.value) || 800)) }));
  $('#sn-varredura').addEventListener('change', (e) =>
    aplicar({ varreduraSeg: Math.min(120, Math.max(10, Number(e.target.value) || 20)) }));

  const form = $('#form-regra');
  const sincronizarTipo = () => {
    form.classList.toggle('tipo-item', form.tipo.value === 'item');
    form.classList.toggle('tipo-pokemon', form.tipo.value === 'pokemon');
    form.maxGold.placeholder = 'Teto em Coins (0 = não compra)';
    form.maxGemas.placeholder = 'Teto em Gemas (0 = não compra)';
    form.maxQtd.placeholder = 'Limite de unidades (0 = sem limite)';
    const media = form.tipo.value === 'item' && form.modo.value === 'media';
    form.classList.toggle('modo-media', media);
    if (!form.itemId.value && !form.alvo.value) {
      $('#item-escolhido').textContent = media ? 'qualquer item do RMT' : 'nenhum item escolhido';
    }
  };
  form.tipo.addEventListener('change', sincronizarTipo);
  form.querySelectorAll('input[name="modo"]').forEach((r) => r.addEventListener('change', sincronizarTipo));
  sincronizarTipo();

  const mostrarEscolhido = (it) => {
    $('#item-escolhido').replaceChildren(it
      ? el('span', { class: 'chip-item' }, it.icone ? el('img', { src: it.icone, alt: '' }) : null, `${it.name} · id ${it.id}`)
      : 'nenhum item escolhido');
  };
  $('#abrir-catalogo').addEventListener('click', () => abrirCatalogo((it) => {
    form.alvo.value = it.name;
    form.itemId.value = it.id;
    mostrarEscolhido(it);
  }));
  form.addEventListener('reset', () => setTimeout(() => mostrarEscolhido(null)));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const tipo = f.get('tipo');
    const anterior = regraEmEdicao && config.sniper.contas[editando].regras.find((x) => x.id === regraEmEdicao);
    const modo = tipo === 'item' ? f.get('modo') || 'fixo' : 'fixo';
    let regra;
    if (tipo === 'item') {
      // Regra de item: a mesma montagem e validação que o celular usa (regras.js).
      const r = Regras.regraDeItem({
        alvo: String(f.get('alvo') || '').trim(),
        itemId: Number(f.get('itemId')) || 0,
        modo,
        desconto: Number(f.get('desconto')) || 30,
        moedaMedia: f.get('moedaMedia') || 'orb',
        minVendas: Number(f.get('minVendas')) || 0,
        aprovar: f.get('aprovar') === 'on',
        maxGold: Number(f.get('maxGold')) || 0,
        maxGemas: Number(f.get('maxGemas')) || 0,
        maxQtd: Number(f.get('maxQtd')) || 0
      }, anterior);
      if (r.erro) return alert(r.erro);
      regra = r.valor;
    } else {
      regra = {
        id: anterior ? anterior.id : crypto.randomUUID(),
        ativa: anterior ? anterior.ativa : true,
        tipo,
        alvo: String(f.get('alvo') || '').trim(),
        itemId: 0,
        ...lerFiltrosPokemon(f),
        modo: 'fixo',
        maxGold: Number(f.get('maxGold')) || 0,
        maxGemas: Number(f.get('maxGemas')) || 0,
        maxQtd: Number(f.get('maxQtd')) || 0,
        compradas: anterior ? anterior.compradas || 0 : 0
      };
      if (!regra.alvo && !regra.especieId && !temFiltroPokemon(regra)) {
        return alert('Escolha a espécie ou ao menos um filtro (raridade ou faixa).');
      }
      const motivo = Regras.erroTetos('fixo', regra);
      if (motivo) return alert(motivo);
    }
    const atuais = config.sniper.contas[editando].regras;
    const regras = anterior ? atuais.map((x) => (x.id === anterior.id ? regra : x)) : [...atuais, regra];
    await salvarConta(editando, { regras });
    enviarSniper();
    sairDaEdicao();
    desenharRegras();
  });

  // Editar: a regra volta ao formulário; salvar troca a antiga (mantém o id, o liga/desliga e as compradas).
  const sairDaEdicao = () => {
    regraEmEdicao = null;
    form.reset();
    form.semOutland.checked = true;
    $('#salvar-regra').textContent = 'Adicionar regra';
    $('#cancelar-edicao').hidden = true;
    sincronizarTipo();
    desenharRegras();
  };
  $('#cancelar-edicao').addEventListener('click', sairDaEdicao);
  editarRegra = (r) => {
    regraEmEdicao = r.id;
    form.reset();
    setTimeout(() => {
      form.tipo.value = r.tipo;
      form.alvo.value = r.alvo || '';
      form.itemId.value = r.itemId || '';
      form.especieId.value = r.especieId || '';
      for (const k of ['soShiny', 'soP5', 'soMega', 'soLendario', 'soTmElemental', 'soTmAoe']) form[k].checked = Boolean(r[k]);
      form.semOutland.checked = r.semOutland !== false;
      for (const [, a, b] of FAIXAS_REGRA) { form[a].value = r[a] ?? ''; form[b].value = r[b] ?? ''; }
      form.querySelector(`input[name="modo"][value="${r.modo === 'media' ? 'media' : 'fixo'}"]`).checked = true;
      form.desconto.value = r.desconto || 30;
      form.moedaMedia.value = r.moedaMedia || 'orb';
      form.minVendas.value = r.minVendas ?? 5;
      form.aprovar.checked = r.modo === 'media' ? r.aprovar !== false : true;
      form.maxGold.value = r.maxGold || '';
      form.maxGemas.value = r.maxGemas || '';
      form.maxQtd.value = r.maxQtd || '';
      sincronizarTipo();
      if (r.tipo === 'item' && (r.itemId || r.alvo)) {
        const it = catalogo.lista.find((x) => (r.itemId && x.id === Number(r.itemId)) || x.name.toLowerCase() === String(r.alvo).toLowerCase());
        mostrarEscolhido(it || { name: r.alvo || `Item #${r.itemId}`, id: r.itemId || '?' });
      }
      if (r.tipo === 'pokemon' && r.especieId) {
        $('#especie-escolhida').replaceChildren(el('span', { class: 'chip-item' }, spriteDaEspecie(r.especieId, 'chip-sprite'), `#${r.especieId} ${r.alvo}`));
      }
      $('#salvar-regra').textContent = 'Salvar alterações';
      $('#cancelar-edicao').hidden = false;
      desenharRegras();
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 10);
  };

  $('#abrir-especies').addEventListener('click', () => abrirEspecies((esp) => {
    form.alvo.value = esp ? esp.nome : '';
    form.especieId.value = esp ? esp.id : '';
    $('#especie-escolhida').replaceChildren(esp
      ? el('span', { class: 'chip-item' }, spriteDaEspecie(esp.id, 'chip-sprite'), `#${esp.id} ${esp.nome}`)
      : 'qualquer espécie');
  }));
  form.addEventListener('reset', () => setTimeout(() => $('#especie-escolhida').replaceChildren('qualquer espécie')));

  // Limpa tudo menos o tipo da regra; "Omitir variantes de Outland" volta ligado, como numa regra nova.
  $('#limpar-filtros').addEventListener('click', () => {
    const tipo = form.tipo.value;
    form.reset();
    form.tipo.value = tipo;
    form.especieId.value = '';
    form.semOutland.checked = true;
    sincronizarTipo();
  });

  $('#limpar-log').addEventListener('click', () => $('#log').replaceChildren());
  desenharRegras();
}

function descreverRegra(r) {
  const partes = [];
  if (r.tipo === 'pokemon') {
    if (r.soShiny) partes.push('shiny');
    if (r.soP5) partes.push('P5');
    if (r.soMega) partes.push('Mega');
    if (r.soLendario) partes.push('lendário');
    if (r.soTmElemental) partes.push('TM Elemental');
    if (r.soTmAoe) partes.push('TM AoE');
    for (const [rotulo, a, b] of FAIXAS_REGRA) {
      if (r[a] || r[b]) partes.push(`${rotulo} ${r[a] || '…'}–${r[b] || '…'}`);
    }
    if (r.semOutland !== false) partes.push('sem Outland');
  } else if (r.itemId) partes.push(`id ${r.itemId}`);
  if (r.modo === 'media') {
    const moeda = { orb: 'Gemas', gold: 'Coins', ambas: 'Coins e Gemas' }[r.moedaMedia || 'orb'];
    partes.push(`≥ ${r.desconto}% abaixo da média em ${moeda}`, `mín. ${r.minVendas || 0} vendas/semana`);
    if (r.aprovar) partes.push('pede aprovação');
  }
  if (r.maxGold) partes.push(`≤ ${fmt(r.maxGold)} Coins`);
  if (r.maxGemas) partes.push(`≤ ${fmt(r.maxGemas)} Gemas`);
  partes.push(r.maxQtd ? `${r.compradas || 0}/${r.maxQtd} un.` : `${r.compradas || 0} compradas`);
  return partes.join(' · ');
}

function iconeDaRegra(r) {
  const it = catalogo.lista.find((x) => (r.itemId && x.id === Number(r.itemId)) || x.name.toLowerCase() === String(r.alvo).toLowerCase());
  return it ? it.icone : '';
}

let regraEmEdicao = null;
let editarRegra = () => {};

function desenharRegras() {
  const lista = $('#lista-regras');
  const i = editando;
  const regras = config.sniper.contas[i].regras;
  if (!regras.length) return lista.replaceChildren(el('p', { class: 'vazio' }, 'Nenhuma regra nesta conta ainda.'));

  const mudar = async (id, fn) => {
    const novas = fn(config.sniper.contas[i].regras.map((r) => ({ ...r })), id);
    await salvarConta(i, { regras: novas });
    enviarSniper();
    desenharRegras();
  };
  lista.replaceChildren(...regras.map((r) =>
    el('div', { class: 'regra' + (r.ativa ? '' : ' pausada') + (r.id === regraEmEdicao ? ' em-edicao' : '') },
      r.tipo === 'item' && iconeDaRegra(r) ? el('img', { class: 'ico-regra', src: iconeDaRegra(r), alt: '' }) : null,
      r.tipo === 'pokemon' && r.especieId ? spriteDaEspecie(r.especieId, 'ico-regra') : null,
      el('div', { class: 'desc' },
        `${r.tipo === 'item' ? 'Item' : 'Pokémon'}: ${r.alvo || (r.tipo === 'item' ? 'qualquer item do RMT' : 'qualquer espécie')}`,
        el('small', {}, descreverRegra(r))),
      el('button', { onclick: () => editarRegra(r) }, 'Editar'),
      el('button', { onclick: () => mudar(r.id, (rs, id) => rs.map((x) => (x.id === id ? { ...x, ativa: !x.ativa } : x))) },
        r.ativa ? 'Pausar' : 'Ativar'),
      el('button', { title: 'Zerar contador', onclick: () => mudar(r.id, (rs, id) => rs.map((x) => (x.id === id ? { ...x, compradas: 0 } : x))) }, '0'),
      el('button', { title: 'Remover', onclick: () => mudar(r.id, (rs, id) => rs.filter((x) => x.id !== id)) }, '✕'))));
}

function adicionarLog(i, d) {
  const log = $('#log');
  // Cópia para o Registro do celular (só as últimas 100 de cada conta).
  const linhas = registroCelular[i];
  linhas.push({ em: d.em || Date.now(), nivel: d.nivel === 'erro' ? 'erro' : d.nivel === 'aviso' || d.nivel === 'recusado' ? 'aviso' : 'info', msg: String(d.msg || '') });
  if (linhas.length > 100) linhas.splice(0, linhas.length - 100);
  celularSujo.registro.add(i);
  const hora = new Date(d.em || Date.now()).toLocaleTimeString('pt-BR');
  log.prepend(el('div', { class: 'item', 'data-conta': String(i) },
    el('span', { class: 'hora' }, hora),
    el('span', { class: 'conta-log' }, config.contas[i].nome),
    el('span', { class: d.nivel }, d.msg)));
  while (log.childElementCount > MAX_LOG) log.lastElementChild.remove();
}

// ------------------------------------------------------------------ Lives

// O formato do bloco `twitch` do jogo não é documentado: procura qualquer lista de canais dentro dele.
// Aceita os formatos prováveis: canal com campo "ao vivo", canal com espectadores, ou listas separadas
// ("aoVivo"/"lives" e "offline"), inclusive listas só de nomes.
const CHAVE_AO_VIVO = /vivo|live|online|noar|stream/i;
const CHAVE_OFFLINE = /off/i;

function canaisDoBloco(bloco, plataforma) {
  const achados = [];
  const visitar = (v, profundidade, chave) => {
    if (!v || typeof v !== 'object' || profundidade > 3) return;
    if (Array.isArray(v)) {
      // O nome da lista diz se quem está nela está no ar, quando o canal em si não diz.
      const listaAoVivo = CHAVE_AO_VIVO.test(chave) && !CHAVE_OFFLINE.test(chave);
      for (const it of v) {
        if (typeof it === 'string') {
          achados.push({ plataforma, nome: it, aoVivo: listaAoVivo, viewers: 0 });
          continue;
        }
        if (!it || typeof it !== 'object') continue;
        const nome = it.login || it.canal || it.nome || it.nick || it.name || it.slug || it.display || it.user_login || it.usuario;
        if (typeof nome !== 'string') continue;
        const viewers = Number(it.viewers ?? it.espectadores ?? it.viewerCount ?? it.viewer_count ?? 0) || 0;
        const campo = it.aoVivo ?? it.live ?? it.online ?? it.noAr ?? it.isLive ?? it.ao_vivo;
        const vivo = campo !== undefined ? Boolean(campo) : (listaAoVivo || viewers > 0);
        achados.push({ plataforma, nome, aoVivo: vivo, viewers });
      }
      return;
    }
    for (const k of Object.keys(v)) visitar(v[k], profundidade + 1, k);
  };
  visitar(bloco, 0, '');
  return achados;
}

function atualizarLives() {
  const novos = {};
  for (const c of contas) {
    if (!c.lives) continue;
    for (const ch of [...canaisDoBloco(c.lives.twitch, 'twitch'), ...canaisDoBloco(c.lives.kick, 'kick')]) {
      const k = `${ch.plataforma}:${ch.nome.toLowerCase()}`;
      const atual = novos[k];
      novos[k] = atual ? { ...atual, aoVivo: atual.aoVivo || ch.aoVivo, viewers: Math.max(atual.viewers, ch.viewers) } : ch;
    }
  }

  for (const [k, ch] of Object.entries(novos)) {
    const antes = estadoLives[k];
    if (livesCarregadas && ch.aoVivo && antes && !antes.aoVivo) {
      abrirLiveSozinha(ch);
    }
    estadoLives[k] = ch;
  }
  if (Object.keys(novos).length) livesCarregadas = true;
  desenharLives();
}

// Abre a live nova na conta escolhida, se ela tiver o login daquela plataforma. Uma conta só.
function abrirLiveSozinha(ch) {
  const auto = config.autoLive || {};
  if (!auto.ativo) return;
  const i = Number(auto.conta) || 0;
  const logada = ch.plataforma === 'kick' ? Boolean(contas[i] && contas[i].lives && contas[i].lives.kick) : twitchLogado[i];
  if (!logada) return;
  if (document.querySelector(`#players .player[data-chave="${i}:${ch.plataforma}:${ch.nome.toLowerCase()}"]`)) return;
  abrirLive(ch, i);
}

function desenharLives() {
  const lista = Object.values(estadoLives).sort((a, b) => Number(b.aoVivo) - Number(a.aoVivo) || b.viewers - a.viewers);
  const noAr = lista.filter((c) => c.aoVivo).length;
  const selo = $('#selo-lives');
  selo.textContent = String(noAr);
  selo.classList.toggle('vivo', noAr > 0);

  const alvo = $('#lista-lives');
  if (!lista.length) {
    alvo.replaceChildren(el('p', { class: 'vazio' }, 'Aguardando o jogo enviar a lista de canais oficiais (entre em uma conta).'));
  } else {
    const aoVivo = lista.filter((c) => c.aoVivo);
    const conta = () => Number(config.contaLives) || 0;
    // Abrir todas / só Twitch / só Kick: o botão fica apagado quando não há live no ar daquela plataforma.
    const noAr = (plataforma) => aoVivo.some((c) => c.plataforma === plataforma);
    const barraTodas = el('div', { class: 'live barra-abrir' },
      el('span', { class: 'nome-canal' }, `${aoVivo.length} ao vivo agora`),
      el('button', { disabled: !aoVivo.length, onclick: () => abrirAoVivo() }, `Abrir todas na ${config.contas[conta()].nome}`),
      el('button', { disabled: !noAr('twitch'), onclick: () => abrirAoVivo('twitch') }, 'Abrir só Twitch'),
      el('button', { disabled: !noAr('kick'), onclick: () => abrirAoVivo('kick') }, 'Abrir só Kick'));
    alvo.replaceChildren(barraTodas, ...lista.map((ch) =>
      el('div', { class: 'live' + (ch.aoVivo ? ' no-ar' : '') },
        el('span', { class: 'plataforma ' + ch.plataforma }, ch.plataforma === 'kick' ? 'KICK' : 'TWITCH'),
        el('span', { class: 'nome-canal' }, ch.nome),
        el('span', { class: 'estado' }, ch.aoVivo ? `AO VIVO${ch.viewers ? ` · ${fmt(ch.viewers)}` : ''}` : 'offline'),
        ch.aoVivo ? el('button', { onclick: () => abrirLive(ch, conta()) }, 'Assistir') : null)));
  }

  $('#bonus-contas').replaceChildren(...contas.map((c, i) => {
    const tw = c.lives && c.lives.twitch;
    const partes = [];
    if (tw && typeof tw === 'object') {
      partes.push(tw.login ? `vinculada no jogo: ${tw.login}` : 'Twitch não vinculada no jogo');
      if (tw.assistindo) partes.push(`bônus ativo${tw.pctAtual ? ` (+${tw.pctAtual}%)` : ''}`);
    }
    partes.push(twitchLogado[i] ? `Twitch logada no app${twitchUsuario[i] ? ': ' + twitchUsuario[i] : ''}` : 'Twitch NÃO logada no app');
    // O bônus só vale se a Twitch logada no app for a mesma vinculada no jogo.
    const diferente = tw && tw.login && twitchUsuario[i] && tw.login.toLowerCase() !== twitchUsuario[i].toLowerCase();
    return el('div', { class: 'cartao' + (diferente ? ' alerta-twitch' : '') }, config.contas[i].nome,
      el('small', {}, partes.join(' · ')),
      diferente ? el('small', { class: 'aviso-twitch' }, `A Twitch do app (${twitchUsuario[i]}) não é a vinculada no jogo (${tw.login}): o bônus não conta. Entre na Twitch certa.`) : null,
      el('div', { class: 'acoes-login' },
        el('button', { onclick: () => entrar(i, 'twitch') }, 'Entrar na Twitch'),
        el('button', { onclick: () => entrar(i, 'kick') }, 'Entrar na Kick')));
  }));
}

// Opções das lives (aba Lives e celular): a conta que abre, a qualidade, abrir sozinha e conferir.
function desenharOpcoesLives() {
  const auto = config.autoLive || { ativo: false, conta: 0 };
  $('#lv-qualidade').value = config.qualidadeLives || '160p30';
  $('#lv-conta').value = String(config.contaLives || 0);
  $('#lv-auto').checked = Boolean(auto.ativo);
  $('#lv-auto-conta').value = String(auto.conta || 0);
  $('#lv-manter').checked = config.manterLives !== false;
}

// Abre as lives no ar na conta de "Abrir as lives na conta". Sem plataforma, abre todas; com
// "twitch" ou "kick", só as dessa plataforma. Usa a mesma abrirLive nos dois casos.
function abrirAoVivo(plataforma) {
  const i = Number(config.contaLives) || 0;
  Object.values(estadoLives)
    .filter((c) => c.aoVivo && (!plataforma || c.plataforma === plataforma))
    .forEach((ch) => abrirLive(ch, i));
}

function abrirLive(ch, i) {
  const chave = `${i}:${ch.plataforma}:${ch.nome.toLowerCase()}`;
  if (ch.plataforma === 'kick') {
    // Kick: os pontos do canal só sobem assistindo, então o vídeo fica.
    const w = abrirPagina(`https://kick.com/${encodeURIComponent(ch.nome)}`, i, ch.nome);
    w.parentElement.dataset.chave = chave;
    return;
  }
  // Twitch: o player sozinho (popout, bem mais leve que a página inteira) + o chat, que é o que conta
  // para o bônus. Em "Só chat" o vídeo nem abre.
  const canal = encodeURIComponent(ch.nome);
  const qualidade = config.qualidadeLives || '160p30';
  const chat = el('webview', { src: `https://www.twitch.tv/popout/${canal}/chat?popout=`, partition: PARTICOES[i] });
  chat.addEventListener('dom-ready', () => chat.setAudioMuted(true));
  if (qualidade === 'chat') {
    const w = abrirPaginaCom(chat, i, `${ch.nome} (só chat)`);
    w.parentElement.dataset.chave = chave;
    return;
  }
  const video = el('webview', { src: `https://www.twitch.tv/popout/${canal}/player?parent=twitch.tv`, partition: PARTICOES[i], allowpopups: true });
  video.addEventListener('dom-ready', () => {
    video.setAudioMuted(livesMudas);
    aplicarQualidadeTwitch(video, qualidade);
  });
  const w = abrirPaginaCom(video, i, ch.nome);
  const caixa = w.parentElement;
  caixa.dataset.chave = chave;
  caixa.classList.add('com-chat');
  caixa.append(chat);
}

// A cada 5 min: as lives abertas que o jogo diz que saíram do ar são fechadas e as que seguem no ar
// são recarregadas (F5), para o player/chat não travar e continuar pontuando. Páginas de login ficam.
const INTERVALO_MANTER_LIVES = 5 * 60_000;
function manterLives() {
  if (config.manterLives === false) return;
  let fechadas = 0; let recarregadas = 0;
  for (const caixa of document.querySelectorAll('#players .player[data-chave]')) {
    const k = caixa.dataset.chave.slice(caixa.dataset.chave.indexOf(':') + 1); // "plataforma:canal"
    const ch = estadoLives[k];
    if (livesCarregadas && ch && !ch.aoVivo) {
      (caixa._fechar || (() => caixa.remove()))();
      fechadas++;
      continue;
    }
    for (const w of caixa.querySelectorAll('webview')) { try { w.reload(); } catch { /* ainda carregando */ } }
    recarregadas++;
  }
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  $('#lv-manutencao').textContent = `conferido às ${hora}: ${recarregadas} recarregada(s), ${fechadas} fechada(s) por estar offline`;
}

// A Twitch guarda a qualidade escolhida no armazenamento do site; o app grava a preferência na conta
// e recarrega o player uma vez, para ele já começar na qualidade certa.
function aplicarQualidadeTwitch(webview, qualidade) {
  if (qualidade === 'auto' || webview.dataset.qualidadeOk) return;
  const valor = JSON.stringify({ default: qualidade });
  webview.executeJavaScript(`(() => {
    const atual = localStorage.getItem('video-quality');
    if (atual === ${JSON.stringify(valor)}) return false;
    localStorage.setItem('video-quality', ${JSON.stringify(valor)});
    return true;
  })()`).then((mudou) => {
    webview.dataset.qualidadeOk = '1';
    if (mudou) webview.reload();
  }).catch(() => {});
}

// Igual ao abrirPagina, mas com um <webview> já montado.
function abrirPaginaCom(webview, i, titulo) {
  const players = $('#players');
  players.querySelector('.vazio')?.remove();
  const fechar = () => {
    caixa.remove();
    if (!players.children.length) players.append(el('p', { class: 'vazio' }, 'Nenhuma live aberta.'));
    verificarLoginTwitch();
  };
  const caixa = el('div', { class: 'player' },
    el('div', { class: 'barra-conta' },
      el('span', {}, `${titulo} · ${config.contas[i].nome}`),
      el('button', { onclick: fechar }, 'Fechar')),
    webview);
  caixa._fechar = fechar;
  players.append(caixa);
  return webview;
}

// Abre Twitch/Kick na sessão da conta escolhida: o login feito aqui fica só naquela conta.
function abrirPagina(url, i, titulo) {
  const players = $('#players');
  players.querySelector('.vazio')?.remove();
  const webview = el('webview', { src: url, partition: PARTICOES[i], allowpopups: true });
  webview.addEventListener('dom-ready', () => webview.setAudioMuted(livesMudas));
  const fechar = () => {
    caixa.remove();
    if (!players.children.length) players.append(el('p', { class: 'vazio' }, 'Nenhuma live aberta.'));
    verificarLoginTwitch();
  };
  const caixa = el('div', { class: 'player' },
    el('div', { class: 'barra-conta' },
      el('span', {}, `${titulo} · ${config.contas[i].nome}`),
      el('button', { onclick: fechar }, 'Fechar')),
    webview);
  caixa._fechar = fechar;
  players.append(caixa);
  return webview;
}

async function verificarLoginTwitch() {
  const r = await window.central.twitchLogado();
  twitchLogado = r.map((x) => Boolean(x && x.logado));
  twitchUsuario = r.map((x) => (x && x.usuario) || '');
  desenharLives();
}

// Alças de redimensionar nas bordas e cantos (a janela sem moldura não tem as do Windows).
function montarAlcas() {
  for (const alca of document.querySelectorAll('.alcas [data-lado]')) {
    alca.addEventListener('pointerdown', async (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      alca.setPointerCapture(ev.pointerId);
      const lado = alca.dataset.lado;
      const ini = await window.central.limitesJanela();
      if (!ini) return;
      // Com zoom na central, o mouse anda em pixels CSS: o delta vira pixels da janela multiplicando pelo zoom.
      const z = ini.zoom || 1;
      const x0 = ev.screenX; const y0 = ev.screenY;
      let pendente = null;
      const mover = (e) => {
        const dx = (e.screenX - x0) * z; const dy = (e.screenY - y0) * z;
        const b = { x: ini.x, y: ini.y, width: ini.width, height: ini.height };
        if (lado.includes('e')) b.width = ini.width + dx;
        if (lado.includes('s')) b.height = ini.height + dy;
        if (lado.includes('w')) { b.width = ini.width - dx; b.ancoraDireita = ini.x + ini.width; }
        if (lado.includes('n')) { b.height = ini.height - dy; b.ancoraBaixo = ini.y + ini.height; }
        if (!pendente) requestAnimationFrame(() => { window.central.redimensionarJanela(pendente); pendente = null; });
        pendente = b;
      };
      const soltar = () => { alca.removeEventListener('pointermove', mover); alca.removeEventListener('pointerup', soltar); alca.removeEventListener('pointercancel', soltar); };
      alca.addEventListener('pointermove', mover);
      alca.addEventListener('pointerup', soltar);
      alca.addEventListener('pointercancel', soltar);
    });
  }
}

// Config: escala da interface. Mudança aplicada logo (o processo principal aplica o zoom na janela).
function montarEscala() {
  const sel = $('#escala-interface');
  sel.value = String(config.escalaInterface ?? 'auto');
  let espera = null;
  sel.addEventListener('change', () => {
    const valor = sel.value === 'auto' ? 'auto' : Number(sel.value);
    clearTimeout(espera);
    espera = setTimeout(() => salvar({ escalaInterface: valor }), 200);
  });
}

// ------------------------------------------------------------------ Config: logins por conta

const SERVICOS = [
  { id: 'pokeidle', nome: 'PokéIdle', usuario: 'E-mail' },
  { id: 'twitch', nome: 'Twitch', usuario: 'Usuário da Twitch' },
  { id: 'kick', nome: 'Kick', usuario: 'E-mail da Kick' }
];

function irPara(vista) {
  document.querySelector(`.abas button[data-vista="${vista}"]`).click();
}

// Abre o login do serviço na sessão da conta e pede ao processo principal para preencher.
async function entrar(i, servico, aviso) {
  let webview;
  if (servico === 'pokeidle') {
    irPara('contas');
    webview = contas[i].webview;
    const grade = $('#grade');
    grade.classList.add('solo');
    contas.forEach((c, j) => c.el.classList.toggle('foco', j === i));
  } else {
    irPara('lives');
    const url = servico === 'twitch' ? 'https://www.twitch.tv/login' : 'https://kick.com/';
    webview = abrirPagina(url, i, `Login ${servico === 'twitch' ? 'Twitch' : 'Kick'}`);
    await new Promise((res) => webview.addEventListener('dom-ready', res, { once: true }));
  }
  const r = await window.central.preencherLogin(webview.getWebContentsId(), i, servico);
  if (aviso) aviso.textContent = r.ok ? 'Preenchido: confirme a verificação e clique em entrar.' : r.motivo;
}

const avisosLogin = {}; // "conta:servico" -> <small> da linha na Config

async function entrarPeloNavegador(i, servico, aviso) {
  const r = await window.central.entrarPeloNavegador(i, servico);
  aviso.textContent = r.ok
    ? 'Abri o navegador escolhido: faça login lá se precisar e clique em "Autorizar" no aviso da extensão (vale por 5 min).'
    : r.motivo;
}

// A extensão entregou a sessão: o processo principal já gravou os cookies na sessão da conta.
window.central.onSessaoNavegador(async ({ conta, servico, armazenamento }) => {
  const aviso = avisosLogin[`${conta}:${servico}`];
  if (servico === 'pokeidle') {
    const webview = contas[conta].webview;
    const itens = JSON.stringify(armazenamento || {});
    await webview.executeJavaScript(`(() => { const d = ${itens}; for (const k of Object.keys(d)) localStorage.setItem(k, d[k]); })()`).catch(() => {});
    webview.reload();
  } else {
    verificarLoginTwitch();
  }
  if (aviso) aviso.textContent = 'Sessão recebida do navegador. Esta conta já está logada no app.';
});

let navegadoresDisponiveis = [{ id: 'padrao', rotulo: 'Navegador padrão do sistema' }];

async function montarConfig() {
  navegadoresDisponiveis = await window.central.listarNavegadores();
  const creds = await window.central.listarCredenciais();
  $('#config-contas').replaceChildren(...config.contas.map((conta, i) => {
    const nome = el('input', { value: conta.nome, maxlength: 20 });
    nome.addEventListener('change', async () => {
      await salvar({ contas: config.contas.map((c, j) => (j === i ? { ...c, nome: nome.value || `Conta ${i + 1}` } : c)) });
      contas[i].el.querySelector('.nome').value = config.contas[i].nome;
      atualizarSeletorConta();
      atualizarResumo();
    });

    const linhas = SERVICOS.map((s) => {
      const c = creds[i][s.id];
      const usuario = el('input', { placeholder: s.usuario, value: c ? c.usuario : '', autocomplete: 'off' });
      const senha = el('input', { type: 'password', placeholder: c && c.temSenha ? 'senha salva' : 'Senha', autocomplete: 'new-password' });
      const aviso = el('small', { class: 'aviso-login' });
      avisosLogin[`${i}:${s.id}`] = aviso;
      const guardar = async () => {
        const r = await window.central.salvarCredencial(i, s.id, usuario.value, senha.value);
        aviso.textContent = r.ok ? 'Salvo.' : r.motivo;
        if (r.ok) { senha.value = ''; montarConfig(); }
      };
      return el('div', { class: 'linha-login' },
        el('span', { class: 'servico ' + s.id }, s.nome),
        usuario,
        senha,
        el('button', { onclick: guardar }, 'Salvar'),
        el('button', { onclick: () => entrar(i, s.id, aviso) }, 'Entrar'),
        el('button', { title: 'Usa o login que já está no navegador escolhido acima', onclick: () => entrarPeloNavegador(i, s.id, aviso) }, 'Pelo navegador'),
        c ? el('button', { title: 'Apagar login salvo', onclick: async () => { await window.central.apagarCredencial(i, s.id); montarConfig(); } }, '✕') : null,
        aviso);
    });
    // Em qual navegador/perfil o "Pelo navegador" desta conta abre (cada conta pode ter o seu).
    const selNav = el('select', { class: 'sel-navegador' }, ...navegadoresDisponiveis.map((n) => el('option', { value: n.id }, n.rotulo)));
    const escolhido = (config.navegadorLogin || [])[i] || 'padrao';
    selNav.value = navegadoresDisponiveis.some((n) => n.id === escolhido) ? escolhido : 'padrao';
    selNav.addEventListener('change', () => {
      const lista = [0, 1, 2, 3].map((j) => (j === i ? selNav.value : ((config.navegadorLogin || [])[j] || 'padrao')));
      salvar({ navegadorLogin: lista });
    });
    return el('div', { class: 'cartao-config' },
      el('div', { class: 'titulo-conta' }, `Conta ${i + 1}`, nome),
      el('label', { class: 'linha-navegador' }, '"Pelo navegador" abre em', selNav),
      ...linhas);
  }));
}

// ------------------------------------------------------------------ Config: painel no celular

// O painel no celular é uma página só de leitura na rede local (processo principal). Enquanto ele está
// ligado, esta tela manda a cada 3 s uma lista fechada de campos: nada de senha, cookie ou login.
const INTERVALO_CELULAR_MS = 3000;
let celularLigado = false;

// Ao ligar o painel, tudo vai de novo (hunts, registro e mercado), não só o que mudar depois.
function marcarTudoCelular() {
  contas.forEach((_, i) => { celularSujo.hunts.add(i); celularSujo.registro.add(i); });
  celularSujo.mercado = true;
}

function desenharCelular(r = {}) {
  const estavaLigado = celularLigado;
  celularLigado = Boolean(r.ligado);
  if (celularLigado && !estavaLigado) marcarTudoCelular();
  if (!celularLigado) catalogoNoCelular = false; // na próxima ligada, o catálogo vai de novo
  const chave = $('#celular-chave');
  chave.classList.toggle('on', celularLigado);
  chave.setAttribute('aria-checked', String(celularLigado));
  chave.title = celularLigado ? 'Desliga o painel no celular' : 'Liga o painel no celular';
  $('#celular-endereco').textContent = celularLigado && r.url ? r.url : 'Desligado';
  const qr = $('#celular-qr');
  if (celularLigado && r.qr) qr.src = r.qr;
  else qr.removeAttribute('src');
  qr.hidden = !(celularLigado && r.qr);
  $('#celular-qr-legenda').hidden = qr.hidden;
  // Fora de casa: o QR do Tailscale, quando o PC está nele; senão, a dica de como instalar.
  const qrFora = $('#celular-qr-fora');
  if (celularLigado && r.qrFora) qrFora.src = r.qrFora;
  else qrFora.removeAttribute('src');
  qrFora.hidden = !(celularLigado && r.qrFora);
  $('#celular-qr-fora-legenda').hidden = qrFora.hidden;
  $('#celular-fora-dica').hidden = !celularLigado || Boolean(r.qrFora);
  $('#celular-fora-endereco').hidden = !(celularLigado && r.urlFora);
  $('#celular-fora-endereco').textContent = r.urlFora ? `Fora de casa: ${r.urlFora}` : '';
  $('#celular-novo').disabled = !celularLigado;
  $('#celular-status').textContent = r.motivo || '';
  $('#celular-status').className = 'nota' + (r.motivo ? ' erro' : '');
}

async function mudarCelular(ligar) {
  const chave = $('#celular-chave');
  chave.disabled = true;
  let r;
  try {
    r = await window.central.ligarPainelCelular(ligar);
  } catch {
    r = { ok: false, ligado: false, motivo: 'Não consegui mudar o painel agora. Tente de novo.' };
  }
  chave.disabled = false;
  desenharCelular(r);
}

function montarPainelCelular() {
  $('#celular-chave').addEventListener('click', () => mudarCelular(!celularLigado));
  window.central.onAcaoCelular(async (a) => {
    let r;
    try { r = await executarAcaoCelular(a); } catch { r = { ok: false, motivo: 'Falha ao executar a ação.' }; }
    window.central.responderAcaoCelular({ pedido: a.pedido, ...r });
  });
  $('#celular-novo').addEventListener('click', async () => {
    const r = await window.central.novoCodigoCelular();
    desenharCelular(r);
    if (r.ok) $('#celular-status').textContent = 'Código novo gerado. O QR antigo não vale mais: escaneie o novo no celular.';
  });
  window.central.infoCelular().then(desenharCelular);
  setInterval(enviarCelular, INTERVALO_CELULAR_MS);
  // O Tailscale pode ser ligado depois do painel: confere de novo de tempos em tempos (sem mexer no status).
  setInterval(() => {
    if (!celularLigado) return;
    window.central.infoCelular().then((r) => { if (r && r.ligado && Boolean(r.qrFora) !== !$('#celular-qr-fora').hidden) desenharCelular(r); });
  }, 30_000);
}

// Só estes campos saem do app: a lista é fechada de propósito (sem senha, cookie, login ou id interno).
// Antes do primeiro dado o motor manda -1: vira vazio, não número.
const numeroCelular = (n) => (typeof n === 'number' && n >= 0 ? n : null);

// Regra do sniper como o celular a mostra. `resumo` é o mesmo texto que o PC mostra embaixo da regra.
function regraParaCelular(r) {
  return {
    id: r.id,
    tipo: r.tipo,
    ativa: r.ativa !== false,
    alvo: r.alvo || '',
    itemId: r.itemId || 0,
    modo: r.modo === 'media' ? 'media' : 'fixo',
    desconto: r.desconto,
    moedaMedia: r.moedaMedia,
    minVendas: r.minVendas,
    aprovar: r.aprovar === true,
    maxGold: r.maxGold || 0,
    maxGemas: r.maxGemas || 0,
    maxQtd: r.maxQtd || 0,
    compradas: r.compradas || 0,
    resumo: descreverRegra(r)
  };
}

// Captura da conta: a configuração (o que está ligado no PC) e o status que o jogo manda.
function capturaParaCelular(i, e) {
  const cfg = (config.captura && config.captura.contas[i]) || {};
  const rep = { ...REPOSICAO_PADRAO(), ...(cfg.reposicao || {}) };
  const cap = (e && e.captura) || {};
  const st = cap.reposicao || {};
  const bolas = cap.bolas || {};
  const pocoes = cap.pocoes || {};
  const lerRep = (r) => ({ ativo: r.ativo === true, id: r.id, abaixoDe: r.abaixoDe, qtd: r.qtd, limite: r.limite });
  const statusRep = (s) => ({
    aviso: s.aviso || null,
    pendente: s.pendente === true,
    compras: numeroCelular(s.compras) ?? 0,
    ultimaQtd: s.ultima ? numeroCelular(s.ultima.qtd) : null,
    ultimaEm: s.ultima ? numeroCelular(s.ultima.em) : null
  });
  return {
    ativo: cfg.ativo === true,
    modo: cfg.modo === 'sempre' ? 'sempre' : 'capturar',
    ballId: cfg.ballId || 1,
    reposicao: { bola: lerRep(rep.bola), pocao: lerRep(rep.pocao) },
    pausa: cap.pausa || null,
    lancadas: numeroCelular(cap.lancadas),
    capturas: numeroCelular(cap.capturas),
    perdidos: numeroCelular(cap.perdidos),
    chance: numeroCelular(cap.chance),
    ultimaEm: numeroCelular(cap.ultimaEm),
    ultimaCaptura: cap.ultimaCaptura && cap.ultimaCaptura.nome
      ? { nome: cap.ultimaCaptura.nome, shiny: cap.ultimaCaptura.shiny === true, bolas: numeroCelular(cap.ultimaCaptura.bolas) }
      : null,
    bolas: Object.keys(NOMES_BOLA).map(Number).map((id) => ({ id, nome: NOMES_BOLA[id], qtd: numeroCelular(bolas[id]) ?? 0 })),
    lojaBolas: (cap.lojaBolas || []).map((b) => ({ id: b.id, nome: b.nome, preco: b.preco })),
    lojaPocoes: POCOES_LOJA.map(([id, nome, preco]) => ({ id, nome, preco })),
    estoqueRep: { bola: numeroCelular(bolas[rep.bola.id]), pocao: numeroCelular(pocoes[rep.pocao.id]) },
    reposicaoStatus: { bola: statusRep(st.bola || {}), pocao: statusRep(st.pocao || {}) }
  };
}

// Lives como o celular mostra: a conta que abre, a qualidade, as duas opções e os canais (no ar primeiro).
function livesParaCelular() {
  const auto = config.autoLive || {};
  return {
    contaLives: Number(config.contaLives) || 0,
    qualidade: config.qualidadeLives || '160p30',
    manterLives: config.manterLives !== false,
    autoLive: { ativo: Boolean(auto.ativo), conta: Number(auto.conta) || 0 },
    lista: Object.values(estadoLives)
      .sort((a, b) => Number(b.aoVivo) - Number(a.aoVivo) || b.viewers - a.viewers)
      .map((x) => ({ plataforma: x.plataforma, nome: x.nome, aoVivo: x.aoVivo === true, viewers: x.viewers || 0 }))
  };
}

function montarSnapshotCelular() {
  const item = (x) => (x ? { nome: x.nome, qtd: x.qtd } : null);
  return {
    versao: versaoApp,
    escala: config.escalaInterface ?? 'auto',
    lives: livesParaCelular(),
    sniper: { margemMs: config.sniper.margemMs, varreduraSeg: config.sniper.varreduraSeg },
    contas: contas.map((c, i) => {
      const e = c.estado || {};
      const t = e.tel || {};
      const at = t.ativo || {};
      const stq = t.estoque || {};
      const on = Boolean(e.conectado);
      return {
        nome: config.contas[i].nome,
        online: on,
        nick: t.nick || '',
        nivel: numeroCelular(t.nivel),
        hunt: t.hunt || '',
        sessaoMs: on && t.inicio ? Date.now() - t.inicio : null,
        pokemon: at.nome ? {
          nome: at.nome,
          nivel: numeroCelular(at.nivel),
          hp: numeroCelular(at.hp),
          hpMax: numeroCelular(at.hpMax),
          shiny: Boolean(at.shiny),
          // O primeiro quadro do sprite que o Dashboard já mostra (data: da Pokédex ou do jogo).
          imagem: c.sprite && c.sprite.quadros.length ? c.sprite.quadros[0] : null
        } : null,
        gold: numeroCelular(e.gold),
        gemas: numeroCelular(e.gemas),
        xpHora: numeroCelular(t.xpH),
        goldHora: numeroCelular(t.goldH),
        abates: numeroCelular(t.abates),
        capturas: numeroCelular(t.capturas),
        pocao: item(stq.pocao),
        bola: item(stq.bola),
        drops: DROPS.map(([k, rotulo]) => ({ nome: rotulo, qtd: (t.drops && t.drops[k]) || 0 })),
        sniperLigado: Boolean(config.sniper.contas[i].ativo),
        capturaLigada: Boolean(config.captura && config.captura.contas[i] && config.captura.contas[i].ativo),
        mudo: Boolean((config.mudo || [])[i]),
        fila: numeroCelular(e.agendados),
        gastos: { pocoes: numeroCelular((t.gastos || {}).pocoes), bolas: numeroCelular((t.gastos || {}).bolas) },
        shinies: { vistos: numeroCelular(t.shiniesVistos), capturados: numeroCelular(t.shiniesCapturados) },
        xpBonus: numeroCelular(t.buffs && t.buffs.xpTr),
        ultimoSniper: c.ultimoSniper ? { nivel: c.ultimoSniper.nivel, msg: c.ultimoSniper.msg } : null,
        controle: c.controle || null,
        regras: (config.sniper.contas[i].regras || []).slice(0, 200).map(regraParaCelular),
        captura: capturaParaCelular(i, e)
      };
    })
  };
}

// O catálogo do RMT vai ao painel uma vez por ligada (e de novo quando o catálogo muda).
let catalogoNoCelular = false;
function enviarCatalogoCelular() {
  catalogoNoCelular = true;
  window.central.enviarCatalogoCelular(catalogo.lista.map((it) => ({ id: it.id, nome: it.name, grupo: it.grupo })));
}

// Análise de hunts de uma conta, só o que a lista do celular usa (os números vêm crus; o painel arredonda).
function huntsParaCelular(i) {
  const d = hunts.dados[i];
  if (!d) return null;
  const lista = (x) => (x || []).map((y) => ({ tipo: y.tipo, mult: y.mult }));
  return {
    em: d.em,
    nivelTreinador: numeroCelular(d.nivelTreinador),
    fatorRitmo: d.ritmo && d.ritmo.fator > 0 ? d.ritmo.fator : null,
    hunts: (d.hunts || []).map((h) => ({
      slug: h.slug, nome: h.nome, regiao: regiaoDaHunt(h), nivel: h.nivel,
      liberada: h.liberada === true, atual: h.atual === true,
      xpTrH: h.xpTrH, xpPkH: h.xpPkH, goldH: h.goldH, killsH: h.killsH,
      fracos: lista(h.fracos), resiste: lista(h.resiste)
    }))
  };
}

// Mercado para o celular: preços (com a hora da leitura), ofertas do radar que esperam aprovação (só ver),
// o radar e as últimas compras. Compra e aprovação continuam só no PC.
function mercadoParaCelular() {
  const agora = Date.now();
  const precos = linhasDoMercado('', false).map((l) => ({
    id: l.id, nome: l.nome, cat: l.cat, qtd: l.qtd, eG: l.eG, eO: l.eO,
    gold: l.gold, gema: l.gema, goldUlt: l.goldUlt, gemaUlt: l.gemaUlt,
    mediaGema: l.mediaGema, vendasGema: l.vendasGema, em: l.em
  }));
  const ofertas = sugestoesPendentes.map((s) => ({
    conta: config.contas[s.conta].nome, nome: `${s.qtd > 1 ? s.qtd + '× ' : ''}${s.nome}`, qtd: s.qtd,
    preco: s.preco, moeda: s.moeda, pctMedia: s.pctMedia, media: s.media,
    origem: s.regraId === 'radar' ? 'radar' : 'regra', recebidaEm: s.recebidaEm,
    liberaEm: s.compravelEm ? Math.max(0, s.compravelEm - (agora - s.offset)) : 0
  }));
  const historico = compras.slice(0, 50).map((c) => ({
    em: c.em, conta: (config.contas[c.conta] || {}).nome || '', nome: c.nome, qtd: c.qtd,
    preco: c.preco, total: c.total, moeda: c.moeda, origem: c.origem, resultado: c.resultado
  }));
  return {
    leituraEm: mercado.em, leituraConta: mercado.em ? config.contas[mercado.conta].nome : '',
    limiteMs: limiteDesatualizado(), radar: radarAtual(), precos, ofertas, compras: historico
  };
}

// Manda ao painel só o que mudou (análise de hunts e registro por conta, mercado). O mercado também sai a
// cada 30 s, porque a hora da leitura envelhece sozinha.
function enviarDetalhesCelular() {
  for (const i of celularSujo.hunts) {
    const d = huntsParaCelular(i);
    if (d) window.central.enviarDetalheCelular({ tipo: 'hunts', conta: i, dados: d });
  }
  celularSujo.hunts.clear();
  for (const i of celularSujo.registro) window.central.enviarDetalheCelular({ tipo: 'registro', conta: i, linhas: registroCelular[i] });
  celularSujo.registro.clear();
  if (celularSujo.mercado || Date.now() - mercadoEnviadoEm > 30_000) {
    window.central.enviarDetalheCelular({ tipo: 'mercado', dados: mercadoParaCelular() });
    celularSujo.mercado = false;
    mercadoEnviadoEm = Date.now();
  }
}

function enviarCelular() {
  if (!celularLigado) return;
  window.central.enviarSnapshotCelular(montarSnapshotCelular());
  if (!catalogoNoCelular && catalogo.pronto) enviarCatalogoCelular();
  enviarDetalhesCelular();
}

// Ações pedidas pelo celular. Cada uma espera a confirmação do motor da conta (pedido -> quem espera).
const acoesJogoEmCurso = new Map();

// Ações de configuração (sniper e captura): salvam no PC pelas mesmas funções dos botões da central.
const ACOES_DE_CONFIG = ['sniper', 'captura', 'sniperRegraSalvar', 'sniperRegraApagar', 'sniperRegraAtiva', 'sniperOpcoes', 'capturaConfig',
  'liveAbrir', 'livesOpcoes', 'radarOpcoes', 'configOpcoes'];

async function executarConfigCelular(i, acao, p) {
  const falha = (motivo) => ({ ok: false, motivo });
  const ok = { ok: true, motivo: null };
  const regrasDaConta = () => config.sniper.contas[i].regras;
  const achar = (id) => regrasDaConta().find((x) => x.id === id);
  const salvarRegras = async (regras) => {
    await salvarConta(i, { regras });
    enviarSniper();
    desenharRegras();
    return ok;
  };

  if (acao === 'sniper') {
    await salvarConta(i, { ativo: p.ligado === true });
    enviarSniper();
    atualizarSeletorConta();
    return ok;
  }
  if (acao === 'captura') {
    await mudarCaptura(i, { ativo: p.ligado === true });
    return ok;
  }
  if (acao === 'sniperOpcoes') {
    const v = Regras.validarOpcoesSniper(p);
    if (v.erro) return falha(v.erro);
    await salvar({ sniper: { ...config.sniper, ...v.valor } });
    enviarSniper();
    return ok;
  }
  if (acao === 'sniperRegraApagar') {
    if (!achar(p.id)) return falha('Essa regra não existe mais.');
    return salvarRegras(regrasDaConta().filter((x) => x.id !== p.id));
  }
  if (acao === 'sniperRegraAtiva') {
    if (!achar(p.id)) return falha('Essa regra não existe mais.');
    return salvarRegras(regrasDaConta().map((x) => (x.id === p.id ? { ...x, ativa: p.ativa } : x)));
  }
  if (acao === 'sniperRegraSalvar') {
    // Confere de novo o que a página mandou, com as mesmas regras do formulário do PC.
    const v = Regras.validarRegraDoCelular(p.regra);
    if (v.erro) return falha(v.erro);
    const r = v.valor;
    const anterior = r.id !== undefined ? achar(r.id) : null;
    if (r.id !== undefined && !anterior) return falha('Essa regra não existe mais.');
    if (anterior && anterior.tipo !== r.tipo) return falha('O tipo da regra não pode mudar.');
    const res = r.tipo === 'pokemon' ? Regras.regraDePokemonComTetos(anterior, r) : Regras.regraDeItem(r, anterior);
    if (res.erro) return falha(res.erro);
    const atuais = regrasDaConta();
    const regras = anterior ? atuais.map((x) => (x.id === anterior.id ? res.valor : x)) : [...atuais, res.valor];
    return salvarRegras(regras);
  }
  if (acao === 'liveAbrir') {
    // Mesmos botões da aba Lives: uma live (a que está no ar), só Twitch, só Kick ou todas.
    const plataforma = p.plataforma;
    if (p.canal) {
      const ch = estadoLives[`${plataforma}:${p.canal.toLowerCase()}`];
      if (!ch || !ch.aoVivo) return falha('Essa live não está no ar.');
      abrirLive(ch, Number(config.contaLives) || 0);
      return ok;
    }
    const noAr = Object.values(estadoLives).some((x) => x.aoVivo && (plataforma === 'ambas' || x.plataforma === plataforma));
    if (!noAr) return falha(plataforma === 'ambas' ? 'Nenhuma live no ar agora.' : `Nenhuma live da ${plataforma === 'kick' ? 'Kick' : 'Twitch'} no ar agora.`);
    abrirAoVivo(plataforma === 'ambas' ? undefined : plataforma);
    return ok;
  }
  if (acao === 'livesOpcoes') {
    const v = Regras.validarLivesDoCelular(p.parcial);
    if (v.erro) return falha(v.erro);
    const parcial = { ...v.valor };
    if (parcial.autoLive) parcial.autoLive = { ...(config.autoLive || { ativo: false, conta: 0 }), ...parcial.autoLive };
    await salvar(parcial);
    desenharOpcoesLives();
    desenharLives();
    return ok;
  }
  if (acao === 'radarOpcoes') {
    const v = Regras.validarRadarDoCelular(p.parcial);
    if (v.erro) return falha(v.erro);
    await salvarRadar(v.valor);
    return ok;
  }
  if (acao === 'configOpcoes') {
    const v = Regras.validarConfigDoCelular(p.parcial);
    if (v.erro) return falha(v.erro);
    if ('escalaInterface' in v.valor) {
      await salvar({ escalaInterface: v.valor.escalaInterface });
      $('#escala-interface').value = String(v.valor.escalaInterface);
    }
    if (v.valor.mudo) await definirMudo(v.valor.mudo.conta, v.valor.mudo.valor);
    return ok;
  }
  if (acao === 'capturaConfig') {
    const e = contas[i].estado || {};
    const lojaBolas = (e.captura && e.captura.lojaBolas) || [];
    const v = Regras.validarParcialCaptura(p.parcial, lojaBolas);
    if (v.erro) return falha(v.erro);
    const parcial = { ...v.valor };
    // A reposição chega por tipo (bola e poção): junta com o que já estava, como o formulário do PC faz.
    if (parcial.reposicao) {
      const rep = config.captura.contas[i].reposicao || REPOSICAO_PADRAO();
      parcial.reposicao = { ...rep, ...Object.fromEntries(Object.entries(parcial.reposicao).map(([tipo, s]) => [tipo, { ...rep[tipo], ...s }])) };
    }
    await mudarCaptura(i, parcial);
    return ok;
  }
  return falha('Ação desconhecida.');
}

// Confere de novo o que a página pediu (a conta existe) e executa: sniper e captura pelas mesmas funções dos
// interruptores e formulários da interface; as do jogo, pelo motor da conta.
async function executarAcaoCelular(a) {
  const falha = (motivo) => ({ ok: false, motivo });
  const c = contas[a.conta];
  const p = a.params || {};
  if (!c) return falha('Essa conta não existe.');
  if (ACOES_DE_CONFIG.includes(a.acao)) return executarConfigCelular(a.conta, a.acao, p);
  if (!c.pronta) return falha('A conta ainda está carregando.');
  if (!c.estado || !c.estado.conectado) return falha('Conta sem conexão com o jogo.');
  // Análise de hunts: a mesma pedida do botão Atualizar da aba Hunts. O resultado chega depois, pelo motor.
  if (a.acao === 'huntsAtualizar') {
    c.webview.send('central', { tipo: 'analisarHunts' });
    return { ok: true, motivo: null };
  }

  // Ações do jogo: o motor confere com o estado da conta e responde por postar('acaoResultado').
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      acoesJogoEmCurso.delete(a.pedido);
      resolve(falha('A conta não respondeu a tempo.'));
    }, 4000);
    acoesJogoEmCurso.set(a.pedido, (r) => { clearTimeout(timer); resolve({ ok: r.ok === true, motivo: r.motivo || null }); });
    c.webview.send('central', { tipo: 'acaoJogo', acao: a.acao, params: p, pedido: a.pedido });
  });
}

// ------------------------------------------------------------------ Início

(async function iniciar() {
  config = await window.central.getConfig();
  montarContas();
  desenharSom();
  montarSniper();
  $('#lv-conta').replaceChildren(...config.contas.map((c, i) => el('option', { value: String(i) }, c.nome)));
  $('#lv-conta').addEventListener('change', async (e) => { await salvar({ contaLives: Number(e.target.value) }); desenharLives(); });
  $('#fechar-lives').addEventListener('click', () => {
    $('#players').replaceChildren(el('p', { class: 'vazio' }, 'Nenhuma live aberta.'));
    verificarLoginTwitch();
  });
  $('#lv-qualidade').addEventListener('change', (e) => salvar({ qualidadeLives: e.target.value }));
  $('#lv-auto-conta').replaceChildren(...config.contas.map((c, i) => el('option', { value: String(i) }, c.nome)));
  const salvarAuto = () => salvar({ autoLive: { ativo: $('#lv-auto').checked, conta: Number($('#lv-auto-conta').value) } });
  $('#lv-auto').addEventListener('change', salvarAuto);
  $('#lv-auto-conta').addEventListener('change', salvarAuto);
  $('#lv-manter').addEventListener('change', (e) => salvar({ manterLives: e.target.checked }));
  desenharOpcoesLives();
  setInterval(manterLives, INTERVALO_MANTER_LIVES);
  desenharLives();
  atualizarResumo();
  enviarSniper();
  verificarLoginTwitch();
  setInterval(verificarLoginTwitch, 30_000);
  montarConfig();
  montarEscala();
  montarCaptura();
  montarPainelCelular();
  montarHunts();
  montarMercado();
  await carregarHistoricos();
  desenharFiltroConta();
  desenharSorteios();
  desenharHistoricoCompras();
  desenharHistoricoGlobal();
  carregarCatalogo().then(desenharRegras);
  $('#mutar-lives').addEventListener('click', () => {
    livesMudas = !livesMudas;
    document.querySelectorAll('#players webview').forEach((w) => { try { w.setAudioMuted(livesMudas); } catch { /* ainda carregando */ } });
    $('#mutar-lives').textContent = livesMudas ? '🔇 Lives mudas' : '🔊 Mutar todas';
    $('#mutar-lives').classList.toggle('ativa', livesMudas);
  });
  desenharDashboard();
  setInterval(desenharDashboard, 1000);
  mostrarNovidades();
  for (const b of document.querySelectorAll('.janela-botoes button')) b.addEventListener('click', () => window.central.janela(b.dataset.janela));
  window.central.onJanela(({ maximizada }) => document.body.classList.toggle('maximizada', maximizada));
  montarAlcas();
  // Atualização: aviso no topo (baixando → "Reiniciar e atualizar") e o quadro da aba Config.
  const mostrarAtualizacao = (a) => {
    const b = $('#atualizacao');
    const v = a.versao ? ` ${a.versao}` : '';
    const noTopo = a.estado === 'baixando' || a.estado === 'pronta';
    b.hidden = !noTopo;
    b.classList.toggle('pronta', a.estado === 'pronta');
    b.textContent = a.estado === 'pronta' ? `Reiniciar e atualizar para a${v}` : `Baixando atualização${v} · ${a.pct || 0}%`;
    b.disabled = a.estado !== 'pronta';
    const textos = {
      procurando: 'Procurando…',
      atualizado: 'Você está na versão mais recente.',
      baixando: `Baixando a${v}: ${a.pct || 0}%`,
      pronta: `A${v} está pronta: clique em "Reiniciar e atualizar" no topo.`,
      erro: a.erro || 'Não deu para procurar agora.',
      dev: 'Só o app instalado se atualiza (este está rodando pelo código).'
    };
    $('#estado-atualizacao').textContent = textos[a.estado] || '';
    $('#estado-atualizacao').className = 'nota' + (a.estado === 'erro' ? ' erro' : a.estado === 'atualizado' || a.estado === 'pronta' ? ' ok' : '');
    $('#checar-atualizacao').disabled = a.estado === 'procurando' || a.estado === 'baixando';
  };
  window.central.onAtualizacao(mostrarAtualizacao);
  $('#atualizacao').addEventListener('click', () => window.central.instalarAtualizacao());
  $('#checar-atualizacao').addEventListener('click', async () => mostrarAtualizacao(await window.central.checarAtualizacao()));
  window.central.infoAtualizacao().then((a) => { versaoApp = a.versao || ''; $('#versao-app').textContent = a.versao; if (a.estado !== 'parado') mostrarAtualizacao(a); });
  // Contador discreto: quantas vezes o instalador foi baixado nas Releases do GitHub (sem rastrear ninguém).
  window.central.totalDownloads().then((d) => {
    if (!d || !(d.total > 0)) return;
    $('#downloads-app').textContent = `${fmt(d.total)} downloads no GitHub`;
    $('#downloads-app').hidden = false;
  }).catch(() => {});
  $('.topo').addEventListener('dblclick', (e) => { if (e.target.closest('button, select, input')) return; window.central.janela('maximizar'); });
})();
