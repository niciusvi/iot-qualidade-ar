/**
 * scd4x.chip.c — sensor Sensirion SCD4x (CO2, temperatura, umidade) para o Wokwi.
 *
 * POR QUE ESTE ARQUIVO EXISTE:
 * o Wokwi não tem o SCD4x no catálogo de peças. Um "custom chip" é um pequeno
 * programa em C que o simulador liga aos fios do I2C e que responde igual ao
 * sensor de verdade. Assim o ESP32 usa a MESMA biblioteca da Sensirion do
 * firmware real — o código de leitura que funciona aqui funciona na placa.
 *
 * O QUE O CHIP IMITA (datasheet do SCD4x, seção 3):
 *   - endereço I2C 0x62;
 *   - comandos de 16 bits (2 bytes) enviados pelo ESP32;
 *   - respostas em "palavras" de 2 bytes, cada uma seguida de 1 byte de CRC.
 *
 * Os valores medidos vêm dos controles deslizantes do chip (clique no chip com
 * a simulação rodando), mais um ruído pequeno para o gráfico não ficar reto.
 */
#include "wokwi-api.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

#define SCD4X_ENDERECO_I2C 0x62

// Códigos de comando do datasheet (os únicos que a biblioteca usa neste projeto).
#define SCD4X_CMD_INICIAR_MEDICAO 0x21B1
#define SCD4X_CMD_PARAR_MEDICAO 0x3F86
#define SCD4X_CMD_LER_MEDICAO 0xEC05
#define SCD4X_CMD_DADO_PRONTO 0xE4B8

#define SCD4X_TAMANHO_RESPOSTA 9  // 3 palavras x (2 bytes + 1 CRC)

typedef struct {
  uint32_t attr_co2;
  uint32_t attr_temperatura;
  uint32_t attr_umidade;
  uint16_t comando_recebido;
  uint8_t bytes_recebidos;
  uint8_t resposta[SCD4X_TAMANHO_RESPOSTA];
  uint8_t tamanho_resposta;
  uint8_t indice_resposta;
  bool medindo;  // vira true depois do comando "iniciar medição periódica"
} scd4x_estado_t;

/**
 * CRC-8 da Sensirion (polinômio 0x31, valor inicial 0xFF) sobre 2 bytes.
 * A biblioteca DESCARTA a leitura se este byte não bater — é a proteção dela
 * contra ruído no fio. Vetor de teste do datasheet: 0xBE 0xEF -> 0x92.
 */
static uint8_t scd4x_crc8(uint8_t msb, uint8_t lsb) {
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
static void scd4x_anexar_palavra(scd4x_estado_t *chip, uint16_t palavra) {
  if (chip->tamanho_resposta + 3 > SCD4X_TAMANHO_RESPOSTA) return;
  const uint8_t msb = (uint8_t)(palavra >> 8);
  const uint8_t lsb = (uint8_t)(palavra & 0xFF);
  chip->resposta[chip->tamanho_resposta++] = msb;
  chip->resposta[chip->tamanho_resposta++] = lsb;
  chip->resposta[chip->tamanho_resposta++] = scd4x_crc8(msb, lsb);
}

/** Ruído uniforme entre -amplitude e +amplitude (sensor real nunca repete o valor). */
static float scd4x_ruido(float amplitude) {
  return ((float)(rand() % 2001) / 1000.0f - 1.0f) * amplitude;
}

/** Limita o valor à faixa de uma palavra de 16 bits antes de converter. */
static uint16_t scd4x_para_palavra(float valor) {
  if (valor < 0.0f) return 0;
  if (valor > 65535.0f) return 65535;
  return (uint16_t)valor;
}

/**
 * Monta a resposta do "ler medição" com as fórmulas do datasheet INVERTIDAS:
 * o sensor manda números crus e a biblioteca converte de volta com
 *   T  = -45 + 175 * cru / 65536      e      UR = 100 * cru / 65536.
 */
static void scd4x_preparar_medicao(scd4x_estado_t *chip) {
  const float co2 = (float)attr_read(chip->attr_co2) + scd4x_ruido(8.0f);
  const float temperatura = attr_read_float(chip->attr_temperatura) + scd4x_ruido(0.1f);
  const float umidade = attr_read_float(chip->attr_umidade) + scd4x_ruido(0.3f);
  scd4x_anexar_palavra(chip, scd4x_para_palavra(co2));
  scd4x_anexar_palavra(chip, scd4x_para_palavra((temperatura + 45.0f) * 65536.0f / 175.0f));
  scd4x_anexar_palavra(chip, scd4x_para_palavra(umidade * 65536.0f / 100.0f));
}

/** Executa o comando de 16 bits que acabou de chegar pelo I2C. */
static void scd4x_executar_comando(scd4x_estado_t *chip) {
  chip->tamanho_resposta = 0;
  chip->indice_resposta = 0;
  switch (chip->comando_recebido) {
    case SCD4X_CMD_INICIAR_MEDICAO:
      chip->medindo = true;
      break;
    case SCD4X_CMD_PARAR_MEDICAO:
      chip->medindo = false;
      break;
    case SCD4X_CMD_LER_MEDICAO:
      scd4x_preparar_medicao(chip);
      break;
    case SCD4X_CMD_DADO_PRONTO:
      // Os 11 bits baixos diferentes de zero significam "há medição nova".
      scd4x_anexar_palavra(chip, chip->medindo ? 0x0006 : 0x0000);
      break;
    default:
      // Comando fora da lista: aceita sem resposta (leitura devolveria 0xFF
      // e a biblioteca acusaria erro de CRC, o que denuncia o comando faltando).
      break;
  }
}

/** Início de uma conversa I2C: zera o contador quando o ESP32 vai ESCREVER. */
static bool scd4x_ao_conectar(void *user_data, uint32_t endereco, bool leitura) {
  scd4x_estado_t *chip = user_data;
  if (!leitura) chip->bytes_recebidos = 0;
  return true;  // ACK: "estou aqui" — é isto que o scanner I2C detecta
}

/** Cada byte escrito pelo ESP32. Os dois primeiros formam o comando. */
static bool scd4x_ao_escrever(void *user_data, uint8_t byte_recebido) {
  scd4x_estado_t *chip = user_data;
  chip->bytes_recebidos++;
  if (chip->bytes_recebidos == 1) {
    chip->comando_recebido = (uint16_t)(byte_recebido << 8);
    return true;
  }
  if (chip->bytes_recebidos == 2) {
    chip->comando_recebido |= byte_recebido;
    scd4x_executar_comando(chip);
  }
  return true;  // bytes extras (parâmetros de comandos não usados) são ignorados
}

/** Cada byte pedido pelo ESP32: entrega a resposta pendente, em ordem. */
static uint8_t scd4x_ao_ler(void *user_data) {
  scd4x_estado_t *chip = user_data;
  if (chip->indice_resposta >= chip->tamanho_resposta) return 0xFF;
  return chip->resposta[chip->indice_resposta++];
}

static void scd4x_ao_desconectar(void *user_data) {
  // Nada a liberar: o estado do chip vive durante toda a simulação.
}

void chip_init(void) {
  scd4x_estado_t *chip = calloc(1, sizeof(scd4x_estado_t));
  chip->attr_co2 = attr_init("co2", 800);
  chip->attr_temperatura = attr_init_float("temperatura", 24.0f);
  chip->attr_umidade = attr_init_float("umidade", 55.0f);

  const i2c_config_t configuracao_i2c = {
    .user_data = chip,
    .address = SCD4X_ENDERECO_I2C,
    .scl = pin_init("SCL", INPUT),
    .sda = pin_init("SDA", INPUT),
    .connect = scd4x_ao_conectar,
    .read = scd4x_ao_ler,
    .write = scd4x_ao_escrever,
    .disconnect = scd4x_ao_desconectar,
  };
  i2c_init(&configuracao_i2c);
}
