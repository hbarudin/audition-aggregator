'use client';

import { useActionState } from 'react';
import { login, LoginState } from './actions';

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col gap-1">
        <label htmlFor="key" className="text-sm font-medium text-foreground/75">
          Admin key
        </label>
        <input
          id="key"
          name="key"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          className="rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {state && <p className="text-sm text-destructive">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/85 transition-colors disabled:opacity-40"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
