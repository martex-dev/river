// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatDuration, isVoiceMessage, VoiceNote } from '../src/renderer/src/components/VoiceMessage.tsx';

afterEach(cleanup);

describe('voice messages', () => {
  it('are audio attachments named voice-message-…', () => {
    expect(isVoiceMessage('voice-message-12s.webm', 'audio/webm')).toBe(true);
    expect(isVoiceMessage('song.mp3', 'audio/mpeg')).toBe(false);
    expect(isVoiceMessage('voice-message-1s.webm', 'image/png')).toBe(false);
  });

  it('formats durations like a phone', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9.6)).toBe('0:10');
    expect(formatDuration(125)).toBe('2:05');
  });

  it('shows the recorded length before playing and cycles playback speed', () => {
    render(<VoiceNote url="blob:x" name="voice-message-75s.webm" />);
    expect(screen.getByText('1:15')).toBeTruthy();
    const speed = screen.getByRole('button', { name: /Playback speed 1×/ });
    fireEvent.click(speed);
    expect(screen.getByRole('button', { name: /Playback speed 1.5×/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Playback speed 1.5×/ }));
    fireEvent.click(screen.getByRole('button', { name: /Playback speed 2×/ }));
    expect(screen.getByRole('button', { name: /Playback speed 1×/ })).toBeTruthy();
  });
});
