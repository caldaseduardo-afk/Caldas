import { HttpException } from '@nestjs/common';
export type ToolErrorCode =
  | 'TOOL_NOT_FOUND'
  | 'INVALID_ARGUMENTS'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RESOURCE_NOT_FOUND'
  | 'INVALID_RELATIONSHIP'
  | 'SLOT_UNAVAILABLE'
  | 'HOLD_EXPIRED'
  | 'APPOINTMENT_CONFLICT'
  | 'INVALID_APPOINTMENT_STATE'
  | 'TOOL_TIMEOUT'
  | 'INTERNAL_ERROR'
  | 'TOOL_LIMIT_EXCEEDED'
  | 'CONFIRMATION_REQUIRED'
  | 'CALL_IN_PROGRESS'
  | 'IDEMPOTENCY_CONFLICT';
export class ToolExecutionError extends Error {
  constructor(readonly code: ToolErrorCode) {
    super(code);
  }
}
export function safeToolError(error: unknown, name: string) {
  let code: ToolErrorCode =
    error instanceof ToolExecutionError ? error.code : 'INTERNAL_ERROR';
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 400) code = 'INVALID_ARGUMENTS';
    if (status === 401) code = 'UNAUTHORIZED';
    if (status === 403) code = 'FORBIDDEN';
    if (status === 404) code = 'RESOURCE_NOT_FOUND';
    if (status === 409)
      code =
        name === 'create_hold' ? 'SLOT_UNAVAILABLE' : 'APPOINTMENT_CONFLICT';
  }
  return { code, safeMessage: code, retryable: false as const };
}
export interface ToolResult {
  success: boolean;
  toolName: string;
  callId: string;
  data?: unknown;
  error?: ReturnType<typeof safeToolError>;
}
