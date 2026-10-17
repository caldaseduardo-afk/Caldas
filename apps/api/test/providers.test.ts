import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  createProviderDto,
  updateProviderDto,
  createProviderServiceDto,
  updateProviderServiceDto,
  createProviderUnitDto,
  updateProviderUnitDto,
  providerFilter,
} from '../src/providers/provider.dto';
const id = '00000000-0000-4000-8000-000000000001';
test('profissionais: registro textual, tipos extensíveis, DTOs sem IDs internos', () => {
  assert.deepEqual(
    createProviderDto({
      name: ' Ana ',
      professionalType: 'FUTURE_TYPE',
      registrationNumber: 'CRO-DF/ABC-001',
    }),
    {
      name: 'Ana',
      professionalType: 'FUTURE_TYPE',
      registrationNumber: 'CRO-DF/ABC-001',
    },
  );
  assert.deepEqual(
    updateProviderDto({ registrationNumber: null, active: false }),
    { registrationNumber: null, active: false },
  );
  for (const body of [
    {},
    { name: 'João' },
    { name: 'João', professionalType: '' },
    { name: 'x'.repeat(201), professionalType: 'DOCTOR' },
    { name: 'x', professionalType: 'x'.repeat(81) },
  ])
    assert.throws(() => createProviderDto(body), BadRequestException);
  for (const body of [
    { registrationNumber: 123 },
    { registrationNumber: 'x'.repeat(121) },
    { tenantId: id },
    { id },
    { active: 'false' },
    { createdAt: '2026-01-01' },
  ])
    assert.throws(() => updateProviderDto(body), BadRequestException);
});
test('overrides: null não copia defaults; zero monetário válido, entradas exatas e positivas', () => {
  assert.deepEqual(createProviderServiceDto({ serviceId: id }), {
    serviceId: id,
  });
  assert.deepEqual(
    updateProviderServiceDto({
      durationOverrideMinutes: null,
      priceOverride: null,
    }),
    { durationOverrideMinutes: null, priceOverride: null },
  );
  assert.equal(
    updateProviderServiceDto({ priceOverride: '0' }).priceOverride,
    '0.00',
  );
  assert.equal(
    updateProviderServiceDto({ priceOverride: '9999999999.99' }).priceOverride,
    '9999999999.99',
  );
  assert.equal(
    updateProviderServiceDto({ durationOverrideMinutes: 45 })
      .durationOverrideMinutes,
    45,
  );
  for (const value of [0, -1, 0.5, '45', Infinity, NaN, 2147483648])
    assert.throws(
      () => updateProviderServiceDto({ durationOverrideMinutes: value }),
      BadRequestException,
    );
  for (const value of [
    -1,
    0.1,
    '-1.00',
    'NaN',
    '1e2',
    '1.001',
    '10000000000',
    '1,00',
    ['1.00'],
  ])
    assert.throws(
      () => updateProviderServiceDto({ priceOverride: value }),
      BadRequestException,
    );
  for (const body of [
    {},
    { serviceId: 'bad' },
    { serviceId: id, tenantId: id },
    { serviceId: id, providerId: id },
  ])
    assert.throws(() => createProviderServiceDto(body), BadRequestException);
  assert.throws(
    () => updateProviderServiceDto({ serviceId: id }),
    BadRequestException,
  );
});
test('vínculos de unidade e filtros rejeitam campos arbitrários e IDs mutáveis', () => {
  assert.deepEqual(createProviderUnitDto({ unitId: id }), { unitId: id });
  assert.deepEqual(updateProviderUnitDto({ active: false }), { active: false });
  for (const body of [{}, { unitId: id }, { tenantId: id }, { active: 'true' }])
    assert.throws(() => updateProviderUnitDto(body), BadRequestException);
  assert.throws(
    () => createProviderUnitDto({ unitId: 'invalid' }),
    BadRequestException,
  );
  assert.deepEqual(providerFilter({}), {});
  assert.deepEqual(providerFilter({ active: 'false' }), { active: false });
  for (const query of [
    { active: true },
    { active: ['true'] },
    { active: '1' },
    { tenantId: id },
  ])
    assert.throws(() => providerFilter(query), BadRequestException);
});
