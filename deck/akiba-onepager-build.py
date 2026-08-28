#!/usr/bin/env python3
"""Getting Started with Akiba — A4 double-sided merchant guide. EN + SW."""
import base64, pathlib

IMG = pathlib.Path(__file__).parent / "img"
def b64(n): return "data:image/png;base64," + base64.b64encode((IMG/(n+".png")).read_bytes()).decode()
I = {k: b64(k) for k in ["m1_bill","m3_confirm","m4_issued","c1_pass","c2_home","c3_vouchers",
                         "logo_icon","logo_word","qr"]}

CSS = """
@page { size: A4; margin: 0; }
*{ box-sizing:border-box; margin:0; padding:0; }
:root{
  --teal:#238D9D; --teal-d:#12525C; --teal-l:#E9F4F6;
  --ink:#0E1618; --mut:#5E7276; --mut-l:#8FA3A7;
  --line:#DDE7E9; --soft:#F4F8F9; --green:#2E9E63;
}
html,body{ background:#394446; }
body{ font-family:'Poppins','DejaVu Sans',sans-serif; -webkit-font-smoothing:antialiased;
      color:var(--ink); }
.pg{ width:794px; height:1123px; background:#fff; position:relative; overflow:hidden;
     page-break-after:always; break-after:page; display:flex; flex-direction:column; }
.pg:last-child{ page-break-after:auto; }

/* header */
.hd{ background:var(--ink); color:#fff; padding:28px 52px 24px; }
.hd .row{ display:flex; align-items:center; justify-content:space-between; }
.hd img.wm{ height:44px; }
.hd .tag{ font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:#7FC7D4;
  font-weight:600; }
.hd h1{ font-size:27.5px; line-height:1.18; font-weight:700; letter-spacing:-.02em;
  margin-top:19px; max-width:21ch; }
.hd p{ font-size:12.5px; line-height:1.55; color:#A9BFC3; margin-top:11px; max-width:66ch; }

.hd.slim{ padding:22px 52px; }
.hd.slim .row{ align-items:center; }
.hd.slim img.wm{ height:30px; }

.body{ padding:26px 52px 0; flex:1; display:flex; flex-direction:column; }
.sec{ margin-bottom:20px; }
.sec:last-child{ margin-bottom:0; }
.sh{ font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:var(--teal);
  font-weight:700; margin-bottom:14px; display:flex; align-items:center; gap:10px; }
.sh::after{ content:""; flex:1; height:1px; background:var(--line); }

/* steps */
.steps{ display:grid; grid-template-columns:repeat(4,1fr); gap:0; }
.st{ padding:0 16px; position:relative; }
.st:first-child{ padding-left:0; } .st:last-child{ padding-right:0; }
.st::after{ content:"›"; position:absolute; right:-6px; top:2px; font-size:20px;
  color:#BFD2D5; font-weight:300; }
.st:last-child::after{ display:none; }
.st .n{ width:23px; height:23px; border-radius:50%; background:var(--teal); color:#fff;
  font-size:11.5px; font-weight:700; display:flex; align-items:center; justify-content:center;
  margin-bottom:11px; }
.st h4{ font-size:14px; font-weight:600; line-height:1.3; margin-bottom:6px; }
.st p{ font-size:11px; line-height:1.48; color:var(--mut); }

/* phone strip */
.strip{ display:flex; gap:16px; margin-top:18px; padding:18px 20px 16px; background:var(--soft);
  border-radius:14px; align-items:flex-start; }
.strip .pc{ flex:1; text-align:center; }
.strip img{ width:100%; max-width:110px; height:166px; object-fit:cover; object-position:top center;
  border-radius:10px; border:1px solid var(--line); box-shadow:0 6px 16px rgba(14,22,24,.11); }
.strip .cap{ font-size:10.5px; line-height:1.4; color:var(--mut); margin-top:10px; }
.strip .cap b{ display:block; color:var(--ink); font-weight:600; font-size:11.5px; margin-bottom:2px; }

/* benefits */
.bens{ display:grid; grid-template-columns:1fr 1fr; gap:13px 20px; }
.ben{ border:1px solid var(--line); border-radius:12px; padding:14px 17px; }
.ben h4{ font-size:14.5px; font-weight:600; margin-bottom:6px; }
.ben h4 span{ color:var(--teal); margin-right:7px; font-weight:700; }
.ben p{ font-size:11px; line-height:1.48; color:var(--mut); }

/* plan */
.plan{ border:2px solid var(--teal); border-radius:16px; overflow:hidden; }
.plan .top{ background:var(--teal); color:#fff; padding:20px 26px; display:flex;
  align-items:baseline; justify-content:space-between; }
.plan .top .nm{ font-size:20px; font-weight:700; }
.plan .top .pr{ font-size:26px; font-weight:700; letter-spacing:-.02em; }
.plan .top .pr small{ font-size:13px; font-weight:500; opacity:.85; letter-spacing:0; }
.plan .in{ padding:22px 26px 24px; }
.plan ul{ list-style:none; display:grid; grid-template-columns:1fr 1fr; gap:11px 26px; }
.plan li{ font-size:12.5px; line-height:1.45; padding-left:22px; position:relative; }
.plan li::before{ content:"✓"; position:absolute; left:0; top:0; color:var(--green);
  font-weight:700; font-size:12px; }
.plan .foot{ margin-top:18px; padding-top:15px; border-top:1px solid var(--line);
  font-size:11.5px; line-height:1.5; color:var(--mut); }

/* journey */
.jr{ border-top:1px solid var(--line); }
.jr .r{ display:grid; grid-template-columns:106px 1fr; gap:22px; padding:14px 0;
  border-bottom:1px solid var(--line); align-items:baseline; }
.jr .w{ font-size:12.5px; font-weight:700; color:var(--teal); }
.jr .d{ font-size:13px; line-height:1.45; }
.jr .r.hi{ background:var(--teal-l); margin:0 -16px; padding:14px 16px; border-bottom:0;
  border-radius:9px; }
.ask-note{ margin-top:26px; border-left:3px solid var(--teal); padding:4px 0 4px 20px; }
.ask-note h4{ font-size:15px; font-weight:600; margin-bottom:6px; }
.ask-note p{ font-size:12.5px; line-height:1.55; color:var(--mut); max-width:62ch; }

/* CTA */
.cta{ margin-top:auto; background:var(--ink); color:#fff; padding:30px 52px 34px;
  display:grid; grid-template-columns:1fr 132px; gap:34px; align-items:center; }
.cta h3{ font-size:23px; font-weight:700; line-height:1.2; }
.cta p{ font-size:13px; line-height:1.55; color:#A9BFC3; margin-top:10px; max-width:44ch; }
.cta .contact{ margin-top:18px; display:flex; gap:26px; flex-wrap:wrap; }
.cta .contact div{ font-size:11.5px; line-height:1.5; }
.cta .contact .k{ font-size:9px; letter-spacing:.16em; text-transform:uppercase;
  color:#7FC7D4; font-weight:700; margin-bottom:3px; }
.cta .contact .v{ color:#fff; font-weight:500; }
.cta .contact .wl{ width:118px; height:1px; background:rgba(255,255,255,.45);
  margin-top:14px; }
.qr{ text-align:center; }
.qr img{ width:118px; height:118px; background:#fff; padding:7px; border-radius:10px; display:block; }
.qr .l{ font-size:9px; letter-spacing:.12em; text-transform:uppercase; color:#7FC7D4;
  margin-top:9px; font-weight:600; }

.foot-note{ padding:14px 52px 18px; font-size:10px; color:var(--mut-l);
  display:flex; justify-content:space-between; letter-spacing:.04em; }
"""

EN = dict(
 lang="en", tag="Merchant guide",
 h1="Turn everyday customers into repeat customers.",
 intro="Akiba helps businesses attract, engage and reward customers through a city-wide rewards network. Customers earn Akiba Miles when they shop at participating businesses — giving them another reason to choose you, and to come back.",
 how_h="How it works",
 steps=[("Customer shops normally","Cash, M-Pesa, or however you already accept payments. Nothing changes at your till."),
        ("You award Akiba Miles","They show you their Akiba code. You scan it and enter the amount — 1 Mile per KES 100."),
        ("Customer uses their Miles","On rewards and offers across the Akiba network, including yours."),
        ("Your business grows","Run campaigns. Reward repeat visits. Understand your customers. Measure what works.")],
 strip=[("c1_pass","What they show you","Their Akiba code, on their phone"),
        ("m3_confirm","What you see","Amount, customer and Miles on one screen"),
        ("c3_vouchers","What brings them back","Your offer, in their pocket")],
 why_h="Why join Akiba",
 bens=[("Bring customers back","Reward repeat business with offers you create and control."),
       ("Know your customers","See who returns, who stopped coming, and how your campaigns perform."),
       ("Grow without the admin","Launch promotions with no loyalty cards and no complicated systems."),
       ("Join the network","Become part of a growing rewards network connecting businesses and customers across the city.")],
 inc_h="What's included",
 plan_nm="Akiba Micro", plan_pr="KES 500", plan_per="/month",
 plan_li=["One business location","Customer campaigns","Customer dashboard","Merchant profile",
          "Reward customer spending up to KES 250,000/month","QR earning at your counter",
          "Setup and onboarding","Merchant signage"],
 plan_foot="We set you up, train your staff, and come back to train again whenever you hire. No new till, no new system, no change to how you take money.",
 jr_h="Your first 90 days",
 jr=[("Week 1","Setup, staff training and your first campaign live.",False),
     ("Month 1","Customers begin earning Miles at your counter.",False),
     ("Month 2","Launch campaigns based on real customer activity.",False),
     ("Month 3","Review your results, renew, and plan your next stage of growth.",True)],
 note_h="Questions before you decide?",
 note_p="Ask us anything now rather than after you've signed — including what Akiba won't do for you. We're building this network street by street, and it only works if the businesses on it know exactly what they're getting.",
 cta_h="Ready to join?",
 cta_p="We'll help you get your business live in less than a week.",
 contact=[("Website","merchant.akibamiles.com"),("Email","hello@akibamiles.com"),("Phone","")],
 qr_l="Get started",
 f_l="Getting Started with Akiba", f_r="Akiba Business · Mombasa 2026",
)

SW = dict(
 lang="sw", tag="Mwongozo wa mfanyabiashara",
 h1="Geuza customers wa kila siku kuwa customers wa kurudi.",
 intro="Akiba inasaidia biashara kuvutia, kushirikisha na kuwazawadia customers kupitia network ya rewards ya jiji zima. Customers wanapata Akiba Miles wakinunua kwenye biashara zilizojiunga — wanapata sababu nyingine ya kukuchagua wewe, na ya kurudi.",
 how_h="Inafanyaje kazi",
 steps=[("Customer ananunua kama kawaida","Cash, M-Pesa, au vyovyote unavyopokea pesa. Hakuna kinachobadilika kwenye till yako."),
        ("Unampa Akiba Miles","Anakuonyesha code yake ya Akiba. Una-scan na kuweka amount — Mile 1 kwa kila KES 100."),
        ("Customer anatumia Miles zake","Kwenye rewards na offers kote kwenye network ya Akiba, pamoja na zako."),
        ("Biashara yako inakua","Endesha campaigns. Zawadia wanaorudi. Elewa customers wako. Pima kinachofanya kazi.")],
 strip=[("c1_pass","Anachokuonyesha","Code yake ya Akiba, kwenye simu"),
        ("m3_confirm","Unachokiona","Amount, customer na Miles kwenye screen moja"),
        ("c3_vouchers","Kinachomrudisha","Offer yako, mfukoni mwake")],
 why_h="Kwa nini ujiunge na Akiba",
 bens=[("Rudisha customers","Zawadia wanaorudi kwa offers unazotengeneza na kuzi-control mwenyewe."),
       ("Jua customers wako","Ona nani anarudi, nani aliacha kuja, na campaigns zako zinafanyaje."),
       ("Kua bila usumbufu","Anzisha promotions bila kadi za loyalty na bila systems ngumu."),
       ("Jiunge na network","Kuwa sehemu ya network inayokua ya rewards inayounganisha biashara na customers jiji zima.")],
 inc_h="Kinachojumuishwa",
 plan_nm="Akiba Micro", plan_pr="KES 500", plan_per="/mwezi",
 plan_li=["Location moja ya biashara","Campaigns za customers","Dashboard ya customers","Profile ya biashara",
          "Zawadia customers wanaotumia mpaka KES 250,000/mwezi","QR earning kwenye counter yako",
          "Set-up na onboarding","Signage ya biashara"],
 plan_foot="Tunaku-set up, tunafundisha staff wako, na tunarudi kufundisha tena kila unapoajiri. Hakuna till mpya, hakuna system mpya, hakuna mabadiliko kwenye jinsi unavyopokea pesa.",
 jr_h="Siku zako 90 za kwanza",
 jr=[("Wiki ya 1","Set-up, kufundisha staff na campaign yako ya kwanza inaanza.",False),
     ("Mwezi wa 1","Customers wanaanza kupata Miles kwenye counter yako.",False),
     ("Mwezi wa 2","Anzisha campaigns kwa kutumia data halisi ya customers.",False),
     ("Mwezi wa 3","Angalia results zako, renew, na panga hatua yako ijayo ya kukua.",True)],
 note_h="Una maswali kabla ya kuamua?",
 note_p="Tuulize chochote sasa badala ya baada ya ku-sign — pamoja na kile Akiba isichokifanya. Tunajenga network hii mtaa kwa mtaa, na inafanya kazi tu kama biashara zilizomo zinajua hasa zinachopata.",
 cta_h="Uko tayari kujiunga?",
 cta_p="Tutakusaidia biashara yako iwe live ndani ya wiki moja.",
 contact=[("Website","merchant.akibamiles.com"),("Email","hello@akibamiles.com"),("Simu","")],
 qr_l="Anza hapa",
 f_l="Kuanza na Akiba", f_r="Akiba Business · Mombasa 2026",
)

def build(d):
    steps = "".join(
      f'<div class="st"><div class="n">{i+1}</div><h4>{t}</h4><p>{p}</p></div>'
      for i,(t,p) in enumerate(d['steps']))
    strip = "".join(
      f'<div class="pc"><img src="{I[k]}"><div class="cap"><b>{t}</b>{s}</div></div>'
      for k,t,s in d['strip'])
    bens = "".join(
      f'<div class="ben"><h4><span>{i+1:02d}</span>{t}</h4><p>{p}</p></div>'
      for i,(t,p) in enumerate(d['bens']))
    plan = "".join(f"<li>{x}</li>" for x in d['plan_li'])
    jr = "".join(f'<div class="r{" hi" if hi else ""}"><div class="w">{w}</div>'
                 f'<div class="d">{t}</div></div>' for w,t,hi in d['jr'])
    contact = "".join(
      f'<div><div class="k">{k}</div>'
      + (f'<div class="v">{v}</div>' if v else '<div class="wl"></div>')
      + '</div>' for k,v in d['contact'])

    front = f"""<div class="pg">
      <div class="hd">
        <div class="row"><img class="wm" src="{I['logo_word']}">
          <div class="tag">{d['tag']}</div></div>
        <h1>{d['h1']}</h1>
        <p>{d['intro']}</p>
      </div>
      <div class="body">
        <div class="sec"><div class="sh">{d['how_h']}</div>
          <div class="steps">{steps}</div>
          <div class="strip">{strip}</div>
        </div>
        <div class="sec"><div class="sh">{d['why_h']}</div>
          <div class="bens">{bens}</div>
        </div>
      </div>
      <div class="foot-note"><span>{d['f_l']}</span><span>1 / 2</span></div>
    </div>"""

    back = f"""<div class="pg">
      <div class="hd slim">
        <div class="row"><img class="wm" src="{I['logo_word']}">
          <div class="tag">{d['tag']}</div></div>
      </div>
      <div class="body">
        <div class="sec"><div class="sh">{d['inc_h']}</div>
          <div class="plan">
            <div class="top"><div class="nm">{d['plan_nm']}</div>
              <div class="pr">{d['plan_pr']}<small>{d['plan_per']}</small></div></div>
            <div class="in"><ul>{plan}</ul>
              <div class="foot">{d['plan_foot']}</div></div>
          </div>
        </div>
        <div class="sec"><div class="sh">{d['jr_h']}</div>
          <div class="jr">{jr}</div>
          <div class="ask-note"><h4>{d['note_h']}</h4><p>{d['note_p']}</p></div>
        </div>
      </div>
      <div class="cta">
        <div><h3>{d['cta_h']}</h3><p>{d['cta_p']}</p>
          <div class="contact">{contact}</div></div>
        <div class="qr"><img src="{I['qr']}"><div class="l">{d['qr_l']}</div></div>
      </div>
      <div class="foot-note"><span>{d['f_r']}</span><span>2 / 2</span></div>
    </div>"""

    return (f'<!doctype html><html lang="{d["lang"]}"><head><meta charset="utf-8">'
            f'<title>Getting Started with Akiba</title><style>{CSS}</style></head>'
            f'<body>{front}{back}</body></html>')

if __name__ == "__main__":
    out = pathlib.Path(__file__).parent
    (out/"akiba-getting-started-en.html").write_text(build(EN), encoding="utf-8")
    (out/"akiba-getting-started-sw.html").write_text(build(SW), encoding="utf-8")
    print("html written")
