import { notFound } from "next/navigation";
import { Tracking } from "@/ui/shop/tracking";
export const metadata = {
  title: "Проследяване на поръчка",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function TrackPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,180}$/.test(token)) notFound();
  return <Tracking token={token} />;
}
