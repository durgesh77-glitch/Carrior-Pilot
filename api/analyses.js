import { db } from "hatchable";
export const access="user";
export const methods=["GET"];
export default async function(req,res){
 const {rows}=await db.query("SELECT id,target_role,readiness_score,current_level,summary,strengths,skill_gaps,roadmap,courses,sources,created_at FROM career_analyses WHERE user_id=$1 ORDER BY created_at DESC LIMIT 25",[req.user.id]);
 for(const r of rows){for(const k of ["strengths","skill_gaps","roadmap","courses","sources"]){if(typeof r[k]==="string"){try{r[k]=JSON.parse(r[k])}catch{r[k]=[]}}}}
 res.json(rows);
}