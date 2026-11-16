import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireStaff } from "@/auth/access";
import { normalizedImage, saveMedia } from "@/admin/images";
import {
  sameOrigin,
  limitedBody,
  errorResponse,
  InputIssue,
} from "@/admin/http";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    await requireStaff(["staff"]);
    const body = await limitedBody(req, 16 * 1024 * 1024 + 32768);
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data;"))
      throw new InputIssue("Невалиден формуляр за снимка.");
    const data = await new Response(new Uint8Array(body), {
      headers: { "content-type": contentType },
    }).formData();
    const file = data.get("file");
    if (!(file instanceof File)) throw new InputIssue("Избери файл.");
    if (data.get("preview") === "1") {
      const bytes = await sharp(await normalizedImage(file))
        .resize({
          width: 640,
          height: 640,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      return new Response(new Uint8Array(bytes), {
        headers: {
          "content-type": "image/png",
          "cache-control": "private,no-store",
        },
      });
    }
    const number = (key: string) => Number(data.get(key) || 0);
    const result = await saveMedia(file, {
      rotation: number("rotation"),
      left: number("left"),
      right: number("right"),
      top: number("top"),
      bottom: number("bottom"),
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
