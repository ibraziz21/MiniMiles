import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ error: null as null | {code:string}, missing:false, membershipError:false, selects:[] as string[] }));
vi.mock("next/navigation",()=>({notFound:()=>{throw Error("NOT_FOUND")},redirect:()=>{throw Error("REDIRECT")}}));
vi.mock("@/lib/auth",()=>({requireAdminSession:async()=>({role:"ops_admin"})}));
vi.mock("@/components/shell/PageHeader",()=>({PageHeader:()=>null}));
vi.mock("@/components/vouchers/AllocationForm",()=>({AllocationForm:()=>null}));
vi.mock("@/lib/supabase",()=>({supabase:{from:(table:string)=>{
 const result=()=>table==='voucher_funding_allocations'?{data:state.missing?null:{id:'allocation',program_id:'fund',state:'draft',version:1,merchant_id:'a',metadata:{redemption_schedule:{days:[6,0],timezone:'Africa/Nairobi',startDate:'2026-10-31',endDate:'2026-11-01'}},spend_voucher_templates:{title:'Karen',voucher_type:'percent_off'},claim_starts_at:'2026-10-28T21:00:00Z',claim_ends_at:'2026-11-01T20:59:00Z',voucher_validity_seconds:604800,authorized_budget_minor:200000},error:state.error}:{data:table==='voucher_allocation_merchants'?[{partner_id:'b'},{partner_id:'c'}]:[],error:state.membershipError?{code:'OFFLINE'}:null};
 const c:Record<string,unknown>={};c.select=(s:string)=>{state.selects.push(s);return c};c.eq=()=>c;c.order=()=>c;c.single=async()=>result();c.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve);return c;
}}}));
vi.stubGlobal("React", React);
const {default:Page}=await import("@/app/(dashboard)/vouchers/funds/[fundId]/allocations/[allocationId]/edit/page");
const load=()=>Page({params:Promise.resolve({fundId:'fund',allocationId:'allocation'})});
beforeEach(()=>{state.error=null;state.missing=false;state.membershipError=false;state.selects=[]});
it('uses an explicit primary join and retains all merchants and event dates',async()=>{const page=await load();expect(state.selects[0]).toContain('partners!voucher_funding_allocations_merchant_id_fkey(name)');const initial=page.props.children[1].props.initial;expect(initial.additionalMerchantIds).toEqual(['b','c']);expect(initial.redemptionSchedule).toMatchObject({startDate:'2026-10-31',endDate:'2026-11-01'})});
it('distinguishes database failure from not-found',async()=>{state.error={code:'PGRST201'};await expect(load()).rejects.toThrow('temporarily unavailable')});
it('withholds the editor if membership lookup fails',async()=>{state.membershipError=true;await expect(load()).rejects.toThrow('merchants are temporarily unavailable')});
it('still handles a genuinely absent allocation',async()=>{state.error={code:'PGRST116'};state.missing=true;await expect(load()).rejects.toThrow('NOT_FOUND')});
