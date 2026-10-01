import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { createClinicDto, updateClinicDto } from '../src/clinics/clinic.dto';
import { createUnitDto, updateUnitDto } from '../src/units/unit.dto';
import { provisionDevelopmentClinic } from '../src/clinics/development-provisioning';
import type { createDatabaseClient } from '@atendente/database';

test('DTOs rejeitam mass assignment, tipos inválidos e timezones inexistentes', () => {
  for (const body of [
    undefined,
    null,
    [],
    {},
    { name: '' },
    { name: 'x', tenantId: 'externo' },
    { role: 'CLINIC_ADMIN' },
    { name: 4 },
    { timezone: 'Mars/Olympus' },
    { timezone: '+03:00' },
    { status: 'SUSPENDED' },
    { status: null },
  ])
    assert.throws(() => updateClinicDto(body), BadRequestException);
  for (const body of [
    undefined,
    null,
    [],
    {},
    { active: 'false' },
    { active: 0 },
    { tenantId: 'externo' },
    { address: '' },
    { name: 'x'.repeat(201) },
    { address: 'x'.repeat(2001) },
    { name: null },
    { timezoneOverride: 'inexistente' },
  ])
    assert.throws(() => updateUnitDto(body), BadRequestException);
  assert.throws(() => createUnitDto({ name: 'A' }), BadRequestException);
  assert.throws(
    () => createClinicDto({ name: 'A', timezone: 'UTC', status: 'ACTIVE' }),
    BadRequestException,
  );
  assert.deepEqual(
    createClinicDto({ name: ' Clínica ', timezone: 'America/Sao_Paulo' }),
    { name: 'Clínica', timezone: 'America/Sao_Paulo' },
  );
  assert.deepEqual(createUnitDto({ name: ' Unidade ', address: ' Rua ' }), {
    name: 'Unidade',
    address: 'Rua',
    active: true,
    timezoneOverride: null,
  });
  assert.deepEqual(updateUnitDto({ timezoneOverride: null, active: false }), {
    timezoneOverride: null,
    active: false,
  });
});

test('provisionamento não acessa banco fora de desenvolvimento', async () => {
  const client = {} as ReturnType<typeof createDatabaseClient>;
  for (const environment of ['production', 'test', undefined])
    await assert.rejects(
      provisionDevelopmentClinic(client, environment, 'owner@example.test', {
        name: 'Clínica',
        timezone: 'UTC',
      }),
    );
});
