# Purchases and rewarded ads: setup for real-service checks

The code for purchases (RevenueCat) and rewarded ads (AdMob) is in place and tested with mocks. These steps
turn on the real services for the **development** environment. Nothing below goes into Git, the app code or
chat: public IDs live in EAS environment variables, private keys live in Supabase secrets.

Linked development project: `kozskxoiyrzrokjmcqeo`. Android package: `com.eswaran2728.rise120`.

## 1. Google Play (needed for real purchases)

1. In Play Console, create the app (or open it) with package `com.eswaran2728.rise120`.
2. Upload any build to an **internal testing** track (a signed build from `eas build --profile preview`/production works) so in-app products can be created and tested.
3. Create three products and set prices in MYR (Monetize > Products):
   - Subscription `monthly` (RM 39.90), subscription `yearly` (RM 199), and a one-time product `lifetime` (RM 399).
4. Add your own Google account under **License testing** so test purchases are free and instantly renewing.

## 2. RevenueCat (needed for premium to unlock)

1. Create a RevenueCat project and add an **Android (Google Play)** app with package `com.eswaran2728.rise120`; follow RevenueCat's steps to connect Google Play (service-account credentials are entered in RevenueCat's dashboard only).
2. Products: import the three Play products. Entitlements: create one called `premium` and attach all three.
3. Offerings: make an offering the **current** one with packages of type Monthly, Annual and Lifetime.
4. Copy the **public SDK key for the Android app** (starts with `goog_`). This is the only RevenueCat value the app uses.
5. Webhook (Integrations > Webhooks): URL `https://kozskxoiyrzrokjmcqeo.supabase.co/functions/v1/revenuecat-webhook`. Set its Authorization header value to the same value as the Supabase secret `REVENUECAT_WEBHOOK_AUTH` (already set on development; set a new value in both places if you prefer to rotate it).
6. Optional, for restoring purchases on a different account: create a RevenueCat **secret** API key and store it only as the Supabase secret `REVENUECAT_API_KEY`:
   `npx supabase secrets set REVENUECAT_API_KEY=... --project-ref kozskxoiyrzrokjmcqeo` (type the value in your own terminal; do not paste it anywhere else).

## 3. AdMob (needed for real rewarded ads and credits)

1. Create an AdMob account and add the Android app (package `com.eswaran2728.rise120`).
2. Create a **Rewarded** ad unit. Copy the App ID (`ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX`) and the ad unit ID (`ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX`).
3. On the ad unit, turn on **server-side verification** and set the callback URL to
   `https://kozskxoiyrzrokjmcqeo.supabase.co/functions/v1/grant-ad-reward`.
4. Store the ad unit ID where the callback is checked: `npx supabase secrets set ADMOB_REWARDED_AD_UNIT_IDS=<ad unit id> --project-ref kozskxoiyrzrokjmcqeo` (development currently holds Google's public sample unit).

## 4. EAS development environment (public IDs only)

Create these three variables in the **development** environment (EAS dashboard > Environment variables, or `eas env:create --environment development`), visibility *Plain text* or *Sensitive* (they are public identifiers, not secrets):

| Name | Value |
| --- | --- |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | RevenueCat public Android SDK key (`goog_...`) |
| `EXPO_PUBLIC_ADMOB_REWARDED_ANDROID_UNIT_ID` | the rewarded ad unit ID |
| `ADMOB_ANDROID_APP_ID` | the AdMob App ID (used when the native app is built) |

Without them the development build still works: purchases show "not set up in this version", and rewarded ads use Google's **test** unit. A `production` build refuses to build without `ADMOB_ANDROID_APP_ID`.

## 5. Build and check

1. `eas build --platform android --profile development` and install the APK (new native modules need a new build).
2. Sign in on the phone, hit the daily food limit, and tap **Watch an ad**. After the ad, the reward shows "being verified" and then the bonus appears once Google's callback reaches the server.
3. Open **Subscribe**, check the prices come from Google Play, buy with the licence-tester account, and confirm premium appears after a few seconds. Then try **Restore purchases** and a cancelled purchase.

Until steps 1-4 are done, real purchase, restore and verified-reward behaviour is **unverified**; only the mocked and development-database checks have run.
