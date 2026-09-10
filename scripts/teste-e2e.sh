#!/usr/bin/env bash
# ============================================================================
# teste-e2e.sh — Teste end-to-end da stack School Air (v2 / Fase 5)
#
# Sobe uma stack ISOLADA (projeto docker "schoolair-e2e", portas próprias),
# executa as verificações das Fases 1-4 e derruba tudo no final.
#
# Uso:   ./scripts/teste-e2e.sh
# Saída: lista de ✅/❌ e código de saída 0 (tudo ok) ou 1 (alguma falha).
#
# Nota: a Evolution API não sobe aqui (o pull é pesado e o pareamento exige
# QR Code); o motor de alertas é testado mesmo assim — a falha de envio fica
# registrada no incidente, que é exatamente o comportamento esperado.
# ============================================================================
set -u
cd "$(dirname "$0")/.."

PROJETO=schoolair-e2e
export DB_PASSWORD=${DB_PASSWORD:-e2e-senha}
export JWT_SECRET=${JWT_SECRET:-e2e-segredo}
export EVOLUTION_API_KEY=${EVOLUTION_API_KEY:-e2e-chave}
export ADMIN_USUARIO=admin
export ADMIN_SENHA=${ADMIN_SENHA:-e2e-admin}
export ALERTA_NUMEROS=5511900000000
export BACKEND_PORT=${BACKEND_PORT:-3100}
export FRONTEND_PORT=${FRONTEND_PORT:-8180}
export EVOLUTION_PORT=${EVOLUTION_PORT:-8181}
API="http://localhost:$BACKEND_PORT"
FRONT="http://localhost:$FRONTEND_PORT"

PASSA=0; FALHA=0
ok()     { echo "  ✅ $1"; PASSA=$((PASSA+1)); }
falha()  { echo "  ❌ $1"; FALHA=$((FALHA+1)); }
verifica(){ [ "$1" = "$2" ] && ok "$3" || falha "$3 (esperado $2, veio $1)"; }
json()   { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }
sql()    { docker compose -p $PROJETO exec -T db psql -U iaq -d iaq -q -c "$1"; }
espera() { sql "SELECT pg_sleep($1);" >/dev/null; }

cleanup(){ echo "== Derrubando stack de teste =="; docker compose -p $PROJETO down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== Subindo stack isolada ($PROJETO — backend :$BACKEND_PORT, front :$FRONTEND_PORT) =="
docker compose -p $PROJETO up -d --build db backend frontend >/dev/null 2>&1
curl --retry 40 --retry-delay 2 --retry-all-errors -fs "$API/api/status" >/dev/null \
  || { echo "❌ backend não subiu"; exit 1; }
ok "stack no ar"

echo "== Autenticação e perfis =="
verifica "$(curl -s -o /dev/null -w '%{http_code}' $API/api/salas)" 401 "GET sem sessão é bloqueado (401)"
TK=$(curl -fs -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"usuario\":\"admin\",\"senha\":\"$ADMIN_SENHA\"}" | json "['token']") \
  && ok "login do admin" || falha "login do admin"
verifica "$(curl -fs -H "Authorization: Bearer $TK" $API/api/salas | json '.__len__()' 2>/dev/null || \
  curl -fs -H "Authorization: Bearer $TK" $API/api/salas | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')" 10 "10 salas do seed"
curl -fs -X POST $API/api/usuarios -H "Authorization: Bearer $TK" -H 'Content-Type: application/json' \
  -d '{"nome":"Analista","usuario":"analista","senha":"a1","perfil":"analise"}' >/dev/null && ok "criou usuário analista"
curl -fs -X POST $API/api/usuarios -H "Authorization: Bearer $TK" -H 'Content-Type: application/json' \
  -d '{"nome":"Viewer","usuario":"viewer","senha":"v1","perfil":"visualizacao"}' >/dev/null && ok "criou usuário viewer"
TKA=$(curl -fs -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"usuario":"analista","senha":"a1"}' | json "['token']")
TKV=$(curl -fs -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"usuario":"viewer","senha":"v1"}' | json "['token']")
verifica "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TKV" $API/api/usuarios)" 403 "viewer bloqueado em rota admin"
verifica "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TKV" "$API/api/historico.csv?sala=1")" 403 "viewer bloqueado no CSV"

echo "== Ingestão, validação e histórico (Fases 1 e 4) =="
verifica "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/sala1 -H 'Content-Type: application/json' \
  -d '{"temperatura":22.5,"umidade":50,"co2":650,"pm1":5,"pm25":8,"pm4":9,"pm10":12,"voc":60,"nox":8,"luz":400}')" 200 "POST de leitura aceito"
verifica "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/sala1 -H 'Content-Type: application/json' \
  -d '{"temperatura":"abc","co2":-5}')" 400 "payload sem métrica válida rejeitado"
TEMP_NULA=$(curl -fs -X POST $API/api/sala1 -H 'Content-Type: application/json' \
  -d '{"temperatura":300,"co2":660,"umidade":50}' >/dev/null \
  && curl -fs -H "Authorization: Bearer $TK" "$API/api/sala1?limit=1" | json "[0]['temperatura']")
verifica "$TEMP_NULA" None "temperatura implausível (300°C) descartada"
IDADE=$(curl -fs -X POST $API/api/sala2 -H 'Content-Type: application/json' \
  -d '{"co2":700,"temperatura":23,"umidade":50,"idade_s":3600}' | python3 -c "
import json,sys,datetime
d=json.load(sys.stdin)
dt=datetime.datetime.fromisoformat(d['registro']['data'].replace('Z','+00:00'))
print(round((datetime.datetime.now(datetime.timezone.utc)-dt).total_seconds()/100)*100)")
verifica "$IDADE" 3600 "idade_s corrige o timestamp do buffer"
TOTAL_H=$(curl -fs -H "Authorization: Bearer $TK" "$API/api/historico?sala=1" | json "['total']")
[ "$TOTAL_H" -ge 2 ] && ok "consulta de histórico por período" || falha "histórico ($TOTAL_H)"
BUCKETS=$(curl -fs -H "Authorization: Bearer $TK" "$API/api/agregado?sala=1&intervalo=hora" | json "['total']")
[ "$BUCKETS" -ge 1 ] && ok "agregação por hora" || falha "agregação ($BUCKETS)"
curl -fs -H "Authorization: Bearer $TKA" "$API/api/historico.csv?sala=1" | head -1 | grep -q "data;temperatura" \
  && ok "analista baixa CSV" || falha "CSV do analista"

echo "== Provisionamento e token de dispositivo (Fases 3 e 4) =="
NOVA=$(curl -fs -X POST $API/api/salas -H "Authorization: Bearer $TK" -H 'Content-Type: application/json' \
  -d '{"nome":"Sala E2E"}' | json "['id']") && ok "sala nova criada pelo portal (id $NOVA)"
TOKEN_DEV=$(curl -fs -H "Authorization: Bearer $TK" "$API/api/salas/$NOVA/provisionamento" | json "['token']")
[ -n "$TOKEN_DEV" ] && ok "arquivo de provisionamento com token" || falha "provisionamento"
verifica "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/sala$NOVA" -H 'Content-Type: application/json' \
  -d '{"co2":500,"temperatura":22}')" 401 "sala provisionada recusa POST sem token"
verifica "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/sala$NOVA" -H 'Content-Type: application/json' \
  -H "X-Device-Token: $TOKEN_DEV" -d '{"co2":500,"temperatura":22,"umidade":50}')" 200 "sala provisionada aceita POST com token"

echo "== Motor de alertas (Fase 2) =="
sql "INSERT INTO leituras (sala, data_hora, co2, temperatura, umidade, pm25, voc)
     VALUES (3, now()-interval '90 seconds', 3200, 24, 50, 10, 80);" >/dev/null
curl -fs -X POST $API/api/sala3 -H 'Content-Type: application/json' \
  -d '{"co2":3200,"temperatura":24,"umidade":50,"pm25":10,"voc":80}' >/dev/null
espera 4
NIVEL=$(curl -fs -H "Authorization: Bearer $TK" "$API/api/alertas?sala=3&limit=1" | json "[0]['nivel']")
verifica "$NIVEL" critico "alerta CO2 crítico dispara em ≤1 min"
curl -fs -X POST $API/api/sala3 -H 'Content-Type: application/json' \
  -d '{"co2":600,"temperatura":24,"umidade":50,"pm25":10,"voc":80}' >/dev/null
espera 3
NORM=$(curl -fs -H "Authorization: Bearer $TK" "$API/api/alertas?sala=3&limit=1" | json "['normalizado_em' in %s[0] and %s[0]['normalizado_em'] is not None]" 2>/dev/null || \
  curl -fs -H "Authorization: Bearer $TK" "$API/api/alertas?sala=3&limit=1" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['normalizado_em'] is not None)")
verifica "$NORM" True "normalização fecha o alerta"

echo "== Análise e relatório (Fase 4) =="
RANK=$(curl -fs -H "Authorization: Bearer $TKA" "$API/api/analise" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['salas']) >= 10)")
verifica "$RANK" True "/api/analise devolve o ranking das salas"
curl -fs -X POST $API/api/relatorio-semanal/testar -H "Authorization: Bearer $TK" | json "['texto']" | head -1 | \
  grep -q "Relatório semanal" && ok "relatório semanal gerado sob demanda" || falha "relatório semanal"

echo "== Frontend =="
curl -fs "$FRONT/" | grep -q "login-overlay" && ok "portal servido com tela de login" || falha "frontend"
verifica "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TK" "$FRONT/api/salas")" 200 "proxy nginx /api"

echo ""
echo "=============================================="
echo " RESULTADO: $PASSA passaram, $FALHA falharam"
echo "=============================================="
[ "$FALHA" -eq 0 ]
