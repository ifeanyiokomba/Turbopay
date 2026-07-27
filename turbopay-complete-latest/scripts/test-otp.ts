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
    if (!user) { console.log("User not found"); return; }
    
    const otpCode = "123456";
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
    const otpRecord = await prisma.otpCode.create({
      data: {
        userId: user.id,
        channel: "EMAIL",
        target: user.email ?? "",
        code: otpCode,
        purpose: "RESET_PASSWORD",
        expiresAt,
      },
    });
    console.log("OTP created:", otpRecord.id);
    
    // Clean up
    await prisma.otpCode.delete({ where: { id: otpRecord.id } });
    console.log("OTP cleaned up");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}
main();
