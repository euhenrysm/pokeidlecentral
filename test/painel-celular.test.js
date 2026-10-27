'use strict';

// Painel no celular (servidor): o POST /api/acao exige o código, valida a lista fechada de campos, limita
// o corpo e as ações por segundo, e entrega a ação à central. A lista da aba Controle também é sanitizada.
// Os testes sobem o servidor numa porta livre (sem procurar a rede local) e falam com ele por http do Node.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const painel = require('../src/painel-celular');

function pedir({ porta, metodo = 'POST', caminho = '/api/acao', token, tipo = 'application/json', corpo }) {
  return new Promise((resolve, reject) => {
    const cabec = {};
    if (token) cabec.Authorization = 'Bearer ' + token;
    if (tipo) cabec['Content-Type'] = tipo;
    let dados = null;
    if (corpo !== undefined) {
      dados = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
      cabec['Content-Length'] = Buffer.byteLength(dados);
    }
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: cabec }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (p) => { texto += p; });
      res.on('end', () => resolve({ status: res.statusCode, corpo: texto ? JSON.parse(texto) : null }));
    });
    req.on('error', reject);
    if (dados !== null) req.write(dados);
    req.end();
  });
}

describe('POST /api/acao: código, formato e limites', () => {
  let porta;
  let token;
  let recebidas;

  // Sobe o painel com a "central" de mentira: guarda o que chegou e responde o que o teste pedir.
  async function ligarPainel(responder = () => ({ ok: true, motivo: null })) {
    recebidas = [];
    painel.definirAcao(async (acao) => { recebidas.push(acao); return responder(acao); });
    ({ porta, token } = await painel.subirParaTestes());
  }

  afterEach(() => {
    painel.desligar();
    painel.definirAcao(null);
  });

  test('sem o código (Bearer) responde 401 e não entrega nada', async () => {
    await ligarPainel();
    const r = await pedir({ porta, corpo: { conta: 0, acao: 'curar' } });
    assert.equal(r.status, 401);
    assert.equal(recebidas.length, 0);
  });

  test('código errado também responde 401', async () => {
    await ligarPainel();
    const r = await pedir({ porta, token: '0'.repeat(64), corpo: { conta: 0, acao: 'curar' } });
    assert.equal(r.status, 401);
  });

  test('ação desconhecida responde 400', async () => {
    await ligarPainel();
    const r = await pedir({ porta, token, corpo: { conta: 0, acao: 'comprar' } });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.motivo, 'ação desconhecida');
    assert.equal(recebidas.length, 0);
  });

  test('corpo maior que 2 KB responde 413', async () => {
    await ligarPainel();
    const r = await pedir({ porta, token, corpo: { conta: 0, acao: 'hunt', slug: 'a'.repeat(5000) } });
    assert.equal(r.status, 413);
    assert.equal(recebidas.length, 0);
  });

  test('sem Content-Type JSON responde 415', async () => {
    await ligarPainel();
    const r = await pedir({ porta, token, tipo: 'text/plain', corpo: { conta: 0, acao: 'curar' } });
    assert.equal(r.status, 415);
  });

  test('campos fora da lista são ignorados e a ação válida chega à central, que confirma', async () => {
    await ligarPainel(() => ({ ok: true, motivo: null }));
    const r = await pedir({ porta, token, corpo: { conta: 1, acao: 'hunt', slug: 'rota_1', lixo: 'x', tipo: 'nada' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, { ok: true, motivo: null });
    assert.deepEqual(recebidas, [{ conta: 1, acao: 'hunt', params: { slug: 'rota_1' } }]);
  });

  test('a central recusa com motivo e a página recebe o motivo', async () => {
    await ligarPainel(() => ({ ok: false, motivo: 'Hunt bloqueada.' }));
    const r = await pedir({ porta, token, corpo: { conta: 0, acao: 'hunt', slug: 'rota_9' } });
    assert.deepEqual(r.corpo, { ok: false, motivo: 'Hunt bloqueada.' });
  });

  test('conta fora de 0 a 3 e tipos errados em cada ação respondem 400', async () => {
    await ligarPainel();
    const ruins = [
      { conta: 4, acao: 'curar' },
      { conta: '0', acao: 'curar' },
      { conta: 0, acao: 'ativo', pokemonId: 1.5 },
      { conta: 0, acao: 'usarItem', itemId: '200' },
      { conta: 0, acao: 'descartar', tipo: 'pokemon', id: 1, qtd: 1 },
      { conta: 0, acao: 'descartar', tipo: 'item', id: 1, qtd: 100001 },
      { conta: 0, acao: 'sniper', ligado: 'sim' }
    ];
    for (const corpo of ruins) {
      const r = await pedir({ porta, token, corpo });
      assert.equal(r.status, 400, JSON.stringify(corpo));
    }
    assert.equal(recebidas.length, 0);
  });

  test('mais de 2 ações por segundo do mesmo IP responde 429 na terceira', async () => {
    await ligarPainel();
    const a = await pedir({ porta, token, corpo: { conta: 0, acao: 'curar' } });
    const b = await pedir({ porta, token, corpo: { conta: 0, acao: 'curar' } });
    const c = await pedir({ porta, token, corpo: { conta: 0, acao: 'curar' } });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(c.status, 429);
    assert.equal(recebidas.length, 2);
  });

  test('GET em /api/acao responde 405', async () => {
    await ligarPainel();
    const r = await pedir({ porta, metodo: 'GET', token, tipo: null, caminho: '/api/acao' });
    assert.equal(r.status, 405);
  });

  test('sem app ligado para executar, responde 503', async () => {
    await ligarPainel();
    painel.definirAcao(null);
    const r = await pedir({ porta, token, corpo: { conta: 0, acao: 'curar' } });
    assert.equal(r.status, 503);
  });
});

describe('GET /api/estado: lista da aba Controle é sanitizada', () => {
  afterEach(() => painel.desligar());

  test('campos fora da lista saem, textos têm limite e números ruins viram vazio', async () => {
    const { porta, token } = await painel.subirParaTestes();
    painel.guardarSnapshot({
      contas: [{
        nome: 'Conta 1', online: true,
        controle: {
          hunts: [{ slug: 'rota_1', nome: 'Rota 1', regiao: 'kanto', nivel: 5, liberada: true, atual: false, extra: 'x' }, { nome: 'sem slug' }],
          equipe: [{ id: -1, nome: 'Negativo', slot: 1 }, { id: 3, nome: 'Pika\u0000chu', nivel: -4, hp: 10, hpMax: 40, shiny: true, ativo: true, slot: 1, senha: 'x' }],
          deposito: [{ id: 9, nome: 'Bulba', nivel: 9, dono: 'x' }],
          mochila: [{ id: 200, nome: 'Poção', qtd: 0, tipo: 'item' }, { id: 200, nome: 'Poção', qtd: 4, tipo: 'item' }, { id: 1, nome: 'Bola', qtd: 40, tipo: 'ball' }]
        }
      }]
    });
    const r = await pedir({ porta, metodo: 'GET', caminho: '/api/estado', token, tipo: null });
    assert.equal(r.status, 200);
    const c = r.corpo.contas[0].controle;
    assert.deepEqual(c.hunts, [{ slug: 'rota_1', nome: 'Rota 1', regiao: 'kanto', nivel: 5, liberada: true, atual: false }]);
    assert.deepEqual(c.equipe, [{ id: 3, nome: 'Pikachu', nivel: null, hp: 10, hpMax: 40, shiny: true, ativo: true, slot: 1 }]);
    assert.deepEqual(c.deposito, [{ id: 9, nome: 'Bulba', nivel: 9 }]);
    assert.deepEqual(c.mochila, [{ id: 200, nome: 'Poção', qtd: 4, tipo: 'item' }, { id: 1, nome: 'Bola', qtd: 40, tipo: 'ball' }]);
  });

  test('região da hunt só com a-z curto; lista de regiões tem id, rótulo, nível e cadeado saneados', async () => {
    const { porta, token } = await painel.subirParaTestes();
    painel.guardarSnapshot({
      contas: [{
        nome: 'Conta 1',
        controle: {
          hunts: [
            { slug: 'a', nome: 'A', regiao: 'johto', liberada: false },
            { slug: 'b', nome: 'B', regiao: 'Kanto!', liberada: true },
            { slug: 'c', nome: 'C', regiao: 'x'.repeat(21), liberada: true },
            { slug: 'd', nome: 'D', liberada: true }
          ],
          regioes: [
            { id: 'kanto', rotulo: 'Kanto', nivel: 1, trancada: false, extra: 'x' },
            { id: 'johto', rotulo: 'Johto', nivel: -5, trancada: 'sim' },
            { id: 'Mars', rotulo: 'Marte', nivel: 1000, trancada: true },
            { rotulo: 'sem id', nivel: 2 }
          ]
        }
      }]
    });
    const r = await pedir({ porta, metodo: 'GET', caminho: '/api/estado', token, tipo: null });
    const c = r.corpo.contas[0].controle;
    assert.deepEqual(c.hunts.map((h) => h.regiao), ['johto', null, null, null]);
    assert.deepEqual(c.regioes, [
      { id: 'kanto', rotulo: 'Kanto', nivel: 1, trancada: false },
      { id: 'johto', rotulo: 'Johto', nivel: null, trancada: false }
    ]);
  });

  test('a lista de hunts aceita até 600 e a de regiões até 20', async () => {
    const { porta, token } = await painel.subirParaTestes();
    const hunts = Array.from({ length: 601 }, (_, i) => ({ slug: 'h' + i, nome: 'H' + i, regiao: 'kanto', liberada: true }));
    const regioes = Array.from({ length: 25 }, (_, i) => ({ id: 'r' + String.fromCharCode(97 + (i % 26)) + 'x', rotulo: 'R', nivel: i, trancada: false }));
    painel.guardarSnapshot({ contas: [{ nome: 'Conta 1', controle: { hunts, regioes } }] });
    const r = await pedir({ porta, metodo: 'GET', caminho: '/api/estado', token, tipo: null });
    const c = r.corpo.contas[0].controle;
    assert.equal(c.hunts.length, 600);
    assert.equal(c.regioes.length, 20);
  });
});
