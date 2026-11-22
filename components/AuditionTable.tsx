import Link from 'next/link';
import { Audition } from '@/lib/types';
import AuditionCard from '@/components/AuditionCard';
import Highlight from '@/components/Highlight';
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
  /**
   * Called when a column header is clicked, so the client-side distance sort
   * can stand down and let the URL's sort govern again. The navigation alone
   * cannot say it: clicking the column the URL already names asc produces the
   * same URL and no navigation at all.
   */
  onSortByColumn?: () => void;
}

/**
 * The sortable columns as the mobile chips label them -- shorter than the
 * table headings, which have a full column width to spread into.
 */
const COLUMNS: { column: string; short: string }[] = [
  { column: 'theater_name', short: 'Theater' },
  { column: 'show_name', short: 'Show' },
  { column: 'audition_dates', short: 'Dates' },
  { column: 'is_paid', short: 'Paid' },
  { column: 'non_union_ok', short: 'Non-union' },
  { column: 'housing', short: 'Housing' },
];

export default function AuditionTable({
  auditions,
  sort,
  direction,
  basePath,
  query = '',
  distances,
  distanceSort,
  onSortByDistance,
  onSortByColumn,
}: Props) {
  const showDistance = distances !== undefined;
  // Only one sort can be in force, so while distance holds it the column
  // headers read as unsorted -- a second lit-up arrow is how this looked
  // broken in the first place.
  const activeColumn = showDistance && distanceSort ? '' : sort;

  return (
    <>
      {/* Narrow screens: the seven columns cannot survive a phone, so each row
          becomes a card and the headers become a row of sort chips. */}
      <div className="md:hidden">
        <MobileSort
          sort={activeColumn}
          direction={direction}
          basePath={basePath}
          showDistance={showDistance}
          distanceSort={distanceSort}
          onSortByDistance={onSortByDistance}
          onSortByColumn={onSortByColumn}
        />
        <div className="space-y-3">
          {auditions.map((a) => (
            <AuditionCard
              key={a.id}
              audition={a}
              query={query}
              miles={distances?.get(a.id)}
            />
          ))}
        </div>
      </div>

      <div className="hidden md:block">
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
                <SortableHead column="theater_name" sort={activeColumn} direction={direction} basePath={basePath} onClick={onSortByColumn}>
                  Theater
                </SortableHead>
                <SortableHead column="show_name" sort={activeColumn} direction={direction} basePath={basePath} onClick={onSortByColumn}>
                  Show
                </SortableHead>
                <SortableHead column="audition_dates" sort={activeColumn} direction={direction} basePath={basePath} onClick={onSortByColumn}>
                  Audition dates
                </SortableHead>
                {showDistance && (
                  <DistanceHead direction={distanceSort} onClick={onSortByDistance} />
                )}
                <SortableHead column="is_paid" sort={activeColumn} direction={direction} basePath={basePath} onClick={onSortByColumn} center>
                  Paid
                </SortableHead>
                <SortableHead column="non_union_ok" sort={activeColumn} direction={direction} basePath={basePath} onClick={onSortByColumn} center>
                  Non-union OK
                </SortableHead>
                <SortableHead column="housing" sort={activeColumn} direction={direction} basePath={basePath} onClick={onSortByColumn} center>
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
      </div>
    </>
  );
}

/**
 * Stands in for the column headers once the table is gone. Each chip carries
 * the same link a header does, so sorting works identically on a phone --
 * except distance, which toggles in place for the reason DistanceHead does.
 */
function MobileSort({
  sort,
  direction,
  basePath,
  showDistance,
  distanceSort,
  onSortByDistance,
  onSortByColumn,
}: {
  sort: string;
  direction: string;
  basePath: string;
  showDistance: boolean;
  distanceSort?: 'asc' | 'desc';
  onSortByDistance?: () => void;
  onSortByColumn?: () => void;
}) {
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-full border px-3 py-2 text-xs font-medium transition-colors ${
      active
        ? 'border-ring bg-muted text-foreground'
        : 'border-border text-muted-foreground'
    }`;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground/80">Sort</span>
      {showDistance && (
        <button type="button" onClick={onSortByDistance} className={chip(Boolean(distanceSort))}>
          Distance
          <span className="text-[10px]">
            {distanceSort ? (distanceSort === 'asc' ? '↑' : '↓') : '↕'}
          </span>
        </button>
      )}
      {COLUMNS.map(({ column, short }) => {
        const isActive = sort === column;
        const nextDir = isActive && direction === 'asc' ? 'desc' : 'asc';
        return (
          <Link
            key={column}
            href={`${basePath}?sort=${column}&dir=${nextDir}`}
            onClick={onSortByColumn}
            className={chip(isActive)}
          >
            {short}
            <span className="text-[10px]">
              {isActive ? (direction === 'asc' ? '↑' : '↓') : '↕'}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function SortableHead({
  children,
  column,
  sort,
  direction,
  basePath,
  onClick,
  center,
}: {
  children: React.ReactNode;
  column: string;
  sort: string;
  direction: string;
  basePath: string;
  onClick?: () => void;
  center?: boolean;
}) {
  const isActive = sort === column;
  const nextDir = isActive && direction === 'asc' ? 'desc' : 'asc';
  const href = `${basePath}?sort=${column}&dir=${nextDir}`;

  return (
    <TableHead className={`p-0 ${center ? 'text-center' : ''}`}>
      <Link
        href={href}
        onClick={onClick}
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
