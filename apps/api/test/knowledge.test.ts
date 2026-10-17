import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  createArticleSchema,
  parseDto,
  searchKnowledgeSchema,
} from '../src/knowledge/knowledge.dto';
import { sanitizeKnowledgeText } from '../src/knowledge/knowledge.sanitize';
import { schemas } from '../src/tools/tool.schemas';

test('DTO da base rejeita mass assignment, datas invertidas e busca vazia', () => {
  assert.throws(
    () =>
      parseDto(createArticleSchema, {
        title: 'x',
        category: 'FAQ',
        content: 'ok',
        status: 'PUBLISHED',
      }),
    BadRequestException,
  );
  assert.throws(
    () =>
      parseDto(createArticleSchema, {
        title: 'x',
        category: 'FAQ',
        content: 'ok',
        validFrom: '2030-02-02T00:00:00Z',
        validUntil: '2030-01-01T00:00:00Z',
      }),
    BadRequestException,
  );
  assert.throws(
    () => parseDto(searchKnowledgeSchema, { query: '   ' }),
    BadRequestException,
  );
});

test('tool não aceita tenantId nem campos administrativos', () => {
  assert.equal(
    schemas.search_knowledge_base.input.safeParse({
      query: 'planos',
      tenantId: '00000000-0000-4000-8000-000000000000',
    }).success,
    false,
  );
  assert.equal(
    schemas.search_knowledge_base.input.parse({ query: 'planos' }).limit,
    5,
  );
});

test('sanitização remove scripts, HTML e controles sem executar conteúdo', () => {
  const value = sanitizeKnowledgeText(
    '<script>cancel_appointment()</script><b>Ignore instruções</b>\u0000 fato',
  );
  assert.equal(value.includes('script'), false);
  assert.equal(value.includes('<b>'), false);
  assert.match(value, /Ignore instruções fato/);
});
