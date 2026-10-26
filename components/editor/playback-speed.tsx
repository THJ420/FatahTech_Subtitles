"use client";

import { useEffect, useState, type RefObject } from "react";
import { Rabbit } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Use ScreenSlick's presets, capped at 1.5× for speech.
const SPEEDS = [1, 1.1, 1.25, 1.5];

export function PlaybackSpeed({
  videoRef,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setSpeed(video.playbackRate);
    sync();
    video.addEventListener("ratechange", sync);
    video.addEventListener("loadedmetadata", sync);
    return () => {
      video.removeEventListener("ratechange", sync);
      video.removeEventListener("loadedmetadata", sync);
    };
  }, [videoRef]);

  return (
    <Select
      value={String(speed)}
      onValueChange={(value) => {
        const video = videoRef.current;
        const nextSpeed = Number(value);
        if (!video || !SPEEDS.includes(nextSpeed)) return;
        video.preservesPitch = true;
        const legacy = video as HTMLVideoElement & {
          mozPreservesPitch?: boolean;
          webkitPreservesPitch?: boolean;
        };
        if ("mozPreservesPitch" in legacy) legacy.mozPreservesPitch = true;
        if ("webkitPreservesPitch" in legacy)
          legacy.webkitPreservesPitch = true;
        video.playbackRate = nextSpeed;
        setSpeed(nextSpeed);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Playback speed"
        title="Playback speed"
      >
        <SelectValue>
          <Rabbit
            aria-hidden="true"
            viewBox="-9 0 33 24"
            style={{ width: 22, height: 16 }}
          >
            <path d="M-7 8h7M-7 12h4M-5 16h3" />
          </Rabbit>
          {speed}×
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {SPEEDS.map((value) => (
            <SelectItem key={value} value={String(value)}>
              {value}×{value === 1 ? " (Normal)" : ""}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
