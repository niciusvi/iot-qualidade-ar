/**
 * MODOS DE OPERAÇÃO:
 *
 *   MODO SIMULAÇÃO (MODO_SIMULACAO = true):
 *     O ESP32 atua como "Master Simulator" — ignora sensores físicos
 *     e gera dados fictícios para TODAS as 10 salas, enviando 10 POSTs
 *     separados por ciclo. Útil para testar o Dashboard sem hardware.
 *     Neste modo, a variável SALA_PERTENCENTE é ignorada.
 *
 *   MODO PRODUÇÃO (MODO_SIMULACAO = false):
 *     O ESP32 lê sensores reais (I2C + Analógico) e envia dados para
 *     UMA ÚNICA sala, definida por SALA_PERTENCENTE. Em produção,
 *     cada sala da escola terá seu próprio ESP32 configurado com um
 *     número de sala diferente (1, 2, 3... 10).
 *
 * ARQUITETURA MULTI-SALA:
 *
 *   Escola com 10 salas = 10 ESP32 (um por sala)
 *   Cada ESP32 envia dados para /api/salaX (onde X = SALA_PERTENCENTE)
 *   O Dashboard na Vercel exibe todas as 10 salas simultaneamente
 *
 *   Produção:
 *   ┌─ ESP32 Sala 1  ──POST──▶ /api/sala1
 *   ├─ ESP32 Sala 2  ──POST──▶ /api/sala2
 *   ├─ ESP32 Sala 3  ──POST──▶ /api/sala3
 *   │  ...
 *   └─ ESP32 Sala 10 ──POST──▶ /api/sala10
 *
 *   Simulação (1 único ESP32 faz tudo):
 *   ┌─ ESP32 "Master" ──POST──▶ /api/sala1
 *   │                  ──POST──▶ /api/sala2
 *   │                  ──POST──▶ /api/sala3
 *   │                     ...
 *   │                  ──POST──▶ /api/sala10
 *   └─ (10 POSTs por ciclo)
 *
 * ============================================================================
 */

#include <WiFi.h>        // Biblioteca nativa para gerenciar a conexão Wi-Fi do ESP32.
#include <HTTPClient.h>  // Permite criar requisições HTTP (como o POST) para enviar dados à nuvem.
#include <WebServer.h>   // Instancia um servidor web interno no ESP32, permitindo acesso local via navegador.

// DESCOMENTE ESTAS LINHAS QUANDO INSTALAR OS SENSORES REAIS (Hardware)
// #include <Wire.h>               // Protocolo de comunicação I2C, exigido pelos sensores abaixo.
// #include <SensirionI2CSen5x.h>  // Biblioteca do sensor SEN5x (Particulados, VOC, NOx).
// #include <SensirionI2CScd4x.h>  // Biblioteca do sensor SCD4x (CO2, Temperatura, Umidade).


/**
 * ============================================================================
 * CONFIGURAÇÃO PRINCIPAL — ALTERE ESTAS VARIÁVEIS CONFORME A NECESSIDADE
 * ============================================================================
 */

/**
 * MODO_SIMULACAO:
 *   true  → Gera dados fictícios para 10 salas (teste sem hardware)
 *   false → Lê sensores reais e envia para UMA sala específica
 *
 * Mude para 'false' quando instalar o ESP32 fisicamente em uma sala da escola.
 */
bool MODO_SIMULACAO = true;

/**
 * SALA_PERTENCENTE:
 * Número da sala onde ESTE ESP32 está instalado (de 1 a 10).
 *
 * ATENÇÃO: Esta variável SÓ é usada no MODO PRODUÇÃO (MODO_SIMULACAO = false).
 * No modo simulação, o ESP32 envia para TODAS as 10 salas automaticamente.
 *
 * COMO CONFIGURAR EM PRODUÇÃO:
 *   - ESP32 da Sala 1: SALA_PERTENCENTE = 1
 *   - ESP32 da Sala 2: SALA_PERTENCENTE = 2
 *   - ESP32 da Sala 3: SALA_PERTENCENTE = 3
 *   - ... e assim por diante até 10
 *
 * Cada ESP32 é gravado com um número diferente antes de ser instalado.
 */
int SALA_PERTENCENTE = 1;

/**
 * TOTAL_SALAS:
 * Número total de salas da escola.
 * Usado no modo simulação para saber quantos POSTs enviar por ciclo.
 */
const int TOTAL_SALAS = 10;

/**
 * --- CONFIGURAÇÃO DE REDE ESTÁTICA ---
 * Descomente as linhas abaixo caso precise contornar problemas de DHCP (ex: Sophos Firewall).
 * IMPORTANTE: No C++, a classe IPAddress usa VÍRGULAS (,) para separar os octetos, não pontos (.).
 */
IPAddress local_IP(192, 168, X, X);
IPAddress gateway(192, 168, X, X);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(192, 168, X, X);
IPAddress secondaryDNS(8, 8, 8, 8);

// Credenciais da rede Wi-Fi
const char* ssid = "xxxxxx";
const char* password = "xxxxxx";

/**
 * BASE_URL:
 * URL base do servidor Vercel. Os endpoints individuais de cada sala
 * serão construídos concatenando "/api/sala" + número da sala.
 *
 */
const char* BASE_URL = "https://XXXXXX.vercel.app/api/sala";

// Mapeamento dos Pinos do ESP32 utilizados pelos sensores
const int PINO_I2C_SDA = 21; // Pino de dados do barramento I2C
const int PINO_I2C_SCL = 22; // Pino de clock do barramento I2C
const int PINO_LDR = 34;     // Pino analógico para o sensor de luminosidade

// DESCOMENTE AS LINHAS ABAIXO PARA CRIAR OS OBJETOS DE HARDWARE
// SensirionI2CSen5x sen5x;
// SensirionI2CScd4x scd4x;

// Cria o objeto 'server' configurado para escutar a porta 80 (padrão para tráfego web/HTTP)
WebServer server(80);

// Variáveis globais de estado que armazenam a leitura do ciclo atual.
// Inicializadas com zero para evitar envio de "lixo de memória" antes da primeira leitura.
float t_temp = 0.0, t_umid = 0.0;
int t_co2 = 0, t_pm1 = 0, t_pm25 = 0, t_pm4 = 0, t_pm10 = 0, t_voc = 0, t_nox = 0, t_luz = 0;

/**
 * Estrutura customizada para o Histórico Local (Struct).
 * Agrupa variáveis relacionadas para otimizar o uso da memória RAM.
 */
struct RegistroHistorico {
  unsigned long timestamp; // Tempo em milissegundos em que a leitura ocorreu
  float temp;
  float umid;
  int co2;
};

/**
 * CONFIGURAÇÃO DO BUFFER CIRCULAR
 * O ESP32 tem RAM limitada. Não podemos salvar dados infinitamente.
 * Um buffer circular (ou fila circular) sobrescreve os dados mais antigos
 * quando atinge o limite, mantendo sempre as leituras mais recentes sem estourar a memória.
 */
const int MAX_HISTORICO = 144; // 144 registros = 12 horas (com 1 leitura a cada 5 minutos)
RegistroHistorico historico[MAX_HISTORICO]; // Array (vetor) criado na memória RAM
int indiceHistorico = 0; // Aponta para a posição atual vazia no vetor
bool historicoCheio = false; // Fica 'true' quando o vetor dá a primeira volta completa

/**
 * CONTROLE DE TEMPO NÃO-BLOQUEANTE
 * Em vez de usar delay() - que paralisa o processador e derruba o servidor web local -
 * usamos millis() (tempo desde que a placa ligou) para checar se já está na hora de rodar a tarefa.
 *
 * INTERVALO_VERCEL = 30 segundos:
 * O handshake TLS/SSL consome ~3 segundos de CPU a cada envio.
 * Com 30s de intervalo, a carga cai para ~10%, liberando o processador para o servidor web local.
 *
 * IMPORTANTE NO MODO SIMULAÇÃO:
 * São 10 POSTs por ciclo (um para cada sala). Cada POST leva ~3 segundos (SSL).
 * Total por ciclo: ~30 segundos de processamento.
 * Por isso o intervalo de 30s é o mínimo recomendado no modo simulação.
 */
unsigned long ultimoEnvioVercel = 0;
unsigned long ultimoSalvoHistorico = 0;
unsigned long ultimaLeituraSensores = 0;
const unsigned long INTERVALO_VERCEL = 30000;       // Envio para Vercel a cada 30 segundos
const unsigned long INTERVALO_HISTORICO = 300000;    // Gravação na RAM a cada 5 minutos
const unsigned long INTERVALO_LEITURA = 30000;       // Leitura dos sensores a cada 30 segundos

/**
 * FLAG DE CONTROLE: Indica se o ESP32 está no meio de um POST para a Vercel.
 * Usado para dar feedback visual no painel local.
 */
bool enviandoVercel = false;


/**
 * ============================================================================
 * INTERFACE WEB LOCAL (HTML/JS/CSS)
 * ============================================================================
 *
 * PROGMEM: Salva na memória Flash (não na RAM)
 * 100% autossuficiente: Zero CDNs, zero dependências externas
 *
 * ATUALIZAÇÃO MULTI-SALA:
 * O painel local mostra apenas os dados DESTE ESP32 específico
 * (seja a sala real em produção ou a última sala simulada).
 * Para ver todas as 10 salas, use o Dashboard na Vercel.
 */
const char paginaHTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ESP32 - Painel Local</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#121212;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;max-width:900px;margin:0 auto;line-height:1.5;}
h1{color:#7c9ef7;font-size:22px;font-weight:700;margin-bottom:6px;}
.subtitle{color:#9e9e9e;font-size:13px;margin-bottom:24px;}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;}
@media(max-width:600px){.grid{grid-template-columns:1fr;}}
.card{background:#1e1e1e;border:1px solid #333;border-radius:12px;padding:20px;}
.card h2{font-size:14px;font-weight:600;color:#9e9e9e;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #333;padding-bottom:10px;margin-bottom:14px;}
.row{display:flex;justify-content:space-between;padding:5px 0;font-size:14px;}
.row .label{color:#9e9e9e;} .row .value{font-weight:600;}
.c-temp{color:#e57373;} .c-umid{color:#81c784;} .c-co2{color:#ffb74d;} .c-luz{color:#7c9ef7;}
.secondary{display:flex;flex-wrap:wrap;gap:16px;margin-top:10px;font-size:13px;}
.secondary span{color:#9e9e9e;} .secondary strong{color:#bdbdbd;}
.chart-wrap{background:#1e1e1e;border:1px solid #333;border-radius:12px;padding:20px;}
.chart-wrap h2{font-size:14px;font-weight:600;color:#9e9e9e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:16px;}
canvas{width:100%!important;height:220px!important;display:block;}
.legend{display:flex;gap:20px;margin-top:12px;font-size:12px;color:#9e9e9e;}
.legend-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle;}
.status-bar{margin-top:20px;padding:12px 16px;background:#1e1e1e;border:1px solid #333;border-radius:8px;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#9e9e9e;}
.ok{color:#81c784;} .err{color:#e57373;}
.countdown{font-size:11px;color:#666;margin-left:12px;}
.modo-badge{display:inline-block;padding:4px 12px;border-radius:12px;font-size:11px;font-weight:600;margin-bottom:16px;}
.modo-sim{background:rgba(255,183,77,0.15);color:#ffb74d;}
.modo-prod{background:rgba(129,199,132,0.15);color:#81c784;}
</style>
</head>
<body>
<h1>ESP32 — Diagnostico Local</h1>
<p class="subtitle">Painel interno · Atualiza a cada 30s · Sem dependencias externas</p>
<div id="modo-badge" class="modo-badge modo-sim">Modo: Carregando...</div>

<div class="grid">
  <div class="card">
    <h2>Sistema</h2>
    <div class="row"><span class="label">IP Local</span><span class="value" id="sys-ip">--</span></div>
    <div class="row"><span class="label">Chip</span><span class="value" id="sys-chip">--</span></div>
    <div class="row"><span class="label">RAM Livre</span><span class="value" id="sys-ram">--</span></div>
    <div class="row"><span class="label">Uptime</span><span class="value" id="sys-uptime">--</span></div>
    <div class="row"><span class="label">Sala</span><span class="value" id="sys-sala">--</span></div>
  </div>
  <div class="card">
    <h2>Sensores (Atual)</h2>
    <div class="row"><span class="label">Temperatura</span><span class="value c-temp" id="val-temp">--</span></div>
    <div class="row"><span class="label">Umidade</span><span class="value c-umid" id="val-umid">--</span></div>
    <div class="row"><span class="label">CO2</span><span class="value c-co2" id="val-co2">--</span></div>
    <div class="row"><span class="label">Luminosidade</span><span class="value c-luz" id="val-luz">--</span></div>
    <div class="secondary">
      <div><span>VOC: </span><strong id="val-voc">--</strong></div>
      <div><span>NOx: </span><strong id="val-nox">--</strong></div>
      <div><span>PM2.5: </span><strong id="val-pm25">--</strong></div>
    </div>
  </div>
</div>

<div class="chart-wrap">
  <h2>Historico (Ultimas 12h)</h2>
  <canvas id="chart"></canvas>
  <div class="legend">
    <div><span class="legend-dot" style="background:#e57373;"></span>Temperatura (C)</div>
    <div><span class="legend-dot" style="background:#81c784;"></span>Umidade (%)</div>
    <div><span class="legend-dot" style="background:#ffb74d;"></span>CO2 (ppm)</div>
  </div>
</div>

<div class="status-bar">
  <span><span id="status-msg">Aguardando primeira leitura...</span><span class="countdown" id="countdown"></span></span>
  <span id="status-time">--</span>
</div>

<script>
var INTERVALO=30000,proximoUpdate=0;
function formatUptime(ms){var s=Math.floor(ms/1000),h=Math.floor(s/3600);s%=3600;var m=Math.floor(s/60);s%=60;return h+'h '+String(m).padStart(2,'0')+'m '+String(s).padStart(2,'0')+'s';}
function formatTime(ms){var s=Math.floor(ms/1000),h=Math.floor(s/3600);s%=3600;var m=Math.floor(s/60);return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');}
function drawChart(data){var canvas=document.getElementById('chart'),ctx=canvas.getContext('2d'),dpr=window.devicePixelRatio||1,rect=canvas.getBoundingClientRect();canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;ctx.scale(dpr,dpr);var W=rect.width,H=rect.height,padL=50,padR=55,padT=10,padB=30,plotW=W-padL-padR,plotH=H-padT-padB;ctx.clearRect(0,0,W,H);if(!data||data.length<2){ctx.fillStyle='#666';ctx.font='13px sans-serif';ctx.textAlign='center';ctx.fillText('Aguardando historico (minimo 2 pontos)...',W/2,H/2);return;}var temps=data.map(function(d){return d.temp;}),umids=data.map(function(d){return d.umid;}),co2s=data.map(function(d){return d.co2;});var tempMin=Math.min.apply(null,temps)-2,tempMax=Math.max.apply(null,temps)+2,co2Min=Math.min.apply(null,co2s)-50,co2Max=Math.max.apply(null,co2s)+50,umidMin=Math.min.apply(null,umids)-5,umidMax=Math.max.apply(null,umids)+5;if(tempMax-tempMin<1){tempMin-=5;tempMax+=5;}if(co2Max-co2Min<1){co2Min-=100;co2Max+=100;}if(umidMax-umidMin<1){umidMin-=10;umidMax+=10;}function yTemp(v){return padT+plotH*(1-(v-tempMin)/(tempMax-tempMin));}function yUmid(v){return padT+plotH*(1-(v-umidMin)/(umidMax-umidMin));}function yCO2(v){return padT+plotH*(1-(v-co2Min)/(co2Max-co2Min));}function xPos(i){return padL+(i/(data.length-1))*plotW;}ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=1;ctx.setLineDash([4,4]);for(var g=0;g<=4;g++){var gy=padT+(plotH/4)*g;ctx.beginPath();ctx.moveTo(padL,gy);ctx.lineTo(padL+plotW,gy);ctx.stroke();}ctx.setLineDash([]);ctx.fillStyle='#e57373';ctx.font='11px sans-serif';ctx.textAlign='right';for(var g=0;g<=4;g++){var val=tempMin+((tempMax-tempMin)/4)*(4-g),gy=padT+(plotH/4)*g;ctx.fillText(val.toFixed(0)+'C',padL-6,gy+4);}ctx.fillStyle='#ffb74d';ctx.textAlign='left';for(var g=0;g<=4;g++){var val=co2Min+((co2Max-co2Min)/4)*(4-g),gy=padT+(plotH/4)*g;ctx.fillText(val.toFixed(0),padL+plotW+6,gy+4);}ctx.fillStyle='#666';ctx.textAlign='center';ctx.font='10px sans-serif';var step=Math.max(1,Math.floor(data.length/8));for(var i=0;i<data.length;i+=step){ctx.fillText(formatTime(data[i].tempo),xPos(i),H-6);}ctx.fillText(formatTime(data[data.length-1].tempo),xPos(data.length-1),H-6);function drawLine(values,yFn,color){ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.lineJoin='round';for(var i=0;i<values.length;i++){var x=xPos(i),y=yFn(values[i]);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();if(values.length<=50){ctx.fillStyle=color;for(var i=0;i<values.length;i++){ctx.beginPath();ctx.arc(xPos(i),yFn(values[i]),2.5,0,Math.PI*2);ctx.fill();}}}drawLine(co2s,yCO2,'#ffb74d');drawLine(umids,yUmid,'#81c784');drawLine(temps,yTemp,'#e57373');}
function update(){var controller=new AbortController();var timeout=setTimeout(function(){controller.abort();},5000);fetch('/api',{signal:controller.signal}).then(function(r){clearTimeout(timeout);return r.json();}).then(function(d){document.getElementById('sys-ip').textContent=d.sistema.ip;document.getElementById('sys-chip').textContent=d.sistema.chip;document.getElementById('sys-ram').textContent=(d.sistema.ramLivre/1024).toFixed(1)+' KB';document.getElementById('sys-uptime').textContent=formatUptime(d.sistema.uptime);document.getElementById('sys-sala').textContent=d.sistema.sala;var badge=document.getElementById('modo-badge');if(d.sistema.simulacao){badge.className='modo-badge modo-sim';badge.textContent='Modo: Simulacao (10 salas)';}else{badge.className='modo-badge modo-prod';badge.textContent='Modo: Producao (Sala '+d.sistema.sala+')';}document.getElementById('val-temp').textContent=d.atual.temperatura.toFixed(1)+' C';document.getElementById('val-umid').textContent=d.atual.umidade.toFixed(1)+' %';document.getElementById('val-co2').textContent=d.atual.co2+' ppm';document.getElementById('val-luz').textContent=d.atual.luz+' lx';document.getElementById('val-voc').textContent=d.atual.voc;document.getElementById('val-nox').textContent=d.atual.nox;document.getElementById('val-pm25').textContent=d.atual.pm25;drawChart(d.historico);var now=new Date();var ts=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');document.getElementById('status-msg').className='ok';document.getElementById('status-msg').textContent='Conectado';document.getElementById('status-time').textContent='Atualizado: '+ts;proximoUpdate=INTERVALO/1000;}).catch(function(e){document.getElementById('status-msg').className='err';document.getElementById('status-msg').textContent='Falha: '+(e.name==='AbortError'?'ESP32 ocupado (SSL)':e.message);proximoUpdate=INTERVALO/1000;});}
setInterval(function(){if(proximoUpdate>0){proximoUpdate--;document.getElementById('countdown').textContent=' (proximo em '+proximoUpdate+'s)';}},1000);
update();setInterval(update,INTERVALO);
window.addEventListener('resize',function(){update();});
</script>
</body>
</html>
)rawliteral";


/**
 * ============================================================================
 * HANDLERS DO SERVIDOR WEB (Callbacks)
 * Estas funções são acionadas automaticamente quando um navegador acessa o IP.
 * ============================================================================
 */

/**
 * handleRoot(): Responde à rota principal "/".
 * Quando o usuário digita apenas o IP, o ESP32 devolve o arquivo HTML com status 200 (OK).
 */
void handleRoot() {
  server.send(200, "text/html", paginaHTML);
}

/**
 * handleApiLocal(): Responde à rota "/api".
 *
 * VERSÃO MULTI-SALA:
 * Agora inclui informações sobre o modo de operação (simulação/produção)
 * e a sala pertencente, para que o painel local exiba corretamente.
 *
 * Usa sendContent() chunked para não estourar a memória com Strings grandes.
 */
void handleApiLocal() {
  char buf[256];

  // Inicia resposta HTTP chunked
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "application/json", "");

  // 1. Bloco do Sistema — agora inclui sala e modo de operação
  snprintf(buf, sizeof(buf),
    "{\"sistema\":{\"ip\":\"%s\",\"chip\":\"%s\",\"ramLivre\":%u,\"uptime\":%lu,\"sala\":%d,\"simulacao\":%s},",
    WiFi.localIP().toString().c_str(),
    ESP.getChipModel(),
    ESP.getFreeHeap(),
    millis(),
    SALA_PERTENCENTE,
    MODO_SIMULACAO ? "true" : "false"
  );
  server.sendContent(buf);

  // 2. Bloco com a última leitura dos sensores
  snprintf(buf, sizeof(buf),
    "\"atual\":{\"temperatura\":%.1f,\"umidade\":%.1f,\"co2\":%d,\"voc\":%d,\"nox\":%d,\"pm25\":%d,\"luz\":%d},",
    t_temp, t_umid, t_co2, t_voc, t_nox, t_pm25, t_luz
  );
  server.sendContent(buf);

  // 3. Bloco do Histórico Local (buffer circular)
  server.sendContent("\"historico\":[");

  int count = historicoCheio ? MAX_HISTORICO : indiceHistorico;
  int startIdx = historicoCheio ? indiceHistorico : 0;

  for (int i = 0; i < count; i++) {
    int idx = (startIdx + i) % MAX_HISTORICO;
    snprintf(buf, sizeof(buf),
      "%s{\"tempo\":%lu,\"temp\":%.1f,\"umid\":%.1f,\"co2\":%d}",
      (i > 0) ? "," : "",
      historico[idx].timestamp,
      historico[idx].temp,
      historico[idx].umid,
      historico[idx].co2
    );
    server.sendContent(buf);

    // Cede processamento ao RTOS a cada 10 registros para evitar WDT reset
    if (i % 10 == 9) yield();
  }

  server.sendContent("]}");
  server.sendContent("");
}


/**
 * ============================================================================
 * FUNÇÃO AUXILIAR: enviarParaVercel(salaNumero, json)
 *
 * PROPÓSITO:
 * Encapsula a lógica de envio HTTP POST para a Vercel em uma função reutilizável.
 * Tanto o modo simulação quanto o modo produção chamam esta mesma função,
 * passando o número da sala e o JSON formatado.
 *
 * COMO A URL É CONSTRUÍDA:
 *   BASE_URL = "https://iot-qualidade-ar.vercel.app/api/sala"
 *   salaNumero = 3
 *   URL final = "https://iot-qualidade-ar.vercel.app/api/sala3"
 *
 * @param salaNumero — Número da sala (1 a 10)
 * @param json       — String JSON com os dados dos sensores
 * ============================================================================
 */
void enviarParaVercel(int salaNumero, const char* json) {
  /**
   * Monta a URL completa concatenando a BASE_URL com o número da sala.
   * Exemplo: "https://...vercel.app/api/sala" + "3" = ".../api/sala3"
   */
  String url = String(BASE_URL) + String(salaNumero);

  HTTPClient http;
  http.begin(url);                                    // Configura o destino da requisição
  http.addHeader("Content-Type", "application/json"); // Informa que o corpo é JSON
  http.setTimeout(8000);                              // Timeout de 8s (evita travar se Vercel lenta)

  int code = http.POST(json);                         // Dispara o POST e recebe o código HTTP

  /**
   * Imprime no Serial Monitor para diagnóstico.
   * Formato: "Sala 3 - POST 200 | RAM: 185432 bytes"
   * Isso ajuda a identificar se alguma sala específica está falhando.
   */
  Serial.printf("Sala %d - POST %d | RAM: %u bytes\n",
    salaNumero, code, ESP.getFreeHeap());

  http.end(); // Libera recursos de rede do microcontrolador
}


/**
 * ============================================================================
 * FUNÇÃO AUXILIAR: gerarDadosSimulados(salaNumero)
 *
 * PROPÓSITO:
 * Gera dados fictícios DIFERENTES para cada sala, criando um cenário
 * realista de monitoramento para testes do Dashboard.
 *
 * COMO GERA DADOS DIFERENTES POR SALA:
 * Usa o número da sala como "offset" (deslocamento) nos valores base.
 * Sala 1: temp base ~22°C, Sala 5: temp base ~26°C, Sala 10: temp base ~31°C
 * Isso faz com que algumas salas fiquem "Excelente", outras "Atenção"
 * e outras "Crítico" — perfeito para testar as cores do Dashboard.
 *
 * @param salaNumero — Número da sala (1 a 10), usado como offset
 * ============================================================================
 */
void gerarDadosSimulados(int salaNumero) {
  /**
   * O offset é calculado a partir do número da sala.
   * Sala 1 → offset 0 (valores normais)
   * Sala 5 → offset 4 (valores moderados)
   * Sala 10 → offset 9 (valores elevados)
   *
   * Isso cria uma progressão: salas com número alto tendem a ter
   * piores condições, exercitando todos os estados do Dashboard.
   */
  int offset = salaNumero - 1;

  /**
   * Temperatura: varia de 20°C (sala 1) a 34°C (sala 10).
   * random(200, 250) gera inteiros entre 200 e 249.
   * Dividido por 10.0, resulta em 20.0 a 24.9°C para a sala 1.
   * O offset de (salaNumero * 10) adiciona 1°C por sala.
   * Sala 1: 20.0-24.9°C (Excelente)
   * Sala 5: 24.0-28.9°C (Atenção)
   * Sala 10: 29.0-33.9°C (Crítico)
   */
  t_temp = random(200, 250 + offset * 10) / 10.0;

  /**
   * Umidade: varia com offset inverso (salas altas = mais seco)
   * Sala 1: 45-65% (Excelente)
   * Sala 10: 20-40% (Crítico)
   */
  t_umid = random(450 - offset * 25, 650 - offset * 25) / 10.0;

  /**
   * CO2: varia de 400ppm (sala 1) a 2000ppm (sala 10)
   * Sala 1-3: 400-800 ppm (Excelente)
   * Sala 4-7: 800-1500 ppm (Atenção)
   * Sala 8-10: 1200-2000 ppm (Crítico)
   */
  t_co2 = random(400 + offset * 80, 800 + offset * 130);

  // Partículas: leve variação por sala
  t_pm1  = random(5 + offset, 15 + offset * 2);
  t_pm25 = random(8 + offset * 2, 20 + offset * 3);
  t_pm4  = random(10 + offset * 2, 25 + offset * 3);
  t_pm10 = random(15 + offset * 3, 35 + offset * 4);

  // VOC e NOx: crescem com o número da sala
  t_voc = random(30 + offset * 15, 80 + offset * 25);
  t_nox = random(5 + offset * 3, 20 + offset * 5);

  // Luminosidade: aleatória independente da sala
  t_luz = random(100, 1000);
}


/**
 * ============================================================================
 * SETUP (Executado apenas uma vez ao ligar a placa)
 * ============================================================================
 */
void setup() {
  Serial.begin(115200); // Inicia o Monitor Serial. Velocidade padrão recomendada pela Espressif.

  delay(1000); // Pequena pausa para garantir que o Monitor Serial do computador "acorde"
  Serial.println("\n\n--- INICIANDO SISTEMA ESP32 ---");
  Serial.println("=== SCHOOL AIR — MULTI-SALA ===");

  /**
   * Exibe as configurações atuais no Serial Monitor para diagnóstico.
   * Isso é especialmente útil quando se tem 10 ESP32 e precisa saber
   * rapidamente qual sala cada um está atendendo.
   */
  Serial.printf("Modo: %s\n", MODO_SIMULACAO ? "SIMULAÇÃO (10 salas)" : "PRODUÇÃO (sala única)");
  if (!MODO_SIMULACAO) {
    Serial.printf("Sala pertencente: %d\n", SALA_PERTENCENTE);
  }

  /**
   * Se usar IP Fixo, este bloco deve estar DESCOMENTADO e vir ANTES do WiFi.begin().
   * Ele aplica a configuração de rede bypassando o servidor DHCP do roteador.
   */
  if (!WiFi.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS)) {
    Serial.println("Falha ao configurar IP Estático!");
  }

  // Inicia a tentativa de conexão Wi-Fi
  WiFi.begin(ssid, password);
  Serial.print("Conectando ao roteador");
  // Trava a execução e imprime pontos enquanto não recebe o status de sucesso da rede
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConexão estabelecida com sucesso!");

  // Imprime no console os dados de rede para depuração (útil para checar falhas de Gateway/DNS)
  Serial.println("--- DIAGNÓSTICO DE REDE ---");
  Serial.print("IP Local:   "); Serial.println(WiFi.localIP());
  Serial.print("Mascara:    "); Serial.println(WiFi.subnetMask());
  Serial.print("Gateway:    "); Serial.println(WiFi.gatewayIP());
  Serial.print("DNS 1:      "); Serial.println(WiFi.dnsIP(0));
  Serial.print("DNS 2:      "); Serial.println(WiFi.dnsIP(1));
  Serial.println("---------------------------");

  // Mapeamento: Diz ao servidor local qual função C++ rodar para cada URL requisitada.
  server.on("/", handleRoot);
  server.on("/api", handleApiLocal);
  // Coloca o servidor efetivamente "no ar"
  server.begin();
  Serial.println("Servidor web local ativo.");

  if (!MODO_SIMULACAO) {
    Serial.println("Modo Produção: Preparando barramento I2C.");
    /*
    Wire.begin(PINO_I2C_SDA, PINO_I2C_SCL);
    sen5x.begin(Wire);
    scd4x.begin(Wire);
    sen5x.startMeasurement();
    scd4x.startPeriodicMeasurement();
    */
  } else {
    Serial.println("Modo Simulação: Geração de dados para 10 salas ativada.");
  }

  // Preenche a posição 0 do buffer do histórico para que a página local já inicie com 1 ponto no gráfico
  historico[indiceHistorico] = {millis(), 0.0, 0.0, 0};
  indiceHistorico++;
  Serial.println("Histórico local inicializado.");

  Serial.printf("Intervalos: Leitura=%lus | Vercel=%lus | Historico=%lus\n",
    INTERVALO_LEITURA / 1000, INTERVALO_VERCEL / 1000, INTERVALO_HISTORICO / 1000);
  Serial.println("--- SISTEMA PRONTO ---\n");
}


/**
 * ============================================================================
 * LOOP (Executado continuamente enquanto a placa estiver ligada)
 *
 * FLUXO MULTI-SALA:
 *
 *   1. server.handleClient() — Mantém o painel web local funcionando
 *   2. TAREFA 1 — Leitura dos sensores (a cada 30s)
 *   3. TAREFA 2 — Envio para Vercel (a cada 30s)
 *      - Simulação: loop de 1 a 10, gera dados + POST para cada sala
 *      - Produção: lê sensores reais + POST apenas para SALA_PERTENCENTE
 *   4. TAREFA 3 — Salvar no histórico local (a cada 5 minutos)
 *
 * ============================================================================
 */
void loop() {
  // ATENÇÃO: Esta linha é vital. Sem ela, o servidor web não processa os acessos do navegador.
  server.handleClient();

  unsigned long agora = millis(); // Coleta o "relógio atual" do sistema

  // --------------------------------------------------------------------------
  // TAREFA 1: Ler Sensores a cada 30 segundos (apenas modo PRODUÇÃO)
  //
  // No modo SIMULAÇÃO, a leitura é feita dentro do loop de envio (Tarefa 2)
  // porque cada sala precisa de dados diferentes.
  //
  // No modo PRODUÇÃO, lemos os sensores aqui para que os dados estejam
  // disponíveis tanto para o envio à Vercel quanto para o painel local.
  // --------------------------------------------------------------------------
  if (!MODO_SIMULACAO && (agora - ultimaLeituraSensores >= INTERVALO_LEITURA)) {
    ultimaLeituraSensores = agora;

    /*
     * LEITURA DOS SENSORES REAIS (descomente quando o hardware estiver conectado)
     *
     * t_luz = analogRead(PINO_LDR);
     * uint16_t scd4x_co2 = 0; float scd4x_temp = 0.0f, scd4x_hum = 0.0f;
     * scd4x.readMeasurement(scd4x_co2, scd4x_temp, scd4x_hum);
     * t_co2 = scd4x_co2; t_temp = scd4x_temp; t_umid = scd4x_hum;
     * float pm1p0 = 0.0, pm2p5 = 0.0, pm4p0 = 0.0, pm10p0 = 0.0;
     * float sen_hum = 0.0, sen_temp = 0.0, vocIndex = 0.0, noxIndex = 0.0;
     * sen5x.readMeasuredValues(pm1p0, pm2p5, pm4p0, pm10p0, sen_hum, sen_temp, vocIndex, noxIndex);
     * t_pm1 = (int)pm1p0; t_pm25 = (int)pm2p5; t_pm4 = (int)pm4p0; t_pm10 = (int)pm10p0;
     * t_voc = (int)vocIndex; t_nox = (int)noxIndex;
     */

    Serial.printf("Leitura real: T=%.1f U=%.1f CO2=%d VOC=%d PM25=%d Luz=%d\n",
      t_temp, t_umid, t_co2, t_voc, t_pm25, t_luz);
  }


  // --------------------------------------------------------------------------
  // TAREFA 2: Enviar para Nuvem (Vercel) a cada 30 segundos
  //
  // MODO SIMULAÇÃO (Master Simulator):
  //   O ESP32 faz um loop de 1 a 10, gerando dados fictícios diferentes
  //   para cada sala e enviando 10 POSTs separados.
  //   Isso permite testar o Dashboard inteiro com um único ESP32.
  //
  //   ATENÇÃO: 10 POSTs com SSL = ~30 segundos de processamento.
  //   Durante esse tempo, o painel web local fica lento.
  //   Isso é esperado e aceitável em modo de teste.
  //
  // MODO PRODUÇÃO:
  //   O ESP32 envia apenas UM POST para a sala definida em SALA_PERTENCENTE.
  //   Leva apenas ~3 segundos. O painel local fica responsivo.
  // --------------------------------------------------------------------------
  if (agora - ultimoEnvioVercel >= INTERVALO_VERCEL) {
    ultimoEnvioVercel = agora;

    if (WiFi.status() == WL_CONNECTED) {
      enviandoVercel = true;

      if (MODO_SIMULACAO) {
        /**
         * =============================
         * MODO SIMULAÇÃO — 10 SALAS
         * =============================
         *
         * Loop de sala 1 até sala 10:
         * Para cada sala:
         *   1. Gera dados simulados usando a função gerarDadosSimulados()
         *      (que usa o número da sala como offset para variar os valores)
         *   2. Formata os dados em JSON
         *   3. Envia via POST para /api/salaX
         *   4. Cede controle ao RTOS (yield) para evitar watchdog timeout
         *
         * O yield() entre cada POST é CRÍTICO:
         * Sem ele, o ESP32 ficaria 30+ segundos sem alimentar o watchdog,
         * causando um reboot automático (WDT reset).
         */
        Serial.println("\n--- SIMULAÇÃO: Enviando dados para 10 salas ---");

        for (int sala = 1; sala <= TOTAL_SALAS; sala++) {
          // 1. Gera dados fictícios específicos para esta sala
          gerarDadosSimulados(sala);

          // 2. Formata o JSON com os dados gerados
          char json[500];
          snprintf(json, sizeof(json),
            "{\"temperatura\":%.1f,\"umidade\":%.1f,\"co2\":%d,\"pm1\":%d,\"pm25\":%d,\"pm4\":%d,\"pm10\":%d,\"voc\":%d,\"nox\":%d,\"luz\":%d}",
            t_temp, t_umid, t_co2, t_pm1, t_pm25, t_pm4, t_pm10, t_voc, t_nox, t_luz);

          // 3. Envia para o endpoint da sala correspondente
          enviarParaVercel(sala, json);

          // 4. Cede processamento ao RTOS entre cada POST
          //    Isso permite que o watchdog seja alimentado e que
          //    o server.handleClient() processe requests pendentes
          yield();

          /**
           * Processa requests web pendentes entre cada POST.
           * Sem isso, se alguém acessar o painel local durante o envio
           * das 10 salas, a requisição ficaria travada por ~30 segundos.
           * Com esta linha, o servidor responde nos intervalos entre POSTs.
           */
          server.handleClient();
        }

        Serial.println("--- SIMULAÇÃO: Todos os 10 envios concluídos ---\n");

      } else {
        /**
         * =============================
         * MODO PRODUÇÃO — 1 SALA ÚNICA
         * =============================
         *
         * Lê os sensores reais (já feito na Tarefa 1 acima)
         * e envia APENAS para a sala definida em SALA_PERTENCENTE.
         *
         * Exemplo: se SALA_PERTENCENTE = 3,
         * envia para https://...vercel.app/api/sala3
         */
        char json[500];
        snprintf(json, sizeof(json),
          "{\"temperatura\":%.1f,\"umidade\":%.1f,\"co2\":%d,\"pm1\":%d,\"pm25\":%d,\"pm4\":%d,\"pm10\":%d,\"voc\":%d,\"nox\":%d,\"luz\":%d}",
          t_temp, t_umid, t_co2, t_pm1, t_pm25, t_pm4, t_pm10, t_voc, t_nox, t_luz);

        enviarParaVercel(SALA_PERTENCENTE, json);
      }

      enviandoVercel = false;

    } else {
      Serial.println("Erro: Wi-Fi desconectado, não foi possível enviar à Vercel.");
    }
  }


  // --------------------------------------------------------------------------
  // TAREFA 3: Salvar leitura no Histórico Local (RAM) a cada 5 minutos
  //
  // Este histórico alimenta o gráfico do painel web local (acessível via IP).
  // Ele guarda apenas dados DESTE ESP32 (não de todas as salas).
  // --------------------------------------------------------------------------
  if (agora - ultimoSalvoHistorico >= INTERVALO_HISTORICO) {
    ultimoSalvoHistorico = agora;
    // Grava a leitura atual na posição apontada pelo índice
    historico[indiceHistorico] = {agora, t_temp, t_umid, t_co2};
    indiceHistorico++;
    // Verifica se chegou ao fim do limite alocado na RAM
    if (indiceHistorico >= MAX_HISTORICO) {
      indiceHistorico = 0;     // Retorna o ponteiro para o início do array
      historicoCheio = true;   // Avisa o resto do código que as voltas subsequentes irão sobrescrever dados antigos
    }
    Serial.println("Snapshot salvo no buffer local da RAM.");
  }
}
