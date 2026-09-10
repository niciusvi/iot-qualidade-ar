/**
 * ============================================================================
 * server.js — API do School Air (v2 / Fase 1)
 * ============================================================================
 *
 * Substitui as antigas funções serverless da Vercel (api/salaN.js) por um
 * único servidor Express em container, com persistência em PostgreSQL.
 *
 * ROTAS (compatíveis com o firmware v1 do ESP32 — nenhuma mudança no .ino):
 *   POST /api/sala<N>       → ingestão de uma leitura (ESP32)
 *   GET  /api/sala<N>       → últimas leituras, mais recente primeiro (dashboard)
 *   GET  /api/salas         → lista de salas + timestamp da última leitura
 *   GET  /api/historico     → ?sala=&inicio=&fim=&limit=  (brutos, ordem cronológica)
 *   GET  /api/agregado      → ?sala=&inicio=&fim=&intervalo=hora|dia (média/mín/máx)
 *   GET  /api/status        → healthcheck
 *
 * JOBS INTERNOS:
 *   - a cada 10 min: consolida as horas completas recentes em agregados_hora
 *   - a cada 24 h:   consolida e apaga leituras brutas com mais de RETENCAO_DIAS
 */
import express from 'express';
import { pool, initDb, RETENCAO_DIAS } from './db.js';
import { avaliarAlertas } from './alertas.js';
import crypto from 'node:crypto';
import { login, exigirPerfil, seedAdmin, hashSenha } from './auth.js';
import { jobRelatorioSemanal, montarRelatorioSemanal, estatisticasPeriodo } from './relatorio.js';
import { enviarWhatsApp } from './alertas.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '100kb' }));

/** CORS liberado (mesma política da v1) — o ESP32 e o dashboard podem estar em origens diferentes. */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

/** Métricas aceitas no payload do ESP32 (demais campos são ignorados). */
const METRICAS = ['temperatura', 'umidade', 'co2', 'pm1', 'pm25', 'pm4', 'pm10', 'voc', 'nox', 'luz'];

/** Colunas retornadas nas consultas, já com os nomes que o frontend v1 espera. */
const COLS_LEITURA =
  'id::int AS id, data_hora AS data, temperatura, umidade, co2, pm1, pm25, pm4, pm10, voc, nox, luz';

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/**
 * Converte "YYYY-MM-DD" ou ISO completo em Date.
 * `fimDoDia=true` faz uma data "solta" (sem hora) virar o limite EXCLUSIVO
 * do dia seguinte — assim ?fim=2026-09-07 inclui o dia 07 inteiro.
 */
function parseData(str, fimDoDia = false) {
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  if (fimDoDia && /^\d{4}-\d{2}-\d{2}$/.test(str)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Início da hora que marca o corte de retenção (alinhado à hora cheia). */
function cutoffRetencao() {
  const d = new Date(Date.now() - RETENCAO_DIAS * 24 * 3600 * 1000);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/* ============================================================================
 * HEALTHCHECK
 * ==========================================================================*/
app.get('/api/status', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, versao: '2.0.0', retencao_dias: RETENCAO_DIAS });
  } catch (err) {
    res.status(503).json({ ok: false, erro: 'banco indisponível' });
  }
});

/* ============================================================================
 * GET /api/salas — lista de salas + última leitura de cada uma
 * ==========================================================================*/
app.get('/api/salas', exigirPerfil('visualizacao'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.nome, s.ativa, l.data_hora AS ultima_leitura
      FROM salas s
      LEFT JOIN LATERAL (
        SELECT data_hora FROM leituras WHERE sala = s.id
        ORDER BY data_hora DESC LIMIT 1
      ) l ON true
      ORDER BY s.id
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

/* ============================================================================
 * POST /api/sala<N> — ingestão (ESP32)
 * O caminho /api/sala3 é o MESMO da v1, então o firmware não muda.
 * ==========================================================================*/
/** Faixas plausíveis por métrica (Fase 4): valor fora da faixa vira NULL. */
const FAIXAS = {
  temperatura: [-10, 60], umidade: [0, 100], co2: [0, 10000],
  pm1: [0, 1000], pm25: [0, 1000], pm4: [0, 1000], pm10: [0, 1000],
  voc: [0, 510], nox: [0, 510], luz: [0, 200000],
};

app.post('/api/sala:id(\\d+)', async (req, res, next) => {
  try {
    const sala = Number(req.params.id);
    const body = req.body || {};

    /**
     * Fase 4 — autenticação do dispositivo:
     * Salas criadas pelo portal têm token; o ESP32 provisionado envia o
     * header X-Device-Token e ele PRECISA conferir. As salas 1-10 do seed
     * (token NULL) continuam abertas para o modo simulação.
     */
    const { rows: salaRows } = await pool.query('SELECT token FROM salas WHERE id = $1', [sala]);
    if (salaRows.length > 0 && salaRows[0].token) {
      if (req.headers['x-device-token'] !== salaRows[0].token) {
        return res.status(401).json({ erro: 'Token do dispositivo ausente ou inválido' });
      }
    }

    // Fase 4 — validação: não numérico OU fora da faixa plausível vira NULL
    const valores = METRICAS.map((m) => {
      const v = Number(body[m]);
      if (!Number.isFinite(v)) return null;
      const [min, max] = FAIXAS[m];
      return (v >= min && v <= max) ? v : null;
    });
    if (valores.every((v) => v === null)) {
      return res.status(400).json({ erro: 'Nenhuma métrica válida no payload' });
    }

    // Garante que a sala existe (a simulação pode postar antes do cadastro)
    if (salaRows.length === 0) {
      await pool.query(
        'INSERT INTO salas (id, nome) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [sala, `Sala ${sala}`]
      );
    }

    /**
     * Fase 4 — buffer do ESP32: leituras represadas por queda de Wi-Fi são
     * reenviadas com o campo idade_s (segundos desde a captura). O timestamp
     * é corrigido para o momento real da medição (limite de 24 h).
     */
    const idadeS = Math.min(Math.max(Number(body.idade_s) || 0, 0), 24 * 3600);
    const dataHora = new Date(Date.now() - idadeS * 1000);

    const { rows } = await pool.query(
      `INSERT INTO leituras (sala, data_hora, ${METRICAS.join(', ')})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id::int AS id, data_hora AS data`,
      [sala, dataHora, ...valores]
    );

    res.status(200).json({ status: 'ok', registro: rows[0] });

    // Fase 2: avalia as regras de alerta desta sala em segundo plano
    avaliarAlertas(sala).catch((err) => console.error('[alertas]', err.message));
  } catch (err) { next(err); }
});

/* ============================================================================
 * GET /api/sala<N> — últimas leituras (dashboard em tempo real)
 * Mesmo contrato da v1: array com a leitura mais recente no índice [0].
 * ?limit= controla quantas voltam (padrão 360 ≈ 3 h; máx 5760 ≈ 48 h).
 * ==========================================================================*/
app.get('/api/sala:id(\\d+)', exigirPerfil('visualizacao'), async (req, res, next) => {
  try {
    const sala = Number(req.params.id);
    const limit = clamp(Number(req.query.limit) || 360, 1, 5760);
    const { rows } = await pool.query(
      `SELECT ${COLS_LEITURA} FROM leituras
       WHERE sala = $1 ORDER BY data_hora DESC LIMIT $2`,
      [sala, limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/* ============================================================================
 * GET /api/historico — leituras brutas por período (Fase 1)
 *   ?sala=3                        (obrigatório)
 *   &inicio=2026-09-01             (opcional; padrão: últimas 24 h)
 *   &fim=2026-09-07                (opcional; dia inteiro incluído; padrão: agora)
 *   &limit=5000                    (opcional; máx 20000)
 * Retorna em ordem CRONOLÓGICA (mais antigo primeiro).
 * ==========================================================================*/
app.get('/api/historico', exigirPerfil('visualizacao'), async (req, res, next) => {
  try {
    const sala = Number(req.query.sala);
    if (!Number.isInteger(sala) || sala < 1) {
      return res.status(400).json({ erro: 'Parâmetro ?sala= é obrigatório (número da sala).' });
    }
    const fim = parseData(req.query.fim, true) || new Date();
    const inicio = parseData(req.query.inicio) || new Date(fim.getTime() - 24 * 3600 * 1000);
    const limit = clamp(Number(req.query.limit) || 5000, 1, 20000);

    const { rows } = await pool.query(
      `SELECT ${COLS_LEITURA} FROM leituras
       WHERE sala = $1 AND data_hora >= $2 AND data_hora < $3
       ORDER BY data_hora ASC LIMIT $4`,
      [sala, inicio, fim, limit]
    );
    res.json({ sala, inicio, fim, total: rows.length, leituras: rows });
  } catch (err) { next(err); }
});

/* ============================================================================
 * GET /api/agregado — média/mín/máx por hora ou por dia (Fase 1)
 *   ?sala=3&inicio=2026-09-01&fim=2026-09-07&intervalo=hora|dia
 *
 * Períodos dentro da retenção são calculados dos dados brutos;
 * períodos mais antigos vêm da tabela agregados_hora (permanente).
 * ==========================================================================*/
app.get('/api/agregado', exigirPerfil('visualizacao'), async (req, res, next) => {
  try {
    const sala = Number(req.query.sala);
    if (!Number.isInteger(sala) || sala < 1) {
      return res.status(400).json({ erro: 'Parâmetro ?sala= é obrigatório (número da sala).' });
    }
    const intervalo = req.query.intervalo === 'dia' ? 'dia' : 'hora';
    const trunc = intervalo === 'dia' ? 'day' : 'hour';
    const fim = parseData(req.query.fim, true) || new Date();
    const inicio = parseData(req.query.inicio) || new Date(fim.getTime() - 7 * 24 * 3600 * 1000);
    const cutoff = cutoffRetencao();

    const buckets = [];

    // Parte antiga do período → tabela de agregados permanentes
    if (inicio < cutoff) {
      const fimAntigo = fim < cutoff ? fim : cutoff;
      const sql = intervalo === 'hora'
        ? `SELECT hora AS data, amostras,
                  temperatura_avg::real AS temperatura, umidade_avg::real AS umidade,
                  round(co2_avg)::int AS co2, pm1_avg::real AS pm1, pm25_avg::real AS pm25,
                  pm4_avg::real AS pm4, pm10_avg::real AS pm10, voc_avg::real AS voc,
                  nox_avg::real AS nox, round(luz_avg)::int AS luz,
                  co2_min, co2_max
           FROM agregados_hora
           WHERE sala = $1 AND hora >= $2 AND hora < $3 ORDER BY hora`
        : `SELECT date_trunc('day', hora) AS data, sum(amostras)::int AS amostras,
                  (sum(temperatura_avg*amostras)/NULLIF(sum(amostras),0))::real AS temperatura,
                  (sum(umidade_avg*amostras)/NULLIF(sum(amostras),0))::real AS umidade,
                  round(sum(co2_avg*amostras)/NULLIF(sum(amostras),0))::int AS co2,
                  (sum(pm1_avg*amostras)/NULLIF(sum(amostras),0))::real AS pm1,
                  (sum(pm25_avg*amostras)/NULLIF(sum(amostras),0))::real AS pm25,
                  (sum(pm4_avg*amostras)/NULLIF(sum(amostras),0))::real AS pm4,
                  (sum(pm10_avg*amostras)/NULLIF(sum(amostras),0))::real AS pm10,
                  (sum(voc_avg*amostras)/NULLIF(sum(amostras),0))::real AS voc,
                  (sum(nox_avg*amostras)/NULLIF(sum(amostras),0))::real AS nox,
                  round(sum(luz_avg*amostras)/NULLIF(sum(amostras),0))::int AS luz,
                  min(co2_min) AS co2_min, max(co2_max) AS co2_max
           FROM agregados_hora
           WHERE sala = $1 AND hora >= $2 AND hora < $3 GROUP BY 1 ORDER BY 1`;
      const { rows } = await pool.query(sql, [sala, inicio, fimAntigo]);
      buckets.push(...rows);
    }

    // Parte recente do período → calculada direto dos brutos
    if (fim > cutoff) {
      const inicioRecente = inicio > cutoff ? inicio : cutoff;
      const { rows } = await pool.query(
        `SELECT date_trunc($1, data_hora) AS data, count(*)::int AS amostras,
                avg(temperatura)::real AS temperatura, avg(umidade)::real AS umidade,
                round(avg(co2))::int AS co2, avg(pm1)::real AS pm1, avg(pm25)::real AS pm25,
                avg(pm4)::real AS pm4, avg(pm10)::real AS pm10, avg(voc)::real AS voc,
                avg(nox)::real AS nox, round(avg(luz))::int AS luz,
                min(co2) AS co2_min, max(co2) AS co2_max
         FROM leituras
         WHERE sala = $2 AND data_hora >= $3 AND data_hora < $4
         GROUP BY 1 ORDER BY 1`,
        [trunc, sala, inicioRecente, fim]
      );
      // Evita bucket duplicado na fronteira entre as duas fontes (brutos têm precedência)
      const vistos = new Set(rows.map((r) => r.data.toISOString()));
      for (let i = buckets.length - 1; i >= 0; i--) {
        if (vistos.has(buckets[i].data.toISOString())) buckets.splice(i, 1);
      }
      buckets.push(...rows);
    }

    buckets.sort((a, b) => a.data - b.data);
    res.json({ sala, intervalo, inicio, fim, total: buckets.length, buckets });
  } catch (err) { next(err); }
});

/* ============================================================================
 * GET /api/alertas — histórico de incidentes (Fase 2)
 *   ?sala=3   (opcional) filtra por sala
 *   &limit=50 (opcional; máx 500)
 * Mais recente primeiro. normalizado_em = NULL → condição ainda ativa.
 * ==========================================================================*/
app.get('/api/alertas', exigirPerfil('visualizacao'), async (req, res, next) => {
  try {
    const limit = clamp(Number(req.query.limit) || 50, 1, 500);
    const sala = Number(req.query.sala);
    const filtraSala = Number.isInteger(sala) && sala > 0;
    const { rows } = await pool.query(
      `SELECT a.id::int AS id, a.sala, s.nome AS sala_nome, a.parametro, a.nivel,
              a.valor, a.limite, a.mensagem, a.destinatarios, a.erro_envio,
              a.enviado_em, a.normalizado_em
       FROM alertas a JOIN salas s ON s.id = a.sala
       ${filtraSala ? 'WHERE a.sala = $2' : ''}
       ORDER BY a.enviado_em DESC LIMIT $1`,
      filtraSala ? [limit, sala] : [limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/* ============================================================================
 * AUTENTICAÇÃO DO PORTAL (Fase 3)
 * ==========================================================================*/
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { usuario, senha } = req.body || {};
    const sessao = await login(usuario, senha);
    if (!sessao) return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
    res.json(sessao);
  } catch (err) { next(err); }
});

app.get('/api/auth/me', exigirPerfil('visualizacao'), (req, res) => {
  const { nome, usuario, perfil } = req.usuario;
  res.json({ nome, usuario, perfil });
});

/* ============================================================================
 * USUÁRIOS DO PORTAL (Fase 3 — somente admin)
 * ==========================================================================*/
app.get('/api/usuarios', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, usuario, perfil, ativo, criado_em FROM usuarios ORDER BY id'
    );
    res.json(rows);
  } catch (err) { next(err); }
});

app.post('/api/usuarios', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const { nome, usuario, senha, perfil } = req.body || {};
    if (!nome || !usuario || !senha) {
      return res.status(400).json({ erro: 'nome, usuario e senha são obrigatórios' });
    }
    if (!['visualizacao', 'analise', 'admin'].includes(perfil)) {
      return res.status(400).json({ erro: 'perfil deve ser visualizacao, analise ou admin' });
    }
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nome, usuario, senha_hash, perfil)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario) DO NOTHING
       RETURNING id, nome, usuario, perfil, ativo`,
      [String(nome).trim(), String(usuario).trim().toLowerCase(), hashSenha(senha), perfil]
    );
    if (rows.length === 0) return res.status(409).json({ erro: 'Este login já existe' });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

app.put('/api/usuarios/:id(\\d+)', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.usuario.sub && (req.body?.ativo === false || (req.body?.perfil && req.body.perfil !== 'admin'))) {
      return res.status(400).json({ erro: 'Você não pode rebaixar ou desativar o próprio usuário' });
    }
    const campos = [];
    const valores = [];
    if (req.body?.perfil && ['visualizacao', 'analise', 'admin'].includes(req.body.perfil)) {
      valores.push(req.body.perfil); campos.push(`perfil = $${valores.length}`);
    }
    if (typeof req.body?.ativo === 'boolean') {
      valores.push(req.body.ativo); campos.push(`ativo = $${valores.length}`);
    }
    if (req.body?.senha) {
      valores.push(hashSenha(req.body.senha)); campos.push(`senha_hash = $${valores.length}`);
    }
    if (campos.length === 0) return res.status(400).json({ erro: 'Nada para atualizar' });
    valores.push(id);
    const { rows } = await pool.query(
      `UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${valores.length}
       RETURNING id, nome, usuario, perfil, ativo`, valores
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

app.delete('/api/usuarios/:id(\\d+)', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.usuario.sub) return res.status(400).json({ erro: 'Você não pode excluir o próprio usuário' });
    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

/* ============================================================================
 * DESTINATÁRIOS DE ALERTA (Fase 3 — somente admin)
 * ==========================================================================*/
app.get('/api/destinatarios', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM destinatarios ORDER BY id');
    res.json(rows);
  } catch (err) { next(err); }
});

app.post('/api/destinatarios', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const nome = String(req.body?.nome || '').trim();
    const numero = String(req.body?.numero || '').trim();
    if (!/^\d{8,15}$/.test(numero) && !/^\d+@g\.us$/.test(numero)) {
      return res.status(400).json({ erro: 'Número inválido. Use 5511999999999 ou 120363...@g.us (grupo)' });
    }
    const { rows } = await pool.query(
      `INSERT INTO destinatarios (nome, numero) VALUES ($1, $2)
       ON CONFLICT (numero) DO NOTHING RETURNING *`,
      [nome, numero]
    );
    if (rows.length === 0) return res.status(409).json({ erro: 'Este número já está cadastrado' });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

app.put('/api/destinatarios/:id(\\d+)', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE destinatarios SET
         nome = COALESCE($2, nome),
         ativo = COALESCE($3, ativo)
       WHERE id = $1 RETURNING *`,
      [Number(req.params.id), req.body?.nome ?? null,
       typeof req.body?.ativo === 'boolean' ? req.body.ativo : null]
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Destinatário não encontrado' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

app.delete('/api/destinatarios/:id(\\d+)', exigirPerfil('admin'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM destinatarios WHERE id = $1', [Number(req.params.id)]);
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

/* ============================================================================
 * GESTÃO DE SALAS + PROVISIONAMENTO DO ESP32 (Fase 3 — somente admin)
 * ==========================================================================*/
app.post('/api/salas', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const nome = String(req.body?.nome || '').trim();
    if (!nome) return res.status(400).json({ erro: 'Informe o nome da sala' });
    const token = crypto.randomBytes(24).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO salas (id, nome, token)
       VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM salas), $1, $2)
       RETURNING id, nome, ativa, criada_em`,
      [nome, token]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

app.put('/api/salas/:id(\\d+)', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE salas SET
         nome = COALESCE($2, nome),
         ativa = COALESCE($3, ativa)
       WHERE id = $1 RETURNING id, nome, ativa`,
      [Number(req.params.id), req.body?.nome ?? null,
       typeof req.body?.ativa === 'boolean' ? req.body.ativa : null]
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Sala não encontrada' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/**
 * Arquivo de provisionamento do ESP32: baixado pelo admin no portal e
 * importado na página web local do firmware (rota /config do dispositivo).
 * Se a sala ainda não tem token (salas 1-10 do seed), um é gerado agora.
 */
app.get('/api/salas/:id(\\d+)/provisionamento', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query('SELECT id, nome, token FROM salas WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ erro: 'Sala não encontrada' });
    let { token, nome } = rows[0];
    if (!token) {
      token = crypto.randomBytes(24).toString('hex');
      await pool.query('UPDATE salas SET token = $2 WHERE id = $1', [id, token]);
    }
    res.setHeader('Content-Disposition', `attachment; filename="sala-${id}.json"`);
    res.json({
      versao: 1,
      sala: id,
      nome,
      token,
      backend_url: process.env.PUBLIC_BACKEND_URL || '',
      intervalo_envio_s: 30,
    });
  } catch (err) { next(err); }
});

/* ============================================================================
 * EXPORTAÇÃO CSV (Fase 3 — perfil análise ou superior)
 * Mesmos filtros do /api/historico; formato Excel pt-BR (; e vírgula decimal)
 * ==========================================================================*/
app.get('/api/historico.csv', exigirPerfil('analise'), async (req, res, next) => {
  try {
    const sala = Number(req.query.sala);
    if (!Number.isInteger(sala) || sala < 1) {
      return res.status(400).json({ erro: 'Parâmetro ?sala= é obrigatório' });
    }
    const fim = parseData(req.query.fim, true) || new Date();
    const inicio = parseData(req.query.inicio) || new Date(fim.getTime() - 24 * 3600 * 1000);
    const { rows } = await pool.query(
      `SELECT ${COLS_LEITURA} FROM leituras
       WHERE sala = $1 AND data_hora >= $2 AND data_hora < $3
       ORDER BY data_hora ASC LIMIT 50000`,
      [sala, inicio, fim]
    );
    const cols = ['data', 'temperatura', 'umidade', 'co2', 'pm1', 'pm25', 'pm4', 'pm10', 'voc', 'nox', 'luz'];
    const linhas = [cols.join(';')];
    for (const r of rows) {
      linhas.push(cols.map((c) => {
        const v = r[c];
        if (v == null) return '';
        if (c === 'data') return new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        return String(v).replace('.', ',');
      }).join(';'));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="schoolair_sala${sala}.csv"`);
    res.send('\uFEFF' + linhas.join('\n'));
  } catch (err) { next(err); }
});

/* ============================================================================
 * GET /api/analise — indicadores por sala no período (Fase 4, perfil análise+)
 *   ?inicio=&fim=   (padrão: últimos 7 dias)
 * Retorna por sala: amostras, CO₂ médio/máximo, horas em nível crítico
 * (CO₂ > 1500) e nº de alertas — ranking das piores salas primeiro.
 * Base para a discussão bem-estar × desempenho × evasão do relatório do PI.
 * ==========================================================================*/
app.get('/api/analise', exigirPerfil('analise'), async (req, res, next) => {
  try {
    const fim = parseData(req.query.fim, true) || new Date();
    const inicio = parseData(req.query.inicio) || new Date(fim.getTime() - 7 * 24 * 3600 * 1000);
    const salas = await estatisticasPeriodo(inicio, fim);
    res.json({ inicio, fim, salas });
  } catch (err) { next(err); }
});

/* ============================================================================
 * POST /api/relatorio-semanal/testar — dispara o relatório agora (admin)
 * Útil para demonstração ao orientador sem esperar segunda-feira às 7h.
 * ==========================================================================*/
app.post('/api/relatorio-semanal/testar', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const texto = await montarRelatorioSemanal();
    const envio = await enviarWhatsApp(texto);
    res.json({ texto, envio });
  } catch (err) { next(err); }
});

/* ============================================================================
 * JOBS DE AGREGAÇÃO E RETENÇÃO
 * ==========================================================================*/

const SQL_AGREGAR = `
INSERT INTO agregados_hora (sala, hora, amostras,
  temperatura_avg, temperatura_min, temperatura_max,
  umidade_avg, umidade_min, umidade_max,
  co2_avg, co2_min, co2_max,
  pm1_avg, pm25_avg, pm25_min, pm25_max, pm4_avg, pm10_avg,
  voc_avg, voc_min, voc_max, nox_avg, luz_avg)
SELECT sala, date_trunc('hour', data_hora), count(*)::int,
  avg(temperatura)::real, min(temperatura), max(temperatura),
  avg(umidade)::real, min(umidade), max(umidade),
  avg(co2)::real, min(co2), max(co2),
  avg(pm1)::real, avg(pm25)::real, min(pm25), max(pm25), avg(pm4)::real, avg(pm10)::real,
  avg(voc)::real, min(voc), max(voc), avg(nox)::real, avg(luz)::real
FROM leituras
WHERE data_hora >= $1 AND data_hora < $2
GROUP BY sala, date_trunc('hour', data_hora)
ON CONFLICT (sala, hora) DO UPDATE SET
  amostras = EXCLUDED.amostras,
  temperatura_avg = EXCLUDED.temperatura_avg, temperatura_min = EXCLUDED.temperatura_min, temperatura_max = EXCLUDED.temperatura_max,
  umidade_avg = EXCLUDED.umidade_avg, umidade_min = EXCLUDED.umidade_min, umidade_max = EXCLUDED.umidade_max,
  co2_avg = EXCLUDED.co2_avg, co2_min = EXCLUDED.co2_min, co2_max = EXCLUDED.co2_max,
  pm1_avg = EXCLUDED.pm1_avg, pm25_avg = EXCLUDED.pm25_avg, pm25_min = EXCLUDED.pm25_min, pm25_max = EXCLUDED.pm25_max,
  pm4_avg = EXCLUDED.pm4_avg, pm10_avg = EXCLUDED.pm10_avg,
  voc_avg = EXCLUDED.voc_avg, voc_min = EXCLUDED.voc_min, voc_max = EXCLUDED.voc_max,
  nox_avg = EXCLUDED.nox_avg, luz_avg = EXCLUDED.luz_avg
`;

/** Consolida as horas completas das últimas 48 h. Roda a cada 10 minutos. */
async function jobAgregacao() {
  try {
    const fim = new Date(); fim.setUTCMinutes(0, 0, 0);          // só horas completas
    const inicio = new Date(fim.getTime() - 48 * 3600 * 1000);
    await pool.query(SQL_AGREGAR, [inicio, fim]);
  } catch (err) {
    console.error('[job agregação]', err.message);
  }
}

/** Consolida e apaga brutos além da retenção. Roda a cada 24 h (e no boot). */
async function jobRetencao() {
  try {
    const cutoff = cutoffRetencao();
    await pool.query(SQL_AGREGAR, [new Date(0), cutoff]);        // garante que nada se perde
    const r = await pool.query('DELETE FROM leituras WHERE data_hora < $1', [cutoff]);
    if (r.rowCount > 0) console.log(`[job retenção] ${r.rowCount} leituras brutas consolidadas e removidas.`);
  } catch (err) {
    console.error('[job retenção]', err.message);
  }
}

/* ============================================================================
 * ERROS E INICIALIZAÇÃO
 * ==========================================================================*/
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

app.use((err, req, res, next) => {
  console.error('[erro]', err.message);
  res.status(500).json({ erro: 'Erro interno' });
});

const encerrar = async () => {
  console.log('Encerrando…');
  await pool.end().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);

initDb()
  .then(async () => {
    await seedAdmin();
    jobRetencao();
    setInterval(jobAgregacao, 10 * 60 * 1000);
    setInterval(jobRetencao, 24 * 3600 * 1000);
    setInterval(jobRelatorioSemanal, 3600 * 1000);   // Fase 4: segunda 7h (SP)
    app.listen(PORT, () => console.log(`[api] School Air backend ouvindo na porta ${PORT}`));
  })
  .catch((err) => {
    console.error('Falha ao inicializar o banco:', err.message);
    process.exit(1);
  });
