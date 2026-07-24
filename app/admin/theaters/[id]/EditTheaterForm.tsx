'use client';

import { useActionState, useState } from 'react';
import { updateTheater, UpdateState } from './actions';
import { Theater } from '@/lib/types';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
];

export default function EditTheaterForm({
  theater,
  adminKey,
}: {
  theater: Theater;
  adminKey: string;
}) {
  const [isActive, setIsActive] = useState(theater.is_active);
  const [state, action, pending] = useActionState<UpdateState, FormData>(updateTheater, null);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={theater.id} />
      <input type="hidden" name="key" value={adminKey} />
      <input type="hidden" name="is_active" value={String(isActive)} />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Name</label>
        <input
          name="name"
          defaultValue={theater.name}
          required
          className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">City</label>
          <input
            name="city"
            defaultValue={theater.city}
            required
            className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">State</label>
          <select
            name="state"
            defaultValue={theater.state}
            required
            className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Audition page URL</label>
        <input
          name="audition_page_url"
          defaultValue={theater.audition_page_url ?? ''}
          type="url"
          className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Notes</label>
        <textarea
          name="notes"
          defaultValue={theater.notes}
          rows={3}
          className="rounded-md border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="rounded"
        />
        <span className="text-sm font-medium text-gray-700">Active (included in scrapes)</span>
      </label>

      {state && 'error' in state && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {state && 'success' in state && (
        <p className="text-sm text-green-600">Saved.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-gray-900 text-white text-sm font-medium px-4 py-2 hover:bg-gray-700 transition-colors disabled:opacity-40"
      >
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
