import { defineLumenConfig } from '@omnitron-dev/lumen';

export default defineLumenConfig({
  title: 'Scientific Research Portal',
  tagline: 'Formal mathematical verification and interactive documentation',
  url: 'https://science.example.com',
  baseUrl: '/',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  katexMacros: {
    '\\R': '\\mathbb{R}',
    '\\C': '\\mathbb{C}',
    '\\N': '\\mathbb{N}',
    '\\braket': '\\langle #1 \\rangle',
    '\\cov': '\\operatorname{cov}',
    '\\norm': '\\left\\| #1 \\right\\|',
  },
  sidebars: {
    research: [
      { type: 'doc', id: 'kernel-foundations' },
      { type: 'doc', id: 'architectural-diagrams' },
      { type: 'doc', id: 'typescript-twoslash' },
    ],
  },
  pdf: {
    paperSections: ['kernel-foundations'],
  },
});
