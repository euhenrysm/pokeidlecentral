// Painel no celular: um servidor HTTP na rede local que mostra os números das contas numa página só de
// leitura. Só liga quando o interruptor da aba Config está ligado (ou ao abrir o app, se estava ligado).
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Gera o QR code do endereço. Se a biblioteca faltar, a Config mostra só o endereço em texto.
let qrcode = null;
try { qrcode = require('qrcode-generator'); } catch { qrcode = null; }

// Portas fixas: se a primeira estiver ocupada, tenta as seguintes.
const PORTAS = [47740, 47741, 47742, 47743, 47744, 47745];
const MAX_POR_SEGUNDO = 10; // pedidos por IP a cada segundo (passou disso: 429)
const MAX_IPS = 8; // IPs diferentes com pedidos nos últimos 60 s (passou disso: 429)
const JANELA_IPS_MS = 60_000;
const MAX_CORPO = 8 * 1024; // corpo maior que isso: 413; qualquer outro corpo: 400 (a página só recebe GET)
const MAX_IMAGEM = 300_000; // tamanho máximo de uma imagem embutida (data:) no snapshot
const MAX_CONTAS = 4;
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
let ultimoSnapshot = null; // { geradoEm, contas }
const sockets = new Set();
const pedidosPorIp = new Map(); // ip -> { inicio, n }
const ipsAtivos = new Map(); // ip -> quando fez o último pedido
let paginaCache = null;

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
function ehPrivado(endereco) {
  const [a, b] = String(endereco).split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function novoToken() {
  return crypto.randomBytes(32).toString('hex');
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
    capturaLigada: d.capturaLigada === true
  };
}

// A central manda o snapshot a cada 3 s; o painel guarda só o último.
function guardarSnapshot(dados) {
  if (!servidor || !dados || !Array.isArray(dados.contas)) return;
  ultimoSnapshot = { geradoEm: Date.now(), contas: dados.contas.slice(0, MAX_CONTAS).map(sanitizarConta) };
}

function respostaEstado() {
  if (!ultimoSnapshot) return { geradoEm: null, idadeMs: null, contas: [] };
  return { geradoEm: ultimoSnapshot.geradoEm, idadeMs: Date.now() - ultimoSnapshot.geradoEm, contas: ultimoSnapshot.contas };
}

function paginaHtml() {
  if (paginaCache === null) paginaCache = fs.readFileSync(path.join(__dirname, 'painel-celular.html'), 'utf8');
  return paginaCache;
}

function atender(req, res) {
  const origem = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const responder = (status, corpo, cabec = {}) => {
    res.writeHead(status, { ...CABECALHOS, 'Content-Type': 'application/json; charset=utf-8', ...cabec });
    res.end(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
  };
  if (!dentroDoLimite(origem)) return responder(429, { ok: false, motivo: 'muitas requisições' });

  const tamanho = Number(req.headers['content-length'] || 0);
  if (req.headers['transfer-encoding'] || tamanho > 0) {
    res.setHeader('Connection', 'close');
    return responder(tamanho > MAX_CORPO ? 413 : 400, { ok: false, motivo: 'esta página não recebe corpo' });
  }
  if (req.method !== 'GET') return responder(405, { ok: false, motivo: 'método não permitido' }, { Allow: 'GET' });

  let caminho;
  try {
    caminho = new URL(req.url || '/', 'http://painel.local').pathname;
  } catch {
    return responder(400, { ok: false, motivo: 'pedido inválido' });
  }
  // A página não tem dados: o código vem no fragmento da URL (#t=...), que o navegador não envia aqui.
  if (caminho === '/') return responder(200, paginaHtml(), { 'Content-Type': 'text/html; charset=utf-8' });
  if (caminho !== '/api/estado') return responder(404, { ok: false, motivo: 'não encontrado' });
  if (!tokenValido(req.headers.authorization)) return responder(401, { ok: false, motivo: 'código inválido' });
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
function qrDoCodigo() {
  if (!qrcode || !servidor) return null;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(`http://${ip}:${porta}/#t=${token}`);
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 4, margin: 2 });
    return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
  } catch {
    return null;
  }
}

function resposta() {
  return { ok: true, ligado: true, url: `http://${ip}:${porta}`, qr: qrDoCodigo(), motivo: null };
}
function desligado() {
  return { ok: true, ligado: false, url: null, qr: null, motivo: null };
}
function semLigar(motivo) {
  token = '';
  return { ok: false, ligado: false, url: null, qr: null, motivo };
}

async function subir() {
  const rede = ipDaRede();
  if (!rede) return semLigar('Não achei um endereço de rede (Wi-Fi ou cabo) neste computador. Conecte-o à rede e ligue o painel de novo.');
  token = novoToken();
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
  pedidosPorIp.clear();
  ipsAtivos.clear();
  return desligado();
}

// Gera um código novo: o antigo deixa de valer na hora.
function novoCodigo() {
  if (!servidor) return semLigar('O painel está desligado. Ligue-o primeiro.');
  token = novoToken();
  return resposta();
}

function estado() {
  return servidor ? resposta() : desligado();
}

module.exports = { ligar, desligar, novoCodigo, estado, guardarSnapshot };
