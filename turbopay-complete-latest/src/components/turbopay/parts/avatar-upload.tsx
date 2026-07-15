"use client";

import * as React from "react";
import { Cropper } from "@/components/turbopay/parts/cropper";

/**
 * Avatar Upload with Crop
 *
 * 1. User selects a file from their device.
 * 2. A modal opens with a circular crop preview.
 * 3. User drags/zooms the image to position it.
 * 4. On "Save", the cropped image is uploaded to /api/profile/avatar.
 * 5. The circle avatar in Settings + header updates immediately.
 */

interface AvatarUploadProps {
  currentAvatarUrl?: string | null;
  onUploaded: (url: string) => void;
}

export function AvatarUpload({ currentAvatarUrl, onUploaded }: AvatarUploadProps) {
  const [showCrop, setShowCrop] = React.useState(false);
  const [imageSrc, setImageSrc] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("File too large. Maximum size is 5MB.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      alert("Invalid file type. Use JPG, PNG, or WebP.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setShowCrop(true);
    };
    reader.readAsDataURL(file);
    // Reset the input so the same file can be selected again.
    e.target.value = "";
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("avatar", croppedBlob, "avatar.jpg");
      const res = await fetch("/api/profile/avatar", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      onUploaded(data.data.avatarUrl);
      setShowCrop(false);
      setImageSrc(null);
    } catch (e: any) {
      alert(e.message ?? "Could not upload photo");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <label className="cursor-pointer">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors">
          📷 Upload Photo
        </span>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onSelectFile} />
      </label>
      {showCrop && imageSrc && (
        <Cropper
          imageSrc={imageSrc}
          onCancel={() => { setShowCrop(false); setImageSrc(null); }}
          onConfirm={handleCropComplete}
          loading={uploading}
        />
      )}
    </>
  );
}
