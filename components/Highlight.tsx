/**
 * Wraps each occurrence of `query` in a <mark>. Lives on its own because both
 * the table and the card render search hits, and importing it from the table
 * would make the two files circular.
 */
export default function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const needle = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let last = 0;
  let idx = text.toLowerCase().indexOf(needle);
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <mark key={idx} className="bg-highlight text-highlight-foreground rounded-sm">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    last = idx + needle.length;
    idx = text.toLowerCase().indexOf(needle, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
