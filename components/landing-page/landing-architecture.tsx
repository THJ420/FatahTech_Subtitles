import { CloudOff, Cpu, ShieldCheck } from "lucide-react";
import styles from "./landing.module.css";

/**
 * Transcribed from `app/worker.ts` so the sample stays true to how the app
 * actually loads a model.
 */
const CODE_SAMPLE = `import { pipeline } from "@huggingface/transformers";

// The \`_timestamped\` repos expose the alignment head the editor needs
// for word-level subtitle timing.
const transcriber = await pipeline(
  "automatic-speech-recognition",
  "onnx-community/whisper-base_timestamped",
  {
    device: "webgpu",
    dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
  },
);

const { text, chunks } = await transcriber(audio, {
  return_timestamps: "word",
});`;

/**
 * Factual runtime properties only — no invented benchmarks. Values are
 * properties of the architecture, not measurements.
 */
const FACTS = [
  { icon: CloudOff, label: "Audio sent to a server", value: "None", tone: "green" },
  { icon: Cpu, label: "Compute backend", value: "WebGPU, else WASM", tone: "cyan" },
  { icon: ShieldCheck, label: "Model weights", value: "Cached on device", tone: "blue" },
] as const;

const PILLARS = [
  {
    icon: CloudOff,
    title: "Zero Video Uploads",
    detail:
      "Your confidential raw video files never leave local browser memory. There is no upload step and no server-side queue to wait in.",
    tone: "green",
  },
  {
    icon: ShieldCheck,
    title: "Private by Architecture",
    detail:
      "Inference runs on open-source Transformers.js and Whisper models inside this tab. No account, no tracking, and MIT-licensed code you can inspect.",
    tone: "blue",
  },
  {
    icon: Cpu,
    title: "Apple Silicon & NVIDIA Direct Acceleration",
    detail:
      "Hardware-accelerated matrix math through WebGPU compute shaders on Metal, DirectX 12, or Vulkan, with an automatic WebAssembly fallback.",
    tone: "cyan",
  },
] as const;

export function LandingArchitecture() {
  return (
    <section id="architecture" className={styles.architecture}>
      <div className={`${styles.container} ${styles.architectureGrid}`}>
        <div className={styles.terminal}>
          <div className={styles.terminalBar}>
            <span className={styles.terminalDots} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>app/worker.ts</span>
            <span className={styles.terminalPill}>WebGPU + WASM</span>
          </div>
          <pre className={styles.terminalBody}>
            <code>{CODE_SAMPLE}</code>
          </pre>
          <dl className={styles.factGrid}>
            {FACTS.map(({ icon: Icon, label, value, tone }) => (
              <div key={label}>
                <dt>
                  <Icon size={15} strokeWidth={2} aria-hidden="true" />
                  {label}
                </dt>
                <dd data-tone={tone}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className={styles.architectureCopy}>
          <span className={styles.eyebrow}>Engineered Architecture</span>
          <h2>
            Your browser is the{" "}
            <span className={styles.highlight}>entire production studio.</span>
          </h2>
          <p>
            Traditional subtitling platforms upload heavy gigabytes of footage
            to remote cloud servers. FatahTech shifts the neural compute load
            straight to your client silicon.
          </p>
          <ul className={styles.pillarList}>
            {PILLARS.map(({ icon: Icon, title, detail, tone }) => (
              <li key={title} data-tone={tone}>
                <span className={styles.pillarIcon}>
                  <Icon size={20} strokeWidth={2} aria-hidden="true" />
                </span>
                <div>
                  <strong>{title}</strong>
                  <p>{detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
