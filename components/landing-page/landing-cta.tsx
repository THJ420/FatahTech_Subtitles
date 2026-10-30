import { ArrowRight, Upload } from "lucide-react";
import { GitHubIcon } from "@/components/icons/github-icon";
import styles from "./landing.module.css";

const REPOSITORY_URL = "https://github.com/THJ420/FatahTech_Subtitles";

/**
 * Closing banner. Follows the reference layout and DESIGN.md: a royal-blue
 * gradient panel (#1D4ED8 -> #2563EB -> #3B82F6, 24px radius) with a white
 * primary action and a dark-slate secondary action.
 */
export function LandingCTA() {
  return (
    <section className={styles.ctaSection}>
      <div className={styles.container}>
        <div className={styles.cta}>
          <div className={styles.ctaCopy}>
            <span className={styles.eyebrow}>
              No sign-up · No API keys · 100% free
            </span>
            <h2>
              Make your free <span>SRT, VTT, and subtitled video</span> now
            </h2>
            <p>
              Open the editor, drop a video, and let the free AI subtitle
              generator do the first pass. Everything runs on your device, so
              your footage stays private — and the optional watermark can be
              switched off before export.
            </p>
            <div className={styles.ctaActions}>
              <a href="#dropzone" className={styles.ctaPrimary}>
                <Upload size={18} /> Start subtitling free{" "}
                <ArrowRight size={18} />
              </a>
              <a
                href={REPOSITORY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.ctaSecondary}
              >
                <GitHubIcon width={18} height={18} /> View on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
