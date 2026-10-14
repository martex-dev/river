import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
// Skin typography (1.0.45), bundled: River's security policy allows no web fonts.
import '@fontsource-variable/exo-2';
import '@fontsource-variable/orbitron';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/manrope';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/fira-code';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/vt323';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/community.css';
import './styles/social.css';
import './styles/people.css';
import './styles/discord.css';
import './styles/skins.css';
import './styles/design.css';
import './styles/motion.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { restoreCachedDesign } from './appearance/use-design.ts';

// Paint the last design before React starts, so River never flashes its fallback look.
restoreCachedDesign();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
