import type { AIModelConfig } from '@atendente/domain';
import type { AICapabilityName } from './ai-configuration.dto';
export interface EffectiveAIConfiguration {
  versionId: string | null;
  versionNumber: number | null;
  assistantName: string;
  tone: string;
  customTone: string | null;
  greeting: string;
  systemInstructions: string;
  allowedContent: readonly string[];
  enabledCapabilities: readonly AICapabilityName[];
  knowledgeEnabled: boolean;
  handoffPaymentNegotiation: boolean;
  handoffKnowledgeMiss: boolean;
  confidenceThreshold: number;
  modelConfig: AIModelConfig;
  fallback: boolean;
}
export const PLATFORM_CAPABILITIES: readonly AICapabilityName[] = [
  'SCHEDULING',
  'RESCHEDULING',
  'CANCELLATION',
  'KNOWLEDGE',
  'HANDOFF',
];
