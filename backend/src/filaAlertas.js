/**
 * ============================================================================
 * filaAlertas.js — Fila de consolidação dos avisos de WhatsApp
 * ============================================================================
 *
 * Separado do alertas.js para poder ser testado SEM banco e SEM rede: quem
 * envia e quem grava o resultado chegam por parâmetro (injeção de dependência).
 *
 * POR QUE EXISTE (bug de 12/11/2026): a versão anterior fazia `fila.clear()`
 * depois de enviar. O envio leva vários segundos (a Evolution simula
 * "digitando" por 3 s e há pausa de 2 s entre destinatários); todo aviso que
 * entrava na fila NESSE intervalo era apagado junto, sem nunca ter sido
 * enviado. Aqui só sai da fila o que realmente foi na mensagem.
 */

/**
 * Fila de eventos de alerta que viram UMA mensagem por descarga.
 *
 * Exemplo de uso:
 *   const fila = new FilaDeEventosDeAlerta({
 *     ehCritica: false,
 *     montarTextoDaMensagem: montarMensagem,
 *     enviarParaDestinatarios: enviarWhatsApp,
 *     registrarResultadoDoEnvio: gravarResultadoNosAlertas,
 *   });
 *   fila.enfileirar({ tipo: 'alerta', sala: 3, parametro: 'co2', nivel: 'alto', alertaId: 10 });
 *   await fila.descarregar();
 */
export class FilaDeEventosDeAlerta {
  constructor({ ehCritica, montarTextoDaMensagem, enviarParaDestinatarios, registrarResultadoDoEnvio }) {
    this.ehCritica = ehCritica;
    this.montarTextoDaMensagem = montarTextoDaMensagem;
    this.enviarParaDestinatarios = enviarParaDestinatarios;
    this.registrarResultadoDoEnvio = registrarResultadoDoEnvio;
    // Map deduplica sozinho: o mesmo sala/parâmetro/nível/tipo guarda só o
    // evento mais recente, então o tamanho é limitado por salas × regras.
    this.eventosPorChave = new Map();
  }

  /** Quantos eventos aguardam envio. */
  get tamanho() {
    return this.eventosPorChave.size;
  }

  /** Guarda o evento; um evento igual mais novo substitui o antigo. */
  enfileirar(evento) {
    const chave = `${evento.sala}:${evento.parametro}:${evento.nivel}:${evento.tipo}`;
    this.eventosPorChave.set(chave, evento);
  }

  /**
   * Envia tudo que está na fila em uma única mensagem.
   * Sucesso parcial conta como entregue (alguém foi avisado). Se TODOS os
   * envios falharem, a fila fica intacta e a próxima descarga tenta de novo.
   * Retorna o resultado do envio, ou null se a fila estava vazia.
   */
  async descarregar() {
    if (this.eventosPorChave.size === 0) return null;
    // Fotografia do que será enviado: a fila pode crescer durante o await.
    const enviadosAgora = [...this.eventosPorChave.entries()];
    const eventos = enviadosAgora.map(([, evento]) => evento);
    const envio = await this.enviarParaDestinatarios(this.montarTextoDaMensagem(eventos, this.ehCritica));
    const idsDosAlertas = eventos.filter((e) => e.alertaId).map((e) => e.alertaId);
    if (idsDosAlertas.length > 0) await this.registrarResultadoDoEnvio(idsDosAlertas, envio);
    if (envio.enviados.length > 0) this.removerSomenteOsEnviados(enviadosAgora);
    return envio;
  }

  /**
   * Tira da fila apenas os eventos que foram na mensagem. Se a mesma chave
   * recebeu um evento mais novo durante o envio, ele fica para a próxima.
   */
  removerSomenteOsEnviados(enviadosAgora) {
    for (const [chave, eventoEnviado] of enviadosAgora) {
      if (this.eventosPorChave.get(chave) === eventoEnviado) this.eventosPorChave.delete(chave);
    }
  }
}

/**
 * Cria um agendador que roda as descargas UMA POR VEZ, em ordem de chegada.
 *
 * Por que não rodar em paralelo: duas mensagens saindo ao mesmo tempo para o
 * mesmo número parecem robô para o anti-spam do WhatsApp.
 * Por que não simplesmente pular quando há outra em andamento (como era antes):
 * o digest que caía durante um envio da fila crítica só voltava a tentar
 * 5 minutos depois. Aqui ele espera a vez e sai em seguida.
 *
 * Exemplo de uso:
 *   const agendarDescarga = criarAgendadorDeDescargas(console.error);
 *   setInterval(() => agendarDescarga(filaCritica), 20000);
 */
export function criarAgendadorDeDescargas(avisarFalha) {
  let descargaAnterior = Promise.resolve();
  const filasAguardando = new Set();

  return function agendarDescarga(fila) {
    // Uma fila já na espera não entra de novo: sem isso, um envio lento faria
    // os timers empilharem descargas sem limite.
    if (filasAguardando.has(fila)) return descargaAnterior;
    filasAguardando.add(fila);
    descargaAnterior = descargaAnterior
      .then(() => { filasAguardando.delete(fila); return fila.descarregar(); })
      .catch((erro) => avisarFalha(`[alertas] descarga falhou: ${erro.message}`));
    return descargaAnterior;
  };
}
