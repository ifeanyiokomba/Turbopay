/** Deployment Profiles — dev/staging/sandbox/production. */
import { db } from "@/lib/db";
import { recordConfigVersion } from "@/lib/turbocore/config/versioning";

export interface DeploymentProfileConfig {
  providerModeOverrides?: Record<string, "mock" | "sandbox" | "production">;
  featureFlagDefaults?: Record<string, boolean>;
  rateLimitMultiplier?: number;
  maintenanceMode?: boolean;
}

class DeploymentProfileService {
  async list() { return db.deploymentProfile.findMany({ orderBy: { name: "asc" } }); }
  async getActive() { return db.deploymentProfile.findFirst({ where: { active: true } }); }
  async create(name: string, config: DeploymentProfileConfig, description?: string, actor?: { id: string; name: string }) {
    const created = await db.deploymentProfile.create({ data: { name, description, config: JSON.stringify(config), active: false } });
    await recordConfigVersion("deploymentProfile", created.id, "CREATE", null, created, undefined, actor);
    return created;
  }
  async update(id: string, config: DeploymentProfileConfig, actor?: { id: string; name: string }) {
    const existing = await db.deploymentProfile.findUnique({ where: { id } });
    const updated = await db.deploymentProfile.update({ where: { id }, data: { config: JSON.stringify(config) } });
    await recordConfigVersion("deploymentProfile", id, "UPDATE", existing, updated, undefined, actor);
    return updated;
  }
  async activate(id: string, actor?: { id: string; name: string }) {
    await db.deploymentProfile.updateMany({ where: { active: true }, data: { active: false } });
    const updated = await db.deploymentProfile.update({ where: { id }, data: { active: true } });
    await recordConfigVersion("deploymentProfile", id, "UPDATE", null, updated, "Profile activated", actor);
    return updated;
  }
}
export const deploymentProfiles = new DeploymentProfileService();
