import { z } from 'zod';
import type { CorpusGate } from '../gates/types.js';

export const LumenSidebarDocItemSchema = z.object({
  type: z.literal('doc'),
  id: z.string(),
  label: z.string().optional(),
});

export const LumenSidebarLinkItemSchema = z.object({
  type: z.literal('link'),
  label: z.string(),
  href: z.string(),
});

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
  })
);

export const LumenSidebarItemSchema: z.ZodType<LumenSidebarItem> = z.union([
  LumenSidebarDocItemSchema,
  LumenSidebarLinkItemSchema,
  LumenSidebarCategoryItemSchema,
]);

export const LumenThemeConfigSchema = z.object({
  defaultMode: z.enum(['light', 'dark']).default('dark'),
});

export const LumenTitanConfigSchema = z.object({
  url: z.string().optional(),
  enabled: z.boolean().default(false),
});

export const LumenPdfConfigSchema = z.object({
  enabled: z.boolean().default(false),
  paperSections: z.array(z.string()).default([]),
});

export const LumenLocalesConfigSchema = z.union([
  z.array(z.string()),
  z.object({
    defaultLocale: z.string(),
    locales: z.array(z.string()),
  }),
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
  sidebars: z.record(z.string(), z.array(LumenSidebarItemSchema)).optional(),
  katexMacros: z.record(z.string(), z.string()).optional(),
  locales: LumenLocalesConfigSchema.optional(),
  defaultLocale: z.string().optional(),
  theme: LumenThemeConfigSchema.partial().optional(),
  gates: z.array(z.custom<CorpusGate>()).optional(),
  pdf: LumenPdfConfigSchema.partial().optional(),
  titan: LumenTitanConfigSchema.partial().optional(),
});

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
  sidebars: Record<string, LumenSidebarItem[]>;
  katexMacros: Record<string, string>;
  locales: string[];
  defaultLocale: string;
  theme: {
    defaultMode: 'light' | 'dark';
  };
  gates: CorpusGate[];
  pdf?: {
    enabled: boolean;
    paperSections: string[];
  };
  titan?: {
    url?: string;
    enabled: boolean;
  };
}
