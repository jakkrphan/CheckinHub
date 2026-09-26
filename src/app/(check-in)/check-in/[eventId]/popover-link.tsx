"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

/** A link inside a popover: client navigation keeps the DOM, so the popover must be closed by hand. */
export function PopoverLink({ onClick, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} onClick={(event) => { onClick?.(event); event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover(); }} />;
}
