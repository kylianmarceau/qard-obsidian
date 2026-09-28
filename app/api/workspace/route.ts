import {getChatGPTUser} from '@/app/chatgpt-auth';
import {workspaceDb} from '@/db/workspace';
import {starter} from '@/lib/model';
import {z} from 'zod';
export const dynamic='force-dynamic';
const id=z.string().min(1).max(100);
const color=z.enum(['blue','orange','purple','green']);
const schema=z.object({version:z.number().int().nonnegative(),data:z.object({
 projects:z.array(z.object({id,name:z.string().trim().min(1).max(80),color})).max(100),
 courses:z.array(z.object({id,projectId:id,name:z.string().trim().min(1).max(100),description:z.string().max(200),color,icon:z.enum(['biology','language','design','book'])})).max(500),
 cards:z.array(z.object({id,courseId:id,front:z.string().trim().min(1).max(5000),back:z.string().trim().min(1).max(10000),mastered:z.boolean()})).max(10000)
})});
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(){
 try{
 const user=await getChatGPTUser();if(!user)return json({error:'Sign in to open your workspace.'},401);
 const db=workspaceDb();
 await db.prepare('INSERT OR IGNORE INTO workspaces (owner,data,version) VALUES (?,?,0)').bind(user.userId,JSON.stringify(starter)).run();
 const row=await db.prepare('SELECT data,version FROM workspaces WHERE owner=?').bind(user.userId).first<{data:string;version:number}>();
 if(!row)throw new Error('Missing workspace');
 return json({data:JSON.parse(row.data),version:row.version});
 }catch(error){console.error('Workspace load failed',error);return json({error:'Your workspace could not be loaded. Please try again.'},503)}
}
export async function PUT(request:Request){
 try{
 const user=await getChatGPTUser();if(!user)return json({error:'Sign in again to save your changes.'},401);
 if(request.headers.get('x-qard-action')!=='save'||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Invalid request.'},403);
 const raw=await request.text();if(raw.length>5_000_000)return json({error:'This workspace is too large to save.'},413);
 let input;try{input=schema.safeParse(JSON.parse(raw))}catch{return json({error:'Invalid workspace.'},400)}
 if(!input.success)return json({error:'Check your entries. Names and both sides of every card are required.'},400);
 const {data,version}=input.data;
 const projects=new Set(data.projects.map(x=>x.id)),courses=new Set(data.courses.map(x=>x.id)),cards=new Set(data.cards.map(x=>x.id));
 if(projects.size!==data.projects.length||courses.size!==data.courses.length||cards.size!==data.cards.length||data.courses.some(x=>!projects.has(x.projectId))||data.cards.some(x=>!courses.has(x.courseId)))return json({error:'A project or course is missing. Reload the workspace and try again.'},400);
 const result=await workspaceDb().prepare('UPDATE workspaces SET data=?,version=version+1 WHERE owner=? AND version=?').bind(JSON.stringify(data),user.userId,version).run();
 if(!result.meta.changes)return json({error:'This workspace changed in another tab. Copy any unsaved text, then reload to get the latest version.'},409);
 return json({data,version:version+1});
 }catch(error){console.error('Workspace save failed',error);return json({error:'Your changes could not be saved. Your input is still here; please try again.'},503)}
}
