import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
const driver = process.env.STORAGE_DRIVER || "local";
if (
  !["local", "s3"].includes(driver) ||
  (driver === "s3" && !process.env.S3_BUCKET)
)
  throw Error("Проверете типа и конфигурацията на файловото хранилище.");
export const storageDir = path.resolve(process.env.STORAGE_DIR || "var/media");
function safe(key: string) {
  if (
    !key ||
    key.length > 480 ||
    key
      .split("/")
      .some(
        (p) => !p || p === "." || p === ".." || !/^[a-zA-Z0-9_.-]+$/.test(p),
      )
  )
    throw Error("Невалидно име на файл.");
  return key;
}
const s3 =
  driver === "s3"
    ? new S3Client({
        region: process.env.S3_REGION || "eu-central-1",
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: !!process.env.S3_ENDPOINT,
      })
    : null;
function object(key: string) {
  return { Bucket: process.env.S3_BUCKET!, Key: safe(key) };
}
export async function putFile(key: string, bytes: Buffer, type: string) {
  safe(key);
  if (s3)
    await s3.send(
      new PutObjectCommand({ ...object(key), Body: bytes, ContentType: type }),
    );
  else {
    const file = path.join(storageDir, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = file + "." + randomUUID() + ".tmp";
    await fs.writeFile(temp, bytes);
    await fs.rename(temp, file);
  }
  return "/media/" + key;
}
export async function readFile(key: string) {
  safe(key);
  if (s3) {
    const o = await s3.send(new GetObjectCommand(object(key)));
    return Buffer.from(await o.Body!.transformToByteArray());
  }
  return fs.readFile(path.join(storageDir, key));
}
export async function removeFile(key: string) {
  key = key.replace(/^\/media\//, "");
  safe(key);
  if (s3) await s3.send(new DeleteObjectCommand(object(key)));
  else await fs.rm(path.join(storageDir, key), { force: true });
}
export async function listFiles(): Promise<string[]> {
  if (!s3) {
    await fs.mkdir(storageDir, { recursive: true });
    const names = await fs.readdir(storageDir, {
      recursive: true,
      withFileTypes: true,
    });
    return names
      .filter((n) => n.isFile() && !n.name.endsWith(".tmp"))
      .map((n) =>
        path
          .relative(storageDir, path.join(n.parentPath, n.name))
          .replaceAll("\\", "/"),
      );
  }
  const files: string[] = [];
  let token: string | undefined;
  do {
    const page: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET!,
        ContinuationToken: token,
      }),
    );
    files.push(...(page.Contents || []).flatMap((x) => (x.Key ? [x.Key] : [])));
    token = page.NextContinuationToken;
  } while (token);
  return files;
}
