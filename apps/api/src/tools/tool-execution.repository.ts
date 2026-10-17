import { Injectable } from '@nestjs/common';
import type { Prisma } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import { authorizedTenantFilter } from '../permissions/authorization.service';
import { ToolExecutionError, type ToolResult } from './tool.errors';
import {
  toolViewPermissions,
  type TrustedToolContext,
} from './tool-context.repository';
@Injectable()
export class ToolExecutionRepository {
  constructor(private readonly database: DatabaseService) {}
  private where(context: TrustedToolContext, callId: string) {
    return {
      tenantId: context.scope.tenantId,
      conversationId: context.conversationId,
      callId,
      tenant: authorizedTenantFilter(context.scope, toolViewPermissions),
    };
  }
  async find(context: TrustedToolContext, callId: string) {
    return this.database.client.toolExecution.findFirst({
      where: this.where(context, callId),
    });
  }
  async begin(
    context: TrustedToolContext,
    name: string,
    callId: string,
    inputHash: string,
  ) {
    try {
      return await this.database.client.$transaction(async (tx) => {
        if (
          !(await tx.tenant.findFirst({
            where: authorizedTenantFilter(context.scope, toolViewPermissions),
            select: { id: true },
          }))
        )
          throw new ToolExecutionError('FORBIDDEN');
        return tx.toolExecution.create({
          data: {
            tenantId: context.scope.tenantId,
            conversationId: context.conversationId,
            contactId: context.contactId,
            patientId: context.activePatientId,
            actorType: context.actorType,
            actorId: context.scope.userId,
            correlationId: context.correlationId,
            toolName: name,
            callId,
            inputHash,
          },
        });
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new ToolExecutionError('CALL_IN_PROGRESS');
      throw error;
    }
  }
  async complete(
    context: TrustedToolContext,
    id: string,
    result: ToolResult,
    durationMs: number,
    storeResult: boolean,
  ) {
    // Completion of an admitted invocation is scoped to its immutable identity, even after revocation.
    const data = result.data as Record<string, unknown> | undefined;
    const target = data?.appointmentId ?? data?.holdId ?? data?.conversationId;
    await this.database.client.toolExecution.updateMany({
      where: {
        id,
        tenantId: context.scope.tenantId,
        conversationId: context.conversationId,
        actorId: context.scope.userId,
        status: 'RUNNING',
      },
      data: {
        status: result.success ? 'SUCCESS' : 'ERROR',
        errorCode: result.error?.code,
        result: storeResult
          ? (JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue)
          : undefined,
        durationMs,
        completedAt: new Date(),
        ...(typeof target === 'string' ? { targetId: target } : {}),
      },
    });
  }
}
