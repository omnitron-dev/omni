/** Typed incidence projection. Layout never changes the graph or creates an entailment. */
export interface KnowledgeEntity {
  id: string;
  kind: string;
  label: string;
  description?: string;
}
export interface KnowledgePort {
  entity: string;
  role: string;
}
export interface KnowledgeRelation {
  id: string;
  kind: string;
  label: string;
  inputs: readonly KnowledgePort[];
  outputs: readonly KnowledgePort[];
  description?: string;
}
export interface KnowledgeGraphData {
  entities: readonly KnowledgeEntity[];
  relations: readonly KnowledgeRelation[];
}
export type KnowledgeSelection = { type: 'entity' | 'relation'; id: string };
export interface KnowledgeProjection {
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
  total: number;
  omittedRelations: number;
  limited: boolean;
}
export function validateKnowledgeGraph(data: KnowledgeGraphData): void {
  const ids = new Set<string>();
  for (const entity of data.entities) {
    if (!entity.id || !entity.kind || !entity.label || ids.has(entity.id)) throw Error('invalid_entity');
    ids.add(entity.id);
  }
  const relations = new Set<string>();
  for (const relation of data.relations) {
    if (
      !relation.id ||
      !relation.kind ||
      !relation.label ||
      relations.has(relation.id) ||
      !relation.inputs.length ||
      !relation.outputs.length
    )
      throw Error('invalid_relation');
    relations.add(relation.id);
    for (const port of [...relation.inputs, ...relation.outputs])
      if (!ids.has(port.entity) || !port.role) throw Error('dangling_port');
  }
}
/** A relation is included atomically, with all of its ordered input/output occurrences.
 * A tight budget reports omitted relations; it never renders half a justification. */
export function projectKnowledgeGraph(
  data: KnowledgeGraphData,
  selection: KnowledgeSelection | undefined,
  budget = 300
): KnowledgeProjection {
  if (!Number.isSafeInteger(budget) || budget < 1) throw Error('invalid_graph_budget');
  const total = data.entities.length + data.relations.length;
  if (!selection && total <= budget)
    return { entities: [...data.entities], relations: [...data.relations], total, omittedRelations: 0, limited: false };
  if (!selection) return { entities: [], relations: [], total, omittedRelations: data.relations.length, limited: true };
  const selectedEntities = new Set<string>(),
    selectedRelations: KnowledgeRelation[] = [];
  if (selection.type === 'entity' && data.entities.some((e) => e.id === selection.id))
    selectedEntities.add(selection.id);
  const candidates =
    selection.type === 'relation'
      ? data.relations.filter((r) => r.id === selection.id)
      : data.relations.filter((r) => [...r.inputs, ...r.outputs].some((p) => p.entity === selection.id));
  let omittedRelations = 0;
  for (const relation of candidates) {
    const endpoints = new Set([...relation.inputs, ...relation.outputs].map((p) => p.entity));
    const additional = [...endpoints].filter((id) => !selectedEntities.has(id)).length + 1;
    if (selectedEntities.size + selectedRelations.length + additional > budget) {
      omittedRelations++;
      continue;
    }
    for (const id of endpoints) selectedEntities.add(id);
    selectedRelations.push(relation);
  }
  return {
    entities: data.entities.filter((e) => selectedEntities.has(e.id)),
    relations: selectedRelations,
    total,
    omittedRelations,
    limited: total !== selectedEntities.size + selectedRelations.length,
  };
}
export const entityNodeId = (id: string) => JSON.stringify(['entity', id]);
export const relationNodeId = (id: string) => JSON.stringify(['relation', id]);
export function incidenceGraph(projection: KnowledgeProjection) {
  const nodes = [
    ...projection.entities.map((e) => ({
      id: entityNodeId(e.id),
      selection: { type: 'entity' as const, id: e.id },
      label: e.label,
      kind: e.kind,
      description: e.description,
    })),
    ...projection.relations.map((r) => ({
      id: relationNodeId(r.id),
      selection: { type: 'relation' as const, id: r.id },
      label: r.label,
      kind: r.kind,
      description: r.description,
      inputs: r.inputs.length,
      outputs: r.outputs.length,
    })),
  ];
  const edges = projection.relations.flatMap((r) =>
    (['inputs', 'outputs'] as const).flatMap((side) =>
      r[side].map((port, index) => ({
        id: JSON.stringify([r.id, side, index]),
        source: side === 'inputs' ? entityNodeId(port.entity) : relationNodeId(r.id),
        target: side === 'inputs' ? relationNodeId(r.id) : entityNodeId(port.entity),
        label: port.role,
        ...(side === 'inputs' ? { targetHandle: `inputs:${index}` } : { sourceHandle: `outputs:${index}` }),
        relationId: r.id,
        side,
        index,
      }))
    )
  );
  return { nodes, edges };
}
