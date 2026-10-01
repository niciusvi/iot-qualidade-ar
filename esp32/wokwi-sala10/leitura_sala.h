/**
 * leitura_sala.h — o "pacote" de uma leitura completa da sala.
 *
 * POR QUE ESTÁ NUM ARQUIVO SEPARADO:
 * a Arduino IDE (e o Wokwi) geram sozinhos os protótipos das funções do .ino
 * e os colocam NO TOPO do arquivo, antes de qualquer struct declarada lá.
 * Uma função que recebe `LeituraSala&` não compilaria ("LeituraSala was not
 * declared"). Num .h incluído logo no início, o tipo já existe a tempo.
 */
#pragma once

/**
 * Os dez campos são exatamente os do contrato de payload do backend
 * (`POST /api/sala<N>`): mudou um nome aqui, tem que mudar no backend e no
 * portal também.
 */
struct LeituraSala {
  float temperatura;  // °C            — SCD4x
  float umidade;      // % relativa    — SCD4x
  int co2;            // ppm           — SCD4x
  int pm1;            // µg/m³         — SEN5x
  int pm25;           // µg/m³         — SEN5x
  int pm4;            // µg/m³         — SEN5x
  int pm10;           // µg/m³         — SEN5x
  int voc;            // índice 1-500  — SEN5x
  int nox;            // índice 1-500  — SEN5x
  int luz;            // lux           — LDR
};
