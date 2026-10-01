import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { PermissionName, Prisma } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService, authorizedTenantFilter } from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';

export const patientWhere = (scope: TenantScope, permissions: PermissionName[]): Prisma.PatientWhereInput => ({ tenantId: scope.tenantId, tenant: authorizedTenantFilter(scope, permissions) });
export const linkWhere = (scope: TenantScope, permissions: PermissionName[]): Prisma.ContactPatientWhereInput => ({ tenantId: scope.tenantId, tenant: authorizedTenantFilter(scope, permissions) });
export const patientSummary = { id: true, name: true, birthDate: true } as const;
export const patientDetails = { ...patientSummary, document: true, healthPlan: true, paymentPreference: true, notes: true } as const;
export const relationshipFields = { id: true, contactId: true, patientId: true, relationshipType: true, relationshipStatus: true, authorizationLevel: true, active: true, isPrimaryContact: true, legalRepresentative: true, authorizedAt: true, revokedAt: true } as const;
export function presentPatient<T extends { birthDate: Date }>(patient: T) { return { ...patient, birthDate: patient.birthDate.toISOString().slice(0, 10) }; }

@Injectable()
export class PatientWrite {
  constructor(private readonly database: DatabaseService, private readonly authorization: AuthorizationService) {}
  async run<T>(permissions: PermissionName[], execute: (tx: Prisma.TransactionClient, scope: TenantScope) => Promise<T>): Promise<T> {
    const scope = await this.authorization.requirePermissions(...permissions);
    try {
      return await this.database.client.$transaction(async tx => {
        if (!await tx.tenant.findFirst({ where: authorizedTenantFilter(scope, permissions), select: { id: true } })) throw new ForbiddenException('Permissão insuficiente.');
        return execute(tx, scope);
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) throw new ConflictException('Vínculo existente ou alteração concorrente. Atualize e tente novamente.');
      throw error;
    }
  }
}
