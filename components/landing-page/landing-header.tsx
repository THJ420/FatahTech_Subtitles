import { ArrowRight } from "lucide-react";
import { GitHubIcon } from "@/components/icons/github-icon";
import { APP_VERSION } from "@/lib/changelog";
import { BrandLockup } from "@/components/brand-lockup";
import styles from "./landing.module.css";

/**
 * Anchor map mirrors the reference page sections: top overview, features,
 * workflow, architecture (AI models), privacy, and the comparison matrix
 * (benchmarks). Every href resolves to a real element id on this page.
 */
const NAV_LINKS = [
  { href: "#top", label: "Overview" },
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#architecture", label: "AI Models" },
  { href: "#local", label: "Privacy" },
  { href: "#benchmarks", label: "Benchmarks" },
] as const;

export function LandingHeader() {
  return (
    <header className={styles.header}>
      <div className={`${styles.container} ${styles.headerInner}`}>
        <BrandLockup />
        <nav className={styles.navigation} aria-label="Main navigation">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <a
            href="https://github.com/THJ420/FatahTech_Subtitles"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.sourceLink}
          >
            <GitHubIcon width={18} height={18} />
            <span>Open source</span>
            {/* Sourced from lib/changelog.ts so it cannot drift from the app. */}
            <span className={styles.versionBadge}>v{APP_VERSION}</span>
          </a>
          <a href="#dropzone" className={styles.primaryButton}>
            Launch App <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </header>
  );
}
