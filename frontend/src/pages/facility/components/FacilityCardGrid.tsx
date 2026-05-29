// Book-a-facility landing — bento-style card layout.
//
// Shows one card per facility *type* the tenant has. The type with the most
// facilities gets the big "featured" treatment on the left; the next four
// fill a 2x2 grid on the right; anything beyond five flows into a normal
// 4-column grid underneath. Clicking a card routes to /facility/type/:type
// where the booker picks the specific room + slot.
//
// Card anatomy (matches the supplied mockup):
//   - small uppercase kicker (the type label as a chip-like badge)
//   - bold title (or the type name when there's no single hero facility)
//   - 1-2 line description
//   - "Arrow >" link
//   - image at the bottom (image_url if any facility in the bucket has one,
//     otherwise a per-type gradient with a lucide icon — keeps the layout
//     looking polished even before admins upload real photos)
//
// We deliberately don't use MUI here — the mockup is clean flat design
// that fits Tailwind + lucide better than MUI's material aesthetic. The
// rest of the page (header, BookingsTable) stays on MUI; this component
// is self-contained styling-wise.

import { useMemo } from 'react';
import { ChevronRight, Armchair, Dumbbell, Mic, Monitor, Waves, LayoutGrid } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Facility, FacilityType } from '@/types';

interface Props {
  facilities: Facility[];
  onBook: (type: FacilityType) => void;
}

// Per-type visual treatment for the placeholder image. Each gradient is a
// soft pastel that contrasts nicely with the white card background; the
// icon sits in the lower-right corner large and translucent so the title
// stays the focal point above it.
type TypeMeta = {
  label: string;       // human-readable type label e.g. "Gym"
  kicker: string;      // short uppercase kicker for the top of the card
  blurb: string;       // fallback description when no facility has a description
  icon: LucideIcon;
  gradient: string;    // tailwind classes for the image-placeholder block
};

const TYPE_META: Record<FacilityType, TypeMeta> = {
  meeting_room: {
    label: 'Meeting Room',
    kicker: 'Rooms',
    blurb: 'Schedule meetings in fully equipped spaces',
    icon: Mic,
    gradient: 'bg-gradient-to-br from-violet-100 to-violet-200 text-violet-700',
  },
  conference_room: {
    label: 'Conference Room',
    kicker: 'Rooms',
    blurb: 'Larger rooms for presentations and big group meetings',
    icon: Mic,
    gradient: 'bg-gradient-to-br from-indigo-100 to-indigo-200 text-indigo-700',
  },
  gym: {
    label: 'Gym',
    kicker: 'Gym',
    blurb: 'Train with modern equipment and expert guidance',
    icon: Dumbbell,
    gradient: 'bg-gradient-to-br from-rose-100 to-orange-200 text-rose-700',
  },
  desk: {
    label: 'Desk',
    kicker: 'Workspace',
    blurb: 'Claim a hot-desk for the day',
    icon: Monitor,
    gradient: 'bg-gradient-to-br from-emerald-100 to-teal-200 text-emerald-700',
  },
  swimming_pool: {
    label: 'Swimming Pool',
    kicker: 'Pool',
    blurb: 'Book lap lanes or group swim sessions',
    icon: Waves,
    gradient: 'bg-gradient-to-br from-cyan-100 to-sky-200 text-cyan-700',
  },
  other: {
    label: 'Other',
    kicker: 'Other',
    blurb: 'Bookable spaces at your campus',
    icon: LayoutGrid,
    gradient: 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-700',
  },
};

interface Bucket {
  type: FacilityType;
  facilities: Facility[];
  totalSeats: number;
  // First facility in the bucket that has an image_url set. Used by the
  // featured card so a real photo beats the gradient placeholder when
  // available.
  heroImage?: string;
}

// Sort key: largest bucket first so the most popular type lands in the
// featured slot. Ties broken alphabetically so the order is stable.
function bucketScore(b: Bucket): number {
  return -b.facilities.length;
}

export default function FacilityCardGrid({ facilities, onBook }: Props) {
  const buckets = useMemo<Bucket[]>(() => {
    const map = new Map<FacilityType, Bucket>();
    for (const f of facilities) {
      if (!f.status) continue;
      if (!map.has(f.type)) {
        map.set(f.type, { type: f.type, facilities: [], totalSeats: 0 });
      }
      const b = map.get(f.type) as Bucket;
      b.facilities.push(f);
      b.totalSeats += f.capacity || 0;
      if (!b.heroImage && f.image_url) b.heroImage = f.image_url;
    }
    return Array.from(map.values()).sort((a, b) => {
      const s = bucketScore(a) - bucketScore(b);
      if (s !== 0) return s;
      return (TYPE_META[a.type]?.label || a.type).localeCompare(TYPE_META[b.type]?.label || b.type);
    });
  }, [facilities]);

  if (buckets.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-2">🪑</div>
        <h3 className="text-lg font-semibold">No facilities yet</h3>
        <p className="text-sm text-muted-foreground">
          Your workspace admin hasn't added any rooms to book.
        </p>
      </div>
    );
  }

  const featured = buckets[0];
  const tileBuckets = buckets.slice(1, 5);   // 4 small tiles in the 2x2 grid
  const overflow = buckets.slice(5);         // anything else flows below

  return (
    <section>
      {/* ----- Page heading ----- */}
      {/* <div className="text-center mb-6 mt-2">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Book a facility</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Access multiple facility types with real-time availability
        </p>
      </div> */}

      {/* ----- Bento grid: featured on the left, 2x2 tiles on the right -----
          Mobile: single column. md+: 3 columns × 2 rows where the featured
          card takes col 1 spanning both rows, and the 4 tiles fill the
          remaining 2 columns. */}
      <div className="grid gap-4 md:grid-cols-3 md:grid-rows-2 md:auto-rows-fr">
        {/* --- FEATURED CARD --- */}
        <FacilityCard
          bucket={featured}
          variant="featured"
          onBook={() => onBook(featured.type)}
        />

        {/* --- 4 SMALL TILES --- */}
        {tileBuckets.map((b) => (
          <FacilityCard
            key={b.type}
            bucket={b}
            variant="tile"
            onBook={() => onBook(b.type)}
          />
        ))}
      </div>

      {/* ----- Overflow grid ----- */}
      {overflow.length > 0 && (
        <div className="grid gap-4 mt-4 sm:grid-cols-2 lg:grid-cols-4">
          {overflow.map((b) => (
            <FacilityCard
              key={b.type}
              bucket={b}
              variant="tile"
              onBook={() => onBook(b.type)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ----- Single card --------------------------------------------------------
// Two visual variants:
//   featured — taller card, image fills the bottom half, title text larger.
//   tile     — image is a smaller strip below the text.

function FacilityCard({
  bucket, variant, onBook,
}: {
  bucket: Bucket;
  variant: 'featured' | 'tile';
  onBook: () => void;
}) {
  const meta = TYPE_META[bucket.type] || TYPE_META.other;
  // Pick the "hero" facility for the title — the first one with a unique
  // name. For the small tiles we just use the type label so the title
  // reads like "Tennis courts" / "Swimming pool" / etc. — keeps it short
  // and category-level, matching the supplied mockup.
  const hero = bucket.facilities[0];
  const heroName = variant === 'featured' && hero ? hero.name : meta.label;
  const description =
    variant === 'featured' && hero && hero.description ? hero.description : meta.blurb;

  const sizes =
    variant === 'featured'
      // Featured: spans 2 rows in the bento. Image fills the bottom half.
      ? 'md:row-span-2 min-h-[320px]'
      : 'min-h-[100px]';

  return (
    <button
      type="button"
      onClick={onBook}
      className={
        'group relative flex flex-col text-left rounded-2xl bg-white border border-slate-200 ' +
        'hover:border-slate-300 hover:shadow-md transition-all overflow-hidden ' +
        sizes
      }
    >
      {/* Body — kicker + title + description + arrow */}
      <div className={variant === 'featured' ? 'p-6 flex-1' : 'p-4 flex-1'}>
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
          {meta.kicker}
        </div>
        <h3
          className={
            'font-semibold text-slate-900 mt-1 leading-snug ' +
            (variant === 'featured' ? 'text-2xl sm:text-3xl' : 'text-lg')
          }>
          {heroName}
        </h3>
        <p
          className={
            'text-slate-600 mt-2 ' +
            (variant === 'featured' ? 'text-sm max-w-md' : 'text-xs line-clamp-2')
          }>
          {description}
        </p>

        {/* Action line: matches the mockup's "View Arrow >" treatment.
            "View" is only shown on the featured card; tiles just get the
            arrow chevron. */}
        <div className="mt-4 flex items-center gap-3 text-sm font-medium text-slate-900">
          {variant === 'featured' && (
            <span className="rounded-md border border-slate-300 px-3 py-1 group-hover:bg-slate-50">
              View
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-slate-700 group-hover:text-slate-900">
            <span>Arrow</span>
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>

      {/* Image / placeholder block. Uses the bucket's hero image_url if any
          facility in the type has one set, otherwise the per-type gradient
          + icon so the card still looks intentional. */}
      <div
        className={
          'relative w-full overflow-hidden ' +
          (variant === 'featured' ? 'h-56 sm:h-64' : 'h-32')
        }
      >
        {bucket.heroImage ? (
          <img
            src={bucket.heroImage}
            alt={meta.label}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className={'w-full h-full flex items-end justify-end ' + meta.gradient}>
            <meta.icon
              className={
                'opacity-60 ' + (variant === 'featured' ? 'h-32 w-32 mr-6 mb-4' : 'h-16 w-16 mr-3 mb-2')
              }
            />
          </div>
        )}
      </div>

      {/* Subtle count badge in the top-right corner so the booker can see
          how many specific facilities sit under this type. Doesn't fight
          the title for attention; just a small chip. */}
      <span
        className={
          'absolute top-3 right-3 rounded-full bg-white/90 backdrop-blur-sm text-[10px] ' +
          'font-medium text-slate-700 px-2 py-0.5 border border-slate-200 shadow-sm'
        }
      >
        {bucket.facilities.length} {bucket.facilities.length === 1 ? 'space' : 'spaces'}
      </span>
    </button>
  );
}


void Armchair;
