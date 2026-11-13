/**
 * ============================================================================
 * linkPainel.js — Linha "Painel: ..." no fim das mensagens de WhatsApp
 * ============================================================================
 *
 * POR QUE O LINK SAI SEM "https://" (13/11/2026): as mensagens com o endereço
 * completo (https://school-air...) constavam como entregues na Evolution, mas
 * NÃO apareciam no WhatsApp do destinatário. Sem o protocolo elas chegam.
 * O WhatsApp trata mensagem automática com link clicável como possível spam;
 * "school-air.univesp.dev" continua legível e a pessoa abre do mesmo jeito.
 */

/**
 * Tira "http://" ou "https://" do começo e a barra do fim.
 *
 * Exemplo: enderecoSemProtocolo('https://school-air.univesp.dev/') -> 'school-air.univesp.dev'
 */
export function enderecoSemProtocolo(url) {
  return String(url ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Linha pronta para o fim da mensagem, ou '' quando não há painel configurado.
 *
 * Exemplo: linhaDoPainel('https://school-air.univesp.dev') -> 'Painel: school-air.univesp.dev'
 */
export function linhaDoPainel(url) {
  const endereco = enderecoSemProtocolo(url);
  return endereco ? `Painel: ${endereco}` : '';
}
