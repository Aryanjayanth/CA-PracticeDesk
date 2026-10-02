/** Resize an image file to a small square-ish JPEG data URL for avatars/logos. */
export async function fileToAvatar(file: File, size = 256): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Could not read image"));
      i.src = url;
    });
    const s = Math.min(img.width, img.height);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
