import { recordAudit } from '@atendente/database';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PermissionName, Prisma } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
import {
  PatientWrite,
  patientWhere,
  linkWhere,
  relationshipFields,
} from './patient-access';
import {
  needsAuthorization,
  hasPolicyDecision,
  type RelationshipDto,
} from './relationship.dto';

export function relationshipPermissions(
  dto: Partial<RelationshipDto> = {},
): PermissionName[] {
  return [
    'patient.edit',
    'contact.view',
    ...(needsAuthorization(dto) ? ['patient.authorize' as const] : []),
  ];
}
async function lockPatient(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
  patientId: string,
  permissions: PermissionName[],
) {
  const [patient] = await tx.patient.updateManyAndReturn({
    where: { id: patientId, ...patientWhere(scope, permissions) },
    data: { updatedAt: new Date() },
    select: { id: true },
  });
  if (!patient) throw new NotFoundException('Recurso não encontrado.');
}
function policy(row: {
  relationshipType: string;
  relationshipStatus: string;
  authorizationLevel: string;
  active: boolean;
  isPrimaryContact: boolean;
  legalRepresentative: boolean;
}) {
  return {
    relationshipType: row.relationshipType,
    relationshipStatus: row.relationshipStatus,
    authorizationLevel: row.authorizationLevel,
    active: row.active,
    isPrimaryContact: row.isPrimaryContact,
    legalRepresentative: row.legalRepresentative,
  };
}

@Injectable()
export class RelationshipRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly write: PatientWrite,
  ) {}
  async listByPatient(patientId: string) {
    const permissions: PermissionName[] = ['patient.view', 'contact.view'];
    const scope = await this.authorization.requirePermissions(...permissions);
    const patient = await this.database.client.patient.findFirst({
      where: { id: patientId, ...patientWhere(scope, permissions) },
      select: {
        contacts: {
          where: linkWhere(scope, permissions),
          select: relationshipFields,
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!patient) throw new NotFoundException('Recurso não encontrado.');
    return patient.contacts;
  }
  async listByContact(contactId: string) {
    const permissions: PermissionName[] = ['patient.view', 'contact.view'];
    const scope = await this.authorization.requirePermissions(...permissions);
    const contact = await this.database.client.contact.findFirst({
      where: {
        id: contactId,
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, permissions),
      },
      select: {
        patientLinks: {
          where: linkWhere(scope, permissions),
          select: relationshipFields,
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!contact) throw new NotFoundException('Recurso não encontrado.');
    return contact.patientLinks;
  }
  create(patientId: string, dto: RelationshipDto & { contactId: string }) {
    const permissions = relationshipPermissions(dto);
    return this.write.run(permissions, async (tx, scope) => {
      await lockPatient(tx, scope, patientId, permissions);
      if (
        !(await tx.contact.findFirst({
          where: {
            id: dto.contactId,
            tenantId: scope.tenantId,
            status: 'ACTIVE',
            tenant: authorizedTenantFilter(scope, permissions),
          },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Recurso não encontrado.');
      if (dto.isPrimaryContact)
        await tx.contactPatient.updateMany({
          where: {
            patientId,
            active: true,
            isPrimaryContact: true,
            ...linkWhere(scope, permissions),
          },
          data: { isPrimaryContact: false },
        });
      const decision = hasPolicyDecision(dto);
      const link = await tx.contactPatient.create({
        data: {
          tenantId: scope.tenantId,
          patientId,
          contactId: dto.contactId,
          relationshipType: dto.relationshipType,
          relationshipStatus: dto.relationshipStatus ?? 'DECLARED',
          authorizationLevel: dto.authorizationLevel ?? 'NO_ACCESS',
          isPrimaryContact: dto.isPrimaryContact ?? false,
          legalRepresentative: dto.legalRepresentative ?? false,
          authorizedBy: decision ? scope.userId : null,
          authorizedAt: decision ? new Date() : null,
        },
        select: relationshipFields,
      });
      await recordAudit(tx, {
        data: {
          type: 'CONTACT_PATIENT_CREATED',
          userId: scope.userId,
          tenantId: scope.tenantId,
          resourceId: link.id,
          changes: { patientId, contactId: dto.contactId, after: policy(link) },
        },
      });
      return link;
    });
  }
  update(patientId: string, id: string, dto: Partial<RelationshipDto>) {
    const permissions = relationshipPermissions(dto);
    return this.write.run(permissions, async (tx, scope) => {
      await lockPatient(tx, scope, patientId, permissions);
      const where = { id, patientId, ...linkWhere(scope, permissions) };
      const before = await tx.contactPatient.findFirst({ where });
      if (!before) throw new NotFoundException('Recurso não encontrado.');
      if (!before.active || before.relationshipStatus === 'REVOKED')
        throw new ConflictException('Vínculo revogado não pode ser alterado.');
      if (
        !(await tx.contact.findFirst({
          where: {
            id: before.contactId,
            tenantId: scope.tenantId,
            status: 'ACTIVE',
            tenant: authorizedTenantFilter(scope, permissions),
          },
          select: { id: true },
        }))
      )
        throw new ConflictException(
          'Contato indisponível para alteração do vínculo.',
        );
      const typeChanged =
        dto.relationshipType !== undefined &&
        dto.relationshipType !== before.relationshipType;
      if (dto.isPrimaryContact)
        await tx.contactPatient.updateMany({
          where: {
            patientId,
            active: true,
            isPrimaryContact: true,
            NOT: { id },
            ...linkWhere(scope, permissions),
          },
          data: { isPrimaryContact: false },
        });
      const decision = hasPolicyDecision(dto) || typeChanged;
      const [link] = await tx.contactPatient.updateManyAndReturn({
        where,
        data: {
          relationshipType: dto.relationshipType,
          relationshipStatus:
            dto.relationshipStatus ?? (typeChanged ? 'DECLARED' : undefined),
          authorizationLevel:
            dto.authorizationLevel ?? (typeChanged ? 'NO_ACCESS' : undefined),
          legalRepresentative:
            dto.legalRepresentative ?? (typeChanged ? false : undefined),
          isPrimaryContact: dto.isPrimaryContact,
          authorizedBy: decision ? scope.userId : undefined,
          authorizedAt: decision ? new Date() : undefined,
        },
        select: relationshipFields,
      });
      if (!link) throw new NotFoundException('Recurso não encontrado.');
      await recordAudit(tx, {
        data: {
          type: 'CONTACT_PATIENT_UPDATED',
          userId: scope.userId,
          tenantId: scope.tenantId,
          resourceId: id,
          changes: {
            patientId,
            contactId: before.contactId,
            before: policy(before),
            after: policy(link),
          },
        },
      });
      return link;
    });
  }
  revoke(patientId: string, id: string) {
    const permissions = relationshipPermissions();
    return this.write.run(permissions, async (tx, scope) => {
      await lockPatient(tx, scope, patientId, permissions);
      const where = { id, patientId, ...linkWhere(scope, permissions) };
      const before = await tx.contactPatient.findFirst({ where });
      if (!before) throw new NotFoundException('Recurso não encontrado.');
      if (before.relationshipStatus === 'REVOKED')
        return tx.contactPatient.findFirstOrThrow({
          where,
          select: relationshipFields,
        });
      const [link] = await tx.contactPatient.updateManyAndReturn({
        where,
        data: {
          relationshipStatus: 'REVOKED',
          authorizationLevel: 'NO_ACCESS',
          active: false,
          isPrimaryContact: false,
          revokedBy: scope.userId,
          revokedAt: new Date(),
        },
        select: relationshipFields,
      });
      if (!link) throw new NotFoundException('Recurso não encontrado.');
      await recordAudit(tx, {
        data: {
          type: 'CONTACT_PATIENT_REVOKED',
          userId: scope.userId,
          tenantId: scope.tenantId,
          resourceId: id,
          changes: {
            patientId,
            contactId: before.contactId,
            before: policy(before),
            after: policy(link),
          },
        },
      });
      return link;
    });
  }
}
