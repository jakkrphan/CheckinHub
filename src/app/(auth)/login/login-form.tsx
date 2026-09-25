"use client";

import { useActionState, useState } from "react";
import { EyeIcon, EyeOffIcon, LoaderCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { login, type LoginState } from "./actions";

const messages = {
  invalid: "อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือบัญชียังไม่ได้ตั้งรหัสผ่าน/ถูกปิดใช้งาน",
  "rate-limited": "พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่",
};

export function LoginForm({ next }: { next: string | null }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [showPassword, setShowPassword] = useState(false);

  return <form action={action} className="flex flex-col gap-6" noValidate={false}>
    {next && <input type="hidden" name="next" value={next} />}
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="email">อีเมล</FieldLabel>
        <Input id="email" name="email" type="email" autoComplete="username" defaultValue={state.email} autoFocus required aria-invalid={!!state.error} aria-describedby={state.error ? "login-error" : undefined} />
      </Field>
      <Field>
        <FieldLabel htmlFor="password">รหัสผ่าน</FieldLabel>
        <div className="relative">
          <Input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required className="pr-11" aria-invalid={!!state.error} aria-describedby={state.error ? "login-error" : undefined} />
          <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {showPassword ? <EyeOffIcon className="size-4" aria-hidden="true" /> : <EyeIcon className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </Field>
    </FieldGroup>
    {state.error && <p id="login-error" role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{messages[state.error]}</p>}
    <Button type="submit" size="lg" disabled={pending}>{pending && <LoaderCircleIcon className="animate-spin" data-icon="inline-start" aria-hidden="true" />}{pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</Button>
  </form>;
}
