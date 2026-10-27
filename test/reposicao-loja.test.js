'use strict';

// Reposição na loja (aba Captura): quando a poção escolhida fica abaixo do limite, o motor compra na loja
// do jogo por Coins ({ t: 'shop.buy', kind, id, qty }). Só compra com Coins para o lote inteiro, não pede
// de novo enquanto o pedido está pendente, confirma quando o estoque sobe e respeita o limite da sessão.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { criarMotor } = require('./harness/motor');

// Golden Potion: id 70070, 2.500 Coins por unidade (tabela POCOES_LOJA do motor).
const GOLDEN = 70070;
const PRECO_GOLDEN = 2500;

async function comReposicaoDePocao({ id = GOLDEN, abaixoDe = 50, qtd = 10, limite = 0, estoque = 3, gold = 30_000 } = {}) {
  const m = await criarMotor();
  m.comando({
    tipo: 'captura', ativo: false, modo: 'capturar', ballId: 1,
    reposicao: { pocao: { ativo: true, id, abaixoDe, qtd, limite } }
  });
  m.pacote({ t: 'estado', gold, items: { [id]: estoque } });
  return m;
}

const compras = (m) => m.enviadosDo('shop.buy');
const reposicaoPocao = (m) => m.ultimoStatus().captura.reposicao.pocao;

describe('Reposição na loja: poção', () => {
  test('compra o lote na loja quando o estoque está abaixo do limite e há Coins', async () => {
    const m = await comReposicaoDePocao();
    m.avancar(3000);
    assert.deepEqual(compras(m), [{ t: 'shop.buy', kind: 'item', id: GOLDEN, qty: 10 }]);
  });

  test('não compra com o estoque no limite ou acima dele', async () => {
    const m = await comReposicaoDePocao({ estoque: 50 });
    m.avancar(9000);
    assert.deepEqual(compras(m), []);
  });

  test('sem Coins para o lote inteiro não envia nada e deixa o aviso (Golden Potion custa 2.500 cada)', async () => {
    const m = await comReposicaoDePocao({ gold: 10 * PRECO_GOLDEN - 1 });
    m.avancar(3000);
    assert.deepEqual(compras(m), []);
    assert.match(reposicaoPocao(m).aviso, /Sem Coins para 10× Golden Potion/);
  });

  test('com Coins exatamente iguais ao custo do lote, compra', async () => {
    const m = await comReposicaoDePocao({ gold: 10 * PRECO_GOLDEN });
    m.avancar(3000);
    assert.equal(compras(m).length, 1);
  });

  test('não pede de novo enquanto o pedido anterior está pendente', async () => {
    const m = await comReposicaoDePocao();
    m.avancar(3000);
    m.avancar(15_000); // o estoque não subiu ainda
    assert.equal(compras(m).length, 1);
    assert.equal(reposicaoPocao(m).pendente, true);
  });

  test('confirma a compra quando o estoque sobe, e registra no histórico em Coins', async () => {
    const m = await comReposicaoDePocao();
    m.avancar(3000);
    m.pacote({ t: 'estado', items: { [GOLDEN]: 13 } });
    m.avancar(3000);
    const r = reposicaoPocao(m);
    assert.equal(r.compras, 1);
    assert.equal(r.pendente, false);
    assert.deepEqual(r.ultima && { qtd: r.ultima.qtd }, { qtd: 10 });
    const registro = m.postagensDo('compra').at(-1);
    assert.equal(registro.total, 10 * PRECO_GOLDEN);
    assert.equal(registro.moeda, 'gold');
    assert.equal(compras(m).length, 1, 'confirmar não manda outro pedido');
  });

  test('respeita o limite de compras da sessão (0 = sem limite)', async () => {
    const m = await comReposicaoDePocao({ limite: 1 });
    m.avancar(3000);
    m.pacote({ t: 'estado', items: { [GOLDEN]: 13 } });
    m.avancar(3000); // confirma a 1ª compra
    m.pacote({ t: 'estado', items: { [GOLDEN]: 3 } }); // consumiu de novo
    m.avancar(30_000);
    assert.equal(compras(m).length, 1);
    assert.match(reposicaoPocao(m).aviso, /Limite de 1 compra\(s\) nesta sessão atingido/);
  });

  test('sem a loja confirmar em 20 s, libera uma nova tentativa', async () => {
    const m = await comReposicaoDePocao();
    m.avancar(3000); // primeiro pedido
    m.avancar(20_000);
    assert.equal(compras(m).length, 1, 'ainda dentro da janela de 20 s');
    m.avancar(4000);
    assert.equal(compras(m).length, 2, 'depois dos 20 s, tenta de novo');
  });

  // ATENÇÃO: no caminho de reserva (sem o estado completo, que é o que o jogo usa), o motor lê o
  // estoque de itensInventario, que só guarda o que veio em "items". Poção zerada, que o jogo deixa
  // de mandar no bloco de itens, fica "não lida" e a reposição não dispara. O comentário em
  // estoqueDe() diz que item ausente deveria valer 0, o que só vale no caminho do estado completo.
  // Este teste descreve o comportamento atual; se o motor for corrigido, inverta a expectativa.
  test('ATENÇÃO: no caminho de reserva, poção ausente do bloco de itens não dispara a reposição', async () => {
    const m = await criarMotor();
    m.comando({ tipo: 'captura', ativo: false, modo: 'capturar', ballId: 1,
      reposicao: { pocao: { ativo: true, id: GOLDEN, abaixoDe: 50, qtd: 10, limite: 0 } } });
    m.pacote({ t: 'estado', gold: 30_000, items: {} });
    m.avancar(9000);
    assert.deepEqual(compras(m), []);
  });
});
