import { parse, type Expression, type MemberExpression, type ObjectExpression, type Property } from 'acorn';

export interface MigrationChecksumChange {
  name: string;
  before: string | null;
  after: string | null;
}

const MIGRATION = /^\d{3}_[a-z0-9_]+$/;
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Compare declarations without importing either registry or executing migrations.
 * Only a literal checksum on an imported procedural migration may differ. Names,
 * order, bindings and every other executable AST node must remain identical.
 * The caller separately requires byte-identical migration files and directories.
 */
export function compareMigrationChecksumMetadata(before: string, after: string, registry: string): MigrationChecksumChange[] {
  const left = readRegistry(before, registry), right = readRegistry(after, registry);
  if (left.program !== right.program) throw new Error('Migration registry execution changed');
  const changes: MigrationChecksumChange[] = [];
  for (const [name, checksum] of left.checksums) {
    const next = right.checksums.get(name);
    if (next === undefined) throw new Error('Migration registry membership changed');
    if (checksum === next) continue;
    // Introducing a checksum (or returning to an older registry without it) is
    // reversible metadata. Replacing an already declared checksum is drift.
    if (checksum !== null && next !== null) throw new Error(`Migration checksum changed: ${name}`);
    changes.push({ name, before: checksum, after: next });
  }
  if (!changes.length) throw new Error('Registry change is not a checksum metadata transition');
  return changes;
}

function propertyName(property: Property): string | null {
  if (property.computed || property.method || property.kind !== 'init' || property.shorthand) return null;
  return property.key.type === 'Identifier' ? property.key.name :
    property.key.type === 'Literal' && typeof property.key.value === 'string' ? property.key.value : null;
}

function importedMember(expression: Expression, member: string, imports: Map<string, string>): string | null {
  if (expression.type !== 'MemberExpression') return null;
  const value = expression as MemberExpression;
  if (value.computed || value.optional || value.object.type !== 'Identifier' ||
      value.property.type !== 'Identifier' || value.property.name !== member) return null;
  return imports.get(value.object.name) ?? null;
}

function readRegistry(source: string, registry: string) {
  if (Buffer.byteLength(source) > 1024 * 1024) throw new Error('Migration registry exceeds its inspection budget');
  const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const imports = new Map<string, string>();
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration' || typeof statement.source.value !== 'string') continue;
    const file = /^\.\/(\d{3}_[a-z0-9_]+)\.js$/.exec(statement.source.value)?.[1];
    if (!file) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier') imports.set(specifier.local.name, file);
    }
  }
  const declarations = program.body.flatMap(statement => statement.type === 'ExportNamedDeclaration' &&
    statement.declaration?.type === 'VariableDeclaration' && statement.declaration.kind === 'const'
    ? statement.declaration.declarations.filter(declaration => declaration.id.type === 'Identifier' && declaration.id.name === registry) : []);
  const array = declarations.length === 1 ? declarations[0]?.init : null;
  if (array?.type !== 'ArrayExpression') throw new Error('An explicit ordered migration registry is required');
  const names = new Set<string>(), checksums = new Map<string, string | null>();
  for (const entry of array.elements) {
    if (!entry || entry.type === 'SpreadElement') throw new Error('Dynamic migration registry entries require a schema transition');
    if (entry.type !== 'ObjectExpression') {
      const name = importedMember(entry, 'migration', imports);
      if (!name || names.has(name)) throw new Error('Migration registry entries must reference distinct immutable modules');
      names.add(name);
      continue;
    }
    const properties = new Map<string, Property>();
    for (const property of (entry as ObjectExpression).properties) {
      const name = property.type === 'Property' ? propertyName(property) : null;
      if (!name || !['name', 'up', 'down', 'checksum'].includes(name) || properties.has(name)) {
        throw new Error('Procedural migrations require explicit, unique data properties');
      }
      properties.set(name, property as Property);
    }
    const nameNode = properties.get('name')?.value;
    const name = nameNode?.type === 'Literal' && typeof nameNode.value === 'string' ? nameNode.value : null;
    const up = properties.get('up')?.value, down = properties.get('down')?.value;
    if (!name || !MIGRATION.test(name) || names.has(name) || !up || importedMember(up as Expression, 'up', imports) !== name ||
        (down && importedMember(down as Expression, 'down', imports) !== name)) {
      throw new Error('Procedural migration bindings must match their immutable named module');
    }
    names.add(name);
    const checksumProperty = properties.get('checksum');
    const value = checksumProperty?.value;
    if (value && (value.type !== 'Literal' || typeof value.value !== 'string' || !SHA256.test(value.value))) {
      throw new Error('Migration checksum metadata must be a literal SHA-256');
    }
    checksums.set(name, value ? (value as { value: string }).value : null);
    if (checksumProperty) entry.properties = entry.properties.filter(property => property !== checksumProperty);
  }
  // Source offsets and comments are not code. Literal values, import paths,
  // statement/property order and all executable nodes remain in the comparison.
  return { checksums, program: JSON.stringify(program, (key, value: unknown) =>
    key === 'start' || key === 'end' ? undefined : value) };
}
