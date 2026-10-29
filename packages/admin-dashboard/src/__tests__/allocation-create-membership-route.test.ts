import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireAdminSession:async()=>({adminUserId:'ops',role:'ops_admin'}),adminIdForWrite:()=> 'ops'}));
vi.mock("@/lib/audit",()=>({writeAdminAuditLog:vi.fn()}));
vi.mock("@/lib/supabase",()=>({supabase:{rpc:state.rpc,from:(table:string)=>({select:()=>({eq:()=>({single:async()=>({data:table==='voucher_funding_programs'?{country_code:'KE'}:{program_id:'fund',mode:'all',rules:[{type:'country_in',countries:['KE']},{type:'profile_country_set'}]},error:null})})})})}}));
const {POST}=await import("@/app/api/admin/voucher-funds/[fundId]/allocations/route");
const b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
function post(ids:unknown){return POST(new NextRequest('http://localhost/api/admin/voucher-funds/fund/allocations',{method:'POST',body:JSON.stringify({merchantId:'11111111-1111-4111-8111-111111111111',title:'Karen',voucherType:'percent_off',discountPercent:10,maximumDiscountKes:200,minimumSpendKes:300,quantityCap:10,authorizedBudgetKes:2000,claimStartsAt:'2026-10-29T00:00:00Z',claimEndsAt:'2026-11-01T20:59:00Z',voucherValidityDays:7,eligibilityRuleSetId:'rules',additionalMerchantIds:ids})}),{params:Promise.resolve({fundId:'fund'})})}
beforeEach(()=>{state.rpc.mockReset().mockResolvedValue({data:{id:'allocation'},error:null})});
it('sends the complete deduplicated membership set to the atomic authoring RPC',async()=>{expect((await post([b,c,b])).status).toBe(200);expect(state.rpc).toHaveBeenCalledTimes(1);expect(state.rpc).toHaveBeenCalledWith('create_voucher_funding_allocation_with_merchants_atomic',expect.objectContaining({p_additional_merchant_ids:[b,c]}))});
it('rejects malformed memberships before creating anything',async()=>{expect((await post(['invalid'])).status).toBe(400);expect(state.rpc).not.toHaveBeenCalled()});
