"use client";

import type { JSX } from "react";
import { useCallback, useState } from "react";
import dynamic from "next/dynamic";

import { LandingPage } from "@/components/landing-page/landing-page";

const MainApp = dynamic(
  () => import("@/components/main-app").then((mod) => mod.MainApp),
  {
    loading: () => (
      <div
        className="flex min-h-dvh items-center justify-center text-muted-foreground"
        role="status"
      >
        Opening your editor…
      </div>
    ),
  },
);

export function AppRoot(): JSX.Element {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleVideoSelect = useCallback((file: File) => {
    setSelectedFile(file);
  }, []);

  const handleReturnToLanding = useCallback(() => {
    setSelectedFile(null);
  }, []);

  if (selectedFile) {
    return (
      <MainApp
        initialFile={selectedFile}
        onReturnToLanding={handleReturnToLanding}
      />
    );
  }

  return <LandingPage onVideoSelect={handleVideoSelect} />;
}

export default AppRoot;
