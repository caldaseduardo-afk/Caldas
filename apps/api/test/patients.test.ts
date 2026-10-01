import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  createPatientDto,
  updatePatientDto,
} from '../src/patients/patient.dto';
import {
  createRelationshipDto,
  updateRelationshipDto,
  relationshipTypes,
  needsAuthorization,
} from '../src/patients/relationship.dto';

const contactId = '00000000-0000-4000-8000-000000000001';
test('paciente: data civil, limites e whitelist impedem campos internos', () => {
  const dto = createPatientDto({
    name: ' Maria ',
    birthDate: '2000-02-29',
    notes: 'Linha 1\nLinha 2',
  });
  assert.equal(dto.name, 'Maria');
  assert.equal(dto.birthDate.toISOString(), '2000-02-29T00:00:00.000Z');
  assert.deepEqual(updatePatientDto({ document: null, notes: null }), {
    document: null,
    notes: null,
  });
  for (const birthDate of [
    '2023-02-29',
    '2000-02-30',
    '9999-01-01',
    '0000-01-01',
    '2000-13-01',
    '01/01/2000',
    '2000-01-01T00:00:00Z',
    null,
    1,
  ])
    assert.throws(
      () => createPatientDto({ name: 'Maria', birthDate }),
      BadRequestException,
    );
  for (const body of [
    {},
    { name: 'Maria' },
    { name: '', birthDate: '2000-01-01' },
    { name: 'Maria', birthDate: '2000-01-01', tenantId: contactId },
    { notes: '\u0000' },
    { notes: 'x'.repeat(4001) },
  ])
    assert.throws(() => createPatientDto(body), BadRequestException);
  for (const body of [
    {},
    { id: contactId },
    { createdAt: '2000-01-01' },
    { name: null },
    { document: 'x'.repeat(81) },
  ])
    assert.throws(() => updatePatientDto(body), BadRequestException);
});
test('vínculos: nove tipos; declaração e autorização independentes; sem coerção nem autoria externa', () => {
  for (const relationshipType of relationshipTypes) {
    const dto = createRelationshipDto({ contactId, relationshipType });
    assert.equal(dto.relationshipStatus, undefined);
    assert.equal(dto.authorizationLevel, undefined);
    assert.equal(needsAuthorization(dto), false);
  }
  assert.deepEqual(
    updateRelationshipDto({
      relationshipStatus: 'DECLARED',
      authorizationLevel: 'SCHEDULING_ONLY',
    }),
    { relationshipStatus: 'DECLARED', authorizationLevel: 'SCHEDULING_ONLY' },
  );
  for (const dto of [
    { authorizationLevel: 'FULL' },
    { authorizationLevel: 'SCHEDULING_ONLY' },
    { relationshipStatus: 'VERIFIED' },
    { legalRepresentative: true },
  ] as const)
    assert.equal(needsAuthorization(dto), true);
  for (const body of [
    {},
    { relationshipStatus: 'REVOKED' },
    { authorizationLevel: ['FULL'] },
    { authorizationLevel: null },
    { relationshipType: 'INVALID' },
    { isPrimaryContact: 'true' },
    { active: false },
    { authorizedBy: contactId },
    { authorizedAt: '2000-01-01' },
    { revokedBy: contactId },
    { revokedAt: '2000-01-01' },
    { tenantId: contactId },
  ])
    assert.throws(() => updateRelationshipDto(body), BadRequestException);
  assert.throws(
    () =>
      createRelationshipDto({ contactId: 'invalid', relationshipType: 'SELF' }),
    BadRequestException,
  );
});
