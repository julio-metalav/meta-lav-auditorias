export async function preprocessImage(
  file: File,
  opts?: { maxSide?: number; quality?: number; forceJpeg?: boolean }
): Promise<File> {
  const maxSide = opts?.maxSide ?? 1600;     // 1600px segura bem p/ medidores
  const quality = opts?.quality ?? 0.72;     // 0.65–0.8 costuma ficar ótimo
  const forceJpeg = opts?.forceJpeg ?? true;

  // Se já é pequeno, não mexe
  if (file.size <= 2_500_000) return file; // ~2.5MB

  const img = await fileToImageBitmap(file);

  const { width, height } = img;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(img as any, 0, 0, targetW, targetH);

  const outType = forceJpeg ? "image/jpeg" : (file.type || "image/jpeg");
  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b || new Blob()), outType, quality)
  );

  const outName = forceJpeg
    ? file.name.replace(/\.[^/.]+$/, "") + ".jpg"
    : file.name;

  return new File([blob], outName, { type: outType, lastModified: Date.now() });
}

async function fileToImageBitmap(file: File): Promise<ImageBitmap> {
  // createImageBitmap é bem mais leve que Image()
  try {
    return await createImageBitmap(file);
  } catch {
    // fallback
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    URL.revokeObjectURL(url);

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Sem canvas");
    ctx.drawImage(img, 0, 0);

    const blob: Blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b || new Blob()), "image/png", 0.9)
    );
    return await createImageBitmap(blob);
  }
}
