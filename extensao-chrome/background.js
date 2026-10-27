// Lê os cookies do site autorizado e entrega ao PokéIdle Central, só no próprio PC (127.0.0.1).
const DOMINIOS = {
  'pokeidle.io': ['pokeidle.io'],
  'twitch.tv': ['twitch.tv'],
  'kick.com': ['kick.com']
};

const PORTAS = [47731, 47732, 47733, 47734, 47735];

// Pergunta ao app (no próprio PC) se há um pedido esperando para este site.
async function consultar(site) {
  if (!DOMINIOS[site]) return { ok: false };
  for (const porta of PORTAS) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/pedido?site=${encodeURIComponent(site)}`).then((x) => x.json());
      if (r && r.ok) return { ok: true, porta, codigo: r.codigo, conta: r.conta };
    } catch { /* app fechado ou porta de outro programa */ }
  }
  return { ok: false };
}

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  if (msg && msg.tipo === 'consultarPedido') {
    consultar(msg.site).then(responder, () => responder({ ok: false }));
    return true;
  }
  if (!msg || msg.tipo !== 'enviarSessao') return;
  enviar(msg, sender).then(responder, (err) => responder({ ok: false, motivo: err.message }));
  return true;
});

async function enviar(msg, sender) {
  const origem = sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname.replace(/^www\./, '') : '';
  if (!DOMINIOS[msg.site] || origem !== msg.site) throw new Error('Site não autorizado.');
  if (!(msg.porta > 1023 && msg.porta < 65536)) throw new Error('Porta inválida.');

  const cookies = [];
  for (const dominio of DOMINIOS[msg.site]) cookies.push(...await chrome.cookies.getAll({ domain: dominio }));
  if (!cookies.length) throw new Error('Nenhuma sessão encontrada: faça login neste site primeiro.');

  const res = await fetch(`http://127.0.0.1:${msg.porta}/sessao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      codigo: msg.codigo,
      conta: msg.conta,
      site: msg.site,
      armazenamento: msg.site === 'pokeidle.io' ? msg.armazenamento : {},
      cookies: cookies.map((c) => ({
        name: c.name, value: c.value, domain: c.domain, hostOnly: c.hostOnly, path: c.path,
        secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: c.expirationDate
      }))
    })
  }).catch(() => { throw new Error('O app não respondeu. Ele está aberto?'); });
  const r = await res.json().catch(() => ({ ok: false, motivo: `HTTP ${res.status}` }));
  if (!r.ok) throw new Error(r.motivo || 'recusado pelo app');

  if (msg.mover) {
    // Tira a sessão daqui sem "Sair": sair encerraria a sessão no servidor e desconectaria o app junto.
    for (const c of cookies) {
      const host = c.domain.replace(/^\./, '');
      await chrome.cookies.remove({ url: `https://${host}${c.path}`, name: c.name }).catch(() => {});
    }
  }
  return { ok: true };
}
