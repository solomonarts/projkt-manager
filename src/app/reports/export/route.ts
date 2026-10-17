import { requirePermission } from '@/lib/authz';

function csv(value:unknown){
  let text=String(value??'');
  if(/^[\s]*[=+@-]/.test(text))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}

export async function GET(){
  const {supabase}=await requirePermission('reports.view');
  const {data,error}=await supabase.from('reports').select('title,report_type,status,verified,period_start,period_end,submission_date,planned_activities,achievements,challenges,risks,lessons,recommendations,progress').order('created_at',{ascending:false});
  if(error)return new Response('Could not export accessible reports.',{status:500});
  const columns=['title','report_type','status','verified','period_start','period_end','submission_date','planned_activities','achievements','challenges','risks','lessons','recommendations','progress'] as const;
  const rows=[columns.join(','),...(data??[]).map(row=>columns.map(column=>csv(row[column])).join(','))].join('\r\n');
  return new Response(rows,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="fieldnote-reports.csv"','Cache-Control':'no-store'}});
}
