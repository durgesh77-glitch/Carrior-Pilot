import { ai, db } from "hatchable";

export const access="user";
export const methods=["POST"];

const SYSTEM=`You are CareerPath AI, a career guidance engine. Analyze a person's current profile against their TARGET ROLE.
Be realistic and constructive. Estimate current level from evidence, identify concrete skill gaps, and produce an ordered learning roadmap.
For course recommendations, use Google Search grounding to find CURRENT, REAL courses or learning resources. Prefer reputable platforms and official course pages. Consider rating/review quality when visible, relevance to the target role, beginner-to-advanced fit, recency, and cost/value.
Never invent a course URL. Only include a URL when it is a real link from search context. Do not claim exact ratings unless found.
Return ONLY valid JSON with this shape:
{
 "readiness_score": number 0-100,
 "current_level": "Beginner|Intermediate|Advanced",
 "summary": "2-4 sentence assessment",
 "strengths": ["..."],
 "skill_gaps":[{"skill":"...","priority":"High|Medium|Low","gap_score":0-100,"reason":"..."}],
 "roadmap":[{"title":"...","description":"...","timeframe":"...","priority":"Core|Support"}],
 "courses":[{"title":"...","provider":"...","rating":"...","level":"...","duration":"...","price":"...","reason":"...","url":"..."}],
 "sources":["https://..."]
}`;
function parseJson(text){
  const cleaned=text.replace(/\`\`\`json/gi,"").replace(/\`\`\`/g,"").trim();
  try{return JSON.parse(cleaned)}catch{}
  const s=cleaned.indexOf("{"),e=cleaned.lastIndexOf("}");
  if(s>=0&&e>s){try{return JSON.parse(cleaned.slice(s,e+1))}catch{}}
  return null;
}

export default async function(req,res){
 const b=req.body||{};
 const target=String(b.target_role||"").trim();
 if(!target)return res.status(400).json({error:"Target role is required."});
 const skills=Array.isArray(b.skills)?b.skills.filter(Boolean):[];
 const prompt=`Candidate profile:
Name: ${String(b.full_name||"")}
Current role/status: ${String(b.current_role||"")}
Education: ${String(b.education||"")}
Experience years: ${Number(b.experience_years||0)}
Current skills: ${skills.join(", ")||"Not provided"}
Goals: ${String(b.goals||"")}
Resume and experience evidence:
${String(b.resume_text||"No resume text provided.")}

Target role: ${target}

Assess readiness and gaps. Then use Google Search grounding to find 5-8 current, high-quality learning resources specifically matched to the gaps and target role. Prefer direct official course pages and include provider, visible rating when available, duration/level/price when available. Avoid generic lists without a clear learning match.`;
 try{
   const r=await ai.generateText({model:"gemini",purpose:"career-analysis",userId:req.user.id,system:SYSTEM,prompt,tools:[{google_search:{}}],maxTokens:12000});
   if(r.finishReason==="length")return res.status(502).json({error:"Gemini returned a truncated response. Please retry with a shorter resume or analysis."});
   const parsed=parseJson(r.text);
   if(!parsed)return res.status(502).json({error:"Gemini returned an unexpected format. Please retry the analysis."});
   const safe={
     readiness_score:Math.max(0,Math.min(100,Number(parsed.readiness_score||0))),
     current_level:String(parsed.current_level||"Intermediate"),
     summary:String(parsed.summary||""),
     strengths:Array.isArray(parsed.strengths)?parsed.strengths.slice(0,12):[],
     skill_gaps:Array.isArray(parsed.skill_gaps)?parsed.skill_gaps.slice(0,12):[],
     roadmap:Array.isArray(parsed.roadmap)?parsed.roadmap.slice(0,12):[],
     courses:Array.isArray(parsed.courses)?parsed.courses.slice(0,10):[],
     sources:Array.isArray(parsed.sources)?parsed.sources.slice(0,20):[]
   };
   const ins=await db.query(`INSERT INTO career_analyses (user_id,target_role,readiness_score,current_level,summary,strengths,skill_gaps,roadmap,courses,sources)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
     RETURNING id,target_role,readiness_score,current_level,summary,strengths,skill_gaps,roadmap,courses,sources,created_at`,
     [req.user.id,target,safe.readiness_score,safe.current_level,safe.summary,JSON.stringify(safe.strengths),JSON.stringify(safe.skill_gaps),JSON.stringify(safe.roadmap),JSON.stringify(safe.courses),JSON.stringify(safe.sources)]);
   res.json({analysis:ins.rows[0],usage:r.usage});
 }catch(e){
   console.error("career-analysis",e);
   const msg=String(e?.message||e);
   if(msg.includes("ai_spend_limit_reached"))return res.status(429).json({error:"AI usage limit has been reached for this project. Add your own Gemini key or retry after the limit resets."});
   return res.status(502).json({error:"Gemini analysis failed. Check the Gemini provider setup and try again."});
 }
}