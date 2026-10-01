/**
 * ============================================================================
 * SCHOOL AIR — simulação da SALA 10 no Wokwi (ESP32 + SCD4x + SEN5x + LDR)
 *
 * O QUE ESTE SKETCH FAZ:
 *   a cada 30 s lê os três sensores e faz UM POST em <backend>/api/sala10,
 *   com o mesmo JSON e os mesmos headers do firmware de produção
 *   (esp32/esp32_air_quality.ino). Para o backend, é uma placa real.
 *
 * O QUE ELE NÃO TEM (de propósito, para caber numa simulação):
 *   painel web local, página /config, gravação na flash e buffer de reenvio.
 *   No Wokwi do navegador ninguém consegue abrir o IP da placa, e a simulação
 *   recomeça do zero a cada Play — essas partes não teriam como ser usadas.
 *
 * ANTES DE RODAR: crie o arquivo segredos.h a partir do segredos.example.h.
 * ============================================================================
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <SensirionI2CSen5x.h>

/**
 * SCD4x na biblioteca 1.x ("Sensirion I2C SCD4x" 1.1.0): arquivo e classe com
 * "I2c" (c minúsculo) e begin() pedindo o endereço. É a versão que o Wokwi
 * instala, porque o Library Manager dele grava o libraries.txt sem versão.
 * O firmware de produção (comentado) ainda usa a 0.4.0, com "I2C" maiúsculo.
 */
#include <SensirionI2cScd4x.h>

#include "leitura_sala.h"
#include "segredos.h"

// Rede Wi-Fi virtual do Wokwi: nome fixo do simulador, aberta (sem senha).
const char* const WOKWI_SSID = "Wokwi-GUEST";
// Informar o canal pula a varredura de redes — a conexão cai de ~10 s para ~1 s.
const int WOKWI_CANAL_WIFI = 6;

const int SALA_SIMULADA = 10;
const unsigned long INTERVALO_CICLO_MS = 30000;  // igual ao firmware real
const unsigned long PRIMEIRA_MEDICAO_MS = 5000;  // o SCD4x real leva 5 s para a 1ª leitura

// Mesma pinagem do README (montagem real).
const int PINO_I2C_SDA = 21;
const int PINO_I2C_SCL = 22;
const int PINO_LDR = 34;

// TLS dentro do simulador é bem mais lento que na placa: 8 s não bastam.
const int TEMPO_LIMITE_HTTP_MS = 20000;

SensirionI2cScd4x sensorScd4x;
SensirionI2CSen5x sensorSen5x;
unsigned long ultimoCicloMs = 0;
bool primeiroCicloFeito = false;

/** Conecta na rede virtual do Wokwi e só retorna quando houver IP. */
void conectarWifiWokwi() {
  Serial.printf("Conectando em %s", WOKWI_SSID);
  WiFi.begin(WOKWI_SSID, "", WOKWI_CANAL_WIFI);
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.printf("\nWi-Fi conectado. IP: %s\n", WiFi.localIP().toString().c_str());
}

/**
 * Liga o barramento I2C e manda os dois sensores começarem a medir.
 * Sem o "start", eles respondem ao scanner mas nunca entregam medição.
 */
void iniciarSensoresI2c() {
  Wire.begin(PINO_I2C_SDA, PINO_I2C_SCL);
  sensorScd4x.begin(Wire, SCD41_I2C_ADDR_62);
  sensorSen5x.begin(Wire);
  // int: o SCD4x devolve int16_t e o SEN5x uint16_t; 0 = sucesso nos dois.
  int erroScd4x = sensorScd4x.startPeriodicMeasurement();
  int erroSen5x = sensorSen5x.startMeasurement();
  if (erroScd4x != 0) {
    Serial.printf("[SCD4x] start falhou: erro 0x%04X (esperado 0x0000). Confira SDA=21, SCL=22.\n", erroScd4x);
  }
  if (erroSen5x != 0) {
    Serial.printf("[SEN5x] start falhou: erro 0x%04X (esperado 0x0000). Confira SDA=21, SCL=22.\n", erroSen5x);
  }
}

/**
 * Converte a leitura analógica do módulo LDR do Wokwi em lux.
 * O módulo é um divisor de tensão: LDR em série com um resistor de 10 kΩ.
 * A razão entre a tensão lida e a de alimentação dá a resistência do LDR, e
 * a curva do componente (GAMMA e RL10, da documentação do Wokwi) dá os lux.
 */
int lerLuxDoLdr() {
  const float GAMMA_LDR = 0.7;
  const float RL10_KOHM = 50.0;
  const float RESISTOR_DIVISOR_OHM = 10000.0;
  const float FUNDO_DE_ESCALA_ADC = 4095.0;

  float razao = analogRead(PINO_LDR) / FUNDO_DE_ESCALA_ADC;
  // Nos extremos a fórmula dividiria por zero: limita a razão.
  razao = constrain(razao, 0.001, 0.999);
  float resistenciaLdr = RESISTOR_DIVISOR_OHM * razao / (1.0 - razao);
  float lux = pow(RL10_KOHM * 1e3 * pow(10, GAMMA_LDR) / resistenciaLdr, 1.0 / GAMMA_LDR);
  return (int)constrain(lux, 0.0, 200000.0);  // teto aceito pelo backend
}

/** Lê CO2, temperatura e umidade do SCD4x. Devolve false se a leitura falhar. */
bool lerScd4x(LeituraSala& leitura) {
  uint16_t co2Ppm = 0;
  float temperaturaC = 0.0f;
  float umidadeRelativa = 0.0f;
  int erro = sensorScd4x.readMeasurement(co2Ppm, temperaturaC, umidadeRelativa);
  if (erro != 0) {
    Serial.printf("[SCD4x] leitura falhou: erro 0x%04X (esperado 0x0000) no endereco 0x62.\n", erro);
    return false;
  }
  leitura.co2 = co2Ppm;
  leitura.temperatura = temperaturaC;
  leitura.umidade = umidadeRelativa;
  return true;
}

/** Lê partículas, VOC e NOx do SEN5x. Devolve false se a leitura falhar. */
bool lerSen5x(LeituraSala& leitura) {
  float pm1 = 0, pm25 = 0, pm4 = 0, pm10 = 0;
  float umidadeSen5x = 0, temperaturaSen5x = 0, indiceVoc = 0, indiceNox = 0;
  uint16_t erro = sensorSen5x.readMeasuredValues(
    pm1, pm25, pm4, pm10, umidadeSen5x, temperaturaSen5x, indiceVoc, indiceNox);
  if (erro != 0) {
    Serial.printf("[SEN5x] leitura falhou: erro 0x%04X (esperado 0x0000) no endereco 0x69.\n", erro);
    return false;
  }
  leitura.pm1 = (int)pm1;
  leitura.pm25 = (int)pm25;
  leitura.pm4 = (int)pm4;
  leitura.pm10 = (int)pm10;
  leitura.voc = (int)indiceVoc;
  leitura.nox = (int)indiceNox;
  return true;
}

/** Escreve a leitura no formato JSON que o backend espera (10 campos). */
void montarJsonDaLeitura(const LeituraSala& leitura, char* destino, size_t tamanhoDestino) {
  snprintf(destino, tamanhoDestino,
    "{\"temperatura\":%.1f,\"umidade\":%.1f,\"co2\":%d,\"pm1\":%d,\"pm25\":%d,"
    "\"pm4\":%d,\"pm10\":%d,\"voc\":%d,\"nox\":%d,\"luz\":%d}",
    leitura.temperatura, leitura.umidade, leitura.co2, leitura.pm1, leitura.pm25,
    leitura.pm4, leitura.pm10, leitura.voc, leitura.nox, leitura.luz);
}

/**
 * Headers de identificação. Só são enviados se estiverem preenchidos:
 * a sala 10 não tem token de dispositivo, e o par do Cloudflare Access só é
 * necessário quando a borda está protegida (é o caso do backend público).
 */
void adicionarCabecalhosDeAcesso(HTTPClient& http) {
  http.addHeader("Content-Type", "application/json");
  if (strlen(TOKEN_DA_SALA) > 0) {
    http.addHeader("X-Device-Token", TOKEN_DA_SALA);
  }
  if (strlen(CF_ACCESS_CLIENT_ID) > 0) {
    http.addHeader("CF-Access-Client-Id", CF_ACCESS_CLIENT_ID);
    http.addHeader("CF-Access-Client-Secret", CF_ACCESS_CLIENT_SECRET);
  }
}

/**
 * Faz o POST da leitura em <BACKEND_URL>/api/sala10 e devolve o código HTTP
 * (200 = gravou; 302/403 = barrado no Cloudflare Access; negativo = sem conexão).
 */
int enviarLeituraAoBackend(const char* json) {
  String url = String(BACKEND_URL) + "/api/sala" + String(SALA_SIMULADA);
  WiFiClientSecure clienteTls;
  // Cifra a conexão sem validar o certificado — mesmo compromisso do firmware
  // real: a autenticidade vem do Service Token e do token do dispositivo.
  clienteTls.setInsecure();
  HTTPClient http;
  http.begin(clienteTls, url);
  http.setTimeout(TEMPO_LIMITE_HTTP_MS);
  adicionarCabecalhosDeAcesso(http);
  int codigoHttp = http.POST(String(json));
  if (codigoHttp <= 0) {
    Serial.printf("  ERRO de conexao (%s). Confira BACKEND_URL no segredos.h.\n",
      http.errorToString(codigoHttp).c_str());
  }
  http.end();
  return codigoHttp;
}

/** Um ciclo completo: ler os três sensores, montar o JSON e enviar. */
void executarCicloDeLeitura() {
  LeituraSala leitura = {};
  bool scd4xOk = lerScd4x(leitura);
  bool sen5xOk = lerSen5x(leitura);
  leitura.luz = lerLuxDoLdr();
  if (!scd4xOk || !sen5xOk) {
    // Campo zerado não é medição: melhor pular o envio do que sujar o histórico.
    Serial.println("Ciclo pulado: sensor sem leitura valida.");
    return;
  }
  char json[320];
  montarJsonDaLeitura(leitura, json, sizeof(json));
  int codigoHttp = enviarLeituraAoBackend(json);
  Serial.printf("Sala %d - POST %d | %s\n", SALA_SIMULADA, codigoHttp, json);
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== SCHOOL AIR - Wokwi - Sala 10 ===");
  analogReadResolution(12);  // 0..4095, a escala que lerLuxDoLdr() assume
  iniciarSensoresI2c();
  conectarWifiWokwi();
  Serial.println("Pronto. Primeira leitura em 5 s; depois, uma a cada 30 s.");
}

void loop() {
  unsigned long agoraMs = millis();
  bool horaDaPrimeira = !primeiroCicloFeito && agoraMs >= PRIMEIRA_MEDICAO_MS;
  bool horaDasDemais = primeiroCicloFeito && (agoraMs - ultimoCicloMs >= INTERVALO_CICLO_MS);
  if (!horaDaPrimeira && !horaDasDemais) {
    delay(10);  // devolve o processador ao simulador entre um ciclo e outro
    return;
  }
  primeiroCicloFeito = true;
  ultimoCicloMs = agoraMs;
  executarCicloDeLeitura();
}
