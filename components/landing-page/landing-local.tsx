import {
  Check,
  Cpu,
  HardDrive,
  LockKeyhole,
  Monitor,
  ShieldCheck,
  VideoOff,
} from "lucide-react";
import { BrowserChrome, ReadyFile } from "./landing-visuals";
import styles from "./landing.module.css";

const PRIVACY_POINTS = [
  {
    icon: VideoOff,
    title: "No video uploads or server processing",
    detail:
      "Your video is decoded and transcribed here, on your own device. There is no upload step and no server-side queue.",
    tone: "pink",
  },
  {
    icon: LockKeyhole,
    title: "Private by design",
    detail:
      "Speech recognition runs in your browser, without sending your audio away.",
    tone: "yellow",
  },
  {
    icon: Cpu,
    title: "Your device runs the AI",
    detail: "WebGPU and WebAssembly run Whisper on your own hardware.",
    tone: "purple",
  },
  {
    icon: HardDrive,
    title: "Free, open source, and yours to keep",
    detail:
      "The editor is MIT licensed with no subscription. Edit in this session, then download the result when you are ready.",
    tone: "green",
  },
] as const;

export function LandingLocal() {
  return (
    <section id="local" className={styles.local}>
      <div className={`${styles.container} ${styles.localGrid}`}>
        <div className={styles.localVisual}>
          <div
            className={styles.browserPanel}
            role="img"
            aria-label="Illustration of local video processing"
          >
            <BrowserChrome />
            <div className={styles.browserContent}>
              <div className={styles.processingHeading}>
                <span>
                  <Monitor size={25} />
                </span>
                <div>
                  <strong>Processing locally</strong>
                  <small>AI runs in this browser tab</small>
                </div>
                <span className={styles.localBadge}>
                  <i />
                  100% local
                </span>
              </div>
              <div className={styles.processingBars}>
                {[
                  "Audio extraction",
                  "Whisper transcription",
                  "Subtitle rendering",
                ].map((label, index) => (
                  <div key={label} data-step={index}>
                    <div>
                      <span>{label}</span>
                      <span>100%</span>
                    </div>
                    <i>
                      <span />
                    </i>
                  </div>
                ))}
              </div>
              <div className={styles.processingSuccess}>
                <Check size={18} />
                <span>Your video stays on your device.</span>
                <strong>Complete!</strong>
              </div>
              <div className={styles.processingResult}>
                <ReadyFile />
                <div className={styles.readyBadge}>
                  <ShieldCheck size={26} />
                  <div>
                    <strong>Subtitles ready!</strong>
                    <small>Made on your device.</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.localCopy}>
          <span className={styles.eyebrow}>Privacy architecture</span>
          <h2>
            Why Local Browser AI Subtitling is{" "}
            <span className={styles.highlight}>100% Private &amp; Free</span>
          </h2>
          <p>
            The AI models download once, then your browser does the work with
            WebGPU and WebAssembly. There is no upload step, no account, and no
            subscription — your video files stay on your machine.
          </p>
          <div className={styles.privacyGrid}>
            {PRIVACY_POINTS.map(({ icon: Icon, title, detail, tone }) => (
              <div key={title}>
                <span className={styles.privacyIcon} data-tone={tone}>
                  <Icon size={25} strokeWidth={1.8} />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
