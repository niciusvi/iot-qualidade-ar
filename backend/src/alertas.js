/**
 * ============================================================================
 * alertas.js — Motor de alertas WhatsApp (v2 / Fase 2)
 * ============================================================================
 *
 * REGRAS DE DISPARO (decisão do orientador em 02/09/2026):
 *   - CO₂ CRÍTICO  (> 3000 ppm, risco de mal-estar/desmaio) → alerta em ≤ 1 min
 *   - CO₂ ALTO     (> 1500 ppm)                             → alerta em ≤ 5 min
 *   - Demais parâmetros em nível crítico (PM2.5 > 35 µg/m³, VOC > 200,
 *     temperatura fora de 18–26 °C, umidade fora de 30–70%) → alerta em ≤ 10 min
 *
 * A condição precisa PERSISTIR pela janela inteira (leituras consecutivas
 * ruins) — um pico isolado de 30 s não dispara nada.
 *
 * ANTI-SPAM: no máximo 1 alerta a cada 30 min por sala/parâmetro/nível.
 * (por nível, e não por sala, para permitir o escalonamento alto → crítico
 * dentro da mesma meia hora — um risco maior nunca fica silenciado)
 *
 * NORMALIZAÇÃO: quando o parâmetro volta ao nível seguro, o alerta aberto é
 * fechado e uma mensagem de "normalizado" é enviada.
 *
 * ENVIO: HTTP POST para a Evolution API da própria stack
 *   {EVOLUTION_API_URL}/message/sendText/{EVOLUTION_INSTANCE}
 * para cada destinatário ativo da tabela `destinatarios`.
 * Falhas de envio NÃO são perdidas: ficam registradas em alertas.erro_envio
 * e aparecem na aba Incidentes do dashboard.
 */
import { pool } from './db.js';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'escola';
const DASHBOARD_URL = process.env.DASHBOARD_URL || '';

const COOLDOWN_MIN = 30;        // 1 alerta a cada 30 min por sala/parâmetro/nível
const GAP_MAX_SEG = 180;        // intervalo > 3 min entre leituras quebra a "sequência ruim"

/** Regras em ordem de prioridade (crítico primeiro). */
export const REGRAS = [
  {
    parametro: 'co2', nivel: 'critico', janelaMin: 1,
    teste: (v) => v != null && v > 3000,
    limiteDesc: 'limite 3000 ppm',
    unidade: 'ppm',
    recomendacao: 'Evacuar/ventilar a sala IMEDIATAMENTE (abrir janelas e portas). Risco de mal-estar e desmaio.',
  },
  {
    parametro: 'co2', nivel: 'alto', janelaMin: 5,
    teste: (v) => v != null && v > 1500,
    limiteDesc: 'limite 1500 ppm',
    unidade: 'ppm',
    recomendacao: 'Abrir janelas e portas para renovar o ar.',
  },
  {
    parametro: 'pm25', nivel: 'critico', janelaMin: 10,
    teste: (v) => v != null && v > 35,
    limiteDesc: 'limite 35 µg/m³',
    unidade: 'µg/m³',
    recomendacao: 'Verificar fontes de poeira/fumaça e ventilar o ambiente.',
  },
  {
    parametro: 'voc', nivel: 'critico', janelaMin: 10,
    teste: (v) => v != null && v > 200,
    limiteDesc: 'índice limite 200',
    unidade: '',
    recomendacao: 'Ventilar e verificar produtos químicos (limpeza, tintas, colas).',
  },
  {
    parametro: 'temperatura', nivel: 'critico', janelaMin: 10,
    teste: (v) => v != null && (v < 18 || v > 26),
    limiteDesc: 'faixa segura 18–26 °C',
    unidade: '°C',
    recomendacao: 'Ajustar climatização/ventilação da sala.',
  },
  {
    parametro: 'umidade', nivel: 'critico', janelaMin: 10,
    teste: (v) => v != null && (v < 30 || v > 70),
    limiteDesc: 'faixa segura 30–70%',
    unidade: '%',
    recomendacao: 'Ajustar ventilação (umidade fora da faixa favorece mofo ou resseca as vias aéreas).',
  },
];

const NOMES_PARAM = {
  co2: 'CO₂', pm25: 'PM2.5', voc: 'VOC', temperatura: 'Temperatura', umidade: 'Umidade',
};

/**
 * Envia um texto para todos os destinatários ativos via Evolution API.
 * Retorna { enviados: [...], erros: [...] } — nunca lança exceção.
 */
export async function enviarWhatsApp(texto) {
  const { rows: destinatarios } = await pool.query(
    'SELECT numero, nome FROM destinatarios WHERE ativo ORDER BY id'
  );
  const resultado = { enviados: [], erros: [] };

  if (destinatarios.length === 0) {
    resultado.erros.push('nenhum destinatário cadastrado');
    return resultado;
  }
  if (!EVOLUTION_API_KEY) {
    resultado.erros.push('EVOLUTION_API_KEY não configurada');
    return resultado;
  }

  for (const d of destinatarios) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(
        `${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
          body: JSON.stringify({ number: d.numero, text: texto }),
          signal: controller.signal,
        }
      );
      clearTimeout(timer);
      if (resp.ok) {
        resultado.enviados.push(d.numero);
      } else {
        const corpo = await resp.text().catch(() => '');
        resultado.erros.push(`${d.numero}: HTTP ${resp.status} ${corpo.slice(0, 120)}`);
      }
    } catch (err) {
      resultado.erros.push(`${d.numero}: ${err.message}`);
    }
  }
  return resultado;
}

/** Duração (ms) da sequência ininterrupta de leituras ruins terminando na mais recente. */
function duracaoStreak(leituras, regra) {
  if (leituras.length === 0 || !regra.teste(leituras[0][regra.parametro])) return -1;
  let inicio = new Date(leituras[0].data_hora);
  let anterior = inicio;
  for (let i = 1; i < leituras.length; i++) {
    const l = leituras[i];
    const t = new Date(l.data_hora);
    if (!regra.teste(l[regra.parametro])) break;               // leitura boa quebra a sequência
    if ((anterior - t) / 1000 > GAP_MAX_SEG) break;            // buraco de coleta quebra a sequência
    inicio = t;
    anterior = t;
  }
  return new Date(leituras[0].data_hora) - inicio;
}

function fmtValor(v, unidade) {
  const n = Number(v);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return unidade ? `${s} ${unidade}` : s;
}

/**
 * Avalia as regras de alerta para uma sala. Chamada após cada POST de leitura.
 * Nunca lança exceção (erros são logados) para não afetar a ingestão.
 */
export async function avaliarAlertas(sala) {
  try {
    // Leituras dos últimos 11 min (janela máxima é 10 min), mais recente primeiro
    const { rows: leituras } = await pool.query(
      `SELECT data_hora, temperatura, umidade, co2, pm25, voc
       FROM leituras
       WHERE sala = $1 AND data_hora > now() - interval '11 minutes'
       ORDER BY data_hora DESC`,
      [sala]
    );
    if (leituras.length === 0) return;
    const atual = leituras[0];

    const { rows: salaRows } = await pool.query('SELECT nome FROM salas WHERE id = $1', [sala]);
    const salaNome = salaRows[0]?.nome || `Sala ${sala}`;

    // Alertas ainda abertos desta sala (não normalizados)
    const { rows: abertos } = await pool.query(
      'SELECT id, parametro, nivel FROM alertas WHERE sala = $1 AND normalizado_em IS NULL',
      [sala]
    );

    // ---- 1. NORMALIZAÇÃO: fecha alertas cuja condição cessou ----
    for (const alerta of abertos) {
      const regra = REGRAS.find((r) => r.parametro === alerta.parametro && r.nivel === alerta.nivel);
      if (!regra || regra.teste(atual[regra.parametro])) continue;   // ainda ruim → mantém aberto

      await pool.query('UPDATE alertas SET normalizado_em = now() WHERE id = $1', [alerta.id]);
      const msg = `✅ ${salaNome}: ${NOMES_PARAM[regra.parametro]} normalizado ` +
        `(${fmtValor(atual[regra.parametro], regra.unidade)}, ${regra.limiteDesc}).`;
      const envio = await enviarWhatsApp(msg);
      if (envio.erros.length) console.warn('[alertas] normalização não enviada:', envio.erros.join(' | '));
      console.log(`[alertas] ${salaNome}: ${regra.parametro}/${regra.nivel} normalizado.`);
    }

    // ---- 2. NOVOS ALERTAS: condição persistente + cooldown ----
    for (const regra of REGRAS) {
      // Já existe alerta aberto deste parâmetro+nível → episódio em andamento
      if (abertos.some((a) => a.parametro === regra.parametro && a.nivel === regra.nivel)) continue;

      const duracao = duracaoStreak(leituras, regra);
      if (duracao < regra.janelaMin * 60 * 1000) continue;

      // Anti-spam: 1 alerta a cada 30 min por sala/parâmetro/nível
      const { rows: recentes } = await pool.query(
        `SELECT 1 FROM alertas
         WHERE sala = $1 AND parametro = $2 AND nivel = $3
           AND enviado_em > now() - ($4 || ' minutes')::interval
         LIMIT 1`,
        [sala, regra.parametro, regra.nivel, COOLDOWN_MIN]
      );
      if (recentes.length > 0) continue;

      const valor = atual[regra.parametro];
      const minutos = Math.max(1, Math.round(duracao / 60000));
      const emoji = regra.nivel === 'critico' ? '🚨' : '⚠️';
      const mensagem =
        `${emoji} *${salaNome}* — ${NOMES_PARAM[regra.parametro]} em ${fmtValor(valor, regra.unidade)} ` +
        `há ${minutos} min (${regra.limiteDesc}).\n` +
        `Recomendação: ${regra.recomendacao}` +
        (DASHBOARD_URL ? `\nPainel: ${DASHBOARD_URL}` : '');

      const envio = await enviarWhatsApp(mensagem);
      await pool.query(
        `INSERT INTO alertas (sala, parametro, nivel, valor, limite, mensagem, destinatarios, erro_envio)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sala, regra.parametro, regra.nivel, valor, regra.limiteDesc, mensagem,
          envio.enviados.join(',') || null,
          envio.erros.join(' | ') || null,
        ]
      );
      console.log(
        `[alertas] ${salaNome}: ${regra.parametro}/${regra.nivel} disparado ` +
        `(${envio.enviados.length} enviados, ${envio.erros.length} erros).`
      );
    }
  } catch (err) {
    console.error('[alertas] falha na avaliação:', err.message);
  }
}
