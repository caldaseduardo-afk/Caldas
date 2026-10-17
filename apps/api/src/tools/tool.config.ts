import { Injectable } from '@nestjs/common';
import { TOOL_LIMITS } from './tool.schemas';
@Injectable()
export class ToolConfig {
  readonly limits: {
    callsPerTurn: number;
    toolTimeoutMs: number;
    turnTimeoutMs: number;
    payloadBytes: number;
  };
  constructor() {
    const integer = (
      name: string,
      fallback: number,
      min: number,
      max: number,
    ) => {
      const raw = process.env[name] || String(fallback),
        value = Number(raw);
      if (
        !/^\d+$/.test(raw) ||
        !Number.isSafeInteger(value) ||
        value < min ||
        value > max
      )
        throw new Error('TOOL_CONFIG_INVALID');
      return value;
    };
    this.limits = Object.freeze({
      callsPerTurn: integer(
        'TOOL_CALLS_PER_TURN',
        TOOL_LIMITS.callsPerTurn,
        1,
        16,
      ),
      toolTimeoutMs: integer(
        'TOOL_TIMEOUT_MS',
        TOOL_LIMITS.toolTimeoutMs,
        100,
        10000,
      ),
      turnTimeoutMs: integer(
        'TOOL_TURN_TIMEOUT_MS',
        TOOL_LIMITS.turnTimeoutMs,
        1000,
        60000,
      ),
      payloadBytes: TOOL_LIMITS.payloadBytes,
    });
  }
}
