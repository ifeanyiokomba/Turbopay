import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(__dirname, "../.env.local") });
const prisma = new PrismaClient();
async function main() {
  const configs = await prisma.providerConfig.findMany({
    where: { contract: "notification" },
    select: { id: true, providerName: true, enabled: true, mode: true, credentialKeys: true }
  });
  console.log("Notification providers:", JSON.stringify(configs, null, 2));
  await prisma.$disconnect();
}
main().catch(console.error);
