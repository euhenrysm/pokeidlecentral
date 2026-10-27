'use strict';

// Drops raros do Dashboard (tel.drops no status). A classificação é pelo id do item quando ele existe
// (70011 chave, 70012 Shiny Stone, 70013 bicicleta, 70017 ovo shiny) e, sem id, pelo nome em inglês sem
// acento. "Mega Shiny Stone Fragment" é fragmento de Mega Stone e não conta em Shiny Stone.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { criarMotor } = require('./harness/motor');

// Lê os contadores de drops do status (postado a cada 3 s, por isso o avancar antes).
async function dropsDepois(eventos) {
  const m = await criarMotor();
  m.pacote({ t: 'batalha', ev: eventos });
  m.avancar(3000);
  return m.ultimoStatus().tel.drops;
}

// Abate de pokémon selvagem com os drops informados (é assim que o jogo manda os drops do abate).
const abate = (drops) => ({ k: 'morte', quem: 'selvagem', slot: 1, xpTreinador: 0, drops });

describe('Drops raros: classificação no Dashboard', () => {
  test('Bicycle Fragment (id 70013) conta em bike', async () => {
    const drops = await dropsDepois([abate([{ itemId: 70013, nome: 'Bicycle Fragment', qtd: 1 }])]);
    assert.equal(drops.bike, 1);
    assert.equal(drops.shinyStone, 0);
  });

  test('id 70012 conta em shinyStone', async () => {
    const drops = await dropsDepois([abate([{ itemId: 70012, nome: 'Shiny Stone Fragment', qtd: 2 }])]);
    assert.equal(drops.shinyStone, 2);
    assert.equal(drops.bike, 0);
  });

  test('"Mega Shiny Stone Fragment" sem id NÃO conta em shinyStone', async () => {
    const drops = await dropsDepois([abate([{ nome: 'Mega Shiny Stone Fragment', qtd: 1 }])]);
    assert.equal(drops.shinyStone, 0);
  });

  test('"Mega Shiny Stone Fragment" com id 70012 conta pelo id (o id tem prioridade sobre o nome)', async () => {
    const drops = await dropsDepois([abate([{ itemId: 70012, nome: 'Mega Shiny Stone Fragment', qtd: 1 }])]);
    assert.equal(drops.shinyStone, 1);
  });

  test('"Shiny Stone Fragment" sem id conta em shinyStone pelo nome', async () => {
    const drops = await dropsDepois([abate([{ nome: 'Shiny Stone Fragment', qtd: 3 }])]);
    assert.equal(drops.shinyStone, 3);
  });

  test('bicicleta pelo nome, sem id, conta em bike', async () => {
    const drops = await dropsDepois([abate([{ nome: 'Fragmento de Bicicleta', qtd: 1 }])]);
    assert.equal(drops.bike, 1);
  });

  test('o evento de drop solto (k: "drop") também é classificado pelo id', async () => {
    const drops = await dropsDepois([{ k: 'drop', itemId: 70013, qtd: 2 }]);
    assert.equal(drops.bike, 2);
  });

  test('Boss Token e Fragmento de Chave pelo nome vão para as suas contagens', async () => {
    const drops = await dropsDepois([abate([
      { nome: 'Bronze Boss Token', qtd: 1 },
      { itemId: 70011, nome: 'Key Fragment', qtd: 4 }
    ])]);
    assert.equal(drops.boss, 1);
    assert.equal(drops.chave, 4);
  });
});
