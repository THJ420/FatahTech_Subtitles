import { ArrowRight, LockKeyhole, WifiOff, Zap } from "lucide-react";
import { EditorPreview } from "./landing-visuals";
import styles from "./landing.module.css";

const BENEFITS = [
  {
    icon: LockKeyhole,
    title: "100% local",
    detail: "Video stays on device",
    tone: "green",
  },
  {
    icon: WifiOff,
    title: "Works offline",
    detail: "Once models are ready",
    tone: "pink",
  },
  {
    icon: Zap,
    title: "Powered by AI",
    detail: "Whisper speech models",
    tone: "purple",
  },
] as const;

export function LandingHero() {
  return (
    <section id="top" className={styles.hero}>
      <div className={`${styles.container} ${styles.heroGrid}`}>
        <div className={styles.heroCopy}>
          <span className={styles.heroBadge}>
            <Zap size={15} fill="currentColor" /> Free · No sign-up · Open
            source
          </span>
          <h1>
            Free AI Subtitle Generator That{" "}
            <span className={styles.highlight}>
              Runs Locally in Your Browser
            </span>
          </h1>
          <p className={styles.heroDescription}>
            The free video subtitle generator that auto-captions in your
            browser: edit every word, export SRT, VTT, or a subtitled MP4, and
            grade color locally. No sign-up, no uploads, no forced watermark.
          </p>
          <div className={styles.heroActions}>
            <a href="#dropzone" className={styles.primaryButton}>
              Generate free subtitles <ArrowRight size={17} />
            </a>
            <a href="#benchmarks" className={styles.secondaryButton}>
              Compare subtitle tools
            </a>
          </div>
          <div className={styles.benefits}>
            {BENEFITS.map(({ icon: Icon, title, detail, tone }) => (
              <div key={title}>
                <span className={styles.benefitIcon} data-tone={tone}>
                  <Icon size={23} strokeWidth={1.8} />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.heroVisual}>
          <EditorPreview />
          <div className={styles.spark} aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
    </section>
  );
}
