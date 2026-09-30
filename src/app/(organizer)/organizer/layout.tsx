import { requireActiveUser } from "@/server/authorization/session";

import { AppShell } from "./app-shell";

export default async function OrganizerLayout({ children }: LayoutProps<"/organizer">) {
  const user = await requireActiveUser();
  return <AppShell user={user}>{children}</AppShell>;
}
