import type { ReactNode } from 'react';
import { useHint } from '../lib/hints';

/**
 * An explanation that retires itself: rendered the first three times
 * its screen is opened, then gone (lib/hints.ts). `after` is an optional
 * few-word replacement that stays once the full text has retired.
 * Never wrap errors or warnings in this — only "how this works" text.
 */
export default function Hint({ id, children, after }: { id: string; children: ReactNode; after?: ReactNode }) {
  const show = useHint(id);
  return <>{show ? children : after ?? null}</>;
}
