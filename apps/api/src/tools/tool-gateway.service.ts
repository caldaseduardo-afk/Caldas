import { auditActorContext } from '@atendente/database';
import { ToolConfig } from './tool.config';
import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { z } from 'zod';
import type { PermissionName } from '@atendente/database';
import { AuthorizationService } from '../permissions/authorization.service';
import { isConversationEngineScope } from '../permissions/authorization.service';
import { operationBoundary } from '../permissions/operation-boundary';
import { DatabaseService } from '../auth/database.service';
import {
  ToolContextRepository,
  toolViewPermissions,
  type TrustedToolContext,
} from './tool-context.repository';
import { ToolExecutionRepository } from './tool-execution.repository';
import { ToolHandlers } from './tool.handlers';
import {
  ToolRegistry,
  AI_CAPABILITIES,
  CONVERSATION_ENGINE_CAPABILITIES,
  schemas,
  toolCallSchema,
  mutatingTools,
  confirmationTools,
  type ToolName,
} from './tool.schemas';
import {
  ToolExecutionError,
  safeToolError,
  type ToolResult,
} from './tool.errors';
export interface ToolTurn {
  readonly id: string;
}
const turnSchema = z.strictObject({
  conversationId: z.uuid(),
  actorType: z.enum(['AI', 'USER']),
  correlationId: z.uuid().optional(),
  approvedMutations: z
    .array(
      z.strictObject({
        name: z.enum([
          'create_hold',
          'release_hold',
          'confirm_appointment',
          'cancel_appointment',
          'reschedule_appointment',
        ]),
        arguments: z.record(z.string(), z.unknown()),
      }),
    )
    .max(8)
    .optional(),
});
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const toolFingerprint = (name: string, args: unknown) =>
  createHash('sha256').update(canonical({ name, args })).digest('hex');
const patientTools: readonly ToolName[] = [
  'search_available_slots',
  'create_hold',
  'release_hold',
  'get_appointment',
  'list_appointments',
  'confirm_appointment',
  'cancel_appointment',
  'reschedule_appointment',
];
const configuredCapability = (tool: ToolName) =>
  tool === 'search_knowledge_base'
    ? ('KNOWLEDGE' as const)
    : tool === 'transfer_to_human'
      ? ('HANDOFF' as const)
      : tool === 'cancel_appointment'
        ? ('CANCELLATION' as const)
        : tool === 'reschedule_appointment'
          ? ('RESCHEDULING' as const)
          : [
                'list_specialties',
                'list_services',
                'search_available_slots',
                'create_hold',
                'release_hold',
                'confirm_appointment',
              ].includes(tool)
            ? ('SCHEDULING' as const)
            : null;
const permissions: Record<ToolName, readonly PermissionName[]> = {
  get_contact_context: ['patient.view'],
  list_specialties: ['appointment.view'],
  list_services: ['appointment.view'],
  search_knowledge_base: ['knowledge.view'],
  search_available_slots: ['appointment.view', 'patient.view', 'unit.view'],
  create_hold: ['appointment.create', 'patient.view', 'unit.view'],
  release_hold: ['appointment.cancel', 'patient.view'],
  get_appointment: ['appointment.view', 'patient.view'],
  list_appointments: ['appointment.view', 'patient.view'],
  confirm_appointment: [
    'appointment.create',
    'appointment.view',
    'patient.view',
    'unit.view',
  ],
  cancel_appointment: [
    'appointment.cancel',
    'appointment.view',
    'patient.view',
  ],
  reschedule_appointment: [
    'appointment.reschedule',
    'appointment.view',
    'patient.view',
    'unit.view',
  ],
  transfer_to_human: ['conversation.reply'],
};
interface TurnState {
  context: TrustedToolContext;
  calls: number;
  expiresAt: number;
  approved: Set<string>;
  engine: boolean;
}
@Injectable()
export class ToolGateway {
  private readonly turns = new WeakMap<ToolTurn, TurnState>();
  private readonly logger = new Logger(ToolGateway.name);
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly contexts: ToolContextRepository,
    private readonly executions: ToolExecutionRepository,
    private readonly handlers: ToolHandlers,
    private readonly registry: ToolRegistry,
    private readonly config: ToolConfig = new ToolConfig(),
    @Optional() private readonly database?: DatabaseService,
  ) {}
  /** Trusted application entry only. No controller exposes this method. */
  async beginTurn(raw: z.input<typeof turnSchema>): Promise<ToolTurn> {
    const parsed = turnSchema.safeParse(raw);
    if (!parsed.success) throw new ToolExecutionError('INVALID_ARGUMENTS');
    const options = parsed.data;
    const scope = await this.authorization.requirePermissions(
      ...toolViewPermissions,
    );
    const conversation = await this.contexts.load(
      scope,
      options.conversationId,
    );
    const turn = Object.freeze({ id: randomUUID() });
    this.turns.set(turn, {
      context: {
        scope: Object.freeze({ ...scope }),
        conversationId: conversation.id,
        contactId: conversation.contactId,
        activePatientId: conversation.activePatientId,
        actorType: options.actorType,
        correlationId: options.correlationId ?? randomUUID(),
      },
      calls: 0,
      expiresAt: Date.now() + this.config.limits.turnTimeoutMs,
      approved: new Set(
        (options.approvedMutations ?? []).map((a) =>
          toolFingerprint(a.name, schemas[a.name].input.parse(a.arguments)),
        ),
      ),
      engine: isConversationEngineScope(scope),
    });
    return turn;
  }
  definitions() {
    return this.registry.definitions();
  }
  async executeTool(raw: unknown, turn: ToolTurn): Promise<ToolResult> {
    const started = Date.now();
    const deadline = Math.min(
      this.turns.get(turn)?.expiresAt ??
        started + this.config.limits.toolTimeoutMs,
      started + this.config.limits.toolTimeoutMs,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.executeValidated(raw, turn, started),
        new Promise<ToolResult>((resolve) => {
          timer = setTimeout(
            () => {
              const candidate =
                raw && typeof raw === 'object'
                  ? (raw as Record<string, unknown>)
                  : {};
              resolve({
                success: false,
                toolName:
                  typeof candidate.name === 'string' &&
                  this.registry.has(candidate.name)
                    ? candidate.name
                    : 'unknown',
                callId:
                  typeof candidate.callId === 'string' &&
                  /^[A-Za-z0-9_-]{1,100}$/.test(candidate.callId)
                    ? candidate.callId
                    : '',
                error: safeToolError(
                  new ToolExecutionError('TOOL_TIMEOUT'),
                  'unknown',
                ),
              });
            },
            Math.max(0, deadline - Date.now()),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async executeValidated(
    raw: unknown,
    turn: ToolTurn,
    started: number,
  ): Promise<ToolResult> {
    const state = this.turns.get(turn);
    let name = 'unknown',
      callId = '';
    let fingerprint: string | undefined;
    let admitted = false;
    try {
      if (!state) throw new ToolExecutionError('UNAUTHORIZED');
      if (++state.calls > this.config.limits.callsPerTurn)
        throw new ToolExecutionError('TOOL_LIMIT_EXCEEDED');
      if (Date.now() >= state.expiresAt)
        throw new ToolExecutionError('TOOL_TIMEOUT');
      let serialized: string;
      try {
        serialized = JSON.stringify(raw);
      } catch {
        throw new ToolExecutionError('INVALID_ARGUMENTS');
      }
      if (
        !serialized ||
        Buffer.byteLength(serialized) > this.config.limits.payloadBytes
      )
        throw new ToolExecutionError('INVALID_ARGUMENTS');
      const parsed = toolCallSchema.safeParse(raw);
      if (!parsed.success) throw new ToolExecutionError('INVALID_ARGUMENTS');
      callId = parsed.data.callId;
      if (!this.registry.has(parsed.data.name))
        throw new ToolExecutionError('TOOL_NOT_FOUND');
      name = parsed.data.name;
      const tool = parsed.data.name;
      const args = schemas[tool].input.safeParse(parsed.data.arguments);
      if (!args.success) throw new ToolExecutionError('INVALID_ARGUMENTS');
      const context = state.context;
      fingerprint = toolFingerprint(tool, args.data);
      if (context.actorType === 'AI' && !AI_CAPABILITIES.includes(tool))
        throw new ToolExecutionError('FORBIDDEN');
      if (state.engine && !CONVERSATION_ENGINE_CAPABILITIES.includes(tool))
        throw new ToolExecutionError('FORBIDDEN');
      if (state.engine && this.database) {
        const configured = await this.database.client.aIProcessingRun.findFirst(
          {
            where: {
              id: state.context.scope.userId,
              tenantId: state.context.scope.tenantId,
            },
            select: {
              aiConfigurationVersion: {
                select: {
                  enabledCapabilities: true,
                  knowledgeEnabled: true,
                },
              },
            },
          },
        );
        const capability = configuredCapability(tool);
        if (
          configured?.aiConfigurationVersion &&
          capability &&
          !configured.aiConfigurationVersion.enabledCapabilities.includes(
            capability,
          )
        )
          throw new ToolExecutionError('FORBIDDEN');
        if (
          configured?.aiConfigurationVersion &&
          tool === 'search_knowledge_base' &&
          !configured.aiConfigurationVersion.knowledgeEnabled
        )
          throw new ToolExecutionError('FORBIDDEN');
      }
      const scope = await this.authorization.requirePermissions(
        ...toolViewPermissions,
        ...permissions[tool],
      );
      if (
        scope.tenantId !== context.scope.tenantId ||
        scope.userId !== context.scope.userId ||
        scope.sessionId !== context.scope.sessionId
      )
        throw new ToolExecutionError('FORBIDDEN');
      const hash = toolFingerprint(tool, args.data);
      const existing = await this.executions.find(context, callId);
      await this.contexts.validate(
        context,
        patientTools.includes(tool),
        undefined,
        false,
        existing?.status === 'SUCCESS' && tool === 'transfer_to_human',
      );
      if (existing) {
        if (
          existing.inputHash !== hash ||
          existing.actorId !== scope.userId ||
          existing.actorType !== context.actorType ||
          existing.patientId !== context.activePatientId
        )
          throw new ToolExecutionError('IDEMPOTENCY_CONFLICT');
        if (existing.status === 'RUNNING')
          throw new ToolExecutionError('CALL_IN_PROGRESS');
        if (existing.result) return existing.result as unknown as ToolResult;
        // Read calls are deliberately not cached (no personal data persistence).
        throw new ToolExecutionError('IDEMPOTENCY_CONFLICT');
      }
      if (
        (confirmationTools.includes(tool) ||
          (state.engine && ['create_hold', 'release_hold'].includes(tool))) &&
        !state.approved.has(hash)
      )
        throw new ToolExecutionError('CONFIRMATION_REQUIRED');
      if (
        Date.now() >=
        Math.min(state.expiresAt, started + this.config.limits.toolTimeoutMs)
      )
        throw new ToolExecutionError('TOOL_TIMEOUT');
      const row = await this.executions.begin(context, tool, callId, hash);
      admitted = true;
      const deadline = Math.min(
        state.expiresAt,
        started + this.config.limits.toolTimeoutMs,
      );
      const check = () => {
        if (Date.now() >= deadline)
          throw new ToolExecutionError('TOOL_TIMEOUT');
      };
      const execute = async (): Promise<ToolResult> => {
        let result: ToolResult;
        try {
          check();
          const data = await operationBoundary.run(
            {
              beforeCommit: check,
              beforeWrite: async (tx, current) => {
                check();
                if (
                  current.tenantId !== scope.tenantId ||
                  current.userId !== scope.userId ||
                  current.sessionId !== scope.sessionId
                )
                  throw new ToolExecutionError('FORBIDDEN');
                await this.contexts.validate(
                  context,
                  patientTools.includes(tool),
                  tx,
                  true,
                );
                const target = args.data as {
                  appointmentId?: string;
                  holdId?: string;
                };
                if (target.appointmentId)
                  await this.contexts.target(
                    context,
                    'appointment',
                    target.appointmentId,
                    tx,
                  );
                if (target.holdId)
                  await this.contexts.target(
                    context,
                    'appointmentHold',
                    target.holdId,
                    tx,
                  );
                check();
              },
            },
            () => auditActorContext.run({ tenantId: scope.tenantId, actorType: context.actorType,
              actorUserId: context.actorType === 'USER' ? scope.userId : null,
              actorReferenceId: context.conversationId, source: context.actorType === 'AI' ? 'AI_ENGINE' : 'WEB',
              correlationId: context.correlationId }, () => this.handlers.execute(tool, args.data, context, row.id)),
          );
          // Reads are revalidated after awaiting services too; mutation post-state may intentionally differ.
          if (!mutatingTools.includes(tool)) {
            check();
            await this.contexts.validate(context, patientTools.includes(tool));
          }
          const output = schemas[tool].output.safeParse(data);
          if (!output.success) throw new ToolExecutionError('INTERNAL_ERROR');
          result = { success: true, toolName: tool, callId, data: output.data };
        } catch (error) {
          result = {
            success: false,
            toolName: tool,
            callId,
            error: safeToolError(error, tool),
          };
        }
        try {
          await this.executions.complete(
            context,
            row.id,
            result,
            Date.now() - started,
            mutatingTools.includes(tool),
          );
        } catch {
          this.logger.error({
            code: 'TOOL_AUDIT_FINALIZATION_FAILED',
            tenantId: scope.tenantId,
            correlationId: context.correlationId,
          });
        }
        this.log(state, tool, result, Date.now() - started);
        return result;
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          execute(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new ToolExecutionError('TOOL_TIMEOUT')),
              Math.max(0, deadline - Date.now()),
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (error) {
      const result: ToolResult = {
        success: false,
        toolName: name,
        callId,
        error: safeToolError(error, name),
      };
      if (state) {
        if (!admitted && fingerprint && this.registry.has(name)) {
          try {
            const row = await this.executions.begin(
              state.context,
              name,
              callId,
              fingerprint,
            );
            await this.executions.complete(
              state.context,
              row.id,
              result,
              Date.now() - started,
              true,
            );
          } catch {
            /* Existing invocation or revoked session: never overwrite its audit. */
          }
        }
        this.log(state, name, result, Date.now() - started);
      }
      return result;
    }
  }
  private log(
    state: TurnState,
    tool: string,
    result: ToolResult,
    durationMs: number,
  ) {
    this.logger.log({
      tool,
      tenantId: state.context.scope.tenantId,
      conversationId: state.context.conversationId,
      correlationId: state.context.correlationId,
      success: result.success,
      code: result.error?.code,
      durationMs,
    });
  }
}
