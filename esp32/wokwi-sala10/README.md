# Simulação da Sala 10 no Wokwi

Um ESP32 virtual com os **três sensores do projeto** (SCD4x, SEN5x e LDR) que envia
leituras para o backend real como se fosse a placa da **sala 10**.

O [Wokwi](https://wokwi.com) é um simulador de eletrônica que roda no navegador:
ele executa o mesmo programa que iria para a placa e desenha o circuito na tela.

## Arquivos da pasta

| Arquivo | Para que serve |
|---|---|
| `sketch.ino` | O programa do ESP32: lê os sensores e faz o POST a cada 30 s |
| `leitura_sala.h` | O "pacote" com os 10 campos de uma leitura |
| `segredos.example.h` | Modelo das credenciais (vai para o git) |
| `segredos.h` | Credenciais reais (**fora do git**, criado a partir do modelo) |
| `diagram.json` | O circuito: quais peças existem e que fio liga em que pino |
| `libraries.txt` | Bibliotecas que o Wokwi instala antes de compilar |
| `scd4x.chip.json` + `scd4x.chip.c` | Sensor SCD4x simulado (CO₂, temperatura, umidade) |
| `sen5x.chip.json` + `sen5x.chip.c` | Sensor SEN5x simulado (partículas, VOC, NOx) |

O Wokwi não tem o SCD4x nem o SEN5x no catálogo. Os arquivos `.chip.*` são
"custom chips": pequenos programas que respondem no barramento I2C igual aos
sensores reais (mesmo endereço, mesmos comandos, mesmo CRC). Por isso o sketch
usa as **bibliotecas oficiais da Sensirion**, as mesmas do firmware de produção.

## Ligações (iguais à montagem real do README principal)

| Peça | Pino da peça | Pino do ESP32 |
|---|---|---|
| SCD4x | VCC / GND | 3V3 / GND.2 |
| SCD4x | SDA / SCL | GPIO 21 / GPIO 22 |
| SEN5x | VCC / GND | 5V / GND.3 |
| SEN5x | SDA / SCL | SDA / SCL do SCD4x (mesmo barramento I2C, ligado em cadeia) |
| SEN5x | SEL | GND do próprio SEN5x (seleciona I2C) |
| LDR | VCC / GND | 3V3 / GND.1 |
| LDR | AO | GPIO 34 |

Cores dos fios (também escritas no desenho): vermelho = 3V3, laranja = 5V,
preto = GND, azul = SDA, amarelo = SCL, verde = AO.

Os fios têm rota fixa no `diagram.json` (a lista `["h-15", "v-50", ...]` de cada
ligação: andar na horizontal/vertical tantas unidades a partir do primeiro pino).
Sem ela, o Wokwi traça o fio pelo caminho mais curto, que passa por cima dos
pinos do ESP32 e do nome dos sensores. Os pinos dos chips ficam todos do lado
esquerdo porque o `chip.json` completa a lista com posições vazias (`""`) —
senão metade dos pinos iria para o lado direito e os fios cruzariam o chip.

Diferença para a bancada: **não há resistores de pull-up de 4,7 kΩ** no desenho.
O simulador trabalha com sinais digitais ideais e não precisa deles; na placa
de verdade eles continuam obrigatórios.

## Antes de rodar: o que fazer com a placa física

A placa que está hoje em **modo simulação** envia dados inventados para as salas
1 a 10. Se ela continuar ligada, a sala 10 recebe **duas fontes ao mesmo tempo**
(a placa e o Wokwi) e o gráfico vira um zigue-zague entre os dois valores.

Escolha uma das saídas:

1. **Gerar o token da sala 10** (passo 1 abaixo). A placa física não conhece o
   token, então os POSTs dela na sala 10 passam a ser recusados (401) e só o
   Wokwi grava lá. As salas 1 a 9 continuam normais. Nada para regravar; o
   Serial da placa vai mostrar `Sala 10 - POST 401` a cada ciclo, o que é esperado.
2. **Regravar a placa com `TOTAL_SALAS = 9`** (`esp32/esp32_air_quality.ino`).
   Mesmo resultado, sem os 401 no Serial.
3. **Desligar a placa.** As salas 1 a 9 ficam "Sem leitura recente".

## Passo a passo

1. Copie `segredos.example.h` para `segredos.h` e preencha. Todos os valores
   estão num arquivo só: no portal, **Configurações → Salas → botão
   "provisionamento" da sala 10** baixa o `sala-10.ino`. Dele saem
   `TOKEN_COMPILADO` → `TOKEN_DA_SALA`, `CF_ID_COMPILADO` →
   `CF_ACCESS_CLIENT_ID` e `CF_SECRET_COMPILADO` → `CF_ACCESS_CLIENT_SECRET`.
   As salas 1–10 nascem sem token, mas esse download **gera** um: a partir daí
   todo POST na sala 10 sem o token recebe 401 — inclusive o da placa física
   em modo simulação (as salas 1–9 dela continuam funcionando).
2. Abra <https://wokwi.com/projects/new/esp32>.
3. Na seta ao lado das abas de arquivo, escolha **Upload file(s)...** e envie
   estes 7 arquivos: `libraries.txt`, `leitura_sala.h`, `segredos.h`,
   `scd4x.chip.json`, `scd4x.chip.c`, `sen5x.chip.json`, `sen5x.chip.c`.
4. O `sketch.ino` e o `diagram.json` **não podem ser enviados** por upload: o
   projeto novo já tem arquivos com esses nomes e o Wokwi recusa ("A file with
   this name already exists"). Abra cada aba, apague tudo (Ctrl+A, Delete) e
   cole o conteúdo do arquivo desta pasta. Os dois sensores devem aparecer no
   desenho logo depois de colar o `diagram.json`.
5. Clique no **Play** (botão verde). A compilação acontece nos servidores do
   Wokwi e, no plano gratuito, entra numa fila: pode levar alguns minutos ou
   terminar em "Build Servers Busy". Nesse caso, feche o aviso e clique no Play
   de novo (ou tente em outro horário).
6. No monitor serial deve aparecer, a cada 30 s:
   `Sala 10 - POST 200 | {"temperatura":24.0,"umidade":55.1,"co2":803,...}`
7. Abra o portal e entre na sala 10: as leituras chegam em tempo real.

## Mexendo nos sensores durante a simulação

Com a simulação rodando, **clique em uma peça** para abrir os controles:

| Peça | Controles | Para testar |
|---|---|---|
| SCD4x | CO₂, temperatura, umidade | CO₂ acima de 1500 ppm por 5 min → alerta ⚠️; acima de 3000 ppm por 1 min → alerta 🚨 |
| SEN5x | PM2.5, VOC, NOx | PM2.5 > 35 ou VOC > 200 por 10 min → alerta |
| LDR | lux | sala escura × iluminada |

Cada leitura leva um ruído pequeno (±8 ppm no CO₂, ±0,1 °C) para o gráfico não
ficar uma linha reta. PM1, PM4 e PM10 acompanham o PM2.5 em proporções fixas.

## Se algo der errado

| O que aparece no monitor serial | Causa provável | Como resolver |
|---|---|---|
| `POST 302` ou `POST 403` | Barrado no Cloudflare Access | Conferir os dois valores do Service Token no `segredos.h` |
| `POST 401` | A sala tem token de dispositivo | Preencher `TOKEN_DA_SALA` com o `TOKEN_COMPILADO` do `sala-10.ino` |
| `POST -1` + `ERRO de conexao` | Endereço errado ou sem internet | Conferir `BACKEND_URL` (com `https://`, sem barra no fim) |
| `[SCD4x] leitura falhou` | Fio de I2C fora do lugar | Conferir SDA = 21 e SCL = 22 no `diagram.json` |
| `segredos.h: No such file` | Faltou criar o arquivo | Passo 1 |
| `Build Servers Busy` | Fila de compilação gratuita do Wokwi cheia | Fechar o aviso e dar Play de novo |

## Cuidados

- **Não salve nem compartilhe o projeto no Wokwi com o `segredos.h` preenchido.**
  Projetos do Wokwi são públicos (qualquer um com o link lê todos os arquivos).
  O Service Token abre a porta do Cloudflare Access para o backend; o token da
  sala permite gravar leituras falsas na sala 10. Rode sem salvar, ou apague os
  valores antes de clicar em SAVE. Se já salvou: gere outro token (ver abaixo).
- Para a demonstração, o ideal é um **Service Token só para o Wokwi**, com
  validade curta, criado no Cloudflare Zero Trust e adicionado à política da
  aplicação do backend. Depois da apresentação, revogue — as placas reais, que
  usam o token da frota, não são afetadas.
- As leituras da simulação ficam **gravadas no banco de verdade** como sala 10 e
  **disparam alertas reais** no WhatsApp se passarem dos limites.
- O Wi-Fi `Wokwi-GUEST` só funciona no Wokwi do navegador (gratuito). No VS Code
  seria preciso licença e compilar os chips à mão — por isso não há `wokwi.toml`.

## O que esta simulação não cobre

Painel web local da placa, página `/config`, gravação na flash e buffer de
reenvio offline. Essas partes do firmware de produção dependem de acessar o IP
da placa ou de sobreviver a um reboot, o que o simulador do navegador não oferece.
