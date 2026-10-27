'use strict';

// Controle pelo celular (motor): a conta manda a lista pronta (hunts, time, depósito e mochila) e confere
// cada ação pedida pela central com o estado antes de mandar a mensagem ao jogo.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { criarMotor } = require('./harness/motor');

// Conta com três hunts (uma liberada, uma bloqueada no nível 10 e o Centro) e o estado informado.
async function comConta({ nivel = 10, huntSlug = null, activeId = null, pokemons = [], items = {}, balls = {}, hunts = HUNTS_PADRAO } = {}) {
  const m = await criarMotor();
  m.pacote({ t: 'welcome', hunts });
  m.pacote({ t: 'estado', level: nivel, huntSlug, activeId, pokemons, items, balls });
  return m;
}

// Sem área nem espécies, o jogo põe a hunt em Hoenn: por isso as hunts de teste dizem a região.
const HUNTS_PADRAO = [
  { slug: 'rota_1', nome: 'Rota 1', nivel: 5, regiao: 'kanto', especies: [] },
  { slug: 'rota_9', nome: 'Rota 9', nivel: 40, regiao: 'kanto', especies: [] },
  { slug: 'centro_pokemon', nome: 'Centro', nivel: 1, regiao: 'kanto', especies: [] }
];

const acao = (m, nome, params = {}, pedido = 1) => m.comando({ tipo: 'acaoJogo', acao: nome, params, pedido });
const resultado = (m) => m.postagensDo('acaoResultado').at(-1);
const pokemons = () => [
  { id: 1, nome: 'Pikachu', level: 12, slot: 1, hp: 30, maxHp: 40, shiny: false },
  { id: 2, nome: 'Bulbasaur', level: 9, slot: null, hp: 20, maxHp: 20, shiny: true }
];

describe('Ações do celular: hunt', () => {
  test('hunt liberada envia hunt.select e registra no Registro', async () => {
    const m = await comConta();
    acao(m, 'hunt', { slug: 'rota_1' });
    assert.deepEqual(m.enviadosDo('hunt.select'), [{ t: 'hunt.select', slug: 'rota_1' }]);
    assert.deepEqual(resultado(m), { pedido: 1, ok: true, motivo: null });
    assert.ok(m.postagensDo('log').some((l) => l.msg === 'Celular: trocou para a hunt Rota 1.'));
  });

  test('hunt bloqueada pelo nível do treinador não envia nada', async () => {
    const m = await comConta({ nivel: 10 });
    acao(m, 'hunt', { slug: 'rota_9' });
    assert.deepEqual(m.enviadosDo('hunt.select'), []);
    assert.equal(resultado(m).ok, false);
    assert.match(resultado(m).motivo, /bloqueada/);
  });

  test('hunt de região trancada é recusada mesmo com o nível da hunt cabendo no treinador', async () => {
    const m = await comConta({ nivel: 10, hunts: [...HUNTS_PADRAO, { slug: 'johto_1', nome: 'Johto 1', nivel: 5, regiao: 'johto', especies: [] }] });
    acao(m, 'hunt', { slug: 'johto_1' });
    assert.deepEqual(m.enviadosDo('hunt.select'), []);
    assert.equal(resultado(m).ok, false);
    assert.match(resultado(m).motivo, /bloqueada/);
  });

  test('hunt que não existe ou já é a atual não envia nada', async () => {
    const m = await comConta({ huntSlug: 'rota_1' });
    acao(m, 'hunt', { slug: 'nao_existe' }, 2);
    acao(m, 'hunt', { slug: 'rota_1' }, 3);
    assert.deepEqual(m.enviadosDo('hunt.select'), []);
    assert.equal(m.postagensDo('acaoResultado').length, 2);
    assert.equal(m.postagensDo('acaoResultado')[1].ok, false);
  });
});

describe('Ações do celular: time', () => {
  test('ativo só para pokémon da equipe', async () => {
    const m = await comConta({ pokemons: pokemons(), activeId: 1 });
    acao(m, 'ativo', { pokemonId: 2 }, 2); // no depósito: recusa
    assert.deepEqual(m.enviadosDo('team.active'), []);
    acao(m, 'ativo', { pokemonId: 1 }, 3); // já é o ativo: recusa
    assert.deepEqual(m.enviadosDo('team.active'), []);

    const outra = await comConta({ pokemons: [{ id: 1, nome: 'A', level: 3, slot: 1 }, { id: 2, nome: 'B', level: 4, slot: 2 }], activeId: 1 });
    acao(outra, 'ativo', { pokemonId: 2 });
    assert.deepEqual(outra.enviadosDo('team.active'), [{ t: 'team.active', pokemonId: 2 }]);
  });

  test('paraTime manda o próximo slot livre e recusa com o time cheio', async () => {
    const m = await comConta({ pokemons: pokemons() });
    acao(m, 'paraTime', { pokemonId: 2 });
    assert.deepEqual(m.enviadosDo('team.move'), [{ t: 'team.move', pokemonId: 2, slot: 2 }]);

    const cheio = [1, 2, 3, 4, 5, 6].map((slot) => ({ id: 100 + slot, nome: 'X', level: 1, slot }));
    const c = await comConta({ pokemons: [...cheio, { id: 2, nome: 'Bulbasaur', level: 9, slot: null }] });
    acao(c, 'paraTime', { pokemonId: 2 });
    assert.deepEqual(c.enviadosDo('team.move'), []);
    assert.match(resultado(c).motivo, /cheio/);
  });
});

describe('Ações do celular: mochila', () => {
  test('usarItem recusa item sem quantidade e usa o que tem', async () => {
    const m = await comConta({ items: { 200: 0 } });
    acao(m, 'usarItem', { itemId: 200 });
    assert.deepEqual(m.enviadosDo('item.use'), []);
    assert.equal(resultado(m).ok, false);

    const c = await comConta({ items: { 200: 3 } });
    acao(c, 'usarItem', { itemId: 200 });
    assert.deepEqual(c.enviadosDo('item.use'), [{ t: 'item.use', itemId: 200 }]);
  });

  test('descartar envia bolsa.descartar com a quantidade', async () => {
    const m = await comConta({ items: { 200: 5 } });
    acao(m, 'descartar', { tipo: 'item', id: 200, qtd: 2 });
    assert.deepEqual(m.enviadosDo('bolsa.descartar'), [{ t: 'bolsa.descartar', tipo: 'item', id: 200, qtd: 2 }]);
  });

  test('descartar recusa quantidade maior que a mochila e bola (valor de tipo ainda não confirmado)', async () => {
    const m = await comConta({ items: { 200: 5 }, balls: { 1: 40 } });
    acao(m, 'descartar', { tipo: 'item', id: 200, qtd: 6 }, 2);
    acao(m, 'descartar', { tipo: 'ball', id: 1, qtd: 1 }, 3);
    assert.deepEqual(m.enviadosDo('bolsa.descartar'), []);
    assert.equal(m.postagensDo('acaoResultado').length, 2);
  });
});

describe('Ações do celular: centro e casos de recusa', () => {
  test('centro e curar mandam as mensagens do Centro Pokémon', async () => {
    const m = await comConta();
    acao(m, 'centro', {}, 1);
    acao(m, 'curar', {}, 2);
    assert.deepEqual(m.enviadosDo('centro.ir'), [{ t: 'centro.ir' }]);
    assert.deepEqual(m.enviadosDo('centro.curar'), [{ t: 'centro.curar' }]);
  });

  test('ação fora da lista é recusada sem mandar nada', async () => {
    const m = await comConta();
    const antes = m.enviados.length;
    acao(m, 'comprar', {});
    assert.equal(resultado(m).ok, false);
    assert.equal(m.enviados.length, antes);
  });

  test('sem conexão com o jogo, a ação volta recusada', async () => {
    const m = await comConta();
    m.fecharConexao();
    acao(m, 'curar', {});
    assert.deepEqual(resultado(m), { pedido: 1, ok: false, motivo: 'Conta sem conexão com o jogo.' });
  });
});

describe('Controle: lista para o celular', () => {
  test('manda hunts, equipe, depósito e mochila, e só de novo quando muda (no máximo a cada 5 s)', async () => {
    const m = await comConta({ nivel: 10, huntSlug: 'rota_1', activeId: 1, pokemons: pokemons(), items: { 200: 3, 201: 0 }, balls: { 1: 40 } });
    m.avancar(1000);
    const [primeiro] = m.postagensDo('controle');
    assert.ok(primeiro, 'a primeira lista sai logo');
    assert.deepEqual(primeiro.hunts.map((h) => [h.slug, h.regiao, h.liberada, h.atual]), [['rota_1', 'kanto', true, true], ['rota_9', 'kanto', false, false]]);
    assert.deepEqual(primeiro.equipe.map((x) => [x.id, x.slot, x.ativo]), [[1, 1, true]]);
    assert.deepEqual(primeiro.deposito, [{ id: 2, nome: 'Bulbasaur', nivel: 9 }]);
    assert.deepEqual(primeiro.mochila.map((x) => [x.tipo, x.id, x.qtd]), [['item', 200, 3], ['ball', 1, 40]]);

    m.avancar(4000); // nada mudou: não manda de novo
    assert.equal(m.postagensDo('controle').length, 1);

    // O primeiro envio saiu em t=1 s: o próximo só pode sair a partir de t=6 s, mesmo com a mudança já feita.
    m.pacote({ t: 'estado', items: { 200: 2 } });
    m.avancar(500); // t=5,5 s
    assert.equal(m.postagensDo('controle').length, 1);
    m.avancar(500); // t=6 s
    assert.equal(m.postagensDo('controle').length, 2);
    assert.equal(m.postagensDo('controle')[1].mochila[0].qtd, 2);
  });

  test('hunts saem por região na ordem do mapa e, dentro dela, do nível mais baixo para o mais alto', async () => {
    const m = await comConta({
      nivel: 200,
      hunts: [
        { slug: 'johto_1', nome: 'Johto 1', nivel: 5, regiao: 'johto', especies: [] },
        { slug: 'rota_9', nome: 'Rota 9', nivel: 40, regiao: 'kanto', especies: [] },
        { slug: 'outland_1', nome: 'Outland 1', nivel: 150, regiao: 'outland', especies: [] },
        { slug: 'rota_1', nome: 'Rota 1', nivel: 5, regiao: 'kanto', especies: [] }
      ]
    });
    m.avancar(1000);
    const [controle] = m.postagensDo('controle');
    assert.deepEqual(controle.hunts.map((h) => h.slug), ['rota_1', 'rota_9', 'outland_1', 'johto_1']);
    assert.ok(controle.hunts.every((h) => h.liberada), 'com nível 200, todas as regiões até Johto estão abertas');
  });

  test('regiões saem na ordem do mapa, com nível e cadeado; a região trancada tranca as hunts dela', async () => {
    const m = await comConta({ nivel: 10, hunts: [...HUNTS_PADRAO, { slug: 'johto_1', nome: 'Johto 1', nivel: 5, regiao: 'johto', especies: [] }] });
    m.avancar(1000);
    const [controle] = m.postagensDo('controle');
    assert.deepEqual(controle.regioes.map((r) => r.id), ['kanto', 'outland', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'paldea']);
    assert.deepEqual(controle.regioes[0], { id: 'kanto', rotulo: 'Kanto', nivel: 1, trancada: false });
    assert.deepEqual(controle.regioes[1], { id: 'outland', rotulo: 'Outland', nivel: 150, trancada: true });
    assert.equal(controle.regioes[2].trancada, true);
    // Johto (nível 200) está trancada: a hunt de nível 5 dela não libera.
    assert.deepEqual(controle.hunts.map((h) => [h.slug, h.liberada]), [['rota_1', true], ['rota_9', false], ['johto_1', false]]);
  });

  test('sem nível lido, nenhuma região fica trancada e todas as hunts liberam', async () => {
    const m = await comConta({ nivel: 0, hunts: [...HUNTS_PADRAO, { slug: 'paldea_1', nome: 'Paldea 1', nivel: 80000, regiao: 'paldea', especies: [] }] });
    m.avancar(1000);
    const [controle] = m.postagensDo('controle');
    assert.ok(controle.regioes.every((r) => r.trancada === false));
    assert.ok(controle.hunts.every((h) => h.liberada === true));
  });

});
