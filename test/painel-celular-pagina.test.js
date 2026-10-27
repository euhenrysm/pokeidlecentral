'use strict';

// Página do painel no celular (src/painel-celular.html): o script inline compila e todo id que ele procura
// existe no HTML. Não roda a página (não há navegador aqui); só confere o que quebraria ao abrir.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'painel-celular.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test('a página tem um só script inline e ele compila', () => {
  assert.equal(scripts.length, 1);
  // Compila sem executar: qualquer erro de sintaxe aparece aqui.
  assert.doesNotThrow(() => new vm.Script(scripts[0], { filename: 'painel-celular.html' }));
});

test('todo id que o script procura (getElementById e querySelector) existe no HTML', () => {
  const idsNoHtml = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const procurados = new Set([
    ...[...scripts[0].matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]),
    ...[...scripts[0].matchAll(/querySelector(?:All)?\('#([\w-]+)/g)].map((m) => m[1])
  ]);
  assert.ok(procurados.size > 40, 'o script deveria procurar dezenas de ids');
  const faltam = [...procurados].filter((id) => !idsNoHtml.has(id));
  assert.deepEqual(faltam, []);
});

test('a navegação do rodapé tem as seis telas e cada uma tem a sua seção', () => {
  const telas = ['contas', 'hunts', 'mercado', 'lives', 'registro', 'config'];
  for (const t of telas) {
    assert.ok(html.includes(`data-tela="${t}" aria-pressed`), `botão ${t}`);
    assert.ok(html.includes(`<section id="tela-${t}"`), `seção ${t}`);
  }
  assert.ok(!/minigame/i.test(html), 'Minigame não existe neste branch');
});
