import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { PDFParse } from "pdf-parse";
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
    return "Failed to read the PDF. Try pasting the text instead.";
  }

  return sanitized.length > 300 ? `${sanitized.slice(0, 300)}…` : sanitized;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Upload a PDF resume." },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "PDF is too large. Use a file under 10MB or paste the text." },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse({ data: buffer });

    try {
      const result = await parser.getText();
      const text = result.text?.trim() ?? "";

      if (!text) {
        return NextResponse.json(
          { error: "No text found in that PDF. Try pasting the text instead." },
          { status: 422 }
        );
      }

      return NextResponse.json({ text });
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    console.error("Parse resume error:", error);
    return NextResponse.json(
      { error: sanitizeParseError(error) },
      { status: 500 }
    );
  }
}
