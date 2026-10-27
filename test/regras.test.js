'use strict';

// Regras do sniper e da captura (src/renderer/regras.js): a mesma montagem e validação para o formulário do PC
// e para o celular. Sem DOM: o módulo roda direto no Node.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Regras = require('../src/renderer/regras');

const itemFixo = { alvo: 'Water Stone', itemId: 105, modo: 'fixo', maxGold: 500, maxGemas: 0, maxQtd: 3 };
const itemMedia = { alvo: '', itemId: 0, modo: 'media', desconto: 30, moedaMedia: 'orb', minVendas: 5, aprovar: true, maxGold: 0, maxGemas: 0, maxQtd: 0 };

describe('regraDeItem: montagem igual à do formulário do PC', () => {
  test('regra fixa nova: id gerado, ativa, sem campos de média, compradas zerada', () => {
    const r = Regras.regraDeItem(itemFixo).valor;
    assert.match(r.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual({ ...r, id: undefined }, { id: undefined, ativa: true, tipo: 'item', alvo: 'Water Stone', itemId: 105, modo: 'fixo', maxGold: 500, maxGemas: 0, maxQtd: 3, compradas: 0 });
  });

  test('regra de média traz os campos de média; anterior mantém id, liga/desliga e compradas', () => {
    const anterior = { id: 'abc-1', ativa: false, compradas: 4 };
    const r = Regras.regraDeItem(itemMedia, anterior).valor;
    assert.equal(r.id, 'abc-1');
    assert.equal(r.ativa, false);
    assert.equal(r.compradas, 4);
    assert.deepEqual([r.desconto, r.moedaMedia, r.minVendas, r.aprovar], [30, 'orb', 5, true]);
  });

  test('item obrigatório no fixo; média aceita qualquer item', () => {
    assert.equal(Regras.regraDeItem({ ...itemFixo, alvo: '', itemId: 0 }).erro, 'Informe o nome ou o ID do item.');
    assert.ok(Regras.regraDeItem({ ...itemMedia, maxGold: 100 }).valor, 'média com teto opcional');
  });

  test('teto em Coins ou Gemas é obrigatório no fixo; na média é opcional', () => {
    assert.equal(Regras.regraDeItem({ ...itemFixo, maxGold: 0, maxGemas: 0 }).erro, 'Defina um teto em Coins ou em Gemas.');
    assert.ok(Regras.regraDeItem({ ...itemMedia, maxGold: 0, maxGemas: 0 }).valor);
  });

  test('desconto só de 1 a 95; moeda só das três opções; vendas e limite não negativos', () => {
    assert.match(Regras.regraDeItem({ ...itemMedia, desconto: 0 }).erro, /entre 1 e 95/);
    assert.match(Regras.regraDeItem({ ...itemMedia, desconto: 96 }).erro, /entre 1 e 95/);
    assert.match(Regras.regraDeItem({ ...itemMedia, desconto: 30.5 }).erro, /entre 1 e 95/);
    assert.match(Regras.regraDeItem({ ...itemMedia, moedaMedia: 'diamante' }).erro, /Moeda/);
    assert.match(Regras.regraDeItem({ ...itemMedia, minVendas: -1 }).erro, /vendas/);
    assert.match(Regras.regraDeItem({ ...itemFixo, maxQtd: -1 }).erro, /Limite/);
  });

  test('nome longo ou com caractere de controle e ID fora do limite são recusados', () => {
    assert.match(Regras.regraDeItem({ ...itemFixo, alvo: 'x'.repeat(61) }).erro, /Nome/);
    assert.match(Regras.regraDeItem({ ...itemFixo, alvo: 'a\u0007b' }).erro, /Nome/);
    assert.match(Regras.regraDeItem({ ...itemFixo, itemId: 1.5 }).erro, /ID/);
  });
});

describe('regraDePokemonComTetos: pokémon só troca teto e limite', () => {
  const pk = { id: 'pk-1', ativa: true, tipo: 'pokemon', alvo: 'Dratini', itemId: 0, modo: 'fixo', soShiny: true, maxGold: 100, maxGemas: 0, maxQtd: 0, compradas: 2 };

  test('mantém os filtros e troca os tetos', () => {
    const r = Regras.regraDePokemonComTetos(pk, { maxGold: 0, maxGemas: 7, maxQtd: 2 }).valor;
    assert.deepEqual({ ...r }, { ...pk, maxGold: 0, maxGemas: 7, maxQtd: 2 });
  });

  test('sem teto em Coins nem Gemas, recusa; regra que não é de pokémon, recusa', () => {
    assert.match(Regras.regraDePokemonComTetos(pk, { maxGold: 0, maxGemas: 0, maxQtd: 0 }).erro, /teto/);
    assert.ok(Regras.regraDePokemonComTetos({ ...pk, tipo: 'item' }, { maxGold: 1, maxGemas: 0, maxQtd: 0 }).erro);
  });
});

describe('validarRegraDoCelular: lista fechada de campos', () => {
  const nova = { tipo: 'item', alvo: 'Water Stone', itemId: 105, modo: 'fixo', maxGold: 500, maxGemas: 0, maxQtd: 3 };

  test('aceita regra nova de item e regra de item editada', () => {
    assert.deepEqual(Regras.validarRegraDoCelular(nova).valor, nova);
    assert.ok(Regras.validarRegraDoCelular({ ...nova, id: 'abc-1' }).valor);
  });

  test('recusa campo fora da lista, compradas e ativa (o celular não manda esses)', () => {
    assert.match(Regras.validarRegraDoCelular({ ...nova, compradas: 99 }).erro, /não aceito: compradas/);
    assert.match(Regras.validarRegraDoCelular({ ...nova, ativa: false }).erro, /não aceito: ativa/);
    assert.match(Regras.validarRegraDoCelular({ ...nova, especieId: 1 }).erro, /não aceito: especieId/);
  });

  test('recusa criar regra de pokémon, e pokémon editado só aceita teto e limite', () => {
    assert.match(Regras.validarRegraDoCelular({ tipo: 'pokemon', maxGold: 1 }).erro, /só pode ser criada no PC/);
    assert.match(Regras.validarRegraDoCelular({ id: 'pk-1', tipo: 'pokemon', alvo: 'Dratini', maxGold: 1 }).erro, /não aceito: alvo/);
    assert.deepEqual(Regras.validarRegraDoCelular({ id: 'pk-1', tipo: 'pokemon', maxGold: 1, maxQtd: 2 }).valor, { id: 'pk-1', tipo: 'pokemon', maxGold: 1, maxQtd: 2 });
  });

  test('id com caractere estranho ou tipo desconhecido, recusa', () => {
    assert.match(Regras.validarRegraDoCelular({ ...nova, id: '../x' }).erro, /inválida/);
    assert.match(Regras.validarRegraDoCelular({ ...nova, tipo: 'diamante' }).erro, /Tipo/);
    assert.match(Regras.validarRegraDoCelular(null).erro, /inválida/);
  });

  test('valores fora do limite são recusados', () => {
    assert.match(Regras.validarRegraDoCelular({ ...nova, maxGold: 1e13 }).erro, /Teto/);
    assert.match(Regras.validarRegraDoCelular({ ...nova, maxQtd: '3' }).erro, /Limite/);
    assert.match(Regras.validarRegraDoCelular({ ...nova, modo: 'media', desconto: 96 }).erro, /entre 1 e 95/);
  });
});

describe('validarOpcoesSniper e validarParcialCaptura', () => {
  test('opções do sniper: margem 0 a 2500 e varredura 10 a 120', () => {
    assert.deepEqual(Regras.validarOpcoesSniper({ margemMs: 800, varreduraSeg: 20 }).valor, { margemMs: 800, varreduraSeg: 20 });
    assert.ok(Regras.validarOpcoesSniper({ margemMs: 0, varreduraSeg: 10 }).valor);
    assert.match(Regras.validarOpcoesSniper({ margemMs: 2501, varreduraSeg: 20 }).erro, /margem/);
    assert.match(Regras.validarOpcoesSniper({ margemMs: 800, varreduraSeg: 9 }).erro, /varredura/);
    assert.match(Regras.validarOpcoesSniper({ margemMs: 800 }).erro, /varredura/);
  });

  test('captura: liga, modo e bola da lista; reposição com bola da loja e poção da lista', () => {
    const loja = [{ id: 2, nome: 'Great Ball', preco: 300 }];
    assert.deepEqual(Regras.validarParcialCaptura({ ativo: true, modo: 'sempre', ballId: 3 }, loja).valor, { ativo: true, modo: 'sempre', ballId: 3 });
    assert.match(Regras.validarParcialCaptura({ modo: 'x' }, loja).erro, /Modo/);
    assert.match(Regras.validarParcialCaptura({ ballId: 6 }, loja).erro, /Bola/);
    assert.ok(Regras.validarParcialCaptura({ reposicao: { bola: { ativo: true, id: 2, abaixoDe: 50, qtd: 1000, limite: 0 } } }, loja).valor);
    assert.match(Regras.validarParcialCaptura({ reposicao: { bola: { id: 5 } } }, loja).erro, /não está na loja/);
    assert.match(Regras.validarParcialCaptura({ reposicao: { pocao: { id: 999 } } }, loja).erro, /Poção/);
    assert.match(Regras.validarParcialCaptura({ reposicao: { pocao: { qtd: 0 } } }, loja).erro, /quantidade/);
    assert.match(Regras.validarParcialCaptura({ reposicao: { pocao: { limite: -1 } } }, loja).erro, /limite/);
    assert.match(Regras.validarParcialCaptura({ reposicao: { super: { ativo: true } } }, loja).erro, /desconhecida/);
    assert.match(Regras.validarParcialCaptura({ ativo: true, lixo: 1 }, loja).erro, /não aceito: lixo/);
    assert.match(Regras.validarParcialCaptura({}, loja).erro, /Nada/);
  });

  test('sem a loja do jogo ainda, a bola da reposição vem de 1 a 5', () => {
    assert.ok(Regras.validarParcialCaptura({ reposicao: { bola: { id: 4 } } }, []).valor);
    assert.match(Regras.validarParcialCaptura({ reposicao: { bola: { id: 6 } } }, []).erro, /loja/);
  });

  test('radar do celular: só a lista, com as faixas do PC (desconto 1-95, minutos 1-60, moeda das três)', () => {
    const ok = Regras.validarRadarDoCelular({ ativo: true, conta: 2, desconto: 40, moedaMedia: 'ambas', minVendas: 0, auto: false, minutos: 60 });
    assert.deepEqual(ok.valor, { ativo: true, conta: 2, desconto: 40, moedaMedia: 'ambas', minVendas: 0, auto: false, minutos: 60 });
    assert.deepEqual(Regras.validarRadarDoCelular({ ativo: false }).valor, { ativo: false });
    assert.match(Regras.validarRadarDoCelular({ ativo: 'sim' }).erro, /sim ou não/);
    assert.match(Regras.validarRadarDoCelular({ conta: 4 }).erro, /Conta/);
    assert.match(Regras.validarRadarDoCelular({ desconto: 96 }).erro, /95/);
    assert.match(Regras.validarRadarDoCelular({ desconto: 0 }).erro, /95/);
    assert.match(Regras.validarRadarDoCelular({ moedaMedia: 'diamante' }).erro, /Moeda/);
    assert.match(Regras.validarRadarDoCelular({ minVendas: -1 }).erro, /vendas/);
    assert.match(Regras.validarRadarDoCelular({ minutos: 0 }).erro, /1 a 60/);
    assert.match(Regras.validarRadarDoCelular({ minutos: 61 }).erro, /1 a 60/);
    assert.match(Regras.validarRadarDoCelular({ ativo: true, radarLixo: 1 }).erro, /não aceito: radarLixo/);
    assert.match(Regras.validarRadarDoCelular({}).erro, /Nada/);
    assert.match(Regras.validarRadarDoCelular('x').erro, /inválida/);
  });

  test('lives do celular: qualidade da lista, conta de 0 a 3, manter e abrir sozinha', () => {
    assert.deepEqual(Regras.validarLivesDoCelular({ qualidadeLives: '360p30' }).valor, { qualidadeLives: '360p30' });
    assert.deepEqual(Regras.validarLivesDoCelular({ autoLive: { ativo: true, conta: 1 }, manterLives: false, contaLives: 3 }).valor,
      { autoLive: { ativo: true, conta: 1 }, manterLives: false, contaLives: 3 });
    assert.match(Regras.validarLivesDoCelular({ qualidadeLives: '1080p' }).erro, /Qualidade/);
    assert.match(Regras.validarLivesDoCelular({ contaLives: 4 }).erro, /Conta das lives/);
    assert.match(Regras.validarLivesDoCelular({ manterLives: 'sim' }).erro, /sim ou não/);
    assert.match(Regras.validarLivesDoCelular({ autoLive: { conta: 9 } }).erro, /Conta do abrir/);
    assert.match(Regras.validarLivesDoCelular({ autoLive: { ativo: true, token: 'x' } }).erro, /não aceito: token/);
    assert.match(Regras.validarLivesDoCelular({ autoLive: {} }).erro, /Nada/);
    assert.match(Regras.validarLivesDoCelular({ senha: 'x' }).erro, /não aceito: senha/);
  });

  test('abrir live: Twitch, Kick ou as duas; canal com caracteres estranhos ou com as duas plataformas, recusa', () => {
    assert.deepEqual(Regras.validarLiveAbrir({ plataforma: 'ambas' }).valor, { plataforma: 'ambas' });
    assert.deepEqual(Regras.validarLiveAbrir({ plataforma: 'kick', canal: 'fulano_1' }).valor, { plataforma: 'kick', canal: 'fulano_1' });
    assert.match(Regras.validarLiveAbrir({ plataforma: 'youtube' }).erro, /Plataforma/);
    assert.match(Regras.validarLiveAbrir({ plataforma: 'ambas', canal: 'x' }).erro, /escolha/);
    assert.match(Regras.validarLiveAbrir({ plataforma: 'twitch', canal: '../x' }).erro, /Canal/);
    assert.match(Regras.validarLiveAbrir({ plataforma: 'twitch', canal: 'a'.repeat(61) }).erro, /Canal/);
    assert.match(Regras.validarLiveAbrir({ plataforma: 'twitch', url: 'x' }).erro, /não aceito: url/);
  });

  test('configuração do celular: escala só das opções do PC e som por conta; nada de login', () => {
    assert.deepEqual(Regras.validarConfigDoCelular({ escalaInterface: 0.8 }).valor, { escalaInterface: 0.8 });
    assert.deepEqual(Regras.validarConfigDoCelular({ escalaInterface: 'auto' }).valor, { escalaInterface: 'auto' });
    assert.deepEqual(Regras.validarConfigDoCelular({ mudo: { conta: 0, valor: true } }).valor, { mudo: { conta: 0, valor: true } });
    assert.match(Regras.validarConfigDoCelular({ escalaInterface: 0.5 }).erro, /Escala/);
    assert.match(Regras.validarConfigDoCelular({ mudo: { conta: 4, valor: true } }).erro, /Conta do som/);
    assert.match(Regras.validarConfigDoCelular({ mudo: { conta: 0, valor: 1 } }).erro, /sim ou não/);
    assert.match(Regras.validarConfigDoCelular({ email: 'a@b' }).erro, /não aceito: email/);
    assert.match(Regras.validarConfigDoCelular({ mudo: { conta: 0, valor: true, senha: 'x' } }).erro, /não aceito: senha/);
    assert.match(Regras.validarConfigDoCelular({}).erro, /Nada/);
  });
});
