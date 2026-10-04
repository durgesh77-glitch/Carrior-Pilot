import { db } from "hatchable";

export const access = "user";
export const methods = ["GET","POST"];

export default async function(req,res){
  const userId=req.user.id;
  if(req.method==="GET"){
    const {rows}=await db.query("SELECT id, user_id, full_name, current_position AS current_role, target_role, education, experience_years, skills, resume_text, goals, created_at, updated_at FROM career_profiles WHERE user_id=$1",[userId]);
    return res.json(rows[0]||null);
  }
  const b=req.body||{};
  const skills=Array.isArray(b.skills)?b.skills:[];
  const r=await db.query(`INSERT INTO career_profiles (user_id,full_name,current_position,target_role,education,experience_years,skills,resume_text,goals,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,now())
    ON CONFLICT (user_id) DO UPDATE SET full_name=EXCLUDED.full_name,current_position=EXCLUDED.current_position,target_role=EXCLUDED.target_role,education=EXCLUDED.education,experience_years=EXCLUDED.experience_years,skills=EXCLUDED.skills,resume_text=EXCLUDED.resume_text,goals=EXCLUDED.goals,updated_at=now()
    RETURNING id,user_id,full_name,current_position AS current_role,target_role,education,experience_years,skills,resume_text,goals,created_at,updated_at`,[userId,b.full_name||"",b.current_role||"",b.target_role||"",b.education||"",Number(b.experience_years||0),JSON.stringify(skills),b.resume_text||"",b.goals||""]);
  const row=r.rows[0];row.skills=Array.isArray(row.skills)?row.skills:[];res.json(row);
}