import Link from "next/link";
import { MessageSquare, Rss, Share2, Terminal } from "lucide-react";
import { APP_VERSION } from "@/lib/changelog";
import { GitHubIcon } from "@/components/icons/github-icon";
import { BrandLockup } from "@/components/brand-lockup";
import styles from "@/components/landing-page/landing.module.css";

const REPOSITORY_URL = "https://github.com/THJ420/FatahTech_Subtitles";

const LINK_GROUPS = [
  {
    title: "Subtitles Studio",
    links: [
      { href: "#features", label: "Features" },
      { href: "#how-it-works", label: "How it works" },
      { href: "#examples", label: "Examples" },
      { href: "#dropzone", label: "Web Video Editor" },
      { href: "#architecture", label: "Architecture" },
    ],
  },
  {
    title: "FatahTech Solutions",
    links: [
      {
        href: "https://fatahtech.com",
        label: "Web Development",
        external: true,
      },
      {
        href: "https://fatahtech.com",
        label: "Mobile Engineering",
        external: true,
      },
      {
        href: "https://fatahtech.com",
        label: "Cloud Infrastructure",
        external: true,
      },
      {
        href: "https://fatahtech.com",
        label: "AI & Data Systems",
        external: true,
      },
      {
        href: "https://fatahtech.com",
        label: "Enterprise Consulting",
        external: true,
      },
    ],
  },
  {
    title: "Engineering & Trust",
    links: [
      { href: "#local", label: "Privacy Architecture" },
      { href: REPOSITORY_URL, label: "Open Source Core", external: true },
      { href: "#", label: "API Documentation" },
      { href: "#", label: "Security Whitepaper" },
      { href: "/changelog", label: "Changelog", internal: true },
    ],
  },
] as const;

const SOCIAL_LINKS = [
  { icon: Share2, label: "Developer Network" },
  { icon: Terminal, label: "Community Terminal" },
  { icon: MessageSquare, label: "Public Discussion Forum" },
  { icon: Rss, label: "Company News Feed" },
] as const;

function StackLinks() {
  return (
    <div className={styles.stackLinks}>
      <span>Built with</span>
      <a
        href="https://huggingface.co/docs/transformers.js"
        target="_blank"
        rel="noopener noreferrer"
      >
        Transformers.js
      </a>
      <span>·</span>
      <a
        href="https://github.com/Vanilagy/mediabunny"
        target="_blank"
        rel="noopener noreferrer"
      >
        MediaBunny
      </a>
      <span>·</span>
      <span>subtitle.fatahtech.com</span>
    </div>
  );
}

export function SiteFooter({
  variant = "compact",
}: {
  variant?: "compact" | "landing";
}) {
  if (variant === "compact") {
    return (
      <footer className={styles.compactFooter}>
        <div>
          <span>Built by</span>
          <a
            href="https://fatahtech.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            FatahTech
          </a>
          <span>·</span>
          <Link href="/changelog">v{APP_VERSION}</Link>
          <span>·</span>
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
          >
            <GitHubIcon width={14} height={14} />
            GitHub
          </a>
        </div>
        <StackLinks />
      </footer>
    );
  }
  return (
    <footer className={`${styles.container} ${styles.footer}`}>
      <div className={styles.footerMain}>
        <div className={styles.footerAbout}>
          <BrandLockup />
          <p>
            High-performance, on-device AI transcription
            <br />
            and a subtitle studio, built by FatahTech.
          </p>
          <div className={styles.footerStatus}>
            <span className={styles.footerStatusDot} aria-hidden="true" />
            <strong>All systems operational</strong>
            <small>(WebGPU &amp; local Whisper)</small>
          </div>
          <div className={styles.footerSocials}>
            {SOCIAL_LINKS.map(({ icon: Icon, label }) => (
              <a key={label} href="#" aria-label={label}>
                <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
              </a>
            ))}
          </div>
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.footerGithub}
          >
            <GitHubIcon width={17} height={17} />
            Open source on GitHub
          </a>
        </div>
        {LINK_GROUPS.map((group) => (
          <nav key={group.title} aria-label={`${group.title} links`}>
            <strong>{group.title}</strong>
            {group.links.map((link) => {
              if ("internal" in link && link.internal) {
                return (
                  <Link key={link.label} href={link.href}>
                    {link.label}
                  </Link>
                );
              }
              if ("external" in link && link.external) {
                return (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.label}
                  </a>
                );
              }
              return (
                <a key={link.label} href={link.href}>
                  {link.label}
                </a>
              );
            })}
          </nav>
        ))}
      </div>
      <div className={styles.footerBottom}>
        <span>
          © {new Date().getFullYear()} FatahTech. Part of the FatahTech
          ecosystem. <Link href="/changelog">v{APP_VERSION}</Link>
        </span>
        <StackLinks />
      </div>
    </footer>
  );
}
