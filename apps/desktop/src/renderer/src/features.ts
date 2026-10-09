import type { Section } from './store.ts';

export interface PlannedFeature {
  title: string;
  tagline: string;
  arrives: string;
  capabilities: string[];
  note: string;
}

/** Sections that are designed but not yet built. Copy must stay honest: nothing here works yet. */
export const PLANNED: Partial<Record<Section, PlannedFeature>> = {};
