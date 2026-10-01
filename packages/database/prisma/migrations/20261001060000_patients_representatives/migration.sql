-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('SELF', 'MOTHER', 'FATHER', 'SON_DAUGHTER', 'SPOUSE', 'LEGAL_GUARDIAN', 'CAREGIVER', 'SECRETARY', 'OTHER');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('DECLARED', 'VERIFIED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PatientAuthorizationLevel" AS ENUM ('FULL', 'SCHEDULING_ONLY', 'NO_ACCESS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONTACT_PATIENT_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONTACT_PATIENT_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONTACT_PATIENT_REVOKED';

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "birth_date" DATE NOT NULL,
    "document" TEXT,
    "health_plan" TEXT,
    "payment_preference" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "relationship_type" "RelationshipType" NOT NULL,
    "relationship_status" "RelationshipStatus" NOT NULL DEFAULT 'DECLARED',
    "authorization_level" "PatientAuthorizationLevel" NOT NULL DEFAULT 'NO_ACCESS',
    "is_primary_contact" BOOLEAN NOT NULL DEFAULT false,
    "legal_representative" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "authorized_at" TIMESTAMPTZ(3),
    "authorized_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_patients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenant_id_id_key" ON "patients"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "contact_patients_tenant_id_patient_id_active_idx" ON "contact_patients"("tenant_id", "patient_id", "active");

-- CreateIndex
CREATE INDEX "contact_patients_tenant_id_contact_id_active_idx" ON "contact_patients"("tenant_id", "contact_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "contact_patients_tenant_id_contact_id_patient_id_key" ON "contact_patients"("tenant_id", "contact_id", "patient_id");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contact_patients" ADD CONSTRAINT "contact_patients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contact_patients" ADD CONSTRAINT "contact_patients_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contact_patients" ADD CONSTRAINT "contact_patients_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contact_patients" ADD CONSTRAINT "contact_patients_authorized_by_tenant_id_fkey" FOREIGN KEY ("authorized_by", "tenant_id") REFERENCES "user_tenants"("user_id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contact_patients" ADD CONSTRAINT "contact_patients_revoked_by_tenant_id_fkey" FOREIGN KEY ("revoked_by", "tenant_id") REFERENCES "user_tenants"("user_id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Principal é opcional, mas único entre os vínculos ativos do paciente.
CREATE UNIQUE INDEX "contact_patients_one_active_primary"
ON "contact_patients" ("tenant_id", "patient_id")
WHERE "active" AND "is_primary_contact";

-- Revogação preserva a linha e exige autoria; não pode manter acesso/principal.
ALTER TABLE "contact_patients" ADD CONSTRAINT "contact_patients_revocation_check" CHECK (
  ("relationship_status" = 'REVOKED' AND NOT "active" AND NOT "is_primary_contact"
    AND "authorization_level" = 'NO_ACCESS' AND "revoked_by" IS NOT NULL AND "revoked_at" IS NOT NULL)
  OR ("relationship_status" <> 'REVOKED' AND "active" AND "revoked_by" IS NULL AND "revoked_at" IS NULL)
);
ALTER TABLE "contact_patients" ADD CONSTRAINT "contact_patients_authorization_actor_check" CHECK (
  ("authorized_by" IS NULL AND "authorized_at" IS NULL)
  OR ("authorized_by" IS NOT NULL AND "authorized_at" IS NOT NULL)
);
ALTER TABLE "contact_patients" ADD CONSTRAINT "contact_patients_explicit_authorization_check" CHECK (
  ("authorization_level" = 'NO_ACCESS' AND "relationship_status" <> 'VERIFIED' AND NOT "legal_representative")
  OR "authorized_by" IS NOT NULL
);
