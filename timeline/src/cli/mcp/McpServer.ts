import * as readline from 'readline';
import { IEngine } from '../engine/IEngine';
import { MCP_TOOLS } from './toolDefinitions';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class McpServer {
  private rl?: readline.Interface;
  private isRunning = false;

  constructor(private readonly engine: IEngine) {}

  /**
   * Handles a single raw JSON-RPC string message.
   * Returns response string or null if notification.
   */
  async handleMessage(rawMessage: string): Promise<string | null> {
    const trimmed = rawMessage.trim();
    if (!trimmed) return null;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch (err) {
      const parseError: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${(err as Error).message}`,
        },
      };
      return JSON.stringify(parseError);
    }

    // Ignore notifications without id
    const isNotification = request.id === undefined || request.id === null;

    try {
      const result = await this.dispatch(request.method, request.params);
      if (isNotification) {
        return null;
      }
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: request.id ?? null,
        result,
      };
      return JSON.stringify(response);
    } catch (err) {
      if (isNotification) {
        return null;
      }
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: request.id ?? null,
        error: {
          code: -32603,
          message: (err as Error).message,
        },
      };
      return JSON.stringify(response);
    }
  }

  /**
   * Dispatches incoming JSON-RPC methods.
   */
  private async dispatch(method: string, params?: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'althistory-mcp',
            version: '1.0.0',
          },
        };

      case 'notifications/initialized':
        return {};

      case 'ping':
        return {};

      case 'tools/list':
        return {
          tools: MCP_TOOLS,
        };

      case 'tools/call':
        return this.callTool(params);

      default:
        throw new Error(`Method not found: ${method}`);
    }
  }

  /**
   * Executes an MCP tool call against the engine.
   */
  private async callTool(params?: Record<string, unknown>): Promise<unknown> {
    const name = String(params?.name || '');
    const args = (params?.arguments as Record<string, unknown> | undefined) || {};

    try {
      let toolOutput: unknown;

      switch (name) {
        case 'althistory_list_graphs': {
          toolOutput = await this.engine.listGraphs();
          break;
        }

        case 'althistory_create_event': {
          toolOutput = await this.engine.createEvent(String(args.graphId), {
            description: String(args.description),
            timestamp: String(args.timestamp),
            actor: args.actor ? String(args.actor) : undefined,
            target: args.target ? String(args.target) : undefined,
          });
          break;
        }

        case 'althistory_ingest_text': {
          const validModes = ['pattern', 'llm', 'hybrid'] as const;
          const mode = typeof args.mode === 'string' && (validModes as readonly string[]).includes(args.mode)
            ? (args.mode as 'pattern' | 'llm' | 'hybrid')
            : 'hybrid';

          toolOutput = await this.engine.ingestText(
            args.graphId ? String(args.graphId) : undefined,
            String(args.text),
            {
              mode,
              groupArcs: args.groupArcs !== false,
              inferCauses: args.inferCauses !== false,
              dryRun: Boolean(args.dryRun),
            }
          );
          break;
        }

        case 'althistory_generate_timeline': {
          toolOutput = await this.engine.generateTimeline({
            premise: String(args.premise),
            divergencePoint: String(args.divergencePoint),
            startDate: args.startDate ? String(args.startDate) : undefined,
            endDate: args.endDate ? String(args.endDate) : undefined,
            eventCount: typeof args.eventCount === 'number' ? args.eventCount : undefined,
            style: args.style as 'academic' | 'narrative' | 'concise' | undefined,
            dryRun: Boolean(args.dryRun),
          });
          break;
        }

        case 'althistory_branch_timeline': {
          toolOutput = await this.engine.generateBranch({
            sourceGraphId: String(args.sourceGraphId),
            divergeAtEventId: String(args.divergeAtEventId),
            counterfactualPrompt: String(args.counterfactualPrompt),
            branchName: String(args.branchName),
            eventCount: typeof args.eventCount === 'number' ? args.eventCount : undefined,
            dryRun: Boolean(args.dryRun),
          });
          break;
        }

        case 'althistory_query_causal_path': {
          toolOutput = await this.engine.findCausalPaths(
            String(args.graphId),
            String(args.fromEventId),
            String(args.toEventId)
          );
          break;
        }

        case 'althistory_validate_graph': {
          toolOutput = await this.engine.validateGraph(
            String(args.graphId),
            Boolean(args.strict),
            Boolean(args.autoRepair)
          );
          break;
        }

        case 'althistory_export_context': {
          const validFormats = ['markdown', 'json', 'dot'] as const;
          const format = typeof args.format === 'string' && (validFormats as readonly string[]).includes(args.format)
            ? (args.format as 'markdown' | 'json' | 'dot')
            : 'markdown';

          const exported = await this.engine.exportGraph(String(args.graphId), format);
          toolOutput = exported.content;
          break;
        }

        default:
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Unknown tool: ${name}`,
              },
            ],
          };
      }

      return {
        content: [
          {
            type: 'text',
            text: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: (err as Error).message,
          },
        ],
      };
    }
  }

  /**
   * Starts listening on stdio.
   */
  start(
    input: NodeJS.ReadableStream = process.stdin,
    output: NodeJS.WritableStream = process.stdout
  ): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.rl = readline.createInterface({
      input,
      terminal: false,
    });

    this.rl.on('line', async (line) => {
      const response = await this.handleMessage(line);
      if (response) {
        output.write(response + '\n');
      }
    });

    this.rl.on('close', () => {
      this.isRunning = false;
    });
  }

  /**
   * Stops the stdio listener.
   */
  stop(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }
    this.isRunning = false;
  }
}
