import type { Section } from './store.ts';

export interface PlannedFeature {
  title: string;
  tagline: string;
  arrives: string;
  capabilities: string[];
  note: string;
}

/** Sections that are designed but not yet built. Copy must stay honest: nothing here works yet. */
export const PLANNED: Partial<Record<Section, PlannedFeature>> = {
  social: {
    title: 'Social',
    tagline: 'Profiles, posts and stories shared with exactly the people you choose.',
    arrives: '0.7.x',
    capabilities: [
      'Profiles with avatar, bio and links',
      'Photo and video posts, stories and collections',
      'Reactions and comments',
      'Friends, followers and audience controls per post',
      'Share any post straight into an encrypted chat',
    ],
    note: 'Posts for friends or selected people are encrypted for that audience only.',
  },
  calls: {
    title: 'Calls',
    tagline: 'Voice and video, one-to-one or in groups, with verified encryption.',
    arrives: '0.8.x',
    capabilities: [
      'Encrypted voice and video calls',
      'Group calls and voice channels',
      'Screen sharing',
      'Microphone, camera and speaker selection',
      'Call history kept on your device',
    ],
    note: 'Calls use WebRTC. Group calls use frame encryption so the relay cannot decode audio or video.',
  },
  files: {
    title: 'Files',
    tagline: 'Your encrypted vault for images, video, documents and voice notes.',
    arrives: '0.5.x',
    capabilities: [
      'Folders, favourites and recent files',
      'Shared with me / shared by me',
      'Previews and thumbnails generated locally',
      'Search across your files on-device',
    ],
    note: 'Files are encrypted on your device before upload. The server stores only ciphertext.',
  },
  contacts: {
    title: 'Contacts',
    tagline: 'People you trust, verified with fingerprints — no phone number required.',
    arrives: '0.1.x',
    capabilities: [
      'Find people by username, only if they allow it',
      'Contact requests and blocking',
      'Identity verification with safety numbers and QR codes',
      'Warnings when someone’s keys change',
    ],
    note: 'River never uploads your address book.',
  },
};
