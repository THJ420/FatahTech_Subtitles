import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Sparkles } from "lucide-react";
import { changelog, APP_VERSION, type ChangelogEntry } from "@/lib/changelog";
import { SiteFooter } from "@/components/site-footer";
import { BrandLockup } from "@/components/brand-lockup";
import styles from "./changelog.module.css";

export const metadata = {
  title: "Changelog",
  description:
    "New features, improvements, and fixes in FatahTech Subtitles. Follow the latest editor and export updates.",
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function VersionBlock({
  entry,
  isLatest,
}: {
  entry: ChangelogEntry;
  isLatest: boolean;
}) {
  return (
    <article
      className={styles.release}
      id={`v${entry.version}`}
      aria-labelledby={`title-${entry.version}`}
    >
      <div className={styles.releaseMeta}>
        <a href={`#v${entry.version}`} className={styles.version}>
          v{entry.version}
        </a>
        <time dateTime={entry.date}>{formatDate(entry.date)}</time>
        {isLatest && (
          <span className={styles.latest}>
            <span aria-hidden="true" />
            Latest release
          </span>
        )}
      </div>
      <div className={styles.releaseCard} data-latest={isLatest}>
        <h2 id={`title-${entry.version}`}>{entry.title}</h2>
        <ul className={styles.changes}>
          {entry.changes.map((change) => (
            <li key={change.description}>
              <span className={styles.badge} data-type={change.type}>
                {change.type}
              </span>
              <p>{change.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

export default function ChangelogPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <BrandLockup />
          <Link href="/" className={styles.backLink}>
            <ArrowLeft size={16} />
            Back to app
          </Link>
        </div>
      </header>
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="changelog-title">
          <span className={styles.eyebrow}>
            <Sparkles size={14} aria-hidden="true" />
            Made better, release by release
          </span>
          <h1 id="changelog-title">
            Small updates.
            <br />
            <span>Better videos.</span>
          </h1>
          <p>
            The latest features, thoughtful improvements, and fixes.
            <br className={styles.desktopBreak} /> Here’s what’s new in
            FatahTech Subtitles.
          </p>
          <div className={styles.heroActions}>
            <a href={`#v${APP_VERSION}`} className={styles.latestLink}>
              What’s new in v{APP_VERSION}
              <ArrowUpRight size={17} />
            </a>
            <span>Built in public. Made for creators.</span>
          </div>
        </section>
        <div className={styles.historyHeading}>
          <h2>Changelog</h2>
          <span>From the first subtitle to today</span>
        </div>
        <div className={styles.history}>
          {changelog.map((entry, index) => (
            <VersionBlock
              key={entry.version}
              entry={entry}
              isLatest={index === 0}
            />
          ))}
        </div>
        <div className={styles.endNote}>
          <span aria-hidden="true" />
          Every improvement starts with a first version.
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
