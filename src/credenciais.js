// Cofre de logins por conta. As senhas são criptografadas pelo sistema (safeStorage: DPAPI no Windows, chaveiro no Linux) e ficam
// num arquivo separado da config; a interface só fica sabendo se existe senha salva.
const { app, safeStorage, webContents } = require('electron');
const path = require('path');
const fs = require('fs');

const SERVICOS = {
  pokeidle: { hosts: ['pokeidle.io'] },
  twitch: { hosts: ['www.twitch.tv', 'twitch.tv'] },
  kick: { hosts: ['kick.com'] }
};
const VAZIO = () => [0, 1, 2, 3].map(() => ({ pokeidle: null, twitch: null, kick: null }));

const arquivo = () => path.join(app.getPath('userData'), 'credenciais.json');

function ler() {
  try {
    const dados = JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
    return Array.isArray(dados) && dados.length === 4 ? dados : VAZIO();
  } catch {
    return VAZIO();
  }
}

function gravar(dados) {
  fs.mkdirSync(path.dirname(arquivo()), { recursive: true });
  fs.writeFileSync(arquivo(), JSON.stringify(dados, null, 2));
}

function listar() {
  return ler().map((conta) => Object.fromEntries(Object.keys(SERVICOS).map((s) => [
    s, conta[s] ? { usuario: conta[s].usuario, temSenha: Boolean(conta[s].senha) } : null
  ])));
}

function salvar(i, servico, usuario, senha) {
  if (!SERVICOS[servico] || !(i >= 0 && i < 4)) throw new Error('Conta ou serviço inválido.');
  const dados = ler();
  const atual = dados[i][servico] || {};
  let senhaCript = atual.senha || null;
  if (senha) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('A criptografia do sistema não está disponível; a senha não foi salva.');
    // No Linux sem chaveiro (GNOME Keyring, KWallet), o Electron cai num modo "texto puro": não salva a senha assim.
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      throw new Error('Não achei um chaveiro do sistema (GNOME Keyring ou KWallet); a senha não foi salva. Instale um (ex.: gnome-keyring) ou faça o login à mão.');
    }
    senhaCript = safeStorage.encryptString(senha).toString('base64');
  }
  dados[i][servico] = { usuario: String(usuario || '').trim(), senha: senhaCript };
  gravar(dados);
}

function apagar(i, servico) {
  const dados = ler();
  if (dados[i]) dados[i][servico] = null;
  gravar(dados);
}

// Roda dentro da página de login: acha o campo de senha visível e o campo de usuário antes dele,
// e preenche do jeito que React/Vue enxergam. Na Kick, abre o modal de login se ele ainda não abriu.
function scriptPreencher(usuario, senha, servico) {
  return `(() => {
    const visivel = (e) => e && e.offsetParent !== null && !e.disabled;
    const definir = (campo, valor) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      campo.focus();
      setter.call(campo, valor);
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      campo.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const senha = [...document.querySelectorAll('input[type=password]')].find(visivel);
    if (!senha) {
      if (${JSON.stringify(servico)} === 'kick') {
        const bt = [...document.querySelectorAll('button')].find((b) => visivel(b) && /^(log ?in|entrar)$/i.test(b.textContent.trim()));
        if (bt) bt.click();
      }
      return 'sem-formulario';
    }
    const candidatos = [...document.querySelectorAll('input[type=email], input[type=text], input:not([type])')].filter(visivel);
    let usuario = null;
    for (const c of candidatos) if (c.compareDocumentPosition(senha) & Node.DOCUMENT_POSITION_FOLLOWING) usuario = c;
    if (usuario) definir(usuario, ${JSON.stringify(usuario)});
    definir(senha, ${JSON.stringify(senha)});
    return 'ok';
  })()`;
}

async function preencher(idWebContents, i, servico) {
  const cred = ler()[i] && ler()[i][servico];
  if (!cred || !cred.senha) return { ok: false, motivo: 'Nenhuma senha salva para esse login.' };
  const wc = webContents.fromId(idWebContents);
  if (!wc) return { ok: false, motivo: 'Janela de login não encontrada.' };

  // A senha só vai para o site do próprio serviço.
  const permitido = () => {
    try { return SERVICOS[servico].hosts.includes(new URL(wc.getURL()).hostname); } catch { return false; }
  };
  const senha = safeStorage.decryptString(Buffer.from(cred.senha, 'base64'));

  // O formulário pode demorar a aparecer: tenta por até 20 s.
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    if (wc.isDestroyed()) return { ok: false, motivo: 'A janela foi fechada.' };
    if (permitido()) {
      const r = await wc.executeJavaScript(scriptPreencher(cred.usuario, senha, servico)).catch(() => 'erro');
      if (r === 'ok') return { ok: true };
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  return { ok: false, motivo: 'Não achei o formulário de login na página. Se você já está logado, está tudo certo.' };
}

module.exports = { listar, salvar, apagar, preencher, scriptPreencher };
