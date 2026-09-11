import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const { url } = (await req.json()) as { url?: string };

    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json(
        { error: "A valid job URL is required" },
        { status: 400 }
      );
    }

    if (/linkedin\.com/i.test(url)) {
      return NextResponse.json(
        {
          error:
                "LinkedIn blocks server-side requests. Paste the URL into the job description box and use the PitchGap Importer bookmarklet to fetch it via your browser session.",
        },
        { status: 422 }
      );
    }

    const response = await fetch(url);

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch the job page" },
        { status: 502 }
      );
    }

    const html = await response.text();

    const withoutScripts = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");

    const text = withoutScripts
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      return NextResponse.json(
        { error: "Couldn't extract a readable job description from that link" },
        { status: 422 }
      );
    }

    return NextResponse.json({
      jobDescription: text,
    });
  } catch (error) {
    console.error("Scrape job error:", error);

    return NextResponse.json(
      { error: "Failed to extract the job description from that link" },
      { status: 500 }
    );
  }
}

