import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DirectEngine } from './engine/DirectEngine';
import { McpServer } from './mcp/McpServer';
import { MCP_TOOLS } from './mcp/toolDefinitions';
import { runCLI } from './index';
import { ExitCode } from './utils/exitCodes';

describe('CLI Phase 6: Model Context Protocol (MCP) Server & Tooling', () => {
  let engine: DirectEngine;
  let testGraphId: string;
  let server: McpServer;

  beforeEach(async () => {
    engine = new DirectEngine();
    const graph = await engine.createGraph(
      'MCP Test Graph',
      'Graph for testing Model Context Protocol tools and JSON-RPC dispatch'
    );
    testGraphId = graph.id;
    server = new McpServer(engine);
  });

  afterEach(async () => {
    try {
      await engine.deleteGraph(testGraphId);
    } catch {
      // Best-effort cleanup
    }
    await engine.shutdown();
  });

  describe('JSON-RPC 2.0 Protocol & Lifecycle', () => {
    it('handles initialize handshake with protocolVersion 2024-11-05', async () => {
      const responseStr = await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-agent', version: '1.0' },
          },
        })
      );

      expect(responseStr).toBeDefined();
      const response = JSON.parse(responseStr!);
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result.protocolVersion).toBe('2024-11-05');
      expect(response.result.capabilities.tools).toBeDefined();
      expect(response.result.serverInfo.name).toBe('althistory-mcp');
    });

    it('handles ping request', async () => {
      const responseStr = await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'ping-123',
          method: 'ping',
        })
      );

      const response = JSON.parse(responseStr!);
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('ping-123');
      expect(response.result).toEqual({});
    });

    it('silently ignores notifications (messages without id)', async () => {
      const responseStr = await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        })
      );

      expect(responseStr).toBeNull();
    });

    it('returns parse error on invalid JSON payload', async () => {
      const responseStr = await server.handleMessage('{ invalid json payload');
      expect(responseStr).toBeDefined();
      const response = JSON.parse(responseStr!);
      expect(response.error.code).toBe(-32700);
      expect(response.error.message).toContain('Parse error');
    });

    it('returns method not found on unknown JSON-RPC method', async () => {
      const responseStr = await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 99,
          method: 'unknown/method',
        })
      );

      const response = JSON.parse(responseStr!);
      expect(response.id).toBe(99);
      expect(response.error).toBeDefined();
      expect(response.error.message).toContain('Method not found');
    });
  });

  describe('MCP Tools Discovery & Invocation', () => {
    it('lists all registered tools with valid JSON schemas', async () => {
      const responseStr = await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        })
      );

      const response = JSON.parse(responseStr!);
      expect(response.result.tools).toBeDefined();
      expect(response.result.tools.length).toBe(MCP_TOOLS.length);

      const toolNames = response.result.tools.map((t: { name: string }) => t.name);
      expect(toolNames).toContain('althistory_list_graphs');
      expect(toolNames).toContain('althistory_create_event');
      expect(toolNames).toContain('althistory_ingest_text');
      expect(toolNames).toContain('althistory_generate_timeline');
      expect(toolNames).toContain('althistory_branch_timeline');
      expect(toolNames).toContain('althistory_query_causal_path');
      expect(toolNames).toContain('althistory_validate_graph');
      expect(toolNames).toContain('althistory_export_context');
    });

    it('invokes althistory_list_graphs via tools/call', async () => {
      const responseStr = await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'althistory_list_graphs',
            arguments: {},
          },
        })
      );

      const response = JSON.parse(responseStr!);
      expect(response.result.content).toBeDefined();
      expect(response.result.content[0].type).toBe('text');

      const parsedData = JSON.parse(response.result.content[0].text);
      expect(Array.isArray(parsedData)).toBe(true);
      expect(parsedData.some((g: { id: string }) => g.id === testGraphId)).toBe(true);
    });

    it('invokes althistory_create_event via tools/call', async () => {
      const responseStr = await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'althistory_create_event',
            arguments: {
              graphId: testGraphId,
              description: 'Boston Tea Party',
              timestamp: '1773-12-16T19:00:00Z',
              actor: 'Sons of Liberty',
              target: 'British East India Company',
            },
          },
        })
      );

      const response = JSON.parse(responseStr!);
      expect(response.result.content).toBeDefined();
      const eventDto = JSON.parse(response.result.content[0].text);
      expect(eventDto.description).toBe('Boston Tea Party');
      expect(eventDto.actor).toBe('Sons of Liberty');

      // Verify event persists in graph
      const events = await engine.listEvents(testGraphId);
      expect(events.some((e) => e.description === 'Boston Tea Party')).toBe(true);
    });

    it('invokes althistory_validate_graph and althistory_export_context via tools/call', async () => {
      // 1. Add event
      await engine.createEvent(testGraphId, {
        description: 'Signing of the Declaration of Independence',
        timestamp: '1776-07-04T00:00:00Z',
        actor: 'Continental Congress',
        target: 'Great Britain',
      });

      // 2. Validate
      const validateResStr = await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'althistory_validate_graph',
            arguments: {
              graphId: testGraphId,
              strict: false,
            },
          },
        })
      );
      const validateRes = JSON.parse(validateResStr!);
      const report = JSON.parse(validateRes.result.content[0].text);
      expect(report.valid).toBe(true);

      // 3. Export Context in Markdown
      const exportResStr = await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: {
            name: 'althistory_export_context',
            arguments: {
              graphId: testGraphId,
              format: 'markdown',
            },
          },
        })
      );
      const exportRes = JSON.parse(exportResStr!);
      const mdContent = exportRes.result.content[0].text;
      expect(mdContent).toContain('# Timeline Context');
      expect(mdContent).toContain('Signing of the Declaration of Independence');
    });

    it('returns tool error payload when unknown tool is called', async () => {
      const responseStr = await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: {
            name: 'nonexistent_tool',
            arguments: {},
          },
        })
      );

      const response = JSON.parse(responseStr!);
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain('Unknown tool: nonexistent_tool');
    });
  });

  describe('CLI Schema Command', () => {
    it('outputs full JSON schema dictionary', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const exitCode = await runCLI(['node', 'althistory', 'schema', '--direct', '--json']);
      expect(exitCode).toBe(ExitCode.SUCCESS);
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c) => c[0].toString()).join('');
      expect(output).toContain('althistory_ingest_text');
      expect(output).toContain('althistory_generate_timeline');
      stdoutSpy.mockRestore();
    });

    it('outputs specific tool schema when --tool is specified', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const exitCode = await runCLI([
        'node',
        'althistory',
        'schema',
        '--tool',
        'althistory_validate_graph',
        '--direct',
        '--json',
      ]);
      expect(exitCode).toBe(ExitCode.SUCCESS);
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c) => c[0].toString()).join('');
      expect(output).toContain('althistory_validate_graph');
      expect(output).toContain('autoRepair');
      stdoutSpy.mockRestore();
    });

    it('returns NOT_FOUND exit code on unknown tool in schema command', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const exitCode = await runCLI([
        'node',
        'althistory',
        'schema',
        '--tool',
        'nonexistent_tool',
        '--direct',
        '--json',
      ]);
      expect(exitCode).toBe(ExitCode.NOT_FOUND);
      stdoutSpy.mockRestore();
    });
  });
});
