import { Box, Cpu, Mic, Network, Wrench } from "lucide-react";
import styles from "./landing.module.css";

/**
 * Every entry here is a dependency actually present in this repository:
 * Transformers.js (`@huggingface/transformers`) and MediaBunny are in
 * package.json, Whisper models are the ones the worker loads, and
 * WebGPU/WebAssembly are the real execution backends.
 */
const STACK = [
  { icon: Cpu, name: "WebGPU", note: "GPU inference when available" },
  { icon: Mic, name: "OpenAI Whisper v3", note: "word-level timestamps" },
  { icon: Wrench, name: "WebAssembly SIMD", note: "CPU fallback path" },
  { icon: Network, name: "Transformers.js", note: "client-side inference" },
  { icon: Box, name: "MediaBunny", note: "in-browser demuxing" },
] as const;

export function LandingTechStack() {
  return (
    <section className={styles.techStack}>
      <div className={`${styles.container} ${styles.techStackInner}`}>
        <div className={styles.techStackLabel}>
          <span className={styles.techStackDot} aria-hidden="true" />
          Runs on your device
        </div>
        <ul className={styles.techStackList}>
          {STACK.map(({ icon: Icon, name, note }) => (
            <li key={name}>
              <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
              <span>
                <strong>{name}</strong>
                <small>{note}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
