"use client";

import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { useSession, signOut } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Aurora from "@/components/Aurora";
import { Meteors } from "@/components/ui/meteors";
import { TypingAnimation } from "@/components/ui/typing-animation";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { AuthModal } from "@/components/ui/auth-modal";
import { FileUploadFieldInput } from "@/components/inputs/file-upload-field-input";
import { TextareaFieldInput } from "@/components/inputs/textarea-field-input";
import { ThreeDButton } from "@/components/buttons/three-d-button";
import { UserMenuDropdown } from "@/components/dropdowns/user-menu-dropdown";
import { LogOut } from "lucide-react";

function formatSkillLabel(skill: string) {
  return skill
    .replace(/[_-]+/g, " ")
    .replace(/\//g, " / ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\(/g, " (")
    .replace(/\)/g, ") ")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractTextFromPDF(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/parse-resume", {
    method: "POST",
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  console.info("[extractTextFromPDF] status", res.status);
  console.info("[extractTextFromPDF] json keys", Object.keys(data));
  console.info(
    "[extractTextFromPDF] error field",
    typeof data.error === "string" ? data.error : typeof data.error
  );

  if (!res.ok) {
    const apiError =
      typeof data.error === "string" && data.error.trim()
        ? data.error
        : `PDF parse failed (HTTP ${res.status})`;
    console.info("[extractTextFromPDF] throwing", apiError);
    throw new Error(apiError);
  }

  if (typeof data.text !== "string" || !data.text.trim()) {
    throw new Error("No text found in that PDF. Try pasting the text instead.");
  }

  return data.text;
}


type AnalysisResult = {
  id?: string;
  matchedSkills: string[];
  missingSkills: string[];
  highlightProject: string;
  pitch: string;
  createdAt?: string;
  focusAreas?: { name: string; description: string }[];
};

function Home() {
  const { data: session, status } = useSession();
  const isAuthenticated = status === "authenticated";
  const searchParams = useSearchParams();

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [jobDescription, setJobDescription] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usageInfo, setUsageInfo] = useState<{ usedToday?: number; limit?: number | null; plan?: string } | null>(null);


  const popupRef = useRef<Window | null>(null);
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);

  const isLinkedInUrl = /^https?:\/\/(www\.)?linkedin\.com/i.test(jobDescription.trim());


  const bookmarkletHref = useMemo(() => {
    if (typeof window === 'undefined') return '#';
    const origin = window.location.origin;
    return (
      `javascript:(function(){` +
      `var s=['.jobs-description-content__text',` +
      `'.jobs-description-content__text--stretch',` +
      `'#job-details',` +
      `'.jobs-description__content'];` +
      `var t='';` +
      `for(var i=0;i<s.length;i++){` +
      `var el=document.querySelector(s[i]);` +
      `if(el&&el.innerText.trim().length>50){t=el.innerText.trim();break;}}` +
      `if(!t){` +
      `var els=document.querySelectorAll('[class*="description"]');` +
      `for(var j=0;j<els.length;j++){` +
      `if(els[j].innerText.trim().length>200){t=els[j].innerText.trim();break;}}}` +
      `if(!t){alert('Could not find the job description. Make sure you are on a LinkedIn job page.');return;}` +
      `if(window.opener&&!window.opener.closed){` +
      `window.opener.postMessage({type:'PITCHGAP_JOB_IMPORT',jobDescription:t},'*');` +
      `setTimeout(function(){window.close();},800);}` +
      `else{window.location.href='${origin}/?jd='+encodeURIComponent(t.substring(0,6000));}` +
      `})();`
    );
  }, []);

  useEffect(() => {
    if (bookmarkletRef.current && bookmarkletHref !== '#') {
      bookmarkletRef.current.setAttribute('href', bookmarkletHref);
    }
  }, [bookmarkletHref]);


  useEffect(() => {
    function onImportMessage(event: MessageEvent) {
      if (
        event.data &&
        typeof event.data === 'object' &&
        event.data.type === 'PITCHGAP_JOB_IMPORT' &&
        typeof event.data.jobDescription === 'string' &&
        event.data.jobDescription.trim().length > 0
      ) {
        setJobDescription(event.data.jobDescription);
        if (popupRef.current && !popupRef.current.closed) {
          popupRef.current.close();
        }
      }
    }
    window.addEventListener('message', onImportMessage);
    return () => window.removeEventListener('message', onImportMessage);
  }, []);


  useEffect(() => {
    const jd = searchParams.get('jd');
    if (jd && jd.trim().length > 0) {
      setJobDescription(jd);
      const url = new URL(window.location.href);
      url.searchParams.delete('jd');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams]);

  async function handleAnalyze() {
    if (!jobDescription || !resumeFile) {
      setError("Add a job description (or link) and upload your resume PDF.");
      return;
    }

    setError(null);
    setLoading(true);


    try {
      let jobDescriptionToUse = jobDescription.trim();
      let portfolioTextToUse = "";

      try {
        portfolioTextToUse = await extractTextFromPDF(resumeFile);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "PDF parse failed (unknown error)";
        console.info("[handleAnalyze] pdf error", message);
        setError(message);
        setLoading(false);
        return;
      }

      if (/^https?:\/\//i.test(jobDescriptionToUse)) {
        const scrapeRes = await fetch("/api/scrape-job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: jobDescriptionToUse }),
        });

        if (!scrapeRes.ok) {
          const scrapeErr = await scrapeRes.json().catch(() => ({}));
          setError(scrapeErr.error || "Couldn't extract the job description.");
          setLoading(false);
          return;
        }

        const scraped = await scrapeRes.json();
        jobDescriptionToUse = scraped.jobDescription || jobDescriptionToUse;
      }

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription: jobDescriptionToUse,
          portfolioText: portfolioTextToUse,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let err: { error?: string; code?: string; limit?: number } = {};
        try {
          err = text ? JSON.parse(text) : {};
        } catch {
          err = { error: text?.slice(0, 200) || `Request failed (${res.status})` };
        }
        if (res.status === 429 && err.code === "LIMIT_REACHED") {
          setError(`You've hit the daily limit of ${err.limit} analyses on the free plan.`);
        } else {
          setError(err.error || `Request failed (${res.status}). Try again.`);
        }
        return;
      }

      const data = await res.json();
      setAnalysisResult(data);
      setUsageInfo({
        usedToday: data.usedToday,
        limit: data.limit,
        plan: data.plan,
      });

    } catch (error) {
      console.error(error);
      const msg = error instanceof Error ? error.message : "Something went wrong while analyzing.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenLinkedInPopup() {
    const url = jobDescription.trim();
    if (!isLinkedInUrl) return;
    const popup = window.open(
      url,
      'linkedin_job_popup',
      'width=1200,height=800,scrollbars=yes,resizable=yes'
    );
    if (popup) popupRef.current = popup;
  }

  function handleGetStarted() {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      return;
    }
  }

  function handleAuthSuccess() {
    setIsAuthModalOpen(false);
  }

  useEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      setIsAuthModalOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams]);

  const handleCopyPitch = async () => {
    if (!analysisResult?.pitch) return;
    try {
      await navigator.clipboard.writeText(analysisResult.pitch);
    } catch (e) {
      console.error(e);
    }
  };

  const handleExportJson = () => {
    if (!analysisResult) return;
    const blob = new Blob([JSON.stringify(analysisResult, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "skillsync-analysis.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMarkdown = () => {
    if (!analysisResult) return;
    const md = [
      "# SkillSync Analysis",
      "",
      "## Matched skills",
      ...(analysisResult.matchedSkills ?? []).map((s) => `- ${s}`),
      "",
      "## Missing skills",
      ...(analysisResult.missingSkills ?? []).map((s) => `- ${s}`),
      "",
      "## Highlight project",
      "",
      analysisResult.highlightProject,
      "",
      "## Pitch",
      "",
      analysisResult.pitch,
    ].join("\n");

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "skillsync-analysis.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const initials =
    session?.user?.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() || (session?.user?.email?.[0] || "?").toUpperCase();

  return (
    <main className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute bottom-[-8vh] left-0 w-full h-[45vh] overflow-hidden transform scale-y-[-1]">
        <Aurora
          colorStops={["#7cff67", "#B19EEF", "#5227FF"]}
          blend={0.5}
          amplitude={1.0}
          speed={1}
        />
      </div>

      <Meteors number={30} />

      {isAuthenticated && session?.user && (
        <header className="fixed top-4 right-4 z-50">
          <UserMenuDropdown
            userName={session.user.name || "User"}
            userEmail={session.user.email || ""}
            avatarSrc={session.user.image || undefined}
            avatarAlt={session.user.name || session.user.email || "User"}
            avatarFallback={initials}
            items={[
              {
                id: "sign-out",
                label: "Sign Out",
                icon: <LogOut />,
                danger: true,
                onClick: () => signOut(),
              },
            ]}
          />
        </header>
      )}

      <div className="relative z-20 max-w-7xl w-full px-6 py-10 md:py-16">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            <TypingAnimation typeSpeed={80} className="inline-block">
              SkillSync.
            </TypingAnimation>
          </h1>

          <p className="mt-4 text-lg md:text-xl text-muted-foreground">
            See where you match. Fix what you don't.
          </p>

          {!isAuthenticated && (
            <p className="mt-6 text-sm md:text-base text-muted-foreground leading-relaxed">
              SkillSync analyzes job requirements and compares them with your
              portfolio to identify skill gaps, highlight your strongest projects,
              and generate a tailored pitch that helps you stand out and get hired
              FASTERRR.
            </p>
          )}

          {!isAuthenticated && (
            <div className="mt-8 flex justify-center">
              <RainbowButton
                className="px-5 py-4 text-base font-semibold"
                onClick={handleGetStarted}
              >
                Get started
              </RainbowButton>
            </div>
          )}
        </div>

        {isAuthenticated && (
          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(300px,1.05fr)_minmax(260px,1fr)_minmax(260px,0.95fr)] items-start">
            <div className="rounded-3xl border border-neutral-100 bg-white p-6 md:p-7 text-neutral-900 shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
              <div className="flex items-center justify-between gap-3 mb-5">
                <h2 className="text-lg font-semibold tracking-tight">Describe the role</h2>
                {usageInfo && usageInfo.limit && (
                  <span className="text-xs rounded-full bg-neutral-100 px-3 py-1 text-neutral-500">
                    {usageInfo.usedToday ?? 0}/{usageInfo.limit} analyses today (free)
                  </span>
                )}
              </div>

              <TextareaFieldInput
                label="Job description"
                hint="Paste the job description, or a LinkedIn job URL."
                placeholder="Paste the job description text, or a LinkedIn job URL"
                value={jobDescription}
                onChange={(value) => setJobDescription(value)}
                maxLength={8000}
                rows={6}
                containerClassName="max-w-none"
              />

              {isLinkedInUrl && (
                <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                  <p className="text-sm font-semibold text-amber-400">
                    🔗 LinkedIn URL detected
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    LinkedIn blocks server-side requests, but your <strong>browser already has your session</strong>.
                    Use the 2-step flow below to import the job description automatically—no copy-paste needed.
                  </p>

                  <div className="rounded-lg border border-border bg-background/60 p-3 space-y-1.5">
                    <p className="text-xs font-medium text-foreground">
                      Step 1 &mdash; one-time setup: drag this to your bookmarks bar
                    </p>
                    <a
                      ref={bookmarkletRef}
                      onClick={(e) => e.preventDefault()}
                      draggable
                      className="inline-flex cursor-grab items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground select-none hover:bg-muted/70 active:cursor-grabbing"
                      title="Drag this link to your bookmarks bar"
                    >
                      🔖 PitchGap Importer
                    </a>
                    <p className="text-xs text-muted-foreground">
                      Drag the button above to your browser&apos;s bookmarks bar. You only do this once.
                    </p>
                  </div>

                  <div className="rounded-lg border border-border bg-background/60 p-3 space-y-1.5">
                    <p className="text-xs font-medium text-foreground">
                      Step 2 &mdash; click to open the job page, then click the bookmarklet
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenLinkedInPopup}
                      className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/30 transition-colors"
                    >
                      Open job in popup →
                    </button>
                    <p className="text-xs text-muted-foreground">
                      The job page opens with your LinkedIn session active. Click
                      <strong> PitchGap Importer</strong> in your bookmarks bar
                      and the description will appear here automatically.
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-6">
                <FileUploadFieldInput
                  label="Upload resume"
                  hint="PDF only, up to 10 MB. This is the resume used for analysis."
                  browseLabel="Choose PDF"
                  dropLabel="Drop your resume here"
                  replaceLabel="Replace PDF"
                  accept=".pdf,application/pdf"
                  multiple={false}
                  maxFiles={1}
                  maxSizeBytes={10 * 1024 * 1024}
                  required
                  containerClassName="max-w-none"
                  onFilesChange={(files) => setResumeFile(files[0] ?? null)}
                />
              </div>

              {error && (
                <p className="mt-4 text-sm text-rose-600">
                  {error}
                </p>
              )}

              <div className="mt-6 flex justify-between items-center gap-3">
                <div className="text-xs text-neutral-500">
                  {session?.user?.plan === "PRO" && "You're on the Pro plan – no daily limits."}
                </div>
                <ThreeDButton
                  variant="solid"
                  size="lg"
                  onClick={handleAnalyze}
                  disabled={loading}
                >
                  {loading ? "Analyzing..." : "Analyze my fit"}
                </ThreeDButton>
              </div>
            </div>

            <div className="rounded-3xl border border-neutral-100 bg-white p-5 md:p-6 text-neutral-900 shadow-[0_12px_40px_rgba(0,0,0,0.08)] min-h-[180px] flex flex-col">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h2 className="text-lg font-semibold tracking-tight">Results</h2>
                </div>

                {!analysisResult && (
                  <p className="text-sm text-neutral-500">
                    Run an analysis to see matched skills, gaps, and a tailored pitch.
                  </p>
                )}

                {analysisResult && (
                  <div className="space-y-4 text-left">
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 mb-3">
                          Matched skills
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {analysisResult.matchedSkills?.length ? (
                            analysisResult.matchedSkills.map((skill) => (
                              <span
                                key={skill}
                                className="inline-flex max-w-full items-center rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-left text-xs leading-snug font-medium text-emerald-800"
                              >
                                {formatSkillLabel(skill)}
                              </span>
                            ))
                          ) : (
                            <p className="text-xs text-neutral-500">
                              No strong matches detected yet.
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800 mb-3">
                          Missing skills
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {analysisResult.missingSkills?.length ? (
                            analysisResult.missingSkills.map((skill) => (
                              <span
                                key={skill}
                                className="inline-flex max-w-full items-center rounded-full border border-amber-200 bg-white px-3 py-1.5 text-left text-xs leading-snug font-medium text-amber-900"
                              >
                                {formatSkillLabel(skill)}
                              </span>
                            ))
                          ) : (
                            <p className="text-xs text-neutral-500">
                              No major gaps flagged.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                        Highlight project
                      </h3>
                      <p className="text-sm text-foreground/90 whitespace-pre-line">
                        {analysisResult.highlightProject || "Your best-fit project will appear here."}
                      </p>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Pitch
                        </h3>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleCopyPitch}
                            className="text-xs rounded-md border border-border bg-background/80 px-2 py-1 hover:bg-background"
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            onClick={handleExportMarkdown}
                            className="text-xs rounded-md border border-border bg-background/80 px-2 py-1 hover:bg-background"
                          >
                            Export MD
                          </button>
                          <button
                            type="button"
                            onClick={handleExportJson}
                            className="text-xs rounded-md border border-border bg-background/80 px-2 py-1 hover:bg-background"
                          >
                            Export JSON
                          </button>
                        </div>
                      </div>

                      <p className="text-sm text-foreground/90 whitespace-pre-line max-h-52 overflow-y-auto">
                        {analysisResult.pitch || "A tailored pitch for this role will appear here."}
                      </p>
                    </div>
                  </div>
                )}
            </div>

            <div className="rounded-3xl border border-neutral-100 bg-white p-5 md:p-6 text-neutral-900 shadow-[0_12px_40px_rgba(0,0,0,0.08)] min-h-[180px]">
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-500">
                  FOCUS AREAS
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">
                  What to learn
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Where this company leans hardest for this role. Some topic suggestions that will help you to learn and get hired.
                </p>
              </div>

              {analysisResult?.focusAreas?.length ? (
                <ul className="space-y-3">
                  {analysisResult.focusAreas.map((area, index) => (
                    <li
                      key={`${area.name}-${index}`}
                      className="rounded-2xl border border-neutral-100 bg-neutral-50/80 p-3.5 transition-colors hover:border-neutral-200 hover:bg-white"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-neutral-900">
                            {area.name}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                            {area.description}
                          </p>
                        </div>
                        <a
                          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
                            `${area.name} tutorial`
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Search YouTube for ${area.name}`}
                          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white shadow-sm transition hover:border-rose-200 hover:shadow-md"
                        >
                          <img
                            src="/youtube.png"
                            alt=""
                            width={22}
                            height={22}
                            className="size-[22px]"
                          />
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/70 px-4 py-8 text-center">
                  <p className="text-sm text-neutral-500">
                    Run an analysis and this column will list the topics this
                    company expects you to know — each with a YouTube search.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />
    </main>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="relative min-h-screen flex items-center justify-center bg-background text-foreground">
          <p className="text-sm text-muted-foreground">Loading SkillSync…</p>
        </main>
      }
    >
      <Home />
    </Suspense>
  );
}
