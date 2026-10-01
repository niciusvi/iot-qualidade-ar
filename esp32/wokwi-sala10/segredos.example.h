/**
 * segredos.example.h — MODELO das credenciais da simulação.
 *
 * COMO USAR: copie este arquivo com o nome `segredos.h` e preencha os valores.
 * O `segredos.h` está no .gitignore — nunca vai para o GitHub.
 *
 * POR QUE UM ARQUIVO À PARTE: microcontrolador não tem variável de ambiente.
 * Separar os segredos do código é o equivalente ao `.env` do backend: o
 * sketch pode ser publicado sem expor o endereço da API nem o Service Token.
 */
#pragma once

// Endereço público do backend, SEM barra no final e SEM "/api/sala".
// É o mesmo valor da env PUBLIC_BACKEND_URL do stack.
const char* const BACKEND_URL = "https://SEU-BACKEND-PUBLICO";

// Token do dispositivo (header X-Device-Token).
// ONDE PEGAR: portal → Configurações → Salas → botão "provisionamento" da
// sala 10. Ele baixa o sala-10.ino; copie o valor de TOKEN_COMPILADO.
// ATENÇÃO: as salas 1-10 nascem SEM token, mas o primeiro download do
// provisionamento gera um e, dali em diante, POST sem ele recebe 401.
const char* const TOKEN_DA_SALA = "";

// Cloudflare Access (Service Token). No mesmo sala-10.ino: CF_ID_COMPILADO e
// CF_SECRET_COMPILADO (vêm das envs CF_ACCESS_CLIENT_ID / _SECRET do stack).
// O Client ID já termina em ".access" — cole exatamente como está.
const char* const CF_ACCESS_CLIENT_ID = "";
const char* const CF_ACCESS_CLIENT_SECRET = "";
