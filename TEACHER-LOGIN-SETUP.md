# Teacher login setup (one time, about 20 minutes)

The teacher portal is at **https://cmarklcs.github.io/lynx-library/admin.html**.
It stays on an "Almost ready" screen until these two parts are connected.

## Part A: Firebase (stores the show/hide list)
Use any Google account (a school Google account is best, so the project isn't tied to one person).

1. Go to https://console.firebase.google.com and click **Create a project**. Name it `lynx-library`. Turn **Google Analytics off**.
2. Left menu: **Build → Firestore Database → Create database**. Pick a US location and **Start in production mode**.
3. In Firestore, open the **Rules** tab. Replace everything with the contents of `firestore.rules` (in this folder) and click **Publish**.
4. Click the gear icon → **Project settings**. Under **Your apps**, click the **</>** (Web) button, name it `Lynx Library`, and click **Register app**. Copy the `apiKey`, `authDomain`, `projectId`, and `appId` values. These are not secret. Send them to Claude, or paste them into `site/firebase-config.js`.
5. Left menu: **Build → Authentication → Get started → Sign-in method → Add new provider → Microsoft**. Turn on **Enable**. Copy the **redirect URL** at the bottom (it ends in `/__/auth/handler`). Leave this tab open for Part B.
6. Still in Authentication, open **Settings → Authorized domains → Add domain** and add `cmarklcs.github.io`.

## Part B: Microsoft (lets teachers sign in with school accounts)
This needs permission to register apps in Lausanne's Microsoft 365. If you don't have it, send these steps to your IT team.

1. Go to https://entra.microsoft.com → **Applications → App registrations → New registration**.
   - Name: `Lynx Library teacher login`
   - Supported account types: **Accounts in this organizational directory only (single tenant)**
   - Redirect URI: choose **Web** and paste the redirect URL from step A5.
   - Click **Register**.
2. On the app's **Overview** page, copy the **Application (client) ID** and the **Directory (tenant) ID**.
3. Open **Certificates & secrets → New client secret**. Add it, then copy the secret's **Value** right away. It is only shown once.
4. Back in Firebase (step A5), paste the **Application ID** and **Application secret**, then click **Save**.
   Keep the secret private. Don't send it to anyone, Claude included; it only goes into Firebase.
5. Put the **Directory (tenant) ID** in `site/firebase-config.js` as `LYNX_MS_TENANT`, or send it to Claude.

## After setup
Open the teacher portal, click **Sign in with Microsoft**, and uncheck a topic. Then reload the student site: the topic is gone.
Only @lausanneschool.com accounts from Lausanne's directory can make changes. Students never sign in.
