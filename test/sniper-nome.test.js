'use strict';

// Sniper: regra de item escrita só pelo nome (sem itemId). O motor resolve o id pelo catálogo da conta
// (welcome, itensNossos) e, se o item só existir no catálogo público, pelo /assets/items.json.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { criarMotor } = require('./harness/motor');

const regraPeloNome = (alvo) => ({ id: 'n1', ativa: true, tipo: 'item', alvo, maxGold: 1000, maxGemas: 0, maxQtd: 0, compradas: 0 });

const pedidos = (m) => m.enviadosDo('market.item');

describe('Sniper: regra de item pelo nome', () => {
  test('resolve o id pelo catálogo da conta (itensNossos do welcome), sem diferenciar maiúsculas', async () => {
    const m = await criarMotor();
    m.pacote({ t: 'welcome', itensNossos: [{ id: 70013, name: 'Bicycle Fragment', category: 'fragment' }] });
    m.comando({ tipo: 'sniper', ativo: true, regras: [regraPeloNome('BICYCLE fragment')], margemMs: 800 });
    m.pacote({ t: 'market', aba: 'itens', resumo: { 70013: { minGold: 500, minOrb: 0, anuncios: 2, unidades: 4 } } });
    assert.deepEqual(pedidos(m), [{ t: 'market.item', itemId: 70013, moeda: 'gold' }]);
  });

  test('item que só existe no catálogo público resolve pelo /assets/items.json', async () => {
    const m = await criarMotor({ itensPublicos: [{ id: 40530, name: 'AoE TM Disk Piece' }, { id: 1, name: 'Outro' }] });
    m.comando({ tipo: 'sniper', ativo: true, regras: [regraPeloNome('AoE TM Disk Piece')], margemMs: 800 });
    m.pacote({ t: 'market', aba: 'itens', resumo: { 40530: { minGold: 300, minOrb: 0, anuncios: 1, unidades: 1 } } });
    assert.deepEqual(pedidos(m), [{ t: 'market.item', itemId: 40530, moeda: 'gold' }]);
  });

  test('nome que não existe em nenhum catálogo não pede o item, mesmo com anúncio no resumo', async () => {
    const m = await criarMotor({ itensPublicos: [{ id: 40530, name: 'AoE TM Disk Piece' }] });
    m.comando({ tipo: 'sniper', ativo: true, regras: [regraPeloNome('Item Inexistente')], margemMs: 800 });
    m.pacote({ t: 'market', aba: 'itens', resumo: { 40530: { minGold: 300, minOrb: 0, anuncios: 1, unidades: 1 } } });
    assert.deepEqual(pedidos(m), []);
  });

  test('resolve pelo welcome depois de a regra já existir, mesmo sem catálogo público', async () => {
    const m = await criarMotor({ itensPublicos: [] });
    m.comando({ tipo: 'sniper', ativo: true, regras: [regraPeloNome('Bicycle Fragment')], margemMs: 800 });
    m.pacote({ t: 'welcome', itensNossos: [{ id: 70013, name: 'Bicycle Fragment' }] });
    m.pacote({ t: 'market', aba: 'itens', resumo: { 70013: { minGold: 500, minOrb: 0, anuncios: 2, unidades: 4 } } });
    assert.deepEqual(pedidos(m), [{ t: 'market.item', itemId: 70013, moeda: 'gold' }]);
  });
});
