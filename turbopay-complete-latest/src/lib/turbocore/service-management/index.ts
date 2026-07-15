import { db } from "@/lib/db";

class ServiceManagementService {
  async list() { return db.serviceFlag.findMany({ orderBy: { service: "asc" } }); }
  async get(service: string) { return db.serviceFlag.findUnique({ where: { service } }); }
  async isEnabled(service: string): Promise<boolean> {
    const flag = await db.serviceFlag.findUnique({ where: { service } });
    return flag?.enabled ?? true; // default: enabled if not configured
  }
  async toggle(service: string, enabled: boolean, updatedBy?: string) {
    return db.serviceFlag.upsert({
      where: { service },
      create: { service, displayName: service, enabled, updatedBy },
      update: { enabled, updatedBy },
    });
  }
  async initializeDefaults() {
    const services = ["wallet", "transfers", "bills", "cards", "savings", "investments", "international", "notifications", "kyc", "aml"];
    for (const service of services) {
      await db.serviceFlag.upsert({
        where: { service },
        create: { service, displayName: service.charAt(0).toUpperCase() + service.slice(1), enabled: true },
        update: {},
      });
    }
  }
}

export const serviceManagement = new ServiceManagementService();
