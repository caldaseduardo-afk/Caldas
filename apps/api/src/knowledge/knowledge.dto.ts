import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const knowledgeCategories = [
  'GENERAL',
  'LOCATION',
  'HOURS',
  'SERVICES',
  'SPECIALTIES',
  'PAYMENT',
  'INSURANCE',
  'CANCELLATION_POLICY',
  'APPOINTMENT_PREPARATION',
  'DOCUMENTS',
  'ACCESSIBILITY',
  'CLINICAL_APPROVED',
  'FAQ',
  'OTHER',
] as const;
export const knowledgeStatuses = ['DRAFT', 'PUBLISHED', 'INACTIVE'] as const;
const instant = z.iso.datetime({ offset: true });
const slug = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const contentFields = {
  title: z.string().trim().min(1).max(200),
  category: z.enum(knowledgeCategories),
  content: z.string().trim().min(1).max(8000),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  sourceType: z
    .enum(['MANUAL', 'POLICY', 'WEBSITE', 'OTHER'])
    .default('MANUAL'),
  validFrom: instant.nullable().optional(),
  validUntil: instant.nullable().optional(),
};
const datesAreValid = (v: {
  validFrom?: string | null;
  validUntil?: string | null;
}) => !v.validFrom || !v.validUntil || v.validUntil >= v.validFrom;
export const createArticleSchema = z
  .strictObject({
    unitId: z.uuid().nullable().optional(),
    slug: slug.nullable().optional(),
    ...contentFields,
  })
  .refine(datesAreValid, {
    message: 'validUntil não pode ser anterior a validFrom.',
    path: ['validUntil'],
  });
export const updateDraftSchema = z
  .strictObject({
    expectedUpdatedAt: instant,
    unitId: z.uuid().nullable().optional(),
    slug: slug.nullable().optional(),
    title: contentFields.title.optional(),
    category: contentFields.category.optional(),
    content: contentFields.content.optional(),
    tags: contentFields.tags.optional(),
    sourceType: contentFields.sourceType.optional(),
    validFrom: instant.nullable().optional(),
    validUntil: instant.nullable().optional(),
  })
  .refine(datesAreValid, {
    message: 'validUntil não pode ser anterior a validFrom.',
    path: ['validUntil'],
  });
export const concurrencySchema = z.strictObject({ expectedUpdatedAt: instant });
export const listArticlesSchema = z.strictObject({
  status: z.enum(knowledgeStatuses).optional(),
  category: z.enum(knowledgeCategories).optional(),
  unitId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const searchKnowledgeSchema = z.strictObject({
  query: z.string().trim().min(1).max(500),
  categories: z.array(z.enum(knowledgeCategories)).max(5).optional(),
  unitId: z.uuid().optional(),
  limit: z.number().int().min(1).max(5).default(5),
});
export function parseDto<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('Dados inválidos.');
  return parsed.data;
}
export type CreateArticleDto = z.infer<typeof createArticleSchema>;
export type UpdateDraftDto = z.infer<typeof updateDraftSchema>;
export type SearchKnowledgeDto = z.infer<typeof searchKnowledgeSchema>;
