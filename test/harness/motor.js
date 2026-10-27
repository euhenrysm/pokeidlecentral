'use strict';

// Harness dos testes. Roda o motor() de src/preload-game.js num "mundo da página" falso, sem Electron
// e sem navegador. O motor é tirado do arquivo pelo texto, serializado num new Function e recebe um
// window, WebSocket, fetch, relógio e document de mentira. Quem escreve o teste controla o tempo
// (avancar), manda pacotes do servidor (pacote), manda comandos da central (comando) e lê o que o
// motor enviou ao servidor (enviados) e à central (postagens).

const fs = require('node:fs');
const path = require('node:path');

const PRELOAD = path.join(__dirname, '..', '..', 'src', 'preload-game.js');

// Relógio de partida: uma data real em ms (depois de 1e12), para o servidorAgora ser lido como tal.
const T0 = 1_790_000_000_000;

// Tira do arquivo só o corpo de function motor() { ... }. O fim é a chave que fecha a função, logo
// antes da chamada do contextBridge, que fica fora dela.
function extrairMotor(codigoFonte) {
  const inicio = codigoFonte.indexOf('function motor() {');
  const fim = codigoFonte.indexOf('\n}\n\ncontextBridge.executeInMainWorld');
  if (inicio < 0 || fim < 0) throw new Error('Não achei function motor() em src/preload-game.js');
  return codigoFonte.slice(inicio, fim + 2);
}

// Relógio falso: setTimeout/setInterval só disparam quando o teste chama avancar(ms).
function criarRelogio(inicio) {
  let agora = inicio;
  let seq = 0;
  let filas = [];
  const agendar = (fn, ms, args, intervalo) => {
    const t = { id: ++seq, fn, args, quando: agora + Math.max(0, Number(ms) || 0), intervalo };
    filas.push(t);
    return t.id;
  };
  const relogio = {
    agora: () => agora,
    setTimeout: (fn, ms, ...args) => agendar(fn, ms, args, 0),
    setInterval: (fn, ms, ...args) => agendar(fn, ms, args, Math.max(1, Number(ms) || 1)),
    clearTimeout: (id) => { filas = filas.filter((t) => t.id !== id); },
    avancar(ms) {
      const fim = agora + ms;
      for (;;) {
        filas.sort((a, b) => a.quando - b.quando || a.id - b.id);
        const t = filas[0];
        if (!t || t.quando > fim) break;
        agora = Math.max(agora, t.quando);
        if (t.intervalo) t.quando += t.intervalo;
        else filas.shift();
        t.fn(...t.args);
      }
      agora = fim;
    }
  };
  relogio.clearInterval = relogio.clearTimeout;
  return relogio;
}

// Date que lê o relógio falso (o motor só usa Date.now()).
function criarData(relogio) {
  return class DataFalsa extends Date {
    constructor(...args) {
      if (args.length === 0) super(relogio.agora());
      else super(...args);
    }
    static now() { return relogio.agora(); }
  };
}

const esperar = () => new Promise((resolve) => setImmediate(resolve));

// Instala o motor num mundo novo e devolve a bancada de teste.
// itensPublicos: o que o /assets/items.json (catálogo público) devolve.
async function criarMotor({ itensPublicos = [], inicio = T0 } = {}) {
  const relogio = criarRelogio(inicio);
  const postagens = [];   // motor -> central: { __pcMotor, tipo, dados }
  const enviados = [];    // frames JSON que o motor mandou pelo WebSocket do jogo
  const ouvintesJanela = {};

  class WebSocketFalso {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.__ouvintes = {};
    }
    addEventListener(tipo, fn) { (this.__ouvintes[tipo] ||= []).push(fn); }
    send(dados) { enviados.push(JSON.parse(dados)); }
  }

  const janela = {
    WebSocket: WebSocketFalso,
    postMessage(msg) { postagens.push(msg); },
    addEventListener(tipo, fn) { (ouvintesJanela[tipo] ||= []).push(fn); }
  };

  // Só o catálogo público responde; o resto da rede falha (o motor já trata essas falhas).
  const fetchFalso = (url) => {
    if (url === '/assets/items.json') return Promise.resolve({ ok: true, json: async () => ({ items: itensPublicos }) });
    return Promise.reject(new Error('sem rede no teste: ' + url));
  };

  const documento = { createElement: () => ({ getContext: () => ({}) }) };
  const fonte = extrairMotor(fs.readFileSync(PRELOAD, 'utf8'));
  // import('/sprites.mjs') e outros caminhos absolutos do motor rejeitam: o motor já trata isso.
  const instalar = new Function('window', 'document', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Date', 'location', 'Image', fonte + '\nmotor();');
  instalar(janela, documento, fetchFalso, relogio.setTimeout, relogio.clearTimeout, relogio.setInterval, relogio.clearInterval,
    criarData(relogio), { href: 'https://pokeidle.io/' }, class {});

  // O jogo abre a conexão; o motor anexa ao WebSocket quando ele é criado.
  let ws = new janela.WebSocket('wss://pokeidle.io/ws');
  await esperar(); // deixa o catálogo público falso ser lido

  const disparar = (alvo, tipo, ev) => { for (const fn of alvo.__ouvintes[tipo] || []) fn(ev); };

  return {
    janela,
    relogio,
    enviados,
    postagens,
    get ws() { return ws; },
    // Servidor -> motor, pelo WebSocket do jogo.
    pacote: (obj) => disparar(ws, 'message', { data: JSON.stringify(obj) }),
    // Central -> motor, pelo window (como o preload faz com ipcRenderer).
    comando: (cmd) => { for (const fn of ouvintesJanela.message || []) fn({ source: janela, data: { __pcCentral: true, cmd } }); },
    // Queda da conexão com o jogo.
    fecharConexao: () => { ws.readyState = 3; disparar(ws, 'close', {}); },
    // Nova conexão do jogo (reconexão).
    reconectar: () => { ws = new janela.WebSocket('wss://pokeidle.io/ws'); return ws; },
    avancar: (ms) => relogio.avancar(ms),
    agora: () => relogio.agora(),
    enviadosDo: (t) => enviados.filter((m) => m && m.t === t),
    postagensDo: (tipo) => postagens.filter((m) => m && m.tipo === tipo).map((m) => m.dados),
    ultimoStatus: () => {
      const todos = postagens.filter((m) => m && m.tipo === 'status');
      return todos.length ? todos[todos.length - 1].dados : null;
    },
    esperar
  };
}

module.exports = { criarMotor, extrairMotor, T0, esperar };
