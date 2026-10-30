import type { Metadata } from "next";
import type { JSX } from "react";

import { AppRoot } from "@/components/app-root";
import { SITE_CANONICAL } from "@/lib/seo";

export const metadata: Metadata = {
  alternates: {
    canonical: SITE_CANONICAL,
  },
};

export default function Home(): JSX.Element {
  return <AppRoot />;
}
