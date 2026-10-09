/**
 * Sidebar order: channels without a category first, then each category with
 * its channels. Pure functions shared by main (renumbering) and the renderer
 * (drag and drop), so both agree on what a move means.
 */
export interface LayoutChannel {
  id: string;
  kind: 'text' | 'voice';
  position: number;
  parentId: string | null;
}
export interface LayoutCategory {
  id: string;
  position: number;
}
export interface ChannelGroup<C extends LayoutChannel, K extends LayoutCategory> {
  category: K | null;
  channels: C[];
}
export interface LayoutChange {
  categories: Array<{ id: string; position: number }>;
  channels: Array<{ id: string; position: number; parentId: string | null }>;
}

const byPosition = (a: LayoutChannel, b: LayoutChannel): number =>
  a.position - b.position || (a.kind === b.kind ? 0 : a.kind === 'text' ? -1 : 1) || a.id.localeCompare(b.id);

export function groupChannels<C extends LayoutChannel, K extends LayoutCategory>(
  channels: readonly C[],
  categories: readonly K[],
): Array<ChannelGroup<C, K>> {
  const cats = [...categories].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const known = new Set(cats.map((k) => k.id));
  const loose = channels.filter((c) => c.parentId === null || !known.has(c.parentId)).sort(byPosition);
  return [
    { category: null, channels: loose },
    ...cats.map((k) => ({
      category: k,
      channels: channels.filter((c) => c.parentId === k.id).sort(byPosition),
    })),
  ];
}

/**
 * The groups as the sidebar shows them. Without categories, text channels
 * come before voice channels (the 0.x layout).
 */
export function sidebarGroups<C extends LayoutChannel, K extends LayoutCategory>(
  channels: readonly C[],
  categories: readonly K[],
): Array<ChannelGroup<C, K>> {
  const groups = groupChannels(channels, categories);
  if (categories.length > 0) return groups;
  const loose = groups[0]!.channels;
  return [
    {
      category: null,
      channels: [...loose.filter((c) => c.kind === 'text'), ...loose.filter((c) => c.kind !== 'text')],
    },
  ];
}

/** Moves a channel into `parentId` (null: no category) at `index` within that group. */
export function moveChannel<C extends LayoutChannel, K extends LayoutCategory>(
  groups: ReadonlyArray<ChannelGroup<C, K>>,
  channelId: string,
  parentId: string | null,
  index: number,
): Array<ChannelGroup<C, K>> {
  const channel = groups.flatMap((g) => g.channels).find((c) => c.id === channelId);
  if (!channel) return groups.map((g) => ({ ...g, channels: [...g.channels] }));
  return groups.map((g) => {
    const rest = g.channels.filter((c) => c.id !== channelId);
    if ((g.category?.id ?? null) !== parentId) return { ...g, channels: rest };
    const at = Math.max(0, Math.min(index, rest.length));
    return { ...g, channels: [...rest.slice(0, at), channel, ...rest.slice(at)] };
  });
}

/** Moves a category to `index` among the categories. */
export function moveCategory<C extends LayoutChannel, K extends LayoutCategory>(
  groups: ReadonlyArray<ChannelGroup<C, K>>,
  categoryId: string,
  index: number,
): Array<ChannelGroup<C, K>> {
  const [loose, ...cats] = groups;
  const moving = cats.find((g) => g.category?.id === categoryId);
  if (!loose || !moving) return [...groups];
  const rest = cats.filter((g) => g !== moving);
  const at = Math.max(0, Math.min(index, rest.length));
  return [loose, ...rest.slice(0, at), moving, ...rest.slice(at)];
}

/**
 * The positions implied by `groups`, minus what is already true: only the
 * categories and channels that actually move are sent to the server.
 */
export function layoutChanges(
  groups: ReadonlyArray<ChannelGroup<LayoutChannel, LayoutCategory>>,
): LayoutChange {
  const change: LayoutChange = { categories: [], channels: [] };
  let category = 0;
  let position = 0;
  for (const g of groups) {
    if (g.category) {
      if (g.category.position !== category) change.categories.push({ id: g.category.id, position: category });
      category++;
    }
    const parentId = g.category?.id ?? null;
    for (const c of g.channels) {
      if (c.position !== position || c.parentId !== parentId)
        change.channels.push({ id: c.id, position, parentId });
      position++;
    }
  }
  return change;
}
