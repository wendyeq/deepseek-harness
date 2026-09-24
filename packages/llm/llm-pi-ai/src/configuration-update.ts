/** Translate a recorded reasoning-effort change into the provider payload. */
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ReasoningEffortId as ReasoningEffortIdType, RequestMessage } from '@deepseek-ai/dsh-llm'

/** Responses APIs accept a configuration_update item. Chat Completions does not. */
const RESPONSES_APIS = new Set(['openai-responses', 'azure-openai-responses', 'openai-codex-responses'])

/**
 * Marker placed where a configuration update sits in the converted transcript.
 * `onPayload` replaces it before the request is sent; it is not model text.
 */
export const CONFIGURATION_UPDATE_TEXT_PREFIX = '\u0000dsh-configuration-update\u0000'

/** Messages handed to pi-ai, and the effort its request-level field should carry. */
export interface PreparedReasoningHistory {
  /** History with configuration updates removed or replaced by a marker. */
  readonly messages: RequestMessage[]
  /**
   * Responses keeps the original request-level effort.
   * Every other API uses the latest update, because it has no configuration_update item.
   */
  readonly reasoningEffort: ReasoningEffortIdType | undefined
  /** True when `onPayload` must turn markers into configuration_update items. */
  readonly rewriteResponsesPayload: boolean
}

function readUpdate(message: RequestMessage): { effort: string; provider: string; model: string } | undefined {
  if (message.role !== 'developer' || message.content.length !== 1) return undefined
  const block = message.content[0]
  if (block?.type !== 'configuration-update' || block.effort.length === 0) return undefined
  return { effort: block.effort, provider: block.provider, model: block.model }
}

/**
 * Keep request-level effort stable for Responses and carry later changes as markers.
 * Chat Completions and other APIs take the latest effort as their request-level field.
 * @param options - the harness request, including any recorded configuration updates.
 * @param api - pi-ai API id for the resolved model.
 * @returns history safe for pi-ai and the effort to pass as `reasoning`.
 */
export function prepareReasoningHistory(options: GenerateOptions, api: string): PreparedReasoningHistory {
  const responses = RESPONSES_APIS.has(api)
  let sawUpdate = false
  let effective: string | undefined
  const messages: RequestMessage[] = []
  for (const message of options.messages) {
    const update = readUpdate(message)
    if (!update) {
      messages.push(message)
      continue
    }
    sawUpdate = true
    if (update.provider !== options.provider || update.model !== options.model) continue
    effective = update.effort
    if (!responses) continue
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: `${CONFIGURATION_UPDATE_TEXT_PREFIX}${update.effort}` }],
    })
  }
  if (!sawUpdate) {
    return { messages: options.messages, reasoningEffort: options.reasoningEffort, rewriteResponsesPayload: false }
  }
  return {
    messages,
    reasoningEffort: !responses && effective !== undefined ? ReasoningEffortId(effective) : options.reasoningEffort,
    rewriteResponsesPayload: responses && effective !== undefined,
  }
}

function markerEffort(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith(CONFIGURATION_UPDATE_TEXT_PREFIX)) return undefined
  const effort = value.slice(CONFIGURATION_UPDATE_TEXT_PREFIX.length)
  return effort.length > 0 ? effort : undefined
}

function itemEffort(item: unknown): string | undefined {
  if (typeof item !== 'object' || item === null) return undefined
  const record = item as { content?: unknown }
  const direct = markerEffort(record.content)
  if (direct !== undefined) return direct
  if (!Array.isArray(record.content) || record.content.length !== 1) return undefined
  const part = record.content[0]
  if (typeof part !== 'object' || part === null) return undefined
  return markerEffort((part as { text?: unknown }).text)
}

/**
 * Replace marker user items with configuration_update and leave `reasoning.effort` untouched.
 * @param payload - provider params after pi-ai builds them.
 * @returns the same params when nothing matches, otherwise a copy with updates spliced in.
 */
export function rewriteResponsesPayload(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { input?: unknown }).input)) return payload
  const input = (payload as { input: readonly unknown[] }).input
  let changed = false
  const rewritten = input.map((item) => {
    const effort = itemEffort(item)
    if (effort === undefined) return item
    changed = true
    return { type: 'configuration_update', reasoning: { effort } }
  })
  return changed ? { ...payload, input: rewritten } : payload
}
