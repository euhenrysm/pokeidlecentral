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

// Sniper e captura pelo celular: cada ação passa pelas mesmas regras do PC (src/renderer/regras.js).
// O limite de ações (2 por segundo) só conta os pedidos válidos; por isso os testes reiniciam o painel
// quando precisam de mais de duas ações válidas, e nunca passam de 10 pedidos por segundo.
describe('Sniper e captura pelo celular: validação no servidor', () => {
  let porta;
  let token;
  let recebidas;

  async function ligarPainel() {
    recebidas = [];
    painel.definirAcao(async (acao) => { recebidas.push(acao); return { ok: true, motivo: null }; });
    ({ porta, token } = await painel.subirParaTestes());
  }
  // Painel novo: zera os limites de pedidos e de ações por segundo.
  async function reiniciar() {
    painel.desligar();
    await ligarPainel();
  }

  const regraItem = { tipo: 'item', alvo: 'Water Stone', itemId: 105, modo: 'fixo', maxGold: 500, maxGemas: 0, maxQtd: 3 };
  const snapshotComLoja = (lojaBolas) => ({ sniper: { margemMs: 800, varreduraSeg: 20 }, contas: [{ nome: 'Conta 1', captura: { lojaBolas } }] });

  afterEach(() => {
    painel.desligar();
    painel.definirAcao(null);
  });

  test('regra nova de item chega à central com os campos validados', async () => {
    await ligarPainel();
    const r = await pedir({ porta, token, corpo: { conta: 1, acao: 'sniperRegraSalvar', regra: regraItem } });
    assert.equal(r.status, 200);
    assert.deepEqual(recebidas, [{ conta: 1, acao: 'sniperRegraSalvar', params: { regra: regraItem } }]);
  });

  test('regra com campo fora da lista (compradas, ativa, lixo) responde 400 e não chega à central', async () => {
    await ligarPainel();
    const ruins = [
      { ...regraItem, compradas: 99 },
      { ...regraItem, ativa: false },
      { ...regraItem, lixo: 'x' }
    ];
    for (const regra of ruins) {
      const r = await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperRegraSalvar', regra } });
      assert.equal(r.status, 400, JSON.stringify(regra));
      assert.match(r.corpo.motivo, /não aceito/);
    }
    assert.equal(recebidas.length, 0);
  });

  test('regra com valor fora do limite responde 400: desconto 96, teto enorme, id estranho, regra de pokémon nova', async () => {
    await ligarPainel();
    const ruins = [
      { ...regraItem, modo: 'media', desconto: 96, moedaMedia: 'orb', minVendas: 5, aprovar: true },
      { ...regraItem, maxGold: 1e13 },
      { ...regraItem, alvo: 'a'.repeat(61) },
      { ...regraItem, modo: 'x' },
      { tipo: 'pokemon', maxGold: 100, maxGemas: 0, maxQtd: 0 },
      { tipo: 'diamante', alvo: 'x' }
    ];
    for (const regra of ruins) {
      const r = await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperRegraSalvar', regra } });
      assert.equal(r.status, 400, JSON.stringify(regra));
    }
    const comIdRuim = await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperRegraSalvar', regra: { ...regraItem, id: '../../x' } } });
    assert.equal(comIdRuim.status, 400);
    assert.equal(recebidas.length, 0);
  });

  test('editar só o teto e o limite de um pokémon é aceito; alvo ou filtro de pokémon não', async () => {
    await ligarPainel();
    const ok = await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperRegraSalvar', regra: { id: 'pk-1', tipo: 'pokemon', maxGold: 100, maxGemas: 0, maxQtd: 2 } } });
    assert.equal(ok.status, 200);
    await reiniciar();
    const ruim = await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperRegraSalvar', regra: { id: 'pk-1', tipo: 'pokemon', alvo: 'Dratini', maxGold: 100 } } });
    assert.equal(ruim.status, 400);
    const comFiltro = await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperRegraSalvar', regra: { id: 'pk-1', tipo: 'pokemon', soShiny: true, maxGold: 100 } } });
    assert.equal(comFiltro.status, 400);
  });

  test('apagar e ligar/desligar regra exigem id válido; ativa tem de ser true ou false', async () => {
    await ligarPainel();
    const apagou = await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperRegraApagar', id: 'abc-1' } });
    assert.equal(apagou.status, 200);
    const semId = await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperRegraApagar', id: '' } });
    assert.equal(semId.status, 400);
    const ativoTexto = await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperRegraAtiva', id: 'abc-1', ativa: 'sim' } });
    assert.equal(ativoTexto.status, 400);
    assert.deepEqual(recebidas.map((a) => a.acao), ['sniperRegraApagar']);
  });

  test('opções do sniper: margem até 2500 ms e varredura de 10 a 120 s; fora disso, 400', async () => {
    await ligarPainel();
    assert.equal((await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperOpcoes', margemMs: 2501, varreduraSeg: 20 } })).status, 400);
    assert.equal((await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperOpcoes', margemMs: 800, varreduraSeg: 5 } })).status, 400);
    assert.equal((await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperOpcoes', margemMs: 800 } })).status, 400);
    assert.equal(recebidas.length, 0);
    await reiniciar();
    const ok = await pedir({ porta, token, corpo: { conta: 0, acao: 'sniperOpcoes', margemMs: 800, varreduraSeg: 20 } });
    assert.equal(ok.status, 200);
    assert.deepEqual(recebidas[0].params, { margemMs: 800, varreduraSeg: 20 });
  });

  test('captura: bola e poção só das listas; reposição com valores dentro do limite', async () => {
    await ligarPainel();
    painel.guardarSnapshot(snapshotComLoja([{ id: 2, nome: 'Great Ball', preco: 300 }]));
    const ruins = [
      { ballId: 6 },
      { modo: 'x' },
      { reposicao: { bola: { id: 5 } } },
      { reposicao: { pocao: { id: 999 } } },
      { reposicao: { pocao: { qtd: 0 } } },
      { reposicao: { pocao: { limite: -1 } } },
      { reposicao: { lixo: { ativo: true } } }
    ];
    for (const parcial of ruins) {
      const r = await pedir({ porta, token, corpo: { conta: 0, acao: 'capturaConfig', parcial } });
      assert.equal(r.status, 400, JSON.stringify(parcial));
    }
    assert.equal(recebidas.length, 0);
    await reiniciar();
    painel.guardarSnapshot(snapshotComLoja([{ id: 2, nome: 'Great Ball', preco: 300 }]));
    const ok = await pedir({ porta, token, corpo: { conta: 0, acao: 'capturaConfig', parcial: { modo: 'sempre', reposicao: { bola: { ativo: true, id: 2, abaixoDe: 50, qtd: 1000, limite: 0 } } } } });
    assert.equal(ok.status, 200);
    assert.deepEqual(recebidas[0].params.parcial, { modo: 'sempre', reposicao: { bola: { ativo: true, id: 2, abaixoDe: 50, qtd: 1000, limite: 0 } } });
  });

  test('sem a loja da conta ainda, a bola da reposição vem de 1 a 5', async () => {
    await ligarPainel();
    const r = await pedir({ porta, token, corpo: { conta: 0, acao: 'capturaConfig', parcial: { reposicao: { bola: { id: 4 } } } } });
    assert.equal(r.status, 200);
  });
});

describe('Catálogo do RMT e snapshot de sniper e captura', () => {
  afterEach(() => painel.desligar());

  test('o catálogo exige o código e só vem sanitizado (id, nome e grupo)', async () => {
    const { porta, token } = await painel.subirParaTestes();
    assert.equal((await pedir({ porta, metodo: 'GET', caminho: '/api/catalogo', tipo: null })).status, 401);
    const antes = await pedir({ porta, metodo: 'GET', caminho: '/api/catalogo', token, tipo: null });
    assert.deepEqual(antes.corpo, { pronto: false, itens: [] });
    painel.guardarCatalogo([{ id: 105, nome: 'Water Stone', grupo: 'pedras', icone: 'x' }, { id: 'x', nome: 'Ruim' }, { id: 7, nome: 'Pedra\u0000' }]);
    const depois = await pedir({ porta, metodo: 'GET', caminho: '/api/catalogo', token, tipo: null });
    assert.deepEqual(depois.corpo, { pronto: true, itens: [{ id: 105, nome: 'Water Stone', grupo: 'pedras' }, { id: 7, nome: 'Pedra', grupo: '' }] });
  });

  test('regras e captura vão ao celular sanitizadas; compradas é só para mostrar', async () => {
    const { porta, token } = await painel.subirParaTestes();
    painel.guardarSnapshot({
      sniper: { margemMs: 800, varreduraSeg: 20, senha: 'x' },
      contas: [{
        nome: 'Conta 1',
        sniperLigado: true,
        regras: [
          { id: 'abc-1', tipo: 'item', ativa: false, alvo: 'Water Stone', itemId: 105, modo: 'media', desconto: 30, moedaMedia: 'orb', minVendas: 5, aprovar: true, maxGold: 0, maxGemas: 0, maxQtd: 3, compradas: 2, resumo: 'x', extra: 'y' },
          { id: '../ruim', tipo: 'item', alvo: 'x' },
          { id: 'pk-1', tipo: 'pokemon', alvo: 'Dratini', maxGold: 100, maxQtd: 0, compradas: 1 },
          null
        ],
        captura: {
          ativo: true, modo: 'sempre', ballId: 2, reposicao: { bola: { ativo: true, id: 2, abaixoDe: 50, qtd: 1000, limite: 0 } },
          pausa: 'sem_bola', lancadas: 4, capturas: 1, chance: 0.3, bolas: [{ id: 2, nome: 'Great Ball', qtd: 9 }, { id: 'x', qtd: 1 }],
          lojaBolas: [{ id: 2, nome: 'Great Ball', preco: 300 }], lojaPocoes: [{ id: 200, nome: 'Small Potion', preco: 50 }],
          estoqueRep: { bola: 9, pocao: null }, reposicaoStatus: { bola: { aviso: 'Sem Coins', pendente: false, compras: 1 } }, senha: 'x'
        }
      }]
    });
    const r = await pedir({ porta, metodo: 'GET', caminho: '/api/estado', token, tipo: null });
    assert.deepEqual(r.corpo.sniper, { margemMs: 800, varreduraSeg: 20 });
    const c = r.corpo.contas[0];
    assert.deepEqual(c.regras.map((x) => x.id), ['abc-1', 'pk-1']);
    assert.deepEqual(c.regras[0], {
      id: 'abc-1', tipo: 'item', ativa: false, alvo: 'Water Stone', itemId: 105, modo: 'media', desconto: 30, moedaMedia: 'orb',
      minVendas: 5, aprovar: true, maxGold: 0, maxGemas: 0, maxQtd: 3, compradas: 2, resumo: 'x'
    });
    assert.equal(c.regras[1].tipo, 'pokemon');
    assert.equal(c.captura.ativo, true);
    assert.equal(c.captura.pausa, 'sem_bola');
    assert.deepEqual(c.captura.bolas, [{ id: 2, nome: 'Great Ball', qtd: 9 }]);
    assert.deepEqual(c.captura.reposicaoStatus.bola, { aviso: 'Sem Coins', pendente: false, compras: 1, ultimaQtd: null, ultimaEm: null });
    assert.equal(c.captura.estoqueRep.pocao, null);
    assert.equal('senha' in c.captura, false);
  });
});

// Ações novas (análise de hunts, lives, radar, configuração): cada uma aceita o certo e recusa o errado.
// Como o limite é de 2 ações por segundo, o teste reinicia o painel antes de cada pedido válido.
describe('Celular: hunts, lives, radar e configuração pela lista fechada', () => {
  let porta;
  let token;
  let recebidas;

  async function ligarPainel() {
    recebidas = [];
    painel.definirAcao(async (acao) => { recebidas.push(acao); return { ok: true, motivo: null }; });
    ({ porta, token } = await painel.subirParaTestes());
  }
  async function reiniciar() {
    painel.desligar();
    await ligarPainel();
  }
  const enviar = (corpo) => pedir({ porta, token, corpo });

  afterEach(() => {
    painel.desligar();
    painel.definirAcao(null);
  });

  test('analisar hunts: aceita a conta e manda só a ação; conta fora de 0 a 3 responde 400', async () => {
    await ligarPainel();
    assert.equal((await enviar({ conta: 2, acao: 'huntsAtualizar' })).status, 200);
    assert.deepEqual(recebidas, [{ conta: 2, acao: 'huntsAtualizar', params: {} }]);
    await reiniciar();
    assert.equal((await enviar({ conta: 4, acao: 'huntsAtualizar' })).status, 400);
    assert.equal(recebidas.length, 0);
  });

  test('abrir live: twitch, kick ou ambas, e canal só com letras, números, _ . - (até 60)', async () => {
    await ligarPainel();
    assert.equal((await enviar({ conta: 0, acao: 'liveAbrir', plataforma: 'ambas' })).status, 200);
    assert.deepEqual(recebidas[0].params, { plataforma: 'ambas' });
    await reiniciar();
    assert.equal((await enviar({ conta: 0, acao: 'liveAbrir', plataforma: 'kick', canal: 'fulano_1' })).status, 200);
    assert.deepEqual(recebidas[0].params, { plataforma: 'kick', canal: 'fulano_1' });
    const ruins = [
      { plataforma: 'youtube' },
      { plataforma: 'ambas', canal: 'fulano' },
      { plataforma: 'twitch', canal: '../admin' },
      { plataforma: 'twitch', canal: 'a'.repeat(61) },
      { plataforma: 'twitch', canal: 'x y' }
    ];
    for (const extra of ruins) {
      await reiniciar();
      const r = await enviar({ conta: 0, acao: 'liveAbrir', ...extra });
      assert.equal(r.status, 400, JSON.stringify(extra));
      assert.equal(recebidas.length, 0);
    }
  });

  test('opções de lives: qualidade da lista, conta 0 a 3, manter e abrir sozinha; campo estranho recusa', async () => {
    await ligarPainel();
    assert.equal((await enviar({ conta: 0, acao: 'livesOpcoes', parcial: { qualidadeLives: '360p30', autoLive: { ativo: true, conta: 1 } } })).status, 200);
    assert.deepEqual(recebidas[0].params.parcial, { qualidadeLives: '360p30', autoLive: { ativo: true, conta: 1 } });
    const ruins = [
      { qualidadeLives: '1080p' },
      { contaLives: 4 },
      { manterLives: 'sim' },
      { autoLive: { ativo: true, senha: 'x' } },
      { senha: 'x' }
    ];
    for (const parcial of ruins) {
      await reiniciar();
      const r = await enviar({ conta: 0, acao: 'livesOpcoes', parcial });
      assert.equal(r.status, 400, JSON.stringify(parcial));
      assert.equal(recebidas.length, 0);
    }
  });

  test('radar: liga, conta e faixas do PC (desconto 1 a 95, minutos 1 a 60); campo de login recusa', async () => {
    await ligarPainel();
    assert.equal((await enviar({ conta: 0, acao: 'radarOpcoes', parcial: { ativo: true, desconto: 40, minutos: 5 } })).status, 200);
    assert.deepEqual(recebidas[0].params.parcial, { ativo: true, desconto: 40, minutos: 5 });
    const ruins = [{ desconto: 96 }, { minutos: 0 }, { minutos: 61 }, { conta: -1 }, { moedaMedia: 'diamante' }, { ativo: 'sim' }, { token: 'x' }];
    for (const parcial of ruins) {
      await reiniciar();
      const r = await enviar({ conta: 0, acao: 'radarOpcoes', parcial });
      assert.equal(r.status, 400, JSON.stringify(parcial));
      assert.equal(recebidas.length, 0);
    }
  });

  test('configuração: escala só das opções do PC e som (mudo) de uma conta; e-mail ou escala 0,5 recusam', async () => {
    await ligarPainel();
    assert.equal((await enviar({ conta: 0, acao: 'configOpcoes', parcial: { escalaInterface: 0.8, mudo: { conta: 3, valor: true } } })).status, 200);
    assert.deepEqual(recebidas[0].params.parcial, { escalaInterface: 0.8, mudo: { conta: 3, valor: true } });
    const ruins = [{ escalaInterface: 0.5 }, { mudo: { conta: 4, valor: true } }, { mudo: { conta: 0, valor: 1 } }, { email: 'a@b.c' }];
    for (const parcial of ruins) {
      await reiniciar();
      const r = await enviar({ conta: 0, acao: 'configOpcoes', parcial });
      assert.equal(r.status, 400, JSON.stringify(parcial));
      assert.equal(recebidas.length, 0);
    }
  });
});

// Rotas novas de detalhe: exigem o código e só saem com os limites de tamanho e de quantidade.
describe('Celular: rotas de detalhe (hunts, registro, mercado)', () => {
  afterEach(() => painel.desligar());

  const hunt = (i, extra = {}) => ({ slug: 'h' + i, nome: 'Hunt ' + i, regiao: 'kanto', nivel: i, liberada: true, atual: false, xpTrH: 1234.6, goldH: 99.4, killsH: 3, xpPkH: 10, ...extra });

  test('sem o código, as três rotas respondem 401', async () => {
    const { porta } = await painel.subirParaTestes();
    for (const caminho of ['/api/hunts?conta=0', '/api/registro', '/api/mercado']) {
      assert.equal((await pedir({ porta, metodo: 'GET', caminho, tipo: null })).status, 401, caminho);
    }
  });

  test('análise de hunts: por conta, com os números arredondados, textos cortados e no máximo 600', async () => {
    const { porta, token } = await painel.subirParaTestes();
    const hunts = Array.from({ length: 601 }, (_, i) => hunt(i));
    hunts[0] = hunt(0, { nome: 'N'.repeat(200), xpTrH: 12.7, fracos: Array.from({ length: 25 }, (_, k) => ({ tipo: 'fogo' + k, mult: 2 })), senha: 'x' });
    painel.guardarDetalhe({ tipo: 'hunts', conta: 1, dados: { em: 5, nivelTreinador: 40, fatorRitmo: 0.8, hunts } });
    const r = await pedir({ porta, metodo: 'GET', caminho: '/api/hunts?conta=1', token, tipo: null });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.pronto, true);
    assert.equal(r.corpo.hunts.length, 600);
    assert.equal(r.corpo.hunts[0].nome.length, 60);
    assert.equal(r.corpo.hunts[0].xpTrH, 13);
    assert.equal(r.corpo.hunts[0].fracos.length, 18);
    assert.equal('senha' in r.corpo.hunts[0], false);
    assert.equal(r.corpo.hunts[1].goldH, 99);
    const vazia = await pedir({ porta, metodo: 'GET', caminho: '/api/hunts?conta=0', token, tipo: null });
    assert.deepEqual(vazia.corpo, { pronto: false, em: null, nivelTreinador: null, fatorRitmo: null, hunts: [] });
  });

  test('hunts pede conta válida: sem ?conta= ou com 4 responde 400', async () => {
    const { porta, token } = await painel.subirParaTestes();
    assert.equal((await pedir({ porta, metodo: 'GET', caminho: '/api/hunts', token, tipo: null })).status, 400);
    assert.equal((await pedir({ porta, metodo: 'GET', caminho: '/api/hunts?conta=4', token, tipo: null })).status, 400);
  });

  test('registro: últimas 100 linhas por conta, texto de até 200, nível fora de info/aviso/erro vira info', async () => {
    const { porta, token } = await painel.subirParaTestes();
    const linhas = Array.from({ length: 150 }, (_, i) => ({ em: i, nivel: i === 149 ? 'xyz' : 'aviso', msg: 'm' + i + 'x'.repeat(300) }));
    painel.guardarDetalhe({ tipo: 'registro', conta: 0, linhas });
    const r = await pedir({ porta, metodo: 'GET', caminho: '/api/registro?conta=0', token, tipo: null });
    assert.equal(r.corpo.linhas.length, 100);
    assert.equal(r.corpo.linhas[0].em, 149);
    assert.equal(r.corpo.linhas[0].nivel, 'info');
    assert.equal(r.corpo.linhas[0].msg.length, 200);
    assert.equal(r.corpo.linhas[0].conta, 0);
    const todas = await pedir({ porta, metodo: 'GET', caminho: '/api/registro', token, tipo: null });
    assert.equal(todas.corpo.linhas.length, 100);
    assert.equal((await pedir({ porta, metodo: 'GET', caminho: '/api/registro?conta=9', token, tipo: null })).status, 400);
  });

  test('mercado: limites de preços (150), ofertas (30) e compras (50); estados e moedas fora da lista viram padrão', async () => {
    const { porta, token } = await painel.subirParaTestes();
    const precos = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, nome: 'Item ' + i, eG: 'disp', eO: 'estranho', gold: 10, gema: 2, em: 1 }));
    const ofertas = Array.from({ length: 40 }, (_, i) => ({ conta: 'Conta 1', nome: 'Oferta ' + i, qtd: 1, preco: 5, moeda: 'diamante', pctMedia: 40, origem: 'radar' }));
    const compras = Array.from({ length: 60 }, (_, i) => ({ em: i, conta: 'Conta 1', nome: 'C' + i, qtd: 1, preco: 1, total: 1, moeda: 'gold', origem: 'sniper', resultado: 'ganhou' }));
    painel.guardarDetalhe({ tipo: 'mercado', dados: { leituraEm: 9, leituraConta: 'Conta 1', limiteMs: 240000, radar: { ativo: true, conta: 9, moedaMedia: 'x' }, precos, ofertas, compras } });
    const r = await pedir({ porta, metodo: 'GET', caminho: '/api/mercado', token, tipo: null });
    assert.equal(r.corpo.pronto, true);
    assert.equal(r.corpo.precos.length, 150);
    assert.equal(r.corpo.precos[0].eO, 'nao_lido');
    assert.equal(r.corpo.ofertas.length, 30);
    assert.equal(r.corpo.ofertas[0].moeda, 'gold');
    assert.equal(r.corpo.compras.length, 50);
    assert.deepEqual(r.corpo.radar, { ativo: true, conta: 0, desconto: null, moedaMedia: 'orb', minVendas: null, auto: false, minutos: null });
  });

  test('mercado ainda sem leitura responde pronto: false e listas vazias', async () => {
    const { porta, token } = await painel.subirParaTestes();
    const vazio = await pedir({ porta, metodo: 'GET', caminho: '/api/mercado', token, tipo: null });
    assert.equal(vazio.corpo.pronto, false);
    assert.deepEqual(vazio.corpo.precos, []);
  });

  test('o snapshot leva mudo, gastos, shinies, fila e lives sanitizados, e corta a versão', async () => {
    const { porta, token } = await painel.subirParaTestes();
    const lista = Array.from({ length: 90 }, (_, i) => ({ plataforma: 'twitch', nome: 'canal' + i, aoVivo: i % 2 === 0, viewers: 5 }));
    painel.guardarSnapshot({
      versao: 'v'.repeat(40),
      escala: 0.7,
      lives: { contaLives: 2, qualidade: 'x'.repeat(50), autoLive: { ativo: true, conta: 3 }, lista: [...lista, { plataforma: 'youtube', nome: 'x' }] },
      contas: [{ nome: 'Conta 1', mudo: true, fila: 4, gastos: { pocoes: 3, bolas: 'x' }, shinies: { vistos: 1, capturados: 0, senha: 'x' }, xpBonus: 1.5, ultimoSniper: { nivel: 'comprado', msg: 'ok' } }]
    });
    const r = await pedir({ porta, metodo: 'GET', caminho: '/api/estado', token, tipo: null });
    assert.equal(r.corpo.versao.length, 20);
    assert.equal(r.corpo.escala, 'auto');
    assert.equal(r.corpo.lives.lista.length, 80);
    assert.equal(r.corpo.lives.qualidade.length, 20);
    assert.deepEqual(r.corpo.lives.autoLive, { ativo: true, conta: 3 });
    const c = r.corpo.contas[0];
    assert.equal(c.mudo, true);
    assert.equal(c.fila, 4);
    assert.deepEqual(c.gastos, { pocoes: 3, bolas: null });
    assert.deepEqual(c.shinies, { vistos: 1, capturados: 0 });
    assert.equal(c.xpBonus, 1.5);
    assert.deepEqual(c.ultimoSniper, { nivel: 'comprado', msg: 'ok' });
  });
});

test('Tailscale: reconhece a faixa 100.64.0.0/10 e mais nada', () => {
  const P = require('../src/painel-celular');
  assert.equal(P._ehTailscale('100.64.0.1'), true);
  assert.equal(P._ehTailscale('100.101.102.103'), true);
  assert.equal(P._ehTailscale('100.127.255.254'), true);
  assert.equal(P._ehTailscale('100.63.0.1'), false);
  assert.equal(P._ehTailscale('100.128.0.1'), false);
  assert.equal(P._ehTailscale('192.168.0.10'), false);
});
