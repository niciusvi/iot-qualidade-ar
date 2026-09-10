/**
 * ============================================================================
 * relatorio.js — Relatório semanal automático por WhatsApp (v2 / Fase 4)
 * ============================================================================
 *
 * Toda segunda-feira às 7h (hora de São Paulo), envia aos destinatários um
 * resumo dos últimos 7 dias por sala: CO₂ médio e máximo, horas em nível
 * crítico e quantidade de alertas — ranking das piores salas primeiro.
 *
 * O job roda a cada hora; a tabela app_estado guarda a data do último envio
 * para nunca duplicar (mínimo 6 dias entre relatórios).
 */
import { pool } from './db.js';
import { enviarWhatsApp } from './alertas.js';

const DASHBOARD_URL = process.env.DASHBOARD_URL || '';

/** Estatísticas dos últimos `dias` por sala ativa (ranking: piores primeiro). */
export async function estatisticasPeriodo(inicio, fim) {
  const { rows } = await pool.query(
    `SELECT s.id AS sala, s.nome,
            count(l.id)::int AS amostras,
            round(avg(l.co2))::int AS co2_medio,
            max(l.co2) AS co2_maximo,
            count(DISTINCT date_trunc('hour', l.data_hora))
              FILTER (WHERE l.co2 > 1500)::int AS horas_criticas_co2,
            (SELECT count(*)::int FROM alertas a
              WHERE a.sala = s.id AND a.enviado_em >= $1 AND a.enviado_em < $2) AS alertas
     FROM salas s
     LEFT JOIN leituras l ON l.sala = s.id AND l.data_hora >= $1 AND l.data_hora < $2
     WHERE s.ativa
     GROUP BY s.id, s.nome
     ORDER BY horas_criticas_co2 DESC NULLS LAST, co2_medio DESC NULLS LAST`,
    [inicio, fim]
  );
  return rows;
}

/** Monta o texto do relatório semanal (últimos 7 dias). */
export async function montarRelatorioSemanal() {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - 7 * 24 * 3600 * 1000);
  const salas = await estatisticasPeriodo(inicio, fim);

  const fmt = (d) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const linhas = [
    `📊 *Relatório semanal — School Air*`,
    `Período: ${fmt(inicio)} a ${fmt(fim)}`,
    '',
  ];

  for (const s of salas) {
    if (!s.amostras) {
      linhas.push(`• ${s.nome}: sem dados no período`);
      continue;
    }
    linhas.push(
      `• ${s.nome}: CO₂ méd ${s.co2_medio} ppm (máx ${s.co2_maximo}), ` +
      `${s.horas_criticas_co2}h em nível crítico, ${s.alertas} alerta(s)`
    );
  }

  const pior = salas.find((s) => s.amostras && s.horas_criticas_co2 > 0);
  linhas.push('');
  linhas.push(pior
    ? `⚠️ Atenção especial: *${pior.nome}* concentrou o pior ar da semana.`
    : `✅ Nenhuma sala acumulou horas em nível crítico. Boa semana!`);
  if (DASHBOARD_URL) linhas.push(`Painel: ${DASHBOARD_URL}`);

  return linhas.join('\n');
}

/**
 * Job horário: dispara o relatório apenas segunda-feira entre 7h e 8h
 * (America/Sao_Paulo), no máximo uma vez a cada 6 dias.
 */
export async function jobRelatorioSemanal() {
  try {
    const agora = new Date();
    const hora = Number(new Intl.DateTimeFormat('en-US',
      { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(agora));
    const dia = new Intl.DateTimeFormat('en-US',
      { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(agora);
    if (dia !== 'Mon' || hora !== 7) return;

    const { rows } = await pool.query(
      "SELECT valor FROM app_estado WHERE chave = 'ultimo_relatorio'"
    );
    if (rows[0] && (Date.now() - new Date(rows[0].valor).getTime()) < 6 * 24 * 3600 * 1000) return;

    const texto = await montarRelatorioSemanal();
    const envio = await enviarWhatsApp(texto);
    await pool.query(
      `INSERT INTO app_estado (chave, valor) VALUES ('ultimo_relatorio', $1)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [new Date().toISOString()]
    );
    console.log(`[relatório] Semanal enviado (${envio.enviados.length} ok, ${envio.erros.length} erros).`);
  } catch (err) {
    console.error('[relatório]', err.message);
  }
}
