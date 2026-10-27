'use strict';

// Sniper: a central é o árbitro entre as contas. Antes de comprar, o motor pede a reivindicação do
// anúncio (postagem 'reivindicar'). Só dispara quando a central responde { tipo: 'reivindicacao', ok: true }.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { criarMotor } = require('./harness/motor');

const regra = { id: 'p1', ativa: true, tipo: 'pokemon', maxGold: 2000, maxGemas: 0, maxQtd: 0, compradas: 0 };
// Anúncio sem compravelEm: a compra sai na hora em que a central confirma.
const anuncio = { id: 9001, tipo: 'pokemon', ficha: { speciesId: 25, nome: 'Pikachu', level: 50 }, preco: 1000, moeda: 'gold', qtd: 1, estado: 'aberto' };

async function comAnuncioAguardando() {
  const m = await criarMotor();
  m.comando({ tipo: 'sniper', ativo: true, regras: [regra], margemMs: 800 });
  m.pacote({ t: 'estado', gold: 10_000 });
  m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncio] });
  return m;
}

const comprasDo = (m) => m.enviadosDo('market.comprar');

describe('Sniper: árbitro entre contas (reivindicação à central)', () => {
  test('pede a reivindicação do anúncio à central e não compra antes da resposta', async () => {
    const m = await comAnuncioAguardando();
    assert.deepEqual(m.postagensDo('reivindicar'), [{ id: 9001 }]);
    m.avancar(10_000);
    assert.deepEqual(comprasDo(m), []);
  });

  test('compra quando a central confirma a reivindicação (ok: true)', async () => {
    const m = await comAnuncioAguardando();
    m.comando({ tipo: 'reivindicacao', id: 9001, ok: true });
    assert.deepEqual(comprasDo(m), [{ t: 'market.comprar', id: 9001, qtd: 1, preco: 1000, moeda: 'gold' }]);
  });

  test('não compra quando outra conta já tem o anúncio (ok: false)', async () => {
    const m = await comAnuncioAguardando();
    m.comando({ tipo: 'reivindicacao', id: 9001, ok: false });
    m.avancar(120_000);
    assert.deepEqual(comprasDo(m), []);
    const log = m.postagensDo('log').find((l) => /outra conta sua já está neste anúncio/.test(l.msg));
    assert.ok(log, 'registra que esta conta ficou de fora');
  });

  test('depois de perder a reivindicação, o mesmo anúncio não é pedido de novo', async () => {
    const m = await comAnuncioAguardando();
    m.comando({ tipo: 'reivindicacao', id: 9001, ok: false });
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncio] });
    assert.equal(m.postagensDo('reivindicar').length, 1);
    assert.deepEqual(comprasDo(m), []);
  });

  test('resposta da central para um anúncio que não está pendente é ignorada', async () => {
    const m = await comAnuncioAguardando();
    m.comando({ tipo: 'reivindicacao', id: 123456, ok: true });
    assert.deepEqual(comprasDo(m), []);
  });
});
