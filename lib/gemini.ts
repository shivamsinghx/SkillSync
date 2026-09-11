import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * `gemini-flash-latest` resolves to the newest flash model the key can use,
 * which avoids failed calls when a key has no access to a specific version.
 */
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL?.trim(),
  "gemini-flash-latest",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
].filter((m): m is string => Boolean(m));

type AnalysisShape = {
  matchedSkills: string[];
  missingSkills: string[];
  highlightProject: string;
  pitch: string;
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

/**
 * Some models reject this API key tier with 401/403 rather than 404, so an
 * auth failure on one model does not mean the key itself is unusable.
 */
function shouldTryNextModel(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|not supported|unknown model|404|401|403|429|503|overloaded|unavailable|ACCESS_TOKEN_TYPE_UNSUPPORTED|PERMISSION_DENIED|UNAUTHENTICATED/i.test(
    message
  );
}

function isAuthFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /401|403|API key not valid|ACCESS_TOKEN_TYPE_UNSUPPORTED|PERMISSION_DENIED|UNAUTHENTICATED/i.test(
    message
  );
}

let workingModel: string | null = null;

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
  "pitch": string
}

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
  const candidates = workingModel
    ? [workingModel, ...MODEL_CANDIDATES.filter((m) => m !== workingModel)]
    : MODEL_CANDIDATES;

  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
        },
      });

      const result = await model.generateContent(prompt);
      const parsed = parseAnalysisJson(result.response.text());
      workingModel = modelName;

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
      };
    } catch (error) {
      lastError = error;
      if (shouldTryNextModel(error)) continue;
      throw error;
    }
  }

  if (isAuthFailure(lastError)) {
    throw new Error(
      "Gemini rejected the API key for every available model. Check GEMINI_API_KEY in .env (get a key from https://aistudio.google.com/apikey)."
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to analyze skill fit");
}
