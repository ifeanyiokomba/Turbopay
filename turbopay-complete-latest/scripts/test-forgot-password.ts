import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(__dirname, "../.env.local") });
const prisma = new PrismaClient();
async function main() {
  try {
    const user = await prisma.user.findFirst({
      where: { email: "admin@okomba.com" },
      select: { id: true, email: true, fullName: true }
    });
    console.log("User found:", user);
    
    if (user) {
      // Try to create an OTP code
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
      
      // Delete the test OTP
      await prisma.otpCode.delete({ where: { id: otpRecord.id } });
      console.log("OTP deleted");
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}
main();
