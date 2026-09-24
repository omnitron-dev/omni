import type { ElementType, ReactNode } from 'react';

/** The words a sponsored slot says itself; every other word is the caller's content. */
export interface SponsoredSlotLabels {
  /** What marks the slot as advertising when no advertiser is named. */
  sponsored: string;
}

export const DEFAULT_SPONSORED_SLOT_LABELS: SponsoredSlotLabels = {
  sponsored: 'Sponsored',
};

/** What one placement shows — already in the reader's language. */
export interface SponsoredSlotContent {
  title: string;
  body?: string | null;
  image?: string | null;
  /** A logo is fitted, never cropped; a cover fills its frame. */
  imageFit?: 'cover' | 'contain';
  /** «By <advertiser>» — the caller's sentence; `labels.sponsored` when absent. */
  byline?: string | null;
  /** Why it is here: the page's own context, never anything about the reader. */
  because?: string | null;
  /** The call to action, when the slot leads somewhere. */
  cta?: string | null;
}

export interface SponsoredSlotProps {
  /** Nothing to show collapses the slot: no frame, no gap, no «empty ad». */
  content: SponsoredSlotContent | null | undefined;
  /** `tile` sits in a row of cards; `banner` takes a column's width. */
  variant?: 'tile' | 'banner';
  /**
   * The placement is still being asked for: the slot keeps its box so the page
   * does not jump when it arrives — and collapses if nothing does.
   */
  loading?: boolean;
  labels?: Partial<SponsoredSlotLabels>;
  /** The mark beside the byline; the caller's icon set. */
  icon?: ReactNode;
  /** Where the slot leads — a router link, an anchor. Absent, it is not clickable. */
  link?: { component: ElementType; props?: Record<string, unknown> };
  /** Called when the reader follows the link, after the navigation starts. */
  onOpen?: () => void;
  /** Rendered as `data-sponsored`, for the caller's own reporting and tests. */
  id?: string;
}
