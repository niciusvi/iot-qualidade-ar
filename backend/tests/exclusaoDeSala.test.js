/**
 * Testes da exclusão de sala (backend/src/exclusaoDeSala.js).
 * O FakeClienteDoBanco finge o PostgreSQL: guarda os comandos recebidos e
 * devolve respostas combinadas, para o teste rodar sem banco de verdade.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excluirSalaComHistorico } from '../src/exclusaoDeSala.js';

class FakeClienteDoBanco {
  constructor({ salaExiste = true, falharEm = null } = {}) {
    this.comandos = [];
    this.salaExiste = salaExiste;
    this.falharEm = falharEm;
  }

  /** Mesma assinatura do cliente do `pg`: query(texto, parametros). */
  async query(texto, parametros = []) {
    this.comandos.push({ texto, parametros });
    if (this.falharEm && texto.includes(this.falharEm)) throw new Error('banco fora do ar');
    if (texto.startsWith('DELETE FROM salas')) {
      return { rows: this.salaExiste ? [{ nome: 'Biblioteca' }] : [], rowCount: this.salaExiste ? 1 : 0 };
    }
    return { rows: [], rowCount: texto.includes('leituras') ? 42 : 3 };
  }

  textosExecutados() {
    return this.comandos.map((comando) => comando.texto);
  }
}

test('apaga o histórico ANTES da sala, tudo dentro de uma transação', async () => {
  const banco = new FakeClienteDoBanco();

  const resultado = await excluirSalaComHistorico(banco, 11);

  assert.deepEqual(banco.textosExecutados(), [
    'BEGIN',
    'DELETE FROM alertas WHERE sala = $1',
    'DELETE FROM agregados_hora WHERE sala = $1',
    'DELETE FROM leituras WHERE sala = $1',
    'DELETE FROM salas WHERE id = $1 RETURNING nome',
    'COMMIT',
  ]);
  assert.deepEqual(resultado, { encontrada: true, nome: 'Biblioteca', leiturasApagadas: 42 });
});

test('o id da sala vai sempre como parâmetro, nunca colado no SQL', async () => {
  const banco = new FakeClienteDoBanco();

  await excluirSalaComHistorico(banco, 11);

  const deletes = banco.comandos.filter((comando) => comando.texto.startsWith('DELETE'));
  assert.ok(deletes.every((comando) => comando.parametros[0] === 11 && !comando.texto.includes('11')));
});

test('sala inexistente devolve encontrada=false', async () => {
  const banco = new FakeClienteDoBanco({ salaExiste: false });

  const resultado = await excluirSalaComHistorico(banco, 99);

  assert.deepEqual(resultado, { encontrada: false });
});

test('erro no meio desfaz tudo (ROLLBACK) e o erro sobe para quem chamou', async () => {
  const banco = new FakeClienteDoBanco({ falharEm: 'leituras' });

  await assert.rejects(() => excluirSalaComHistorico(banco, 11), /banco fora do ar/);

  assert.equal(banco.textosExecutados().at(-1), 'ROLLBACK');
  assert.ok(!banco.textosExecutados().includes('COMMIT'));
});

test('id inválido é recusado antes de tocar no banco', async () => {
  const banco = new FakeClienteDoBanco();

  await assert.rejects(() => excluirSalaComHistorico(banco, 'abc'), /Id de sala inválido: "abc"/);

  assert.deepEqual(banco.comandos, []);
});
