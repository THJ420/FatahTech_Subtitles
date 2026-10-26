import {
  AudioLines,
  Captions,
  Check,
  ChevronRight,
  Cpu,
  Laptop,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
  WifiOff,
  Zap,
} from "lucide-react";
import {
  STATUS_MESSAGES,
  type ModelLoadingState,
  type TranscriptionStatus,
} from "@/hooks/useTranscription";
import styles from "./editor.module.css";
import progressStyles from "./transcription-progress.module.css";

const modelPhases: Record<
  ModelLoadingState["phase"],
  { title: string; detail: string; step: string }
> = {
  checking: {
    title: "Checking speech model...",
    detail:
      "Checking for a saved model on your device. The first run needs a download.",
    step: "Checking saved model files.",
  },
  downloading: {
    title: "Loading model files...",
    detail:
      "Saved files load from browser storage. Missing files download and are saved for future use.",
    step: "Loading saved or new model files.",
  },
  initializing: {
    title: "Preparing speech model...",
    detail:
      "Starting the model on your device. This can take a minute on the first run.",
    step: "Starting the speech model.",
  },
  warming: {
    title: "Getting speech recognition ready...",
    detail:
      "Preparing your device to process speech. This can take a minute on the first run.",
    step: "Preparing speech recognition.",
  },
  ready: {
    title: "Speech model is ready",
    detail: "The model is ready. Your video will be processed on this device.",
    step: "Ready to process your video.",
  },
};

function formatDownloadBytes(bytes: number) {
  return `${(Math.max(0, bytes) / 1_000_000).toFixed(1)} MB`;
}

const benefits = [
  {
    icon: Laptop,
    title: "Runs in your browser",
    detail: "Your video stays on this device.",
    tone: "green",
  },
  {
    icon: LockKeyhole,
    title: "Your video stays private",
    detail: "No video uploads.",
    tone: "yellow",
  },
  {
    icon: Zap,
    title: "Built for your device",
    detail: "GPU or CPU processing.",
    tone: "blue",
  },
  {
    icon: WifiOff,
    title: "Works offline",
    detail: "Once the models are cached.",
    tone: "pink",
  },
];

export function TranscriptionProgress({
  status,
  progress,
  device,
  modelLoading,
}: {
  status: TranscriptionStatus;
  progress: number;
  device: string;
  modelLoading: ModelLoadingState | null;
}) {
  const isLoading = status === "loading";
  const modelPhase = isLoading
    ? modelPhases[modelLoading?.phase ?? "checking"]
    : null;
  const measuredProgress = isLoading
    ? modelLoading?.phase === "downloading"
      ? modelLoading.progress
      : null
    : status === "transcribing" && progress > 0
      ? progress
      : null;
  const percent =
    measuredProgress !== null && Number.isFinite(measuredProgress)
      ? Math.max(0, Math.min(100, Math.round(measuredProgress)))
      : null;
  const title = modelPhase?.title ?? STATUS_MESSAGES[status];
  const stage = status === "transcribing" ? 2 : status === "loading" ? 1 : 0;
  const steps = [
    {
      icon: AudioLines,
      label: "Checking audio",
      detail: "Reading speech from your video.",
    },
    {
      icon: Cpu,
      label: "Loading model",
      detail: modelPhase?.step ?? "Preparing the speech model.",
    },
    {
      icon: Captions,
      label: "Generating subtitles",
      detail: "Converting speech to text.",
    },
  ];
  return (
    <div className={styles.processingScreen}>
      <section className={styles.processingCard}>
        <div className={styles.processingHeading}>
          <span className={styles.processingIcon} aria-hidden="true">
            {isLoading ? (
              <LoaderCircle className={progressStyles.spinner} />
            ) : (
              <Sparkles />
            )}
          </span>
          <div role="status" aria-live="polite" aria-atomic="true">
            <h1>{title}</h1>
            <p>
              {modelPhase?.detail ??
                "All video processing runs on your device. You can keep this tab open while we work."}
            </p>
          </div>
          <div className={styles.processingDevice}>
            <Zap />
            <div>
              <strong>
                {device === "webgpu"
                  ? "Powered by WebGPU"
                  : "Running on your CPU"}
              </strong>
              <span>No video uploads. All local.</span>
            </div>
          </div>
        </div>
        <div className={`${styles.progressRow} ${progressStyles.progressRow}`}>
          <div
            className={`${styles.progressTrack} ${progressStyles.track}`}
            data-indeterminate={percent === null}
            role="progressbar"
            aria-label={
              isLoading ? "Speech model preparation" : "Subtitle progress"
            }
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            aria-valuetext={
              percent === null
                ? title
                : `${percent}% ${isLoading ? "loaded" : "transcribed"}`
            }
          >
            <div
              style={
                percent === null
                  ? undefined
                  : { transform: `scaleX(${percent / 100})` }
              }
            />
          </div>
          <strong className={progressStyles.progressValue}>
            {percent === null ? "Working..." : `${percent}%`}
          </strong>
        </div>
        {isLoading &&
        modelLoading?.phase === "downloading" &&
        modelLoading.loadedBytes > 0 ? (
          <p className={progressStyles.downloadDetail}>
            {formatDownloadBytes(modelLoading.loadedBytes)}
            {modelLoading.totalBytes !== null
              ? ` of ${formatDownloadBytes(modelLoading.totalBytes)}`
              : " downloaded"}
            {modelLoading.totalFiles > 0 ? (
              <span>
                {modelLoading.completedFiles} of {modelLoading.totalFiles} files
                ready
              </span>
            ) : null}
          </p>
        ) : null}
        <div className={styles.processingSteps}>
          {steps.map((step, index) => (
            <div key={step.label} className={styles.processingStepGroup}>
              <div
                className={styles.processingStep}
                data-active={stage === index}
                data-complete={stage > index}
              >
                <span>{stage > index ? <Check /> : <step.icon />}</span>
                <div>
                  <strong>
                    {index + 1}. {step.label}
                  </strong>
                  <p>{stage > index ? "Complete" : step.detail}</p>
                </div>
              </div>
              {index < 2 ? <ChevronRight className={styles.stepArrow} /> : null}
            </div>
          ))}
        </div>
      </section>
      <div className={styles.processingBenefits}>
        {benefits.map((item) => (
          <div key={item.title}>
            <span data-tone={item.tone}>
              <item.icon />
            </span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
      <p className={styles.processingNote}>
        You can cancel at any time. Your original video stays unchanged.
      </p>
    </div>
  );
}
