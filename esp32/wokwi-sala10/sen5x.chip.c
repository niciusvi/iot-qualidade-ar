/**
 * sen5x.chip.c — sensor Sensirion SEN5x (partículas, VOC, NOx) para o Wokwi.
 *
 * Mesmo motivo do scd4x.chip.c: o Wokwi não tem esta peça, então este programa
 * responde no I2C igual ao sensor real (endereço 0x69) para que o ESP32 use a
 * biblioteca oficial da Sensirion, sem nenhum "if simulação" no sketch.
 *
 * SIMPLIFICAÇÃO ASSUMIDA: só o PM2.5 tem controle deslizante. PM1, PM4 e PM10
 * são derivados dele por proporções fixas (num ambiente real as quatro frações
 * sobem e descem juntas). Temperatura e umidade do SEN5x são fixas porque o
 * projeto usa as do SCD4x e descarta estas.
 *
 * O CRC e a montagem das palavras repetem o que está no scd4x.chip.c DE
 * PROPÓSITO: no Wokwi cada chip é compilado sozinho, sem arquivo compartilhado.
 */
#include "wokwi-api.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

#define SEN5X_ENDERECO_I2C 0x69

// Códigos de comando do datasheet do SEN5x (seção 6.1).
#define SEN5X_CMD_INICIAR_MEDICAO 0x0021
#define SEN5X_CMD_PARAR_MEDICAO 0x0104
#define SEN5X_CMD_DADO_PRONTO 0x0202
#define SEN5X_CMD_LER_VALORES 0x03C4
#define SEN5X_CMD_STATUS 0xD206

#define SEN5X_TAMANHO_RESPOSTA 24  // 8 palavras x (2 bytes + 1 CRC)

// Proporções típicas entre as frações de partículas e o PM2.5.
#define SEN5X_RAZAO_PM1 0.80f
#define SEN5X_RAZAO_PM4 1.15f
#define SEN5X_RAZAO_PM10 1.30f

// O sketch não usa estes dois valores; ficam fixos e plausíveis.
#define SEN5X_UMIDADE_FIXA 50.0f
#define SEN5X_TEMPERATURA_FIXA 25.0f

typedef struct {
  uint32_t attr_pm25;
  uint32_t attr_voc;
  uint32_t attr_nox;
  uint16_t comando_recebido;
  uint8_t bytes_recebidos;
  uint8_t resposta[SEN5X_TAMANHO_RESPOSTA];
  uint8_t tamanho_resposta;
  uint8_t indice_resposta;
  bool medindo;
} sen5x_estado_t;

/** CRC-8 da Sensirion (polinômio 0x31, inicial 0xFF). Teste: 0xBE 0xEF -> 0x92. */
static uint8_t sen5x_crc8(uint8_t msb, uint8_t lsb) {
  const uint8_t bytes[2] = {msb, lsb};
  uint8_t crc = 0xFF;
  for (int i = 0; i < 2; i++) {
    crc ^= bytes[i];
    for (int bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
    }
  }
  return crc;
}

/** Acrescenta uma palavra (2 bytes + CRC) ao fim da resposta pendente. */
static void sen5x_anexar_palavra(sen5x_estado_t *chip, uint16_t palavra) {
  if (chip->tamanho_resposta + 3 > SEN5X_TAMANHO_RESPOSTA) return;
  const uint8_t msb = (uint8_t)(palavra >> 8);
  const uint8_t lsb = (uint8_t)(palavra & 0xFF);
  chip->resposta[chip->tamanho_resposta++] = msb;
  chip->resposta[chip->tamanho_resposta++] = lsb;
  chip->resposta[chip->tamanho_resposta++] = sen5x_crc8(msb, lsb);
}

/** Ruído uniforme entre -amplitude e +amplitude. */
static float sen5x_ruido(float amplitude) {
  return ((float)(rand() % 2001) / 1000.0f - 1.0f) * amplitude;
}

/**
 * Converte o valor físico no número cru que o sensor transmite: o datasheet
 * manda multiplicar por um fator de escala (10, 100 ou 200, conforme o campo)
 * e a biblioteca divide pelo mesmo fator do outro lado.
 */
static uint16_t sen5x_escalar(float valor, float fator_escala) {
  const float cru = valor * fator_escala;
  if (cru < 0.0f) return 0;
  if (cru > 32767.0f) return 32767;  // teto comum aos campos com e sem sinal
  return (uint16_t)cru;
}

/** Monta as 8 palavras do "ler valores medidos", na ordem do datasheet. */
static void sen5x_preparar_valores(sen5x_estado_t *chip) {
  const float pm25 = (float)attr_read(chip->attr_pm25) + sen5x_ruido(0.4f);
  const float voc = (float)attr_read(chip->attr_voc) + sen5x_ruido(2.0f);
  const float nox = (float)attr_read(chip->attr_nox) + sen5x_ruido(1.0f);
  sen5x_anexar_palavra(chip, sen5x_escalar(pm25 * SEN5X_RAZAO_PM1, 10.0f));
  sen5x_anexar_palavra(chip, sen5x_escalar(pm25, 10.0f));
  sen5x_anexar_palavra(chip, sen5x_escalar(pm25 * SEN5X_RAZAO_PM4, 10.0f));
  sen5x_anexar_palavra(chip, sen5x_escalar(pm25 * SEN5X_RAZAO_PM10, 10.0f));
  sen5x_anexar_palavra(chip, sen5x_escalar(SEN5X_UMIDADE_FIXA, 100.0f));
  sen5x_anexar_palavra(chip, sen5x_escalar(SEN5X_TEMPERATURA_FIXA, 200.0f));
  sen5x_anexar_palavra(chip, sen5x_escalar(voc, 10.0f));
  sen5x_anexar_palavra(chip, sen5x_escalar(nox, 10.0f));
}

/** Executa o comando de 16 bits que acabou de chegar pelo I2C. */
static void sen5x_executar_comando(sen5x_estado_t *chip) {
  chip->tamanho_resposta = 0;
  chip->indice_resposta = 0;
  switch (chip->comando_recebido) {
    case SEN5X_CMD_INICIAR_MEDICAO:
      chip->medindo = true;
      break;
    case SEN5X_CMD_PARAR_MEDICAO:
      chip->medindo = false;
      break;
    case SEN5X_CMD_LER_VALORES:
      sen5x_preparar_valores(chip);
      break;
    case SEN5X_CMD_DADO_PRONTO:
      sen5x_anexar_palavra(chip, chip->medindo ? 0x0001 : 0x0000);
      break;
    case SEN5X_CMD_STATUS:
      // 32 bits de status zerados = nenhum erro de ventilador, laser ou sensor.
      sen5x_anexar_palavra(chip, 0x0000);
      sen5x_anexar_palavra(chip, 0x0000);
      break;
    default:
      break;  // comando não usado pelo projeto: aceita e não responde
  }
}

/** Início de uma conversa I2C: zera o contador quando o ESP32 vai ESCREVER. */
static bool sen5x_ao_conectar(void *user_data, uint32_t endereco, bool leitura) {
  sen5x_estado_t *chip = user_data;
  if (!leitura) chip->bytes_recebidos = 0;
  return true;
}

/** Cada byte escrito pelo ESP32. Os dois primeiros formam o comando. */
static bool sen5x_ao_escrever(void *user_data, uint8_t byte_recebido) {
  sen5x_estado_t *chip = user_data;
  chip->bytes_recebidos++;
  if (chip->bytes_recebidos == 1) {
    chip->comando_recebido = (uint16_t)(byte_recebido << 8);
    return true;
  }
  if (chip->bytes_recebidos == 2) {
    chip->comando_recebido |= byte_recebido;
    sen5x_executar_comando(chip);
  }
  return true;
}

/** Cada byte pedido pelo ESP32: entrega a resposta pendente, em ordem. */
static uint8_t sen5x_ao_ler(void *user_data) {
  sen5x_estado_t *chip = user_data;
  if (chip->indice_resposta >= chip->tamanho_resposta) return 0xFF;
  return chip->resposta[chip->indice_resposta++];
}

static void sen5x_ao_desconectar(void *user_data) {
  // Nada a liberar: o estado do chip vive durante toda a simulação.
}

void chip_init(void) {
  sen5x_estado_t *chip = calloc(1, sizeof(sen5x_estado_t));
  chip->attr_pm25 = attr_init("pm25", 12);
  chip->attr_voc = attr_init("voc", 90);
  chip->attr_nox = attr_init("nox", 15);

  // O pino SEL existe só para o desenho ficar igual à montagem real
  // (SEL no GND = modo I2C); o chip simulado não precisa lê-lo.
  pin_init("SEL", INPUT);

  const i2c_config_t configuracao_i2c = {
    .user_data = chip,
    .address = SEN5X_ENDERECO_I2C,
    .scl = pin_init("SCL", INPUT),
    .sda = pin_init("SDA", INPUT),
    .connect = sen5x_ao_conectar,
    .read = sen5x_ao_ler,
    .write = sen5x_ao_escrever,
    .disconnect = sen5x_ao_desconectar,
  };
  i2c_init(&configuracao_i2c);
}
