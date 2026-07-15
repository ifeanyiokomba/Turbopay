import { db } from "@/lib/db";
import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomBytes } from "crypto";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const AVATAR_SIZE = 256; // px
const THUMBNAIL_SIZE = 64; // px

/**
 * POST /api/profile/avatar
 * Uploads a profile photo from the user's device.
 * Processes with sharp: resize to 256x256, compress to WebP, generate 64px thumbnail.
 * Saves to /public/uploads/avatars/ with a random filename.
 * Returns the public URL path.
 */
export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const formData = await req.formData();
  const file = formData.get("avatar") as File | null;
  if (!file) return errorJson("No file uploaded", 400, "NO_FILE");

  // Validate file size (5MB max).
  if (file.size > MAX_FILE_SIZE) {
    return errorJson("File too large. Maximum size is 5MB.", 400, "FILE_TOO_LARGE");
  }

  // Validate file type.
  if (!ALLOWED_TYPES.includes(file.type)) {
    return errorJson("Invalid file type. Use JPG, PNG, or WebP.", 400, "INVALID_TYPE");
  }

  // Read file bytes.
  const bytes = await file.arrayBuffer();
  const inputBuffer = Buffer.from(bytes);

  // Process image with sharp: resize + compress + generate thumbnail.
  let outputBuffer: Buffer;
  let thumbnailBuffer: Buffer;
  try {
    const sharp = (await import("sharp")).default;

    // Resize to AVATAR_SIZE x AVATAR_SIZE, cover fit, center crop, convert to WebP.
    outputBuffer = await sharp(inputBuffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "center" })
      .webp({ quality: 85 })
      .toBuffer();

    // Generate thumbnail.
    thumbnailBuffer = await sharp(inputBuffer)
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "cover", position: "center" })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return errorJson("Failed to process image. Please try a different file.", 400, "PROCESSING_FAILED");
  }

  // Generate unique filenames.
  const hex = randomBytes(4).toString("hex");
  const avatarFilename = `${user.id}-${hex}.webp`;
  const thumbFilename = `${user.id}-${hex}-thumb.webp`;

  const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars");

  // Ensure upload directories exist.
  await mkdir(uploadDir, { recursive: true });

  // Delete old avatar files if they exist.
  const oldUser = await db.user.findUnique({ where: { id: user.id }, select: { avatarUrl: true } });
  if (oldUser?.avatarUrl) {
    const oldPath = path.join(process.cwd(), "public", oldUser.avatarUrl);
    const oldThumbPath = path.join(process.cwd(), "public", oldUser.avatarUrl.replace(".webp", "-thumb.webp"));
    try { await unlink(oldPath); } catch { /* ignore */ }
    try { await unlink(oldThumbPath); } catch { /* ignore */ }
  }

  // Write processed files.
  await writeFile(path.join(uploadDir, avatarFilename), outputBuffer);
  await writeFile(path.join(uploadDir, thumbFilename), thumbnailBuffer);

  const avatarUrl = `/uploads/avatars/${avatarFilename}`;

  // Update the user's avatarUrl in the database.
  await db.user.update({
    where: { id: user.id },
    data: { avatarUrl },
  });

  return json({ data: { avatarUrl } });
}
