import { GoogleGenerativeAI } from "@google/generative-ai";

const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
] as const;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 4_000];

type AnalysisShape = {
  matchedSkills: string[];
  missingSkills: string[];
  highlightProject: string;
  pitch: string;
  focusAreas: { name: string; description: string }[];
};

function parseAnalysisJson(text: string): AnalysisShape {
  const cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const tryParse = (raw: string) => JSON.parse(raw) as AnalysisShape;

  try {
    return tryParse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return tryParse(cleaned.slice(start, end + 1));
    }
    throw new Error(
      "Gemini returned invalid JSON. Please try again or shorten your inputs."
    );
  }
}

function isAuthFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /401|403|API key not valid|ACCESS_TOKEN_TYPE_UNSUPPORTED|PERMISSION_DENIED|UNAUTHENTICATED/i.test(
    message
  );
}

function isTransientGeminiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /\b(400|401|403|404)\b|API key not valid|ACCESS_TOKEN_TYPE_UNSUPPORTED|PERMISSION_DENIED|UNAUTHENTICATED|malformed|invalid argument|safety|blocked/i.test(
      message
    )
  ) {
    return false;
  }
  return /\b(429|500|502|503|504)\b|unavailable|high demand|overloaded/i.test(
    message
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function analyzeSkillFit(input: {
  jobDescription: string;
  portfolioText: string;
}): Promise<AnalysisShape> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to your .env (get a key from https://aistudio.google.com/apikey)."
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const prompt = `
You are an expert technical recruiter.

Analyze the following job description and candidate portfolio.

Return ONLY valid JSON with this exact shape:
{
  "matchedSkills": string[],
  "missingSkills": string[],
  "highlightProject": string,
  "pitch": string,
  "focusAreas": { "name": string, "description": string }[]
}

matchedSkills and missingSkills must be short, human-readable labels with spaces (e.g. "AWS Lambda", "REST Architecture"), never camelCase or smashed words.
focusAreas must be 3 to 6 items. Each name is a skill, system, or practice this company leans on for THIS role. Each description explains why that area matters for this company and job, based on the JD — not generic career advice.

Job Description:
"""
${input.jobDescription}
"""

Portfolio:
"""
${input.portfolioText}
"""
`;

  let lastError: unknown;

  for (const modelName of MODELS) {
    let moveToNextModel = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        console.info("[gemini] attempting", modelName, "attempt", attempt + 1);
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: "application/json",
          },
        });

        const result = await model.generateContent(prompt);
        const parsed = parseAnalysisJson(result.response.text());

        return {
          matchedSkills: Array.isArray(parsed.matchedSkills)
            ? parsed.matchedSkills
            : [],
          missingSkills: Array.isArray(parsed.missingSkills)
            ? parsed.missingSkills
            : [],
          highlightProject:
            typeof parsed.highlightProject === "string"
              ? parsed.highlightProject
              : "",
          pitch: typeof parsed.pitch === "string" ? parsed.pitch : "",
          focusAreas: Array.isArray(parsed.focusAreas)
            ? parsed.focusAreas
                .filter(
                  (item): item is { name: string; description: string } =>
                    Boolean(item) &&
                    typeof item.name === "string" &&
                    typeof item.description === "string"
                )
                .map((item) => ({
                  name: item.name.trim(),
                  description: item.description.trim(),
                }))
                .filter((item) => item.name && item.description)
            : [],
        };
      } catch (error) {
        lastError = error;
        if (!isTransientGeminiError(error)) {
          moveToNextModel = false;
          break;
        }
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        moveToNextModel = true;
      }
    }

    if (!moveToNextModel) {
      break;
    }
  }

  if (isAuthFailure(lastError)) {
    throw new Error(
      "Gemini rejected the API key. Check GEMINI_API_KEY in .env (get a key from https://aistudio.google.com/apikey)."
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to analyze skill fit");
}
