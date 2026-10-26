"use client";

import { useState } from "react";
import { Popover } from "radix-ui";
import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import styles from "./editor.module.css";

type ExportQuality = "medium" | "high" | "very_high";

export function ExportMenu({
  quality,
  onQualityChange,
  onExport,
  processing,
  disabled,
  title,
  longVideo,
}: {
  quality: ExportQuality;
  onQualityChange: (quality: ExportQuality) => void;
  onExport: () => void;
  processing: boolean;
  disabled: boolean;
  title?: string;
  longVideo: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          className={styles.exportButton}
          aria-label={processing ? "Exporting video" : "Export video"}
          disabled={disabled}
          title={title}
        >
          <Download />
          {processing ? "Exporting…" : "Export"}
          <ChevronDown aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.exportMenu}
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Export settings"
        >
          <div className={styles.settingGroup}>
            <label htmlFor="export-quality">Export quality</label>
            <Select
              value={quality}
              onValueChange={(value) => onQualityChange(value as ExportQuality)}
            >
              <SelectTrigger id="export-quality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="medium">Standard · smaller file</SelectItem>
                <SelectItem value="high">High quality</SelectItem>
                <SelectItem value="very_high">Best · larger file</SelectItem>
              </SelectContent>
            </Select>
            <p>Higher quality creates larger files and can take longer.</p>
            <p>
              Mobile exports use up to 1280 pixels on the long edge and 24 fps.
            </p>
            {longVideo ? (
              <p>
                Long videos can take time to export. You can also download SRT
                from the Subtitles panel for use in a desktop video app.
              </p>
            ) : null}
          </div>
          <Button
            className={styles.exportButton}
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onExport();
            }}
          >
            <Download />
            Export video
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
