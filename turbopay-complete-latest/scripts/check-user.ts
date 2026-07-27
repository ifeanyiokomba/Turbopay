import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(__dirname, "../.env.local") });
const prisma = new PrismaClient();
async function main() {
  try {
    const user = await prisma.user.findFirst({
      where: { email: "okombaifeanyi@gmail.com" },
      select: { id: true, email: true, fullName: true }
    });
    console.log("User:", user);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}
main();
