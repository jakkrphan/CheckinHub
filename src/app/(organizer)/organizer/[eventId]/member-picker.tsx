"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { BuildingIcon, LoaderCircleIcon, SearchIcon, UserPlusIcon, XIcon } from "lucide-react";

import type { MemberCandidate, MemberSearch } from "@/app/(organizer)/organizer/[eventId]/member-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

/**
 * Step 5 "เพิ่มผู้ร่วมจัด": type a name (or email / AD login), pick a person from this system or from AD, choose the
 * role and add. The form posts only the chosen email; the server looks the person up again before adding.
 */
export function MemberPicker({ action, search }: { action: (formData: FormData) => Promise<void>; search: (query: string) => Promise<MemberSearch> }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<MemberSearch | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<MemberCandidate | null>(null);
  const [searching, startSearch] = useTransition();
  const latest = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (chosen || text.length < 2) return;
    const ticket = ++latest.current;
    // Debounced so typing a Thai name does not query AD on every keystroke; stale answers are dropped.
    const timer = window.setTimeout(() => startSearch(async () => {
      const found = await search(text);
      if (ticket === latest.current) { setResult(found); setActive(0); setOpen(true); }
    }), 300);
    return () => window.clearTimeout(timer);
  }, [query, chosen, search]);

  const people = query.trim().length >= 2 ? result?.people ?? [] : [];
  const pick = (person: MemberCandidate) => { if (person.member) return; setChosen(person); setOpen(false); };

  return <form action={action} className="flex flex-col gap-2">
    <div className="flex flex-wrap gap-2">
      <div className="relative min-w-52 flex-1">
        {chosen ? <div className="flex h-10 items-center gap-2 rounded-md border border-primary bg-accent px-3 text-sm">
          <span className="min-w-0 flex-1 truncate"><strong>{chosen.name}</strong> <span className="text-muted-foreground">· {chosen.email}</span></span>
          <button type="button" onClick={() => { setChosen(null); setQuery(""); setResult(null); }} aria-label="เลือกคนอื่น" className="-mr-1 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"><XIcon className="size-4" aria-hidden="true" /></button>
          <input type="hidden" name="email" value={chosen.email} />
        </div> : <>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="memberQuery" className="sr-only">ค้นหาผู้ร่วมจัดจากชื่อ อีเมล หรือชื่อผู้ใช้ AD</label>
          <Input id="memberQuery" value={query} autoComplete="off" maxLength={64} placeholder="พิมพ์ชื่อ-สกุล อีเมล หรือชื่อผู้ใช้ AD"
            role="combobox" aria-expanded={open && people.length > 0} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={open && people[active] ? `${listId}-${active}` : undefined}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && people.length) { event.preventDefault(); setOpen(true); setActive((active + 1) % people.length); }
              if (event.key === "ArrowUp" && people.length) { event.preventDefault(); setActive((active - 1 + people.length) % people.length); }
              if (event.key === "Enter") { event.preventDefault(); if (open && people[active]) pick(people[active]); }
              if (event.key === "Escape") setOpen(false);
            }}
            className="h-10 pl-9 pr-9" />
          {searching && <LoaderCircleIcon className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />}
          {open && query.trim().length >= 2 && result && !searching && <ul id={listId} role="listbox" aria-label="ผลการค้นหา" className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
            {people.map((person, index) => <li key={person.email} id={`${listId}-${index}`} role="option" aria-selected={index === active} aria-disabled={person.member}
              onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => pick(person)}
              className={cn("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2", index === active && "bg-accent", person.member && "cursor-not-allowed opacity-60")}>
              <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-sm font-semibold">{person.name}</span><span className="flex items-center gap-1 truncate text-xs text-muted-foreground">{person.source === "directory" && <BuildingIcon className="size-3 shrink-0" aria-hidden="true" />}{person.detail}</span></span>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{person.member ? "เป็นผู้ร่วมจัดแล้ว" : person.source === "account" ? "มีบัญชีแล้ว" : "จาก AD"}</span>
            </li>)}
            {people.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">ไม่พบ “{query.trim()}”{result.directory === "off" ? " ในบัญชีของระบบ" : ""}</li>}
            {result.directory === "unavailable" && <li className="px-3 py-2 text-xs text-[var(--status-warning)]">เชื่อมต่อ AD ไม่ได้ขณะนี้ — แสดงเฉพาะบัญชีที่มีในระบบ</li>}
          </ul>}
        </>}
      </div>
      <label htmlFor="memberRole" className="sr-only">สิทธิ์</label>
      <NativeSelect id="memberRole" name="role" defaultValue="FULL" className="h-10 w-40"><option value="FULL">เต็มสิทธิ์</option><option value="CHECKIN_ONLY">เช็คชื่ออย่างเดียว</option></NativeSelect>
      <Button type="submit" size="lg" className="h-10" disabled={!chosen}><UserPlusIcon data-icon="inline-start" aria-hidden="true" />เพิ่ม</Button>
    </div>
    {chosen?.source === "directory" && <p className="text-xs text-muted-foreground">ยังไม่มีบัญชีในระบบ — กดเพิ่มแล้วระบบสร้างบัญชีจาก AD ให้ เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน AD</p>}
  </form>;
}
