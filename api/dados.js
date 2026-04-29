// Variável global temporária.
// Em arquitetura serverless (Vercel), esta memória é volátil e será resetada 
// caso o contêiner fique ocioso por alguns minutos.
let memoriaTemporaria = [];

export default function handler(req, res) {
  // Configuração de CORS: Permite que o frontend acesse a API sem bloqueios de segurança do navegador
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Tratamento para requisições de preflight do navegador
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Lógica POST: Rota utilizada pelo ESP32 para enviar novas leituras
  if (req.method === 'POST') {
    const registro = {
      ...req.body, // Desestrutura o JSON recebido do ESP32
      id: memoriaTemporaria.length + 1,
      data: new Date().toISOString() // Adiciona o timestamp oficial do servidor
    };

    // Adiciona a nova leitura no início do array
    memoriaTemporaria.unshift(registro);

    // Garante que o array mantenha apenas os últimos 50 registros para evitar estouro de memória (OOM)
    if (memoriaTemporaria.length > 50) {
      memoriaTemporaria.pop();
    }

    return res.status(200).json({ status: "ok", registro });
  }

  // Lógica GET: Rota utilizada pelo frontend (index.html) para carregar o dashboard
  if (req.method === 'GET') {
    // Caso a memória tenha sido resetada pela Vercel ou o ESP32 não tenha enviado dados,
    // retorna um array com dados de fallback completos para a interface não quebrar com 'undefined'.
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

    // Retorna os dados reais em memória
    return res.status(200).json(memoriaTemporaria);
  }

  // Se o método recebido não for GET, POST ou OPTIONS, retorna erro de método não permitido
  return res.status(405).json({ error: "Método não permitido" });
}
