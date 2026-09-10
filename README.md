# Monitoramento Ambiental IoT - Evasão Escolar

> ⚠️ **v2 em andamento:** o backend serverless descrito em partes deste README foi substituído na **Fase 1** por uma stack Docker (backend Express + PostgreSQL). Veja as seções **Roadmap v2** e **Executando a v2** abaixo. O código v1 completo está preservado na tag [`v1-serverless`](../../tree/v1-serverless).

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

## 🌬️ Parâmetros Medidos e seus Impactos na Saúde

Para garantir um ambiente de aprendizado saudável e produtivo, monitoramos indicadores críticos de Qualidade do Ar Interno (IAQ). Entenda o que cada sensor mede e como esses fatores afetam o corpo humano:

* **Dióxido de Carbono (CO₂):**
  * **O que é:** Gás naturalmente exalado pela respiração humana. Em salas de aula fechadas com muitos alunos, acumula-se rapidamente.
  * **Impacto:** Níveis elevados (acima de 1000-1500 ppm) causam sonolência, letargia, dores de cabeça e uma **queda drástica na capacidade de concentração e cognição**. É o principal indicador de que a sala precisa de ventilação imediata (abrir janelas/portas).

* **Material Particulado (PM1.0, PM2.5, PM4.0, PM10):**
  * **O que é:** Partículas microscópicas suspensas no ar (poeira, pólen, poluição externa, fumaça). O número indica o tamanho máximo da partícula em micrômetros.
  * **Impacto:** Partículas maiores (PM10) causam irritação nos olhos, nariz e garganta, além de desencadear crises de asma e rinite. Partículas ultrafinas (PM2.5 e PM1.0) são ainda mais perigosas, pois conseguem penetrar profundamente nos pulmões e atingir a corrente sanguínea, causando inflamações sistêmicas.

* **Índice VOC (Compostos Orgânicos Voláteis):**
  * **O que é:** Gases emitidos por produtos químicos comuns no ambiente escolar, como materiais de limpeza, desinfetantes, tintas, ceras de piso, colas e canetões de quadro branco.
  * **Impacto:** A exposição causa irritação nas vias respiratórias, ardência nos olhos, dores de cabeça, tonturas e náuseas. Ambientes crônicos com alto índice de VOC afetam severamente o conforto olfativo e a saúde a longo prazo.

* **Índice NOx (Óxidos de Nitrogênio):**
  * **O que é:** Gases poluentes altamente reativos, originados principalmente pela queima de combustíveis (ex: fumaça do escapamento de veículos no trânsito externo que entra na escola).
  * **Impacto:** Agem como fortes irritantes do sistema respiratório. A exposição contínua pode causar tosse, falta de ar e agravar doenças respiratórias crônicas.

* **Temperatura e Umidade Relativa:**
  * **O que é:** Os dois pilares do conforto térmico do ambiente.
  * **Impacto:** 
    * **Umidade:** Quando muito alta (>60%), favorece a proliferação de mofo, fungos e ácaros. Quando muito baixa (<40%), resseca as vias aéreas e os olhos, além de aumentar a sobrevida de alguns vírus respiratórios suspensos no ar.
    * **Temperatura:** Temperaturas muito fora da faixa de conforto (20-24°C) desviam a energia do corpo para a termorregulação, causando inquietação ou sonolência extrema.

* **Luminosidade (Lux):**
  * **O que é:** A quantidade e intensidade de luz visível incidente no ambiente de estudo.
  * **Impacto:** A iluminação deficiente exige maior esforço visual, causando fadiga ocular e cansaço mental. Uma boa iluminação (especialmente a natural) inibe a produção de melatonina, regulando o relógio biológico e mantendo os alunos em estado de alerta e engajamento.
    
## 💻 Tecnologias Utilizadas
* **C++ / Arduino IDE:** Programação do firmware do ESP32.
* **JavaScript / Node.js:** Estruturação das rotas de API serverless.
* **HTML5 + Tailwind CSS:** Estilização do painel de monitoramento (Dark Mode).
* **Chart.js:** Renderização dos gráficos de histórico ambiental em tempo real.
* **Vercel:** Hospedagem gratuita da aplicação web e da API.

## 🏢 Arquitetura Multi-Salas (Scale-out)

Este sistema foi projetado para escalar o monitoramento ambiental para até **10 ambientes simultâneos**, gerenciados através de um único painel centralizado.

### Estrutura da API
O tráfego de rede é segmentado para evitar gargalos e perdas de pacotes. Na pasta `/api`, existem endpoints dedicados para cada ambiente (de `sala1.js` a `sala10.js`). Cada rota gerencia sua própria fila de memória volátil (Serverless), retendo de forma independente os registros de sua respectiva sala.

### Funcionamento do ESP32
O firmware do microcontrolador possui dois modos de operação que alteram dinamicamente a topologia de envio de dados, configurados no início do arquivo `.ino`:

* **Modo Produção (`MODO_SIMULACAO = false`):** 
  O firmware atua de forma dedicada. O desenvolvedor deve definir a variável `SALA_PERTENCENTE` (ex: `3`). O ESP32 fará a leitura física dos sensores I2C/Analógicos e enviará o payload via POST *exclusivamente* para o endpoint da sua sala correspondente (`/api/sala3`). Requer um hardware ESP32 + sensores por sala.

* **Modo Simulação (`MODO_SIMULACAO = true`):** 
  Útil para testes de carga e validação da interface web sem a necessidade de múltiplos hardwares. Neste modo, a variável `SALA_PERTENCENTE` é ignorada. Um único ESP32 atua como um gerador de dados mestre, iterando de 1 a 10, gerando parâmetros ambientais pseudo-aleatórios e disparando POSTs sucessivos para todas as rotas da API em um mesmo ciclo.

### Interface Gráfica (Frontend)
O painel gerencia a exibição paralela das informações em duas visualizações principais:
1. **Visão Geral:** Um mosaico simplificado que fornece o status em tempo real do nível de IAQ (Qualidade do Ar Interno) de todas as 10 salas simultaneamente, permitindo identificar focos de poluição rapidamente pelas cores indicativas.
2. **Dashboard Detalhado:** Ao selecionar uma sala específica no menu suspenso, a interface altera o contexto e exibe as métricas absolutas (Temperatura, Umidade, CO₂, VOC, PMs, NOx) e o histórico de gráficos referidos apenas ao ambiente isolado.

## ⚙️ Como Adicionar ou Remover Salas (Escalabilidade)

O projeto foi construído para ser facilmente escalável. Se você precisar monitorar mais ou menos do que 10 salas, basta seguir estes dois passos simples para atualizar o Backend e o Frontend:

### 1. Atualizando o Backend (Vercel)
A arquitetura utiliza arquivos isolados para cada ambiente. Para adicionar uma nova sala, você não precisa escrever código novo:
* Navegue até a pasta `/api`.
* Faça uma cópia exata de qualquer arquivo existente (ex: `sala1.js`).
* Renomeie o novo arquivo com o número da nova sala (ex: `sala11.js`).
* **Nota:** Não é necessário alterar absolutamente nada dentro do código do novo arquivo. A Vercel criará automaticamente a nova rota (`/api/sala11`) e alocará um container de memória isolado para ela.
* Para **remover** uma sala, basta deletar o arquivo `.js` correspondente da pasta.

### 2. Atualizando o Frontend (Interface)
Com as novas rotas de API criadas, você só precisa informar ao painel HTML quantas salas existem e quais são os nomes delas:
* Abra o arquivo `public/index.html` (ou onde estiver seu Frontend).
* Vá até a seção de variáveis globais do JavaScript e altere a constante `TOTAL_SALAS` para o novo número total:
  ```javascript
  const TOTAL_SALAS = 15; // Exemplo para 15 salas 
  ```
Logo abaixo, atualize o array SALA_NOMES adicionando ou removendo as linhas conforme a necessidade:
```javascript
const SALA_NOMES = [
  '', // índice 0 — não usado
  'Sala 1',
  'Sala 2',
  // ... continue até o número total
  'Laboratório',
  'Biblioteca'
];
```

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
│              │    │(pull-up)│    │(pull-up)│            │
│              │    └────┬────┘    └────┬────┘            │
│              │         │              │                 │
│   GPIO 21 (SDA) ───────┼──────────────┤                 │
│              │         │              │                 │
│   GPIO 22 (SCL) ───────┤              │                 │
│              │         │              │                 │
│   GND ───────┬─────────┤──────────────┤                 │
│              │         │              │                 │
└──────────────┼─────────┼──────────────┼─────────────────┘
               │         │              │
      ┌────────┴─────────┴──┐  ┌────────┴────────────┐
      │      SCD4x (CO₂)    │  │     SEN5x (PM/VOC)  │
      │                     │  │                     │
      │    VDD ← 3.3V       │  │  VDD ← 5V *         │
      │    SDA ← GPIO 21    │  │  SDA ← GPIO 21      │
      │    SCL ← GPIO 22    │  │  SCL ← GPIO 22      │
      │    GND ← GND        │  │  GND ← GND          │
      │                     │  │  SEL ← GND (I2C)    │
      └─────────────────────┘  └─────────────────────┘

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

---

## 🚧 Roadmap v2 — Novas Funcionalidades (decisões do orientador em 02/09/2026)

> **Status:** Fase 1 (banco de dados + histórico + stack Docker) **implementada em 02/09/2026**. As demais fases seguem em desenvolvimento. As seções v1 deste README valem para a tag `v1-serverless`.

### Onde cada parte roda — v1 vs v2

| Componente | Hoje (v1) | v2 (planejado) |
|---|---|---|
| **Backend/API** | Funções serverless na Vercel (`api/salaN.js`) | Container **Node.js (Express)** no Docker — roda no Portainer residencial e é portável para Azure Container Apps (ACA) ou AWS ECS sem mudança de código |
| **Banco de dados** | Memória RAM volátil da função (perde tudo no cold start) | **PostgreSQL em container** com volume Docker nomeado (dados persistem a restart/rebuild) |
| **Frontend** | Vercel (estático) | **Vercel OU container nginx** no Docker — os dois a partir do mesmo repositório |
| **Alertas** | Não existem | Container **Evolution API** → WhatsApp |
| **ESP32** | Só envia dados (HTTP POST a cada 30 s) | Idem + recebe arquivo de provisionamento gerado pelo portal |

> **Importante:** o portal **não depende** do ESP32 para funcionar. O ESP32 apenas envia leituras para a API; o dashboard lê da API/banco. Se o ESP32 desligar, o portal continua no ar (mostrando os últimos dados gravados). O mini servidor web local do firmware (porta 80) é apenas para debug/configuração local.

### 1. Alertas WhatsApp com níveis por tempo de exposição

Regras de disparo (persistência da condição antes de alertar):

| Condição | Limiar | Tempo máx. até o alerta |
|---|---|---|
| Parâmetro crítico (PM2.5 > 35 µg/m³, VOC > 200, temp/umidade fora da faixa crítica) | conforme painel | **10 minutos** |
| **CO₂ ALTO** | > 1500 ppm | **5 minutos** |
| **CO₂ CRÍTICO** (risco de sonolência intensa/mal-estar/desmaio) | > 3000 ppm | **1 minuto** |

- Anti-spam: no máximo 1 alerta por sala a cada 30 min; mensagem de "normalizado" quando a condição cessa.
- Envio via **Evolution API** (`/message/sendText/{instancia}`) para os números e grupos cadastrados no portal.
- Cada disparo é gravado na tabela `alertas` (histórico de incidentes visível no dashboard).

### 2. Portal — contas de acesso e perfis de permissão

Login com usuário/senha (hash bcrypt + sessão JWT). Três perfis:

| Perfil | Permissões |
|---|---|
| **Visualização** | Vê dashboards e histórico (somente leitura) |
| **Análise** | Visualização + download das métricas (CSV) |
| **Administração** | Tudo + cadastrar salas, números de WhatsApp e usuários |

### 3. Cadastro de destinatários WhatsApp

Tela no portal (perfil Administração) para gerenciar quem recebe alertas:
- Número individual ou ID de grupo do WhatsApp;
- Nome/descrição, ativo/inativo e (opcional) quais salas cada destinatário acompanha;
- Persistido na tabela `destinatarios` do banco.

### 4. Provisionamento de novas salas (arquivo importável no ESP32)

Fluxo para adicionar uma sala **pelo portal**, sem editar código:

1. Admin cadastra a sala no portal → backend cria o registro e gera um **token único do dispositivo**;
2. O portal disponibiliza para download o arquivo `sala-<id>.json` contendo: URL do backend, id da sala, token de autenticação e intervalo de envio;
3. O arquivo é **importado no ESP32 novo** pela página web local do firmware (upload) e salvo na memória flash (NVS/LittleFS);
4. O ESP32 reinicia e começa a transmitir; a sala **aparece automaticamente** no dashboard — a lista de salas passará a vir de `GET /api/salas` (fim do `TOTAL_SALAS` fixo no HTML).

> Quando a v2 for implementada, este fluxo substitui o processo manual de copiar arquivos `salaN.js` descrito na seção "Como Adicionar ou Remover Salas".

### 5. Simulação realista

O modo simulação continuará com 10 salas, mas com dados verossímeis em vez de `random()` puro:
- **Random-walk com inércia**: cada leitura varia pouco em relação à anterior (temperatura não pula de 20 °C para 33 °C em 30 s);
- **Curva de ocupação escolar**: CO₂ sobe gradualmente durante a aula e cai nos intervalos/fins de dia;
- **Episódios programados de CO₂ alto e crítico** em salas específicas, para validar os dois níveis de alerta;
- Depois, uma **11ª sala real** será adicionada pelo portal para validar o arquivo de provisionamento no ESP32.

### 6. Deploy — Docker (Portainer) e Vercel a partir do mesmo repositório

Nova estrutura do repositório (v2):

```
backend/    → API Node.js (Express) + Dockerfile
frontend/   → HTML/JS estático + Dockerfile (nginx) + vercel.json
esp32/      → firmware
docker-compose.yml
```

**docker-compose.yml (esqueleto):**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: iaq
      POSTGRES_USER: iaq
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgres://iaq:${DB_PASSWORD}@db:5432/iaq
      JWT_SECRET: ${JWT_SECRET}
      EVOLUTION_API_URL: http://evolution:8080
      EVOLUTION_API_KEY: ${EVOLUTION_API_KEY}
      EVOLUTION_INSTANCE: escola
    ports: ["3000:3000"]
    depends_on: [db]
  evolution:
    image: atendai/evolution-api:latest
    environment:
      AUTHENTICATION_API_KEY: ${EVOLUTION_API_KEY}
    volumes:
      - evolution_data:/evolution/instances
  frontend:
    build: ./frontend
    ports: ["8080:80"]
    depends_on: [backend]
volumes:
  pgdata:
  evolution_data:
```

**No Portainer residencial:** *Stacks → Add stack → Repository* → apontar a URL do repositório Git e o caminho do `docker-compose.yml` → definir as variáveis de ambiente → *Deploy*. Para atualizar, basta *re-pull* (ou configurar o webhook de auto-update do Portainer). O volume `pgdata` garante que o banco sobrevive a atualizações.

**Na Vercel (frontend):** no projeto, definir *Root Directory* = `frontend/` (deploy estático). O `frontend/vercel.json` fará *rewrite* de `/api/*` para a URL pública do backend residencial.

**Regra de ouro:** o frontend sempre chama `/api` com caminho **relativo**. Quem resolve o destino é o ambiente — o nginx (proxy reverso para o container `backend`) no Docker, ou o *rewrite* do `vercel.json` na Vercel. Zero mudança de código entre ambientes.

**Exposição pública do backend residencial:** recomendado **Cloudflare Tunnel** (gratuito, HTTPS automático, sem abrir portas no roteador) → ex.: `https://api.seu-dominio.com`. É essa URL que o ESP32 (POST) e o frontend na Vercel (rewrite) usarão. Alternativa: port-forward + Nginx Proxy Manager + DDNS.

**Portabilidade para ACA/ECS:** o backend é *stateless* (todo estado no Postgres) e configurado 100% por variáveis de ambiente (12-factor). Para migrar, sobe-se a mesma imagem no ACA/ECS e troca-se apenas a `DATABASE_URL` para um Postgres gerenciado (Azure Database / RDS).

---

## ▶️ Executando a v2 (Fase 1 implementada)

Estrutura atual do repositório:

```
backend/            → API Node.js (Express) + Dockerfile
frontend/           → dashboard (index.html) + nginx.conf + Dockerfile + vercel.json
esp32/              → firmware (INALTERADO — mesma rota /api/salaN e mesmo payload)
docker-compose.yml  → PostgreSQL + backend + frontend (+ Evolution API na Fase 2)
docs/               → plano de ação
```

### Rodando com Docker (local ou Portainer)

```bash
cp .env.example .env   # edite pelo menos DB_PASSWORD
docker compose up -d --build

# Dashboard : http://localhost:8080
# API       : http://localhost:3000/api/status
```

No **Portainer**: *Stacks → Add stack → Repository* → URL deste repositório + caminho `docker-compose.yml` → defina as variáveis de ambiente → *Deploy*. O volume `pgdata` mantém o banco entre atualizações da stack. O Postgres **não publica porta no host** (fica só na rede interna da stack), então não conflita com outros bancos do servidor.

### Endpoints da API (Fase 1)

| Método | Rota | Uso |
|---|---|---|
| POST | `/api/sala<N>` | Ingestão do ESP32 (idêntico à v1 — firmware não muda) |
| GET | `/api/sala<N>?limit=360` | Últimas leituras, mais recente primeiro (dashboard) |
| GET | `/api/salas` | Lista de salas + timestamp da última leitura |
| GET | `/api/historico?sala=3&inicio=2026-09-01&fim=2026-09-07` | Leituras brutas por período (ordem cronológica) |
| GET | `/api/agregado?sala=3&inicio=&fim=&intervalo=hora\|dia` | Média/mín/máx por hora ou dia |
| GET | `/api/status` | Healthcheck |

Retenção: leituras brutas ficam `RETENCAO_DIAS` (padrão 90) dias; um job interno consolida tudo em `agregados_hora` (médias por hora, mantidas para sempre) antes de apagar.

### Aba Histórico do dashboard

A aba **Histórico** agora tem um painel *"Consultar período no banco de dados"*: sala + data início/fim + resolução (brutas / média por hora / média por dia), com **Exportar CSV** (formato Excel pt-BR) e botão para voltar ao tempo real.

### ESP32

Nada muda no firmware além da constante `BASE_URL`, que deve apontar para a URL pública do backend (ex.: `https://api.seu-dominio.com/api/sala` via Cloudflare Tunnel) em vez da Vercel.

### Vercel (frontend estático)

1. No projeto da Vercel, defina **Root Directory = `frontend/`**.
2. Edite `frontend/vercel.json` trocando `SEU-BACKEND-PUBLICO.exemplo.com` pela URL pública do backend — o rewrite de `/api/*` faz o dashboard funcionar sem nenhuma alteração de código.

### Migração v1 → v2

- As funções serverless (`api/salaN.js`) e o `public/` foram removidos; o código v1 completo está na tag **`v1-serverless`**.
- Não há dados a migrar: a v1 não tinha persistência (memória volátil).
