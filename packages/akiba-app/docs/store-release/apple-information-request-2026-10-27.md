# Apple Guideline 2.1 information request — 27 October 2026

Status: response draft and recording plan. Not submitted to Apple.
Match every statement to the submitted TestFlight build and deployed backend,
not the local simulator or this repository alone. Replace bracketed fields
before sending. Keep reviewer passwords in App Store Connect, never in Git.

## Confirmed by the owner

- Recording device available: iPhone 15 Pro Max, running iOS 26.6.1.
  Recording and physical-device testing are not yet confirmed complete.
- App Store availability: Kenya only.
- Merchant permissions for logos, photos and offers are available according to
  the owner. Select the relevant documents for attachment; contents have not
  been independently reviewed here.
- Submitted app version/build number: 1.0.0 (4), confirmed by the owner.

## Resolve before responding

- Record the submitted build on a physical iPhone running the latest publicly
  released supported iOS. Record the device model, iOS version, app version and
  build number. Test core flows on supported physical device platforms first.
- Use the real submitted build with screenshot fixture mode OFF. The local
  `.env.local` was enabled for yesterday's marketing capture session; that is
  not evidence of the submitted build's configuration.
- UGC: `verified-visit-report-sheet.tsx` supports reports but explicitly omits
  member blocking because visits have no public author identity. Do not claim
  blocking exists. Assess and implement an appropriate server-enforced block
  mechanism, plus filtering and moderation, before claiming compliance. A
  public author name is not necessary to maintain private author associations.
  Merely hiding one reported card is not equivalent to blocking its author.
  If a new binary is required, upload and test it and identify it in the reply.
- Verify actual production content filtering, report handling and moderation
  operations. Code and acknowledgement copy do not prove timely action.
- Prove the deletion request AND its fulfillment process with a disposable
  account. Do not delete the durable reviewer account used for review access.
- Prepare a durable, email-confirmed reviewer account with working password
  sign-in and suitable sample Miles/vouchers/visit eligibility. Confirm the
  account remains usable from outside Kenya; avoid reviewer location dead ends.
- Confirm storefront availability, production service vendors and third-party
  content permissions. Do not state that merchant/user agreements exist until
  the relevant executed agreements and applicable terms have been checked.

## Physical-device recording sequence

Aim for a clear, continuous demonstration; Apple has not specified a duration.
Start on the iPhone Home Screen with Akiba closed, then launch it. Keep personal
notifications out of view and avoid recording passwords or OTP inbox contents.

1. Show account creation using a fresh disposable email, the actual email-code
   verification and required onboarding. Pause recording for credential entry
   if necessary and identify any security-related cuts in the accompanying note.
2. Show existing-account sign-in, including the password option available to
   reviewers. Demonstrate the documented reviewer path separately if needed.
3. Explore: browse merchant discovery, search and open a merchant. Demonstrate
   location denial/manual city discovery so review does not depend on being in
   Kenya. Explain which merchants and offers are available in Kenya.
4. Pass: show the QR feature and explain that a participating merchant scans it
   to credit eligible purchases. If demonstrating a merchant scan, use a
   controlled test transaction and show the resulting consumer activity.
5. Rewards: show balance, voucher catalogue, review/confirmation, owned voucher
   and redemption instructions. Do not invent a completed physical redemption.
   Identify whether any feature requires a real-world purchase or earned Miles.
6. Verified visits: show viewing a visit, eligible creation/photo submission,
   moderation behavior, the report flow and the implemented blocking mechanism.
   Use designated test content when submitting reports. Do not claim a feature
   is present if the submitted build lacks it.
7. Profile: recent Miles activity, settings and support access.
8. Account deletion LAST, on the disposable account: Profile → Settings →
   Delete account; review the consequences, email verification, acknowledgement,
   confirmation and receipt. Explain that this is a deletion request with a
   processing period, not instant erasure. Provide separate fulfillment evidence
   if completion happens after the recording.
9. If there is paid digital content in the actual build, show accessing it and
   its payment flow. If none, say so explicitly in the response after verifying.

Save the original video. Attach it to the App Review reply where supported,
or supply an accessible recording link and test that reviewers can open it
without requesting access. Add the same information/link to App Review Notes.

## Reply / App Review Notes draft

Hello App Review team,

Thank you for your request. Below is the information for Akiba version
1.0.0, build 4.

### 1. Physical-device demonstration and testing

Recording: [ATTACHMENT NAME OR ACCESSIBLE LINK].
Recording device: iPhone 15 Pro Max running iOS 26.6.1. [CONFIRM THE ATTACHED
RECORDING WAS CAPTURED ON THIS DEVICE AND THAT THIS OS MEETS APPLE’S REQUEST.]
The recording begins
with launching Akiba and demonstrates [LIST THE FLOWS ACTUALLY SHOWN].

We tested this build on [PHYSICAL DEVICE MODELS / OS VERSIONS], covering
[ACTUAL COMPLETED TEST COVERAGE]. [EXPLAIN ANY RECORDING CUTS OR ASYNCHRONOUS
DELETION COMPLETION AND LINK THE FULFILLMENT EVIDENCE].

### 2. Purpose and target audience

Akiba is a consumer merchant-discovery and loyalty app for adults in Kenya.
It helps people discover participating local merchants, view offers, present
their Akiba Pass for eligible purchases, track AkibaMiles and exchange Miles
for merchant vouchers. It brings participating merchants and a member's rewards
into one app. It is intended for individual customers, rather than a private
employee-only or internal business audience.

AkibaMiles are loyalty points, not a cash balance, and cannot be withdrawn or
converted to cash. [CONFIRM THESE LIMITATIONS AGAINST THE SUBMITTED RELEASE.]

### 3. Access and main-feature instructions

Use the reviewer credentials provided in the App Review Information sign-in
fields. On the sign-in screen, select "Use a password instead" and sign in
with that account. The account is [CONFIRMED ACCESSIBLE / SEEDED WITH ACTUAL
REVIEW DATA]. New members can register using email verification and onboarding.

- Explore / Merchants: browse or search for a merchant and open its profile.
- Pass: open the center Pass tab to display the member's merchant-scan QR code.
- Rewards: view My vouchers, Free offers and Shop; open an available item and
  follow its actual eligibility and redemption instructions.
- Offers: browse merchant offers and their details.
- Verified visits: open a merchant's Verified section, then its community
  visit cards. [EXACT CREATION, REPORTING AND BLOCKING STEPS IN SUBMITTED BUILD.]
- Profile: open the profile icon to see activity and settings.
- Deletion: Profile → Settings → Delete account, then complete email
  verification and the explicit confirmation. The app displays the request
  receipt and the current processing target. [CONFIRM PRODUCTION FULFILLMENT.]

[STATE WHETHER SAMPLE FILES OR MERCHANT-SIDE EQUIPMENT ARE REQUIRED, AND HOW
THE REVIEWER CAN EXERCISE CORE FLOWS WITHOUT BEING AT A KENYAN MERCHANT.]

### 4. External services

- Supabase: account authentication, application database and user-photo storage.
- Akiba backend at pass.akibamiles.com: merchant catalogue, loyalty balances,
  vouchers, verified visits and account operations.
- Expo / React Native: native app framework. [IF ENABLED IN THE SUBMITTED IOS
  BUILD: Expo Push Service and Apple Push Notification service deliver alerts.]
- [CONFIRMED PRODUCTION HOSTING PROVIDER]: hosts the Akiba backend.
- [CONFIRMED EMAIL DELIVERY PROVIDER]: delivers authentication/account messages.
  The repository includes a Resend deletion-email adapter, but confirm the
  deployed provider and Supabase Auth email configuration before naming it.

[LIST ANY OTHER ACTIVE CORE PROVIDER, INCLUDING PAYMENT, MAPS, AI OR WALLET
SERVICES IF THE SUBMITTED APP ACTUALLY USES THEM. DO NOT COPY THE ANDROID-ONLY
FIREBASE DELIVERY SETUP INTO THE IOS PROVIDER LIST.]

### 5. Regional availability

Akiba is currently distributed only on the Kenya App Store.
The service focuses on participating merchants in Kenya; offer availability
and redemption depend on the merchant and location. The app does not provide
separate country-specific feature sets within this launch region.
[CONFIRM THE ABOVE FEATURE-BEHAVIOR DESCRIPTION AGAINST THE SUBMITTED BUILD.]

[EXPLAIN ACTUAL ACCESS OUTSIDE KENYA FOR REVIEWERS. IF AVAILABLE IN ADDITIONAL
STOREFRONTS, REPLACE THE ABOVE WITH THE ACTUAL REGIONAL BEHAVIOR.]

### 6. Business model, regulated services and content rights

[AFTER VERIFICATION: The submitted app offers merchant loyalty rewards and
vouchers for real-world goods/services. It does not offer paid digital content,
cash withdrawals, lending, investment services, or gambling.]

[IDENTIFY THE ACTUAL DEVELOPER/OPERATOR ENTITIES AND THEIR RELATIONSHIP IF
DIFFERENT. ATTACH RELEVANT MERCHANT PERMISSIONS FOR LOGOS, PHOTOS AND OFFERS,
AND EXPLAIN THE APPLICABLE USER-CONTENT LICENSE/MODERATION TERMS. LIST ANY
REQUIRED LICENSES FOR FEATURES ACTUALLY OFFERED. DO NOT CLAIM DOCUMENTS EXIST
OR THAT NO LICENSE IS REQUIRED WITHOUT CHECKING.]

Contact: hello.akibamiles@gmail.com

Thank you.

## Sources and limits

- Apple's request supplied in this chat requires all six items in BOTH the
  App Store Connect reply and App Review Information Notes.
- https://developer.apple.com/app-store/review/guidelines/#user-generated-content
  requires filtering, reporting/timely response, blocking abusive users and
  published contact information. Anonymous presentation is not a stated exemption.
- https://developer.apple.com/app-store/review/guidelines/#app-completeness
  requires complete access and working services for review.

Repository review is not verification of the submitted IPA, App Store Connect
configuration, production credentials, physical-device testing or contracts.
