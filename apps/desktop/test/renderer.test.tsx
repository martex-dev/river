// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PLANNED } from '../src/renderer/src/features.ts';
import { STAGE_ONE, stageIndex } from '../src/renderer/src/pages/HomePage.tsx';
import { PlannedPage } from '../src/renderer/src/pages/PlannedPage.tsx';
import { groupHex } from '../src/renderer/src/pages/SecurityPage.tsx';
import { describeUpdate } from '../src/renderer/src/pages/SettingsPage.tsx';

afterEach(cleanup);

describe('renderer helpers', () => {
  it('places versions on the Stage 1 timeline', () => {
    expect(stageIndex('0.0.1')).toBe(0);
    expect(stageIndex('0.3.4')).toBe(3);
    expect(stageIndex('0.9.9')).toBe(9);
    expect(stageIndex('1.0.0')).toBe(STAGE_ONE.length - 1);
    expect(stageIndex('garbage')).toBe(0);
    expect(stageIndex(undefined)).toBe(0);
  });

  it('formats key IDs for reading aloud', () => {
    expect(groupHex('626db4cbb389fc32')).toBe('626D B4CB B389 FC32');
  });

  it('describes every update state in plain language', () => {
    expect(describeUpdate({ state: 'ready', version: '0.0.2' })).toMatch(/verified/);
    expect(describeUpdate({ state: 'verifying', version: '0.0.2' })).toMatch(/signature/);
    expect(describeUpdate({ state: 'downloading', version: '0.0.2', percent: 40 })).toMatch(/40%/);
    expect(describeUpdate({ state: 'error', message: 'boom' })).toBe('boom');
  });
});

describe('planned sections', () => {
  it('are explicitly labelled as not working yet', () => {
    for (const [section, feature] of Object.entries(PLANNED)) {
      render(<PlannedPage section={section as never} feature={feature!} />);
      expect(screen.getByText(/Nothing here works yet/)).toBeTruthy();
      expect(screen.getByText(feature!.arrives)).toBeTruthy();
      cleanup();
    }
  });

  it('no longer lists messaging as planned (it shipped end-to-end encrypted in 0.5.0)', () => {
    expect(PLANNED.messages).toBeUndefined();
  });
});
