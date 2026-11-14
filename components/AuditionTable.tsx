import Link from 'next/link';
import { Audition } from '@/lib/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Props {
  auditions: Audition[];
  sort: string;
  direction: string;
  basePath: string;
  query?: string;
  /**
   * Miles from the location the reader entered, keyed by audition id. Absent
   * entirely when no location is set, which is what hides the column. The
   * other columns sort through the URL; this one cannot, because the distances
   * only exist in the browser -- so it gets its own handler.
   */
  distances?: Map<string, number>;
  distanceSort?: 'asc' | 'desc';
  onSortByDistance?: () => void;
}

export default function AuditionTable({
  auditions,
  sort,
  direction,
  basePath,
  query = '',
  distances,
  distanceSort,
  onSortByDistance,
}: Props) {
  const showDistance = distances !== undefined;

  return (
    <>
    <p className="mb-2 text-xs text-muted-foreground/80 flex items-center gap-3">
      <span><span className="text-success font-semibold">✓</span> confirmed yes</span>
      <span><span className="text-muted-foreground/80">✕</span> confirmed no</span>
      <span>blank = not listed in posting</span>
    </p>
    <div className="rounded-lg border border-border overflow-hidden">
      <Table className="table-fixed w-full">
        <colgroup>
          <col className={showDistance ? 'w-[22%]' : 'w-[24%]'} />
          <col className={showDistance ? 'w-[21%]' : 'w-[24%]'} />
          <col className={showDistance ? 'w-[19%]' : 'w-[22%]'} />
          {showDistance && <col className="w-[9%]" />}
          <col className={showDistance ? 'w-[9%]' : 'w-[10%]'} />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
        </colgroup>
        <TableHeader className="bg-muted">
          <TableRow className="border-b border-border hover:bg-muted">
            <SortableHead column="theater_name" sort={sort} direction={direction} basePath={basePath}>
              Theater
            </SortableHead>
            <SortableHead column="show_name" sort={sort} direction={direction} basePath={basePath}>
              Show
            </SortableHead>
            <SortableHead column="audition_dates" sort={sort} direction={direction} basePath={basePath}>
              Audition dates
            </SortableHead>
            {showDistance && (
              <DistanceHead direction={distanceSort} onClick={onSortByDistance} />
            )}
            <SortableHead column="is_paid" sort={sort} direction={direction} basePath={basePath} center>
              Paid
            </SortableHead>
            <SortableHead column="non_union_ok" sort={sort} direction={direction} basePath={basePath} center>
              Non-union OK
            </SortableHead>
            <SortableHead column="housing" sort={sort} direction={direction} basePath={basePath} center>
              Housing
            </SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {auditions.map((a) => (
            <TableRow
              key={a.id}
              className="odd:bg-background even:bg-muted/60 hover:bg-link/10 border-b border-border/60 transition-colors"
            >
              <TableCell className="px-4 py-3 whitespace-normal">
                <p className="font-medium text-foreground truncate">
                  {a.source_url ? (
                    <a
                      href={a.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-link hover:underline transition-colors"
                    >
                      <Highlight text={a.theater?.name ?? ''} query={query} />
                    </a>
                  ) : (
                    <Highlight text={a.theater?.name ?? ''} query={query} />
                  )}
                </p>
                <p className="text-xs text-muted-foreground/80">{a.theater?.city}, {a.theater?.state}</p>
              </TableCell>
              <TableCell className="px-4 py-3 text-foreground/75 whitespace-normal">
                <span className="line-clamp-2">
                  {a.show_name
                    ? <Highlight text={a.show_name} query={query} />
                    : <span className="text-muted-foreground/50">—</span>}
                </span>
              </TableCell>
              <TableCell className="px-4 py-3 text-foreground/75 whitespace-normal">
                {a.audition_dates ?? <span className="text-muted-foreground/50">—</span>}
              </TableCell>
              {showDistance && (
                <TableCell className="px-4 py-3 text-center tabular-nums text-foreground/75">
                  <Distance miles={distances.get(a.id)} />
                </TableCell>
              )}
              <TableCell className="px-4 py-3 text-center">
                <Flag value={a.is_paid} />
              </TableCell>
              <TableCell className="px-4 py-3 text-center">
                <Flag value={a.non_union_ok} />
              </TableCell>
              <TableCell className="px-4 py-3 text-center">
                <HousingFlag value={a.housing} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    </>
  );
}

function StaticHead({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <TableHead
      className={`px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide ${center ? 'text-center' : ''}`}
    >
      {children}
    </TableHead>
  );
}

function SortableHead({
  children,
  column,
  sort,
  direction,
  basePath,
  center,
}: {
  children: React.ReactNode;
  column: string;
  sort: string;
  direction: string;
  basePath: string;
  center?: boolean;
}) {
  const isActive = sort === column;
  const nextDir = isActive && direction === 'asc' ? 'desc' : 'asc';
  const href = `${basePath}?sort=${column}&dir=${nextDir}`;

  return (
    <TableHead className={`p-0 ${center ? 'text-center' : ''}`}>
      <Link
        href={href}
        className={`flex items-center gap-1 px-4 py-3 text-xs font-semibold uppercase tracking-wide transition-colors ${
          center ? 'justify-center' : ''
        } ${isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/75'}`}
      >
        {children}
        <span className="text-[10px]">
          {isActive ? (direction === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </Link>
    </TableHead>
  );
}

/**
 * Mirrors SortableHead's look, but toggles in place instead of navigating:
 * following a link would drop the location the distances were measured from.
 */
function DistanceHead({
  direction,
  onClick,
}: {
  direction?: 'asc' | 'desc';
  onClick?: () => void;
}) {
  return (
    <TableHead className="p-0 text-center">
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center justify-center gap-1 px-4 py-3 text-xs font-semibold uppercase tracking-wide transition-colors ${
          direction ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/75'
        }`}
      >
        Distance
        <span className="text-[10px]">
          {direction ? (direction === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </TableHead>
  );
}

function Distance({ miles }: { miles?: number }) {
  if (miles === undefined) return <span className="text-muted-foreground/50">—</span>;
  return <span>{Math.round(miles)} mi</span>;
}

function Flag({ value }: { value: boolean | null }) {
  if (value === true) return <span className="text-success font-semibold">✓</span>;
  if (value === false) return <span className="text-muted-foreground/80">✕</span>;
  return null;
}

function HousingFlag({ value }: { value: string }) {
  if (value === 'yes') return <span className="text-success font-semibold">✓</span>;
  if (value === 'no') return <span className="text-muted-foreground/80">✕</span>;
  return null;
}

function Highlight({ text, query }: { text: string; query: string }) {
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
