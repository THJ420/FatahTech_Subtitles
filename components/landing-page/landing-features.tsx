"use client";

import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";
import { useRef, useState } from "react";
import Image from "next/image";
import {
  AlignVerticalSpaceAround,
  Captions,
  Check,
  Download,
  FileVideo,
  Globe,
  ImageIcon,
  ScanFace,
  Type,
  WifiOff,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import styles from "./landing.module.css";

type FeatureTone = "yellow" | "purple" | "blue" | "pink" | "green";

function FeatureCard({
  icon: Icon,
  title,
  children,
  demo,
  tone,
  badge,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  demo: ReactNode;
  tone: FeatureTone;
  badge?: string;
}) {
  return (
    <article className={styles.featureCard} data-tone={tone}>
      <div className={styles.featureCopy}>
        <span className={styles.featureIcon}>
          <Icon size={28} strokeWidth={1.9} />
        </span>
        <h3>{title}</h3>
        <p>{children}</p>
        {badge ? (
          <span className={styles.featureBadge}>
            <Zap size={12} fill="currentColor" />
            {badge}
          </span>
        ) : null}
      </div>
      <div className={styles.featureDemo} aria-hidden="true">
        {demo}
      </div>
    </article>
  );
}

function TranscriptionDemo() {
  return (
    <div className={styles.miniPanel}>
      <strong>Transcribing…</strong>
      <hr />
      <span>Generating subtitles…</span>
      <div className={styles.miniProgress}>
        <i />
      </div>
    </div>
  );
}

function FaceDemo({
  removeBackground = false,
}: {
  removeBackground?: boolean;
}) {
  // Divider position as a percentage. Only used by the background-removal
  // comparison, which is draggable via pointer, touch, and arrow keys.
  const [split, setSplit] = useState(55);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const updateFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const percent = ((clientX - rect.left) / rect.width) * 100;
    setSplit(Math.min(95, Math.max(5, Math.round(percent))));
  };

  return (
    <div
      className={`${styles.faceDemo} ${removeBackground ? styles.backgroundDemo : ""}`}
      ref={removeBackground ? trackRef : undefined}
      style={
        removeBackground
          ? ({ "--split": `${split}%` } as CSSProperties)
          : undefined
      }
      {...(removeBackground
        ? {
            role: "slider",
            tabIndex: 0,
            "aria-label": "Background removal comparison slider",
            "aria-valuemin": 5,
            "aria-valuemax": 95,
            "aria-valuenow": split,
            onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
              draggingRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              updateFromClientX(event.clientX);
            },
            onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
              if (draggingRef.current) updateFromClientX(event.clientX);
            },
            onPointerUp: () => {
              draggingRef.current = false;
            },
            onPointerCancel: () => {
              draggingRef.current = false;
            },
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "ArrowLeft")
                setSplit((value) => Math.max(5, value - 5));
              if (event.key === "ArrowRight")
                setSplit((value) => Math.min(95, value + 5));
            },
          }
        : {})}
    >
      <Image
        src="/creator-hero-target.png"
        alt=""
        width={240}
        height={270}
        sizes="150px"
      />
      {removeBackground ? (
        <>
          <div className={styles.backgroundAfter}>
            <Image
              src="/creator-background-removed.webp"
              alt=""
              width={1200}
              height={800}
              sizes="150px"
            />
          </div>
          <span className={styles.comparisonHandle}>‹ ›</span>
        </>
      ) : (
        <>
          <div className={styles.faceFrame} />
          <span className={styles.faceCaption}>
            Hello <mark>there!</mark>
          </span>
        </>
      )}
    </div>
  );
}

function SplitDemo() {
  return (
    <div className={styles.splitDemo}>
      <span>SUBTITLE TOP</span>
      <AlignVerticalSpaceAround size={40} strokeWidth={1.4} />
      <span>SUBTITLE BOTTOM</span>
    </div>
  );
}

function FontsDemo() {
  return (
    <div className={styles.fontsDemo}>
      <span>Playfair</span>
      <span>BANGERS</span>
      <span>Montserrat</span>
    </div>
  );
}

function LanguageDemo() {
  return (
    <div className={`${styles.miniPanel} ${styles.languageDemo}`}>
      {[
        ["US", "English"],
        ["FR", "French"],
        ["ES", "Spanish"],
        ["DE", "German"],
      ].map(([country, language]) => (
        <span key={language}>
          <i data-country={country} />
          {language}
        </span>
      ))}
      <small>And many more…</small>
    </div>
  );
}

function ExportDemo() {
  return (
    <div className={`${styles.miniPanel} ${styles.exportDemo}`}>
      <span>
        <FileVideo size={15} /> MP4 <Check size={13} />
      </span>
      <span>
        <FileVideo size={15} /> WebM
      </span>
      <span>
        <Captions size={15} /> SRT subtitles
      </span>
    </div>
  );
}

export function LandingFeatures() {
  return (
    <section id="features" className={styles.features}>
      <div className={styles.container}>
        <div className={styles.sectionHeader}>
          <span className={styles.eyebrow}>Features</span>
          <h2>
            A free AI subtitle generator
            <br />
            with everything you need.
          </h2>
          <p>
            Auto-generate subtitles for videos, edit every word, remove
            backgrounds, grade color, and export SRT or burned-in video — the
            free online video subtitle maker that runs in one browser tab.
          </p>
        </div>
        <div className={styles.featureGrid}>
          <FeatureCard
            icon={Captions}
            title="AI Subtitle Generation"
            tone="yellow"
            badge="WebGPU accelerated"
            demo={<TranscriptionDemo />}
          >
            An auto subtitle generator for videos that runs Whisper in your
            browser. No cloud processing, no upload.
          </FeatureCard>
          <FeatureCard
            icon={ScanFace}
            title="Smart Face Tracking"
            tone="purple"
            demo={<FaceDemo />}
          >
            Subtitles follow the speaker. Face detection keeps text clear of the
            face automatically.
          </FeatureCard>
          <FeatureCard
            icon={AlignVerticalSpaceAround}
            title="Split Subtitle Mode"
            tone="blue"
            demo={<SplitDemo />}
          >
            Place subtitles above and below the speaker, or left and right, with
            face tracking.
          </FeatureCard>
          <FeatureCard
            icon={ImageIcon}
            title="Background Removal"
            tone="pink"
            demo={<FaceDemo removeBackground />}
          >
            Remove or blur the background with AI. Your video stays on your
            device.
          </FeatureCard>
          <FeatureCard
            icon={Type}
            title="25+ Fonts & Custom Styles"
            tone="green"
            demo={<FontsDemo />}
          >
            Choose colors, shadows, emphasis effects, and word-by-word
            highlighting.
          </FeatureCard>
          <FeatureCard
            icon={Globe}
            title="100+ Languages"
            tone="yellow"
            demo={<LanguageDemo />}
          >
            Whisper supports speech in over 100 languages, ready to select in
            the editor.
          </FeatureCard>
          <FeatureCard
            icon={Download}
            title="Export with Baked-in Subs"
            tone="blue"
            demo={<ExportDemo />}
          >
            Download your video with subtitles as part of the picture, or save
            an SRT file.
          </FeatureCard>
          <FeatureCard
            icon={WifiOff}
            title="Works Offline"
            tone="purple"
            demo={
              <div className={`${styles.miniPanel} ${styles.offlineDemo}`}>
                <WifiOff size={25} />
                <span>
                  No internet?
                  <br />
                  No problem.
                </span>
              </div>
            }
          >
            Download the app and models once. Then use the cached tools without
            a connection.
          </FeatureCard>
          <FeatureCard
            icon={Zap}
            title="Free & Built for Speed"
            tone="green"
            demo={
              <div className={`${styles.miniPanel} ${styles.speedDemo}`}>
                <Zap size={27} fill="currentColor" />
                <div>
                  <strong>On your device</strong>
                  <span>with WebGPU</span>
                </div>
                <div className={styles.miniProgress}>
                  <i />
                </div>
              </div>
            }
          >
            No account or payment needed. Use your device’s GPU for fast, local
            processing.
          </FeatureCard>
        </div>
      </div>
    </section>
  );
}
