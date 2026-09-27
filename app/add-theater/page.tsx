'use client';

import { useActionState, useState, useEffect } from 'react';
import Link from 'next/link';
import { addTheater, findSimilarTheaters, SimilarTheater } from './actions';

const STATES = [
  'AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL',
  'IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE',
  'NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VA','VT','WA','WI','WV','WY',
];

const inputClass = 'w-full rounded-md border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent';

export default function AddTheaterPage() {
  const [formState, action, pending] = useActionState(addTheater, null);
  const [duplicates, setDuplicates] = useState<SimilarTheater[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [checking, setChecking] = useState(false);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (formState && 'success' in formState && formState.success) {
      setName('');
      setUrl('');
      setDuplicates([]);
      setConfirmed(false);
      setFormKey((k) => k + 1);
    }
  }, [formState]);

  async function checkDuplicates(nextName = name, nextUrl = url) {
    setChecking(true);
    try {
      const results = await findSimilarTheaters(nextName, nextUrl);
      setDuplicates(results);
      setConfirmed(false);
    } finally {
      setChecking(false);
    }
  }

  const blockSubmit = duplicates.length > 0 && !confirmed;

  return (
    <main className="max-w-xl mx-auto px-4 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Add theater</h1>
          <p className="text-muted-foreground text-sm mt-1">Add a new theater to the scraper</p>
        </div>
        <Link href="/" className="text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors mt-1">
          ← Back
        </Link>
      </header>

      {formState && 'success' in formState && formState.success && (
        <div className="mb-6 rounded-md border border-success-border bg-success-muted px-4 py-3 text-sm text-success">
          <span className="font-medium">{formState.theaterName}</span> was added successfully.{' '}
          <Link href="/" className="underline hover:text-success">Go back to the home page</Link>
        </div>
      )}

      <form key={formKey} action={action} className="flex flex-col gap-5">
        <div>
          <label className="block text-sm font-medium text-foreground/75 mb-1.5" htmlFor="name">
            Theater name <span className="text-destructive/70">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            className={inputClass}
            placeholder="e.g. Steppenwolf Theatre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={(e) => checkDuplicates(e.target.value, url)}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-foreground/75 mb-1.5" htmlFor="city">
              City <span className="text-destructive/70">*</span>
            </label>
            <input id="city" name="city" type="text" required className={inputClass} placeholder="e.g. Chicago" />
          </div>
          <div className="w-28">
            <label className="block text-sm font-medium text-foreground/75 mb-1.5" htmlFor="state">
              State <span className="text-destructive/70">*</span>
            </label>
            <select id="state" name="state" required className={inputClass}>
              <option value="">—</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground/75 mb-1.5" htmlFor="audition_page_url">
            Audition page URL
          </label>
          <input
            id="audition_page_url"
            name="audition_page_url"
            type="url"
            className={inputClass}
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={(e) => checkDuplicates(name, e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground/75 mb-1.5" htmlFor="notes">
            Notes
          </label>
          <textarea id="notes" name="notes" rows={3} className={inputClass} placeholder="e.g. Cloudflare protected, check back manually" />
        </div>

        {checking && (
          <p className="text-sm text-muted-foreground/80">Checking for duplicates…</p>
        )}

        {!checking && duplicates.length > 0 && (
          <div className="rounded-md border border-warning-border bg-warning-muted p-4">
            <p className="text-sm font-medium text-warning mb-2">
              Similar theaters already exist — double-check before saving:
            </p>
            <ul className="text-sm text-warning space-y-1 mb-3">
              {duplicates.map((t) => (
                <li key={t.id}>
                  <span className="font-medium">{t.name}</span>
                  {' — '}{t.city}, {t.state}
                  {t.audition_page_url && (
                    <> · <a href={t.audition_page_url} target="_blank" rel="noreferrer" className="underline hover:text-warning">{t.audition_page_url}</a></>
                  )}
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2 text-sm text-warning cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I've reviewed these and this is a different theater
            </label>
          </div>
        )}

        {'error' in (formState ?? {}) && (
          <p className="text-sm text-destructive">{(formState as { error: string }).error}</p>
        )}

        <button
          type="submit"
          disabled={pending || blockSubmit}
          className="self-start rounded-md bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? 'Saving…' : 'Add theater'}
        </button>
      </form>
    </main>
  );
}
