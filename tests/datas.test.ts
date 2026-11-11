import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: módulo JavaScript da tela, sem tipos.
import { dataValida as dataValidaNaTela, formatarDia, hoje, inicioDoMes, periodoDoEndereco, somarDias } from '../public/datas.js';
import { dataValida as dataValidaNoServidor } from '../src/relatorio.ts';

test('o dia de hoje segue o horário de Brasília', () => {
  // 11/11/2026 01:30 em UTC ainda é 10/11/2026 em Brasília.
  assert.equal(hoje(new Date('2026-11-11T01:30:00Z')), '2026-11-10');
});

test('soma dias atravessando o mês e acha o início do mês', () => {
  assert.equal(somarDias('2026-11-01', -1), '2026-10-31');
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(inicioDoMes('2026-11-10'), '2026-11-01');
  assert.equal(formatarDia('2026-11-10'), '10/11/2026');
});

test('a tela e o servidor validam datas com a mesma regra', () => {
  for (const data of ['2026-11-10', '2024-02-29', '2026-02-29', '2026-02-30', '10/11/2026', '2026-1-1', '', 'abc']) {
    assert.equal(dataValidaNaTela(data), dataValidaNoServidor(data), data);
  }
  assert.equal(dataValidaNaTela(null), false);
});

test('lê o período do endereço e recusa período inválido', () => {
  assert.deepEqual(periodoDoEndereco('?inicio=2026-11-01&fim=2026-11-10'), { inicio: '2026-11-01', fim: '2026-11-10' });
  assert.equal(periodoDoEndereco('?inicio=2026-11-10&fim=2026-11-01'), null);
  assert.equal(periodoDoEndereco('?inicio=2026-02-30&fim=2026-03-01'), null);
  assert.equal(periodoDoEndereco('?inicio=<script>&fim=2026-11-10'), null);
  assert.equal(periodoDoEndereco(''), null);
});
