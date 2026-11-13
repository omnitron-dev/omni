import { z } from 'zod';
import type { CorpusGate } from '../gates/types.js';
import type { ReactNode } from 'react';
import type { CorpusDocument } from '../corpus/types.js';

/** Layouts receive only the audience-projected corpus, never restricted source. */
export interface LumenPageLayoutProps {
  children: ReactNode;
  document: CorpusDocument;
  documents: readonly CorpusDocument[];
  config: LumenConfig;
}

export const LumenSidebarDocItemSchema = z.object({
  type: z.literal('doc'),
  id: z.string(),
  label: z.string().optional(),
}).strict();

export const LumenSidebarLinkItemSchema = z.object({
  type: z.literal('link'),
  label: z.string(),
  href: z.string(),
}).strict();

export type LumenSidebarItem =
  | z.infer<typeof LumenSidebarDocItemSchema>
  | z.infer<typeof LumenSidebarLinkItemSchema>
  | {
      type: 'category';
      label: string;
      items: LumenSidebarItem[];
      collapsed?: boolean;
      href?: string;
    };

export const LumenSidebarCategoryItemSchema: z.ZodType<LumenSidebarItem> = z.lazy(() =>
  z.object({
    type: z.literal('category'),
    label: z.string(),
    items: z.array(LumenSidebarItemSchema),
    collapsed: z.boolean().optional(),
    href: z.string().optional(),
  }).strict()
);

export const LumenSidebarItemSchema: z.ZodType<LumenSidebarItem> = z.union([
  LumenSidebarDocItemSchema,
  LumenSidebarLinkItemSchema,
  LumenSidebarCategoryItemSchema,
]);

export const LumenThemeConfigSchema = z.object({
  defaultMode: z.enum(['light', 'dark']).default('dark'),
  layout: z.custom<(props: LumenPageLayoutProps) => ReactNode>(value => typeof value === 'function', 'Expected a layout function').optional(),
}).strict();

export const LumenPdfConfigSchema = z.object({
  paperSections: z.array(z.string()).default([]),
}).strict();

const exampleGroup = z.object({
  sources: z.record(z.string().min(1), z.string().min(1)),
  language: z.string().regex(/^[\w.+#-]+$/).default('tsx'),
  labels: z.object({ source: z.string().min(1).optional() }).strict().optional(),
}).strict();

export const LumenLocalesConfigSchema = z.union([
  z.array(z.string()),
  z.object({
    defaultLocale: z.string(),
    locales: z.array(z.string()),
  }).strict(),
]);

export const LumenUserConfigSchema = z.object({
  title: z.string().min(1, 'Project title is required'),
  tagline: z.string().optional(),
  url: z.string().optional(),
  baseUrl: z.string().optional(),
  trailingSlash: z.boolean().optional(),
  onBrokenLinks: z.enum(['throw', 'warn', 'ignore', 'log']).optional(),
  onBrokenAnchors: z.enum(['throw', 'warn', 'ignore', 'log']).optional(),
  srcDir: z.string().optional(),
  outDir: z.string().optional(),
  publicDir: z.string().optional(),
  pagesDir: z.string().optional(),
  clientEntry: z.string().optional(),
  examples: z.record(z.string().min(1), exampleGroup).optional(),
  stylesheets: z.array(z.string()).optional(),
  sidebars: z.record(z.string(), z.array(LumenSidebarItemSchema)).optional(),
  katexMacros: z.record(z.string(), z.string()).optional(),
  locales: LumenLocalesConfigSchema.optional(),
  defaultLocale: z.string().optional(),
  theme: LumenThemeConfigSchema.partial().optional(),
  gates: z.array(z.custom<CorpusGate>(value =>
    typeof value === 'object' && value !== null &&
    typeof (value as CorpusGate).name === 'string' && typeof (value as CorpusGate).run === 'function',
  'Expected a gate with name and run(context)')).optional(),
  pdf: LumenPdfConfigSchema.partial().optional(),
}).strict();

export type LumenUserConfig = z.input<typeof LumenUserConfigSchema>;

export interface LumenConfig {
  title: string;
  tagline?: string;
  url?: string;
  baseUrl: string;
  trailingSlash?: boolean;
  onBrokenLinks?: 'throw' | 'warn' | 'ignore' | 'log';
  onBrokenAnchors?: 'throw' | 'warn' | 'ignore' | 'log';
  srcDir: string;
  outDir: string;
  publicDir?: string;
  pagesDir?: string;
  clientEntry?: string;
  examples?: Record<string, z.output<typeof exampleGroup>>;
  stylesheets?: string[];
  sidebars: Record<string, LumenSidebarItem[]>;
  katexMacros: Record<string, string>;
  locales: string[];
  defaultLocale: string;
  theme: {
    defaultMode: 'light' | 'dark';
    layout?: (props: LumenPageLayoutProps) => ReactNode;
  };
  gates: CorpusGate[];
  pdf?: {
    paperSections: string[];
  };
}
