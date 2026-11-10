import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: módulo JavaScript da tela, sem tipos.
import { mascararValor } from '../public/valor.js';
import { lerValorEmCentavos } from '../src/gastos.ts';

test('a máscara põe a vírgula sozinha, tratando os dois últimos dígitos como centavos', () => {
  assert.equal(mascararValor('1330'), '13,30');
  assert.equal(mascararValor('2550'), '25,50');
  assert.equal(mascararValor('5'), '0,05');
  assert.equal(mascararValor('50'), '0,50');
  assert.equal(mascararValor('100'), '1,00');
  assert.equal(mascararValor('123456'), '1.234,56');
  assert.equal(mascararValor(''), '');
  assert.equal(mascararValor('0'), '');
});

test('a máscara ignora letras e reaproveita o que já estava formatado', () => {
  assert.equal(mascararValor('13,30'), '13,30');
  assert.equal(mascararValor('13,305'), '133,05');
  assert.equal(mascararValor('R$ 2a5b50'), '25,50');
  assert.equal(mascararValor('9999999999999'), '9.999.999,99');
});

test('o valor mascarado é aceito pelo servidor com o mesmo número de centavos', () => {
  for (const digitado of ['1330', '5', '123456', '2550']) {
    assert.equal(lerValorEmCentavos(mascararValor(digitado)), Number(digitado));
  }
});
