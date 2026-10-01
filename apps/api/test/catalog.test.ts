import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  catalogFilter,
  createServiceDto,
  createSpecialtyDto,
  updateServiceDto,
  updateSpecialtyDto,
} from '../src/catalog/catalog.dto';
const specialtyId = '00000000-0000-4000-8000-000000000001';
test('catálogo: DTOs validam minutos, dinheiro decimal e campos permitidos', () => {
  assert.deepEqual(
    createSpecialtyDto({
      name: ' Cardiologia ',
      description: null,
      active: false,
    }),
    { name: 'Cardiologia', description: null, active: false },
  );
  assert.equal(
    createServiceDto({
      name: 'Consulta',
      specialtyId,
      durationMinutes: 30,
      price: '0.1',
    }).price,
    '0.10',
  );
  assert.equal(
    updateServiceDto({ price: '9999999999.99' }).price,
    '9999999999.99',
  );
  assert.equal(updateServiceDto({ price: '0' }).price, '0.00');
  assert.equal(updateServiceDto({ price: null }).price, null);
  for (const price of [
    -1,
    0.1,
    100,
    '-1.00',
    'NaN',
    'Infinity',
    '1e2',
    '1,20',
    '1.001',
    '10000000000.00',
    '01.00',
    ['1.00'],
    true,
    ' 1.00 ',
  ])
    assert.throws(() => updateServiceDto({ price }), BadRequestException);
  for (const key of [
    'durationMinutes',
    'bufferBeforeMinutes',
    'bufferAfterMinutes',
  ]) {
    for (const value of [-1, 0.5, '30', null, NaN, Infinity, 2147483648])
      assert.throws(
        () => updateServiceDto({ [key]: value }),
        BadRequestException,
      );
  }
  assert.throws(
    () => updateServiceDto({ durationMinutes: 0 }),
    BadRequestException,
  );
  assert.deepEqual(
    updateServiceDto({ bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }),
    { bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
  );
  for (const body of [
    {},
    { name: 'Consulta' },
    { name: 'Consulta', durationMinutes: 30 },
    { name: 'Consulta', specialtyId },
  ])
    assert.throws(() => createServiceDto(body), BadRequestException);
  for (const body of [
    { name: '' },
    { name: 'x'.repeat(201) },
    { description: 'x'.repeat(2001) },
    { tenantId: specialtyId },
    { id: specialtyId },
    { createdAt: '2026-01-01' },
    { active: 'false' },
    [],
  ]) {
    assert.throws(() => updateSpecialtyDto(body), BadRequestException);
    assert.throws(() => updateServiceDto(body), BadRequestException);
  }
  assert.throws(
    () => updateServiceDto({ specialtyId: 'invalid' }),
    BadRequestException,
  );
});
test('catálogo: filtros básicos estritos sem tenant fornecido pelo cliente', () => {
  assert.deepEqual(catalogFilter({}), {});
  assert.deepEqual(catalogFilter({ active: 'false', specialtyId }, true), {
    active: false,
    specialtyId,
  });
  assert.deepEqual(catalogFilter({ active: 'true' }), { active: true });
  for (const query of [
    { active: true },
    { active: '1' },
    { active: ['true'] },
    { tenantId: specialtyId },
    { specialtyId: 'invalid' },
    { name: 'Consulta' },
  ])
    assert.throws(() => catalogFilter(query, true), BadRequestException);
  assert.throws(() => catalogFilter({ specialtyId }), BadRequestException);
});
