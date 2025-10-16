/**
 * Knowledge Graph - Stores and manages accumulated knowledge
 */

/**
 * Node in the knowledge graph
 */
export interface KnowledgeNode {
  id: string;
  type: string;
  label: string;
  attributes: Map<string, any>;
  timestamp: number;
}

/**
 * Edge in the knowledge graph
 */
export interface KnowledgeEdge {
  id: string;
  type: string;
  from: string;
  to: string;
  weight: number;
  attributes: Map<string, any>;
  timestamp: number;
}

/**
 * Pattern in the knowledge graph
 */
export interface Pattern {
  id: string;
  type: string;
  description: string;
  confidence: number;
  occurrences: number;
  data: Map<string, any>;
}

/**
 * Knowledge Graph for storing accumulated knowledge
 */
export class KnowledgeGraph {
  private nodes: Map<string, KnowledgeNode> = new Map();
  private edges: Map<string, KnowledgeEdge> = new Map();
  private patterns: Map<string, Pattern> = new Map();
  private concepts: Set<string> = new Set();

  /**
   * Add a node to the graph
   */
  addNode(id: string, type: string, label: string, attributes: Record<string, any> = {}): KnowledgeNode {
    const node: KnowledgeNode = {
      id,
      type,
      label,
      attributes: new Map(Object.entries(attributes)),
      timestamp: Date.now(),
    };
    this.nodes.set(id, node);
    this.concepts.add(label);
    return node;
  }

  /**
   * Add an edge to the graph
   */
  addEdge(type: string, from: string, to: string, weight = 1.0, attributes: Record<string, any> = {}): KnowledgeEdge {
    const id = `${from}-${type}-${to}`;
    const edge: KnowledgeEdge = {
      id,
      type,
      from,
      to,
      weight,
      attributes: new Map(Object.entries(attributes)),
      timestamp: Date.now(),
    };
    this.edges.set(id, edge);
    return edge;
  }

  /**
   * Add a relation (convenience method)
   */
  addRelation(type: string, from: string, to: string, weight = 1.0): void {
    // Ensure nodes exist
    if (!this.nodes.has(from)) {
      this.addNode(from, 'entity', from);
    }
    if (!this.nodes.has(to)) {
      this.addNode(to, 'entity', to);
    }

    // Add or update edge
    const edgeId = `${from}-${type}-${to}`;
    const existing = this.edges.get(edgeId);
    if (existing) {
      existing.weight += weight;
      existing.timestamp = Date.now();
    } else {
      this.addEdge(type, from, to, weight);
    }
  }

  /**
   * Add a pattern to the knowledge graph
   */
  addPattern(pattern: Pattern): void {
    const existing = this.patterns.get(pattern.id);
    if (existing) {
      existing.confidence = (existing.confidence + pattern.confidence) / 2;
      existing.occurrences += pattern.occurrences;
    } else {
      this.patterns.set(pattern.id, pattern);
    }
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): KnowledgeNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get an edge by ID
   */
  getEdge(id: string): KnowledgeEdge | undefined {
    return this.edges.get(id);
  }

  /**
   * Get all edges of a specific type
   */
  getEdgesByType(type: string): KnowledgeEdge[] {
    return Array.from(this.edges.values()).filter((e) => e.type === type);
  }

  /**
   * Get all edges from a node
   */
  getOutgoingEdges(nodeId: string): KnowledgeEdge[] {
    return Array.from(this.edges.values()).filter((e) => e.from === nodeId);
  }

  /**
   * Get all edges to a node
   */
  getIncomingEdges(nodeId: string): KnowledgeEdge[] {
    return Array.from(this.edges.values()).filter((e) => e.to === nodeId);
  }

  /**
   * Get neighbors of a node
   */
  getNeighbors(nodeId: string): KnowledgeNode[] {
    const neighbors = new Set<string>();

    for (const edge of this.edges.values()) {
      if (edge.from === nodeId) {
        neighbors.add(edge.to);
      }
      if (edge.to === nodeId) {
        neighbors.add(edge.from);
      }
    }

    return Array.from(neighbors)
      .map((id) => this.nodes.get(id))
      .filter((n): n is KnowledgeNode => n !== undefined);
  }

  /**
   * Get all concepts
   */
  getConcepts(): string[] {
    return Array.from(this.concepts);
  }

  /**
   * Get all patterns
   */
  getPatterns(): Pattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Find patterns by type
   */
  findPatterns(type: string): Pattern[] {
    return Array.from(this.patterns.values()).filter((p) => p.type === type);
  }

  /**
   * Query the graph with a simple pattern
   */
  query(pattern: { type?: string; from?: string; to?: string }): KnowledgeEdge[] {
    let results = Array.from(this.edges.values());

    if (pattern.type) {
      results = results.filter((e) => e.type === pattern.type);
    }
    if (pattern.from) {
      results = results.filter((e) => e.from === pattern.from);
    }
    if (pattern.to) {
      results = results.filter((e) => e.to === pattern.to);
    }

    return results;
  }

  /**
   * Find shortest path between two nodes
   */
  findPath(from: string, to: string): string[] | null {
    if (!this.nodes.has(from) || !this.nodes.has(to)) {
      return null;
    }

    const queue: Array<{ node: string; path: string[] }> = [{ node: from, path: [from] }];
    const visited = new Set<string>([from]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.node === to) {
        return current.path;
      }

      const neighbors = this.getNeighbors(current.node);
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.id)) {
          visited.add(neighbor.id);
          queue.push({
            node: neighbor.id,
            path: [...current.path, neighbor.id],
          });
        }
      }
    }

    return null; // No path found
  }

  /**
   * Merge another knowledge graph into this one
   */
  merge(other: KnowledgeGraph): void {
    // Merge nodes
    for (const [id, node] of other.nodes.entries()) {
      if (!this.nodes.has(id)) {
        this.nodes.set(id, node);
        this.concepts.add(node.label);
      }
    }

    // Merge edges
    for (const [id, edge] of other.edges.entries()) {
      const existing = this.edges.get(id);
      if (existing) {
        existing.weight = (existing.weight + edge.weight) / 2;
      } else {
        this.edges.set(id, edge);
      }
    }

    // Merge patterns
    for (const [id, pattern] of other.patterns.entries()) {
      this.addPattern(pattern);
    }
  }

  /**
   * Summarize the knowledge graph
   */
  summarize(): string {
    return `KnowledgeGraph: ${this.nodes.size} nodes, ${this.edges.size} edges, ${this.patterns.size} patterns`;
  }

  /**
   * Get size (number of nodes)
   */
  size(): number {
    return this.nodes.size;
  }

  /**
   * Clear the knowledge graph
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.patterns.clear();
    this.concepts.clear();
  }

  /**
   * Export to JSON
   */
  toJSON(): any {
    return {
      nodes: Array.from(this.nodes.entries()).map(([_, node]) => ({
        ...node,
        attributes: Object.fromEntries(node.attributes),
      })),
      edges: Array.from(this.edges.entries()).map(([_, edge]) => ({
        ...edge,
        attributes: Object.fromEntries(edge.attributes),
      })),
      patterns: Array.from(this.patterns.entries()).map(([_, pattern]) => ({
        ...pattern,
        data: Object.fromEntries(pattern.data),
      })),
    };
  }

  /**
   * Import from JSON
   */
  static fromJSON(json: any): KnowledgeGraph {
    const kg = new KnowledgeGraph();

    for (const node of json.nodes || []) {
      kg.nodes.set(node.id, {
        ...node,
        attributes: new Map(Object.entries(node.attributes || {})),
      });
      kg.concepts.add(node.label);
    }

    for (const edge of json.edges || []) {
      kg.edges.set(edge.id, {
        ...edge,
        attributes: new Map(Object.entries(edge.attributes || {})),
      });
    }

    for (const pattern of json.patterns || []) {
      kg.patterns.set(pattern.id, {
        ...pattern,
        data: new Map(Object.entries(pattern.data || {})),
      });
    }

    return kg;
  }
}
