/**
 * The community list on the left (1.0.18): your own order and folders, kept on
 * this device. Pure functions so drag-and-drop can be tested without a UI.
 *
 * `order` holds community IDs and `folder:<id>` entries; communities inside a
 * folder are listed in the folder, not in `order`. Communities you join later
 * appear at the end; ones you leave disappear; empty folders vanish.
 */
export interface RailFolder {
  id: string;
  name: string;
  /** 0xRRGGBB */
  color: number;
  items: string[];
  open: boolean;
}

export interface Rail {
  order: string[];
  folders: RailFolder[];
}

export type RailEntry<C> =
  | { kind: 'community'; id: string; community: C }
  | { kind: 'folder'; id: string; folder: RailFolder; communities: C[] };

const FOLDER = 'folder:';
export const folderKey = (id: string): string => `${FOLDER}${id}`;

export const FOLDER_COLORS = [0x5865f2, 0x4fe3d1, 0x3ee08f, 0xf0b232, 0xf47fff, 0xed4245, 0x9aa7c7];

/** The list as shown: your order, folders with their communities, newcomers at the end. */
export function railEntries<C extends { id: string }>(communities: C[], rail: Rail): Array<RailEntry<C>> {
  const byId = new Map(communities.map((c) => [c.id, c]));
  const placed = new Set<string>();
  const out: Array<RailEntry<C>> = [];
  const folders = new Map(rail.folders.map((f) => [folderKey(f.id), f]));
  for (const key of rail.order) {
    const folder = folders.get(key);
    if (folder) {
      const inside = folder.items.filter((id) => byId.has(id) && !placed.has(id));
      inside.forEach((id) => placed.add(id));
      if (inside.length > 0)
        out.push({ kind: 'folder', id: folder.id, folder, communities: inside.map((id) => byId.get(id)!) });
    } else if (byId.has(key) && !placed.has(key)) {
      placed.add(key);
      out.push({ kind: 'community', id: key, community: byId.get(key)! });
    }
  }
  // Folders not in the order yet (should not happen) and communities never placed.
  for (const f of rail.folders) {
    if (rail.order.includes(folderKey(f.id))) continue;
    const inside = f.items.filter((id) => byId.has(id) && !placed.has(id));
    inside.forEach((id) => placed.add(id));
    if (inside.length)
      out.push({ kind: 'folder', id: f.id, folder: f, communities: inside.map((id) => byId.get(id)!) });
  }
  for (const c of communities) if (!placed.has(c.id)) out.push({ kind: 'community', id: c.id, community: c });
  return out;
}

/** The rail written back in its current shown order (drops gone communities and empty folders). */
export function normalize(rail: Rail, communityIds: string[]): Rail {
  const entries = railEntries(
    communityIds.map((id) => ({ id })),
    rail,
  );
  const folders = entries
    .filter((e): e is Extract<RailEntry<{ id: string }>, { kind: 'folder' }> => e.kind === 'folder')
    .map((e) => ({ ...e.folder, items: e.communities.map((c) => c.id) }));
  return {
    order: entries.map((e) => (e.kind === 'folder' ? folderKey(e.id) : e.id)),
    folders,
  };
}

export type DropPlace = 'before' | 'after' | 'into';

/**
 * Moves a community (dragged from the top level or from a folder) next to, or
 * into, a target (a community or a folder). Dropping a community onto another
 * top-level community makes a new folder of the two.
 */
export function moveCommunity(
  rail: Rail,
  communityIds: string[],
  dragged: string,
  target: { kind: 'community' | 'folder'; id: string },
  place: DropPlace,
  newFolderId: () => string,
): Rail {
  let r = normalize(rail, communityIds);
  if (target.kind === 'community' && target.id === dragged) return r;
  // Take it out of wherever it is.
  r = {
    order: r.order.filter((k) => k !== dragged),
    folders: r.folders.map((f) => ({ ...f, items: f.items.filter((id) => id !== dragged) })),
  };
  const folderOf = (id: string): RailFolder | undefined => r.folders.find((f) => f.items.includes(id));
  if (target.kind === 'folder') {
    const key = folderKey(target.id);
    if (place === 'into') {
      r.folders = r.folders.map((f) =>
        f.id === target.id ? { ...f, items: [...f.items, dragged], open: true } : f,
      );
    } else {
      const at = r.order.indexOf(key);
      r.order.splice(place === 'before' ? at : at + 1, 0, dragged);
    }
    return normalize(r, communityIds);
  }
  const inFolder = folderOf(target.id);
  if (inFolder) {
    // Next to a community inside a folder: join that folder at that spot.
    r.folders = r.folders.map((f) => {
      if (f !== inFolder) return f;
      const items = [...f.items];
      const at = items.indexOf(target.id);
      items.splice(place === 'before' ? at : at + 1, 0, dragged);
      return { ...f, items };
    });
    return normalize(r, communityIds);
  }
  const at = r.order.indexOf(target.id);
  if (place === 'into') {
    const folder: RailFolder = {
      id: newFolderId(),
      name: 'New folder',
      color: FOLDER_COLORS[0]!,
      items: [target.id, dragged],
      open: true,
    };
    r.order.splice(at, 1, folderKey(folder.id));
    r.folders = [...r.folders, folder];
  } else {
    r.order.splice(place === 'before' ? at : at + 1, 0, dragged);
  }
  return normalize(r, communityIds);
}

/** Moves a whole folder before or after another top-level entry. */
export function moveFolder(
  rail: Rail,
  communityIds: string[],
  folderId: string,
  targetKey: string,
  place: 'before' | 'after',
): Rail {
  const r = normalize(rail, communityIds);
  const key = folderKey(folderId);
  if (key === targetKey) return r;
  const order = r.order.filter((k) => k !== key);
  const at = order.indexOf(targetKey);
  if (at < 0) return r;
  order.splice(place === 'before' ? at : at + 1, 0, key);
  return { ...r, order };
}

/** Puts a folder's communities back at the top level where the folder was. */
export function ungroup(rail: Rail, communityIds: string[], folderId: string): Rail {
  const r = normalize(rail, communityIds);
  const folder = r.folders.find((f) => f.id === folderId);
  if (!folder) return r;
  const at = r.order.indexOf(folderKey(folderId));
  const order = [...r.order];
  order.splice(at, 1, ...folder.items);
  return { order, folders: r.folders.filter((f) => f.id !== folderId) };
}

export function updateFolder(
  rail: Rail,
  folderId: string,
  patch: Partial<Omit<RailFolder, 'id' | 'items'>>,
): Rail {
  return { ...rail, folders: rail.folders.map((f) => (f.id === folderId ? { ...f, ...patch } : f)) };
}
