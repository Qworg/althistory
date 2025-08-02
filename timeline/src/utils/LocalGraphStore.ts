import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfig } from './config';
import { IEvent } from '../models/Event';
import { IArc } from '../models/Arc';
import { InferredPressure } from '../models/InferredPressure';

/**
 * Local graph node representation
 */
export interface GraphNode {
  id: string;
  labels: string[];
  properties: Record<string, any>;
}

/**
 * Local graph relationship representation
 */
export interface GraphRelationship {
  id: string;
  type: string;
  startNodeId: string;
  endNodeId: string;
  properties: Record<string, any>;
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
 * Query result similar to Neo4j Record
 */
export interface LocalQueryRecord {
  keys: string[];
  get(key: string): any;
  get(index: number): any;
  has(key: string): boolean;
  values: any[];
}

/**
 * Query result similar to Neo4j Result
 */
export interface LocalQueryResult {
  records: LocalQueryRecord[];
  summary: {
    query: string;
    parameters: Record<string, any>;
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
  static execute(query: string, parameters: Record<string, any>, graphData: GraphData): LocalQueryResult {
    const trimmedQuery = query.trim();
    
    // Handle CREATE queries
    if (trimmedQuery.startsWith('CREATE')) {
      return this.executeCreate(query, parameters, graphData);
    }
    
    // Handle MATCH queries
    if (trimmedQuery.startsWith('MATCH')) {
      return this.executeMatch(query, parameters, graphData);
    }
    
    // Handle SET queries (UPDATE)
    if (trimmedQuery.includes('SET')) {
      return this.executeSet(query, parameters, graphData);
    }
    
    // Handle DELETE queries
    if (trimmedQuery.includes('DELETE') || trimmedQuery.includes('DETACH DELETE')) {
      return this.executeDelete(query, parameters, graphData);
    }

    throw new Error(`Unsupported query type: ${query}`);
  }

  private static executeCreate(query: string, parameters: Record<string, any>, graphData: GraphData): LocalQueryResult {
    const counters = { nodesCreated: 0, relationshipsCreated: 0, nodesDeleted: 0, relationshipsDeleted: 0, propertiesSet: 0 };
    const records: LocalQueryRecord[] = [];
    
    // Parse CREATE node pattern: CREATE (n:Label { props })
    const nodePattern = /CREATE\s*\((\w+):(\w+)\s*\{([^}]+)\}\)/i;
    const nodeMatch = query.match(nodePattern);
    
    if (nodeMatch) {
      const [, variable, label, propsStr] = nodeMatch;
      const props = this.parseProperties(propsStr, parameters);
      
      const node: GraphNode = {
        id: props.id || this.generateId(),
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
      const relationship: GraphRelationship = {
        id: this.generateId(),
        type,
        startNodeId: parameters[`${startVar}_id`] || startVar,
        endNodeId: parameters[`${endVar}_id`] || endVar,
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

  private static executeMatch(query: string, parameters: Record<string, any>, graphData: GraphData): LocalQueryResult {
    const records: LocalQueryRecord[] = [];
    const counters = { nodesCreated: 0, relationshipsCreated: 0, nodesDeleted: 0, relationshipsDeleted: 0, propertiesSet: 0 };
    
    // Parse MATCH (n:Label) WHERE conditions RETURN fields
    const matchPattern = /MATCH\s*\((\w+):(\w+)\)(?:\s*WHERE\s+([^RETURN]+))?(?:\s*RETURN\s+(.+))?/i;
    const match = query.match(matchPattern);
    
    if (match) {
      const [, variable, label, whereClause, returnClause] = match;
      
      // Get nodes with matching label
      const nodeIds = graphData.nodesByLabel.get(label) || new Set();
      let matchingNodes: GraphNode[] = [];
      
      for (const nodeId of nodeIds) {
        const node = graphData.nodes.get(nodeId);
        if (node) {
          // Apply WHERE clause filtering
          if (!whereClause || this.evaluateWhereClause(whereClause, node.properties, parameters)) {
            matchingNodes.push(node);
          }
        }
      }
      
      // Apply LIMIT if present
      const limitMatch = query.match(/LIMIT\s+(\d+)/i);
      if (limitMatch) {
        const limit = parseInt(limitMatch[1]);
        matchingNodes = matchingNodes.slice(0, limit);
      }
      
      // Apply SKIP if present
      const skipMatch = query.match(/SKIP\s+(\d+)/i);
      if (skipMatch) {
        const skip = parseInt(skipMatch[1]);
        matchingNodes = matchingNodes.slice(skip);
      }
      
      // Create records based on RETURN clause
      if (returnClause) {
        const returnFields = returnClause.split(',').map(f => f.trim());
        
        for (const node of matchingNodes) {
          const values: any[] = [];
          const keys: string[] = [];
          
          for (const field of returnFields) {
            if (field === variable) {
              values.push(node);
              keys.push(field);
            } else if (field.startsWith(`${variable}.`)) {
              const property = field.substring(variable.length + 1);
              values.push(node.properties[property]);
              keys.push(field);
            }
          }
          
          records.push(this.createRecord(keys, values));
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

  private static executeSet(query: string, parameters: Record<string, any>, graphData: GraphData): LocalQueryResult {
    const counters = { nodesCreated: 0, relationshipsCreated: 0, nodesDeleted: 0, relationshipsDeleted: 0, propertiesSet: 0 };
    
    // This is a simplified SET implementation
    // Real implementation would parse the full MATCH...SET pattern
    
    return {
      records: [],
      summary: {
        query,
        parameters,
        counters
      }
    };
  }

  private static executeDelete(query: string, parameters: Record<string, any>, graphData: GraphData): LocalQueryResult {
    const counters = { nodesCreated: 0, relationshipsCreated: 0, nodesDeleted: 0, relationshipsDeleted: 0, propertiesSet: 0 };
    
    // Parse MATCH...DELETE pattern
    const deletePattern = /MATCH\s*\((\w+):(\w+)\s*\{([^}]+)\}\)\s*(?:DETACH\s+)?DELETE\s+\1/i;
    const match = query.match(deletePattern);
    
    if (match) {
      const [, variable, label, propsStr] = match;
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
    
    return {
      records: [],
      summary: {
        query,
        parameters,
        counters
      }
    };
  }

  private static parseProperties(propsStr: string, parameters: Record<string, any>): Record<string, any> {
    const props: Record<string, any> = {};
    
    // Simple property parsing: key: $param or key: value
    const propertyPattern = /(\w+):\s*(\$\w+|'[^']*'|"[^"]*"|\d+|true|false)/g;
    let match;
    
    while ((match = propertyPattern.exec(propsStr)) !== null) {
      const [, key, value] = match;
      
      if (value.startsWith('$')) {
        const paramName = value.substring(1);
        props[key] = parameters[paramName];
      } else if (value.startsWith('"') || value.startsWith("'")) {
        props[key] = value.slice(1, -1);
      } else if (value === 'true' || value === 'false') {
        props[key] = value === 'true';
      } else if (!isNaN(Number(value))) {
        props[key] = Number(value);
      } else {
        props[key] = value;
      }
    }
    
    return props;
  }

  private static evaluateWhereClause(whereClause: string, properties: Record<string, any>, parameters: Record<string, any>): boolean {
    // Simplified WHERE clause evaluation
    // Support basic property comparisons: n.property = $param or n.property = 'value'
    
    const comparisons = whereClause.split(/\s+AND\s+/i);
    
    for (const comparison of comparisons) {
      const match = comparison.match(/(\w+)\.(\w+)\s*([=<>!]+)\s*(\$\w+|'[^']*'|"[^"]*"|\d+)/);
      if (match) {
        const [, variable, property, operator, value] = match;
        
        let compareValue;
        if (value.startsWith('$')) {
          compareValue = parameters[value.substring(1)];
        } else if (value.startsWith('"') || value.startsWith("'")) {
          compareValue = value.slice(1, -1);
        } else {
          compareValue = value;
        }
        
        const propertyValue = properties[property];
        
        switch (operator) {
          case '=':
            if (propertyValue !== compareValue) return false;
            break;
          case '!=':
            if (propertyValue === compareValue) return false;
            break;
          // Add more operators as needed
        }
      }
    }
    
    return true;
  }

  private static nodeMatchesProperties(node: GraphNode, targetProps: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(targetProps)) {
      if (node.properties[key] !== value) {
        return false;
      }
    }
    return true;
  }

  private static createRecord(keys: string[], values: any[]): LocalQueryRecord {
    return {
      keys,
      values,
      get(keyOrIndex: string | number): any {
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
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
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

  constructor() {
    this.graphData = {
      nodes: new Map(),
      relationships: new Map(),
      nodesByLabel: new Map(),
      relationshipsByType: new Map(),
      backups: []
    };
    
    this.dataFile = path.join(this.config.localExecution.dataDirectory, this.config.localExecution.graphFile);
    this.setupBackupTimer();
  }

  /**
   * Create a new node
   */
  async createNode(labels: string[], properties: Record<string, any>): Promise<GraphNode> {
    const id = properties.id || this.generateId();
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
  async updateNode(id: string, properties: Record<string, any>): Promise<GraphNode | null> {
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
    properties: Record<string, any> = {}
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
  async executeQuery(query: string, parameters: Record<string, any> = {}): Promise<LocalQueryResult> {
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
   * Save graph data to file
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
      
      await fs.writeFile(this.dataFile, JSON.stringify(serializableData, null, 2));
    } catch (error) {
      console.error('Failed to save graph data:', error);
      throw error;
    }
  }

  /**
   * Load graph data from file
   */
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      const parsed = JSON.parse(data);
      
      // Convert Objects back to Maps
      this.graphData.nodes = new Map(Object.entries(parsed.nodes || {}));
      this.graphData.relationships = new Map(Object.entries(parsed.relationships || {}));
      this.graphData.nodesByLabel = new Map(
        Object.entries(parsed.nodesByLabel || {}).map(([k, v]: [string, any]) => [k, new Set(v)])
      );
      this.graphData.relationshipsByType = new Map(
        Object.entries(parsed.relationshipsByType || {}).map(([k, v]: [string, any]) => [k, new Set(v)])
      );
      this.graphData.backups = parsed.backups || [];
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        console.error('Failed to load graph data:', error);
      }
      // File might not exist on first run, which is fine
    }
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
   * Shutdown the graph store
   */
  async shutdown(): Promise<void> {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
    }
    await this.save();
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
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}