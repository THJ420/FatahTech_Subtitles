import Link from "next/link";

interface BrandLockupProps {
  /** Smaller treatment for illustrative previews, not for real headers. */
  compact?: boolean;
  /** Render as a non-interactive element inside decorative mockups. */
  static?: boolean;
  className?: string;
}

/**
 * Single source of truth for FatahTech Subtitles branding.
 *
 * The full lockup is used by the landing header, changelog header, studio
 * header, and footer so the brand cannot drift between routes.
 */
export function BrandLockup({
  compact = false,
  static: renderStatic = false,
  className,
}: BrandLockupProps) {
  const content = (
    <>
      {/* Brand Logo Image */}
      <div
        className={`relative flex items-center justify-center shrink-0 ${
          compact
            ? "w-7 h-7 rounded-lg"
            : "w-9 h-9 max-md:w-8 max-md:h-8 rounded-xl"
        } bg-slate-900/5 dark:bg-white/5 border border-slate-200/60 dark:border-slate-800 p-1`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt="FatahTech Logo"
          className="w-full h-full object-contain"
          src="/brand-logo.webp"
        />
      </div>

      {/* Typography Stack */}
      <div className="flex flex-col justify-center leading-none">
        <div className="flex items-center gap-2">
          <span
            className={`${
              compact ? "text-[15px]" : "text-[19px] max-md:text-[16px]"
            } font-bold tracking-tight text-slate-900 dark:text-white`}
          >
            FatahTech
          </span>
          <span
            className={`${
              compact ? "" : "max-md:hidden"
            } bg-[#bbf2ff] text-[#0a3641] text-[10px] font-extrabold tracking-wider px-2.5 py-0.5 rounded-full uppercase`}
          >
            SUBTITLES
          </span>
        </div>
        {!compact ? (
          <span className="max-md:hidden text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
            Part of FatahTech Ecosystem
          </span>
        ) : null}
      </div>
    </>
  );

  const classes = `flex items-center gap-3 group focus:outline-none${
    className ? ` ${className}` : ""
  }`;
  // Pin the lockup font so the brand measures the same on every route instead
  // of inheriting Inter on the landing page and Figtree in the studio.
  const style = {
    fontFamily: "var(--font-inter), var(--font-sans), sans-serif",
  };

  if (renderStatic) {
    return (
      <div className={classes} style={style}>
        {content}
      </div>
    );
  }

  return (
    <Link href="/" className={classes} style={style}>
      {content}
    </Link>
  );
}
