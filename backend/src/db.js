/**
 * ============================================================================
 * db.js — Conexão com o PostgreSQL, criação do schema e seed inicial
 * ============================================================================
 *
 * O backend é "stateless": TODO o estado vive aqui no banco.
 * O schema é criado automaticamente na subida (CREATE TABLE IF NOT EXISTS),
 * então não há passo manual de migração para o escopo das Fases 1-2.
 *
 * Tabelas:
 *   salas           → cadastro das salas monitoradas
 *   leituras        → cada POST do ESP32 vira uma linha (dados brutos)
 *   agregados_hora  → médias/mín/máx por hora (mantidos para sempre;
 *                     os brutos são apagados após RETENCAO_DIAS)
 *   destinatarios   → números/grupos de WhatsApp que recebem alertas (Fase 2;
 *                     cadastro pelo portal chega na Fase 3 — por ora, seed
 *                     via variável de ambiente ALERTA_NUMEROS)
 *   alertas         → histórico de incidentes: cada disparo de alerta,
 *                     com status de envio e de normalização
 */
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

/** Dias de retenção das leituras brutas (agregados por hora são permanentes). */
export const RETENCAO_DIAS = Number(process.env.RETENCAO_DIAS) > 0
  ? Number(process.env.RETENCAO_DIAS)
  : 90;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS salas (
  id        INT PRIMARY KEY,
  nome      TEXT NOT NULL,
  token     TEXT,                                -- token do dispositivo (usado a partir da Fase 3/4)
  ativa     BOOLEAN NOT NULL DEFAULT TRUE,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leituras (
  id          BIGSERIAL PRIMARY KEY,
  sala        INT NOT NULL REFERENCES salas(id),
  data_hora   TIMESTAMPTZ NOT NULL DEFAULT now(),
  temperatura REAL,
  umidade     REAL,
  co2         INT,
  pm1         REAL,
  pm25        REAL,
  pm4         REAL,
  pm10        REAL,
  voc         REAL,
  nox         REAL,
  luz         INT
);

-- Índice que atende as consultas por sala + data/período (Fase 1)
CREATE INDEX IF NOT EXISTS idx_leituras_sala_data
  ON leituras (sala, data_hora DESC);

CREATE TABLE IF NOT EXISTS agregados_hora (
  sala            INT NOT NULL REFERENCES salas(id),
  hora            TIMESTAMPTZ NOT NULL,
  amostras        INT NOT NULL,
  temperatura_avg REAL, temperatura_min REAL, temperatura_max REAL,
  umidade_avg     REAL, umidade_min REAL, umidade_max REAL,
  co2_avg         REAL, co2_min INT,  co2_max INT,
  pm1_avg         REAL,
  pm25_avg        REAL, pm25_min REAL, pm25_max REAL,
  pm4_avg         REAL,
  pm10_avg        REAL,
  voc_avg         REAL, voc_min REAL, voc_max REAL,
  nox_avg         REAL,
  luz_avg         REAL,
  PRIMARY KEY (sala, hora)
);

-- Fase 2: quem recebe os alertas no WhatsApp
CREATE TABLE IF NOT EXISTS destinatarios (
  id        SERIAL PRIMARY KEY,
  nome      TEXT NOT NULL DEFAULT '',
  numero    TEXT NOT NULL UNIQUE,   -- individual: 5511999999999 · grupo: 120363...@g.us
  ativo     BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fase 2: histórico de incidentes (cada alerta disparado)
CREATE TABLE IF NOT EXISTS alertas (
  id             BIGSERIAL PRIMARY KEY,
  sala           INT NOT NULL REFERENCES salas(id),
  parametro      TEXT NOT NULL,     -- co2, pm25, voc, temperatura, umidade
  nivel          TEXT NOT NULL,     -- alto | critico
  valor          REAL,
  limite         TEXT,
  mensagem       TEXT,
  destinatarios  TEXT,              -- números que receberam, separados por vírgula
  erro_envio     TEXT,              -- NULL = envio ok; senão, detalhe das falhas
  enviado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  normalizado_em TIMESTAMPTZ        -- NULL = condição ainda ativa
);

CREATE INDEX IF NOT EXISTS idx_alertas_sala_data
  ON alertas (sala, enviado_em DESC);

-- Fase 3: contas de acesso ao portal (perfis: visualizacao | analise | admin)
CREATE TABLE IF NOT EXISTS usuarios (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  usuario    TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  perfil     TEXT NOT NULL DEFAULT 'visualizacao',
  ativo      BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/** Seed: as 10 salas iniciais (mesmos nomes do frontend). */
const SALAS_INICIAIS = [
  [1, 'Sala 1'], [2, 'Sala 2'], [3, 'Sala 3'], [4, 'Sala 4'], [5, 'Sala 5'],
  [6, 'Sala 6'], [7, 'Sala 7'], [8, 'Sala 8'], [9, 'Sala 9'], [10, 'Sala 10'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Inicializa o banco com tentativas de reconexão.
 * Necessário porque, no docker-compose, o Postgres pode demorar alguns
 * segundos para aceitar conexões mesmo com healthcheck.
 */
export async function initDb({ tentativas = 15, intervaloMs = 3000 } = {}) {
  let ultimoErro;
  for (let i = 1; i <= tentativas; i++) {
    try {
      await pool.query('SELECT 1');
      await pool.query(SCHEMA);
      for (const [id, nome] of SALAS_INICIAIS) {
        await pool.query(
          'INSERT INTO salas (id, nome) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
          [id, nome]
        );
      }

      // Destinatários iniciais dos alertas via env (o portal assume na Fase 3)
      const numeros = (process.env.ALERTA_NUMEROS || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      for (const numero of numeros) {
        await pool.query(
          `INSERT INTO destinatarios (nome, numero)
           VALUES ('Configurado via ALERTA_NUMEROS', $1)
           ON CONFLICT (numero) DO NOTHING`,
          [numero]
        );
      }
      if (numeros.length) console.log(`[db] ${numeros.length} destinatário(s) do .env garantidos.`);

      console.log(`[db] Schema pronto. Retenção de brutos: ${RETENCAO_DIAS} dias.`);
      return;
    } catch (err) {
      ultimoErro = err;
      console.warn(`[db] Tentativa ${i}/${tentativas} falhou: ${err.message}`);
      await sleep(intervaloMs);
    }
  }
  throw ultimoErro;
}
