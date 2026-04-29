# Monitoramento Ambiental IoT - Evasão Escolar

Projeto Integrador desenvolvido para a Univesp, focado em monitorar a Qualidade do Ar Interno (IAQ) em ambientes escolares e analisar a sua correlação com o bem-estar, desempenho cognitivo e índices de evasão dos alunos.

## 🛠️ Arquitetura do Sistema
O sistema opera em três camadas principais:
1. **Hardware (Edge):** Coleta de dados físicos no ambiente escolar.
2. **API (Backend):** Rotas serverless hospedadas na Vercel para recebimento (POST) e fornecimento (GET) de dados em formato JSON.
3. **Dashboard (Frontend):** Interface web responsiva para visualização em tempo real de KPIs e gráficos de correlação ambiental.

## ⚙️ Dispositivos e Sensores

* **Microcontrolador - ESP32:** Responsável por ler os sensores localmente e transmitir os pacotes de dados via Wi-Fi (HTTP POST) para a API na nuvem.
* **Módulo de Qualidade do Ar - Sensirion SEN5x (I2C):** Atua como um nó ambiental completo, medindo:
  * Material Particulado (PM1.0, PM2.5, PM4.0, PM10) em µg/m³.
  * Compostos Orgânicos Voláteis (Índice VOC).
  * Óxidos de Nitrogênio (Índice NOx).
  * Temperatura (°C) e Umidade Relativa (%).
* **Sensor de Gás Carbônico - Sensirion SCD4x (I2C):** Focado na detecção de Dióxido de Carbono utilizando princípio fotoacústico NDIR (medido em ppm), um indicador chave para a necessidade de renovação de ar na sala de aula.
* **Sensor de Luminosidade - LDR (Analógico):** Acoplado a um divisor de tensão, afere os níveis de luz no ambiente escolar.

## 💻 Tecnologias Utilizadas
* **C++ / Arduino IDE:** Programação do firmware do ESP32.
* **JavaScript / Node.js:** Estruturação das rotas de API serverless.
* **HTML5 + Tailwind CSS:** Estilização do painel de monitoramento (Dark Mode).
* **Chart.js:** Renderização dos gráficos de histórico ambiental em tempo real.
* **Vercel:** Hospedagem gratuita da aplicação web e da API.


# Ligação dos Sensores SEN5x e SCD4x ao ESP32

## Esquema de Conexões I2C

Ambos os sensores usam o **mesmo barramento I2C** (compartilham os mesmos 2 fios de dados), pois cada um tem um endereço diferente na rede I2C:

- **SCD4x** → endereço `0x62`
- **SEN5x** → endereço `0x69`

```
┌─────────────────────────────────────────────────────────┐
│                       ESP32 DevKit                      │
│                                                         │
│   3.3V ──────┬──────────────┬──────────────┐            │
│              │              │              │            │
│              │    ┌─────────┤    ┌─────────┤            │
│              │    │  4.7kΩ  │    │  4.7kΩ  │            │
│              │    │ (pull-up)│    │ (pull-up)│            │
│              │    └────┬────┘    └────┬────┘            │
│              │         │              │                  │
│   GPIO 21 (SDA) ──────┼──────────────┤                  │
│              │         │              │                  │
│   GPIO 22 (SCL) ──────┤              │                  │
│              │         │              │                  │
│   GND ──────┬──────────┤──────────────┤                  │
│             │         │              │                  │
└─────────────┼─────────┼──────────────┼──────────────────┘
              │         │              │
    ┌─────────┴─────────┴───┐  ┌──────┴──────────────┐
    │      SCD4x (CO₂)     │  │    SEN5x (PM/VOC)   │
    │                       │  │                      │
    │  VDD ← 3.3V          │  │  VDD ← 5V *         │
    │  SDA ← GPIO 21       │  │  SDA ← GPIO 21      │
    │  SCL ← GPIO 22       │  │  SCL ← GPIO 22      │
    │  GND ← GND           │  │  GND ← GND          │
    │                       │  │  SEL ← GND (I2C)    │
    └───────────────────────┘  └──────────────────────┘

    * O SEN5x aceita 5V no VDD, mas os pinos SDA/SCL
      operam em 3.3V (compatível direto com o ESP32)
```

## Tabela Resumida de Pinos

### SCD4x (CO₂, Temperatura, Umidade)

| Pino SCD4x | Conecta em | Observação |
|---|---|---|
| **VDD** | 3.3V do ESP32 | Alimentação (2.4V – 5.5V) |
| **SDA** | GPIO 21 | Dados I2C |
| **SCL** | GPIO 22 | Clock I2C |
| **GND** | GND do ESP32 | Terra comum |

### SEN5x (PM1, PM2.5, PM4, PM10, VOC, NOx)

| Pino SEN5x | Conecta em | Observação |
|---|---|---|
| **VDD** | 5V do ESP32 (pino VIN) | Alimentação (4.5V – 5.5V) |
| **SDA** | GPIO 21 | Dados I2C (já em 3.3V) |
| **SCL** | GPIO 22 | Clock I2C (já em 3.3V) |
| **GND** | GND do ESP32 | Terra comum |
| **SEL** | GND | Seleciona modo I2C (vs UART) |

> O conector JST do SEN5x tem **6 pinos**. Consulte a pinagem no datasheet pois a ordem varia conforme o modelo (SEN50/SEN54/SEN55).

## Componentes Necessários

```
Lista de materiais (BOM):

 Qtd   Componente                  Observação
 ───   ──────────────────────────  ─────────────────────────────
  1    ESP32 DevKit V1             Qualquer variante com GPIO 21/22
  1    Sensirion SCD40 ou SCD41    Sensor de CO₂ (fotoacústico)
  1    Sensirion SEN54 ou SEN55    Sensor multigás + particulados
  2    Resistor 4.7kΩ              Pull-ups do barramento I2C
  1    LDR + Resistor 10kΩ         Sensor de luminosidade (divisor)
  1    Protoboard + jumpers        Para montagem do protótipo
  1    Cabo JST 6 pinos            Vem incluso no kit SEN5x
```

## Circuito do LDR (Luminosidade)

```
  3.3V ────┐
           │
         [LDR]        ← Resistência varia com a luz
           │
           ├──── GPIO 34 (entrada analógica do ESP32)
           │
        [10kΩ]        ← Resistor fixo (divisor de tensão)
           │
  GND ─────┘
```

## Dica Importante sobre Pull-ups I2C

```
Os resistores de 4.7kΩ são OBRIGATÓRIOS no barramento I2C.
Sem eles, a comunicação falha de forma intermitente
(funciona na bancada e para de funcionar no dia seguinte).

         3.3V          3.3V
          │              │
        [4.7kΩ]        [4.7kΩ]
          │              │
  SDA ────┘      SCL ───┘

Motivo técnico: I2C usa "open-drain" — os dispositivos
só conseguem PUXAR a linha para GND (nível 0).
O resistor é quem PUXA de volta para 3.3V (nível 1).
Sem ele, a linha fica "flutuando" e gera dados corrompidos.

EXCEÇÃO: Alguns módulos breakout (placas roxas da Adafruit,
por exemplo) já têm pull-ups soldados na placa.
Verifique com um multímetro antes de adicionar os seus.
```

## Código para Ativar os Sensores Reais

No seu código ESP32, basta **descomentar** as linhas que já estão preparadas e mudar a flag:

```cpp
// ===== PASSO 1: Descomentar os includes no topo do arquivo =====
#include <Wire.h>               // ← DESCOMENTE
#include <SensirionI2CSen5x.h>  // ← DESCOMENTE
#include <SensirionI2CScd4x.h>  // ← DESCOMENTE

// ===== PASSO 2: Descomentar os objetos globais =====
SensirionI2CSen5x sen5x;       // ← DESCOMENTE
SensirionI2CScd4x scd4x;       // ← DESCOMENTE

// ===== PASSO 3: Mudar o flag de simulação para FALSE =====
bool MODO_SIMULACAO = false;    // ← MUDE DE true PARA false

// ===== PASSO 4: No setup(), o bloco dentro do if já está pronto =====
// Basta descomentar:
//    Wire.begin(PINO_I2C_SDA, PINO_I2C_SCL);
//    sen5x.begin(Wire);
//    scd4x.begin(Wire);
//    sen5x.startMeasurement();
//    scd4x.startPeriodicMeasurement();

// ===== PASSO 5: No loop(), descomentar o bloco de leitura real =====
// O bloco dentro do else (após o if MODO_SIMULACAO) já está pronto.
```

## Verificação Rápida com Scanner I2C

Se os sensores não responderem, rode este sketch primeiro para confirmar que o ESP32 os enxerga no barramento:

```cpp
#include <Wire.h>

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);  // SDA=21, SCL=22
  Serial.println("Escaneando barramento I2C...");

  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("Dispositivo encontrado: 0x%02X", addr);
      if (addr == 0x62) Serial.print(" ← SCD4x (CO2)");
      if (addr == 0x69) Serial.print(" ← SEN5x (PM/VOC)");
      Serial.println();
    }
  }
  Serial.println("Scan finalizado.");
}

void loop() {}
```

**Resultado esperado no Serial Monitor:**
```
Escaneando barramento I2C...
Dispositivo encontrado: 0x62 ← SCD4x (CO2)
Dispositivo encontrado: 0x69 ← SEN5x (PM/VOC)
Scan finalizado.
```

Se nenhum dispositivo aparecer, verifique: fios soltos, pull-ups ausentes, ou alimentação incorreta (5V vs 3.3V).
