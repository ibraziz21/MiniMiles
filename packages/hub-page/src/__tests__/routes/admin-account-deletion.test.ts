import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn(),run:vi.fn(),email:vi.fn()}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:state.rpc})}));
vi.mock('@/lib/akiba/adminAccountDeletion',()=>({adminDeletionReadiness:()=>[],runAdminAccountDeletion:state.run,retryAdminDeletionEmail:state.email}));
const {POST}=await import('@/app/api/internal/admin-account-deletion/route');
const actorId='10000000-0000-4000-8000-000000000001',requestId='20000000-0000-4000-8000-000000000002';
const request=(action='run',secret='test-only-secret')=>new Request('https://pass.akibamiles.com/api/internal/admin-account-deletion',{method:'POST',headers:{'Content-Type':'application/json','x-webhook-secret':secret},body:JSON.stringify({actorId,requestId,action})});
beforeEach(()=>{vi.stubEnv('INTERNAL_WEBHOOK_SECRET','test-only-secret');state.rpc.mockReset().mockImplementation(async(name:string)=>({data:name==='admin_deletion_blockers'?[]:null,error:null}));state.run.mockReset().mockResolvedValue({ok:true,verified:true});state.email.mockReset().mockResolvedValue(true);});
afterEach(()=>vi.unstubAllEnvs());
describe('internal operator deletion endpoint',()=>{
 it('requires the server-to-server secret',async()=>{expect((await POST(request('run','wrong'))).status).toBe(401);expect(state.rpc).not.toHaveBeenCalled();expect(state.run).not.toHaveBeenCalled();});
 it('rechecks the named actor before any cleanup',async()=>{state.rpc.mockResolvedValue({data:null,error:{code:'42501'}});expect((await POST(request())).status).toBe(403);expect(state.run).not.toHaveBeenCalled();});
 it('passes only validated request and actor to the runner',async()=>{expect((await POST(request())).status).toBe(200);expect(state.run).toHaveBeenCalledWith(requestId,actorId,expect.any(Object));});
 it('returns actionable preflight blockers without running cleanup',async()=>{state.rpc.mockImplementation(async(name:string)=>({data:name==='admin_deletion_blockers'?['shared_payment_history']:null,error:null}));const response=await POST(request('inspect'));expect(await response.json()).toMatchObject({blockers:['shared_payment_history']});expect(state.run).not.toHaveBeenCalled();});
 it('can retry notice delivery independently of destructive execution',async()=>{expect((await POST(request('retry_email'))).status).toBe(200);expect(state.email).toHaveBeenCalledWith(requestId,expect.any(Object));expect(state.run).not.toHaveBeenCalled();});
});
