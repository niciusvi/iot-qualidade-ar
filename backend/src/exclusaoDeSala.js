/**
 * ============================================================================
 * exclusaoDeSala.js — Apaga uma sala e TODO o histórico dela
 * ============================================================================
 *
 * Diferente de "desativar" (que só esconde a sala e guarda os dados), excluir
 * é definitivo: leituras, médias por hora e incidentes da sala somem juntos.
 *
 * POR QUE APAGAR O HISTÓRICO JUNTO: as tabelas leituras, agregados_hora e
 * alertas apontam para a sala (chave estrangeira). O PostgreSQL recusa apagar
 * uma sala enquanto existir uma linha apontando para ela.
 *
 * POR QUE EM TRANSAÇÃO: se algo falhar no meio, nada é apagado. Sem isso, um
 * erro depois de apagar as leituras deixaria a sala viva e sem histórico.
 */

/** Tabelas que apontam para a sala, na ordem em que precisam ser limpas. */
const TABELAS_DO_HISTORICO = ['alertas', 'agregados_hora', 'leituras'];

/**
 * Apaga a sala e o histórico dela dentro de uma transação.
 * Recebe o cliente do banco por parâmetro (injeção de dependência) para poder
 * ser testada sem PostgreSQL.
 *
 * Retorna { encontrada: false } se a sala não existe; senão
 * { encontrada: true, nome, leiturasApagadas }.
 *
 * Exemplo de uso:
 *   const cliente = await pool.connect();
 *   try { const r = await excluirSalaComHistorico(cliente, 11); } finally { cliente.release(); }
 */
export async function excluirSalaComHistorico(clienteDoBanco, idDaSala) {
  if (!Number.isInteger(idDaSala) || idDaSala <= 0) {
    throw new Error(`Id de sala inválido: ${JSON.stringify(idDaSala)} (esperado: número inteiro maior que zero)`);
  }
  await clienteDoBanco.query('BEGIN');
  try {
    const resultado = await apagarSalaEHistorico(clienteDoBanco, idDaSala);
    await clienteDoBanco.query('COMMIT');
    return resultado;
  } catch (erro) {
    await clienteDoBanco.query('ROLLBACK');
    throw erro;
  }
}

/** Os DELETEs em si; quem chama cuida de abrir e fechar a transação. */
async function apagarSalaEHistorico(clienteDoBanco, idDaSala) {
  const apagadasPorTabela = {};
  for (const tabela of TABELAS_DO_HISTORICO) {
    // Nome da tabela vem da lista fixa acima (nunca do usuário); o id vai parametrizado.
    const { rowCount } = await clienteDoBanco.query(`DELETE FROM ${tabela} WHERE sala = $1`, [idDaSala]);
    apagadasPorTabela[tabela] = rowCount;
  }
  const { rows } = await clienteDoBanco.query('DELETE FROM salas WHERE id = $1 RETURNING nome', [idDaSala]);
  if (rows.length === 0) return { encontrada: false };
  return { encontrada: true, nome: rows[0].nome, leiturasApagadas: apagadasPorTabela.leituras };
}
