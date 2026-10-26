import { ArrowRight, Captions, Download, Upload } from "lucide-react";
import styles from "./landing.module.css";

const STEPS = [
  {
    number: "01",
    icon: Upload,
    title: "Drop your video",
    description:
      "Drag a video file into the browser. MP4, MOV, or WebM. Your video stays on your device.",
    tone: "blue",
  },
  {
    number: "02",
    icon: Captions,
    title: "Generate subtitles",
    description:
      "Whisper AI transcribes your audio locally. Edit words, fonts, colors, position, and effects.",
    tone: "yellow",
  },
  {
    number: "03",
    icon: Download,
    title: "Export your video",
    description:
      "Download your video with subtitles baked in. Share anywhere. The subs are part of the video.",
    tone: "green",
  },
] as const;

export function LandingHowItWorks() {
  return (
    <section id="how-it-works" className={styles.howItWorks}>
      <div className={styles.container}>
        <div className={`${styles.sectionHeader} ${styles.centeredHeading}`}>
          <span className={styles.eyebrow}>How it works</span>
          <h2>Three steps. That’s it.</h2>
          <p>From your first word to your final video, all in one place.</p>
        </div>
        <div className={styles.steps}>
          {STEPS.map(
            ({ number, icon: Icon, title, description, tone }, index) => (
              <article className={styles.step} data-tone={tone} key={number}>
                <span className={styles.stepNumber}>{number}</span>
                <span className={styles.stepIcon}>
                  <Icon size={30} strokeWidth={1.5} />
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
                {index < STEPS.length - 1 ? (
                  <span className={styles.stepArrow} aria-hidden="true">
                    <ArrowRight size={21} strokeWidth={1.5} />
                  </span>
                ) : null}
              </article>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
