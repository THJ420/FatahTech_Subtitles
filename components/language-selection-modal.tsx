"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  LanguageSelector,
  type LanguageCode,
} from "@/components/language-selector";
import {
  Check,
  Globe2,
  Languages,
  LockKeyhole,
  Video,
  Loader2,
  Zap,
  AlertTriangle,
  Cpu,
} from "lucide-react";
import {
  MODEL_REQUIREMENTS,
  checkModelCapabilities,
  type ModelCapability,
} from "@/lib/hardware-check";
import type { ModelSize } from "@/hooks/useTranscription";
import panelStyles from "@/components/editor-panels.module.css";

interface LanguageSelectionModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (language: LanguageCode, modelSize: ModelSize) => void;
  defaultLanguage?: LanguageCode;
  defaultModelSize?: ModelSize;
}

/** Every size renders as supported until the probe resolves. `null` means the
 * probe has not finished, so the list never flashes greyed out on open. */
type CapabilityMap = Record<string, ModelCapability | null>;

const SUPPORTED: ModelCapability = { supported: true };

/**
 * Requirement labels bundle the name and the download size
 * ("Turbo (~800MB)"). They are split so the size can be typeset as a
 * secondary tag instead of inheriting the model's heading size.
 */
function splitLabel(label: string): { name: string; size: string | null } {
  const match = /^(.*?)\s*(\(.+\))$/.exec(label);
  return match
    ? { name: match[1], size: match[2] }
    : { name: label, size: null };
}

export function LanguageSelectionModal({
  open,
  onClose,
  onConfirm,
  defaultLanguage = "en",
  defaultModelSize = "base",
}: LanguageSelectionModalProps) {
  const [selectedLanguage, setSelectedLanguage] =
    useState<LanguageCode>(defaultLanguage);
  const [selectedModelSize, setSelectedModelSize] =
    useState<ModelSize>(defaultModelSize);
  const [isProcessing, setIsProcessing] = useState(false);
  // `null` means the probe has not resolved yet. Deriving `isChecking` from it
  // avoids a synchronous setState in the effect, which would trigger a
  // cascading render on every modal open.
  const [capabilities, setCapabilities] = useState<CapabilityMap | null>(null);

  // Probe hardware each time the modal opens. Re-checking on open matters
  // because GPU availability can change (driver reload, tab moved to a
  // different machine profile), and a stale verdict would offer a model that
  // can no longer load.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    checkModelCapabilities()
      .then((result) => {
        if (cancelled) return;
        setCapabilities(result);
        // Never leave the selection on a model this device cannot load.
        setSelectedModelSize((current) =>
          result[current]?.supported ? current : "base",
        );
      })
      .catch(() => {
        // A failed probe must not block the modal; fall back to permissive
        // so the user can still pick a small model.
        if (!cancelled) setCapabilities({});
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const isChecking = capabilities === null;
  const capabilityOf = (modelSize: ModelSize): ModelCapability =>
    capabilities?.[modelSize] ?? SUPPORTED;

  const selectModel = useCallback(
    (modelSize: ModelSize) => {
      // Ignore clicks on unavailable options so a stale pointer event or
      // keyboard activation cannot bypass the disabled state.
      if (capabilities?.[modelSize]?.supported === false) return;
      setSelectedModelSize(modelSize);
    },
    [capabilities],
  );

  const handleConfirm = () => {
    if (capabilityOf(selectedModelSize).supported === false) return;
    setIsProcessing(true);
    onConfirm(selectedLanguage, selectedModelSize);
    // Modal will auto-close when transcription status changes
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className={panelStyles.languageModal}>
        <DialogHeader>
          <div className={panelStyles.languageIcon}>
            <Globe2 size={30} aria-hidden="true" />
          </div>
          <DialogTitle className={panelStyles.languageTitle}>
            Select video language
          </DialogTitle>
          <DialogDescription className={panelStyles.languageDescription}>
            Choose the language spoken in your video for accurate transcription.
          </DialogDescription>
        </DialogHeader>
        <div className={panelStyles.languageForm}>
          <LanguageSelector
            language={selectedLanguage}
            onLanguageChange={setSelectedLanguage}
            disabled={isProcessing}
          />

          <div>
            <div className={panelStyles.modelHeading}>
              <p id="model-size-label" className="text-sm font-semibold">
                Model size
              </p>
              <span className={panelStyles.localPill}>
                <Zap aria-hidden="true" /> Runs in your browser
              </span>
            </div>
            {isChecking ? (
              <p className={panelStyles.modelChecking} role="status">
                <Loader2
                  size={12}
                  className="animate-spin"
                  aria-hidden="true"
                />
                Checking this device&rsquo;s GPU and memory&hellip;
              </p>
            ) : null}
            <div
              className={panelStyles.modelOptions}
              role="group"
              aria-labelledby="model-size-label"
            >
              {MODEL_REQUIREMENTS.map((option) => {
                const capability = capabilityOf(option.value);
                const isUnsupported = capability.supported === false;
                const isActive =
                  selectedModelSize === option.value && !isUnsupported;
                const reason = capability.reason;
                const { name, size } = splitLabel(option.label);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isActive}
                    aria-disabled={isUnsupported || undefined}
                    data-model={option.value}
                    data-unsupported={isUnsupported || undefined}
                    disabled={isProcessing || isUnsupported}
                    title={
                      isUnsupported
                        ? `${option.label} is unavailable on this device: ${reason}`
                        : `${option.label} — ${option.description}`
                    }
                    onClick={() => selectModel(option.value)}
                    className={`${panelStyles.modelCard} ${
                      isUnsupported ? panelStyles.modelCardDisabled : ""
                    }`}
                  >
                    <span>
                      {isUnsupported ? (
                        <AlertTriangle size={26} aria-hidden="true" />
                      ) : (
                        <Zap size={26} fill="currentColor" aria-hidden="true" />
                      )}
                    </span>
                    <span className={panelStyles.modelBody}>
                      <strong>{name}</strong>
                      {size ? (
                        <span className={panelStyles.modelSize}>{size}</span>
                      ) : null}
                      <small>
                        {isUnsupported && reason ? reason : option.description}
                      </small>
                    </span>
                    {isActive ? (
                      <Check
                        size={24}
                        className={panelStyles.modelCheck}
                        aria-hidden="true"
                      />
                    ) : null}
                    {isUnsupported ? (
                      <span
                        className={panelStyles.modelBlocked}
                        aria-hidden="true"
                      >
                        <Cpu size={13} />
                        Unavailable
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={panelStyles.languageNote}>
            <Languages aria-hidden="true" />
            <div>
              <strong>Use the spoken language</strong>
              <p>
                Select the language you hear in the video. This helps the speech
                model write the correct words and times.
              </p>
              <p className="mt-2">
                The model downloads once. Your video stays on your device.
              </p>
            </div>
          </div>
          <div className={panelStyles.languageActions}>
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1"
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              className="flex-1"
              disabled={isProcessing || isChecking}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Video className="w-4 h-4 mr-2" />
                  Transcribe video
                </>
              )}
            </Button>
          </div>
          <p className={panelStyles.languagePrivacy}>
            <LockKeyhole size={13} aria-hidden="true" /> Your video stays on
            your device. All processing is local.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
