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

> **Status:** **Todas as 5 fases do software implementadas em 02/09/2026**, mais as adições de setembro: proteção da borda com Cloudflare Access (service token da frota), modo de desenvolvimento via gateway n8n, gestão de usuários com WhatsApp e recuperação de senha, redesign do portal (menu lateral, temas claro/escuro, avaliação heurística 27/40 com todas as correções aplicadas) e **firmware pronto por sala baixado direto do portal**. Pendente apenas a validação com hardware real (checklist em [`docs/VALIDACAO.md`](docs/VALIDACAO.md)). As seções v1 deste README valem para a tag `v1-serverless`.

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

> **Implementado — e evoluído:** hoje o portal baixa direto o **firmware pronto** da sala (`sala-<id>.ino`, para placa vazia); o arquivo JSON continua disponível para reprovisionar placas já gravadas. Ver a seção "Provisionando um ESP32 (fluxo completo)".

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
esp32/              → firmware (provisionável: NVS via /config, embutido via portal, buffer offline, simulação realista)
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

O caminho normal é **baixar o firmware pronto da sala no portal** (aba Configurações → "baixar firmware"): o `sala-<id>.ino` já vem com sala, token e URL do backend embutidos — só preencher o Wi-Fi e gravar. O `.ino` genérico do repositório serve para o modo simulação (ajuste a `BASE_URL`) ou para placas que serão provisionadas depois pela página local `/config`.

### Vercel (frontend estático)

1. No projeto da Vercel, defina **Root Directory = `frontend/`**.
2. Edite `frontend/vercel.json` trocando `SEU-BACKEND-PUBLICO.exemplo.com` pela URL pública do backend — o rewrite de `/api/*` faz o dashboard funcionar sem nenhuma alteração de código.

### Migração v1 → v2

- As funções serverless (`api/salaN.js`) e o `public/` foram removidos; o código v1 completo está na tag **`v1-serverless`**.
- Não há dados a migrar: a v1 não tinha persistência (memória volátil).

---

## 📲 Fase 2 — Alertas WhatsApp (implementada)

A stack agora é **100% autossuficiente**: a Evolution API roda **dentro do próprio
`docker-compose.yml`** (serviços `evolution` + `redis`, usando um database
`evolution` separado no mesmo Postgres). Nada depende de infraestrutura externa —
a mesma stack sobe completa em um Portainer, VPS, Azure Container Apps ou AWS ECS.

### Regras de disparo

| Condição | Limiar | Persistência p/ alertar | Nível |
|---|---|---|---|
| CO₂ crítico (risco de mal-estar/desmaio) | > 3000 ppm | **1 minuto** | 🚨 critico |
| CO₂ alto | > 1500 ppm | **5 minutos** | ⚠️ alto |
| PM2.5 | > 35 µg/m³ | 10 minutos | 🚨 critico |
| VOC | > 200 | 10 minutos | 🚨 critico |
| Temperatura | fora de 18–26 °C | 10 minutos | 🚨 critico |
| Umidade | fora de 30–70% | 10 minutos | 🚨 critico |

- Um pico isolado de 30 s **não** dispara nada: a condição precisa persistir pela janela inteira (leituras consecutivas ruins; buracos de coleta > 3 min zeram a contagem).
- **Anti-spam:** 1 alerta a cada 30 min por sala/parâmetro/nível — por nível para permitir o escalonamento alto → crítico dentro da mesma meia hora (um risco maior nunca fica silenciado).
- **Normalização:** quando o parâmetro volta ao nível seguro, o alerta é fechado e uma mensagem ✅ de normalizado é enviada.
- Todo disparo fica gravado na tabela `alertas` e aparece na aba **Incidentes** do dashboard (`GET /api/alertas`), incluindo falhas de envio — nenhum incidente se perde mesmo com o WhatsApp fora do ar.

### Configurando o WhatsApp (uma única vez)

1. No `.env`, defina `EVOLUTION_API_KEY` (invente uma chave forte) e suba a stack.
2. Abra o **Manager** da Evolution: `http://SEU-HOST:8081/manager` → conecte usando a URL do servidor e a `EVOLUTION_API_KEY`.
3. Crie uma instância com o **mesmo nome** de `EVOLUTION_INSTANCE` (padrão: `escola`), tipo *Baileys*.
4. Escaneie o QR Code com o WhatsApp do número dedicado do projeto.
5. Cadastre os destinatários iniciais em `ALERTA_NUMEROS` (números `5511999999999` ou grupos `120363...@g.us`, separados por vírgula) — a partir da Fase 3 esse cadastro será feito pelo portal.

> **Volume `pgdata` antigo (criado na Fase 1)?** O database da Evolution é criado
> automaticamente só na primeira inicialização do volume. Para stacks já existentes,
> rode uma única vez:
> `docker compose exec db psql -U iaq -c 'CREATE DATABASE evolution OWNER iaq;'`

### Variáveis de ambiente novas

| Variável | Padrão | Descrição |
|---|---|---|
| `EVOLUTION_API_KEY` | — (obrigatória) | Chave de autenticação da Evolution API |
| `EVOLUTION_INSTANCE` | `escola` | Nome da instância WhatsApp |
| `EVOLUTION_PORT` | `8081` | Porta do Manager no host |
| `ALERTA_NUMEROS` | vazio | Destinatários iniciais (separados por vírgula) |
| `DASHBOARD_URL` | vazio | URL pública do painel, anexada às mensagens |

### Testando um alerta sem esperar o ar piorar

```bash
# 1. Insere uma leitura crítica "90 segundos atrás" direto no banco:
docker compose exec db psql -U iaq -d iaq -c \
  "INSERT INTO leituras (sala, data_hora, co2) VALUES (3, now()-interval '90 seconds', 3200);"

# 2. Envia a leitura "atual" (como o ESP32 faria):
curl -X POST http://localhost:3000/api/sala3 -H 'Content-Type: application/json' \
  -d '{"co2":3200,"temperatura":24,"umidade":50,"pm25":10,"voc":80}'

# 3. O alerta aparece em:
curl http://localhost:3000/api/alertas
```

---

## 🔐 Fase 3 — Portal com login, provisionamento de salas e simulação realista (implementada)

### Login e perfis de acesso

O portal agora **exige autenticação** (tela de login). O primeiro administrador é criado
automaticamente na primeira inicialização com `ADMIN_USUARIO` / `ADMIN_SENHA` do `.env`
(padrão `admin` / `admin123` — o log avisa para trocar). Sessões usam JWT de 12 h
assinado com `JWT_SECRET` (obrigatório no `.env`).

| Perfil | O que pode fazer |
|---|---|
| **visualizacao** | Ver dashboards, histórico e incidentes |
| **analise** | Visualização + **download das métricas** (botão CSV, rota `/api/historico.csv`) |
| **admin** | Tudo + aba **Configurações**: salas, destinatários WhatsApp e usuários |

A ingestão do ESP32 (`POST /api/salaN`) continua sem login de usuário — dispositivos
autenticam por token próprio (header `X-Device-Token`, reforçado na Fase 4).

### Aba Configurações (admin)

- **Salas**: adicionar sala pelo portal (o dashboard atualiza sozinho — a lista de
  salas agora vem de `GET /api/salas`, sem número fixo no código), desativar/reativar,
  e **baixar o arquivo de provisionamento** `sala-<id>.json`.
- **Destinatários WhatsApp**: cadastrar números (`5511999999999`) ou grupos
  (`120363...@g.us`), ativar/desativar/remover — substitui o `ALERTA_NUMEROS` do `.env`
  (que continua funcionando como seed inicial).
- **Usuários**: criar contas com perfil, ativar/desativar/remover (o sistema impede
  o admin de rebaixar/excluir a própria conta).

### Provisionando um ESP32 (fluxo completo)

**Placa vazia (o caso padrão):** o admin cria a sala na aba Configurações e o portal
baixa na hora um **`sala-<id>.ino`** — o firmware completo com id da sala, token do
dispositivo e URL do backend (`PUBLIC_BACKEND_URL`) já embutidos. É só abrir na
Arduino IDE, preencher o Wi-Fi (`ssid`/`password`) e dar Upload: a placa nasce em
modo produção como nó daquela sala, enviando o token no header `X-Device-Token`.
Um diálogo com esse passo a passo abre automaticamente após o download.

**Placa já usada em outra sala, ou trocando a rede Wi-Fi:** tudo sem recompilar,
pela página local `http://IP-DO-ESP32/config` — cole o `sala-<id>.json` da nova
sala (rota `GET /api/salas/<id>/provisionamento`) e/ou informe a nova rede, que
fica salva na flash (se a rede nova falhar em 30 s, a placa volta sozinha para a
rede do código). NVS tem prioridade sobre o embutido; "Limpar provisionamento"
desfaz tudo.

**Perdeu a rede por completo** (roteador trocado, SSID/senha mudados)? Sem pânico e
sem USB: depois de 90 s sem conectar em nenhuma rede, a placa entra em **modo de
recuperação** — cria o Wi-Fi `SchoolAir-Sala<N>` (senha `arescolar123`) com a mesma
página `/config` em `http://192.168.4.1`. Conecte um celular nesse Wi-Fi, salve a
rede nova e a placa reinicia normalmente.

### Simulação realista (firmware)

O modo simulação deixou de usar `random()` puro:
- **Inércia (random-walk):** cada leitura evolui gradualmente rumo a um alvo — sem saltos de 20→33 °C;
- **Curva de ocupação escolar:** CO₂/temperatura/VOC sobem nos horários de aula
  (7h-12h e 13h-18h, com quedas nos intervalos das 10h/12h/15h) e caem à noite —
  a hora real vem de **NTP** (fuso de Brasília; sem internet, usa um dia sintético);
- **Episódios de CO₂:** sorteios periódicos elevam uma sala a nível ALTO (~1750 ppm)
  ou CRÍTICO (~3350 ppm) por 4-11 min — de propósito, para validar os dois níveis
  de alerta do WhatsApp.

### Variáveis de ambiente novas

| Variável | Padrão | Descrição |
|---|---|---|
| `JWT_SECRET` | — (obrigatória) | Segredo dos tokens de sessão |
| `ADMIN_USUARIO` | `admin` | Login do administrador inicial |
| `ADMIN_SENHA` | `admin123` | Senha do administrador inicial (troque!) |
| `PUBLIC_BACKEND_URL` | vazio | URL pública gravada nos arquivos de provisionamento |

---

## 🛡️ Fase 4 — Robustez e análise (implementada)

### Autenticação do dispositivo (anti dados falsos)

Salas criadas pelo portal têm **token de dispositivo**: o `POST /api/salaN` dessas
salas só é aceito com o header `X-Device-Token` correto (o ESP32 provisionado envia
automaticamente). As salas 1-10 do seed (sem token) continuam abertas para o modo
simulação — ao provisionar um ESP32 real para elas, gere o arquivo na aba
Configurações e o token passa a ser exigido.

### Validação de faixas plausíveis

Valores não numéricos **ou fisicamente implausíveis** (ex.: temperatura de 300 °C,
CO₂ negativo) viram `NULL` e não poluem as métricas; payload sem nenhuma métrica
válida é rejeitado com `400`.

| Métrica | Faixa aceita |
|---|---|
| temperatura | −10 a 60 °C |
| umidade | 0 a 100% |
| co2 | 0 a 10 000 ppm |
| pm1/pm25/pm4/pm10 | 0 a 1 000 µg/m³ |
| voc/nox | 0 a 510 (escala Sensirion) |
| luz | 0 a 200 000 lx |

### Buffer offline no ESP32

No modo produção, se o Wi-Fi cair ou o backend não responder, as leituras vão para
um **buffer na RAM (60 leituras = 30 min)** e são reenviadas quando a conexão volta
(5 por ciclo), com o campo `idade_s` — o backend **corrige o timestamp** para o
momento real da medição (limite 24 h). O firmware também tenta `WiFi.reconnect()`
sozinho. Buffer cheio descarta a leitura mais antiga.

### Relatório semanal automático no WhatsApp

Toda **segunda-feira às 7h** (hora de São Paulo), os destinatários recebem o resumo
dos últimos 7 dias: CO₂ médio/máximo por sala, horas em nível crítico, número de
alertas e a sala com pior ar da semana. Controle de duplicidade na tabela
`app_estado`. Para demonstrar sem esperar segunda:
`POST /api/relatorio-semanal/testar` (admin) devolve o texto e dispara o envio.

### Rota de análise (base do relatório do PI)

`GET /api/analise?inicio=&fim=` (perfil análise+) → por sala: amostras, CO₂
médio/máximo, horas em nível crítico e alertas no período, ranking das piores
primeiro — os números que sustentam a discussão bem-estar × desempenho × evasão.

---

## 🏁 Fase 5 — Validação e entrega (implementada)

### Teste end-to-end automatizado

```bash
./scripts/teste-e2e.sh
```

Sobe uma stack isolada (projeto `schoolair-e2e`, portas 3100/8180 — não conflita
com a stack em produção), executa ~20 verificações cobrindo as Fases 1-4 e derruba
tudo ao final. Ideal para regressão após qualquer mudança e para fechar a
apresentação ("20 verificações, 0 falhas").

### Roteiro de validação e demonstração

O documento [`docs/VALIDACAO.md`](docs/VALIDACAO.md) traz:
- o checklist de validação com **hardware real** (montagem, provisionamento da
  11ª sala pelo portal, 1 semana de coleta, alerta real, buffer offline, perfis);
- o **roteiro de demonstração** passo a passo para a banca;
- a tabela de **aderência ao requisito da disciplina** (captura, processamento,
  análise, interface web/móvel, autonomia).

> ⚠️ O firmware das Fases 3-4 (provisionamento, buffer, simulação realista)
> ainda **não foi compilado em hardware** — valide na Arduino IDE antes de gravar.

---

## 🔒 Proteção extra da API pública: Cloudflare Access (Service Token)

Quando o backend fica exposto pelo Cloudflare Tunnel, dá para fechar a borda com
uma Application do **Cloudflare Access** — quem chegar sem credencial leva 403 do
próprio Cloudflare, antes de tocar o servidor. Máquinas (os ESP32) passam com um
**Service Token**, sem tela de login:

1. *Zero Trust → Access → Service Auth* → criar o Service Token (Client ID + Secret);
2. *Access → Applications → Self-hosted* → domínio `api.seu-dominio.com` → política
   com **Action = Service Auth** incluindo esse token;
3. No `.env` da stack: `CF_ACCESS_CLIENT_ID` e `CF_ACCESS_CLIENT_SECRET`;
4. Pronto: os arquivos de provisionamento `sala-<id>.json` passam a incluir as
   credenciais, o ESP32 as guarda na flash e envia os headers
   `CF-Access-Client-Id` / `CF-Access-Client-Secret` em cada requisição.

O portal **não** é afetado pelo Access: o navegador só fala com o host do
frontend, e o nginx da stack repassa o `/api` para o backend por dentro da rede
do Docker — a borda protegida fica exclusiva para a frota de ESP32. De quebra,
o nginx devolve **403** para `POST /api/sala<N>` no host público: leitura de
sensor só entra pela borda com Service Token, o que impede dado forjado por
quem não tem a credencial.

O **mesmo token serve para toda a frota** de ESP32 (a identidade individual de cada
dispositivo continua sendo o `X-Device-Token` da sala); revogar o token no painel
do Cloudflare corta todos de uma vez. Dispositivos já provisionados antes do Access
precisam ser reprovisionados (baixar o arquivo de novo e recolar em `/config`).

> ⚠️ Não use Access no hostname consumido pelo *rewrite* da Vercel — o proxy dela
> não injeta headers e o painel quebraria. O desenho limpo é: `painel.seu-dominio.com`
> → nginx da stack (fala com o backend por dentro) e `api.seu-dominio.com` → backend
> com Access, usado **somente** pelos ESP32. O Manager da Evolution (`:8081`) nunca
> deve ganhar hostname público.

---

## 🧪 Modo desenvolvimento: alertas pelo gateway n8n existente

Para desenvolver sem parear um número de WhatsApp dedicado, o backend tem um modo
gateway: se a variável `N8N_WEBHOOK_URL` estiver definida, os envios saem como
`POST { numero, texto }` para esse webhook do n8n — que entrega pela Evolution já
existente do ambiente — em vez da Evolution da própria stack.

```
# DEV  → alertas saem pelo gateway n8n (Evolution pessoal do ambiente)
N8N_WEBHOOK_URL=http://SEU-N8N:5678/webhook/<path-do-ramo>

# PROD → deixe vazia: tudo sai pela Evolution da própria stack (comportamento padrão)
N8N_WEBHOOK_URL=
```

- Em DEV não é preciso subir `evolution`/`redis`: `docker compose up -d db backend frontend`
  (o `.env` ainda precisa de `EVOLUTION_API_KEY` preenchida com qualquer valor, o compose exige).
- Detalhe de semântica: no modo gateway, "enviado" na aba Incidentes significa
  "aceito pelo n8n" — a entrega final acontece de forma assíncrona no workflow.
- Nada mais muda entre os modos: regras de alerta, incidentes, relatório e portal
  são idênticos; a chave só troca o transporte da mensagem.

---

## 🔌 Gravando o firmware num ESP32 zerado (primeira vez, via USB)

Um ESP32 recém-comprado não tem nada dentro — antes de provisionar pela página
`/config`, é preciso gravar o firmware do projeto **uma única vez**:

1. **Arduino IDE 2.x** instalada ([arduino.cc/en/software](https://www.arduino.cc/en/software)).
2. **Suporte às placas ESP32**: *File → Preferences → Additional boards manager URLs* →
   cole `https://espressif.github.io/arduino-esp32/package_esp32_index.json` →
   depois *Tools → Board → Boards Manager* → instale **"esp32 by Espressif Systems"**.
3. **Driver USB** (se o computador não criar a porta COM ao plugar o cabo):
   a maioria das DevKit usa chip **CP210x** ou **CH340** — instale o driver correspondente.
   Use um cabo USB **de dados** (cabo só-carga é a causa nº 1 de "não aparece porta").
4. Abra `esp32/esp32_air_quality.ino` e edite só duas linhas:
   `ssid` e `password` do Wi-Fi. (IP fixo é opcional e vem comentado; DHCP é o padrão.
   `BASE_URL` só importa no modo simulação — no modo produção a URL vem do provisionamento.)
5. *Tools → Board* → **ESP32 Dev Module** (ou "DOIT ESP32 DEVKIT V1") e selecione a porta COM.
6. **Upload** (seta →). Se aparecer `Failed to connect… Connecting…`, segure o botão
   **BOOT** da placa durante a tentativa de conexão e solte quando começar a gravar.
7. Abra o **Serial Monitor a 115200 baud**: na inicialização o ESP32 imprime o
   `IP Local` — é esse IP que você usa em `http://IP-DO-ESP32/config` para colar
   o `sala-<id>.json` baixado do portal.

> Bibliotecas: no **modo simulação** não precisa instalar nenhuma (WiFi, HTTPClient,
> WebServer e Preferences já vêm com o core ESP32). As bibliotecas da Sensirion
> (SEN5x/SCD4x) só entram quando os sensores físicos forem ligados — as linhas
> estão comentadas no `.ino` com instruções.

> **Atalho:** se a sala já existe no portal, baixe o `sala-<id>.ino` pela aba
> Configurações — ele já vem com sala, token e servidor embutidos, e os passos
> acima se resumem a preencher o Wi-Fi e gravar.
