import { recordAudit, encryptTenantCredential } from '@atendente/database';
import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import type { IntegrationSettingsInput } from './integration-settings.dto';

@Injectable()
export class IntegrationSettingsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}

  async get() {
    const scope = await this.authorization.requirePermissions('settings.view');
    const [tenant, integration, aiCredential] = await Promise.all([
      this.database.client.tenant.findFirst({
        where: authorizedTenantFilter(scope, ['settings.view']),
        select: { id: true },
      }),
      this.database.client.integration.findFirst({
        where: {
          tenantId: scope.tenantId,
          tenant: authorizedTenantFilter(scope, ['settings.view']),
        },
        select: {
          id: true,
          phoneNumberId: true,
          externalAccountId: true,
          status: true,
          credentialCiphertext: true,
          credentialsReference: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.database.client.aIProviderCredential.findFirst({
        where: {
          tenantId: scope.tenantId,
          tenant: authorizedTenantFilter(scope, ['settings.view']),
        },
        select: { id: true },
      }),
    ]);
    if (!tenant) throw new NotFoundException('Recurso não encontrado.');
    return {
      openAi: { configured: Boolean(aiCredential) },
      whatsapp: integration
        ? {
            configured:
              Boolean(integration.credentialCiphertext) ||
              Boolean(integration.credentialsReference),
            phoneNumberId: integration.phoneNumberId,
            businessAccountId: integration.externalAccountId,
            status: integration.status,
          }
        : {
            configured: false,
            phoneNumberId: null,
            businessAccountId: null,
            status: null,
          },
    };
  }

  async configure(input: IntegrationSettingsInput) {
    const scope =
      await this.authorization.requirePermissions('settings.manage');
    try {
      return await this.database.client.$transaction(
        async (tx) => {
          const tenant = await tx.tenant.findFirst({
            where: authorizedTenantFilter(scope, ['settings.manage']),
            select: { id: true },
          });
          if (!tenant) throw new NotFoundException('Recurso não encontrado.');

          const changed: string[] = [];
          if (input.openAiApiKey) {
            const envelope = encryptTenantCredential(
              input.openAiApiKey,
              scope.tenantId,
              'OPENAI_API_KEY',
            );
            await tx.aIProviderCredential.upsert({
              where: { tenantId: scope.tenantId },
              create: { tenantId: scope.tenantId, ...envelope },
              update: envelope,
              select: { id: true },
            });
            changed.push('openai');
          }

          if (input.whatsapp) {
            const existing = await tx.integration.findFirst({
              where: { tenantId: scope.tenantId, type: 'WHATSAPP' },
              orderBy: { createdAt: 'asc' },
            });
            if (
              existing &&
              (existing.phoneNumberId !== input.whatsapp.phoneNumberId ||
                existing.externalAccountId !== input.whatsapp.businessAccountId)
            )
              throw new ConflictException(
                'O número associado não pode ser trocado por esta tela. Solicite a alteração ao suporte.',
              );
            const id = existing?.id ?? randomUUID();
            const envelope = encryptTenantCredential(
              input.whatsapp.accessToken!,
              scope.tenantId,
              'WHATSAPP_ACCESS_TOKEN',
              id,
            );
            const data = {
              credentialsReference: 'WHATSAPP_ACCESS_TOKEN_CLINIC',
              credentialCiphertext: envelope.ciphertext,
              credentialNonce: envelope.nonce,
              credentialAuthTag: envelope.authTag,
              status: 'ACTIVE' as const,
            };
            const row = existing
              ? await tx.integration.update({
                  where: {
                    tenantId_id: {
                      tenantId: scope.tenantId,
                      id: existing.id,
                    },
                  },
                  data,
                  select: { id: true },
                })
              : await tx.integration.create({
                  data: {
                    id,
                    tenantId: scope.tenantId,
                    type: 'WHATSAPP',
                    provider: 'WHATSAPP_CLOUD',
                    phoneNumberId: input.whatsapp.phoneNumberId,
                    externalAccountId: input.whatsapp.businessAccountId,
                    ...data,
                  },
                  select: { id: true },
                });
            await recordAudit(tx, {
              data: {
                tenantId: scope.tenantId,
                userId: scope.userId,
                resourceId: row.id,
                type: 'INTEGRATION_CONFIGURED',
                changes: {
                  provider: 'WHATSAPP_CLOUD',
                  status: 'ACTIVE',
                  credentialRotated: true,
                  source: 'clinic-settings',
                },
              },
            });
            changed.push('whatsapp');
          }

          if (input.openAiApiKey) {
            await recordAudit(tx, {
              data: {
                tenantId: scope.tenantId,
                userId: scope.userId,
                resourceId: scope.tenantId,
                type: 'INTEGRATION_CONFIGURED',
                changes: {
                  provider: 'OPENAI',
                  credentialRotated: true,
                  source: 'clinic-settings',
                },
              },
            });
          }
          return { updated: changed };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Este número do WhatsApp já está associado a outra clínica.',
        );
      throw error;
    }
  }
}
