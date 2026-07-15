import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Increase socket timeout for SQLite tests (default 5s is too low under concurrent load)
const isTest = process.env.NODE_ENV === 'development' || process.env.VITEST !== undefined

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['warn', 'error'],
    ...(isTest ? { datasources: { db: { url: process.env.DATABASE_URL } } } : {}),
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db