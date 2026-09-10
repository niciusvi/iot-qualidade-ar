#!/bin/sh
# Executado pelo Postgres APENAS na primeira inicialização do volume (pgdata vazio).
# Cria o database exclusivo da Evolution API dentro do mesmo container Postgres,
# mantendo a stack autossuficiente (sem depender de infraestrutura externa).
#
# Se o volume pgdata JÁ existir (stack antiga), rode manualmente uma única vez:
#   docker compose exec db psql -U iaq -c 'CREATE DATABASE evolution OWNER iaq;'
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE evolution OWNER $POSTGRES_USER;
EOSQL
