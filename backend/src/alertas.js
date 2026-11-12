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
 * ENVIO CONSOLIDADO (decisão do dono em 15/09/2026): alertas não saem um a
 * um — entram em FILAS e viram UMA mensagem agrupada por flush, para não
 * inundar o WhatsApp quando várias salas degradam juntas:
 *   - fila CRÍTICA (só CO₂ crítico): flush a cada ALERTA_CRITICO_SEGUNDOS
 *     (padrão 20 s) — rapidez preservada, mas várias salas críticas no mesmo
 *     ciclo viram uma mensagem só;
 *   - fila DIGEST (todo o resto + normalizações): flush a cada
 *     ALERTA_DIGEST_SEGUNDOS (padrão 300 s = 5 min).
 * Se TODOS os envios de um flush falharem, a fila é MANTIDA e tenta de novo
 * na próxima rodada — foi a falta de retry que calou os alertas quando o
 * gateway quebrou em 15/09/2026. O transporte é o mesmo de antes (Evolution
 * da stack, ou gateway n8n quando N8N_WEBHOOK_URL está definida), para cada
 * destinatário ativo da tabela `destinatarios`; o resultado fica em
 * alertas.destinatarios/erro_envio e aparece na aba Incidentes.
 */
import { pool } from './db.js';
import { FilaDeEventosDeAlerta, criarAgendadorDeDescargas } from './filaAlertas.js';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'escola';
const DASHBOARD_URL = process.env.DASHBOARD_URL || '';

/**
 * MODO GATEWAY (desenvolvimento):
 * Se N8N_WEBHOOK_URL estiver definida, os envios NÃO vão para a Evolution da
 * stack — vão como POST { numero, texto } para esse webhook do n8n, que faz a
 * entrega pela Evolution já existente do ambiente. Em produção a variável fica
 * vazia e tudo funciona pela Evolution própria da stack, como sempre.
 */
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';

const COOLDOWN_MIN = 30;        // 1 alerta a cada 30 min por sala/parâmetro/nível
const GAP_MAX_SEG = 180;        // intervalo > 3 min entre leituras quebra a "sequência ruim"
// Texto gravado em alertas.erro_envio enquanto o aviso ainda não saiu.
const MARCA_NA_FILA = 'na fila de envio';
// O gateway n8n agora só responde DEPOIS da Evolution (que simula "digitando"
// por 3 s). Com 10 s, um envio lento era dado como falho e saía em dobro.
const TEMPO_LIMITE_ENVIO_MS = 20000;

// Consolidação (pisos de segurança: crítica nunca abaixo de 5 s, digest de 60 s)
const CRITICO_SEG = Math.max(5, Number(process.env.ALERTA_CRITICO_SEGUNDOS) || 20);
const DIGEST_SEG = Math.max(60, Number(process.env.ALERTA_DIGEST_SEGUNDOS) || 300);

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
 * Envia um texto para UM número/grupo, pelo transporte ativo:
 * gateway n8n (N8N_WEBHOOK_URL definida) ou Evolution da stack.
 * Retorna { ok, erro? } — nunca lança exceção.
 */
export async function enviarTextoPara(numero, texto) {
  const usaGateway = N8N_WEBHOOK_URL.length > 0;
  if (!usaGateway && !EVOLUTION_API_KEY) {
    return { ok: false, erro: 'EVOLUTION_API_KEY não configurada' };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEMPO_LIMITE_ENVIO_MS);
    const resp = await fetch(
      usaGateway
        ? N8N_WEBHOOK_URL
        : `${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`,
      {
        method: 'POST',
        headers: usaGateway
          ? { 'Content-Type': 'application/json' }
          : { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
        body: usaGateway
          ? JSON.stringify({ numero, texto })          // contrato do gateway n8n
          : JSON.stringify({ number: numero, text: texto, delay: 3000 }), // contrato da Evolution (delay = presença "digitando", melhora a entrega)
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (resp.ok) return { ok: true };
    const corpo = await resp.text().catch(() => '');
    return { ok: false, erro: `HTTP ${resp.status} ${corpo.slice(0, 120)}` };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

/**
 * Envia um texto para todos os destinatários ativos.
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

  for (let i = 0; i < destinatarios.length; i++) {
    // Pausa entre destinatários: rajada instantânea é padrão de robô para o
    // anti-spam do WhatsApp (mensagem fica no 1 check e não chega).
    if (i > 0) await new Promise((r) => setTimeout(r, 2000));
    const d = destinatarios[i];
    const r = await enviarTextoPara(d.numero, texto);
    if (r.ok) resultado.enviados.push(d.numero);
    else resultado.erros.push(`${d.numero}: ${r.erro}`);
  }
  return resultado;
}

/** Só o CO₂ crítico tem pressa (≤ 1 min); todo o resto vai no digest. */
function ehEventoDaFilaCritica(evento) {
  return evento.tipo === 'alerta' && evento.parametro === 'co2' && evento.nivel === 'critico';
}

function enfileirarEvento(evento) {
  (ehEventoDaFilaCritica(evento) ? filaCritica : filaDigest).enfileirar(evento);
}

function linhaEvento(e) {
  const valor = fmtValor(e.valor, e.unidade);
  return e.tipo === 'alerta'
    ? `• ${e.salaNome} — ${NOMES_PARAM[e.parametro]} ${valor} há ${e.minutos} min (${e.limiteDesc})`
    : `• ${e.salaNome} — ${NOMES_PARAM[e.parametro]} ${valor}`;
}

export function montarMensagem(eventos, ehCritica) {
  const alertas = eventos.filter((e) => e.tipo === 'alerta');
  const normalizados = eventos.filter((e) => e.tipo === 'normalizado');
  const partes = [];
  if (ehCritica) {
    partes.push('🚨 *CO₂ CRÍTICO — ventilar imediatamente*');
    partes.push(...alertas.map(linhaEvento));
    partes.push(REGRAS[0].recomendacao);
  } else {
    if (alertas.length) {
      partes.push(`⚠️ *Qualidade do ar — ${alertas.length} condição(ões) em alerta*`);
      partes.push(...alertas.map(linhaEvento));
    }
    if (normalizados.length) {
      partes.push('✅ *Normalizado:*');
      partes.push(...normalizados.map(linhaEvento));
    }
  }
  if (DASHBOARD_URL) partes.push(`Painel: ${DASHBOARD_URL}`);
  return partes.join('\n');
}

/**
 * Grava nos incidentes quem recebeu e o que falhou (aba Incidentes do painel).
 * Se TODOS os envios falharam, a fila é mantida e a próxima rodada tenta de novo.
 */
async function gravarResultadoNosAlertas(idsDosAlertas, envio) {
  await pool.query(
    'UPDATE alertas SET destinatarios = $2, erro_envio = $3 WHERE id = ANY($1)',
    [idsDosAlertas, envio.enviados.join(',') || null, envio.erros.join(' | ') || null]
  );
  if (envio.enviados.length === 0) console.warn('[alertas] fila mantida para retry:', envio.erros.join(' | '));
}

/**
 * Filas de consolidação: chave sala:parametro:nivel:tipo → evento mais
 * recente (a lógica de descarga e o porquê dela estão em filaAlertas.js).
 */
function criarFilaDeAlertas(ehCritica) {
  return new FilaDeEventosDeAlerta({
    ehCritica,
    montarTextoDaMensagem: montarMensagem,
    enviarParaDestinatarios: enviarWhatsApp,
    registrarResultadoDoEnvio: gravarResultadoNosAlertas,
  });
}
const filaDigest = criarFilaDeAlertas(false);
const filaCritica = criarFilaDeAlertas(true);

// serializa os flushes (envio pode levar >20 s)
const agendarDescarga = criarAgendadorDeDescargas((mensagem) => console.error(mensagem));

// unref(): os timers não seguram o processo vivo em scripts e testes
setInterval(() => agendarDescarga(filaCritica), CRITICO_SEG * 1000).unref();
setInterval(() => agendarDescarga(filaDigest), DIGEST_SEG * 1000).unref();

/**
 * Monta o evento de fila a partir de uma linha da tabela `alertas`.
 * Devolve null se a regra daquele parâmetro/nível não existe mais.
 */
function eventoDeAlertaPendente(linha) {
  const regra = REGRAS.find((r) => r.parametro === linha.parametro && r.nivel === linha.nivel);
  if (!regra) return null;
  return {
    tipo: 'alerta', alertaId: linha.id, sala: linha.sala, salaNome: linha.sala_nome,
    parametro: regra.parametro, nivel: regra.nivel, valor: linha.valor,
    unidade: regra.unidade, limiteDesc: regra.limiteDesc,
    minutos: regra.janelaMin + Math.round(linha.minutos_na_fila),
  };
}

/**
 * Recoloca na fila os alertas que estavam aguardando envio quando o processo
 * caiu. As filas vivem só na memória: sem isto, todo restart/redeploy do
 * container apagava os avisos pendentes e eles ficavam para sempre como
 * "na fila de envio" na aba Incidentes. Só os últimos 30 min — avisar de algo
 * mais antigo que isso confundiria mais do que ajudaria.
 * Chamar UMA vez, na subida do servidor. Retorna quantos voltaram para a fila.
 *
 * Exemplo de uso:
 *   const recolocados = await reenfileirarAlertasPendentes();
 */
export async function reenfileirarAlertasPendentes() {
  const { rows: pendentes } = await pool.query(
    `SELECT a.id::int AS id, a.sala, s.nome AS sala_nome, a.parametro, a.nivel, a.valor,
            EXTRACT(EPOCH FROM (now() - a.enviado_em)) / 60 AS minutos_na_fila
     FROM alertas a JOIN salas s ON s.id = a.sala
     WHERE a.erro_envio = $1 AND a.normalizado_em IS NULL
       AND a.enviado_em > now() - ($2 || ' minutes')::interval`,
    [MARCA_NA_FILA, COOLDOWN_MIN]
  );
  const eventos = pendentes.map(eventoDeAlertaPendente).filter(Boolean);
  eventos.forEach(enfileirarEvento);
  return eventos.length;
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
      enfileirarEvento({
        tipo: 'normalizado', sala, salaNome,
        parametro: regra.parametro, nivel: regra.nivel,
        valor: atual[regra.parametro], unidade: regra.unidade, limiteDesc: regra.limiteDesc,
      });
      console.log(`[alertas] ${salaNome}: ${regra.parametro}/${regra.nivel} normalizado (sai no próximo digest).`);
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
      const mensagem = linhaEvento({
        tipo: 'alerta', salaNome, parametro: regra.parametro,
        valor, unidade: regra.unidade, minutos, limiteDesc: regra.limiteDesc,
      });

      // O registro nasce "na fila"; o flush consolida a mensagem única e
      // atualiza destinatarios/erro_envio deste id (Incidentes fica fiel).
      const { rows: criado } = await pool.query(
        `INSERT INTO alertas (sala, parametro, nivel, valor, limite, mensagem, destinatarios, erro_envio)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
         RETURNING id::int AS id`,
        [sala, regra.parametro, regra.nivel, valor, regra.limiteDesc, mensagem, MARCA_NA_FILA]
      );
      enfileirarEvento({
        tipo: 'alerta', alertaId: criado[0].id, sala, salaNome,
        parametro: regra.parametro, nivel: regra.nivel,
        valor, unidade: regra.unidade, minutos, limiteDesc: regra.limiteDesc,
      });
      const nomeFila = (regra.parametro === 'co2' && regra.nivel === 'critico') ? 'crítica' : 'digest';
      console.log(`[alertas] ${salaNome}: ${regra.parametro}/${regra.nivel} na fila ${nomeFila}.`);
    }
  } catch (err) {
    console.error('[alertas] falha na avaliação:', err.message);
  }
}
