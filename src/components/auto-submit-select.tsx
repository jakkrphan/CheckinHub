"use client";

import type { ComponentProps } from "react";

/** A select that submits its form as soon as the value changes (e.g. role changes), keeping a no-JS submit button optional. */
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <select {...props} onChange={(event) => { props.onChange?.(event); event.currentTarget.form?.requestSubmit(); }} />;
}
