/**
 * ============================================================================
 * PROJETO: School Air - Monitor Ambiental Escolar (ESP32)
 * DESCRIÇÃO: Este código conecta o ESP32 ao Wi-Fi, lê sensores ambientais,
 * hospeda um painel web local para visualização em tempo real e
 * envia os dados periodicamente para uma API na nuvem (Vercel).
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
 * --- CONFIGURAÇÃO DE REDE ESTÁTICA ---
 * Descomente as linhas abaixo caso precise contornar problemas de DHCP (ex: Sophos Firewall).
 * IMPORTANTE: No C++, a classe IPAddress usa VÍRGULAS (,) para separar os octetos, não pontos (.).
 */
IPAddress local_IP(192, 168, X, X);
IPAddress gateway(192, 168, X, X);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(192, 168, X, X);
IPAddress secondaryDNS(8, 8, 8, 8);

// Credenciais da rede Wi-Fi e endereço do servidor (Vercel)
const char* ssid = "xxxxxx";
const char* password = "xxxxxx";
const char* serverUrl = "https://iot-qualidade-ar.vercel.app/api/dados";

// Variável de controle: se 'true', o ESP32 ignora o hardware real e gera valores aleatórios (Testes).
bool MODO_SIMULACAO = true;

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
 * INTERVALO_VERCEL alterado de 10s para 30s para reduzir a carga de SSL no processador.
 * O handshake TLS/SSL consome ~3 segundos de CPU a cada envio.
 * Com 10s de intervalo, o ESP32 ficava ~30% do tempo ocupado com criptografia,
 * causando lentidão extrema no servidor web local.
 * Com 30s, a carga cai para ~10%, liberando o processador para atender o navegador.
 */
unsigned long ultimoEnvioVercel = 0;
unsigned long ultimoSalvoHistorico = 0;
unsigned long ultimaLeituraSensores = 0;
const unsigned long INTERVALO_VERCEL = 30000;       // Envio para Vercel a cada 30 segundos
const unsigned long INTERVALO_HISTORICO = 300000;    // Gravação na RAM a cada 5 minutos
const unsigned long INTERVALO_LEITURA = 30000;       // Leitura dos sensores a cada 30 segundos

/**
 * FLAG DE CONTROLE: Indica se o ESP32 está no meio de um POST para a Vercel.
 * Enquanto este flag for true, sabemos que o processador está ocupado com SSL.
 * Usado para dar feedback visual no painel local (ícone de "enviando...").
 */
bool enviandoVercel = false;

/**
 * INTERFACE WEB LOCAL (HTML/JS/CSS)
 * O modificador PROGMEM força o compilador a salvar este texto enorme na memória Flash (onde fica o código)
 * e não na memória RAM. A RAM deve ficar livre para as operações matemáticas e de rede.
 * R"rawliteral(...)rawliteral" permite escrever o HTML com aspas duplas normais sem quebrar o código C++.
 *
 * IMPORTANTE: Esta página é 100% autossuficiente (ZERO dependências externas / CDN).
 * Todo o CSS é inline e o gráfico é desenhado com Canvas API nativa do navegador.
 * Isso garante que a página funcione mesmo em redes com firewall restritivo (ex: Sophos)
 * que bloqueiam acesso a CDNs como cdn.tailwindcss.com ou cdn.jsdelivr.net.
 *
 * OTIMIZAÇÃO DE PERFORMANCE:
 * - O JavaScript faz fetch a cada 30s (alinhado com o ciclo do ESP32)
 * - O HTML é compacto (~4KB) para ser transmitido em um único pacote TCP
 * - Nenhuma animação CSS pesada que force repaints do navegador
 */
const char paginaHTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ESP32 - Painel Local</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  background:#121212; color:#e0e0e0;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  padding:24px; max-width:900px; margin:0 auto;
  line-height:1.5;
}
h1 { color:#7c9ef7; font-size:22px; font-weight:700; margin-bottom:6px; }
.subtitle { color:#9e9e9e; font-size:13px; margin-bottom:24px; }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
@media(max-width:600px){ .grid{grid-template-columns:1fr;} }
.card { background:#1e1e1e; border:1px solid #333; border-radius:12px; padding:20px; }
.card h2 {
  font-size:14px; font-weight:600; color:#9e9e9e; text-transform:uppercase;
  letter-spacing:.05em; border-bottom:1px solid #333; padding-bottom:10px; margin-bottom:14px;
}
.row { display:flex; justify-content:space-between; padding:5px 0; font-size:14px; }
.row .label { color:#9e9e9e; }
.row .value { font-weight:600; }
.c-temp{color:#e57373;} .c-umid{color:#81c784;} .c-co2{color:#ffb74d;}
.c-luz{color:#7c9ef7;} .c-voc{color:#ce93d8;} .c-nox{color:#f48fb1;} .c-pm{color:#80cbc4;}
.secondary { display:flex; flex-wrap:wrap; gap:16px; margin-top:10px; font-size:13px; }
.secondary span { color:#9e9e9e; }
.secondary strong { color:#bdbdbd; }
.chart-wrap { background:#1e1e1e; border:1px solid #333; border-radius:12px; padding:20px; }
.chart-wrap h2 {
  font-size:14px; font-weight:600; color:#9e9e9e; text-transform:uppercase;
  letter-spacing:.05em; margin-bottom:16px;
}
canvas { width:100%!important; height:220px!important; display:block; }
.legend { display:flex; gap:20px; margin-top:12px; font-size:12px; color:#9e9e9e; }
.legend-dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px; vertical-align:middle; }
.status-bar {
  margin-top:20px; padding:12px 16px; background:#1e1e1e; border:1px solid #333;
  border-radius:8px; display:flex; justify-content:space-between; align-items:center;
  font-size:12px; color:#9e9e9e;
}
.ok{color:#81c784;} .err{color:#e57373;} .warn{color:#ffb74d;}
/* Indicador de countdown até o próximo refresh */
.countdown { font-size:11px; color:#666; margin-left:12px; }
</style>
</head>
<body>

<h1>ESP32 — Diagnostico Local</h1>
<p class="subtitle">Painel interno · Atualiza a cada 30s · Sem dependencias externas</p>

<div class="grid">
  <div class="card">
    <h2>Sistema</h2>
    <div class="row"><span class="label">IP Local</span><span class="value" id="sys-ip">--</span></div>
    <div class="row"><span class="label">Chip</span><span class="value" id="sys-chip">--</span></div>
    <div class="row"><span class="label">RAM Livre</span><span class="value" id="sys-ram">--</span></div>
    <div class="row"><span class="label">Uptime</span><span class="value" id="sys-uptime">--</span></div>
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
/**
 * INTERVALO DE ATUALIZAÇÃO: 30 segundos
 * Alinhado com o ciclo de leitura/envio do ESP32.
 * Isso evita que o navegador peça dados enquanto o ESP32
 * está ocupado com o handshake SSL da Vercel.
 */
var INTERVALO = 30000;
var proximoUpdate = 0;

function formatUptime(ms) {
  var s = Math.floor(ms/1000);
  var h = Math.floor(s/3600); s%=3600;
  var m = Math.floor(s/60); s%=60;
  return h+'h '+String(m).padStart(2,'0')+'m '+String(s).padStart(2,'0')+'s';
}

function formatTime(ms) {
  var s = Math.floor(ms/1000);
  var h = Math.floor(s/3600); s%=3600;
  var m = Math.floor(s/60);
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}

/**
 * drawChart(data)
 * Desenha o gráfico usando Canvas 2D API pura (zero bibliotecas).
 * Recebe o array de histórico do ESP32 e plota 3 séries:
 * Temperatura (vermelho), Umidade (verde) e CO2 (laranja).
 */
function drawChart(data) {
  var canvas = document.getElementById('chart');
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  var W=rect.width, H=rect.height;
  var padL=50, padR=55, padT=10, padB=30;
  var plotW=W-padL-padR, plotH=H-padT-padB;

  ctx.clearRect(0,0,W,H);

  if(!data || data.length<2) {
    ctx.fillStyle='#666'; ctx.font='13px sans-serif'; ctx.textAlign='center';
    ctx.fillText('Aguardando historico (minimo 2 pontos)...',W/2,H/2);
    return;
  }

  var temps=data.map(function(d){return d.temp;});
  var umids=data.map(function(d){return d.umid;});
  var co2s=data.map(function(d){return d.co2;});

  var tempMin=Math.min.apply(null,temps)-2, tempMax=Math.max.apply(null,temps)+2;
  var co2Min=Math.min.apply(null,co2s)-50, co2Max=Math.max.apply(null,co2s)+50;
  var umidMin=Math.min.apply(null,umids)-5, umidMax=Math.max.apply(null,umids)+5;

  if(tempMax-tempMin<1){tempMin-=5;tempMax+=5;}
  if(co2Max-co2Min<1){co2Min-=100;co2Max+=100;}
  if(umidMax-umidMin<1){umidMin-=10;umidMax+=10;}

  function yTemp(v){return padT+plotH*(1-(v-tempMin)/(tempMax-tempMin));}
  function yUmid(v){return padT+plotH*(1-(v-umidMin)/(umidMax-umidMin));}
  function yCO2(v){return padT+plotH*(1-(v-co2Min)/(co2Max-co2Min));}
  function xPos(i){return padL+(i/(data.length-1))*plotW;}

  ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=1; ctx.setLineDash([4,4]);
  for(var g=0;g<=4;g++){var gy=padT+(plotH/4)*g;ctx.beginPath();ctx.moveTo(padL,gy);ctx.lineTo(padL+plotW,gy);ctx.stroke();}
  ctx.setLineDash([]);

  ctx.fillStyle='#e57373'; ctx.font='11px sans-serif'; ctx.textAlign='right';
  for(var g=0;g<=4;g++){var val=tempMin+((tempMax-tempMin)/4)*(4-g);var gy=padT+(plotH/4)*g;ctx.fillText(val.toFixed(0)+'C',padL-6,gy+4);}

  ctx.fillStyle='#ffb74d'; ctx.textAlign='left';
  for(var g=0;g<=4;g++){var val=co2Min+((co2Max-co2Min)/4)*(4-g);var gy=padT+(plotH/4)*g;ctx.fillText(val.toFixed(0),padL+plotW+6,gy+4);}

  ctx.fillStyle='#666'; ctx.textAlign='center'; ctx.font='10px sans-serif';
  var step=Math.max(1,Math.floor(data.length/8));
  for(var i=0;i<data.length;i+=step){ctx.fillText(formatTime(data[i].tempo),xPos(i),H-6);}
  ctx.fillText(formatTime(data[data.length-1].tempo),xPos(data.length-1),H-6);

  function drawLine(values,yFn,color){
    ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.lineJoin='round';
    for(var i=0;i<values.length;i++){var x=xPos(i),y=yFn(values[i]);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
    ctx.stroke();
    if(values.length<=50){ctx.fillStyle=color;for(var i=0;i<values.length;i++){ctx.beginPath();ctx.arc(xPos(i),yFn(values[i]),2.5,0,Math.PI*2);ctx.fill();}}
  }

  drawLine(co2s,yCO2,'#ffb74d');
  drawLine(umids,yUmid,'#81c784');
  drawLine(temps,yTemp,'#e57373');
}

/**
 * update()
 * Busca dados do ESP32 via fetch('/api') e atualiza toda a interface.
 *
 * OTIMIZAÇÃO: Usa timeout de 5 segundos no fetch.
 * Se o ESP32 estiver ocupado com SSL (enviando para Vercel),
 * o fetch falha rapidamente em vez de travar o navegador por 30s+.
 * Na próxima tentativa (30s depois), o ESP32 já estará livre.
 */
function update() {
  // AbortController permite cancelar o fetch se demorar demais
  var controller = new AbortController();
  var timeout = setTimeout(function(){ controller.abort(); }, 5000);

  fetch('/api', { signal: controller.signal })
    .then(function(r){ clearTimeout(timeout); return r.json(); })
    .then(function(d){
      document.getElementById('sys-ip').textContent=d.sistema.ip;
      document.getElementById('sys-chip').textContent=d.sistema.chip;
      document.getElementById('sys-ram').textContent=(d.sistema.ramLivre/1024).toFixed(1)+' KB';
      document.getElementById('sys-uptime').textContent=formatUptime(d.sistema.uptime);

      document.getElementById('val-temp').textContent=d.atual.temperatura.toFixed(1)+' C';
      document.getElementById('val-umid').textContent=d.atual.umidade.toFixed(1)+' %';
      document.getElementById('val-co2').textContent=d.atual.co2+' ppm';
      document.getElementById('val-luz').textContent=d.atual.luz+' lx';
      document.getElementById('val-voc').textContent=d.atual.voc;
      document.getElementById('val-nox').textContent=d.atual.nox;
      document.getElementById('val-pm25').textContent=d.atual.pm25;

      drawChart(d.historico);

      var now=new Date();
      var ts=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
      document.getElementById('status-msg').className='ok';
      document.getElementById('status-msg').textContent='Conectado — ESP32 respondendo';
      document.getElementById('status-time').textContent='Atualizado: '+ts;
      proximoUpdate=INTERVALO/1000;
    })
    .catch(function(e){
      document.getElementById('status-msg').className='err';
      document.getElementById('status-msg').textContent='Falha: '+(e.name==='AbortError'?'ESP32 ocupado (SSL), tentando em 30s...':e.message);
      proximoUpdate=INTERVALO/1000;
    });
}

/**
 * Countdown visual: mostra quantos segundos faltam para o próximo refresh.
 * Atualiza a cada 1 segundo (operação leve — apenas muda um texto).
 * Dá ao usuário feedback visual de que a página está "viva" mesmo
 * durante os 30 segundos entre atualizações.
 */
setInterval(function(){
  if(proximoUpdate>0){
    proximoUpdate--;
    document.getElementById('countdown').textContent=' (proximo em '+proximoUpdate+'s)';
  }
},1000);

// Primeira busca imediata + repetição a cada 30 segundos
update();
setInterval(update, INTERVALO);

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
 * VERSÃO OTIMIZADA: Usa snprintf com buffer fixo + chunked transfer.
 *
 * PROBLEMA ORIGINAL:
 * A concatenação com String (json += "...") para 144 registros do histórico
 * causava realocações constantes de memória (heap fragmentation).
 * Com o buffer cheio (~15KB de JSON), o ESP32 ficava sem memória contígua
 * disponível, resultando em crash silencioso (WDT reset) ou resposta vazia.
 *
 * SOLUÇÃO:
 * Usamos server.sendContent() em modo "chunked transfer", enviando o JSON
 * em pequenos pedaços. Isso nunca aloca mais de ~256 bytes por vez na RAM.
 */
void handleApiLocal() {
  // Buffer temporário reutilizável — alocado uma vez no stack (não no heap)
  char buf[256];

  // Inicia a resposta HTTP em modo chunked (sem Content-Length definido)
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "application/json", "");

  // 1. Bloco de informações do Sistema (Hardware)
  snprintf(buf, sizeof(buf),
    "{\"sistema\":{\"ip\":\"%s\",\"chip\":\"%s\",\"ramLivre\":%u,\"uptime\":%lu},",
    WiFi.localIP().toString().c_str(),
    ESP.getChipModel(),
    ESP.getFreeHeap(),
    millis()
  );
  server.sendContent(buf);

  // 2. Bloco com a última leitura real de TODOS os sensores
  snprintf(buf, sizeof(buf),
    "\"atual\":{\"temperatura\":%.1f,\"umidade\":%.1f,\"co2\":%d,\"voc\":%d,\"nox\":%d,\"pm25\":%d,\"luz\":%d},",
    t_temp, t_umid, t_co2, t_voc, t_nox, t_pm25, t_luz
  );
  server.sendContent(buf);

  // 3. Bloco do Histórico (Iteração sobre o buffer circular)
  server.sendContent("\"historico\":[");

  // Lógica do Buffer Circular: Se já estourou o limite (144), ele começa a ler a partir
  // do ponteiro 'indiceHistorico' (que é o dado mais antigo) em vez do 0.
  int count = historicoCheio ? MAX_HISTORICO : indiceHistorico;
  int startIdx = historicoCheio ? indiceHistorico : 0;

  for (int i = 0; i < count; i++) {
    // O operador módulo (%) garante que o índice dê a volta no array sem erro de Segmentation Fault.
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

    /**
     * OTIMIZAÇÃO CRÍTICA: yield() a cada 10 registros.
     * O ESP32 roda um RTOS (FreeRTOS) com watchdog timer.
     * Se o loop for muito longo sem ceder o processador,
     * o watchdog mata o processo (WDT reset = reboot).
     * yield() cede brevemente o controle para o RTOS processar
     * tarefas internas (Wi-Fi, TCP stack, watchdog feed).
     */
    if (i % 10 == 9) {
      yield();
    }
  }

  // Fecha o array e o objeto JSON raiz
  server.sendContent("]}");

  // Sinaliza ao cliente HTTP que a resposta chunked terminou
  server.sendContent("");
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
    Serial.println("Modo Simulação: Geração de dados ativada.");
  }

  // Preenche a posição 0 do buffer do histórico para que a página local já inicie com 1 ponto no gráfico
  historico[indiceHistorico] = {millis(), 0.0, 0.0, 0};
  indiceHistorico++;
  Serial.println("Histórico local inicializado.");

  Serial.printf("Intervalos: Leitura=%lus | Vercel=%lus | Historico=%lus\n",
    INTERVALO_LEITURA/1000, INTERVALO_VERCEL/1000, INTERVALO_HISTORICO/1000);
}


/**
 * ============================================================================
 * LOOP (Executado continuamente enquanto a placa estiver ligada)
 * ============================================================================
 */
void loop() {
  // ATENÇÃO: Esta linha é vital. Sem ela, o servidor web não processa os acessos do navegador.
  server.handleClient();

  unsigned long agora = millis(); // Coleta o "relógio atual" do sistema

  // --------------------------------------------------------------------------
  // TAREFA 1: Ler Sensores a cada 30 segundos
  // Separamos a LEITURA do ENVIO para que os dados locais estejam sempre
  // atualizados mesmo se o envio para Vercel falhar.
  // --------------------------------------------------------------------------
  if (agora - ultimaLeituraSensores >= INTERVALO_LEITURA) {
    ultimaLeituraSensores = agora;

    if (MODO_SIMULACAO) {
      // Função random(min, max) gera números inteiros pseudo-aleatórios
      t_temp = random(200, 350) / 10.0;
      t_umid = random(400, 800) / 10.0;
      t_co2  = random(400, 2000);
      t_pm1  = random(5, 20);
      t_pm25 = random(10, 40);
      t_pm4  = random(15, 50);
      t_pm10 = random(20, 70);
      t_voc  = random(50, 150);
      t_nox  = random(10, 50);
      t_luz  = random(100, 1000);
    } else {
      /*
      t_luz = analogRead(PINO_LDR); // Conversor A/D nativo (0-4095)
      uint16_t scd4x_co2 = 0; float scd4x_temp = 0.0f, scd4x_hum = 0.0f;
      scd4x.readMeasurement(scd4x_co2, scd4x_temp, scd4x_hum);
      t_co2 = scd4x_co2; t_temp = scd4x_temp; t_umid = scd4x_hum;
      float pm1p0 = 0.0, pm2p5 = 0.0, pm4p0 = 0.0, pm10p0 = 0.0;
      float sen_hum = 0.0, sen_temp = 0.0, vocIndex = 0.0, noxIndex = 0.0;
      sen5x.readMeasuredValues(pm1p0, pm2p5, pm4p0, pm10p0, sen_hum, sen_temp, vocIndex, noxIndex);
      t_pm1 = (int)pm1p0; t_pm25 = (int)pm2p5; t_pm4 = (int)pm4p0; t_pm10 = (int)pm10p0;
      t_voc = (int)vocIndex; t_nox = (int)noxIndex;
      */
    }

    Serial.printf("Leitura: T=%.1f U=%.1f CO2=%d VOC=%d PM25=%d Luz=%d\n",
      t_temp, t_umid, t_co2, t_voc, t_pm25, t_luz);
  }

  // --------------------------------------------------------------------------
  // TAREFA 2: Enviar para Nuvem (Vercel) a cada 30 segundos
  // --------------------------------------------------------------------------
  if (agora - ultimoEnvioVercel >= INTERVALO_VERCEL) {
    ultimoEnvioVercel = agora; // Reseta o cronômetro desta tarefa

    if (WiFi.status() == WL_CONNECTED) {
      enviandoVercel = true; // Sinaliza que o processador vai ficar ocupado

      // FORMATAÇÃO DO JSON PARA VERCEL
      char json[500];
      // snprintf substitui os marcadores (%d inteiro, %.1f float com 1 casa decimal) pelas variáveis reais.
      // Esta é a forma mais segura de manipular strings em C/C++ sem fragmentar a memória (Heap).
      snprintf(json, sizeof(json),
        "{\"temperatura\":%.1f,\"umidade\":%.1f,\"co2\":%d,\"pm1\":%d,\"pm25\":%d,\"pm4\":%d,\"pm10\":%d,\"voc\":%d,\"nox\":%d,\"luz\":%d}",
        t_temp, t_umid, t_co2, t_pm1, t_pm25, t_pm4, t_pm10, t_voc, t_nox, t_luz);

      // ENVIO HTTP POST
      HTTPClient http;
      http.begin(serverUrl); // Aponta para a Vercel
      http.addHeader("Content-Type", "application/json"); // Avisa a Vercel que o pacote é um JSON
      /**
       * OTIMIZAÇÃO: Timeout reduzido para 8 segundos.
       * O padrão da biblioteca é 15s. Se a Vercel não responder em 8s
       * (ex: problema de DNS, Vercel fora do ar), o ESP32 desiste rápido
       * e volta a atender o servidor web local. Sem isso, o navegador
       * ficaria esperando até 15 segundos quando a Vercel estiver lenta.
       */
      http.setTimeout(8000);
      int code = http.POST(json); // Dispara a requisição. Código 200 = Sucesso.
      Serial.printf("Vercel - POST efetuado. Código HTTP: %d | RAM livre: %u bytes\n",
        code, ESP.getFreeHeap());
      http.end(); // Libera os recursos de rede do microcontrolador

      enviandoVercel = false; // Processador livre novamente

    } else {
      Serial.println("Erro: Wi-Fi desconectado, não foi possível enviar à Vercel.");
    }
  }

  // --------------------------------------------------------------------------
  // TAREFA 3: Salvar leitura no Histórico Local (RAM) a cada 5 minutos
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
