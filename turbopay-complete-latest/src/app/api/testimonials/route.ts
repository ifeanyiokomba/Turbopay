import { db } from "@/lib/db";
import { json } from "@/lib/turbopay/api";

/**
 * GET /api/testimonials — public endpoint, returns approved + visible
 * testimonials ordered by sortOrder for display on the landing page.
 */
export async function GET() {
  const testimonials = await db.testimonial.findMany({
    where: { approved: true, display: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      role: true,
      location: true,
      quote: true,
      rating: true,
      avatarUrl: true,
    },
  });
  return json({ data: testimonials });
}
