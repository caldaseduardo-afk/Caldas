import { Injectable } from '@nestjs/common';

function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

@Injectable()
export class ConversationEngineConfig {
  readonly historyLimit = integer(
    process.env.CONVERSATION_ENGINE_HISTORY_LIMIT,
    20,
    1,
    40,
  );
  readonly maxIterations = integer(
    process.env.CONVERSATION_ENGINE_MAX_ITERATIONS,
    5,
    1,
    5,
  );
  readonly maxToolCalls = integer(
    process.env.CONVERSATION_ENGINE_MAX_TOOL_CALLS,
    8,
    1,
    8,
  );
  readonly timeoutMs = integer(
    process.env.CONVERSATION_ENGINE_TIMEOUT_MS,
    30000,
    5000,
    60000,
  );
  readonly leaseMs = Math.max(this.timeoutMs + 15000, 45000);
  readonly minimumConfidence = (() => {
    const value = Number(
      process.env.CONVERSATION_ENGINE_MIN_CONFIDENCE ?? '0.6',
    );
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.6;
  })();
  readonly workflowTtlHours = integer(
    process.env.SCHEDULING_WORKFLOW_TTL_HOURS,
    24,
    1,
    168,
  );
  readonly slotOptionTtlMinutes = integer(
    process.env.SCHEDULING_OPTION_TTL_MINUTES,
    15,
    1,
    60,
  );
}
