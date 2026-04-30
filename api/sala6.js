/**
 * ============================================================================
 * ENDPOINT: /api/sala1
 * PROJETO:  School Air — Monitor Ambiental Escolar (Multi-Sala)
 * ============================================================================
 *
 * COMO FUNCIONA:
 * Este arquivo é uma "Serverless Function" da Vercel.
 * Cada sala da escola tem seu próprio arquivo (sala1.js, sala2.js... sala10.js),
 * cada um com sua memória independente e isolada.
 *
 * PARA CRIAR OS OUTROS 9 ENDPOINTS:
 *   1. Copie este arquivo inteiro
 *   2. Renomeie para sala2.js, sala3.js, ..., sala10.js
 *   3. Não precisa mudar NADA no código interno — cada arquivo
 *      já terá sua própria variável 'memoriaTemporaria' isolada
 *      porque cada Serverless Function roda em container separado.
 *
 * ROTAS GERADAS AUTOMATICAMENTE PELA VERCEL (baseado no nome do arquivo):
 *   GET  https://seu-projeto.vercel.app/api/sala1  → Retorna os dados
 *   POST https://seu-projeto.vercel.app/api/sala1  → Recebe novos dados
 *
 * MÉTODOS HTTP ACEITOS:
 *   GET     → Retorna o array com os registros (mais recente primeiro)
 *   POST    → Recebe um JSON do ESP32, adiciona timestamp e salva
 *   OPTIONS → Responde ao preflight CORS do navegador
 *
 * LIMITAÇÃO IMPORTANTE (ENTENDA ANTES DE MEXER):
 *   A memória de Serverless Functions é EFÊMERA (volátil).
 *   Se a Vercel "dormir" a função por inatividade (~15min sem requests),
 *   os dados são perdidos e o array volta a ficar vazio.
 *   Para persistência permanente, seria necessário um banco de dados
 *   (MongoDB Atlas, Supabase, etc). Para monitoramento em tempo real
 *   onde o ESP32 envia dados a cada 30s, isso raramente acontece
 *   porque o container se mantém "quente" (ativo).
 */

/**
 * memoriaTemporaria:
 * Array que armazena as leituras desta sala específica.
 *
 * O 'let' declarado FORA da função handler faz com que a variável
 * persista entre chamadas HTTP enquanto o container Vercel estiver "quente".
 * Quando o container "dorme" (cold start), o array é resetado para [].
 *
 * Cada arquivo (sala1.js, sala2.js...) tem seu PRÓPRIO container,
 * então os dados de salas diferentes NUNCA se misturam.
 */
let memoriaTemporaria = [];

/**
 * LIMITE_REGISTROS:
 * Número máximo de leituras mantidas na memória.
 *
 * CÁLCULO:
 *   1 registro a cada 30 segundos = 120 registros/hora
 *   120 × 48 horas = 5.760 registros para cobrir 48h de histórico
 *   5.760 registros × ~200 bytes cada ≈ 1.1 MB de RAM
 *
 * Isso é seguro para o limite de 1024 MB do container serverless.
 * Se notar lentidão na resposta GET (JSON muito grande), reduza para:
 *   - 2880 (24h) ou 1440 (12h)
 */
const LIMITE_REGISTROS = 5760;

/**
 * handler(req, res):
 * Função principal chamada automaticamente pela Vercel a cada request HTTP.
 *
 * @param {Object} req — Objeto da requisição (method, body, query, headers)
 * @param {Object} res — Objeto da resposta (status, json, setHeader)
 */
export default function handler(req, res) {

  /**
   * CORS (Cross-Origin Resource Sharing):
   * Headers que permitem que o navegador acesse esta API de qualquer domínio.
   *
   * POR QUE É NECESSÁRIO?
   * O navegador bloqueia requests entre domínios diferentes por segurança.
   * Se o HTML está em "meusite.vercel.app" e a API em "meusite.vercel.app/api",
   * normalmente funciona (mesmo domínio). Mas durante desenvolvimento local
   * (localhost:5500 → vercel.app), o CORS é obrigatório.
   * Deixamos '*' (qualquer origem) para simplicidade.
   */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  /**
   * Tratamento do método OPTIONS (Preflight Request):
   * Navegadores modernos enviam um OPTIONS automático antes de cada POST
   * para verificar se o servidor aceita CORS. Respondemos 200 OK vazio.
   * Se não tratarmos isso, o POST do ESP32 pode ser bloqueado.
   */
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  /**
   * ============================
   * MÉTODO POST — Receber dados
   * ============================
   * Chamado pelo ESP32 a cada 30 segundos.
   * O ESP32 envia um JSON como este:
   *   {
   *     "temperatura": 24.5,
   *     "umidade": 55.0,
   *     "co2": 850,
   *     "pm1": 10, "pm25": 12, "pm4": 15, "pm10": 18,
   *     "voc": 80, "nox": 15, "luz": 300
   *   }
   *
   * Nós adicionamos:
   *   - "id": número sequencial para identificação
   *   - "data": timestamp ISO 8601 do servidor Vercel
   *
   * Usamos o relógio do SERVIDOR (Vercel) e não do ESP32 porque
   * o ESP32 não tem RTC (relógio de tempo real) — o millis() dele
   * reseta a cada reboot e não sabe a hora do dia.
   */
  if (req.method === 'POST') {
    const registro = {
      ...req.body,                       // Copia todos os campos do JSON recebido (spread operator)
      id: memoriaTemporaria.length + 1,  // ID sequencial simples
      data: new Date().toISOString()     // Timestamp ISO 8601 do servidor
    };

    // Insere no INÍCIO do array (índice 0) → dado mais recente é sempre [0]
    memoriaTemporaria.unshift(registro);

    // Mantém apenas os últimos LIMITE_REGISTROS para não estourar memória (OOM)
    if (memoriaTemporaria.length > LIMITE_REGISTROS) {
      memoriaTemporaria = memoriaTemporaria.slice(0, LIMITE_REGISTROS);
    }

    return res.status(200).json({
      status: "ok",
      registros: memoriaTemporaria.length,
      registro
    });
  }

  /**
   * ============================
   * MÉTODO GET — Consultar dados
   * ============================
   * Chamado pelo Frontend (Dashboard HTML) para buscar as leituras.
   *
   * Se a memória estiver vazia (container acabou de acordar / cold start),
   * retorna um array com UM registro de fallback com valores neutros.
   * Isso evita que o Frontend quebre com erros de 'undefined' ao tentar
   * acessar data[0].temperatura quando o array está vazio.
   */
  if (req.method === 'GET') {
    if (memoriaTemporaria.length === 0) {
      return res.status(200).json([{
        id: 1,
        temperatura: 24.5,
        umidade: 55.0,
        co2: 450,
        pm1: 10,
        pm25: 12,
        pm4: 15,
        pm10: 18,
        voc: 80,
        nox: 15,
        luz: 300,
        data: new Date().toISOString()
      }]);
    }

    return res.status(200).json(memoriaTemporaria);
  }

  /**
   * Se o método não for GET, POST ou OPTIONS, retorna erro 405.
   * Isso protege contra métodos inesperados (PUT, DELETE, PATCH).
   */
  return res.status(405).json({ error: "Método não permitido" });
}
