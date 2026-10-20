import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({authorized:true,error:null as null | {code:string;message:string},calls:0}));
vi.mock("@/lib/internalWorkerAuth",()=>({isInternalWorkerRequest:()=>state.authorized}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:async()=>{
  state.calls++;return {data:3,error:state.error};
}})}));
const {GET}=await import("@/app/api/internal/expire-account-deletion-evidence/route");
const original=process.env.ACCOUNT_DELETION_EXPIRY_ENABLED;
beforeEach(()=>{state.authorized=true;state.error=null;state.calls=0;process.env.ACCOUNT_DELETION_EXPIRY_ENABLED="true";});
afterEach(()=>{if(original===undefined)delete process.env.ACCOUNT_DELETION_EXPIRY_ENABLED;
  else process.env.ACCOUNT_DELETION_EXPIRY_ENABLED=original;vi.restoreAllMocks();});
const request=()=>new Request("https://pass.akibamiles.com/api/internal/expire-account-deletion-evidence");
describe("deletion evidence expiry worker",()=>{
  it("rejects unauthorized callers without accessing the database",async()=>{
    state.authorized=false;expect((await GET(request())).status).toBe(401);expect(state.calls).toBe(0);
  });
  it("remains default-off until expiry rollout is explicitly configured",async()=>{
    delete process.env.ACCOUNT_DELETION_EXPIRY_ENABLED;
    expect((await GET(request())).status).toBe(503);expect(state.calls).toBe(0);
  });
  it("can expire existing evidence independently of new-deletion admission",async()=>{
    const response=await GET(request());expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ok:true,evidenceRemoved:3});
  });
  it("does not return or log database messages that may contain personal data",async()=>{
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});
    state.error={code:"23503",message:"member@example.com private source"};
    const response=await GET(request());expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())+JSON.stringify(log.mock.calls)).not.toContain("member@example.com");
  });
});
