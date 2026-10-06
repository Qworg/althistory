/**
 * Tests for the LLM clients, driven by recorded provider responses.
 *
 * The official `openai` and `@anthropic-ai/sdk` modules are mocked, so no test
 * touches the network or reads a real key. The env-var factory is exercised
 * with an explicit env object.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FetchHttpClient } from '../ingestion/http';
import openAiFixture from './fixtures/openai-chat-completions.json';
import anthropicFixture from './fixtures/anthropic-messages.json';

const mocks = vi.hoisted(() => ({
  openAiCreate: vi.fn(),
  anthropicCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mocks.openAiCreate } },
  })),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mocks.anthropicCreate },
  })),
}));

import { OpenAIClient } from './OpenAIClient';
import { AnthropicClient } from './AnthropicClient';
import { createLLMClient, resolveLLMConfig } from './index';

describe('OpenAIClient', () => {
  beforeEach(() => {
    mocks.openAiCreate.mockReset();
  });

  it('parses events from a recorded chat-completions response and drops the invalid one', async () => {
    mocks.openAiCreate.mockResolvedValue(openAiFixture);
    const client = new OpenAIClient({ apiKey: 'test-key', model: 'gpt-4o-mini' });

    const events = await client.extractEvents('The Battle of Hastings was fought in 1066.');

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      actor: 'William, Duke of Normandy',
      target: 'Harold Godwinson',
      timestamp: '1066-10-14T00:00:00Z',
      confidence: 0.94,
      source: { type: 'llm' },
      selected: true,
      edited: false,
    });
    expect(events[0].tempId).toContain('llm-');
  });

  it('requests a JSON response from the configured model', async () => {
    mocks.openAiCreate.mockResolvedValue(openAiFixture);
    const client = new OpenAIClient({ apiKey: 'secret-key', model: 'gpt-4o-mini' });

    await client.extractEvents('text');

    expect(mocks.openAiCreate).toHaveBeenCalledTimes(1);
    expect(mocks.openAiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
      })
    );
  });

  it('parses an enriched description', async () => {
    mocks.openAiCreate.mockResolvedValue({
      choices: [{ message: { content: '{"description":"Improved"}' } }],
    });
    const client = new OpenAIClient({ apiKey: 'k' });

    const description = await client.enrichDescription({
      tempId: 'x',
      description: 'Old',
      actor: 'A',
      target: 'B',
      timestamp: '1066-01-01T00:00:00Z',
      confidence: 0.5,
      source: { type: 'text', extractedAt: '2020-01-01T00:00:00Z' },
      selected: true,
      edited: false,
    });

    expect(description).toBe('Improved');
  });
});

describe('AnthropicClient', () => {
  beforeEach(() => {
    mocks.anthropicCreate.mockReset();
  });

  it('strips a markdown fence around the recorded JSON response', async () => {
    mocks.anthropicCreate.mockResolvedValue(anthropicFixture);
    const client = new AnthropicClient({ apiKey: 'test-key' });

    const events = await client.extractEvents('The Battle of Hastings was fought in 1066.');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      description: 'The Battle of Hastings was fought',
      source: { type: 'llm' },
    });
  });

  it('sends the prompt through the messages endpoint', async () => {
    mocks.anthropicCreate.mockResolvedValue(anthropicFixture);
    const client = new AnthropicClient({ apiKey: 'secret-key' });

    await client.extractEvents('text');

    expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
    expect(mocks.anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
      })
    );
  });
});

describe('createLLMClient', () => {
  it('returns null when no key is configured', () => {
    expect(createLLMClient({}, {})).toBeNull();
    expect(resolveLLMConfig(null, {}, {})).toEqual({ enabled: false, provider: 'none' });
  });

  it('selects OpenAI when OPENAI_API_KEY is set', () => {
    const client = createLLMClient({}, { OPENAI_API_KEY: 'k' });
    expect(client?.provider).toBe('openai');
    expect(resolveLLMConfig(client, {}, { OPENAI_API_KEY: 'k' })).toMatchObject({
      enabled: true,
      provider: 'openai',
    });
  });

  it('selects Anthropic when requested and its key is present', () => {
    const client = createLLMClient({ provider: 'anthropic' }, { ANTHROPIC_API_KEY: 'k' });
    expect(client?.provider).toBe('anthropic');
  });

  it('returns null when the requested provider has no key', () => {
    expect(createLLMClient({ provider: 'anthropic' }, { OPENAI_API_KEY: 'k' })).toBeNull();
  });
});

describe('FetchHttpClient allowlist', () => {
  it('refuses a non-HTTPS URL before making a request', async () => {
    const client = new FetchHttpClient(1000);
    await expect(client.request({ url: 'http://en.wikipedia.org/wiki/X' })).rejects.toThrow(
      /non-HTTPS/
    );
  });

  it('refuses a host outside the allowlist', async () => {
    const client = new FetchHttpClient(1000);
    await expect(client.request({ url: 'https://evil.example.com/steal' })).rejects.toThrow(
      /disallowed host/
    );
  });

  it('does not call global fetch for a rejected host', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = new FetchHttpClient(1000);
    await expect(client.request({ url: 'https://evil.example.com/' })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
