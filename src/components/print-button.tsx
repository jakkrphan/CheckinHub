"use client";

import { PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PrintButton({ label = "พิมพ์" }: { label?: string }) {
  return <Button type="button" size="lg" onClick={() => window.print()}><PrinterIcon data-icon="inline-start" aria-hidden="true" />{label}</Button>;
}
