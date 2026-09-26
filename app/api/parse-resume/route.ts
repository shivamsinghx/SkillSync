import path from "node:path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

function sanitizeParseError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const sanitized = raw
    .replace(/[A-Za-z]:\\[^\s"'`]+/g, "[path]")
    .replace(/\/(?:Users|home|root|var|tmp|private|opt)[^\s"'`]+/g, "[path]")
    .replace(/(?:api[_-]?key|password|secret|token|credential)s?\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized) {
    return "Failed to read the PDF. Try another file or a text-based PDF.";
  }

  return sanitized.length > 300 ? `${sanitized.slice(0, 300)}…` : sanitized;
}

function jsonError(error: string, status: number) {
  console.log(`[parse-resume] returning ${status}`);
  return NextResponse.json({ error }, { status });
}

function getUploadBytes(file: unknown): Promise<ArrayBuffer> | null {
  if (file && typeof file === "object" && "arrayBuffer" in file) {
    const maybe = file as { arrayBuffer?: () => Promise<ArrayBuffer> };
    if (typeof maybe.arrayBuffer === "function") {
      return maybe.arrayBuffer();
    }
  }
  return null;
}

export async function POST(req: Request) {
  console.log("[parse-resume] request received");
  try {
    let session;
    try {
      session = await getServerSession(authOptions);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "JWEDecryptionFailed" || name === "JWTExpired") {
        return jsonError(
          "Session expired or invalid. Please sign out and sign in again.",
          401
        );
      }
      throw err;
    }

    if (!session) {
      return jsonError("Unauthorized", 401);
    }

    console.log("[parse-resume] session check passed");
    const formData = await req.formData();
    const file = formData.get("file");
    console.log("[parse-resume] file received", {
      fileName: file instanceof File ? file.name : "upload.bin",
      fileSize: file instanceof Blob ? file.size : undefined,
      contentType: file instanceof Blob ? file.type || "unknown" : "unknown",
    });
    const bytesPromise = getUploadBytes(file);

    if (!bytesPromise) {
      console.info("[parse-resume] missing file field", {
        fieldType: file === null ? "null" : typeof file,
      });
      return jsonError("Upload a PDF resume.", 400);
    }

    const fileName = file instanceof File ? file.name : "upload.bin";
    const contentType = file instanceof Blob ? file.type || "unknown" : "unknown";
    const fileSize = file instanceof Blob ? file.size : undefined;
    console.info("[parse-resume] upload meta", {
      fileName,
      fileSize,
      contentType,
    });

    if (typeof fileSize === "number" && fileSize > MAX_BYTES) {
      return jsonError(
        "PDF is too large. Use a file under 10MB.",
        413
      );
    }

    const buffer = Buffer.from(await bytesPromise);
    console.log("[parse-resume] buffer created", { byteLength: buffer.length });
    if (buffer.length > MAX_BYTES) {
      return jsonError("PDF is too large. Use a file under 10MB.", 413);
    }

    if (buffer.subarray(0, 4).toString() !== "%PDF") {
      return jsonError("That file is not a valid PDF.", 400);
    }

    const { PDFParse } = await import("pdf-parse");
    PDFParse.setWorker(
      path.join(
        process.cwd(),
        "node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs"
      )
    );

    const parser = new PDFParse({ data: buffer });
    console.log("[parse-resume] parser created");

    try {
      console.log("[parse-resume] getText started");
      const result = await parser.getText();
      console.log("[parse-resume] getText completed");
      const text = result.text?.trim() ?? "";
      console.log("[parse-resume] extracted text length:", text.length);

      if (!text) {
        return jsonError(
          "No text found in that PDF. Try a text-based PDF instead of a scanned image.",
          422
        );
      }

      console.log("[parse-resume] returning success response");
      console.log("[parse-resume] returning 200");
      return NextResponse.json({ text });
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    console.error("Parse resume error:", error);
    console.error("[parse-resume] parser exception", {
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonError(sanitizeParseError(error), 500);
  }
}
