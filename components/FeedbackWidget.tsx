'use client';

import { useActionState, useState, useEffect } from 'react';
import { submitFeedback } from '@/app/actions/feedback';

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(submitFeedback, null);

  useEffect(() => {
    if (state?.success) {
      const timer = setTimeout(() => setOpen(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [state?.success]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-72 rounded-lg border border-gray-200 bg-white shadow-lg p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-800">Send feedback</p>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {state?.success ? (
            <p className="text-sm text-green-600">Thanks! We&rsquo;ll look into it.</p>
          ) : (
            <form action={action} className="flex flex-col gap-3">
              <textarea
                name="message"
                rows={4}
                required
                placeholder="e.g. Atlantic Theater Company only holds union auditions"
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
              {state?.error && (
                <p className="text-xs text-red-600">{state.error}</p>
              )}
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-gray-900 text-white text-sm font-medium px-3 py-1.5 hover:bg-gray-700 transition-colors disabled:opacity-40"
              >
                {pending ? 'Sending…' : 'Send'}
              </button>
            </form>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full bg-gray-900 text-white text-xs font-medium px-3 py-1.5 hover:bg-gray-700 transition-colors shadow-md"
      >
        Feedback
      </button>
    </div>
  );
}
