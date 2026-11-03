import { createHash } from 'node:crypto';
import { sql, type PostgresPool } from 'kysely';
import { createPostgresMigrationDatabase } from '../migration/postgres.js';

export interface PostgresColumnRequirement {
  type: string;
  nullable: boolean;
  default?: boolean;
  /** Exact pg_get_expr representation, when default semantics are a required invariant. */
  defaultExpression?: string;
  generated?: string;
}
export interface PostgresForeignKeyRequirement {
  columns: readonly string[];
  table: string;
  references: readonly string[];
  onDelete?: 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default';
  onUpdate?: 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default';
}
export interface PostgresTableRequirement {
  columns: Readonly<Record<string, PostgresColumnRequirement>>;
  /** Additional NOT NULL columns must supply their own value. */
  insert?: boolean;
  unique?: readonly (readonly string[])[];
  foreignKeys?: readonly PostgresForeignKeyRequirement[];
  immutable?: { function: string; bodySha256: string };
  /** PostgreSQL trigger type bitmask; the declared function must be unchanged. */
  triggers?: readonly { function: string; bodySha256: string; type: number }[];
}
export interface PostgresSchemaRequirement {
  name: string;
  /** Explicit component schema; defaults to current_schema() on the borrowed connection. */
  schema?: string;
  routines?: readonly {
    name: string;
    bodySha256: string;
    language: 'sql' | 'plpgsql';
    volatility: string;
  }[];
  tables: Readonly<Record<string, PostgresTableRequirement>>;
}
export const requiredColumn = (type: string): PostgresColumnRequirement => ({ type, nullable: false });
export const nullableColumn = (type: string): PostgresColumnRequirement => ({ type, nullable: true });

export class SchemaReadinessError extends Error {
  readonly code = 'database_schema_incompatible';
  constructor(
    readonly component: string,
    readonly violations: readonly string[],
  ) {
    super(
      `Database schema is incompatible with ${component}: ${violations.join('; ')}. Apply the declared project migrations before starting the application.`,
    );
    this.name = 'SchemaReadinessError';
  }
}

/** Connection-only pool view: no migration registry, journal mutation or DDL. */
export async function requirePostgresSchema(pool: PostgresPool, contract: PostgresSchemaRequirement): Promise<void> {
  const db = createPostgresMigrationDatabase(pool);
  try {
    await db
      .transaction()
      .setIsolationLevel('repeatable read')
      .setAccessMode('read only')
      .execute(async (tx) => {
        const {
          rows: [namespace],
        } = await sql<{ schema: string }>`SELECT coalesce(${contract.schema ?? null}::text, current_schema()) AS schema`.execute(tx);
        if (!namespace?.schema)
          throw new SchemaReadinessError(contract.name, ['schema: unavailable']);
        const tables = await tx.introspection.getTables();
        const names = Object.keys(contract.tables);
        const { rows: constraints } = await sql<{
          table: string;
          type: string;
          valid: boolean;
          columns: string[];
          target_schema: string | null;
          target_table: string | null;
          targets: string[] | null;
          delete_action: string;
          update_action: string;
          deferred: boolean;
        }>`SELECT c.relname AS table, k.contype AS type, k.convalidated AS valid,
        ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(n,i) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=x.n ORDER BY x.i) AS columns,
        tn.nspname AS target_schema, tc.relname AS target_table,
        ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(n,i) JOIN pg_attribute a ON a.attrelid=tc.oid AND a.attnum=x.n ORDER BY x.i) AS targets,
        k.confdeltype AS delete_action,k.confupdtype AS update_action,k.condeferrable AS deferred
        FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_class tc ON tc.oid=k.confrelid LEFT JOIN pg_namespace tn ON tn.oid=tc.relnamespace
        WHERE n.nspname=${namespace.schema} AND c.relname=ANY(${names}::text[])`.execute(tx);
        const { rows: triggers } = await sql<{
          table: string;
          enabled: string;
          type: number;
          qualified: boolean;
          function: string;
          function_schema: string;
          body: string;
          language: string;
          args: number;
          columns: string;
        }>`SELECT c.relname AS table,t.tgenabled AS enabled,t.tgtype::integer AS type,
        t.tgqual IS NOT NULL AS qualified,p.proname AS function,pn.nspname AS function_schema,
        p.prosrc AS body,l.lanname AS language,t.tgnargs AS args,t.tgattr::text AS columns
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_language l ON l.oid=p.prolang JOIN pg_namespace pn ON pn.oid=p.pronamespace
        WHERE NOT t.tgisinternal AND n.nspname=${namespace.schema} AND c.relname=ANY(${names}::text[])`.execute(
          tx,
        );
        const { rows: columns } = await sql<{
          table: string;
          column: string;
          generated: boolean;
          expression: string | null;
        }>`
        SELECT c.relname AS table,a.attname AS column,a.attgenerated<>'' AS generated,pg_get_expr(d.adbin,d.adrelid) AS expression
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE n.nspname=${namespace.schema} AND c.relname=ANY(${names}::text[]) AND a.attnum>0 AND NOT a.attisdropped`.execute(
          tx,
        );
        const { rows: routines } = await sql<{
          name: string;
          body: string;
          language: string;
          volatility: string;
          security: boolean;
        }>`
          SELECT p.proname AS name,p.prosrc AS body,l.lanname AS language,p.provolatile AS volatility,p.prosecdef AS security
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
          WHERE n.nspname=${namespace.schema} AND p.pronargs=0 AND p.proname=ANY(${(contract.routines ?? []).map((r) => r.name)}::text[])`.execute(
          tx,
        );
        const actions = {
          'no action': 'a',
          restrict: 'r',
          cascade: 'c',
          'set null': 'n',
          'set default': 'd',
        };
        const violations: string[] = [];
        for (const expected of contract.routines ?? []) {
          if (
            !routines.some(
              (r) =>
                r.name === expected.name &&
                !r.security &&
                r.language === expected.language &&
                r.volatility === expected.volatility &&
                createHash('sha256').update(r.body).digest('hex') === expected.bodySha256,
            )
          ) {
            violations.push(`${expected.name}: required database routine`);
          }
        }
        const same = (a: readonly string[] | null, b: readonly string[]) =>
          a?.length === b.length && a.every((x, i) => x === b[i]);
        for (const [name, expected] of Object.entries(contract.tables)) {
          const table = tables.find((t) => t.name === name && t.schema === namespace.schema);
          if (!table || table.isView || table.isForeign) {
            violations.push(`${name}: physical table required`);
            continue;
          }
          for (const [nameOfColumn, spec] of Object.entries(expected.columns)) {
            const column = table.columns.find((c) => c.name === nameOfColumn);
            if (
              !column ||
              column.dataType !== spec.type ||
              column.dataTypeSchema !== 'pg_catalog' ||
              column.isNullable !== spec.nullable ||
              (spec.default !== undefined && column.hasDefaultValue !== spec.default) ||
              (spec.defaultExpression !== undefined &&
                !columns.some((c) => c.table === name && c.column === nameOfColumn && !c.generated && c.expression === spec.defaultExpression)) ||
              (spec.generated !== undefined &&
                !columns.some(
                  (c) =>
                    c.table === name &&
                    c.column === nameOfColumn &&
                    c.generated &&
                    c.expression === spec.generated,
                ))
            ) {
              violations.push(`${name}.${nameOfColumn}: required column shape`);
            }
          }
          if (expected.insert)
            for (const column of table.columns) {
              if (
                !(column.name in expected.columns) &&
                !column.isNullable &&
                !column.hasDefaultValue &&
                !column.isAutoIncrementing &&
                !columns.some((c) => c.table === name && c.column === column.name && c.generated)
              ) {
                violations.push(`${name}.${column.name}: additional column requires a value`);
              }
            }
          for (const key of expected.unique ?? []) {
            if (
              !constraints.some(
                (c) =>
                  c.table === name &&
                  c.valid &&
                  !c.deferred &&
                  (c.type === 'p' || c.type === 'u') &&
                  same(c.columns, key),
              )
            ) {
              violations.push(`${name}: unique key (${key.join(',')}) required`);
            }
          }
          for (const key of expected.foreignKeys ?? []) {
            if (
              !constraints.some(
                (c) =>
                  c.table === name &&
                  c.type === 'f' &&
                  c.valid &&
                  same(c.columns, key.columns) &&
                  c.target_schema === namespace.schema &&
                  c.target_table === key.table &&
                  same(c.targets, key.references) &&
                  c.delete_action === actions[key.onDelete ?? 'no action'] &&
                  c.update_action === actions[key.onUpdate ?? 'no action'],
              )
            ) {
              violations.push(`${name}: foreign key (${key.columns.join(',')}) required`);
            }
          }
          for (const expectedTrigger of [
            ...(expected.triggers ?? []),
            ...(expected.immutable ? [{ ...expected.immutable, type: 27 }] : []),
          ]) {
            if (
              !triggers.some(
                (t) =>
                  t.table === name &&
                  (t.enabled === 'O' || t.enabled === 'A') &&
                  t.type === expectedTrigger.type &&
                  !t.qualified &&
                  t.args === 0 &&
                  t.columns === '' &&
                  t.function_schema === namespace.schema &&
                  t.language === 'plpgsql' &&
                  t.function === expectedTrigger.function &&
                  createHash('sha256').update(t.body).digest('hex') === expectedTrigger.bodySha256,
              )
            ) {
              violations.push(
                expected.immutable && expectedTrigger.type === 27
                  ? `${name}: immutable evidence trigger required`
                  : `${name}: ${expectedTrigger.function} trigger required`,
              );
            }
          }
        }
        if (violations.length) throw new SchemaReadinessError(contract.name, violations);
      });
  } finally {
    await db.destroy();
  }
}
