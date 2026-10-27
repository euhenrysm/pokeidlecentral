// Só age quando o PokéIdle Central tem um pedido de "Entrar pelo navegador" esperando para este site.
// O pedido vem do link (#pcentral=...) ou, se o link perdeu essa parte, perguntando ao app no próprio PC.
// Nada é enviado sem o clique em "Autorizar".
(async () => {
  const site = location.hostname.replace(/^www\./, '');
  let porta, codigo, conta;
  const m = /pcentral=(\d{2,5}):([a-f0-9]{32,64}):([1-4])/.exec(location.hash);
  if (m) {
    [, porta, codigo, conta] = m;
    // Tira o código do endereço antes que o site o veja ou o salve no histórico.
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    const r = await chrome.runtime.sendMessage({ tipo: 'consultarPedido', site }).catch(() => null);
    if (!r || !r.ok) return;
    ({ porta, codigo, conta } = r);
  }

  function mostrar() {
    const caixa = document.createElement('div');
    caixa.style.cssText = [
      'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)', 'z-index:2147483647',
      'background:#1a1d27', 'color:#e6e8ef', 'border:2px solid #f5c542', 'border-radius:10px',
      'padding:14px 18px', 'font:14px/1.4 Segoe UI,sans-serif', 'box-shadow:0 8px 30px #0008', 'max-width:460px'
    ].join(';');
    const titulo = document.createElement('div');
    titulo.style.cssText = 'font-weight:700;margin-bottom:6px';
    titulo.textContent = `Autorizar o PokéIdle Central (Conta ${conta})?`;
    const texto = document.createElement('div');
    texto.textContent = `A sessão de ${site} deste navegador será copiada para a Conta ${conta} do app, no seu PC. ` +
      'Faça login aqui antes, se ainda não estiver logado.';
    const mover = document.createElement('label');
    mover.style.cssText = 'display:flex;gap:6px;margin:10px 0;align-items:center';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    mover.append(chk, 'Depois, tirar a sessão deste navegador (sem sair da conta), para logar outra conta aqui');
    const status = document.createElement('div');
    status.style.cssText = 'margin-top:8px;color:#9aa1b4';
    const botoes = document.createElement('div');
    botoes.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    const btSim = document.createElement('button');
    btSim.textContent = 'Autorizar';
    const btNao = document.createElement('button');
    btNao.textContent = 'Cancelar';
    for (const b of [btSim, btNao]) {
      b.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid #2e3344;background:#222634;color:#e6e8ef;cursor:pointer';
    }
    btSim.style.borderColor = '#f5c542';
    btNao.onclick = () => caixa.remove();
    btSim.onclick = async () => {
      btSim.disabled = true;
      status.textContent = 'Enviando…';
      const armazenamento = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          armazenamento[k] = localStorage.getItem(k);
        }
      } catch { /* sem acesso ao localStorage: vão só os cookies */ }
      const r = await chrome.runtime.sendMessage({
        tipo: 'enviarSessao', porta: Number(porta), codigo, conta: Number(conta), site, armazenamento, mover: chk.checked
      });
      status.textContent = r && r.ok
        ? 'Pronto! A sessão foi para o app. Pode fechar esta aba.' + (chk.checked ? ' (Não clique em "Sair" na conta: isso desconectaria o app também.)' : '')
        : `Não deu certo: ${(r && r.motivo) || 'erro desconhecido'}`;
      if (!(r && r.ok)) btSim.disabled = false;
    };
    botoes.append(btNao, btSim);
    caixa.append(titulo, texto, mover, botoes, status);
    document.documentElement.append(caixa);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mostrar, { once: true });
  else mostrar();
})();
