import { useRef, useState } from "react";
import {
  editSubtitleTiming,
  resetSubtitleTiming,
  restoreSubtitleTiming,
  timingChanged,
  type TimedSubtitle,
  type TimingAction,
  type TimingSelection,
} from "@/lib/subtitle-timing";

export function useSubtitleTiming(
  chunks: readonly TimedSubtitle[],
  duration: number,
  onChange: (chunks: TimedSubtitle[]) => void,
) {
  const [selection, setSelection] = useState<TimingSelection | null>(null);
  const [history, setHistory] = useState<TimedSubtitle[][]>([]);
  const [error, setError] = useState("");
  const transaction = useRef<{
    before: TimedSubtitle[];
    after: TimedSubtitle[];
    selection: TimingSelection;
  } | null>(null);

  const remember = (before: TimedSubtitle[], after: TimedSubtitle[]) => {
    if (timingChanged(before, after)) {
      setHistory((previous) => [...previous.slice(-99), before]);
    }
  };
  const select = (next: TimingSelection) => {
    setSelection(next);
    setError("");
  };
  const begin = (next: TimingSelection) => {
    select(next);
    transaction.current = {
      before: [...chunks],
      after: [...chunks],
      selection: next,
    };
  };
  const update = (action: TimingAction, value: number) => {
    const current = transaction.current;
    if (!current) return;
    current.after = editSubtitleTiming(
      current.before,
      current.selection,
      action,
      value,
      duration,
    );
    onChange(current.after);
  };
  const finish = (cancel = false) => {
    const current = transaction.current;
    if (!current) return;
    transaction.current = null;
    if (cancel) onChange(restoreSubtitleTiming(chunks, current.before));
    else remember(current.before, current.after);
  };
  const change = (action: "start" | "end", value: number) => {
    if (!selection) return;
    const next = editSubtitleTiming(chunks, selection, action, value, duration);
    const accepted =
      action === "start"
        ? next[selection.first]?.timestamp[0]
        : next[selection.last]?.timestamp[1];
    if (accepted === undefined || Math.abs(accepted - value) > 0.00001) {
      setError(
        "Keep the time inside the video and clear of adjacent words. Each word must last at least 0.02 seconds.",
      );
      return false;
    }
    setError("");
    remember([...chunks], next);
    onChange(next);
    return true;
  };
  const undo = () => {
    const snapshot = history.at(-1);
    if (!snapshot) return;
    onChange(restoreSubtitleTiming(chunks, snapshot));
    setHistory((previous) => previous.slice(0, -1));
    setError("");
  };
  const reset = () => {
    if (!selection) return;
    const next = resetSubtitleTiming(chunks, selection, duration);
    if (!next) {
      setError(
        "The original times overlap another word. Undo the adjacent timing edit first.",
      );
      return;
    }
    remember([...chunks], next);
    onChange(next);
    setError("");
  };
  return {
    selection,
    select,
    begin,
    update,
    finish,
    change,
    undo,
    reset,
    canUndo: history.length > 0,
    error,
  };
}
