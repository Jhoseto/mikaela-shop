"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";

// The shadcn/ui Base UI dialog composition, styled for the store's side and bottom panels.
export function Panel({
  open,
  close,
  title,
  children,
  side = "right",
}: {
  open: boolean;
  close: () => void;
  title: string;
  children: React.ReactNode;
  side?: "right" | "center";
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop data-slot="dialog-overlay" className="shop-scrim" />
        <Dialog.Popup
          data-slot="dialog-content"
          className={"shop-panel " + side}
        >
          <div data-slot="dialog-header" className="panel-head">
            <Dialog.Title data-slot="dialog-title">{title}</Dialog.Title>
            <Dialog.Close
              data-slot="dialog-close"
              className="icon-button"
              aria-label="Затвори"
            >
              <X />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
