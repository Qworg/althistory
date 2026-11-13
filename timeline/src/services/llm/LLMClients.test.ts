/**
 * Tests for the LLM clients, driven by recorded provider responses.
 *
 * The official `openai` and `@anthropic-ai/sdk` modules are mocked, so no test
 * touches the network or reads a real key. The env-var factory is exercised
 * with an explicit env object.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FetchHttpClient } from '../ingestion/http';
import { readWorldTimestamp } from '@althistory/calendar';
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
      timestamp: '1066-10-14T00:00:00.000Z',
      confidence: 0.94,
      source: { type: 'llm' },
      selected: true,
      edited: false,
    });
    expect(events[0].tempId).toContain('llm-');
  });

  it('leaves a model event with an empty actor or target unselected', async () => {
    mocks.openAiCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '{"events":[{"description":"Something happened","actor":"","target":"","timestamp":"1066-10-14T00:00:00Z","confidence":0.5}]}',
          },
        },
      ],
    });
    const client = new OpenAIClient({ apiKey: 'k' });

    const events = await client.extractEvents('text');

    // Kept so the reviewer can complete it, but not selected: `validateExtraction`
    // and `ImportService` reject an empty actor or target, and the approval
    // default imports the selected rows.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: '', target: '', selected: false });
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

  it("shows the model a world's events and range in the world's notation, never as ISO dates", async () => {
    const vael = {
      version: 2 as const,
      dayLength: 86_400,
      primary: 'reckoning',
      calendars: [{ id: 'reckoning', name: 'the Reckoning', parts: [{ name: 'Thaw', days: 30 }, { name: 'Gale', days: 30 }], epoch: 0, eras: [{ label: 'AR', from: 1 }] }],
    };
    const thaw = readWorldTimestamp(vael, 'Thaw 312 AR')!;
    mocks.anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"relationships":[]}' }] });
    const client = new AnthropicClient({ apiKey: 'test-key' });
    const event = (tempId: string) => ({
      tempId, description: `The river rose ${tempId}`, actor: 'A', target: 'B', timestamp: thaw.iso, datePrecision: 'month' as const,
      confidence: 0.5, source: { type: 'llm' as const, extractedAt: '2020-01-01T00:00:00Z' }, selected: true, edited: false,
    });
    await client.suggestRelationships([event('a'), event('b')], { calendar: vael });
    const sent = JSON.stringify(mocks.anthropicCreate.mock.calls[0]![0]);
    expect(sent).toContain('(Thaw 312 AR)');

    mocks.anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"events":[]}' }] });
    await client.extractEvents('text', { calendar: vael, defaultTimeRange: { start: thaw.iso, end: thaw.iso } }).catch(() => []);
    const extraction = JSON.stringify(mocks.anthropicCreate.mock.calls[1]![0]);
    expect(extraction).toContain('Default time range: Thaw 1, 312 AR to Thaw 1, 312 AR');
    expect(extraction).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
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
