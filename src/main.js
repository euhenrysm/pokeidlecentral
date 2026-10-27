// Processo principal: janela da central, sessões isoladas das 4 contas e configuração.
const { app, BrowserWindow, ipcMain, shell, session, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// A pasta de dados é sempre pokeidle-central dentro do appData (Windows: %APPDATA%; Linux: ~/.config), rodando pelo código ou pelo instalador
// (o instalador usa o nome "PokeIdle Central", e mudar a pasta faria todas as contas caírem).
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'pokeidle-central'));
// Linux: deixa o Chromium escolher entre Wayland e X11 sozinho.
if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
// Janela opaca (sem transparência) para quem não tem compositor: POKEIDLE_OPACO=1.
const OPACO = process.env.POKEIDLE_OPACO === '1';
const atualizador = require('./atualizador');
const credenciais = require('./credenciais');
const sessaoNavegador = require('./sessao-navegador');
const navegadores = require('./navegadores');
const painelCelular = require('./painel-celular');
const armazem = require('./armazem');

const GAME_ORIGIN = 'https://pokeidle.io/';
// Cada conta tem a sua partição: cookies do jogo, da Twitch e da Kick ficam separados por conta.
const GAME_PARTITIONS = ['persist:conta1', 'persist:conta2', 'persist:conta3', 'persist:conta4'];
const LIVE_ORIGINS = ['https://www.twitch.tv/', 'https://kick.com/'];
// Popups que precisam ficar dentro do app (login e vínculo de Twitch/Kick feitos pelo próprio jogo).
const POPUP_HOSTS = ['pokeidle.io', 'id.twitch.tv', 'www.twitch.tv', 'kick.com', 'id.kick.com'];

const DEFAULT_CONFIG = {
  contas: [{ nome: 'Conta 1' }, { nome: 'Conta 2' }, { nome: 'Conta 3' }, { nome: 'Conta 4' }],
  zoom: [1, 1, 1, 1],
  mudo: [false, false, false, false],
  sniper: {
    margemMs: 800,
    varreduraSeg: 20,
    // Desligado: se duas contas acharem o mesmo anúncio, só a primeira dispara.
    mesmoSorteio: false,
    // Um sniper por conta, cada um com as suas regras.
    contas: [0, 1, 2, 3].map(() => ({ ativo: false, regras: [] }))
  },
  // Abrir sozinha a live que entrar no ar, numa conta só (a que você assiste).
  autoLive: { ativo: false, conta: 0 },
  // A cada 5 min: fecha as lives abertas que saíram do ar e recarrega (F5) as que seguem no ar.
  manterLives: true,
  // Aba Captura: lançar bolas nos pokémons caídos, por conta. modo 'capturar' (até capturar) ou 'sempre'.
  // reposicao: compra na loja do jogo quando a bola/poção fica abaixo de `abaixoDe` (limite 0 = sempre).
  captura: { contas: [0, 1, 2, 3].map(() => ({ ativo: false, modo: 'capturar', ballId: 1, reposicao: {
    bola: { ativo: false, id: 1, abaixoDe: 50, qtd: 1000, limite: 0 },
    pocao: { ativo: false, id: 200, abaixoDe: 50, qtd: 1000, limite: 0 }
  } })) },
  // Última versão cujo cartão de novidades você já viu.
  novidadesVistas: null,
  // Qualidade das lives da Twitch: 'chat' (só o chat, sem vídeo), '160p30', '360p30', '480p30' ou 'auto'.
  qualidadeLives: '160p30',
  // Navegador/perfil que o "Pelo navegador" abre, por conta ('padrao' = o do Windows).
  navegadorLogin: ['padrao', 'padrao', 'padrao', 'padrao'],
  // Conta em que "Assistir" e "Abrir todas" abrem as lives.
  contaLives: 0,
  // Aba Mercado: atualizar sozinha e procurar ofertas abaixo da média (sem regra; sempre pede aprovação).
  radar: { ativo: false, conta: 0, desconto: 30, moedaMedia: 'orb', minVendas: 5, auto: true, minutos: 2 },
  // Escala da interface da central: 'auto' (a maior que cabe na tela) ou 1, 0.9, 0.8, 0.75.
  escalaInterface: 'auto',
  // Posição e tamanho da janela da central ao fechar (null = ainda não salvou).
  janela: null,
  sorteios: [],
  // Painel no celular (página só de leitura na rede local). Desligado por padrão. O código de acesso
  // não fica aqui: ele muda a cada ligada e só existe na memória do processo.
  painelCelular: { ativo: false }
};

// Escala da interface: só a janela da central (os <webview> das contas têm zoom próprio).
const ESCALAS = [1, 0.9, 0.8, 0.75];
// Tamanho da interface na escala 100%, e o mínimo da janela nessa escala.
const TAMANHO_BASE = { largura: 1600, altura: 950 };
const TAMANHO_MINIMO = { largura: 1100, altura: 700 };
// Folga, em pixels, que o Automático deixa livre em cada dimensão da área útil do monitor.
const FOLGA_TELA = 24;

// A caixinha da Cloudflare (login do jogo) não carrega para um navegador que se anuncia como
// "Electron/..." ou com o nome do app. Fica a identificação do Chrome que o Electron já embute.
app.userAgentFallback = app.userAgentFallback.replace(/\s(pokeidle-central|Electron)\/\S+/g, '');

// Um app só: abrir o .bat de novo com ele aberto só traz a janela que já existe (dois apps eram 8 jogos rodando).
const instanciaUnica = app.requestSingleInstanceLock();
if (!instanciaUnica) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

let win = null;
let config = null;

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// true quando ainda não havia config.json ao abrir: instalação nova (o cartão de novidades não aparece).
let configNova = false;
function loadConfig() {
  configNova = !fs.existsSync(configPath());
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    const sniper = { ...DEFAULT_CONFIG.sniper, ...(raw.sniper || {}) };
    if (!Array.isArray(sniper.contas) || sniper.contas.length !== 4) {
      // Config da versão de sniper único: as regras vão para a conta que estava escolhida.
      const contas = structuredClone(DEFAULT_CONFIG.sniper.contas);
      if (raw.sniperConta >= 0 && raw.sniper) {
        contas[raw.sniperConta] = { ativo: Boolean(raw.sniper.ativo), regras: raw.sniper.regras || [] };
      }
      sniper.contas = contas;
    }
    // Diamantes saíram do Mercado da Comunidade do jogo: regras antigas do tipo 'diamante' são descartadas.
    sniper.contas = sniper.contas.map((c) => ({ ...c, regras: (c.regras || []).filter((r) => r && r.tipo !== 'diamante') }));
    delete sniper.ativo;
    delete sniper.regras;
    const { sniperConta, ...resto } = raw;
    return {
      ...DEFAULT_CONFIG, ...resto, sniper,
      escalaInterface: escalaValida(resto.escalaInterface),
      janela: janelaValida(resto.janela),
      painelCelular: { ativo: raw.painelCelular?.ativo === true }
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

function escalaValida(v) {
  return v === 'auto' || ESCALAS.includes(v) ? v : 'auto';
}

// Retângulo da janela salvo na config; null quando faltar algum número (config antiga ou corrompida).
function janelaValida(j) {
  const ok = Boolean(j) && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(j[k])) && j.width > 0 && j.height > 0;
  return ok ? { x: j.x, y: j.y, width: j.width, height: j.height, maximizada: Boolean(j.maximizada) } : null;
}

// Retângulo salvo, se ainda cabe num monitor: pelo menos metade dele dentro da área útil de algum display.
// Ajustado ao mínimo da escala e para não passar da área útil; null quando não cabe.
function retanguloSalvo() {
  const s = config.janela;
  if (!s) return null;
  let area = null;
  let maiorSobreposicao = 0;
  for (const d of screen.getAllDisplays()) {
    const a = d.workArea;
    const w = Math.min(s.x + s.width, a.x + a.width) - Math.max(s.x, a.x);
    const h = Math.min(s.y + s.height, a.y + a.height) - Math.max(s.y, a.y);
    if (w > 0 && h > 0 && w * h > maiorSobreposicao) { area = a; maiorSobreposicao = w * h; }
  }
  if (!area || maiorSobreposicao < (s.width * s.height) / 2) return null;
  const f = fatorDaEscala(area);
  const largura = Math.min(Math.max(Math.round(TAMANHO_MINIMO.largura * f), Math.round(s.width)), area.width);
  const altura = Math.min(Math.max(Math.round(TAMANHO_MINIMO.altura * f), Math.round(s.height)), area.height);
  const x = Math.min(Math.max(Math.round(s.x), area.x), area.x + area.width - largura);
  const y = Math.min(Math.max(Math.round(s.y), area.y), area.y + area.height - altura);
  return { x, y, width: largura, height: altura, maximizada: s.maximizada };
}

// Guarda posição e tamanho em config.janela (o retângulo normal, se estiver maximizada). Minimizada, não guarda.
function salvarJanela() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  const maximizada = win.isMaximized();
  const r = maximizada ? win.getNormalBounds() : win.getBounds();
  config.janela = { x: r.x, y: r.y, width: r.width, height: r.height, maximizada };
  saveConfig();
}
// Com debounce, para não gravar a cada pixel arrastado.
let timerJanela = null;
function agendarSalvarJanela() {
  clearTimeout(timerJanela);
  timerJanela = setTimeout(salvarJanela, 500);
}

// Automático: a maior escala em que a interface base cabe na área útil do monitor (senão, 75%).
function fatorDaEscala(area) {
  if (config.escalaInterface !== 'auto') return config.escalaInterface;
  const livreL = area.width - FOLGA_TELA;
  const livreA = area.height - FOLGA_TELA;
  return ESCALAS.find((f) => TAMANHO_BASE.largura * f <= livreL && TAMANHO_BASE.altura * f <= livreA) ?? 0.75;
}

// Tamanho e posição de uma janela nova: a interface base na escala, centralizada no monitor principal.
function retanguloPadrao() {
  const area = screen.getPrimaryDisplay().workArea;
  const f = fatorDaEscala(area);
  const largura = Math.min(Math.round(TAMANHO_BASE.largura * f), area.width);
  const altura = Math.min(Math.round(TAMANHO_BASE.altura * f), area.height);
  return {
    x: area.x + Math.round((area.width - largura) / 2),
    y: area.y + Math.round((area.height - altura) / 2),
    width: largura,
    height: altura
  };
}

// Aplica a escala na janela da central e ajusta o tamanho mínimo a ela.
function aplicarEscala() {
  if (!win || win.isDestroyed()) return;
  const f = fatorDaEscala(screen.getDisplayMatching(win.getBounds()).workArea);
  win.webContents.setZoomFactor(f);
  win.setMinimumSize(Math.round(TAMANHO_MINIMO.largura * f), Math.round(TAMANHO_MINIMO.altura * f));
}

function createWindow() {
  const r = retanguloSalvo() || retanguloPadrao();
  win = new BrowserWindow({
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    // Começa escondida: a escala é aplicada antes de a janela aparecer (sem piscar 100% e depois a escala).
    show: false,
    // Sem a moldura do Windows: o topo do app é a barra (arrasta a janela) e tem os botões de
    // minimizar, maximizar e fechar. Transparente para os cantos arredondados aparecerem no Windows 10.
    frame: false,
    transparent: !OPACO,
    backgroundColor: OPACO ? '#0f1011' : '#00000000',
    title: 'PokéIdle Central',
    webPreferences: {
      preload: path.join(__dirname, 'preload-host.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });
  win.setMenuBarVisibility(false);
  aplicarEscala();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Mostra quando a interface estiver pronta; se o evento não vier, mostra depois de 3 s.
  let mostrada = false;
  const mostrar = () => {
    if (mostrada || !win || win.isDestroyed()) return;
    mostrada = true;
    aplicarEscala();
    // Maximizada na última vez: maximize() já mostra a janela (no Windows ela apareceria antes da hora se viesse antes).
    if (r.maximizada) win.maximize();
    else win.show();
  };
  win.once('ready-to-show', mostrar);
  setTimeout(mostrar, 3000);
  // Maximizada, a janela perde os cantos arredondados (encosta nas bordas da tela).
  const avisarJanela = () => { if (!win.isDestroyed()) win.webContents.send('janela:estado', { maximizada: win.isMaximized() }); };
  win.on('maximize', avisarJanela);
  win.on('unmaximize', avisarJanela);
  win.webContents.on('did-finish-load', () => { aplicarEscala(); avisarJanela(); });
  // A escala Automática depende do monitor: recalcula só quando a janela troca de monitor.
  let idMonitor = screen.getDisplayMatching(win.getBounds()).id;
  const verificarMonitor = () => {
    if (!win || win.isDestroyed()) return;
    const id = screen.getDisplayMatching(win.getBounds()).id;
    if (id !== idMonitor) { idMonitor = id; aplicarEscala(); }
  };
  // Posição e tamanho: salvos com debounce, e de novo ao fechar (gravação síncrona).
  const aoMudarJanela = () => { verificarMonitor(); agendarSalvarJanela(); };
  win.on('move', aoMudarJanela);
  win.on('resize', aoMudarJanela);
  win.on('maximize', agendarSalvarJanela);
  win.on('unmaximize', agendarSalvarJanela);
  win.on('close', () => { clearTimeout(timerJanela); salvarJanela(); });
}

// A janela transparente não redimensiona pela borda do Windows: as alças do app pedem o tamanho novo aqui.
// O zoom vai junto: com zoom ≠ 1 os movimentos do mouse chegam em pixels CSS, e o lado do renderer converte.
ipcMain.handle('janela:limites', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  return w && { ...w.getBounds(), zoom: w.webContents.getZoomFactor() };
});
ipcMain.on('janela:redimensionar', (e, b) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || w.isMaximized() || !b) return;
  const [minL, minA] = w.getMinimumSize();
  const largura = Math.max(minL, Math.round(b.width));
  const altura = Math.max(minA, Math.round(b.height));
  // Ao puxar pela esquerda/topo, o lado oposto fica parado mesmo quando bate no tamanho mínimo.
  const x = b.ancoraDireita != null ? b.ancoraDireita - largura : Math.round(b.x);
  const y = b.ancoraBaixo != null ? b.ancoraBaixo - altura : Math.round(b.y);
  w.setBounds({ x, y, width: largura, height: altura });
});

ipcMain.handle('janela:acao', (e, acao) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (acao === 'minimizar') w.minimize();
  else if (acao === 'maximizar') { if (w.isMaximized()) w.unmaximize(); else w.maximize(); }
  else if (acao === 'fechar') w.close();
});

// Só deixa nascer <webview> nas partições das contas, apontando para o jogo ou para uma live.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = String(params.src);
    const known = GAME_PARTITIONS.includes(params.partition);
    const isGame = known && src.startsWith(GAME_ORIGIN);
    const isLive = known && LIVE_ORIGINS.some(o => src.startsWith(o));
    if (!isGame && !isLive) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preloadURL;
    webPreferences.preload = isGame ? path.join(__dirname, 'preload-game.js') : undefined;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    // O jogo e o sniper continuam em ritmo normal com a conta fora de foco.
    webPreferences.backgroundThrottling = false;
  });

  contents.setWindowOpenHandler(({ url }) => {
    let host = '';
    try { host = new URL(url).hostname; } catch { return { action: 'deny' }; }
    if (POPUP_HOSTS.includes(host)) return { action: 'allow' };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

ipcMain.handle('config:get', () => config);
// Em quais contas a Twitch está logada dentro do app (cookie de login da Twitch na sessão da conta).
ipcMain.handle('twitch:logado', () => Promise.all(GAME_PARTITIONS.map(async (p) => {
  try {
    const ses = session.fromPartition(p);
    const token = await ses.cookies.get({ url: 'https://www.twitch.tv', name: 'auth-token' });
    // O cookie "login" da Twitch guarda o nome do usuário (não é credencial).
    const login = await ses.cookies.get({ url: 'https://www.twitch.tv', name: 'login' });
    return { logado: token.length > 0, usuario: login.length ? login[0].value : '' };
  } catch {
    return { logado: false, usuario: '' };
  }
})));
// Cópia do bloco de lives que o jogo manda, para conferir o formato quando a leitura falhar.
// Nomes dos campos e exemplos de eventos que o jogo manda, para calibrar a telemetria.
ipcMain.handle('debug:telemetria', (_e, dados) => {
  fs.writeFileSync(path.join(app.getPath('userData'), 'telemetria-debug.json'), JSON.stringify(dados, null, 2));
});
ipcMain.handle('debug:lives', (_e, dados) => {
  fs.writeFileSync(path.join(app.getPath('userData'), 'lives-debug.json'), JSON.stringify(dados, null, 2));
});
ipcMain.handle('navegador:listar', () => navegadores.listar());
// Total de downloads dos instaladores nas Releases do GitHub (público, sem identificar ninguém). Cache de 6 h.
let cacheDownloads = null;
ipcMain.handle('downloads:total', async () => {
  if (cacheDownloads && Date.now() - cacheDownloads.em < 6 * 3_600_000) return cacheDownloads;
  try {
    const res = await net.fetch('https://api.github.com/repos/euhenrysm/pokeidlecentral/releases?per_page=100', { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return cacheDownloads;
    let total = 0;
    for (const r of await res.json()) for (const a of r.assets || []) if (/\.(exe|AppImage|deb)$/i.test(a.name)) total += Number(a.download_count) || 0;
    cacheDownloads = { total, em: Date.now() };
  } catch { /* sem internet: fica sem o número */ }
  return cacheDownloads;
});
ipcMain.handle('navegador:entrar', (_e, i, servico) => {
  try { sessaoNavegador.pedir(i, servico, (config.navegadorLogin || [])[i]); return { ok: true }; }
  catch (err) { return { ok: false, motivo: err.message }; }
});
// Catálogo de itens: o público do jogo (/assets/items.json) mais os itens próprios que a conta
// recebe ao conectar. Os dois ficam em cache para o seletor funcionar com o jogo fechado.
const arquivoCache = (nome) => path.join(app.getPath('userData'), nome);
ipcMain.handle('catalogo:get', async () => {
  let base = null;
  try {
    const res = await net.fetch('https://pokeidle.io/assets/items.json');
    if (res.ok) {
      base = (await res.json()).items;
      fs.writeFileSync(arquivoCache('itens-cache.json'), JSON.stringify(base));
    }
  } catch { /* sem internet: usa o cache */ }
  if (!base) {
    try { base = JSON.parse(fs.readFileSync(arquivoCache('itens-cache.json'), 'utf8')); } catch { base = []; }
  }
  let nossos = [];
  try { nossos = JSON.parse(fs.readFileSync(arquivoCache('itens-nossos.json'), 'utf8')); } catch { /* ainda não veio */ }
  return { base, nossos };
});
// Espécies para o seletor do sniper: as listas públicas do jogo, só a Pokédex nacional (1–1025).
// As variantes de Outland (#2001+) e as cópias de Orre ficam fora de propósito.
ipcMain.handle('especies:get', async () => {
  const cache = arquivoCache('especies-cache.json');
  try {
    const listas = await Promise.all(['creatures.json', 'creatures-novos.json'].map((f) =>
      net.fetch(`https://pokeidle.io/assets/${f}`).then((r) => (r.ok ? r.json() : { creatures: [] }))));
    const porId = new Map();
    for (const l of listas) {
      for (const c of (l && l.creatures) || []) {
        const id = Number(c.pokeId);
        if (id >= 1 && id <= 1025 && c.name && !porId.has(id)) {
          porId.set(id, { id, nome: c.name, raridade: c.rarity || '', tipos: [c.type1, c.type2].filter(Boolean) });
        }
      }
    }
    const especies = [...porId.values()].sort((a, b) => a.id - b.id);
    if (especies.length) fs.writeFileSync(cache, JSON.stringify(especies));
    return especies;
  } catch {
    try { return JSON.parse(fs.readFileSync(cache, 'utf8')); } catch { return []; }
  }
});

// Sprites das espécies, desenhados com o módulo de sprites do próprio jogo numa janela escondida
// na página pública (sem login). Cada sprite fica em cache no disco.
let janelaSprites = null;
let spritesProntos = null;
function rendererDeSprites() {
  if (!spritesProntos) {
    janelaSprites = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:sprites', backgroundThrottling: false } });
    spritesProntos = janelaSprites.loadURL('https://pokeidle.io/')
      .then(() => janelaSprites.webContents.executeJavaScript(`window.__sprites = import('/sprites.mjs'); true`))
      .catch((err) => { spritesProntos = null; throw err; });
  }
  return spritesProntos;
}
// A janela de sprites é uma página inteira do jogo: fecha sozinha depois de 1 minuto sem uso.
let timerSprites = null;
function agendarFechamentoSprites() {
  clearTimeout(timerSprites);
  timerSprites = setTimeout(() => {
    if (janelaSprites && !janelaSprites.isDestroyed()) janelaSprites.destroy();
    janelaSprites = null;
    spritesProntos = null;
  }, 60_000);
}
// A imagem "nossa" do pokémon (a da Pokédex aberta, PokeAPI), só para os nº 1 a 1025, normal ou shiny.
// Baixada uma vez e guardada no cache; quem não existe lá (404) fica marcado para não perguntar de novo.
ipcMain.handle('sprites:nosso', async (_e, dex, shiny) => {
  dex = Number(dex);
  if (!(Number.isInteger(dex) && dex >= 1 && dex <= 1025)) return null;
  const pasta = arquivoCache('sprites-pokedex');
  fs.mkdirSync(pasta, { recursive: true });
  const arq = path.join(pasta, `${dex}${shiny ? 's' : ''}.txt`);
  if (fs.existsSync(arq)) return fs.readFileSync(arq, 'utf8') || null;
  try {
    const res = await net.fetch(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${shiny ? 'shiny/' : ''}${dex}.png`);
    if (res.status === 404) { fs.writeFileSync(arq, ''); return null; }
    if (!res.ok) return null;
    const url = 'data:image/png;base64,' + Buffer.from(await res.arrayBuffer()).toString('base64');
    fs.writeFileSync(arq, url);
    return url;
  } catch { return null; } // sem internet: fica o sprite do jogo
});

ipcMain.handle('sprites:pegar', async (_e, ids) => {
  const pasta = arquivoCache('sprites');
  fs.mkdirSync(pasta, { recursive: true });
  const out = {};
  const faltam = [];
  for (const id of (ids || []).map(Number).filter((n) => n > 0 && n < 100000).slice(0, 60)) {
    const arq = path.join(pasta, `${id}.txt`);
    if (fs.existsSync(arq)) out[id] = fs.readFileSync(arq, 'utf8') || null;
    else faltam.push(id);
  }
  if (faltam.length) {
    try {
      await rendererDeSprites();
      agendarFechamentoSprites();
      const novos = await janelaSprites.webContents.executeJavaScript(`(async () => {
        const m = await window.__sprites;
        const out = {};
        for (const id of ${JSON.stringify(faltam)}) {
          try {
            const s = await m.carregarOutfit(60000 + id);
            const q = s && m.quadrosDe(s, 3)[0];
            if (!q || !s.imagens[q.pagina]) { out[id] = ''; continue; }
            const c = document.createElement('canvas');
            c.width = q.w; c.height = q.h;
            const x = c.getContext('2d');
            x.imageSmoothingEnabled = false;
            x.drawImage(s.imagens[q.pagina], q.x, q.y, q.w, q.h, 0, 0, q.w, q.h);
            out[id] = c.toDataURL('image/png');
          } catch { out[id] = ''; }
        }
        return out;
      })()`);
      for (const [id, url] of Object.entries(novos)) {
        fs.writeFileSync(path.join(pasta, `${id}.txt`), url || '');
        out[id] = url || null;
      }
    } catch { /* sem internet: fica sem sprite */ }
  }
  return out;
});

ipcMain.handle('catalogo:salvarNossos', (_e, lista) => {
  if (Array.isArray(lista) && lista.length) fs.writeFileSync(arquivoCache('itens-nossos.json'), JSON.stringify(lista));
});
ipcMain.handle('cred:listar', () => credenciais.listar());
ipcMain.handle('cred:salvar', (_e, i, servico, usuario, senha) => {
  try { credenciais.salvar(i, servico, usuario, senha); return { ok: true }; }
  catch (err) { return { ok: false, motivo: err.message }; }
});
ipcMain.handle('cred:apagar', (_e, i, servico) => credenciais.apagar(i, servico));
ipcMain.handle('cred:preencher', (_e, idWebContents, i, servico) => credenciais.preencher(idWebContents, i, servico));
ipcMain.handle('config:set', (_e, parcial) => {
  const mudouEscala = Boolean(parcial) && 'escalaInterface' in parcial;
  config = { ...config, ...parcial };
  if (mudouEscala) config.escalaInterface = escalaValida(config.escalaInterface);
  saveConfig();
  if (mudouEscala) aplicarEscala();
  return config;
});

// O login do jogo vem num cookie de SESSÃO, que o Chromium apaga ao fechar o app (as contas caíam
// a cada reabertura). Nas sessões das contas, esses cookies do jogo/Twitch/Kick ganham validade de
// 30 dias; quem decide se o login ainda vale continua sendo o servidor.
const DOMINIOS_LOGIN = /(^|\.)(pokeidle\.io|twitch\.tv|kick\.com)$/;
const VALIDADE_LOGIN_S = 30 * 86_400;
function manterLoginAoFechar(ses) {
  ses.cookies.on('changed', (_e, cookie, _causa, removido) => {
    if (removido || !cookie.session) return;
    const dominio = String(cookie.domain || '').replace(/^\./, '');
    if (!DOMINIOS_LOGIN.test(dominio)) return;
    ses.cookies.set({
      url: `https://${dominio}${cookie.path || '/'}`,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.hostOnly ? undefined : cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: Date.now() / 1000 + VALIDADE_LOGIN_S
    }).catch(() => {});
  });
}

app.on('before-quit', () => {
  for (const p of GAME_PARTITIONS) session.fromPartition(p).cookies.flushStore().catch(() => {});
  if (historicoCompras) historicoCompras.fechar();
  if (historicoGlobal) historicoGlobal.fechar();
});

// Histórico de compras (sorteios e reposição) e histórico global do mercado: cada um num arquivo
// próprio na pasta de dados, com limite de registros. Abertos ao iniciar o app.
let historicoCompras = null;
let historicoGlobal = null;
const DIA_MS = 24 * 3600_000;
ipcMain.handle('historico:compras', () => (historicoCompras ? historicoCompras.lista() : []));
ipcMain.handle('historico:registrarCompras', (_e, lista) => {
  if (historicoCompras && Array.isArray(lista)) historicoCompras.adicionar(lista.slice(0, 500));
});
ipcMain.handle('historico:global', () => (historicoGlobal ? historicoGlobal.lista() : []));
ipcMain.handle('historico:registrarGlobal', (_e, lista) => {
  if (historicoGlobal && Array.isArray(lista)) historicoGlobal.adicionar(lista.slice(0, 2000));
});
// O painel no celular fecha junto com o app: servidor, conexões e código.
app.on('before-quit', () => painelCelular.desligar());

// Cartão de novidades: true quando é a primeira abertura nesta pasta de dados.
ipcMain.handle('config:nova', () => configNova);

// Painel no celular: o interruptor liga e desliga o servidor da rede local e grava só o estado (nunca o código).
function gravarPainelCelular(ligado) {
  config = { ...config, painelCelular: { ativo: ligado === true } };
  saveConfig();
}
ipcMain.handle('celular:ligar', async (_e, ativo) => {
  const r = ativo === true ? await painelCelular.ligar() : painelCelular.desligar();
  gravarPainelCelular(r.ligado);
  return r;
});
ipcMain.handle('celular:novoCodigo', () => painelCelular.novoCodigo());
ipcMain.handle('celular:info', () => painelCelular.estado());
// Snapshot dos números das contas, a cada 3 s enquanto o painel está ligado. Só a janela principal manda.
ipcMain.on('celular:snapshot', (e, dados) => {
  if (win && !win.isDestroyed() && e.sender === win.webContents) painelCelular.guardarSnapshot(dados);
});
// Ações pedidas pelo celular: a janela principal (central) executa e confirma. Sem resposta em 4,5 s, a
// recusa sai daqui (o painel espera 5 s no máximo, então a página sempre recebe um motivo).
const acoesDoCelular = new Map(); // pedido -> quem espera a resposta
let proximoPedidoCelular = 1;
painelCelular.definirAcao((acao) => new Promise((resolve) => {
  if (!win || win.isDestroyed()) return resolve({ ok: false, motivo: 'O app não está aberto.' });
  const pedido = proximoPedidoCelular++;
  const timer = setTimeout(() => {
    acoesDoCelular.delete(pedido);
    resolve({ ok: false, motivo: 'A central não respondeu a tempo.' });
  }, 4500);
  acoesDoCelular.set(pedido, (r) => { clearTimeout(timer); resolve(r); });
  win.webContents.send('celular:acao', { pedido, conta: acao.conta, acao: acao.acao, params: acao.params });
}));
ipcMain.on('celular:acaoResposta', (e, r) => {
  if (!win || win.isDestroyed() || e.sender !== win.webContents || !r) return;
  const responder = acoesDoCelular.get(r.pedido);
  if (!responder) return;
  acoesDoCelular.delete(r.pedido);
  responder({ ok: r.ok === true, motivo: r.motivo || null });
});

function iniciarApp() {
  if (win) return;
  config = loadConfig();
  historicoCompras = armazem.abrirArmazem(arquivoCache('historico-compras.json'), { limite: 2000 });
  historicoGlobal = armazem.abrirArmazem(arquivoCache('historico-global.json'), {
    limite: 5000, chave: 'id', filtrar: (x) => Number(x.em) >= Date.now() - DIA_MS
  });
  for (const p of GAME_PARTITIONS) manterLoginAoFechar(session.fromPartition(p));
  createWindow();
  // Monitor com outra densidade (DPI) ou resolução: a escala Automática é recalculada.
  screen.on('display-metrics-changed', () => aplicarEscala());
  sessaoNavegador.iniciar(GAME_PARTITIONS, (recebido) => {
    if (win) win.webContents.send('navegador:sessao', recebido);
  });
  atualizador.iniciar(win);
  // Se o painel estava ligado ao fechar o app, liga de novo (com um código novo). Sem rede, fica desligado.
  if (config.painelCelular && config.painelCelular.ativo) {
    painelCelular.ligar().then((r) => { if (!r.ligado) gravarPainelCelular(false); });
  }
}

app.whenReady().then(() => {
  if (!instanciaUnica) return;
  iniciarApp();
});

app.on('window-all-closed', () => app.quit());
