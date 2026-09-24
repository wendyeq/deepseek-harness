import { expect, it } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, MessageId, RequestMessage } from '@deepseek-ai/dsh-llm'
import { prepareReasoningHistory, rewriteResponsesPayload } from '../src/configuration-update.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Fixture producer. Adapters do not read message source. */
    'configuration-update-fixture': { kind: 'configuration-update-fixture' }
  }
}

const update = (effort: string, model = 'gpt-6-luna'): RequestMessage => ({
  role: 'developer',
  content: [{ type: 'configuration-update', effort, provider: 'openai', model }],
  source: { kind: 'configuration-update-fixture' },
  id: '00000000-0000-4000-8000-000000000001' as MessageId,
})

function options(messages: RequestMessage[]): GenerateOptions {
  return {
    provider: 'openai',
    model: 'gpt-6-luna',
    reasoningEffort: ReasoningEffortId('low'),
    messages,
  }
}

it('keeps Responses reasoning.effort and splices configuration_update in place', () => {
  const prepared = prepareReasoningHistory(options([
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    update('high'),
    { role: 'user', content: [{ type: 'text', text: 'second' }] },
  ]), 'openai-responses')
  expect(prepared.reasoningEffort).toBe('low')
  expect(prepared.rewriteResponsesPayload).toBe(true)
  const marker = prepared.messages[1]
  if (!marker || marker.role !== 'user' || marker.content[0]?.type !== 'text') throw new Error('expected a marker user message')
  const payload = {
    reasoning: { effort: 'low' },
    input: [
      { role: 'user', content: [{ type: 'input_text', text: 'first' }] },
      { role: 'user', content: [{ type: 'input_text', text: marker.content[0].text }] },
      { role: 'user', content: [{ type: 'input_text', text: 'second' }] },
    ],
  }
  expect(rewriteResponsesPayload(payload)).toEqual({
    reasoning: { effort: 'low' },
    input: [
      { role: 'user', content: [{ type: 'input_text', text: 'first' }] },
      { type: 'configuration_update', reasoning: { effort: 'high' } },
      { role: 'user', content: [{ type: 'input_text', text: 'second' }] },
    ],
  })
})

it('sends a later Chat Completions effort as reasoning_effort and drops the marker', () => {
  const prepared = prepareReasoningHistory(options([
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    update('high'),
  ]), 'openai-completions')
  expect(prepared.reasoningEffort).toBe('high')
  expect(prepared.rewriteResponsesPayload).toBe(false)
  expect(prepared.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'first' }] }])
})

it('ignores a configuration update recorded for a different model', () => {
  const prepared = prepareReasoningHistory(options([
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    update('high', 'gpt-6-astra'),
  ]), 'openai-responses')
  expect(prepared.reasoningEffort).toBe('low')
  expect(prepared.rewriteResponsesPayload).toBe(false)
  expect(prepared.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'first' }] }])
})
