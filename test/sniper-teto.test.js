'use strict';

// Sniper: a regra de item com teto em Coins (maxGold) e em Gemas (maxGemas). Quando chega o resumo do
// mercado (aba 'itens'), o motor pede os anúncios do item só se o menor preço estiver no teto.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { criarMotor } = require('./harness/motor');

// Regra de item pelo id do item (70013 = Bicycle Fragment), com teto de 1.000 Coins e sem teto em Gemas.
const regraBike = (extra = {}) => ({
  id: 'r1', ativa: true, tipo: 'item', alvo: 'Bicycle Fragment', itemId: 70013,
  maxGold: 1000, maxGemas: 0, maxQtd: 0, compradas: 0, ...extra
});

const resumo = (minGold, minOrb = 0) => ({ 70013: { minGold, minOrb, anuncios: 3, unidades: 10 } });

// Liga o sniper com as regras e recebe o resumo do mercado.
async function comResumo(regras, res, { ativo = true } = {}) {
  const m = await criarMotor();
  m.comando({ tipo: 'sniper', ativo, regras, margemMs: 800, varreduraSeg: 20 });
  m.pacote({ t: 'market', aba: 'itens', resumo: res });
  return m;
}

const pedidosDeItem = (m) => m.enviadosDo('market.item');

describe('Sniper: teto da regra de item em Coins e Gemas', () => {
  test('pede o item em Coins quando o menor anúncio está abaixo do teto', async () => {
    const m = await comResumo([regraBike()], resumo(900));
    assert.deepEqual(pedidosDeItem(m), [{ t: 'market.item', itemId: 70013, moeda: 'gold' }]);
  });

  test('no teto exato também pede (o limite é <=)', async () => {
    const m = await comResumo([regraBike()], resumo(1000));
    assert.deepEqual(pedidosDeItem(m), [{ t: 'market.item', itemId: 70013, moeda: 'gold' }]);
  });

  test('não pede o item quando o menor anúncio passa do teto', async () => {
    const m = await comResumo([regraBike()], resumo(1001));
    assert.deepEqual(pedidosDeItem(m), []);
  });

  test('não pede em Gemas quando o teto de Gemas é 0, mesmo com anúncio barato em Gemas', async () => {
    const m = await comResumo([regraBike({ maxGemas: 0 })], resumo(5000, 2));
    assert.deepEqual(pedidosDeItem(m), []);
  });

  test('pede em Gemas quando o teto de Gemas está definido e o menor anúncio cabe nele', async () => {
    const m = await comResumo([regraBike({ maxGemas: 10 })], resumo(5000, 7));
    assert.deepEqual(pedidosDeItem(m), [{ t: 'market.item', itemId: 70013, moeda: 'orb' }]);
  });

  test('pede as duas moedas quando os dois tetos cabem', async () => {
    const m = await comResumo([regraBike({ maxGemas: 10 })], resumo(900, 7));
    assert.deepEqual(pedidosDeItem(m), [
      { t: 'market.item', itemId: 70013, moeda: 'gold' },
      { t: 'market.item', itemId: 70013, moeda: 'orb' }
    ]);
  });

  test('sem anúncio do item (menor preço zero) não pede nada', async () => {
    const m = await comResumo([regraBike()], resumo(0));
    assert.deepEqual(pedidosDeItem(m), []);
  });

  test('com o sniper desligado o resumo do mercado não gera pedido', async () => {
    const m = await comResumo([regraBike()], resumo(900), { ativo: false });
    assert.deepEqual(pedidosDeItem(m), []);
  });

  test('regra desativada não pede o item', async () => {
    const m = await comResumo([regraBike({ ativa: false })], resumo(900));
    assert.deepEqual(pedidosDeItem(m), []);
  });
});
