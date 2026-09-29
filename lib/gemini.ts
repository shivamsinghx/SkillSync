import { GoogleGenerativeAI } from "@google/generative-ai";

const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
] as const;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 4_000];

type AtsBreakdown = {
  keywordMatch: number;
  skillsMatch: number;
  experienceRelevance: number;
  jobAlignment: number;
  atsReadability: number;
};

type AnalysisShape = {
  matchedSkills: string[];
  missingSkills: string[];
  highlightProject: string;
  pitch: string;
  focusAreas: { name: string; description: string }[];
  atsScore: number;
  atsBreakdown: AtsBreakdown;
  missingKeywords: string[];
  atsRecommendations: string[];
};

function clampScore(value: unknown): number {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, score));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function atsScoreFromBreakdown(breakdown: AtsBreakdown): number {
  const score =
    breakdown.keywordMatch * 0.3 +
    breakdown.skillsMatch * 0.25 +
    breakdown.experienceRelevance * 0.2 +
    breakdown.jobAlignment * 0.15 +
    breakdown.atsReadability * 0.1;
  return Math.round(Math.min(100, Math.max(0, score)));
}

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
  "focusAreas": { "name": string, "description": string }[],
  "atsScore": number,
  "atsBreakdown": {
    "keywordMatch": number,
    "skillsMatch": number,
    "experienceRelevance": number,
    "jobAlignment": number,
    "atsReadability": number
  },
  "missingKeywords": string[],
  "atsRecommendations": string[]
}

matchedSkills and missingSkills must be short, human-readable labels with spaces (e.g. "AWS Lambda", "REST Architecture"), never camelCase or smashed words.
focusAreas must be 3 to 6 items. Each name is a skill, system, or practice this company leans on for THIS role. Each description explains why that area matters for this company and job, based on the JD — not generic career advice.

Also score how well this resume matches THIS job description. Base every ATS field only on the resume text and job description below. Do not invent skills, tools, or experience that are not written in the resume.

Each atsBreakdown score is an integer from 0 to 100.
- keywordMatch (30%): compare important keywords and phrases in the job description with the resume. Prioritize technical skills, tools, frameworks, technologies, certifications, and role-specific terms. Do not heavily penalize common words.
- skillsMatch (25%): compare required and preferred skills in the job description with skills the resume actually demonstrates.
- experienceRelevance (20%): judge how closely the candidate's documented experience and projects match the job's responsibilities. Do not infer experience that is not documented.
- jobAlignment (15%): judge overall alignment between the resume's documented projects and experience and the job's responsibilities and requirements.
- atsReadability (10%): judge whether the extracted resume text looks ATS-friendly: clear sections, readable structure, conventional headings, and extractable important information. You are reading extracted text, not the original PDF layout.

atsScore must equal:
keywordMatch * 0.30 + skillsMatch * 0.25 + experienceRelevance * 0.20 + jobAlignment * 0.15 + atsReadability * 0.10
Round atsScore to the nearest integer from 0 to 100.

missingKeywords: important job-description keywords or skills that are absent or barely represented in the resume. Use an empty array when nothing meaningful is missing.
atsRecommendations: 3 to 5 concise, actionable recommendations based on this resume and this job. Do not tell the candidate to add a skill they have not demonstrated unless you explicitly frame it as something to learn or obtain.

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
        const atsBreakdown: AtsBreakdown = {
          keywordMatch: clampScore(parsed.atsBreakdown?.keywordMatch),
          skillsMatch: clampScore(parsed.atsBreakdown?.skillsMatch),
          experienceRelevance: clampScore(
            parsed.atsBreakdown?.experienceRelevance
          ),
          jobAlignment: clampScore(parsed.atsBreakdown?.jobAlignment),
          atsReadability: clampScore(parsed.atsBreakdown?.atsReadability),
        };

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
          atsScore: atsScoreFromBreakdown(atsBreakdown),
          atsBreakdown,
          missingKeywords: stringList(parsed.missingKeywords),
          atsRecommendations: stringList(parsed.atsRecommendations).slice(0, 5),
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
