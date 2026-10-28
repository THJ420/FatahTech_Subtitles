import type { CSSProperties } from "react";
import Image from "next/image";
import { Download, LockKeyhole, Maximize2, Play, Volume2 } from "lucide-react";
import { BrandLockup } from "@/components/brand-lockup";
import styles from "./landing.module.css";

export function LandingBrand({ compact = false }: { compact?: boolean }) {
  return <BrandLockup compact={compact} static />;
}

const WAVE_HEIGHTS = Array.from(
  { length: 112 },
  (_, index) =>
    6 +
    Math.round(Math.abs(Math.sin(index * 1.63) * Math.cos(index * 0.23)) * 24),
);

export function DemoWaveform() {
  return (
    <div className={styles.demoWaveform}>
      {WAVE_HEIGHTS.map((height, index) => (
        <i
          key={index}
          style={{ "--bar-height": `${height}px` } as CSSProperties}
        />
      ))}
    </div>
  );
}

const DEMO_LINES = [
  "This is how you build",
  "something people love.",
  "Keep it simple.",
  "Focus on what matters.",
  "And iterate quickly.",
  "That’s the game.",
];

/**
 * Word-level timing chips under the waveform, mirroring the reference
 * studio mock. Illustrative demo content (same lines as the preview
 * transcript), not measured output.
 */
const TOKEN_CHIPS = [
  { time: "00:12 → 00:13", word: "This", active: false },
  { time: "00:13 → 00:14", word: "is", active: false },
  { time: "00:14 → 00:14", word: "how", active: false },
  { time: "00:14 → 00:15", word: "you build", active: true },
  { time: "00:15 → 00:17", word: "something", active: true },
  { time: "00:17 → 00:18", word: "people love", active: false },
] as const;

export function EditorPreview() {
  return (
    <figure
      className={styles.editorPreview}
      id="examples"
      aria-label="Example of a video with highlighted subtitles and an editable timeline"
    >
      <div aria-hidden="true">
        <div className={styles.previewHeader}>
          <LandingBrand compact />
          <div className={styles.previewActions}>
            <span>
              <Download size={11} /> Export
            </span>
            <span>Download SRT</span>
          </div>
        </div>
        <div className={styles.previewBody}>
          <div className={styles.previewVideoColumn}>
            <div className={styles.previewVideo}>
              <Image
                src="/creator-hero-target.png"
                alt=""
                width={960}
                height={640}
                loading="eager"
                fetchPriority="high"
                sizes="(max-width: 640px) 82vw, (max-width: 1024px) 60vw, 440px"
              />
              <span className={styles.faceBox}>Face: Safe Zone</span>
              <span className={styles.previewCaption}>
                This is how you build something <mark>people love.</mark>
              </span>
            </div>
            <div className={styles.previewPlayback}>
              <Play size={11} fill="currentColor" />
              <Maximize2 size={11} />
              <span>00:12 / 00:48</span>
              <i />
              <Volume2 size={12} />
            </div>
          </div>
          <div className={styles.previewTranscript}>
            {DEMO_LINES.map((line, index) => (
              <div
                key={line}
                className={index === 1 ? styles.previewActiveLine : undefined}
              >
                <time>00:{String(index * 3).padStart(2, "0")}</time>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.previewTimeline}>
          <DemoWaveform />
          <div className={styles.previewPlayhead} />
          <div className={styles.previewClips}>
            {DEMO_LINES.slice(0, 3).map((line, index) => (
              <span
                key={line}
                className={index === 1 ? styles.activeClip : undefined}
              >
                {line}
              </span>
            ))}
          </div>
          <div className={styles.tokenChips}>
            {TOKEN_CHIPS.map((chip) => (
              <span
                key={`${chip.time}-${chip.word}`}
                data-active={chip.active || undefined}
              >
                {chip.time} [{chip.word}]
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="sr-only">
        Style each subtitle and see the result over your video.
      </figcaption>
    </figure>
  );
}

export function BrowserChrome() {
  return (
    <div className={styles.browserChrome} aria-hidden="true">
      <span className={styles.browserDots}>
        <i />
        <i />
        <i />
      </span>
      <span className={styles.browserAddress}>
        <LockKeyhole size={12} /> subtitle.fatahtech.com
      </span>
    </div>
  );
}

export function ReadyFile() {
  return (
    <div className={styles.readyFile}>
      <Image
        src="/creator-hero-target.png"
        width={144}
        height={96}
        sizes="120px"
        alt=""
      />
      <div>
        <strong>video.mp4</strong>
        <span>42 seconds · 1080p</span>
        <small>Processed locally</small>
      </div>
    </div>
  );
}
