import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfig } from './config';

/**
 * A value the local store persists in a property bag or receives as a Cypher
 * parameter.
 *
 * The store round-trips the whole graph through JSON, so this union describes
 * exactly what survives a save/load cycle: scalars, `Date` (serialised as an ISO
 * string on write), and nested arrays/objects built from the same values.
 */
export type GraphPropertyValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | GraphPropertyValue[]
  | { [key: string]: GraphPropertyValue };

/**
 * Property bag attached to a node or a relationship
 */
export type GraphProperties = Record<string, GraphPropertyValue>;

/**
 * Named parameter values bound to a Cypher query
 */
export type GraphParameters = GraphProperties;

/**
 * Local graph node representation
 */
export interface GraphNode {
  id: string;
  labels: string[];
  properties: GraphProperties;
}

/**
 * Local graph relationship representation
 */
export interface GraphRelationship {
  id: string;
  type: string;
  startNodeId: string;
  endNodeId: string;
  properties: GraphProperties;
}

/**
 * Local graph store data structure
 */
export interface GraphData {
  nodes: Map<string, GraphNode>;
  relationships: Map<string, GraphRelationship>;
  nodesByLabel: Map<string, Set<string>>;
  relationshipsByType: Map<string, Set<string>>;
  backups: GraphBackup[];
}

/**
 * Graph backup representation
 */
export interface GraphBackup {
  timestamp: Date;
  filename: string;
  size: number;
}

/**
 * A value a query record can hold: a whole node, a whole relationship, or one
 * of the scalar/nested property values above.
 */
export type LocalRecordValue = GraphNode | GraphRelationship | GraphPropertyValue;

/**
 * Query result similar to Neo4j Record
 */
export interface LocalQueryRecord {
  keys: string[];
  get(key: string): LocalRecordValue | undefined;
  get(index: number): LocalRecordValue | undefined;
  has(key: string): boolean;
  values: LocalRecordValue[];
}

/**
 * Query result similar to Neo4j Result
 */
export interface LocalQueryResult {
  records: LocalQueryRecord[];
  summary: {
    query: string;
    parameters: GraphParameters;
    counters: {
      nodesCreated: number;
      relationshipsCreated: number;
      nodesDeleted: number;
      relationshipsDeleted: number;
      propertiesSet: number;
    };
  };
}

/**
 * Basic Cypher query parser for local execution
 */
export class CypherQueryParser {
  /**
   * Parse and execute a simple Cypher query
   */
  static execute(query: string, parameters: GraphParameters, graphData: GraphData): LocalQueryResult {
    const trimmedQuery = query.trim();

    // Handle CREATE queries
    if (trimmedQuery.startsWith('CREATE')) {
      return this.executeCreate(trimmedQuery, parameters, graphData);
    }

    // Handle DELETE queries (must check before MATCH since pattern is MATCH...DELETE)
    if (trimmedQuery.includes('DELETE') || trimmedQuery.includes('DETACH DELETE')) {
      return this.executeDelete(trimmedQuery, parameters, graphData);
    }

    // Handle SET queries (UPDATE)
    if (trimmedQuery.includes('SET')) {
      return this.executeSet(trimmedQuery, parameters, graphData);
    }

    // Handle MATCH queries
    if (trimmedQuery.startsWith('MATCH')) {
      return this.executeMatch(trimmedQuery, parameters, graphData);
    }

    throw new Error(`Unsupported query type: ${query}`);
  }

  private static executeCreate(query: string, parameters: GraphParameters, graphData: GraphData): LocalQueryResult {
    const counters = { nodesCreated: 0, relationshipsCreated: 0, nodesDeleted: 0, relationshipsDeleted: 0, propertiesSet: 0 };
    const records: LocalQueryRecord[] = [];
    
    // Parse CREATE node pattern: CREATE (n:Label { props })
    const nodePattern = /CREATE\s*\((\w+):(\w+)\s*\{([^}]+)\}\)/i;
    const nodeMatch = query.match(nodePattern);
    
    if (nodeMatch) {
      const [, variable, label, propsStr] = nodeMatch;
      const props = this.parseProperties(propsStr, parameters);
      
      const node: GraphNode = {
        // Only a string id can address a node; anything else falls back to a
        // generated id, as a non-string id could never be looked up again.
        id: typeof props.id === 'string' ? props.id : this.generateId(),
        labels: [label],
        properties: props
      };
      
      graphData.nodes.set(node.id, node);
      
      if (!graphData.nodesByLabel.has(label)) {
        graphData.nodesByLabel.set(label, new Set());
      }
      graphData.nodesByLabel.get(label)!.add(node.id);
      
      counters.nodesCreated = 1;
      counters.propertiesSet = Object.keys(props).length;
      
      // Create return record if RETURN clause exists
      if (query.includes('RETURN')) {
        const record = this.createRecord([variable], [node]);
        records.push(record);
      }
    }
    
    // Parse CREATE relationship pattern: CREATE (a)-[:TYPE { props }]->(b)
    const relPattern = /CREATE\s*\((\w+)\)-\[:(\w+)(?:\s*\{([^}]+)\})?\]->\((\w+)\)/i;
    const relMatch = query.match(relPattern);
    
    if (relMatch) {
      const [, startVar, type, propsStr, endVar] = relMatch;
      const props = propsStr ? this.parseProperties(propsStr, parameters) : {};

      // For relationship creation, we need to find the nodes first
      // This is a simplified implementation
      const startId = parameters[`${startVar}_id`];
      const endId = parameters[`${endVar}_id`];
      const relationship: GraphRelationship = {
        id: this.generateId(),
        type,
        startNodeId: typeof startId === 'string' ? startId : startVar,
        endNodeId: typeof endId === 'string' ? endId : endVar,
        properties: props
      };
      
      graphData.relationships.set(relationship.id, relationship);
      
      if (!graphData.relationshipsByType.has(type)) {
        graphData.relationshipsByType.set(type, new Set());
      }
      graphData.relationshipsByType.get(type)!.add(relationship.id);
      
      counters.relationshipsCreated = 1;
      counters.propertiesSet += Object.keys(props).length;
    }
    
    return {
      records,
      summary: {
        query,
        parameters,
        counters
      }
    };
  }

  private static executeMatch(query: string, parameters: GraphParameters, graphData: GraphData): LocalQueryResult {
    const records: LocalQueryRecord[] = [];
    const counters = { nodesCreated: 0, relationshipsCreated: 0, nodesDeleted: 0, relationshipsDeleted: 0, propertiesSet: 0 };

    // Remove single-line comments (// ...) before normalizing
    const queryWithoutComments = query.replace(/\/\/[^\n]*/g, '');

    // Normalize query: replace newlines and multiple spaces with single space
    const normalizedQuery = queryWithoutComments.replace(/\s+/g, ' ').trim();

    // Two correlated patterns (MATCH (a:Label { .. }) MATCH (b:Label) WHERE
    // b.x >= a.x ...) are handled separately; they do not fit the single-pattern
    // regexes below.
    const correlatedResult = this.executeCorrelatedMatch(normalizedQuery, parameters, graphData);
    if (correlatedResult) {
      return correlatedResult;
    }

    // Parse MATCH patterns - supports:
    // 1. MATCH (n:Label) WHERE conditions RETURN fields ORDER BY ... SKIP ... LIMIT ...
    // 2. MATCH (n:Label { props }) RETURN fields ORDER BY ... SKIP ... LIMIT ...
    // Updated patterns to capture full RETURN clause including aliases
    const matchWithPropsPattern = /MATCH\s*\((\w+):(\w+)\s*\{([^}]+)\}\)\s*RETURN\s+(.+?)(?:\s+ORDER\s+BY|\s+SKIP|\s+LIMIT|$)/i;
    const matchWithWherePattern = /MATCH\s*\((\w+):(\w+)\)(?:\s*WHERE\s+(.+?))?\s*RETURN\s+(.+?)(?:\s+ORDER\s+BY|\s+SKIP|\s+LIMIT|$)/i;

    let match = normalizedQuery.match(matchWithPropsPattern);
    let usePropsFilter = false;

    if (match) {
      usePropsFilter = true;
    } else {
      match = normalizedQuery.match(matchWithWherePattern);
    }

    if (match) {
      const [, variable, label, filterClause, returnClause] = match;

      // Get nodes with matching label
      const nodeIds = graphData.nodesByLabel.get(label) || new Set();
      let matchingNodes: GraphNode[] = [];

      for (const nodeId of nodeIds) {
        const node = graphData.nodes.get(nodeId);
        if (node) {
          // Apply filtering based on pattern type
          if (usePropsFilter) {
            // MATCH (n:Label { props }) - use property matching
            const props = this.parseProperties(filterClause, parameters);
            if (this.nodeMatchesProperties(node, props)) {
              matchingNodes.push(node);
            }
          } else {
            // MATCH (n:Label) WHERE condition - use WHERE clause
            if (!filterClause || this.evaluateWhereClause(filterClause, node.properties, parameters)) {
              matchingNodes.push(node);
            }
          }
        }
      }

      // Apply ORDER BY if present
      const orderByMatch = normalizedQuery.match(/ORDER\s+BY\s+(\w+)\.(\w+)(?:\s+(ASC|DESC))?/i);
      if (orderByMatch) {
        const [, , orderProperty, direction] = orderByMatch;
        const isDesc = direction?.toUpperCase() === 'DESC';
        matchingNodes.sort((a, b) => {
          const aVal = a.properties[orderProperty];
          const bVal = b.properties[orderProperty];
          if (aVal === bVal) {
            return 0;
          }
          // compareOrder returns null for values that are not ordered against
          // each other (NaN), which sorts as "equal" just as `<`/`>` did.
          const order = this.compareOrder(aVal, bVal);
          if (order === null || order === 0) {
            return 0;
          }
          return isDesc ? -order : order;
        });
      }

      // Apply SKIP if present (handle both literal and parameterized)
      const skipMatch = normalizedQuery.match(/SKIP\s+(\$?\w+)/i);
      if (skipMatch) {
        const skipValue = skipMatch[1];
        const skip = skipValue.startsWith('$')
          ? this.toIntegerParameter(parameters[skipValue.substring(1)])
          : parseInt(skipValue);
        if (!isNaN(skip) && skip > 0) {
          matchingNodes = matchingNodes.slice(skip);
        }
      }

      // Apply LIMIT if present (handle both literal and parameterized)
      const limitMatch = normalizedQuery.match(/LIMIT\s+(\$?\w+)/i);
      if (limitMatch) {
        const limitValue = limitMatch[1];
        const limit = limitValue.startsWith('$')
          ? this.toIntegerParameter(parameters[limitValue.substring(1)])
          : parseInt(limitValue);
        if (!isNaN(limit) && limit > 0) {
          matchingNodes = matchingNodes.slice(0, limit);
        }
      }

      // Create records based on RETURN clause
      if (returnClause) {
        // Check for count() function in return clause
        const countMatch = normalizedQuery.match(/RETURN\s+count\((\w+)\)(?:\s*>\s*(\d+))?\s+as\s+(\w+)/i);
        if (countMatch) {
          const [, , comparison, alias] = countMatch;
          if (comparison !== undefined) {
            // Handle count(n) > X as alias (returns boolean)
            const comparisonValue = parseInt(comparison);
            const result = matchingNodes.length > comparisonValue;
            records.push(this.createRecord([alias], [result]));
          } else {
            // Handle count(n) as alias (returns number)
            records.push(this.createRecord([alias], [matchingNodes.length]));
          }
        } else {
          // Regular field returns - parse fields with optional aliases
          // Supports: variable, variable.property, variable.property as alias
          const returnFields = returnClause.split(',').map(f => f.trim());

          for (const node of matchingNodes) {
            const values: LocalRecordValue[] = [];
            const keys: string[] = [];

            for (const field of returnFields) {
              // Check for "field as alias" pattern
              const aliasMatch = field.match(/^(.+?)\s+as\s+(\w+)$/i);
              let fieldName: string;
              let keyName: string;

              if (aliasMatch) {
                fieldName = aliasMatch[1].trim();
                keyName = aliasMatch[2];
              } else {
                fieldName = field;
                keyName = field;
              }

              if (fieldName === variable) {
                values.push(node);
                keys.push(keyName);
              } else if (fieldName.startsWith(`${variable}.`)) {
                const property = fieldName.substring(variable.length + 1);
                values.push(node.properties[property]);
                keys.push(keyName);
              }
            }

            records.push(this.createRecord(keys, values));
          }
        }
      }
    }

    return {
      records,
      summary: {
        query,
        parameters,
        counters
      }
    };
  }

  /**
   * Execute `MATCH (a:Label { .. }) MATCH (b:Label) [WHERE ..] RETURN b [ORDER BY ..] [SKIP ..] [LIMIT ..]`.
   *
   * Repositories derive relations that Cypher expresses by correlating two node
   * patterns — ArcRepository.findDirectChildren and findParentArcs bound a
   * parent arc by id and then correlated every other arc against it by time
   * range and level. The single-pattern matcher below cannot express that, so
   * these queries silently produced no rows in local execution mode.
   *
   * Returns null when the query is not this shape, leaving the caller to fall
   * back to the single-pattern matcher.
   */
  private static executeCorrelatedMatch(
    query: string,
    parameters: GraphParameters,
    graphData: GraphData
  ): LocalQueryResult | null {
    const head = query.match(
      /^MATCH\s*\((\w+):(\w+)\s*\{([^}]+)\}\)\s*MATCH\s*\((\w+):(\w+)\)/i
    );
    if (!head) {
      return null;
    }

    const [, outerVar, outerLabel, propsStr, innerVar, innerLabel] = head;
    const remainder = query.slice(head[0].length);
    const returnIndex = remainder.search(/\bRETURN\b/i);
    if (returnIndex < 0) {
      return null;
    }

    const whereClause = remainder.slice(0, returnIndex).match(/\bWHERE\s+([\s\S]+)$/i);
    const returnTail = remainder.slice(returnIndex).replace(/^\bRETURN\b/i, '').trim();

    // ORDER BY / SKIP / LIMIT trail the RETURN clause; strip them off in the
    // same order the single-pattern matcher applies them (sort, then skip,
    // then limit).
    let returnClause = returnTail;
    let orderByProperty: string | undefined;
    let orderByDescending = false;
    let skip: number | undefined;
    let limit: number | undefined;

    const orderMatch = returnClause.match(/\s*ORDER\s+BY\s+\w+\.(\w+)(?:\s+(ASC|DESC))?\s*$/i);
    if (orderMatch) {
      orderByProperty = orderMatch[1];
      orderByDescending = orderMatch[2]?.toUpperCase() === 'DESC';
      returnClause = returnClause.slice(0, orderMatch.index);
    }

    const limitMatch = returnClause.match(/\s*LIMIT\s+(\$?\w+)\s*$/i);
    if (limitMatch) {
      limit = this.toIntegerParameter(
        limitMatch[1].startsWith('$') ? parameters[limitMatch[1].substring(1)] : parseInt(limitMatch[1])
      );
      returnClause = returnClause.slice(0, limitMatch.index);
    }

    const skipMatch = returnClause.match(/\s*SKIP\s+(\$?\w+)\s*$/i);
    if (skipMatch) {
      skip = this.toIntegerParameter(
        skipMatch[1].startsWith('$') ? parameters[skipMatch[1].substring(1)] : parseInt(skipMatch[1])
      );
      returnClause = returnClause.slice(0, skipMatch.index);
    }

    returnClause = returnClause.trim();
    if (!returnClause) {
      return null;
    }

    const outerNodes: GraphNode[] = [];
    for (const nodeId of graphData.nodesByLabel.get(outerLabel) || new Set<string>()) {
      const node = graphData.nodes.get(nodeId);
      if (node && this.nodeMatchesProperties(node, this.parseProperties(propsStr, parameters))) {
        outerNodes.push(node);
      }
    }

    const innerNodes: GraphNode[] = [];
    for (const nodeId of graphData.nodesByLabel.get(innerLabel) || new Set<string>()) {
      const node = graphData.nodes.get(nodeId);
      if (node) {
        innerNodes.push(node);
      }
    }

    let bindings: Map<string, GraphNode>[] = [];
    for (const outer of outerNodes) {
      for (const inner of innerNodes) {
        const scope = new Map<string, GraphNode>([
          [outerVar, outer],
          [innerVar, inner]
        ]);
        if (whereClause && !this.evaluateWhereClause(whereClause[1], inner.properties, parameters, scope)) {
          continue;
        }
        bindings.push(scope);
      }
    }

    if (orderByProperty) {
      bindings.sort((a, b) => {
        const order = this.compareOrder(a.get(innerVar)?.properties[orderByProperty], b.get(innerVar)?.properties[orderByProperty]);
        if (order === null || order === 0) {
          return 0;
        }
        return orderByDescending ? -order : order;
      });
    }
    if (skip !== undefined && skip > 0) {
      bindings = bindings.slice(skip);
    }
    if (limit !== undefined && limit > 0) {
      bindings = bindings.slice(0, limit);
    }

    const records: LocalQueryRecord[] = [];
    for (const scope of bindings) {
      const values: LocalRecordValue[] = [];
      const keys: string[] = [];

      for (const field of returnClause.split(',').map(f => f.trim())) {
        const aliasMatch = field.match(/^(.+?)\s+as\s+(\w+)$/i);
        const fieldName = aliasMatch ? aliasMatch[1].trim() : field;
        const keyName = aliasMatch ? aliasMatch[2] : field;
        const [referencedVar, property] = fieldName.split('.');
        const node = scope.get(referencedVar);
        if (!node) {
          continue;
        }
        keys.push(keyName);
        values.push(property ? node.properties[property] : node);
      }

      records.push(this.createRecord(keys, values));
    }

    return {
      records,
      summary: {
        query,
        parameters,
        counters: { nodesCreated: 0, relationshipsCreated: 0, nodesDeleted: 0, relationshipsDeleted: 0, propertiesSet: 0 }
      }
    };
  }

  private static executeSet(query: string, parameters: GraphParameters, graphData: GraphData): LocalQueryResult {
    const counters = { nodesCreated: 0, relationshipsCreated: 0, nodesDeleted: 0, relationshipsDeleted: 0, propertiesSet: 0 };
    const records: LocalQueryRecord[] = [];

    // Normalize query
    const normalizedQuery = query.replace(/\s+/g, ' ').trim();

    // Parse MATCH (n:Label {id: $id}) SET ... RETURN n pattern
    const matchSetPattern = /MATCH\s*\((\w+):(\w+)\s*\{([^}]+)\}\)\s*SET\s+(.+?)\s*RETURN\s+(\w+)/i;
    const match = normalizedQuery.match(matchSetPattern);

    if (match) {
      const [, variable, label, matchPropsStr, setClause, returnVar] = match;
      const matchProps = this.parseProperties(matchPropsStr, parameters);

      // Find the matching node
      const nodeIds = graphData.nodesByLabel.get(label) || new Set();
      let targetNode: GraphNode | null = null;

      for (const nodeId of nodeIds) {
        const node = graphData.nodes.get(nodeId);
        if (node && this.nodeMatchesProperties(node, matchProps)) {
          targetNode = node;
          break;
        }
      }

      if (targetNode) {
        // Parse SET assignments: n.prop1 = $val1, n.prop2 = $val2, ...
        const assignments = setClause.split(',').map(s => s.trim());

        for (const assignment of assignments) {
          // Match: variable.property = value
          const assignMatch = assignment.match(/(\w+)\.(\w+)\s*=\s*(.+)/);
          if (assignMatch) {
            const [, , property, rawValue] = assignMatch;
            let value: GraphPropertyValue;

            // Parse the value
            if (rawValue.startsWith('datetime($')) {
              const paramMatch = rawValue.match(/datetime\(\$(\w+)\)/);
              if (paramMatch) {
                value = parameters[paramMatch[1]];
              }
            } else if (rawValue.startsWith('$')) {
              const paramName = rawValue.substring(1);
              value = parameters[paramName];
            } else if (rawValue === 'null') {
              value = null;
            } else if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
              value = rawValue.slice(1, -1);
            } else if (!isNaN(Number(rawValue))) {
              value = Number(rawValue);
            } else {
              value = rawValue;
            }

            targetNode.properties[property] = value;
            counters.propertiesSet++;
          }
        }

        // Update the node in graphData
        graphData.nodes.set(targetNode.id, targetNode);

        // Create return record
        if (returnVar === variable) {
          records.push(this.createRecord([variable], [targetNode]));
        }
      }
    }

    return {
      records,
      summary: {
        query,
        parameters,
        counters
      }
    };
  }

  private static executeDelete(query: string, parameters: GraphParameters, graphData: GraphData): LocalQueryResult {
    const counters = { nodesCreated: 0, relationshipsCreated: 0, nodesDeleted: 0, relationshipsDeleted: 0, propertiesSet: 0 };

    // Normalize query: replace newlines and multiple spaces with single space
    const normalizedQuery = query.replace(/\s+/g, ' ').trim();

    // Parse MATCH...DELETE pattern
    const deletePattern = /MATCH\s*\((\w+):(\w+)\s*\{([^}]+)\}\)\s*(?:DETACH\s+)?DELETE\s+\1/i;
    const match = normalizedQuery.match(deletePattern);
    
    if (match) {
      const [, , label, propsStr] = match;
      const props = this.parseProperties(propsStr, parameters);
      
      // Find matching nodes
      const nodeIds = graphData.nodesByLabel.get(label) || new Set();
      const nodesToDelete: string[] = [];
      
      for (const nodeId of nodeIds) {
        const node = graphData.nodes.get(nodeId);
        if (node && this.nodeMatchesProperties(node, props)) {
          nodesToDelete.push(nodeId);
        }
      }
      
      // Delete nodes and their relationships
      for (const nodeId of nodesToDelete) {
        // Delete relationships first (DETACH DELETE behavior)
        const relationshipsToDelete: string[] = [];
        for (const [relId, rel] of graphData.relationships) {
          if (rel.startNodeId === nodeId || rel.endNodeId === nodeId) {
            relationshipsToDelete.push(relId);
          }
        }
        
        for (const relId of relationshipsToDelete) {
          const rel = graphData.relationships.get(relId)!;
          graphData.relationships.delete(relId);
          graphData.relationshipsByType.get(rel.type)?.delete(relId);
          counters.relationshipsDeleted++;
        }
        
        // Delete the node
        const node = graphData.nodes.get(nodeId)!;
        graphData.nodes.delete(nodeId);
        for (const label of node.labels) {
          graphData.nodesByLabel.get(label)?.delete(nodeId);
        }
        counters.nodesDeleted++;
      }
    }

    // Check if query returns count
    const countReturnMatch = normalizedQuery.match(/RETURN\s+count\(\w+\)\s+as\s+(\w+)/i);
    const records: LocalQueryRecord[] = [];
    if (countReturnMatch) {
      const alias = countReturnMatch[1];
      records.push(this.createRecord([alias], [counters.nodesDeleted]));
    }

    return {
      records,
      summary: {
        query,
        parameters,
        counters
      }
    };
  }

  private static parseProperties(propsStr: string, parameters: GraphParameters): GraphProperties {
    const props: GraphProperties = {};

    // Simple property parsing: key: $param, key: value, or key: function($param)
    // Matches: $param, 'string', "string", numbers, true/false, datetime($param), etc.
    const propertyPattern = /(\w+):\s*(\$\w+|'[^']*'|"[^"]*"|\d+|true|false|datetime\(\$\w+\)|\{[^}]*\})/g;
    let match;

    while ((match = propertyPattern.exec(propsStr)) !== null) {
      const [, key, value] = match;

      if (value.startsWith('$')) {
        const paramName = value.substring(1);
        props[key] = parameters[paramName];
      } else if (value.startsWith('datetime($')) {
        // Handle Neo4j datetime function: datetime($param) -> extract param value
        const paramMatch = value.match(/datetime\(\$(\w+)\)/);
        if (paramMatch) {
          const paramName = paramMatch[1];
          props[key] = parameters[paramName]; // Store the ISO string directly
        }
      } else if (value.startsWith('"') || value.startsWith("'")) {
        props[key] = value.slice(1, -1);
      } else if (value === 'true' || value === 'false') {
        props[key] = value === 'true';
      } else if (value.startsWith('{')) {
        // Handle object/map values like metadata: $metadata
        // This is a simplification - in practice, this might be a JSON object
        try {
          const parsed: GraphPropertyValue = JSON.parse(value);
          props[key] = parsed;
        } catch {
          props[key] = {};
        }
      } else if (!isNaN(Number(value))) {
        props[key] = Number(value);
      } else {
        props[key] = value;
      }
    }

    return props;
  }

  /**
   * Evaluate a WHERE clause for a single node.
   *
   * `scope` carries the other variables bound by a correlated query
   * (`MATCH (a:Arc {id: $id}) MATCH (b:Arc) WHERE b.x >= a.x`), so that
   * conditions can compare two variables. It is empty for single-pattern
   * queries, where every reference resolves against `properties`.
   */
  private static evaluateWhereClause(
    whereClause: string,
    properties: GraphProperties,
    parameters: GraphParameters,
    scope: Map<string, GraphNode> = new Map()
  ): boolean {
    // Enhanced WHERE clause evaluation supporting complex conditions
    // Supports: AND, OR, NOT, comparison operators, datetime() functions

    // Handle OR conditions by splitting and evaluating each branch
    // Note: This is a simplified implementation that handles common patterns
    const orParts = this.splitByTopLevelOr(whereClause);
    if (orParts.length > 1) {
      return orParts.some(part => this.evaluateWhereClause(part.trim(), properties, parameters, scope));
    }

    // Handle AND conditions
    const andParts = this.splitByTopLevelAnd(whereClause);

    for (const part of andParts) {
      const trimmedPart = part.trim();

      // Skip empty parts
      if (!trimmedPart) continue;

      // Handle NOT conditions: NOT (condition)
      const notMatch = trimmedPart.match(/^NOT\s*\((.+)\)$/i);
      if (notMatch) {
        if (this.evaluateWhereClause(notMatch[1], properties, parameters, scope)) {
          return false;
        }
        continue;
      }

      // Handle parenthesized conditions
      if (trimmedPart.startsWith('(') && trimmedPart.endsWith(')')) {
        if (!this.evaluateWhereClause(trimmedPart.slice(1, -1), properties, parameters, scope)) {
          return false;
        }
        continue;
      }

      // Handle comparison: <variable>.<property> op <value>
      // Supports: =, !=, <>, <, >, <=, >=
      // Value can be: $param, datetime($param), 'string', "string", number, or
      // another variable's property (optionally offset, e.g. `parent.level + 1`)
      const comparisonMatch = trimmedPart.match(/(\w+)\.(\w+)\s*(<>|!=|<=|>=|[=<>])\s*(.+)/);
      if (comparisonMatch) {
        const [, variable, property, operator, rawValue] = comparisonMatch;

        const compareValue = this.parseOperand(rawValue.trim(), parameters, scope);
        const propertyValue = this.normalizePropertyValue(
          scope.get(variable)?.properties[property] ?? properties[property]
        );

        if (!this.compareValues(propertyValue, operator, compareValue)) {
          return false;
        }
        continue;
      }

      // Handle datetime comparison: datetime($param) op n.property
      const datetimeFirstMatch = trimmedPart.match(/datetime\(\$(\w+)\)\s*(<>|!=|<=|>=|[=<>])\s*(\w+)\.(\w+)/);
      if (datetimeFirstMatch) {
        const [, paramName, operator, variable, property] = datetimeFirstMatch;
        const compareValue = this.normalizePropertyValue(parameters[paramName]);
        const propertyValue = this.normalizePropertyValue(
          scope.get(variable)?.properties[property] ?? properties[property]
        );

        if (!this.compareValues(compareValue, operator, propertyValue)) {
          return false;
        }
        continue;
      }
    }

    return true;
  }

  /**
   * Resolve the right-hand side of a WHERE comparison. `$param`, literals and
   * `datetime($param)` come from `parameters`; `other.prop` and
   * `other.prop + n` resolve through the query scope.
   */
  private static parseOperand(
    rawValue: string,
    parameters: GraphParameters,
    scope: Map<string, GraphNode>
  ): GraphPropertyValue {
    const arithmeticMatch = rawValue.match(/^(\w+)\.(\w+)\s*([+-])\s*(\d+(?:\.\d+)?)$/);
    if (arithmeticMatch) {
      const [, variable, property, operator, amount] = arithmeticMatch;
      const bound = scope.get(variable);
      if (bound) {
        const base = Number(this.normalizePropertyValue(bound.properties[property]));
        const offset = Number(amount);
        return operator === '+' ? base + offset : base - offset;
      }
    }

    const referenceMatch = rawValue.match(/^(\w+)\.(\w+)$/);
    if (referenceMatch) {
      const bound = scope.get(referenceMatch[1]);
      if (bound) {
        // Normalize so a stored date string compares against another the same
        // way it does against a `datetime($param)` operand.
        return this.normalizePropertyValue(bound.properties[referenceMatch[2]]);
      }
    }

    return this.parseComparisonValue(rawValue, parameters);
  }

  private static splitByTopLevelOr(clause: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';

    for (let i = 0; i < clause.length; i++) {
      const char = clause[i];
      if (char === '(') depth++;
      else if (char === ')') depth--;

      if (depth === 0 && clause.substring(i, i + 4).toUpperCase() === ' OR ') {
        parts.push(current);
        current = '';
        i += 3; // Skip " OR "
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      parts.push(current);
    }

    return parts.length > 0 ? parts : [clause];
  }

  private static splitByTopLevelAnd(clause: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';

    for (let i = 0; i < clause.length; i++) {
      const char = clause[i];
      if (char === '(') depth++;
      else if (char === ')') depth--;

      if (depth === 0 && clause.substring(i, i + 5).toUpperCase() === ' AND ') {
        parts.push(current);
        current = '';
        i += 4; // Skip " AND "
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      parts.push(current);
    }

    return parts.length > 0 ? parts : [clause];
  }

  private static parseComparisonValue(rawValue: string, parameters: GraphParameters): GraphPropertyValue {
    // Handle datetime($param)
    const datetimeMatch = rawValue.match(/^datetime\(\$(\w+)\)$/);
    if (datetimeMatch) {
      return this.normalizePropertyValue(parameters[datetimeMatch[1]]);
    }

    // Handle $param
    if (rawValue.startsWith('$')) {
      return parameters[rawValue.substring(1)];
    }

    // Handle strings
    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      return rawValue.slice(1, -1);
    }

    // Handle numbers
    if (!isNaN(Number(rawValue))) {
      return Number(rawValue);
    }

    return rawValue;
  }

  private static normalizePropertyValue(value: GraphPropertyValue): GraphPropertyValue {
    // Convert date strings to Date objects for comparison
    if (typeof value === 'string') {
      // Check if it's an ISO date string
      const dateMatch = value.match(/^\d{4}-\d{2}-\d{2}T/);
      if (dateMatch) {
        return new Date(value).getTime();
      }
    }
    if (value instanceof Date) {
      return value.getTime();
    }
    return value;
  }

  /**
   * Three-way comparison used for ordering, mirroring the JavaScript relational
   * semantics the query engine previously relied on: two strings compare
   * lexicographically, everything else is coerced numerically, and `null` means
   * "not comparable" (what `NaN` comparisons used to produce).
   */
  private static compareOrder(left: GraphPropertyValue, right: GraphPropertyValue): number | null {
    if (typeof left === 'string' && typeof right === 'string') {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    }
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) {
      return null;
    }
    if (leftNumber < rightNumber) return -1;
    if (leftNumber > rightNumber) return 1;
    return 0;
  }

  /**
   * Read a numeric Cypher parameter used by SKIP/LIMIT. Neo4j integers reach the
   * engine either as plain numbers/strings or as driver `Integer`-like values
   * that expose `toNumber()`; anything else is not a usable offset.
   */
  private static toIntegerParameter(value: GraphPropertyValue): number {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return parseInt(value);
    }
    if (isIntegerLikeValue(value)) {
      return value.toNumber();
    }
    return Number.NaN;
  }

  private static compareValues(left: GraphPropertyValue, operator: string, right: GraphPropertyValue): boolean {
    switch (operator) {
      case '=':
        return left === right;
      case '!=':
      case '<>':
        return left !== right;
      case '<': {
        const order = this.compareOrder(left, right);
        return order !== null && order < 0;
      }
      case '>': {
        const order = this.compareOrder(left, right);
        return order !== null && order > 0;
      }
      case '<=': {
        const order = this.compareOrder(left, right);
        return order !== null && order <= 0;
      }
      case '>=': {
        const order = this.compareOrder(left, right);
        return order !== null && order >= 0;
      }
      default:
        return true;
    }
  }

  private static nodeMatchesProperties(node: GraphNode, targetProps: GraphProperties): boolean {
    for (const [key, value] of Object.entries(targetProps)) {
      if (node.properties[key] !== value) {
        return false;
      }
    }
    return true;
  }

  private static createRecord(keys: string[], values: LocalRecordValue[]): LocalQueryRecord {
    return {
      keys,
      values,
      get(keyOrIndex: string | number): LocalRecordValue | undefined {
        if (typeof keyOrIndex === 'string') {
          const index = keys.indexOf(keyOrIndex);
          return index >= 0 ? values[index] : undefined;
        }
        return values[keyOrIndex];
      },
      has(key: string): boolean {
        return keys.includes(key);
      }
    };
  }

  private static generateId(): string {
    return `local_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * Additive construction options for `LocalGraphStore`.
 *
 * `dataFile` lets a caller bind a store to one specific file (for example the
 * per-graph live store) without mutating the process-wide config object. When it
 * is omitted the store keeps the historical behaviour of deriving its path from
 * `localExecution.dataDirectory` and `localExecution.graphFile`.
 */
export interface LocalGraphStoreOptions {
  dataFile?: string;
}

/**
 * Local graph store implementation with file-based persistence
 * Provides Neo4j-compatible interface for local execution
 */
export class LocalGraphStore {
  private config = loadConfig();
  private graphData: GraphData;
  private dataFile: string;
  private backupTimer?: NodeJS.Timeout;
  /**
   * The in-flight `shutdown`, if one is running. Two owners can ask for the same
   * instance's shutdown at once — a retirement whose shutdown overlaps a revival,
   * or the shutdown drain racing the eviction pass. They share this promise
   * so redundant concurrent saves of the same instance are collapsed, which
   * makes `shutdown` idempotent for the duration of a shutdown.
   */
  private shutdownInFlight?: Promise<void>;

  constructor(options: LocalGraphStoreOptions = {}) {
    this.graphData = {
      nodes: new Map(),
      relationships: new Map(),
      nodesByLabel: new Map(),
      relationshipsByType: new Map(),
      backups: []
    };
    
    this.dataFile = options.dataFile
      ?? path.join(this.config.localExecution.dataDirectory, this.config.localExecution.graphFile);
    this.setupBackupTimer();
  }

  /**
   * Absolute or config-relative path this store reads from and writes to.
   * Exposed so a scoped owner (for example `GraphContextStore`) and its tests
   * can assert which file a store is bound to.
   */
  getDataFilePath(): string {
    return this.dataFile;
  }

  /**
   * Create a new node
   */
  async createNode(labels: string[], properties: GraphProperties): Promise<GraphNode> {
    // Only a string id can address a node; anything else falls back to a
    // generated id, as a non-string id could never be looked up again.
    const id = typeof properties.id === 'string' ? properties.id : this.generateId();
    const node: GraphNode = {
      id,
      labels,
      properties: { ...properties, id }
    };
    
    this.graphData.nodes.set(id, node);
    
    // Update label index
    for (const label of labels) {
      if (!this.graphData.nodesByLabel.has(label)) {
        this.graphData.nodesByLabel.set(label, new Set());
      }
      this.graphData.nodesByLabel.get(label)!.add(id);
    }
    
    return node;
  }

  /**
   * Get a node by ID
   */
  async getNode(id: string): Promise<GraphNode | null> {
    return this.graphData.nodes.get(id) || null;
  }

  /**
   * Update a node's properties
   */
  async updateNode(id: string, properties: GraphProperties): Promise<GraphNode | null> {
    const node = this.graphData.nodes.get(id);
    if (!node) {
      return null;
    }
    
    const updatedNode: GraphNode = {
      ...node,
      properties: { ...node.properties, ...properties }
    };
    
    this.graphData.nodes.set(id, updatedNode);
    return updatedNode;
  }

  /**
   * Delete a node and all its relationships
   */
  async deleteNode(id: string): Promise<boolean> {
    const node = this.graphData.nodes.get(id);
    if (!node) {
      return false;
    }
    
    // Delete all relationships connected to this node
    const relationshipsToDelete: string[] = [];
    for (const [relId, rel] of this.graphData.relationships) {
      if (rel.startNodeId === id || rel.endNodeId === id) {
        relationshipsToDelete.push(relId);
      }
    }
    
    for (const relId of relationshipsToDelete) {
      await this.deleteRelationship(relId);
    }
    
    // Remove from label indices
    for (const label of node.labels) {
      this.graphData.nodesByLabel.get(label)?.delete(id);
    }
    
    // Delete the node
    this.graphData.nodes.delete(id);
    return true;
  }

  /**
   * Create a relationship between two nodes
   */
  async createRelationship(
    startNodeId: string,
    endNodeId: string,
    type: string,
    properties: GraphProperties = {}
  ): Promise<GraphRelationship | null> {
    // Verify both nodes exist
    if (!this.graphData.nodes.has(startNodeId) || !this.graphData.nodes.has(endNodeId)) {
      return null;
    }
    
    const id = this.generateId();
    const relationship: GraphRelationship = {
      id,
      type,
      startNodeId,
      endNodeId,
      properties
    };
    
    this.graphData.relationships.set(id, relationship);
    
    // Update type index
    if (!this.graphData.relationshipsByType.has(type)) {
      this.graphData.relationshipsByType.set(type, new Set());
    }
    this.graphData.relationshipsByType.get(type)!.add(id);
    
    return relationship;
  }

  /**
   * Get relationships for a node
   */
  async getRelationships(nodeId: string, direction?: 'incoming' | 'outgoing' | 'both'): Promise<GraphRelationship[]> {
    const relationships: GraphRelationship[] = [];
    
    for (const rel of this.graphData.relationships.values()) {
      const matchesDirection = 
        !direction || direction === 'both' ||
        (direction === 'outgoing' && rel.startNodeId === nodeId) ||
        (direction === 'incoming' && rel.endNodeId === nodeId);
        
      if ((rel.startNodeId === nodeId || rel.endNodeId === nodeId) && matchesDirection) {
        relationships.push(rel);
      }
    }
    
    return relationships;
  }

  /**
   * Delete a relationship
   */
  async deleteRelationship(id: string): Promise<boolean> {
    const relationship = this.graphData.relationships.get(id);
    if (!relationship) {
      return false;
    }
    
    this.graphData.relationships.delete(id);
    this.graphData.relationshipsByType.get(relationship.type)?.delete(id);
    
    return true;
  }

  /**
   * Execute a Cypher query
   */
  async executeQuery(query: string, parameters: GraphParameters = {}): Promise<LocalQueryResult> {
    try {
      return CypherQueryParser.execute(query, parameters, this.graphData);
    } catch (error) {
      throw new Error(`Query execution failed: ${error}`);
    }
  }

  /**
   * Get nodes by label
   */
  async getNodesByLabel(label: string): Promise<GraphNode[]> {
    const nodeIds = this.graphData.nodesByLabel.get(label) || new Set();
    const nodes: GraphNode[] = [];
    
    for (const nodeId of nodeIds) {
      const node = this.graphData.nodes.get(nodeId);
      if (node) {
        nodes.push(node);
      }
    }
    
    return nodes;
  }

  /**
   * Get relationships by type
   */
  async getRelationshipsByType(type: string): Promise<GraphRelationship[]> {
    const relIds = this.graphData.relationshipsByType.get(type) || new Set();
    const relationships: GraphRelationship[] = [];

    for (const relId of relIds) {
      const rel = this.graphData.relationships.get(relId);
      if (rel) {
        relationships.push(rel);
      }
    }

    return relationships;
  }

  /**
   * Find a relationship by start and end node IDs
   */
  async findRelationshipByNodes(startNodeId: string, endNodeId: string, type?: string): Promise<GraphRelationship | null> {
    for (const rel of this.graphData.relationships.values()) {
      if (rel.startNodeId === startNodeId && rel.endNodeId === endNodeId) {
        if (!type || rel.type === type) {
          return rel;
        }
      }
    }
    return null;
  }

  /**
   * Find all relationships of a specific type
   */
  async findRelationshipsByType(type: string): Promise<GraphRelationship[]> {
    const results: GraphRelationship[] = [];
    for (const rel of this.graphData.relationships.values()) {
      if (rel.type === type) {
        results.push(rel);
      }
    }
    return results;
  }

  /**
   * Update a relationship's properties
   */
  async updateRelationship(id: string, properties: GraphProperties): Promise<GraphRelationship | null> {
    const relationship = this.graphData.relationships.get(id);
    if (!relationship) {
      return null;
    }

    const updatedRelationship: GraphRelationship = {
      ...relationship,
      properties: { ...relationship.properties, ...properties }
    };

    this.graphData.relationships.set(id, updatedRelationship);
    return updatedRelationship;
  }

  /**
   * Remove any orphaned temporary files left by an abrupt termination during save
   */
  private async cleanupTempFiles(): Promise<void> {
    try {
      const dir = path.dirname(this.dataFile);
      const base = path.basename(this.dataFile);
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (entry.startsWith(`${base}.`) && entry.endsWith('.tmp')) {
          await fs.unlink(path.join(dir, entry)).catch(() => {});
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }

  /**
   * Save graph data to file atomically using a temporary file and rename
   */
  async save(): Promise<void> {
    try {
      const dataDir = path.dirname(this.dataFile);
      await fs.mkdir(dataDir, { recursive: true });
      
      // Convert Maps to Objects for JSON serialization
      const serializableData = {
        nodes: Object.fromEntries(this.graphData.nodes),
        relationships: Object.fromEntries(this.graphData.relationships),
        nodesByLabel: Object.fromEntries(
          Array.from(this.graphData.nodesByLabel.entries()).map(([k, v]) => [k, Array.from(v)])
        ),
        relationshipsByType: Object.fromEntries(
          Array.from(this.graphData.relationshipsByType.entries()).map(([k, v]) => [k, Array.from(v)])
        ),
        backups: this.graphData.backups
      };
      
      const tempFile = `${this.dataFile}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      try {
        await fs.writeFile(tempFile, JSON.stringify(serializableData, null, 2), 'utf8');
        await fs.rename(tempFile, this.dataFile);
      } catch (writeErr) {
        await fs.unlink(tempFile).catch(() => {});
        throw writeErr;
      }
    } catch (error) {
      console.error('Failed to save graph data:', error);
      throw error;
    }
  }

  /**
   * Load graph data from file
   */
  async load(): Promise<void> {
    await this.cleanupTempFiles();
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      const parsed = JSON.parse(data);
      
      // Convert Objects back to Maps
      this.graphData.nodes = new Map(Object.entries(parsed.nodes || {}));
      this.graphData.relationships = new Map(Object.entries(parsed.relationships || {}));
      this.graphData.nodesByLabel = new Map(
        Object.entries(parsed.nodesByLabel || {}).map(([label, ids]) => [label, new Set(this.toIdList(ids))])
      );
      this.graphData.relationshipsByType = new Map(
        Object.entries(parsed.relationshipsByType || {}).map(([type, ids]) => [type, new Set(this.toIdList(ids))])
      );
      this.graphData.backups = parsed.backups || [];
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        console.error('Failed to load graph data:', error);
      }
      // File might not exist on first run, which is fine
    }
  }

  /**
   * Read an id list out of the persisted graph file. The file is JSON, so the
   * entries are expected to be arrays of strings; anything else is treated as an
   * empty index rather than seeding the in-memory map with unusable values.
   */
  private toIdList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  /**
   * Create a backup of the current graph data
   */
  async createBackup(): Promise<void> {
    if (!this.config.localExecution.backupEnabled) {
      return;
    }
    
    try {
      const timestamp = new Date();
      const backupFilename = `graph_backup_${timestamp.toISOString().replace(/[:.]/g, '-')}.json`;
      const backupPath = path.join(this.config.localExecution.dataDirectory, 'backups', backupFilename);
      
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.copyFile(this.dataFile, backupPath);
      
      const stats = await fs.stat(backupPath);
      const backup: GraphBackup = {
        timestamp,
        filename: backupFilename,
        size: stats.size
      };
      
      this.graphData.backups.push(backup);
      
      // Keep only the last 10 backups
      if (this.graphData.backups.length > 10) {
        const oldBackup = this.graphData.backups.shift();
        if (oldBackup) {
          const oldBackupPath = path.join(this.config.localExecution.dataDirectory, 'backups', oldBackup.filename);
          await fs.unlink(oldBackupPath).catch(() => {}); // Ignore errors
        }
      }
    } catch (error) {
      console.error('Failed to create backup:', error);
    }
  }

  /**
   * Get graph statistics
   */
  getStats(): { nodeCount: number; relationshipCount: number; labelCount: number; relationshipTypeCount: number } {
    return {
      nodeCount: this.graphData.nodes.size,
      relationshipCount: this.graphData.relationships.size,
      labelCount: this.graphData.nodesByLabel.size,
      relationshipTypeCount: this.graphData.relationshipsByType.size
    };
  }

  /**
   * Clear all graph data
   */
  async clear(): Promise<void> {
    this.graphData.nodes.clear();
    this.graphData.relationships.clear();
    this.graphData.nodesByLabel.clear();
    this.graphData.relationshipsByType.clear();
  }

  /**
   * Shutdown the graph store.
   *
   * Saves the current in-memory state and stops the backup timer. Idempotent
   * while a shutdown is in flight: concurrent callers await the same save rather
   * than starting a second, interleaved write of the same file. A later call
   * after the shutdown completed starts a new save, so writing to a store and
   * shutting it down again still persists the newer state.
   */
  async shutdown(): Promise<void> {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = undefined;
    }
    const inFlight = this.shutdownInFlight;
    if (inFlight) {
      return inFlight;
    }
    const pending = this.save();
    this.shutdownInFlight = pending;
    try {
      await pending;
    } finally {
      if (this.shutdownInFlight === pending) {
        this.shutdownInFlight = undefined;
      }
    }
  }

  /**
   * Restart the automatic backup timer after a `shutdown`.
   *
   * A store that `GraphContextStore` evicted is the same instance a caller may
   * still hold; reviving it must also revive the timer `shutdown` cleared, or
   * that graph would silently stop receiving periodic backups.
   */
  resumeBackupTimer(): void {
    if (this.backupTimer === undefined) {
      this.setupBackupTimer();
    }
  }

  /**
   * Setup automatic backup timer
   */
  private setupBackupTimer(): void {
    if (!this.config.localExecution.backupEnabled) {
      return;
    }
    
    this.backupTimer = setInterval(() => {
      this.createBackup().catch(console.error);
    }, this.config.localExecution.backupInterval);
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `local_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
/**
 * `true` when the rejection came from the filesystem because the path does not
 * exist, which is the expected "first run" case when loading persisted state.
 */
function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * Neo4j `Integer`-like value. Cypher parameters such as `SKIP $offset` arrive in
 * this shape when they come from the driver rather than as plain JavaScript
 * numbers.
 */
interface IntegerLikeValue {
  toNumber(): number;
}

function isIntegerLikeValue(value: GraphPropertyValue): value is GraphPropertyValue & IntegerLikeValue {
  return typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function';
}
