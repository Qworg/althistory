import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Event, Arc } from '@/models';
import { ExportFormat, ExportResultDto } from '../types';

/** The formats an export can be rendered in. */
export type { ExportFormat };

export interface ExportRelationship {
  id: string;
  cause_event_id: string;
  effect_event_id: string;
  weight: number;
  confidence: number;
  evidence: string;
  relationship_type: string;
}

export class GraphExporter {
  async export(
    graphId: string,
    graphName: string,
    description: string | undefined,
    events: Event[],
    arcs: Arc[],
    relationships: ExportRelationship[],
    format: ExportFormat = 'json',
    outputPath?: string
  ): Promise<ExportResultDto> {
    let content = '';

    switch (format) {
      case 'json':
        content = this.generateJson(graphId, graphName, description, events, arcs, relationships);
        break;
      case 'markdown':
        content = this.generateMarkdown(graphId, graphName, description, events, arcs, relationships);
        break;
      case 'dot':
        content = this.generateDot(graphId, graphName, events, arcs, relationships);
        break;
      case 'graphml':
        content = this.generateGraphML(graphId, graphName, events, arcs, relationships);
        break;
      default:
        content = this.generateJson(graphId, graphName, description, events, arcs, relationships);
        break;
    }

    let bytesWritten: number | undefined;

    if (outputPath) {
      const resolvedPath = path.resolve(outputPath);
      await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.promises.writeFile(resolvedPath, content, 'utf8');
      bytesWritten = Buffer.byteLength(content, 'utf8');
    }

    return {
      graphId,
      format,
      content,
      outputPath: outputPath ? path.resolve(outputPath) : undefined,
      bytesWritten,
    };
  }

  generateJson(
    graphId: string,
    graphName: string,
    description: string | undefined,
    events: Event[],
    arcs: Arc[],
    relationships: ExportRelationship[]
  ): string {
    const dataSection = {
      events: events.map((e) => ({
        id: e.id,
        description: e.description,
        actor: e.actor,
        target: e.target,
        timestamp: e.timestamp.toISOString(),
        metadata: e.metadata,
      })),
      arcs: arcs.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description || '',
        start_time: a.start_time.toISOString(),
        end_time: a.end_time.toISOString(),
        level: a.level,
        metadata: a.metadata,
      })),
      causalRelationships: relationships.map((r) => ({
        id: r.id,
        cause_event_id: r.cause_event_id,
        effect_event_id: r.effect_event_id,
        weight: r.weight,
        confidence: r.confidence,
        evidence: r.evidence,
        relationship_type: r.relationship_type,
      })),
      inferredPressures: [],
    };

    const checksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(dataSection))
      .digest('hex');

    const exportPayload = {
      version: '1.0',
      metadata: {
        graphId,
        graphName: graphName || graphId,
        description: description || '',
        exportedAt: new Date().toISOString(),
        sourceVersion: '1.0.0',
        graphVersion: 1,
        checksum,
        stats: {
          events: events.length,
          arcs: arcs.length,
          relationships: relationships.length,
        },
      },
      data: dataSection,
    };

    return JSON.stringify(exportPayload, null, 2);
  }

  generateMarkdown(
    graphId: string,
    graphName: string,
    description: string | undefined,
    events: Event[],
    arcs: Arc[],
    relationships: ExportRelationship[]
  ): string {
    const sortedEvents = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const sortedArcs = [...arcs].sort((a, b) => a.start_time.getTime() - b.start_time.getTime());
    const eventMap = new Map<string, Event>(events.map((e) => [e.id, e]));

    let md = `# Timeline Context: ${graphName || graphId}\n\n`;
    md += `> **Graph ID:** \`${graphId}\` | **Exported:** ${new Date().toISOString()} | **Events:** ${events.length} | **Arcs:** ${arcs.length} | **Causal Links:** ${relationships.length}\n\n`;

    if (description) {
      md += `### Description\n${description}\n\n`;
    }

    if (sortedArcs.length > 0) {
      md += `## Narrative Arcs\n`;
      md += `| Arc ID | Name | Time Window | Level | Description |\n`;
      md += `|:---|:---|:---|:---|:---|\n`;
      for (const a of sortedArcs) {
        const start = a.start_time.toISOString().split('T')[0];
        const end = a.end_time.toISOString().split('T')[0];
        md += `| \`${a.id}\` | **${a.name}** | ${start} to ${end} | ${a.level} | ${a.description || '-'} |\n`;
      }
      md += `\n`;
    }

    md += `## Chronological Events\n`;
    md += `| Date | Event ID | Actor | Target | Description | Causes |\n`;
    md += `|:---|:---|:---|:---|:---|:---|\n`;

    for (const e of sortedEvents) {
      const dateStr = e.timestamp.toISOString().split('T')[0];
      const causes = relationships
        .filter((r) => r.cause_event_id === e.id)
        .map((r) => `\`${r.effect_event_id}\` (${r.relationship_type})`)
        .join(', ');
      md += `| ${dateStr} | \`${e.id}\` | ${e.actor} | ${e.target} | ${e.description} | ${causes || '-'} |\n`;
    }
    md += `\n`;

    if (relationships.length > 0) {
      md += `## Causal Link Details\n`;
      for (const r of relationships) {
        const cause = eventMap.get(r.cause_event_id);
        const effect = eventMap.get(r.effect_event_id);
        const causeName = cause ? cause.description : r.cause_event_id;
        const effectName = effect ? effect.description : r.effect_event_id;
        md += `- **\`${r.cause_event_id}\`** ("${causeName}") ➔ **\`${r.effect_event_id}\`** ("${effectName}")\n`;
        md += `  - *Type:* ${r.relationship_type} | *Weight:* ${r.weight} | *Confidence:* ${r.confidence}\n`;
        if (r.evidence) {
          md += `  - *Evidence:* "${r.evidence}"\n`;
        }
      }
      md += `\n`;
    }

    return md;
  }

  /**
   * Render the graph as GraphML.
   *
   * GraphML is the interchange format the graph editors read, so the events
   * and the arcs are both nodes: an arc is a node that contains the events
   * whose `arcId` metadata names it, and the causal links are the edges
   * between the event nodes.
   */
  generateGraphML(
    graphId: string,
    graphName: string,
    events: Event[],
    arcs: Arc[],
    relationships: ExportRelationship[]
  ): string {
    const escapeXml = (value: string): string =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns">');
    lines.push('  <key id="d_kind" for="node" attr.name="kind" attr.type="string"/>');
    lines.push('  <key id="d_description" for="node" attr.name="description" attr.type="string"/>');
    lines.push('  <key id="d_actor" for="node" attr.name="actor" attr.type="string"/>');
    lines.push('  <key id="d_target" for="node" attr.name="target" attr.type="string"/>');
    lines.push('  <key id="d_timestamp" for="node" attr.name="timestamp" attr.type="string"/>');
    lines.push('  <key id="d_start" for="node" attr.name="start_time" attr.type="string"/>');
    lines.push('  <key id="d_end" for="node" attr.name="end_time" attr.type="string"/>');
    lines.push('  <key id="d_weight" for="edge" attr.name="weight" attr.type="double"/>');
    lines.push('  <key id="d_type" for="edge" attr.name="relationship_type" attr.type="string"/>');
    lines.push('  <key id="d_reasoning" for="edge" attr.name="reasoning" attr.type="string"/>');
    lines.push(`  <graph id="${escapeXml(graphId)}" edgedefault="directed">`);
    lines.push(`    <data key="d_kind">graph</data>`);
    lines.push(`    <data key="d_description">${escapeXml(graphName || graphId)}</data>`);

    for (const arc of arcs) {
      lines.push(`    <node id="${escapeXml(arc.id)}">`);
      lines.push(`      <data key="d_kind">arc</data>`);
      lines.push(`      <data key="d_description">${escapeXml(arc.name)}</data>`);
      lines.push(`      <data key="d_start">${escapeXml(arc.start_time.toISOString())}</data>`);
      lines.push(`      <data key="d_end">${escapeXml(arc.end_time.toISOString())}</data>`);
      lines.push('    </node>');
    }

    for (const e of events) {
      lines.push(`    <node id="${escapeXml(e.id)}">`);
      lines.push('      <data key="d_kind">event</data>');
      lines.push(`      <data key="d_description">${escapeXml(e.description)}</data>`);
      lines.push(`      <data key="d_actor">${escapeXml(e.actor)}</data>`);
      lines.push(`      <data key="d_target">${escapeXml(e.target)}</data>`);
      lines.push(`      <data key="d_timestamp">${escapeXml(e.timestamp.toISOString())}</data>`);
      lines.push('    </node>');
    }

    for (const e of events) {
      const arcId = (e.metadata?.arcId || e.metadata?.arc_id) as string | undefined;
      if (!arcId) continue;
      if (!arcs.some((a) => a.id === arcId)) continue;
      lines.push(`    <edge source="${escapeXml(arcId)}" target="${escapeXml(e.id)}">`);
      lines.push('      <data key="d_type">contains</data>');
      lines.push('    </edge>');
    }

    for (const r of relationships) {
      lines.push(`    <edge source="${escapeXml(r.cause_event_id)}" target="${escapeXml(r.effect_event_id)}">`);
      lines.push(`      <data key="d_weight">${r.weight}</data>`);
      lines.push(`      <data key="d_type">${escapeXml(r.relationship_type)}</data>`);
      if (r.evidence) {
        lines.push(`      <data key="d_reasoning">${escapeXml(r.evidence)}</data>`);
      }
      lines.push('    </edge>');
    }

    lines.push('  </graph>');
    lines.push('</graphml>');
    return lines.join('\n') + '\n';
  }

  generateDot(
    graphId: string,
    graphName: string,
    events: Event[],
    arcs: Arc[],
    relationships: ExportRelationship[]
  ): string {
    const sanitizeLabel = (str: string): string =>
      str.replace(/"/g, '\\"').replace(/\n/g, ' ');

    let dot = `digraph "${sanitizeLabel(graphName || graphId)}" {\n`;
    dot += `  rankdir=LR;\n`;
    dot += `  compound=true;\n`;
    dot += `  node [shape=box, style="rounded,filled", fillcolor="#f8f9fa", color="#343a40", fontname="Helvetica", fontsize=10];\n`;
    dot += `  edge [color="#495057", fontname="Helvetica", fontsize=9];\n\n`;

    // Group events into subgraphs by arc if events declare arcId
    const arcEventsMap = new Map<string, Event[]>();
    const unclusteredEvents: Event[] = [];

    for (const e of events) {
      const arcId = (e.metadata?.arcId || e.metadata?.arc_id) as string | undefined;
      if (arcId) {
        const list = arcEventsMap.get(arcId) || [];
        list.push(e);
        arcEventsMap.set(arcId, list);
      } else {
        unclusteredEvents.push(e);
      }
    }

    for (const a of arcs) {
      const clustered = arcEventsMap.get(a.id) || [];
      dot += `  subgraph "cluster_${a.id}" {\n`;
      dot += `    label="${sanitizeLabel(a.name)}";\n`;
      dot += `    style="filled";\n`;
      dot += `    fillcolor="#e9ecef";\n`;
      dot += `    color="#adb5bd";\n`;
      for (const e of clustered) {
        const dateStr = e.timestamp.toISOString().split('T')[0];
        dot += `    "${e.id}" [label="${dateStr}\\n${sanitizeLabel(e.description)}\\n[${sanitizeLabel(e.actor)}]"];\n`;
      }
      dot += `  }\n\n`;
    }

    for (const e of unclusteredEvents) {
      const dateStr = e.timestamp.toISOString().split('T')[0];
      dot += `  "${e.id}" [label="${dateStr}\\n${sanitizeLabel(e.description)}\\n[${sanitizeLabel(e.actor)}]"];\n`;
    }

    dot += `\n`;
    for (const r of relationships) {
      dot += `  "${r.cause_event_id}" -> "${r.effect_event_id}" [label="${r.relationship_type} (${r.weight})"];\n`;
    }

    dot += `}\n`;
    return dot;
  }
}
