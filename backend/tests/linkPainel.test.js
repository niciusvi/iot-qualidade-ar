/**
 * Testes da linha "Painel: ..." das mensagens (backend/src/linkPainel.js).
 * Regressão de 13/11/2026: mensagem com "https://" não chegava ao WhatsApp.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enderecoSemProtocolo, linhaDoPainel } from '../src/linkPainel.js';

test('REGRESSÃO 13/11/2026: a linha do painel nunca leva https://', () => {
  assert.equal(linhaDoPainel('https://school-air.univesp.dev'), 'Painel: school-air.univesp.dev');
});

test('http://, maiúsculas e barra no fim também são removidos', () => {
  assert.equal(enderecoSemProtocolo('HTTP://Exemplo.com/'), 'Exemplo.com');
  assert.equal(enderecoSemProtocolo('  https://exemplo.com/painel//  '), 'exemplo.com/painel');
});

test('endereço que já vem sem protocolo fica como está', () => {
  assert.equal(linhaDoPainel('school-air.univesp.dev'), 'Painel: school-air.univesp.dev');
});

test('sem painel configurado não há linha nenhuma', () => {
  assert.equal(linhaDoPainel(''), '');
  assert.equal(linhaDoPainel(undefined), '');
  assert.equal(linhaDoPainel('https://'), '');
});
