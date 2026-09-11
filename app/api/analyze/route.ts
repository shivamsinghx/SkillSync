import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { analyzeSkillFit } from "@/lib/gemini";

type AnalyzeRequest = {
  jobDescription: string;
  portfolioText: string;
};

export async function POST(req: Request) {
  let session;
  try {
    session = await getServerSession(authOptions);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "JWEDecryptionFailed" || name === "JWTExpired") {
      return NextResponse.json(
        { error: "Session expired or invalid. Please sign out and sign in again." },
        { status: 401 }
      );
    }
    throw err;
  }

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as AnalyzeRequest;
    const { jobDescription, portfolioText } = body;

    if (!jobDescription || !portfolioText) {
      return NextResponse.json(
        { error: "Job description and portfolio text are required" },
        { status: 400 }
      );
    }

    const analysis = await analyzeSkillFit({
      jobDescription,
      portfolioText,
    });

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("Analyze error:", error);

    let message = "Failed to analyze skill fit";
    if (error instanceof Error) {
      message = error.message;
    } else if (error && typeof (error as { message?: string }).message === "string") {
      message = (error as { message: string }).message;
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
