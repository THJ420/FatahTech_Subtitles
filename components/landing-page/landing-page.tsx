"use client";

import type { DragEvent } from "react";
import { useCallback, useState } from "react";
import { CloudUpload } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { BuyMeCoffee } from "@/components/buy-me-coffee";
import { LandingHeader } from "./landing-header";
import { LandingHero } from "./landing-hero";
import { LandingTechStack } from "./landing-tech-stack";
import { LandingDropzoneSection } from "./landing-dropzone-section";
import { LandingFeatures } from "./landing-features";
import { LandingLocal } from "./landing-local";
import { LandingArchitecture } from "./landing-architecture";
import { LandingHowItWorks } from "./landing-how-it-works";
import { LandingCapabilities } from "./landing-capabilities";
import { LandingCTA } from "./landing-cta";
import styles from "./landing.module.css";

interface LandingPageProps {
  onVideoSelect?: (file: File) => void;
}

export function LandingPage({ onVideoSelect }: LandingPageProps) {
  const [isPageDragOver, setIsPageDragOver] = useState(false);
  const handlePageDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0] ?? null;
      if (file?.type.startsWith("video/")) onVideoSelect?.(file);
    },
    [onVideoSelect],
  );
  const handlePageDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setIsPageDragOver(true);
  }, []);
  const handlePageDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !event.currentTarget.contains(event.relatedTarget)
      )
        setIsPageDragOver(false);
    },
    [],
  );

  return (
    <div
      className={styles.page}
      onDrop={handlePageDrop}
      onDropCapture={() => setIsPageDragOver(false)}
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
    >
      {isPageDragOver ? (
        <div className={styles.pageDropOverlay}>
          <div>
            <CloudUpload size={44} />
            <strong>Drop your video anywhere</strong>
            <span>MP4, MOV, WebM</span>
          </div>
        </div>
      ) : null}
      <LandingHeader />
      <main>
        <LandingHero />
        <LandingTechStack />
        <LandingDropzoneSection onVideoSelect={onVideoSelect} />
        <LandingFeatures />
        <LandingLocal />
        <LandingArchitecture />
        <LandingHowItWorks />
        <LandingCapabilities />
        <LandingCTA />
      </main>
      <SiteFooter variant="landing" />
      <aside aria-label="Support this project">
        <BuyMeCoffee />
      </aside>
    </div>
  );
}
