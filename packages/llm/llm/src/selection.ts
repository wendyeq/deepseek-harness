/** Selector policies are distinct from concrete, adapter-bound generation calls. */
import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig } from './call-config.ts'
import type { GenerateOptions, LlmResolvedModelInfo } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Identify a plugin-owned model selector that is not a generation model.
     * @param provider - selected provider or policy id.
     * @param model - selected model or policy id.
     * @mode bail
     */
    'llm/model-selector'(provider: string, model: string): true | void
    /**
     * Validate a user selection, which may name a plugin-owned selector rather than an adapter.
     * A policy owning the selection may return it without resolving a generation call.
     * @param selection - requested provider, model, and optional effort.
     * @mode waterfall
     */
    'llm/selection'(selection: LlmCallConfig, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>
    /**
     * Read selector input capabilities without resolving a generation call.
     * @param provider - selected provider or policy id.
     * @param model - selected model or policy id.
     * @mode waterfall
     */
    'llm/selection-info'(provider: string, model: string, next: () => Promise<LlmResolvedModelInfo>): Promise<LlmResolvedModelInfo>
    /**
     * Resolve a purpose-tagged call before its caller logs the request.
     * Policies return replacement options; they never mutate caller-owned input.
     * @param options - auxiliary request with purpose and optional Session identity.
     * @mode waterfall
     */
    'llm/auxiliary-options'(options: GenerateOptions, next: () => Promise<GenerateOptions>): Promise<GenerateOptions>
  }
}

/**
 * Identify selectors before producing model-switch notices or other concrete-model copy.
 * @param ctx - selector policy context.
 * @param provider - selected provider or policy id.
 * @param model - selected model or policy id.
 * @returns whether a policy owns this pair as a selector only.
 */
export function isModelSelector(ctx: Context, provider: string, model: string): boolean {
  return ctx.bail('llm/model-selector', provider, model) === true
}

/**
 * Validate a selector value; only prepareCall/resolveCallConfig validate concrete calls.
 * @param ctx - selector policy and LLM registry context.
 * @param selection - user-selected provider/model/effort.
 * @returns the accepted selection, retaining policy-owned selector values.
 */
export function resolveModelSelection(ctx: Context, selection: LlmCallConfig): Promise<LlmCallConfig> {
  return ctx.waterfall('llm/selection', selection, () => ctx.llm.resolveCallConfig(selection))
}

/**
 * Read input admission metadata for a model selector.
 * @param ctx - selector policy and LLM registry context.
 * @param provider - selected provider or policy id.
 * @param model - selected model or policy id.
 * @returns declared selector capabilities, not a bound generation adapter.
 */
export function resolveSelectionModelInfo(ctx: Context, provider: string, model: string): Promise<LlmResolvedModelInfo> {
  return ctx.waterfall('llm/selection-info', provider, model, () => ctx.llm.resolveModelInfo(provider, model))
}

/**
 * Resolve purpose-tagged options before logging; untagged main calls are unchanged.
 * Policies must be idempotent because direct stream callers also pass this check.
 * @param ctx - auxiliary policy context.
 * @param options - caller-owned request, never mutated.
 * @returns request options selected by the auxiliary policy.
 */
export function resolveAuxiliaryOptions(ctx: Context, options: GenerateOptions): Promise<GenerateOptions> {
  return options.purpose === undefined
    ? Promise.resolve(options)
    : ctx.waterfall('llm/auxiliary-options', options, () => Promise.resolve(options))
}
