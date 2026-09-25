"use client";

import { ErrorState } from "@/components/error-state";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorState error={error} retry={retry} homeHref="/organizer" homeLabel="กลับไปโครงการของฉัน" fullPage={false} />;
}
