/**
 * SQLite Date Serialization Plugin
 *
 * Converts Date objects to ISO strings for SQLite compatibility.
 * SQLite's better-sqlite3 driver only accepts primitives, not Date objects.
 *
 * ## Plugin Type: Kysely (NOT Kysera)
 *
 * This is a **Kysely plugin** (implements `KyselyPlugin`), which operates at the SQL AST level
 * via `transformQuery()`. This is different from **Kysera plugins** (implement `Plugin` from
 * `@kysera/executor`), which operate at the query builder level via `interceptQuery()`.
 *
 * **Kysely plugins** (transformQuery):
 * - Transform the final SQL AST before execution
 * - Execute in REVERSE order of registration (last registered = first executed)
 * - Applied directly to Kysely connection via `withPlugin()`
 *
 * **Kysera plugins** (interceptQuery):
 * - Transform query builders before they become SQL
 * - Execute in PRIORITY order (higher priority = first executed)
 * - Applied via `createExecutor()` from `@kysera/executor`
 *
 * ## Why This Matters
 *
 * When used with timestamps plugin (which sets Date objects), this plugin must execute FIRST
 * to serialize those dates before they reach SQLite. Since Kysely reverses plugin order,
 * this plugin should be registered LAST in the array.
 */

import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  RootOperationNode,
  QueryResult,
  UnknownRow,
} from 'kysely';

/**
 * Recursively serialize Date objects in query parameters to ISO strings.
 * Handles Kysely's ValueNode structure and deep object traversal.
 */
function serializeDatesInNode(node: any): any {
  if (node === null || node === undefined) {
    return node;
  }

  if (node instanceof Date) {
    return node.toISOString();
  }

  // Handle arrays
  if (Array.isArray(node)) {
    return node.map(serializeDatesInNode);
  }

  // Handle plain objects and Kysely nodes
  if (typeof node === 'object') {
    // Special handling for different Kysely node types
    if (node.kind === 'ValueNode') {
      if (node.value instanceof Date) {
        return {
          ...node,
          value: node.value.toISOString(),
        };
      }
      return {
        ...node,
        value: serializeDatesInNode(node.value),
      };
    }

    if (node.kind === 'PrimitiveValueListNode' && Array.isArray(node.values)) {
      return {
        ...node,
        values: node.values.map((v: any) => (v instanceof Date ? v.toISOString() : serializeDatesInNode(v))),
      };
    }

    if (node.kind === 'ValueListNode' && Array.isArray(node.values)) {
      return {
        ...node,
        values: node.values.map(serializeDatesInNode),
      };
    }

    // Recursively process all properties for other node types
    const result: any = {};
    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        result[key] = serializeDatesInNode(node[key]);
      }
    }
    return result;
  }

  return node;
}

export class SqliteDateSerializerPlugin implements KyselyPlugin {
  readonly name = 'sqlite-date-serializer';
  readonly version = '1.0.0';

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    // Serialize Date objects in the query tree
    return serializeDatesInNode(args.node) as RootOperationNode;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    // No transformation needed for results
    return args.result;
  }
}

/**
 * Factory function to create the SQLite date serializer plugin
 */
export function sqliteDateSerializerPlugin(): SqliteDateSerializerPlugin {
  return new SqliteDateSerializerPlugin();
}
