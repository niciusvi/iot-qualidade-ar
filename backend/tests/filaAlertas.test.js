/**
 * Testes da fila de avisos (backend/src/filaAlertas.js).
 * Rodar: `npm test` dentro de backend/ (usa o node:test, sem dependência extra).
 *
 * Os "Fake..." abaixo fingem ser o WhatsApp e o banco: assim o teste roda em
 * milissegundos, sem rede, e sempre dá o mesmo resultado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FilaDeEventosDeAlerta, criarAgendadorDeDescargas } from '../src/filaAlertas.js';

/** Finge o envio de WhatsApp; o teste decide QUANDO o envio termina. */
class FakeEnvioWhatsApp {
  constructor() {
    this.textosEnviados = [];
    this.liberacoesPendentes = [];
    this.resultado = { enviados: ['5511999999999'], erros: [] };
  }

  /** Assinatura igual à de enviarWhatsApp(texto). Fica "enviando" até liberar(). */
  enviar = (texto) => {
    this.textosEnviados.push(texto);
    return new Promise((resolver) => this.liberacoesPendentes.push(() => resolver(this.resultado)));
  };

  /** Conclui o envio mais antigo que ainda está em andamento. */
  liberar() {
    this.liberacoesPendentes.shift()();
  }

  falharTodosOsEnvios() {
    this.resultado = { enviados: [], erros: ['5511999999999: HTTP 500 Connection Closed'] };
  }
}

/** Finge o UPDATE na tabela alertas, guardando o que seria gravado. */
class FakeRegistroDeResultado {
  constructor() {
    this.gravacoes = [];
  }

  registrar = async (idsDosAlertas, envio) => {
    this.gravacoes.push({ idsDosAlertas, envio });
  };
}

/** Texto simples com as salas, para o teste enxergar o que foi na mensagem. */
function montarTextoDeTeste(eventos, ehCritica) {
  return `${ehCritica ? 'CRITICA' : 'DIGEST'}:${eventos.map((e) => `sala${e.sala}`).join(',')}`;
}

function criarFilaDeTeste(envioFake, registroFake, ehCritica = false) {
  return new FilaDeEventosDeAlerta({
    ehCritica,
    montarTextoDaMensagem: montarTextoDeTeste,
    enviarParaDestinatarios: envioFake.enviar,
    registrarResultadoDoEnvio: registroFake.registrar,
  });
}

function eventoDeAlerta(sala, alertaId) {
  return { tipo: 'alerta', sala, parametro: 'co2', nivel: 'alto', alertaId };
}

/** Deixa as promises pendentes andarem (o envio fake só resolve no liberar()). */
function esperarMicrotarefas() {
  return new Promise((resolver) => setImmediate(resolver));
}

test('fila vazia não envia nada', async () => {
  const envioFake = new FakeEnvioWhatsApp();
  const fila = criarFilaDeTeste(envioFake, new FakeRegistroDeResultado());

  const resultado = await fila.descarregar();

  assert.equal(resultado, null);
  assert.deepEqual(envioFake.textosEnviados, []);
});

test('vários eventos saem em UMA mensagem e a fila esvazia', async () => {
  const envioFake = new FakeEnvioWhatsApp();
  const registroFake = new FakeRegistroDeResultado();
  const fila = criarFilaDeTeste(envioFake, registroFake);
  fila.enfileirar(eventoDeAlerta(1, 10));
  fila.enfileirar(eventoDeAlerta(2, 11));

  const descarga = fila.descarregar();
  envioFake.liberar();
  await descarga;

  assert.deepEqual(envioFake.textosEnviados, ['DIGEST:sala1,sala2']);
  assert.deepEqual(registroFake.gravacoes[0].idsDosAlertas, [10, 11]);
  assert.equal(fila.tamanho, 0);
});

test('REGRESSÃO 12/11/2026: evento que chega DURANTE o envio não é apagado', async () => {
  const envioFake = new FakeEnvioWhatsApp();
  const fila = criarFilaDeTeste(envioFake, new FakeRegistroDeResultado());
  fila.enfileirar(eventoDeAlerta(1, 10));

  const descarga = fila.descarregar();
  fila.enfileirar(eventoDeAlerta(7, 20));   // chega enquanto a sala 1 está "enviando"
  envioFake.liberar();
  await descarga;

  assert.equal(fila.tamanho, 1, 'a sala 7 precisa continuar na fila');
  const segundaDescarga = fila.descarregar();
  envioFake.liberar();
  await segundaDescarga;
  assert.deepEqual(envioFake.textosEnviados, ['DIGEST:sala1', 'DIGEST:sala7']);
});

test('evento mais novo da MESMA chave durante o envio fica para a próxima', async () => {
  const envioFake = new FakeEnvioWhatsApp();
  const fila = criarFilaDeTeste(envioFake, new FakeRegistroDeResultado());
  fila.enfileirar(eventoDeAlerta(1, 10));

  const descarga = fila.descarregar();
  fila.enfileirar(eventoDeAlerta(1, 99));   // mesma sala/parâmetro/nível, alerta novo
  envioFake.liberar();
  await descarga;

  assert.equal(fila.tamanho, 1);
});

test('se TODOS os envios falham, a fila é mantida e o erro é registrado', async () => {
  const envioFake = new FakeEnvioWhatsApp();
  envioFake.falharTodosOsEnvios();
  const registroFake = new FakeRegistroDeResultado();
  const fila = criarFilaDeTeste(envioFake, registroFake);
  fila.enfileirar(eventoDeAlerta(3, 30));

  const descarga = fila.descarregar();
  envioFake.liberar();
  await descarga;

  assert.equal(fila.tamanho, 1, 'precisa tentar de novo na próxima rodada');
  assert.match(registroFake.gravacoes[0].envio.erros[0], /Connection Closed/);
});

test('normalização (sem alertaId) é enviada sem gravar nada no banco', async () => {
  const envioFake = new FakeEnvioWhatsApp();
  const registroFake = new FakeRegistroDeResultado();
  const fila = criarFilaDeTeste(envioFake, registroFake);
  fila.enfileirar({ tipo: 'normalizado', sala: 4, parametro: 'co2', nivel: 'alto' });

  const descarga = fila.descarregar();
  envioFake.liberar();
  await descarga;

  assert.deepEqual(registroFake.gravacoes, []);
  assert.equal(fila.tamanho, 0);
});

test('agendador: a segunda fila ESPERA a primeira e sai em seguida (não é pulada)', async () => {
  const envioFake = new FakeEnvioWhatsApp();
  const registroFake = new FakeRegistroDeResultado();
  const filaCritica = criarFilaDeTeste(envioFake, registroFake, true);
  const filaDigest = criarFilaDeTeste(envioFake, registroFake, false);
  filaCritica.enfileirar(eventoDeAlerta(1, 10));
  filaDigest.enfileirar(eventoDeAlerta(2, 11));
  const agendarDescarga = criarAgendadorDeDescargas(assert.fail);

  agendarDescarga(filaCritica);
  const fimDeTudo = agendarDescarga(filaDigest);
  await esperarMicrotarefas();
  assert.deepEqual(envioFake.textosEnviados, ['CRITICA:sala1'], 'uma mensagem por vez');
  envioFake.liberar();
  await esperarMicrotarefas();
  envioFake.liberar();
  await fimDeTudo;

  assert.deepEqual(envioFake.textosEnviados, ['CRITICA:sala1', 'DIGEST:sala2']);
});

test('agendador: a mesma fila não empilha descargas enquanto aguarda a vez', async () => {
  const envioFake = new FakeEnvioWhatsApp();
  const fila = criarFilaDeTeste(envioFake, new FakeRegistroDeResultado());
  fila.enfileirar(eventoDeAlerta(1, 10));
  const agendarDescarga = criarAgendadorDeDescargas(assert.fail);

  agendarDescarga(fila);
  agendarDescarga(fila);
  const fimDeTudo = agendarDescarga(fila);
  await esperarMicrotarefas();
  envioFake.liberar();
  await fimDeTudo;

  assert.equal(envioFake.textosEnviados.length, 1);
});

test('agendador: erro numa descarga é avisado e não trava as próximas', async () => {
  const avisos = [];
  const filaQuebrada = { descarregar: async () => { throw new Error('banco fora do ar'); } };
  const envioFake = new FakeEnvioWhatsApp();
  const filaBoa = criarFilaDeTeste(envioFake, new FakeRegistroDeResultado());
  filaBoa.enfileirar(eventoDeAlerta(5, 50));
  const agendarDescarga = criarAgendadorDeDescargas((mensagem) => avisos.push(mensagem));

  agendarDescarga(filaQuebrada);
  const fimDeTudo = agendarDescarga(filaBoa);
  await esperarMicrotarefas();
  envioFake.liberar();
  await fimDeTudo;

  assert.match(avisos[0], /banco fora do ar/);
  assert.deepEqual(envioFake.textosEnviados, ['DIGEST:sala5']);
});
