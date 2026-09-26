/** The check-in area is dark edge to edge, so centred columns never show the light app background beside them. */
export default function CheckInLayout({ children }: LayoutProps<"/check-in">) {
  return <div className="checkin-screen flex min-h-svh flex-1 flex-col bg-background text-foreground">{children}</div>;
}
