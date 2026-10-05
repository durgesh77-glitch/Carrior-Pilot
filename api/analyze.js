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

Return ONLY valid JSON with EXACTLY these keys:
{
  "readiness_score": 0,
  "current_level": "Beginner",
  "summary": "2-4 sentence assessment",
  "strengths": ["skill or strength"],
  "skill_gaps": [
    {
      "skill": "skill name",
      "priority": "High",
      "gap_score": 70,
      "reason": "why this is a gap"
    }
  ],
  "roadmap": [
    {
      "title": "step title",
      "description": "what to learn/do",
      "timeframe": "4 weeks",
      "priority": "Core"
    }
  ],
  "courses": [
    {
      "title": "course/resource title",
      "provider": "provider",
      "rating": "",
      "level": "Beginner",
      "duration": "",
      "price": "",
      "reason": "why relevant",
      "url": ""
    }
  ],
  "sources": []
}
Never omit a required key. Use empty arrays or empty strings when a value is unavailable. Keep readiness_score between 0 and 100.`;

function parseJson(text) {
  const cleaned = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  const s = cleaned.indexOf("{");
  const e = cleaned.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try {
      const parsed = JSON.parse(cleaned.slice(s, e + 1));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
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

  const requestBody = () => JSON.stringify({
    system_instruction: {
      parts: [{ text: SYSTEM }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  });

  try {
    let parsed = null;
    let lastText = "";
    let lastStatus = 200;

    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const upstream = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
        {
          method: "POST",
          timeout_ms: 55000,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: requestBody()
        }
      );

      lastStatus = upstream.status;

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
      lastText = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
      parsed = parseJson(lastText);

      if (!parsed || typeof parsed !== "object") {
        parsed = null;
        if (attempt === 0) continue;
      }
    }

    if (!parsed) {
      console.error("gemini invalid analysis", { status: lastStatus, textPreview: String(lastText).slice(0, 600) });
      return res.status(502).json({
        error: "Gemini returned an incomplete analysis. Please retry once."
      });
    }

    const toText = value => Array.isArray(value) ? value.map(v => typeof v === "string" ? v : (v?.title || v?.skill || v?.name || JSON.stringify(v))).filter(Boolean) : [];

    const safe = {
      readiness_score: Math.max(0, Math.min(100, Number(parsed.readiness_score || parsed.readiness || 0))),
      current_level: String(parsed.current_level || parsed.level || "Intermediate"),
      summary: String(parsed.summary || parsed.assessment || "AI analysis completed."),
      strengths: toText(parsed.strengths).slice(0, 12),
      skill_gaps: Array.isArray(parsed.skill_gaps)
        ? parsed.skill_gaps.slice(0, 12).map(g => typeof g === "string" ? { skill: g, priority: "High", gap_score: 60, reason: "Relevant gap for the target role." } : g)
        : [],
      roadmap: Array.isArray(parsed.roadmap)
        ? parsed.roadmap.slice(0, 12).map((x, i) => typeof x === "string" ? { title: x, description: "", timeframe: "", priority: "Core", order: i + 1 } : ({
            title: x.title || x.phase || `Step ${i + 1}`,
            description: x.description || (Array.isArray(x.tasks) ? x.tasks.join("; ") : (Array.isArray(x.actions) ? x.actions.join("; ") : "")),
            timeframe: x.timeframe || x.duration || "",
            priority: x.priority || "Core"
          }))
        : [],
      courses: Array.isArray(parsed.courses)
        ? parsed.courses.slice(0, 10).map(c => typeof c === "string" ? { title: c, provider: "", rating: "", level: "", duration: "", price: "", reason: "", url: "" } : ({
            title: c.title || c.name || "Recommended resource",
            provider: c.provider || c.platform || "",
            rating: c.rating || "",
            level: c.level || "",
            duration: c.duration || "",
            price: c.price || c.type || "",
            reason: c.reason || "",
            url: c.url || ""
          }))
        : [],
      sources: toText(parsed.sources).slice(0, 20)
    };

    if (!safe.current_level || !safe.summary) {
      return res.status(502).json({
        error: "Gemini returned an incomplete analysis. Please retry once."
      });
    }

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
      model: "gemini-3.5-flash-lite"
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