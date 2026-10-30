import { ArrowRight, Captions, Download, Upload } from "lucide-react";
import styles from "./landing.module.css";

const STEPS = [
  {
    number: "01",
    icon: Upload,
    title: "Drop an MP4, MOV, MKV, or WebM video",
    description:
      "Drag a video file into your browser. Nothing is uploaded — the file is decoded in this tab and stays on your device.",
    tone: "blue",
  },
  {
    number: "02",
    icon: Captions,
    title: "Auto-caption in your browser with Whisper",
    description:
      "Whisper AI transcribes speech locally with word-level timestamps in 100+ languages. Edit words, fonts, colors, position, and effects.",
    tone: "yellow",
  },
  {
    number: "03",
    icon: Download,
    title: "Export SRT, VTT, TXT, or a subtitled video",
    description:
      "Download subtitle files free, or burn captions into MP4 or WebM. Turn off the optional watermark for a completely watermark-free export.",
    tone: "green",
  },
] as const;

export function LandingHowItWorks() {
  return (
    <section id="how-it-works" className={styles.howItWorks}>
      <div className={styles.container}>
        <div className={`${styles.sectionHeader} ${styles.centeredHeading}`}>
          <span className={styles.eyebrow}>How it works</span>
          <h2>How to Generate Free AI Subtitles Without Server Uploads</h2>
          <p>
            Drop a video, let Whisper write the captions in your browser, then
            download SRT, WebVTT, TXT, or a finished subtitled video. No server
            upload and no account at any step.
          </p>
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
