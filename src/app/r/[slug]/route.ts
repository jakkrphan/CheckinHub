import { redirect } from "next/navigation";

/**
 * Short registration link for posters and QR codes: /r/<slug> → /events/<slug>. Temporary (307) so a changed or
 * reused slug is never pinned in browser caches; unknown slugs get the event page's own 404.
 */
export async function GET(_request: Request, context: RouteContext<"/r/[slug]">) {
  const { slug } = await context.params;
  redirect(`/events/${encodeURIComponent(slug)}`);
}
