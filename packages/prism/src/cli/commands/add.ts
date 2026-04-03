/**
 * Prism CLI - Add Command
 *
 * Add components or blocks to your project.
 *
 * @module @omnitron/prism/cli/commands/add
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '../constants.js';
import { loadConfig, getComponentPath, getBlockPath, type PrismConfig } from '../config.js';
import { defaultRegistrySchema } from '../../registry/index.js';
import type { ComponentDefinition } from '../../types/registry.js';

interface AddOptions {
  cwd?: string;
  yes?: boolean;
  overwrite?: boolean;
  all?: boolean;
  path?: string;
  install?: boolean;
}

interface AddResult {
  name: string;
  success: boolean;
  error?: string;
  npmDeps?: string[];
}

/**
 * Create the add command.
 */
export function addCommand(): Command {
  const command = new Command('add');

  command
    .description('Add components or blocks to your project')
    .argument('[items...]', 'Components or blocks to add')
    .option('-y, --yes', 'Skip confirmation prompts')
    .option('-o, --overwrite', 'Overwrite existing files')
    .option('-a, --all', 'Add all available components')
    .option('-c, --cwd <path>', 'Working directory', process.cwd())
    .option('-p, --path <path>', 'Custom output path')
    .option('-i, --install', 'Auto-install npm dependencies')
    .action(async (items: string[], options: AddOptions) => {
      await runAdd(items, options);
    });

  return command;
}

/**
 * Run the add command.
 */
async function runAdd(items: string[], options: AddOptions): Promise<void> {
  const cwd = options.cwd || process.cwd();

  // Load config
  const config = await loadConfig(cwd);
  if (!config) {
    log.error('No prism.config.json found. Run `prism init` first.');
    process.exit(1);
  }

  // Determine what to add
  let itemsToAdd: string[] = items;

  if (options.all) {
    itemsToAdd = [
      ...Object.keys(defaultRegistrySchema.components),
      ...Object.keys(defaultRegistrySchema.blocks).map((b) => `block:${b}`),
    ];
  }

  if (itemsToAdd.length === 0) {
    log.error('No items specified. Use `prism add <component>` or `prism add --all`');
    log.info('Run `prism list` to see available components.');
    process.exit(1);
  }

  console.log('');
  log.info(`Adding ${itemsToAdd.length} item(s)...`);
  console.log('');

  const results: AddResult[] = [];
  const allNpmDeps = new Set<string>();

  for (const item of itemsToAdd) {
    try {
      const result = await addItem(item, config, options);
      results.push(result);
      // Collect npm dependencies
      if (result.npmDeps) {
        for (const dep of result.npmDeps) {
          allNpmDeps.add(dep);
        }
      }
    } catch (error) {
      results.push({
        name: item,
        success: false,
        error: (error as Error).message,
      });
    }
  }

  // Summary
  console.log('');
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  if (successCount > 0) {
    log.success(`Added ${successCount} item(s) successfully.`);
  }
  if (failCount > 0) {
    log.error(`Failed to add ${failCount} item(s).`);
    for (const result of results.filter((r) => !r.success)) {
      log.muted(`  - ${result.name}: ${result.error}`);
    }
  }

  // Display npm dependencies to install
  if (allNpmDeps.size > 0) {
    console.log('');
    log.info('Required npm dependencies:');
    const depsArray = Array.from(allNpmDeps).sort();
    for (const dep of depsArray) {
      log.muted(`  - ${dep}`);
    }
    console.log('');
    log.info('Install with:');
    log.muted(`  npm install ${depsArray.join(' ')}`);
    log.muted(`  # or`);
    log.muted(`  pnpm add ${depsArray.join(' ')}`);

    // Auto-install if requested
    if ((options.install || options.yes) && allNpmDeps.size > 0) {
      const pm = detectPackageManager(cwd);
      const installCmd = pm === 'pnpm' ? 'pnpm add' : pm === 'yarn' ? 'yarn add' : 'npm install';
      log.info(`Installing dependencies with ${pm}...`);
      try {
        const { execSync } = await import('node:child_process');
        execSync(`${installCmd} ${depsArray.join(' ')}`, {
          cwd,
          stdio: 'inherit',
        });
        log.success('Dependencies installed successfully.');
      } catch {
        log.warning('Auto-install failed. Please install dependencies manually.');
      }
    }
  }
  console.log('');
}

/**
 * Detect the package manager used in the project.
 */
function detectPackageManager(cwd: string): 'pnpm' | 'yarn' | 'npm' {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * Add a single item (component or block).
 */
async function addItem(item: string, config: PrismConfig, options: AddOptions): Promise<AddResult> {
  // Check if it's a block (prefixed with "block:")
  const isBlock = item.startsWith('block:');
  const itemName = isBlock ? item.slice(6) : item;

  // Look up the item in the registry
  const registry = isBlock ? defaultRegistrySchema.blocks : defaultRegistrySchema.components;

  const definition = registry[itemName] as ComponentDefinition | undefined;
  if (!definition) {
    return {
      name: item,
      success: false,
      error: `Not found in registry. Run 'prism list' to see available items.`,
    };
  }

  // Determine output path
  const outputPath = options.path
    ? path.join(config.rootDir, options.path, itemName)
    : isBlock
      ? getBlockPath(itemName, config)
      : getComponentPath(itemName, config);

  // Check if already exists
  if (fs.existsSync(outputPath) && !options.overwrite) {
    return {
      name: item,
      success: false,
      error: `Already exists at ${path.relative(config.rootDir, outputPath)}. Use --overwrite to replace.`,
    };
  }

  // Create directory
  await fs.promises.mkdir(outputPath, { recursive: true });

  // Generate files based on registry definition
  for (const file of definition.files) {
    const filePath = path.join(outputPath, file.path);
    const content = generateFileContent(itemName, file.path, file.type, definition, isBlock);
    await fs.promises.writeFile(filePath, content, 'utf-8');
  }

  log.success(`Added ${itemName} → ${path.relative(config.rootDir, outputPath)}/`);

  // Update lockfile
  await updateLockfile(config.rootDir, itemName, definition.version, isBlock);

  // Collect npm dependencies
  const npmDeps: string[] = [];
  if ('dependencies' in definition && definition.dependencies?.npm) {
    npmDeps.push(...definition.dependencies.npm);
  }

  return { name: item, success: true, npmDeps };
}

/**
 * Update the lockfile after adding an item.
 */
async function updateLockfile(rootDir: string, name: string, version: string, isBlock: boolean): Promise<void> {
  const lockfilePath = path.join(rootDir, 'prism.lock.json');

  let lockfile: {
    version: string;
    components: Record<string, { name: string; version: string; installedAt: string }>;
    blocks: Record<string, { name: string; version: string; installedAt: string }>;
  } = {
    version: '1',
    components: {},
    blocks: {},
  };

  // Load existing lockfile if present
  if (fs.existsSync(lockfilePath)) {
    try {
      lockfile = JSON.parse(await fs.promises.readFile(lockfilePath, 'utf-8'));
    } catch {
      // Use default lockfile on parse error
    }
  }

  // Add the new item
  const entry = {
    name,
    version,
    installedAt: new Date().toISOString(),
  };

  if (isBlock) {
    lockfile.blocks[name] = entry;
  } else {
    lockfile.components[name] = entry;
  }

  // Write lockfile
  await fs.promises.writeFile(lockfilePath, JSON.stringify(lockfile, null, 2) + '\n', 'utf-8');
}

// =============================================================================
// TEMPLATE GENERATORS
// =============================================================================

/**
 * Convert kebab-case to PascalCase.
 */
export function toPascalCase(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Convert kebab-case to camelCase.
 */
function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Generate file content based on type.
 */
export function generateFileContent(
  name: string,
  fileName: string,
  fileType: string,
  definition: ComponentDefinition,
  isBlock: boolean
): string {
  const pascalName = toPascalCase(name);
  const camelName = toCamelCase(name);

  // Barrel export (index.ts)
  if (fileName === 'index.ts') {
    return generateBarrelExport(definition, pascalName);
  }

  // Type definitions
  if (fileType === 'types' || fileName.endsWith('.types.ts')) {
    return generateTypeDefinitions(name, pascalName, definition);
  }

  // Hook file
  if (fileType === 'hook' || fileName.startsWith('use')) {
    const hookName = fileName.replace('.ts', '');
    return generateHook(hookName, pascalName, definition, isBlock);
  }

  // Schema file (for forms)
  if (fileType === 'schema' || fileName.endsWith('.schema.ts')) {
    return generateSchema(name, pascalName, definition);
  }

  // Component file
  return generateComponent(name, pascalName, camelName, fileName, definition, isBlock);
}

/**
 * Generate barrel export file.
 */
function generateBarrelExport(definition: ComponentDefinition, pascalName: string): string {
  const exports: string[] = [];

  for (const file of definition.files) {
    if (file.path === 'index.ts') continue;

    const moduleName = file.path.replace(/\.tsx?$/, '.js');

    if (file.type === 'types' || file.path.endsWith('.types.ts')) {
      exports.push(`export type * from './${moduleName}';`);
    } else {
      exports.push(`export * from './${moduleName}';`);
    }
  }

  return `/**
 * ${definition.displayName || pascalName}
 *
 * ${definition.description || ''}
 *
 * @module @omnitron/prism/components/${definition.name}
 */

${exports.join('\n')}
`;
}

/**
 * Generate TypeScript type definitions.
 */
function generateTypeDefinitions(name: string, pascalName: string, definition: ComponentDefinition): string {
  const muiComponent = getMuiComponent(name);

  return `/**
 * ${pascalName} Type Definitions
 *
 * @module @omnitron/prism/components/${name}
 */

import type { ${muiComponent}Props as Mui${muiComponent}Props } from '@mui/material/${muiComponent}';

/**
 * Props for the ${pascalName} component.
 * Extends MUI ${muiComponent} with Prism-specific options.
 */
export interface ${pascalName}Props extends Mui${muiComponent}Props {
  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Ref type for ${pascalName} component.
 */
export type ${pascalName}Ref = HTMLDivElement;
`;
}

/**
 * Generate React hook.
 */
function generateHook(hookName: string, pascalName: string, definition: ComponentDefinition, isBlock: boolean): string {
  const camelHook = toCamelCase(hookName);

  if (isBlock) {
    return generateBlockHook(hookName, pascalName, definition);
  }

  return `/**
 * ${hookName} Hook
 *
 * Custom hook for ${definition.displayName || pascalName} component logic.
 *
 * @module @omnitron/prism/components/${definition.name}
 */

import { useState, useCallback, useMemo } from 'react';

/**
 * Options for ${camelHook} hook.
 */
export interface ${toPascalCase(hookName)}Options {
  /**
   * Initial state value.
   */
  initialValue?: boolean;
}

/**
 * Return type for ${camelHook} hook.
 */
export interface ${toPascalCase(hookName)}Return {
  /**
   * Current state value.
   */
  value: boolean;
  /**
   * Set value to true.
   */
  onOpen: () => void;
  /**
   * Set value to false.
   */
  onClose: () => void;
  /**
   * Toggle the value.
   */
  onToggle: () => void;
}

/**
 * Hook for managing ${definition.displayName || pascalName} state.
 *
 * @param options - Hook options
 * @returns State and handlers
 *
 * @example
 * \`\`\`tsx
 * function Example() {
 *   const { value, onOpen, onClose, onToggle } = ${camelHook}();
 *
 *   return (
 *     <button onClick={onToggle}>
 *       {value ? 'Open' : 'Closed'}
 *     </button>
 *   );
 * }
 * \`\`\`
 */
export function ${camelHook}(options: ${toPascalCase(hookName)}Options = {}): ${toPascalCase(hookName)}Return {
  const { initialValue = false } = options;

  const [value, setValue] = useState(initialValue);

  const onOpen = useCallback(() => setValue(true), []);
  const onClose = useCallback(() => setValue(false), []);
  const onToggle = useCallback(() => setValue((prev) => !prev), []);

  return useMemo(
    () => ({ value, onOpen, onClose, onToggle }),
    [value, onOpen, onClose, onToggle]
  );
}
`;
}

/**
 * Generate block-specific hook.
 */
function generateBlockHook(hookName: string, pascalName: string, definition: ComponentDefinition): string {
  const camelHook = toCamelCase(hookName);

  return `/**
 * ${hookName} Hook
 *
 * State management hook for ${definition.displayName || pascalName} block.
 *
 * @module @omnitron/prism/blocks/${definition.name}
 */

import { useState, useCallback, useMemo, useContext, createContext } from 'react';
import type { ReactNode } from 'react';

// =============================================================================
// TYPES
// =============================================================================

/**
 * State for ${pascalName} block.
 */
export interface ${pascalName}State {
  /**
   * Whether the sidebar/panel is open.
   */
  isOpen: boolean;
  /**
   * Whether the sidebar/panel is collapsed.
   */
  isCollapsed: boolean;
}

/**
 * Actions for ${pascalName} block.
 */
export interface ${pascalName}Actions {
  /**
   * Open the sidebar/panel.
   */
  open: () => void;
  /**
   * Close the sidebar/panel.
   */
  close: () => void;
  /**
   * Toggle open state.
   */
  toggle: () => void;
  /**
   * Collapse the sidebar.
   */
  collapse: () => void;
  /**
   * Expand the sidebar.
   */
  expand: () => void;
  /**
   * Toggle collapsed state.
   */
  toggleCollapse: () => void;
}

/**
 * Context value for ${pascalName}.
 */
export interface ${pascalName}ContextValue extends ${pascalName}State, ${pascalName}Actions {}

/**
 * Options for ${camelHook} hook.
 */
export interface ${toPascalCase(hookName)}Options {
  /**
   * Initial open state.
   */
  defaultOpen?: boolean;
  /**
   * Initial collapsed state.
   */
  defaultCollapsed?: boolean;
}

// =============================================================================
// CONTEXT
// =============================================================================

const ${pascalName}Context = createContext<${pascalName}ContextValue | null>(null);

/**
 * Provider props.
 */
export interface ${pascalName}ProviderProps extends ${toPascalCase(hookName)}Options {
  children: ReactNode;
}

/**
 * Provider component for ${pascalName} context.
 */
export function ${pascalName}Provider({
  children,
  defaultOpen = true,
  defaultCollapsed = false,
}: ${pascalName}ProviderProps) {
  const value = ${camelHook}({ defaultOpen, defaultCollapsed });

  return (
    <${pascalName}Context.Provider value={value}>
      {children}
    </${pascalName}Context.Provider>
  );
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook for managing ${definition.displayName || pascalName} state.
 *
 * @param options - Hook options
 * @returns State and actions
 *
 * @example
 * \`\`\`tsx
 * function ${pascalName}() {
 *   const { isOpen, isCollapsed, toggle, toggleCollapse } = ${camelHook}();
 *
 *   return (
 *     <div>
 *       <button onClick={toggle}>Toggle Open</button>
 *       <button onClick={toggleCollapse}>Toggle Collapse</button>
 *     </div>
 *   );
 * }
 * \`\`\`
 */
export function ${camelHook}(
  options: ${toPascalCase(hookName)}Options = {}
): ${pascalName}ContextValue {
  const context = useContext(${pascalName}Context);

  const { defaultOpen = true, defaultCollapsed = false } = options;

  const [isOpen, setIsOpen] = useState(context?.isOpen ?? defaultOpen);
  const [isCollapsed, setIsCollapsed] = useState(context?.isCollapsed ?? defaultCollapsed);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  const collapse = useCallback(() => setIsCollapsed(true), []);
  const expand = useCallback(() => setIsCollapsed(false), []);
  const toggleCollapse = useCallback(() => setIsCollapsed((prev) => !prev), []);

  return useMemo(
    () => ({
      isOpen,
      isCollapsed,
      open,
      close,
      toggle,
      collapse,
      expand,
      toggleCollapse,
    }),
    [isOpen, isCollapsed, open, close, toggle, collapse, expand, toggleCollapse]
  );
}

/**
 * Hook to consume ${pascalName} context.
 * Must be used within a ${pascalName}Provider.
 */
export function use${pascalName}Context(): ${pascalName}ContextValue {
  const context = useContext(${pascalName}Context);

  if (!context) {
    throw new Error('use${pascalName}Context must be used within a ${pascalName}Provider');
  }

  return context;
}
`;
}

/**
 * Generate Zod schema for forms.
 */
function generateSchema(name: string, pascalName: string, definition: ComponentDefinition): string {
  return `/**
 * ${pascalName} Schema
 *
 * Zod validation schemas for ${definition.displayName || pascalName} forms.
 *
 * @module @omnitron/prism/blocks/${definition.name}
 */

import { z } from 'zod';

/**
 * Login form schema.
 */
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(8, 'Password must be at least 8 characters'),
  rememberMe: z.boolean().optional(),
});

/**
 * Login form values type.
 */
export type LoginFormValues = z.infer<typeof loginSchema>;

/**
 * Register form schema.
 */
export const registerSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z
      .string()
      .min(1, 'Email is required')
      .email('Invalid email address'),
    password: z
      .string()
      .min(1, 'Password is required')
      .min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the terms' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/**
 * Register form values type.
 */
export type RegisterFormValues = z.infer<typeof registerSchema>;

/**
 * Forgot password form schema.
 */
export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address'),
});

/**
 * Forgot password form values type.
 */
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

/**
 * Verify code form schema.
 */
export const verifyCodeSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .length(6, 'Code must be 6 digits'),
});

/**
 * Verify code form values type.
 */
export type VerifyCodeFormValues = z.infer<typeof verifyCodeSchema>;
`;
}

/**
 * Generate React component.
 */
function generateComponent(
  name: string,
  pascalName: string,
  camelName: string,
  fileName: string,
  definition: ComponentDefinition,
  isBlock: boolean
): string {
  const componentName = fileName.replace(/\.tsx$/, '');
  const componentPascal = toPascalCase(componentName.replace(pascalName, '')) || pascalName;
  const muiComponent = getMuiComponent(name);

  if (isBlock) {
    return generateBlockComponent(name, componentName, componentPascal, definition);
  }

  return `'use client';

/**
 * ${componentPascal} Component
 *
 * ${definition.description || ''}
 *
 * @module @omnitron/prism/components/${definition.name}
 * @see https://mui.com/material-ui/react-${name}/
 */

import { forwardRef } from 'react';
import Mui${muiComponent} from '@mui/material/${muiComponent}';
import type { ${muiComponent}Props as Mui${muiComponent}Props } from '@mui/material/${muiComponent}';
import { clsx } from 'clsx';

/**
 * Props for the ${componentPascal} component.
 */
export interface ${componentPascal}Props extends Mui${muiComponent}Props {
  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * ${definition.displayName || componentPascal} component.
 *
 * A wrapper around MUI ${muiComponent} with Prism design system styling.
 *
 * @example
 * \`\`\`tsx
 * <${componentPascal} variant="contained" color="primary">
 *   Click me
 * </${componentPascal}>
 * \`\`\`
 */
export const ${componentPascal} = forwardRef<HTMLButtonElement, ${componentPascal}Props>(
  function ${componentPascal}({ className, ...props }, ref) {
    return (
      <Mui${muiComponent}
        ref={ref}
        className={clsx('prism-${name}', className)}
        {...props}
      />
    );
  }
);

${componentPascal}.displayName = '${componentPascal}';
`;
}

/**
 * Generate block component.
 */
function generateBlockComponent(
  name: string,
  componentName: string,
  componentPascal: string,
  definition: ComponentDefinition
): string {
  return `'use client';

/**
 * ${componentPascal} Component
 *
 * ${definition.description || ''}
 *
 * @module @omnitron/prism/blocks/${definition.name}
 */

import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import type { BoxProps } from '@mui/material/Box';
import { styled } from '@mui/material/styles';
import { clsx } from 'clsx';

/**
 * Props for the ${componentPascal} component.
 */
export interface ${componentPascal}Props extends Omit<BoxProps, 'children'> {
  /**
   * Content to render inside the component.
   */
  children?: ReactNode;
  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Styled root component.
 */
const ${componentPascal}Root = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
  backgroundColor: theme.palette.background.default,
}));

/**
 * ${definition.displayName || componentPascal} component.
 *
 * @example
 * \`\`\`tsx
 * <${componentPascal}>
 *   <Header />
 *   <Sidebar />
 *   <Main />
 * </${componentPascal}>
 * \`\`\`
 */
export const ${componentPascal} = forwardRef<HTMLDivElement, ${componentPascal}Props>(
  function ${componentPascal}({ className, children, ...props }, ref) {
    return (
      <${componentPascal}Root
        ref={ref}
        className={clsx('prism-${name}', className)}
        {...props}
      >
        {children}
      </${componentPascal}Root>
    );
  }
);

${componentPascal}.displayName = '${componentPascal}';
`;
}

/**
 * Get the MUI component name for a Prism component.
 */
function getMuiComponent(name: string): string {
  const mapping: Record<string, string> = {
    button: 'Button',
    'icon-button': 'IconButton',
    'text-field': 'TextField',
    select: 'Select',
    checkbox: 'Checkbox',
    switch: 'Switch',
    avatar: 'Avatar',
    badge: 'Badge',
    chip: 'Chip',
    tooltip: 'Tooltip',
    alert: 'Alert',
    snackbar: 'Snackbar',
    dialog: 'Dialog',
    progress: 'CircularProgress',
    card: 'Card',
    paper: 'Paper',
    accordion: 'Accordion',
    tabs: 'Tabs',
    breadcrumbs: 'Breadcrumbs',
    menu: 'Menu',
    stack: 'Stack',
    grid: 'Grid',
    container: 'Container',
    divider: 'Divider',
    'data-table': 'Table',
    table: 'Table',
    list: 'List',
  };

  return mapping[name] || toPascalCase(name);
}
