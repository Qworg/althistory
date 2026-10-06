/**
 * LLM client factory.
 *
 * Configuration (provider, model, limits) comes from the caller; API keys are
 * read from environment variables only, never from request bodies or storage
 * (spec Req 10.5). The factory returns `null` when no key is configured so
 * callers fall back to pattern extraction.
 */

import { LLMClient, LLMConfig } from './LLMClient';
import { AnthropicClient } from './AnthropicClient';
import { OpenAIClient } from './OpenAIClient';

export { OpenAIClient } from './OpenAIClient';
export { AnthropicClient } from './AnthropicClient';
export * from './LLMClient';
export * from './prompts';

export interface LLMClientFactoryConfig {
  provider?: 'openai' | 'anthropic' | 'none';
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/**
 * Build an {@link LLMClient} from a provider selection and environment keys.
 *
 * `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are read here. The returned client
 * is `null` when the selected provider has no key, which is the signal for the
 * text extractor to stay pattern-based.
 */
export function createLLMClient(
  config: LLMClientFactoryConfig = {},
  env: NodeJS.ProcessEnv = process.env
): LLMClient | null {
  const provider = config.provider ?? inferProvider(env);
  if (provider === 'openai') {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return null;
    return new OpenAIClient({
      apiKey,
      model: config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      timeoutMs: config.timeoutMs,
    });
  }
  if (provider === 'anthropic') {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return new AnthropicClient({
      apiKey,
      model: config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      timeoutMs: config.timeoutMs,
    });
  }
  return null;
}

function inferProvider(env: NodeJS.ProcessEnv): 'openai' | 'anthropic' | 'none' {
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'none';
}

/** Report the resolved LLM configuration without exposing key material. */
export function resolveLLMConfig(
  client: LLMClient | null,
  config: LLMClientFactoryConfig = {},
  env: NodeJS.ProcessEnv = process.env
): LLMConfig {
  if (!client) {
    return { enabled: false, provider: 'none' };
  }
  const provider = config.provider ?? inferProvider(env);
  return {
    enabled: true,
    provider: provider === 'none' ? (client.provider as 'openai' | 'anthropic') : provider,
    model: config.model,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    timeout: config.timeoutMs,
  };
}
