// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/renderer/src/components/ErrorBoundary.tsx';

let broken = true;
function Page() {
  if (broken) throw new Error('stories[index] is undefined');
  return <p>Page is back</p>;
}

beforeEach(() => {
  broken = true;
  // React reports caught errors on the console; keep the test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('error boundary', () => {
  it('shows what went wrong and a Reload button instead of a blank window', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload }, configurable: true });
    render(
      <ErrorBoundary>
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    expect(screen.getByText('stories[index] is undefined')).toBeTruthy();
    fireEvent.click(screen.getByText('Reload'));
    expect(reload).toHaveBeenCalled();
  });

  it('around one page, only that page is replaced and it can be tried again', () => {
    render(
      <div>
        <nav>Rail</nav>
        <ErrorBoundary area="Social">
          <Page />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByText('Rail')).toBeTruthy();
    expect(screen.getByText(/Social could not be shown/)).toBeTruthy();
    broken = false;
    fireEvent.click(screen.getByText('Try again'));
    expect(screen.getByText('Page is back')).toBeTruthy();
  });

  it('draws the page again when another community, channel or conversation is picked', () => {
    const { rerender } = render(
      <ErrorBoundary area="Communities" resetKey="communities:a/1">
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Communities could not be shown/)).toBeTruthy();
    // Same view: the crash stays.
    rerender(
      <ErrorBoundary area="Communities" resetKey="communities:a/1">
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Communities could not be shown/)).toBeTruthy();
    broken = false;
    rerender(
      <ErrorBoundary area="Communities" resetKey="communities:b/2">
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Page is back')).toBeTruthy();
  });
});
