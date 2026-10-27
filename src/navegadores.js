// Navegadores (baseados no Chromium, os que aceitam a extensão) instalados no PC, com os perfis de cada um.
// Usado pelo "Pelo navegador" da Config: cada conta escolhe em qual navegador/perfil o login é feito.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PF = process.env.ProgramFiles || 'C:\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL = process.env.LOCALAPPDATA || '';

// exe: onde o executável costuma ficar; dados: a pasta "User Data" com o "Local State" (lista de perfis).
const CONHECIDOS = [
  { id: 'chrome', nome: 'Google Chrome', exe: [`${PF}\\Google\\Chrome\\Application\\chrome.exe`, `${PF86}\\Google\\Chrome\\Application\\chrome.exe`, `${LOCAL}\\Google\\Chrome\\Application\\chrome.exe`], dados: `${LOCAL}\\Google\\Chrome\\User Data` },
  { id: 'edge', nome: 'Microsoft Edge', exe: [`${PF86}\\Microsoft\\Edge\\Application\\msedge.exe`, `${PF}\\Microsoft\\Edge\\Application\\msedge.exe`], dados: `${LOCAL}\\Microsoft\\Edge\\User Data` },
  { id: 'brave', nome: 'Brave', exe: [`${PF}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, `${LOCAL}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`], dados: `${LOCAL}\\BraveSoftware\\Brave-Browser\\User Data` },
  { id: 'vivaldi', nome: 'Vivaldi', exe: [`${LOCAL}\\Vivaldi\\Application\\vivaldi.exe`, `${PF}\\Vivaldi\\Application\\vivaldi.exe`], dados: `${LOCAL}\\Vivaldi\\User Data` },
  // O Opera guarda os dados em outro lugar e não tem perfis separados como os outros.
  { id: 'opera', nome: 'Opera', exe: [`${LOCAL}\\Programs\\Opera\\opera.exe`, `${PF}\\Opera\\opera.exe`], dados: null },
  { id: 'operagx', nome: 'Opera GX', exe: [`${LOCAL}\\Programs\\Opera GX\\opera.exe`], dados: null }
];

// Linux: executáveis comuns (deb/rpm, /opt, snap e flatpak) e a pasta de dados em ~/.config.
const HOME = require('os').homedir();
const CFG = path.join(HOME, '.config');
const FLATPAK = (id) => `/var/lib/flatpak/exports/bin/${id}`;
const CONHECIDOS_LINUX = [
  { id: 'chrome', nome: 'Google Chrome', exe: ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/google/chrome/chrome', FLATPAK('com.google.Chrome')], dados: path.join(CFG, 'google-chrome') },
  { id: 'chromium', nome: 'Chromium', exe: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', FLATPAK('org.chromium.Chromium')], dados: path.join(CFG, 'chromium') },
  { id: 'edge', nome: 'Microsoft Edge', exe: ['/usr/bin/microsoft-edge-stable', '/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge'], dados: path.join(CFG, 'microsoft-edge') },
  { id: 'brave', nome: 'Brave', exe: ['/usr/bin/brave-browser', '/usr/bin/brave', '/opt/brave.com/brave/brave', '/snap/bin/brave', FLATPAK('com.brave.Browser')], dados: path.join(CFG, 'BraveSoftware', 'Brave-Browser') },
  { id: 'vivaldi', nome: 'Vivaldi', exe: ['/usr/bin/vivaldi-stable', '/usr/bin/vivaldi', '/opt/vivaldi/vivaldi'], dados: path.join(CFG, 'vivaldi') },
  { id: 'opera', nome: 'Opera', exe: ['/usr/bin/opera', '/snap/bin/opera'], dados: null }
];
const LISTA = process.platform === 'linux' ? CONHECIDOS_LINUX : CONHECIDOS;

function perfisDe(pastaDados) {
  try {
    const estado = JSON.parse(fs.readFileSync(path.join(pastaDados, 'Local State'), 'utf8'));
    const cache = (estado.profile && estado.profile.info_cache) || {};
    return Object.entries(cache)
      .map(([dir, p]) => ({ dir, nome: p.name || dir, email: p.user_name || '' }))
      .sort((a, b) => (a.dir === 'Default' ? -1 : b.dir === 'Default' ? 1 : a.nome.localeCompare(b.nome)));
  } catch {
    return [];
  }
}

// [{ id: 'chrome:Profile 1', rotulo: 'Google Chrome · Pessoa 1 (email)' }] — 'padrao' é o navegador padrão do Windows.
function listar() {
  const opcoes = [{ id: 'padrao', rotulo: 'Navegador padrão do sistema' }];
  for (const n of LISTA) {
    const exe = n.exe.find((p) => p && fs.existsSync(p));
    if (!exe) continue;
    const perfis = n.dados ? perfisDe(n.dados) : [];
    if (!perfis.length) opcoes.push({ id: `${n.id}:`, rotulo: n.nome });
    for (const p of perfis) {
      opcoes.push({ id: `${n.id}:${p.dir}`, rotulo: `${n.nome} · ${p.nome}${p.email ? ` (${p.email})` : ''}` });
    }
  }
  return opcoes;
}

// Abre a URL no navegador/perfil escolhido; devolve false se não deu (aí quem chama usa o padrão).
function abrir(escolha, url) {
  if (!escolha || escolha === 'padrao') return false;
  const [id, dir] = String(escolha).split(':');
  const n = LISTA.find((x) => x.id === id);
  const exe = n && n.exe.find((p) => p && fs.existsSync(p));
  if (!exe) return false;
  const args = dir ? [`--profile-directory=${dir}`, url] : [url];
  const filho = spawn(exe, args, { detached: true, stdio: 'ignore' });
  filho.on('error', () => {});
  filho.unref();
  return true;
}

module.exports = { listar, abrir };
