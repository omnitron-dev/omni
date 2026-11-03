/** Read-only PostgreSQL component compatibility. No migration execution or pool ownership. */
export { requirePostgresSchema, SchemaReadinessError, requiredColumn, nullableColumn } from '../readiness/postgres.js';
export type { PostgresSchemaRequirement, PostgresTableRequirement, PostgresColumnRequirement, PostgresForeignKeyRequirement } from '../readiness/postgres.js';
