export interface Theater {
  id: string;
  name: string;
  city: string;
  state: string;
  audition_page_url: string | null;
  notes: string;
  is_active: boolean;
  created_at: string;
}

export interface Audition {
  id: string;
  theater_id: string;
  theater?: Theater;
  show_name: string | null;
  audition_dates: string | null;
  performance_dates: string | null;
  is_paid: boolean | null;
  is_union: boolean | null;
  housing: 'yes' | 'no' | 'unknown';
  source_url: string | null;
  scraped_at: string | null;
  raw_text: string | null;
  is_expired: boolean;
  created_at: string;
}

export type SortField = 'audition_dates' | 'is_paid' | 'theater_name';
export type SortDirection = 'asc' | 'desc';

export interface AuditionFilters {
  sort: SortField;
  direction: SortDirection;
  showExpired: boolean;
}
