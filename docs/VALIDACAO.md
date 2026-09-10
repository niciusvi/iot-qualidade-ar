# Fase 5 — Roteiro de Validação e Entrega

Checklist para a validação final do School Air e roteiro de demonstração
para a apresentação do Projeto Integrador.

## 1. Validação automática do software (feito ✅)

```bash
./scripts/teste-e2e.sh
```

Sobe uma stack isolada, executa ~20 verificações cobrindo as Fases 1-4
(autenticação/perfis, ingestão com validação, histórico/agregação/CSV,
provisionamento + token de dispositivo, motor de alertas com normalização,
análise e relatório semanal) e derruba tudo. Deve terminar com **0 falhas**.

## 2. Validação com hardware real (pendente — requer o ESP32 físico)

### 2.1 Montagem e sensores
- [ ] Montar ESP32 + SEN5x + SCD4x + LDR conforme o diagrama do README (pull-ups 4,7 kΩ!)
- [ ] Rodar o sketch *Scanner I2C* do README → deve encontrar `0x62` (SCD4x) e `0x69` (SEN5x)
- [ ] Gravar o firmware `esp32/esp32_air_quality.ino` **(compilar na Arduino IDE — o firmware
      das Fases 3-4 ainda não foi compilado em hardware)** com as credenciais de Wi-Fi

### 2.2 Provisionamento da 11ª sala (valida o fluxo do portal)
- [ ] No portal (admin) → aba Configurações → adicionar sala (ex.: "Laboratório")
- [ ] Baixar o `sala-11.json` gerado
- [ ] Acessar `http://IP-DO-ESP32/config`, colar o conteúdo do arquivo e salvar
- [ ] Confirmar no Serial Monitor: `[PROV] Dispositivo provisionado via portal: Sala 11`
- [ ] Confirmar que a sala aparece no dashboard e recebe leituras reais
- [ ] Confirmar no backend que POSTs **sem** o token são recusados (401)

### 2.3 Coleta contínua (1 semana)
- [ ] Deixar o dispositivo coletando por 7 dias em ambiente real
- [ ] Verificar a aba Histórico: consulta por data, médias por hora/dia coerentes
- [ ] Exportar o CSV da semana e abrir no Excel/LibreOffice

### 2.4 Teste de alerta real
- [ ] Exalar próximo ao SCD4x ou fechar a sala até CO₂ > 1500 ppm por 5 min → alerta ⚠️ no WhatsApp
- [ ] (Com cuidado) elevar acima de 3000 ppm por 1 min → alerta 🚨 em até 1 minuto
- [ ] Ventilar → mensagem ✅ de normalização
- [ ] Conferir a aba Incidentes com os registros

### 2.5 Teste do buffer offline
- [ ] Derrubar o Wi-Fi por ~10 min com o dispositivo em produção
- [ ] Religar e conferir no Serial: `[BUFFER] N leituras reenviadas`
- [ ] No Histórico, conferir que as leituras do período offline aparecem com o
      horário correto (correção via `idade_s`)

### 2.6 Perfis de acesso
- [ ] Criar um usuário `visualizacao` e conferir: sem botão CSV, sem aba Configurações
- [ ] Criar um usuário `analise` e conferir o download do CSV
- [ ] Conferir que o link do portal exige login

## 3. Roteiro de demonstração (apresentação)

1. **Arquitetura** (1 min): diagrama do README — ESP32 → API Docker → Postgres;
   alertas → Evolution → WhatsApp; portal Vercel/nginx.
2. **Login** com perfil admin → Visão Geral das 10 salas simuladas (cores IAQ).
3. **Dashboard** de uma sala: métricas, badges, gráficos em tempo real.
4. **Histórico**: consulta por período no banco + exportação CSV.
5. **Incidentes**: mostrar um episódio de CO₂ da simulação disparando alerta
   no WhatsApp do celular (ao vivo — a simulação gera episódios sozinha).
6. **Configurações**: criar uma sala nova → arquivo `sala-N.json` baixa na hora →
   mostrar a página `/config` do ESP32 (provisionamento).
7. **Relatório semanal**: `POST /api/relatorio-semanal/testar` → mensagem chega
   no WhatsApp com o ranking da semana.
8. **Encerramento**: rodar `./scripts/teste-e2e.sh` ao vivo → "20 verificações, 0 falhas".

## 4. Aderência ao requisito da disciplina

> "Desenvolver um sistema IoT com captura, análise e processamento de dados.
> O sistema pode ser tanto autônomo quanto ter uma interface web ou por
> dispositivo móvel."

| Requisito | Onde está |
|---|---|
| Captura | ESP32 + SEN5x/SCD4x/LDR (ou simulação realista), 1 leitura/30 s |
| Processamento | API Express valida, autentica, persiste (Postgres), agrega por hora e aplica retenção |
| Análise | Classificação IAQ, histórico por período, `/api/analise` (ranking, horas críticas), relatório semanal |
| Interface web | Portal com login e 5 abas (Visão Geral, Dashboard, Histórico, Incidentes, Configurações) |
| Dispositivo móvel | Alertas e relatório no WhatsApp + portal responsivo |
| Autônomo | Alertas em níveis (1/5/10 min) e relatório semanal funcionam sem ninguém olhar o painel |
