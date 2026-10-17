ALTER TYPE "AuthEventType" ADD VALUE 'KNOWLEDGE_ARTICLE_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'KNOWLEDGE_ARTICLE_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'KNOWLEDGE_ARTICLE_PUBLISHED';
ALTER TYPE "AuthEventType" ADD VALUE 'KNOWLEDGE_ARTICLE_INACTIVATED';

CREATE TYPE "KnowledgeArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'INACTIVE');
CREATE TYPE "KnowledgeCategory" AS ENUM ('GENERAL','LOCATION','HOURS','SERVICES','SPECIALTIES','PAYMENT','INSURANCE','CANCELLATION_POLICY','APPOINTMENT_PREPARATION','DOCUMENTS','ACCESSIBILITY','CLINICAL_APPROVED','FAQ','OTHER');
CREATE TYPE "KnowledgeSourceType" AS ENUM ('MANUAL','POLICY','WEBSITE','OTHER');

CREATE TABLE "knowledge_articles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL,
  "unit_id" UUID, "slug" VARCHAR(160), "status" "KnowledgeArticleStatus" NOT NULL DEFAULT 'DRAFT',
  "created_by_user_id" UUID NOT NULL, "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_articles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_articles_slug_check" CHECK ("slug" IS NULL OR "slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
CREATE TABLE "knowledge_article_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "article_id" UUID NOT NULL,
  "version" INTEGER NOT NULL, "title" VARCHAR(200) NOT NULL, "category" "KnowledgeCategory" NOT NULL,
  "content" TEXT NOT NULL, "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source_type" "KnowledgeSourceType" NOT NULL DEFAULT 'MANUAL',
  "valid_from" TIMESTAMPTZ(3), "valid_until" TIMESTAMPTZ(3),
  "status" "KnowledgeArticleStatus" NOT NULL DEFAULT 'DRAFT',
  "created_by_user_id" UUID NOT NULL, "updated_by_user_id" UUID NOT NULL,
  "published_by_user_id" UUID, "published_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "search_vector" TSVECTOR GENERATED ALWAYS AS
    (setweight(to_tsvector('portuguese', coalesce("title", '')), 'A') ||
     setweight(to_tsvector('portuguese', coalesce("content", '')), 'B')) STORED,
  CONSTRAINT "knowledge_article_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_version_number_check" CHECK ("version" > 0),
  CONSTRAINT "knowledge_version_title_check" CHECK (char_length(btrim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "knowledge_version_content_check" CHECK (char_length(btrim("content")) BETWEEN 1 AND 8000),
  CONSTRAINT "knowledge_version_validity_check" CHECK ("valid_until" IS NULL OR "valid_from" IS NULL OR "valid_until" >= "valid_from"),
  CONSTRAINT "knowledge_version_publication_check" CHECK (("status" = 'PUBLISHED' AND "published_by_user_id" IS NOT NULL AND "published_at" IS NOT NULL) OR "status" <> 'PUBLISHED')
);
CREATE UNIQUE INDEX "knowledge_articles_tenant_id_id_key" ON "knowledge_articles"("tenant_id","id");
CREATE UNIQUE INDEX "knowledge_articles_tenant_id_slug_key" ON "knowledge_articles"("tenant_id","slug");
CREATE INDEX "knowledge_articles_tenant_id_status_idx" ON "knowledge_articles"("tenant_id","status");
CREATE INDEX "knowledge_articles_tenant_id_unit_id_status_idx" ON "knowledge_articles"("tenant_id","unit_id","status");
CREATE UNIQUE INDEX "knowledge_article_versions_tenant_id_id_key" ON "knowledge_article_versions"("tenant_id","id");
CREATE UNIQUE INDEX "knowledge_article_versions_tenant_id_article_id_version_key" ON "knowledge_article_versions"("tenant_id","article_id","version");
CREATE UNIQUE INDEX "knowledge_one_draft_per_article" ON "knowledge_article_versions"("tenant_id","article_id") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "knowledge_one_published_per_article" ON "knowledge_article_versions"("tenant_id","article_id") WHERE "status" = 'PUBLISHED';
CREATE INDEX "knowledge_article_versions_tenant_id_article_id_status_idx" ON "knowledge_article_versions"("tenant_id","article_id","status");
CREATE INDEX "knowledge_article_versions_tenant_status_category_published_idx" ON "knowledge_article_versions"("tenant_id","status","category","published_at");
CREATE INDEX "knowledge_article_versions_tenant_validity_idx" ON "knowledge_article_versions"("tenant_id","valid_from","valid_until");
CREATE INDEX "knowledge_article_versions_search_vector_idx" ON "knowledge_article_versions" USING GIN ("search_vector");
CREATE INDEX "knowledge_article_versions_tags_idx" ON "knowledge_article_versions" USING GIN ("tags");

ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "units"("tenant_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_updated_by_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "knowledge_article_versions" ADD CONSTRAINT "knowledge_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "knowledge_article_versions" ADD CONSTRAINT "knowledge_versions_article_fkey" FOREIGN KEY ("tenant_id","article_id") REFERENCES "knowledge_articles"("tenant_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "knowledge_article_versions" ADD CONSTRAINT "knowledge_versions_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "knowledge_article_versions" ADD CONSTRAINT "knowledge_versions_updated_by_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "knowledge_article_versions" ADD CONSTRAINT "knowledge_versions_published_by_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

INSERT INTO "permissions" ("name") VALUES ('knowledge.view'),('knowledge.manage'),('knowledge.publish') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("role_name","permission_name")
SELECT role_name, permission_name FROM (VALUES
 ('CLINIC_ADMIN','knowledge.view'),('CLINIC_ADMIN','knowledge.manage'),('CLINIC_ADMIN','knowledge.publish'),
 ('AGENT','knowledge.view'),('DOCTOR','knowledge.view')
) AS grants(role_name,permission_name)
WHERE EXISTS (SELECT 1 FROM "roles" r WHERE r."name"=role_name)
ON CONFLICT DO NOTHING;
