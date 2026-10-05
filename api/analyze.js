import { db, config } from "hatchable";

export const access = "user";
export const methods = ["POST"];

const SYSTEM = `You are CareerPath AI, a practical career guidance engine.
Analyze a person's current profile against their target role.

Your job:
1. Estimate current proficiency level from the evidence provided.
2. Identify concrete skill gaps for the target role.
3. Prioritize the gaps.
4. Build an ordered learning roadmap.
5. Recommend relevant learning resources/courses.

Be realistic and constructive. Do not invent facts. Do not claim an exact course rating, price, duration, or URL unless you are confident it is correct. Prefer reputable providers such as Coursera, edX, Udemy, freeCodeCamp, official documentation, university courses, and reputable YouTube courses.

Return ONLY valid JSON matching the requested schema.`;

function parseJson(text) {
  const cleaned = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
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

  const apiKey = await config.get("GEMINI_API_KEY");
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

Assess the candidate against this target role and recommend 5-8 relevant learning resources. Prefer resources that directly address the identified gaps. If you know a reliable course URL, include it; otherwise leave url empty.`;

  try {
    const upstream = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        timeout_ms: 55000,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM }]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          tools: [
            { google_search: {} }
          ],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!upstream.ok) {
      const bodyText = await upstream.text().catch(() => "");
      console.error("gemini upstream error", { status: upstream.status, body: bodyText.slice(0, 500) });

      if (upstream.status === 400 || upstream.status === 403) {
        return res.status(502).json({
          error: "Gemini rejected the API request. Check that your Gemini API key is valid and enabled for the Gemini API."
        });
      }
      if (upstream.status === 429) {
        return res.status(429).json({
          error: "Gemini rate limit/quota was reached. Please wait and retry, or use a key with available quota."
        });
      }
      return res.status(502).json({ error: "Gemini is temporarily unavailable." });
    }

    const data = await upstream.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    const parsed = parseJson(text);

    if (!parsed) {
      return res.status(502).json({
        error: "Gemini returned an unexpected format. Please retry the analysis."
      });
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

    const ins = await db.query(
      `INSERT INTO career_analyses
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
      provider: "Google Gemini",
      model: "gemini-3.8-flash"
    });
  } catch (e) {
    console.error("career-analysis", e);
    const msg = String(e?.message || e);
    if (msg.includes("GEMINI_API_KEY") || msg.includes("Configuration value")) {
      return res.status(503).json({
        error: "Gemini is not configured yet. Add GEMINI_API_KEY in Hatchable Setup."
      });
    }
    return res.status(502).json({
      error: "Gemini analysis failed. Please try again."
    });
  }
}