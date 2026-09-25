import { LogOutIcon } from "lucide-react";

import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { requireActiveUser } from "@/server/authorization/session";

import { OrganizerSidebar } from "./sidebar";

export default async function OrganizerLayout({ children }: LayoutProps<"/organizer">) {
  const user = await requireActiveUser();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <OrganizerSidebar isAdmin={user.role === "ADMIN"} name={user.name} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[60px] print:hidden flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2 sm:px-6 lg:px-8">
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden min-h-11 items-center gap-2 rounded-full border bg-card px-2 pr-3 sm:flex">
              <span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{user.name.trim().slice(0, 2)}</span>
              <span className="flex flex-col leading-tight"><span className="max-w-48 truncate text-sm font-semibold">{user.name}</span><span className="text-xs text-muted-foreground">{user.role === "ADMIN" ? "ผู้ดูแลระบบ" : user.role === "STAFF" ? "เจ้าหน้าที่" : "ผู้จัดโครงการ"}</span></span>
            </div>
            <form action={logout}>
              <Button type="submit" variant="outline" size="sm" aria-label="ออกจากระบบ">
                <LogOutIcon data-icon="inline-start" />
                <span className="hidden sm:inline">ออกจากระบบ</span>
              </Button>
            </form>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
