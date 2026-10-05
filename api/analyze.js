import { db, config } from "hatchable";

export const access = "user";
export const methods = ["POST"];

const SYSTEM = `You are CareerPath AI, a practical career guidance engine.
Analyze a person's current profile against their target role.
Estimate current level from evidence, identify concrete skill gaps, and produce an ordered learning roadmap.

Recommend reputable, relevant learning resources from your knowledge. Do NOT invent ratings, prices, durations, or URLs. Only provide a URL when you are confident it is a real public course/resource URL; otherwise use an empty string. Prefer well-known providers such as Coursera, edX, Udemy, freeCodeCamp, official documentation, YouTube learning playlists, and university resources.

Return ONLY valid JSON:
{
  "readiness_score": 0,
  "current_level": "Beginner|Intermediate|Advanced",
  "summary": "2-4 sentence assessment",
  "strengths": ["..."],
  "skill_gaps": [{"skill":"...","priority":"High|Medium|Low","gap_score":0,"reason":"..."}],
  "roadmap": [{"title":"...","description":"...","timeframe":"...","priority":"Core|Support"}],
  "courses": [{"title":"...","provider":"...","rating":"","level":"...","duration":"","price":"","reason":"...","url":""}],
  "sources": []
}`;

function parseJson(text) {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  try { return JSON.parse(cleaned); } catch {}
  const s = cleaned.indexOf("{");
  const e = cleaned.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try { return JSON.parse(cleaned.slice(s, e + 1)); } catch {}
  }
  return null;
}

export default async function(req, res) {
  const b = req.body || {};
  const target = String(b.target_role || "").trim();
  if (!target) return res.status(400).json({ error: "Target role is required." });

  const skills = Array.isArray(b.skills) ? b.skills.filter(Boolean) : [];
  const prompt = `Candidate profile:
Name: ${String(b.full_name || "")}
Current role/status: ${String(b.current_role || "")}
Education: ${String(b.education || "")}
Experience years: ${Number(b.experience_years || 0)}
Current skills: ${skills.join(", ") || "Not provided"}
Goals: ${String(b.goals || "")}
Resume and experience evidence:
${String(b.resume_text || "No resume text provided.")}

Target role: ${target}

Assess readiness, identify the most important gaps, create a practical learning roadmap, and recommend 5-8 relevant learning resources.`;

  try {
    const apiKey = await config.get("OPENROUTER_API_KEY");
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      timeout_ms: 55000,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://careerpath-ai-9g2v.hatchable.site",
        "X-Title": "CareerPath AI"
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt }
        ],
        temperature: 0.2
      })
    });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      console.error("openrouter upstream error", { status: upstream.status, body: body.slice(0, 300) });
      if (upstream.status === 401 || upstream.status === 403) {
        return res.status(502).json({ error: "OpenRouter authentication failed. Check the OPENROUTER_API_KEY in Hatchable Setup." });
      }
      if (upstream.status === 429) {
        return res.status(429).json({ error: "The free AI model is currently rate-limited. Please retry later." });
      }
      return res.status(502).json({ error: "Free AI service is temporarily unavailable." });
    }

    const data = await upstream.json();
    const text = data?.choices?.[0]?.message?.content || "";
    const parsed = parseJson(text);

    if (!parsed) {
      return res.status(502).json({ error: "The AI returned an unexpected format. Please retry the analysis." });
    }

    const safe = {
      readiness_score: Math.max(0, Math.min(100, Number(parsed.readiness_score || 0))),
      current_level: String(parsed.current_level || "Intermediate"),
      summary: String(parsed.summary || ""),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 12) : [],
      skill_gaps: Array.isArray(parsed.skill_gaps) ? parsed.skill_gaps.slice(0, 12) : [],
      roadmap: Array.isArray(parsed.roadmap) ? parsed.roadmap.slice(0, 12) : [],
      courses: Array.isArray(parsed.courses) ? parsed.courses.slice(0, 10) : [],
      sources: Array.isArray(parsed.sources) ? parsed.sources.slice(0, 20) : []
    };

    const ins = await db.query(`INSERT INTO career_analyses
      (user_id,target_role,readiness_score,current_level,summary,strengths,skill_gaps,roadmap,courses,sources)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
      RETURNING id,target_role,readiness_score,current_level,summary,strengths,skill_gaps,roadmap,courses,sources,created_at`,
      [
        req.user.id,
        target,
        safe.readiness_score,
        safe.current_level,
        safe.summary,
        JSON.stringify(safe.strengths),
        JSON.stringify(safe.skill_gaps),
        JSON.stringify(safe.roadmap),
        JSON.stringify(safe.courses),
        JSON.stringify(safe.sources)
      ]
    );

    res.json({
      analysis: ins.rows[0],
      provider: "OpenRouter",
      model: "openrouter/free"
    });
  } catch (e) {
    console.error("career-analysis", e);
    const msg = String(e?.message || e);
    if (msg.includes("setup_required") || msg.includes("OPENROUTER_API_KEY")) {
      return res.status(503).json({ error: "OpenRouter is not configured yet. Add OPENROUTER_API_KEY in Hatchable Setup." });
    }
    return res.status(502).json({ error: "Free AI analysis failed. Please try again." });
  }
}