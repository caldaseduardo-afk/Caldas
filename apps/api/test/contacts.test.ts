import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { normalizePhone } from '../src/contacts/phone';
import {
  createContactDto,
  createChannelDto,
  updateContactDto,
  updateChannelDto,
  contactQuery,
} from '../src/contacts/contact.dto';

test('normalização BR consistente e idempotente; internacionais explícitos', () => {
  for (const value of [
    '(61) 99999-9999',
    '61 99999-9999',
    '+55 61 99999-9999',
    '5561999999999',
    '+5561999999999',
  ]) {
    assert.equal(normalizePhone(value), '+5561999999999');
    assert.equal(normalizePhone(normalizePhone(value)), '+5561999999999');
  }
  assert.equal(normalizePhone('(61) 3333-4444'), '+556133334444');
  assert.equal(normalizePhone('+1 (202) 555-0123'), '+12025550123');
  for (const value of [
    null,
    61999999999,
    '',
    '99999-9999',
    '00 55 61 99999-9999',
    '061999999999',
    '61 99999-9999 ramal 2',
    '+55 61 89999-9999',
    '+0123456789',
    '+551234',
    '+1234567890123456',
    'abc61999999999',
    '+55+61999999999',
  ])
    assert.throws(() => normalizePhone(value), BadRequestException);
});

test('DTOs não permitem tenant, verificação, tipos/estados inválidos ou múltiplos principais', () => {
  const channel = { type: 'PHONE', address: '(61) 99999-9999' };
  assert.equal(createChannelDto(channel).address, '+5561999999999');
  assert.deepEqual(createContactDto({ displayName: ' Ana ' }), {
    displayName: 'Ana',
    channels: [],
  });
  for (const value of [
    {},
    { displayName: '' },
    { displayName: 'Ana', tenantId: 'externo' },
    { displayName: 'Ana', channels: null },
    {
      displayName: 'Ana',
      channels: [
        { ...channel, primary: true },
        { ...channel, primary: true },
      ],
    },
  ])
    assert.throws(() => createContactDto(value), BadRequestException);
  for (const value of [
    { ...channel, type: 'EMAIL' },
    { ...channel, verifiedAt: '2026-01-01' },
    { ...channel, contactId: 'externo' },
    { ...channel, primary: 'true' },
    { ...channel, providerExternalId: '' },
  ])
    assert.throws(() => createChannelDto(value), BadRequestException);
  for (const value of [
    {},
    { type: 'WHATSAPP' },
    { tenantId: 'externo' },
    { address: null },
    { primary: null },
  ])
    assert.throws(() => updateChannelDto(value), BadRequestException);
  assert.throws(
    () => updateContactDto({ status: 'VERIFIED' }),
    BadRequestException,
  );
  assert.throws(
    () => contactQuery({ phone: ['61999999999'] }),
    BadRequestException,
  );
  assert.throws(
    () => contactQuery({ tenantId: 'externo' }),
    BadRequestException,
  );
});
