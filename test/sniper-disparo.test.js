'use strict';

// Sniper: o disparo. O anúncio retido libera no horário do SERVIDOR (compravelEm); o motor manda
// market.comprar margemMs depois, medindo com o desvio do relógio (servidorAgora). Uma vez por anúncio,
// e a quantidade respeita o saldo e o limite de unidades da regra.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { criarMotor } = require('./harness/motor');

const MARGEM = 800;

const regraPokemon = (extra = {}) => ({ id: 'p1', ativa: true, tipo: 'pokemon', maxGold: 2000, maxGemas: 0, maxQtd: 0, compradas: 0, ...extra });
const regraItem = (extra = {}) => ({ id: 'i1', ativa: true, tipo: 'item', itemId: 70013, maxGold: 100, maxGemas: 0, maxQtd: 0, compradas: 0, ...extra });

// Pokémon à venda, retido até compravelEm (horário do servidor).
const anuncioPokemon = (compravelEm = 0) => ({
  id: 9001, tipo: 'pokemon', ficha: { speciesId: 25, nome: 'Pikachu', level: 50 },
  preco: 1000, moeda: 'gold', qtd: 1, compravelEm, estado: 'aberto'
});
// Item à venda em lote (10 unidades a 100 Coins cada). Sem compravelEm: a compra é direta.
const anuncioItem = (qtd = 10) => ({
  id: 9002, tipo: 'item', itemId: 70013, ficha: { nome: 'Bicycle Fragment' },
  preco: 100, moeda: 'gold', qtd, estado: 'aberto'
});

// Liga o sniper, informa o saldo e o relógio do servidor (o computador pode estar adiantado ou atrasado).
async function sniperLigado({ regras, saldo = 10_000, desvio = 0 }) {
  const m = await criarMotor();
  m.comando({ tipo: 'sniper', ativo: true, regras, margemMs: MARGEM, varreduraSeg: 20 });
  m.pacote({ t: 'estado', servidorAgora: m.agora() - desvio, gold: saldo });
  return m;
}

const comprasDo = (m) => m.enviadosDo('market.comprar');

describe('Sniper: disparo no horário da liberação', () => {
  test('dispara market.comprar margemMs depois da liberação, pelo relógio do servidor', async () => {
    const desvio = 5000; // o computador está 5 s adiantado em relação ao servidor
    const m = await sniperLigado({ regras: [regraPokemon()], desvio });
    // Liberação daqui a 60 s no relógio do servidor (= 60 s também no relógio do computador).
    const liberacao = m.agora() - desvio + 60_000;
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncioPokemon(liberacao)] });
    m.comando({ tipo: 'reivindicacao', id: 9001, ok: true });

    m.avancar(60_000 + MARGEM - 1);
    assert.equal(comprasDo(m).length, 0, 'não dispara antes da margem');
    m.avancar(1);
    assert.deepEqual(comprasDo(m), [{ t: 'market.comprar', id: 9001, qtd: 1, preco: 1000, moeda: 'gold' }]);
  });

  test('com o computador atrasado, a conta usa o horário do servidor (e não o do computador)', async () => {
    const desvio = -3000; // o servidor está 3 s adiantado em relação ao computador
    const m = await sniperLigado({ regras: [regraPokemon()], desvio });
    // compravelEm é um horário do SERVIDOR: 10 s depois do computador, que pelo relógio do servidor
    // (3 s adiantado) cai 7 s daqui a pouco no computador.
    const liberacao = m.agora() + 10_000;
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncioPokemon(liberacao)] });
    m.comando({ tipo: 'reivindicacao', id: 9001, ok: true });

    m.avancar(7_000 + MARGEM - 1);
    assert.equal(comprasDo(m).length, 0);
    m.avancar(1);
    assert.equal(comprasDo(m).length, 1, 'dispara 7,8 s depois, e não 10,8 s como um relógio local daria');
  });

  // Margem 0 vale de verdade: o disparo sai no instante da liberação (antes, 0 virava 800 ms).
  test('margem 0 dispara no instante da liberação', async () => {
    const m = await criarMotor();
    m.comando({ tipo: 'sniper', ativo: true, regras: [regraPokemon()], margemMs: 0, varreduraSeg: 20 });
    m.pacote({ t: 'estado', servidorAgora: m.agora(), gold: 10_000 });
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncioPokemon(m.agora() + 10_000)] });
    m.comando({ tipo: 'reivindicacao', id: 9001, ok: true });
    m.avancar(9_999);
    assert.equal(comprasDo(m).length, 0);
    m.avancar(1);
    assert.equal(comprasDo(m).length, 1);
  });

  test('dispara uma única vez por anúncio, mesmo com o anúncio chegando de novo na varredura', async () => {
    const m = await sniperLigado({ regras: [regraPokemon()] });
    const liberacao = m.agora() + 30_000;
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncioPokemon(liberacao)] });
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncioPokemon(liberacao)] });
    m.comando({ tipo: 'reivindicacao', id: 9001, ok: true });
    m.avancar(120_000);
    assert.equal(comprasDo(m).length, 1);
    assert.equal(m.postagensDo('reivindicar').length, 1, 'só uma reivindicação por anúncio');
  });

  test('a quantidade do item respeita o saldo em Coins', async () => {
    const m = await sniperLigado({ regras: [regraItem()], saldo: 350 });
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncioItem(10)] });
    m.comando({ tipo: 'reivindicacao', id: 9002, ok: true });
    assert.deepEqual(comprasDo(m), [{ t: 'market.comprar', id: 9002, qtd: 3, preco: 100, moeda: 'gold' }]);
  });

  test('a quantidade do item respeita o limite de unidades da regra (maxQtd - compradas)', async () => {
    const m = await sniperLigado({ regras: [regraItem({ maxQtd: 4, compradas: 1 })] });
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncioItem(10)] });
    m.comando({ tipo: 'reivindicacao', id: 9002, ok: true });
    assert.equal(comprasDo(m)[0].qtd, 3);
  });

  test('regra que já atingiu o limite de unidades nem pede a reivindicação', async () => {
    const m = await sniperLigado({ regras: [regraPokemon({ maxQtd: 1, compradas: 1 })] });
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncioPokemon(0)] });
    assert.deepEqual(m.postagensDo('reivindicar'), []);
    assert.deepEqual(comprasDo(m), []);
  });

  test('saldo que não cobre nem uma unidade não compra e deixa aviso no registro', async () => {
    const m = await sniperLigado({ regras: [regraItem()], saldo: 50 });
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncioItem(10)] });
    m.comando({ tipo: 'reivindicacao', id: 9002, ok: true });
    assert.deepEqual(comprasDo(m), []);
    const aviso = m.postagensDo('log').find((l) => l.nivel === 'aviso' && /saldo ou limite/.test(l.msg));
    assert.ok(aviso, 'avisa que o saldo não deu');
  });

  // O saldo fica reservado para as compras que ainda vão sair: com 1.500 Coins e dois anúncios de 1.000 na
  // mesma varredura, só o primeiro é disputado (antes os dois eram pedidos, somando 2.000).
  test('dois anúncios na mesma varredura dividem o saldo (1.500 Coins, dois de 1.000: só um)', async () => {
    const m = await sniperLigado({ regras: [regraPokemon()], saldo: 1500 });
    const outro = { ...anuncioPokemon(0), id: 9003 };
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncioPokemon(0), outro] });
    m.comando({ tipo: 'reivindicacao', id: 9001, ok: true });
    m.comando({ tipo: 'reivindicacao', id: 9003, ok: true });
    assert.deepEqual(comprasDo(m).map((c) => c.id), [9001]);
    assert.ok(m.postagensDo('log').some((l) => l.nivel === 'aviso' && /saldo ou limite/.test(l.msg)), 'o segundo avisa saldo');
  });

  test('o saldo reservado volta depois de 20 s sem confirmação do disparo', async () => {
    const m = await sniperLigado({ regras: [regraPokemon()], saldo: 1500 });
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncioPokemon(0)] });
    m.comando({ tipo: 'reivindicacao', id: 9001, ok: true });
    m.avancar(21_000);
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [{ ...anuncioPokemon(0), id: 9004 }] });
    m.comando({ tipo: 'reivindicacao', id: 9004, ok: true });
    assert.deepEqual(comprasDo(m).map((c) => c.id), [9001, 9004]);
  });

  test('desligar o sniper antes da liberação cancela o disparo agendado', async () => {
    const m = await sniperLigado({ regras: [regraPokemon()] });
    m.pacote({ t: 'market', aba: 'anuncios', anuncios: [anuncioPokemon(m.agora() + 60_000)] });
    m.comando({ tipo: 'reivindicacao', id: 9001, ok: true });
    m.avancar(10_000);
    m.comando({ tipo: 'sniper', ativo: false, regras: [regraPokemon()], margemMs: MARGEM });
    m.avancar(120_000);
    assert.deepEqual(comprasDo(m), []);
  });
});
