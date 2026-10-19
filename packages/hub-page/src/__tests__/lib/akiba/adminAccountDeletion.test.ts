import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const state=vi.hoisted(()=>({deliver:vi.fn()}));
vi.mock("@/lib/akiba/accountDeletionWorker",()=>({deliverOneCompletionEmail:state.deliver}));
import { runAdminAccountDeletion, retryAdminDeletionEmail } from "@/lib/akiba/adminAccountDeletion";
import { encryptCompletionContact } from "@/lib/akiba/accountDeletionContact";
function fixture() {
 const encrypted=encryptCompletionContact('member@example.invalid')!;
 const response={data:{completion_contact_ciphertext:encrypted.ciphertext,completion_contact_key_version:encrypted.keyVersion,status:'manual_review'},error:null};
 const from=vi.fn(()=>({select:()=>({eq:()=>({maybeSingle:async()=>response})})}));
 const remove=vi.fn().mockResolvedValue({error:null});
 const rpc=vi.fn(async(name:string,args?:Record<string,unknown>):Promise<{data:unknown;error:unknown}>=>{
  if(name==='begin_admin_account_deletion')return {data:{ok:true,runToken:'lease'},error:null};
  if(name==='admin_deletion_storage_page')return {data:args?.p_offset===0?[{bucket:'discovery-visit-photos',key:'source'}]:[],error:null};
  if(name==='finalize_admin_account_deletion')return {data:{ok:true,verified:true},error:null};
  return {data:[],error:null};
 });
 return {admin:{from,rpc,storage:{from:()=>({remove})}} as unknown as SupabaseClient,rpc,remove,response};
}
beforeEach(()=>{vi.stubEnv('ACCOUNT_DELETION_ADMIN_EXECUTION_ENABLED','true');vi.stubEnv('ACCOUNT_DELETION_EXPIRY_ENABLED','true');vi.stubEnv('ACCOUNT_DELETION_EMAIL_PROVIDER','resend');vi.stubEnv('RESEND_API_KEY','test-only-key');vi.stubEnv('ACCOUNT_DELETION_CONTACT_KEY_V1',Buffer.alloc(32,3).toString('base64'));state.deliver.mockReset().mockResolvedValue(true);});
afterEach(()=>vi.unstubAllEnvs());
describe('admin cleanup orchestration',()=>{
 it('fails closed before reading member data when execution is disabled',async()=>{const f=fixture();vi.stubEnv('ACCOUNT_DELETION_ADMIN_EXECUTION_ENABLED','false');expect(await runAdminAccountDeletion('request','actor',f.admin)).toMatchObject({ok:false,blockers:['admin_execution_disabled']});expect(f.rpc).not.toHaveBeenCalled();});
 it('validates notice contact before starting destructive work',async()=>{const f=fixture();f.response.data.completion_contact_ciphertext='invalid';expect(await runAdminAccountDeletion('request','actor',f.admin)).toMatchObject({ok:false,blockers:['completion_contact_unreadable']});expect(f.rpc).not.toHaveBeenCalled();});
 it('removes Storage objects before database verification and completion',async()=>{const f=fixture();expect(await runAdminAccountDeletion('request','actor',f.admin)).toMatchObject({ok:true,verified:true});expect(f.remove).toHaveBeenCalledWith(['source']);const finalize=f.rpc.mock.calls.findIndex(c=>c[0]==='finalize_admin_account_deletion');expect(f.rpc.mock.invocationCallOrder[finalize]).toBeGreaterThan(f.remove.mock.invocationCallOrder[0]);});
 it('preserves failure and never finalizes after a Storage error',async()=>{const f=fixture();f.remove.mockResolvedValue({error:{message:'sensitive object key'}});expect(await runAdminAccountDeletion('request','actor',f.admin)).toMatchObject({ok:false,blockers:['storage_cleanup_failed']});expect(f.rpc.mock.calls.some(c=>c[0]==='finalize_admin_account_deletion')).toBe(false);expect(f.rpc).toHaveBeenCalledWith('fail_admin_account_deletion',expect.objectContaining({p_code:'storage_cleanup_failed'}));});
 it('retains failed verification rather than announcing completion',async()=>{const f=fixture();const base=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(n,a)=>n==='finalize_admin_account_deletion'?{data:{ok:false,blockers:['storage_verification_failed']},error:null}:base(n,a));expect(await runAdminAccountDeletion('request','actor',f.admin)).toMatchObject({ok:false,blockers:['storage_verification_failed']});expect(state.deliver).not.toHaveBeenCalled();});
 it('uses the actual page length to traverse the persistent manifest',async()=>{const f=fixture();const base=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(n,a)=>n==='admin_deletion_storage_page'?{data:Number(a?.p_offset)<3?[{bucket:'discovery-visit-photos',key:String(a?.p_offset)}]:[],error:null}:base(n,a));expect(await runAdminAccountDeletion('request','actor',f.admin)).toMatchObject({ok:true});expect(f.rpc.mock.calls.filter(c=>c[0]==='admin_deletion_storage_page').map(c=>c[1]?.p_offset)).toEqual([0,1,2,3]);});
 it('does not reopen verified cleanup when email delivery fails',async()=>{const f=fixture();const base=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(n,a)=>n==='claim_admin_deletion_completion_email'?{data:[{id:'request'}],error:null}:base(n,a));state.deliver.mockRejectedValue(new Error('mail outage'));expect(await runAdminAccountDeletion('request','actor',f.admin)).toMatchObject({ok:true,verified:true,emailDelivered:false});expect(f.rpc.mock.calls.some(c=>c[0]==='fail_admin_account_deletion')).toBe(false);});
 it('leases only the requested completion notice',async()=>{const f=fixture();const base=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(n,a)=>n==='claim_admin_deletion_completion_email'?{data:[{id:'request'}],error:null}:base(n,a));expect(await retryAdminDeletionEmail('request',f.admin)).toBe(true);expect(f.rpc).toHaveBeenCalledWith('claim_admin_deletion_completion_email',{p_request:'request'});});
});
