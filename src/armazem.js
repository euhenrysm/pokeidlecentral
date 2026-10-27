// Arquivo JSON da pasta de dados com limite de registros e gravação adiada (debounce).
// Usado pelo histórico de compras e pelo histórico global do mercado: cada um tem o seu arquivo,
// fora do config.json, para a configuração não crescer a cada compra.
const fs = require('fs');
const path = require('path');

// `chave` é o campo que identifica o registro (um registro com a mesma chave é atualizado, não duplicado).
// `limite` mantém só os registros mais recentes (pelo campo `em`). `filtrar` descarta o que não couber mais.
function abrirArmazem(arquivo, { limite, chave = 'uid', tempoGravacaoMs = 1500, filtrar = null }) {
  let itens = [];
  try {
    const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (Array.isArray(bruto)) itens = bruto.filter((x) => x && typeof x === 'object' && x[chave] != null);
  } catch (err) {
    // Arquivo que existe mas não lê: guarda uma cópia antes de começar do zero, para não perder o histórico sem aviso.
    if (err.code !== 'ENOENT') {
      try { fs.renameSync(arquivo, `${arquivo}.corrompido`); } catch { /* sem permissão: segue vazio */ }
    }
  }
  if (filtrar) itens = itens.filter(filtrar);
  itens.sort((a, b) => (Number(b.em) || 0) - (Number(a.em) || 0));

  let agendado = null;
  const gravar = () => {
    agendado = null;
    try {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      const tmp = `${arquivo}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(itens));
      fs.renameSync(tmp, arquivo);
    } catch { /* pasta bloqueada ou disco cheio: o próximo registro tenta de novo */ }
  };
  const agendar = () => {
    if (!agendado) agendado = setTimeout(gravar, tempoGravacaoMs);
  };

  return {
    lista: () => itens,
    // Acrescenta ou atualiza pela chave, mantém os `limite` mais recentes e agenda a gravação.
    adicionar(novos) {
      const mapa = new Map(itens.map((x) => [x[chave], x]));
      for (const n of novos) {
        if (n && typeof n === 'object' && n[chave] != null) mapa.set(n[chave], { ...mapa.get(n[chave]), ...n });
      }
      itens = [...mapa.values()].filter((x) => !filtrar || filtrar(x));
      itens.sort((a, b) => (Number(b.em) || 0) - (Number(a.em) || 0));
      if (itens.length > limite) itens = itens.slice(0, limite);
      agendar();
    },
    // Grava já, se houver alteração pendente (chamado ao fechar o app).
    fechar() {
      if (agendado) { clearTimeout(agendado); gravar(); }
    }
  };
}

module.exports = { abrirArmazem };
