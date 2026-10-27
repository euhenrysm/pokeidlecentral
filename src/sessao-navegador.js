// "Entrar pelo navegador": abre o site no navegador do usuário (onde ele já está logado) e espera a
// extensão "PokéIdle Central - Autorizar sessão" devolver a sessão daquele site, com a autorização dele.
const http = require('http');
const crypto = require('crypto');
const { session, shell } = require('electron');
const navegadores = require('./navegadores');

const SITES = {
  pokeidle: { host: 'pokeidle.io', url: 'https://pokeidle.io/app' },
  twitch: { host: 'twitch.tv', url: 'https://www.twitch.tv/' },
  kick: { host: 'kick.com', url: 'https://kick.com/' }
};
const VALIDADE_MS = 5 * 60_000;
// Portas fixas: a extensão procura o app nelas, sem depender do código ir junto no link.
const PORTAS = [47731, 47732, 47733, 47734, 47735];
const LIMITE_CORPO = 2 * 1024 * 1024;

let servidor = null;
let porta = 0;
const pedidos = new Map(); // codigo -> { conta, servico, expira }

function iniciar(particoes, aoReceber) {
  servidor = http.createServer((req, res) => {
    const responder = (status, corpo) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(corpo));
    };
    // Pedido pendente para um site. Sem cabeçalho CORS: páginas da web não conseguem ler a resposta;
    // só a extensão, que tem permissão para 127.0.0.1.
    if (req.method === 'GET' && req.url.startsWith('/pedido')) {
      const site = new URL(req.url, 'http://127.0.0.1').searchParams.get('site');
      let achado = null;
      for (const [codigo, p] of pedidos) {
        if (p.expira > Date.now() && SITES[p.servico].host === site && (!achado || p.criado > achado.criado)) {
          achado = { codigo, conta: p.conta + 1, criado: p.criado };
        }
      }
      return responder(200, achado ? { ok: true, codigo: achado.codigo, conta: achado.conta } : { ok: false });
    }
    if (req.method !== 'POST' || req.url !== '/sessao') return responder(404, { ok: false, motivo: 'não encontrado' });

    let tamanho = 0;
    const partes = [];
    req.on('data', (p) => {
      tamanho += p.length;
      if (tamanho > LIMITE_CORPO) req.destroy();
      else partes.push(p);
    });
    req.on('end', async () => {
      let dados;
      try { dados = JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { return responder(400, { ok: false, motivo: 'pedido inválido' }); }

      const pedido = pedidos.get(String(dados.codigo));
      // Código de uso único: some na primeira tentativa, certa ou errada.
      pedidos.delete(String(dados.codigo));
      if (!pedido || pedido.expira < Date.now()) return responder(403, { ok: false, motivo: 'Código expirado. Clique em "Entrar pelo navegador" de novo no app.' });
      const site = SITES[pedido.servico];
      if (dados.site !== site.host || Number(dados.conta) !== pedido.conta + 1) {
        return responder(403, { ok: false, motivo: 'Site ou conta não conferem com o pedido do app.' });
      }

      try {
        const ses = session.fromPartition(particoes[pedido.conta]);
        let gravados = 0;
        for (const c of Array.isArray(dados.cookies) ? dados.cookies : []) {
          const dominio = String(c.domain || '').replace(/^\./, '');
          // Só aceita cookies do próprio site pedido.
          if (dominio !== site.host && !dominio.endsWith('.' + site.host)) continue;
          await ses.cookies.set({
            url: `https://${dominio}${c.path || '/'}`,
            name: c.name,
            value: c.value,
            domain: c.hostOnly ? undefined : c.domain,
            path: c.path || '/',
            secure: Boolean(c.secure),
            httpOnly: Boolean(c.httpOnly),
            sameSite: ['no_restriction', 'lax', 'strict'].includes(c.sameSite) ? c.sameSite : 'unspecified',
            expirationDate: c.expirationDate
          }).then(() => gravados++, () => {});
        }
        if (!gravados) return responder(400, { ok: false, motivo: 'Nenhum cookie válido recebido.' });
        aoReceber({
          conta: pedido.conta,
          servico: pedido.servico,
          armazenamento: pedido.servico === 'pokeidle' && dados.armazenamento && typeof dados.armazenamento === 'object' ? dados.armazenamento : {}
        });
        responder(200, { ok: true });
      } catch (err) {
        responder(500, { ok: false, motivo: err.message });
      }
    });
  });
  // Só o próprio PC enxerga esta porta. Tenta as portas fixas em ordem, se alguma estiver ocupada.
  const tentar = (n) => {
    servidor.once('error', () => { if (n + 1 < PORTAS.length) tentar(n + 1); });
    servidor.listen(PORTAS[n], '127.0.0.1', () => { porta = servidor.address().port; });
  };
  tentar(0);
}

// `escolha`: o navegador/perfil daquela conta (ver navegadores.js); sem escolha, o padrão do Windows.
function pedir(conta, servico, escolha) {
  if (!SITES[servico] || !(conta >= 0 && conta < 4)) throw new Error('Conta ou serviço inválido.');
  if (!porta) throw new Error('O receptor de sessão ainda não iniciou; tente de novo em um segundo.');
  for (const [c, p] of pedidos) if (p.expira < Date.now()) pedidos.delete(c);
  const codigo = crypto.randomBytes(24).toString('hex');
  pedidos.set(codigo, { conta, servico, expira: Date.now() + VALIDADE_MS, criado: Date.now() });
  const url = `${SITES[servico].url}#pcentral=${porta}:${codigo}:${conta + 1}`;
  if (!navegadores.abrir(escolha, url)) shell.openExternal(url);
}

module.exports = { iniciar, pedir };
