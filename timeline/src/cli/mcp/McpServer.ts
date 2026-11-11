import * as readline from 'readline';
import { IEngine } from '../engine/IEngine';
import { MCP_TOOLS } from './toolDefinitions';
import { MCP_PROMPTS, renderPrompt } from './prompts';
import { isSimulationDomain } from '@/services/SimulationService';
import { calendarFrom, partialCalendarFrom } from '../utils/calendarOptions';
import { ValidationErrorCLI } from '../utils/exitCodes';

const CAUSAL_LINK_TYPES = ['direct', 'indirect', 'contributory'] as const;

/** An optional text argument: absent, or a string. */
function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

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
  /** Requests still being answered; the input can close before they finish. */
  private readonly inFlight = new Set<Promise<void>>();

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
          // A request the server understood but whose parameters are wrong
          // (an unknown prompt, a missing argument) is the caller's to fix.
          code: err instanceof ValidationErrorCLI ? -32602 : -32603,
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
            prompts: {},
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

      case 'prompts/list':
        return {
          prompts: MCP_PROMPTS,
        };

      case 'prompts/get': {
        const name = String(params?.name ?? '');
        const args = (params?.arguments as Record<string, unknown> | undefined) || {};
        const prompt = renderPrompt(name, args);
        return {
          description: prompt.description,
          messages: [{ role: 'user', content: { type: 'text', text: prompt.text } }],
        };
      }

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
      // A required argument that is missing would otherwise reach the engine
      // as the text "undefined".
      const definition = MCP_TOOLS.find((tool) => tool.name === name);
      const missing = (definition?.inputSchema.required ?? []).filter(
        (key) => args[key] === undefined || args[key] === null || args[key] === ''
      );
      if (missing.length > 0) {
        throw new Error(`${name} needs ${missing.map((key) => `"${key}"`).join(', ')}`);
      }

      let toolOutput: unknown;

      switch (name) {
        case 'althistory_list_graphs': {
          toolOutput = await this.engine.listGraphs();
          break;
        }

        case 'althistory_create_graph': {
          toolOutput = await this.engine.createGraph(
            String(args.name),
            optionalString(args.description),
            calendarFrom(args)
          );
          break;
        }

        case 'althistory_set_calendar': {
          const calendar = calendarFrom(args);
          if (args.clear === true && calendar) {
            throw new Error('Give either clear or a calendar, not both');
          }
          if (args.clear !== true && !calendar) {
            throw new Error('Give epochYear (with eraLabel and calendarName if wanted), or clear: true');
          }
          toolOutput = await this.engine.setGraphCalendar(String(args.graphId), calendar ?? null);
          break;
        }

        case 'althistory_create_event': {
          const graphId = String(args.graphId);
          const arcId = optionalString(args.arcId);
          let event = await this.engine.createEvent(graphId, {
            description: String(args.description),
            timestamp: String(args.timestamp),
            actor: optionalString(args.actor),
            target: optionalString(args.target),
          });
          if (arcId) {
            try {
              event = await this.engine.assignEventToArc(graphId, event.id, arcId);
            } catch (err) {
              // The event exists; say so, so the agent does not create it twice.
              throw new Error(
                `Created event ${event.id}, but could not put it in arc ${arcId}: ${(err as Error).message}`
              );
            }
          }
          toolOutput = event;
          break;
        }

        case 'althistory_create_arc': {
          toolOutput = await this.engine.createArc(String(args.graphId), {
            name: String(args.name),
            startTime: String(args.startTime),
            endTime: String(args.endTime),
            description: optionalString(args.description),
            parentArcId: optionalString(args.parentArcId),
          });
          break;
        }

        case 'althistory_assign_to_arc': {
          toolOutput = await this.engine.assignEventToArc(
            String(args.graphId),
            String(args.eventId),
            String(args.arcId)
          );
          break;
        }

        case 'althistory_link_events': {
          const type = args.type === undefined ? 'direct' : args.type;
          if (typeof type !== 'string' || !(CAUSAL_LINK_TYPES as readonly string[]).includes(type)) {
            throw new Error(`type must be one of ${CAUSAL_LINK_TYPES.join(', ')}`);
          }
          if (
            args.weight !== undefined &&
            (typeof args.weight !== 'number' || !Number.isFinite(args.weight) || args.weight < 0 || args.weight > 1)
          ) {
            throw new Error('weight must be a number from 0 to 1');
          }
          toolOutput = await this.engine.createCausalLink(String(args.graphId), {
            causeId: String(args.causeId),
            effectId: String(args.effectId),
            type,
            weight: typeof args.weight === 'number' ? args.weight : undefined,
            reasoning: optionalString(args.reasoning),
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
            premise: optionalString(args.premise),
            divergencePoint: optionalString(args.divergencePoint),
            world: optionalString(args.world),
            calendar: partialCalendarFrom(args),
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

        case 'althistory_simulate_timeline': {
          const domain = isSimulationDomain(args.domain) ? args.domain : undefined;
          toolOutput = await this.engine.generateSimulate({
            graphId: String(args.graphId),
            steps: typeof args.steps === 'number' ? args.steps : undefined,
            timeAdvanceMonths:
              typeof args.timeAdvanceMonths === 'number' ? args.timeAdvanceMonths : undefined,
            anchorEventId: args.anchorEventId ? String(args.anchorEventId) : undefined,
            domain,
            aggressiveness:
              typeof args.aggressiveness === 'number' ? args.aggressiveness : undefined,
            seedContext: args.seedContext ? String(args.seedContext) : undefined,
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

    this.rl.on('line', (line) => {
      const handled = this.handleMessage(line).then((response) => {
        if (response) {
          output.write(response + '\n');
        }
      });
      this.inFlight.add(handled);
      void handled.finally(() => this.inFlight.delete(handled));
    });

    this.rl.on('close', () => {
      this.isRunning = false;
    });
  }

  /**
   * Resolves once every request received so far has been answered. A client
   * that writes its requests and closes its end of the pipe still gets every
   * answer, because the caller waits for this before shutting the engine down.
   */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
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
