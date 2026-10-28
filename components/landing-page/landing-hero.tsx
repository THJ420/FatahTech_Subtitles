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
            Free AI subtitle generator &amp;{" "}
            <span className={styles.highlight}>SRT maker</span>
          </h1>
          <p className={styles.heroDescription}>
            The free online video subtitle maker: auto-generate subtitles for
            any video, edit every word, grade the color, and export SRT or
            burned-in video — locally in your browser. No sign-up.
          </p>
          <div className={styles.heroActions}>
            <a href="#dropzone" className={styles.primaryButton}>
              Launch Subtitle Studio <ArrowRight size={17} />
            </a>
            <a href="#benchmarks" className={styles.secondaryButton}>
              Benchmarks & Code
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
