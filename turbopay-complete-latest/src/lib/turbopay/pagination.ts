/**
 * TurboPay — Pagination Helper
 * =============================
 *
 * Standardized pagination for all list endpoints. Provides:
 *   - Query parameter parsing (page, limit, cursor)
 *   - Response formatting with metadata
 *   - Database query helpers
 *
 * Usage:
 *   const { page, limit, offset } = parsePagination(req);
 *   const { items, total } = await paginate(db.savingsProduct, { where, orderBy }, { page, limit });
 *   return json({ data: formatPaginated(items, total, page, limit) });
 */

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Parse pagination parameters from a Request's query string.
 * Defaults: page=1, limit=20, max limit=100.
 */
export function parsePagination(req: Request, defaults?: { page?: number; limit?: number }): PaginationParams {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? String(defaults?.page ?? 1), 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? String(defaults?.limit ?? 20), 10)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Format a paginated response with metadata.
 */
export function formatPaginated<T>(items: T[], total: number, page: number, limit: number): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / limit);
  return {
    items,
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Generic paginate function for Prisma models.
 * Usage:
 *   const result = await paginate(db.savingsProduct, { where: { userId } }, { page: 1, limit: 20 });
 */
export async function paginate<T extends { findMany: any; count: any }>(
  model: T,
  options: { where?: any; orderBy?: any; include?: any; select?: any },
  params: PaginationParams
): Promise<PaginatedResponse<Awaited<ReturnType<T["findMany"]>>[number]>> {
  const { where = {}, orderBy, include, select } = options;
  const { page, limit, offset } = params;

  const [items, total] = await Promise.all([
    model.findMany({
      where,
      orderBy: orderBy ?? { createdAt: "desc" },
      take: limit,
      skip: offset,
      ...(include ? { include } : {}),
      ...(select ? { select } : {}),
    }),
    model.count({ where }),
  ]);

  return formatPaginated(items, total, page, limit);
}
