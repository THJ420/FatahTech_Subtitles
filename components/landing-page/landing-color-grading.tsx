import { ArrowRight, Palette, SlidersHorizontal, Sparkles } from "lucide-react";
import styles from "./landing.module.css";

const CAPABILITIES = [
  {
    icon: Sparkles,
    title: "Footage-aware AI presets",
    description:
      "Five sampled frames are measured for luminance, contrast, saturation, and white balance, then four looks are tuned to this exact clip.",
  },
  {
    icon: SlidersHorizontal,
    title: "Professional manual controls",
    description:
      "Exposure, contrast, gamma, saturation, vibrance, temperature, tint, highlights, and shadows update the preview in real time.",
  },
  {
    icon: Palette,
    title: "Custom looks, saved locally",
    description:
      "Save named presets in your browser and reuse them on the next video. Footage and looks never leave your device.",
  },
] as const;

export function LandingColorGrading() {
  return (
    <section id="color-grading" className={styles.colorGrading}>
      <div className={`${styles.container} ${styles.colorGradingGrid}`}>
        <div className={styles.colorGradingCopy}>
          <span className={styles.eyebrow}>Color &amp; Light</span>
          <h2>Professional color grading for every video you subtitle</h2>
          <p className={styles.colorGradingLead}>
            The free AI subtitle generator now includes a full grading stage.
            Shape the look in the live preview, then export with exactly the
            same color — subtitles and the watermark are never tinted.
          </p>
          <div className={styles.colorCapabilities}>
            {CAPABILITIES.map(({ icon: Icon, title, description }) => (
              <article key={title}>
                <Icon size={20} strokeWidth={1.9} aria-hidden="true" />
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
          <a href="#dropzone" className={styles.primaryButton}>
            Grade your footage free <ArrowRight size={17} />
          </a>
        </div>

        <div className={styles.gradeVisual} aria-hidden="true">
          <div className={styles.gradeWindow}>
            <div className={styles.gradeBars}>
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <i className={styles.gradeWash} />
              <i className={styles.gradeSplit} />
            </div>
            <div className={styles.gradePresetRow}>
              <span data-active="true">Cinematic</span>
              <span>Warm</span>
              <span>Clean</span>
              <span>Vibrant</span>
            </div>
            <div className={styles.gradeSliders}>
              <label>
                Exposure{" "}
                <i>
                  <b style={{ width: "62%" }} />
                </i>
              </label>
              <label>
                Contrast{" "}
                <i>
                  <b style={{ width: "48%" }} />
                </i>
              </label>
              <label>
                Vibrance{" "}
                <i>
                  <b style={{ width: "76%" }} />
                </i>
              </label>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
