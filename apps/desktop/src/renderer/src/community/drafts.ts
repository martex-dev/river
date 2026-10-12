import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/** Unsent text per channel or conversation while River is open (1.0.20). Never written to disk. */
const drafts = new Map<string, string>();

export function readDraft(key: string): string {
  return drafts.get(key) ?? '';
}

export function saveDraft(key: string, text: string): void {
  if (text) drafts.set(key, text);
  else drafts.delete(key);
}

/** Like useState(''), but each key keeps its own text when you switch away and back. */
export function useDraft(key: string): [string, Dispatch<SetStateAction<string>>] {
  const [text, setText] = useState(() => readDraft(key));
  const owner = useRef(key);
  const latest = useRef(text);
  useEffect(() => {
    latest.current = text;
  }, [text]);
  useEffect(() => {
    if (owner.current === key) return;
    saveDraft(owner.current, latest.current);
    owner.current = key;
    setText(readDraft(key));
  }, [key]);
  useEffect(() => () => saveDraft(owner.current, latest.current), []);
  return [text, setText];
}
