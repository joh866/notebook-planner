# Connecting Google Calendar

These are the steps you do by hand, once, to let Planner read your Google Calendar (spec §14). About 15 minutes. You need the Google account whose calendar you use.

Where a step says **Mac**, use Terminal on your Mac. **Droplet** means after `ssh planner@planner.getclearpages.com`. **Browser** means a web page.

## 1. Make a Google Cloud project (browser)

- [ ] Open https://console.cloud.google.com and sign in with your Google account.
- [ ] At the top, open the project picker, choose **New project**, name it `Planner`, and click **Create**. Make sure `Planner` is the selected project afterward.

## 2. Turn on the Calendar API (browser)

- [ ] Open https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
- [ ] Click **Enable**.

## 3. Set up the sign-in screen (browser)

- [ ] Open https://console.cloud.google.com/auth/overview and click **Get started**.
- [ ] **App name:** `Planner`. **User support email:** your email. Click **Next**.
- [ ] **Audience:** choose **External**. Click **Next**.
- [ ] **Contact information:** your email. Click **Next**, agree to the policy, and click **Create**.

## 4. Choose what Planner may do (browser)

- [ ] Open **Data Access** (left side), then click **Add or remove scopes**.
- [ ] In "Manually add scopes", paste these two lines, then click **Add to table**, then **Update**, then **Save**:

```
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/calendar.app.created
```

The first lets Planner **read** your calendars. The second lets it make one calendar of its own, called "Planner", and change only the events in that one. It can't change or delete anything else.

## 5. Publish the app, so the sign-in lasts (browser)

While the app is in "Testing", Google ends calendar sign-ins after 7 days.

- [ ] Open **Audience** (left side). Under "Publishing status", click **Publish app**, then **Confirm**. It should say **In production**.

You don't need Google to verify the app, since only you use it. When you connect, Google will say "Google hasn't verified this app". That's expected. Click **Advanced**, then **Go to Planner (unsafe)**.

## 6. Make the sign-in client (browser)

- [ ] Open **Clients** (left side), then click **Create client**.
- [ ] **Application type:** Web application. **Name:** `Planner`.
- [ ] Under **Authorized redirect URIs**, click **Add URI** twice and enter both of these exactly:

```
https://planner.getclearpages.com/api/google/callback
http://localhost:5173/api/google/callback
```

- [ ] Click **Create**. A box shows the **Client ID** and **Client secret**. Click **Download JSON** and keep the file somewhere private, since Google may not show the secret again. Don't paste it in a chat.

## 7. Give the keys to the droplet (droplet)

- [ ] Sign in: `ssh planner@planner.getclearpages.com`
- [ ] Open `.env` in an editor:

```bash
nano ~/notebook-planner/.env
```

- [ ] Add these three lines with your own client ID and secret (from step 6), then save with Ctrl+O, Enter, and Ctrl+X:

```
GOOGLE_CLIENT_ID=paste-the-client-id-here
GOOGLE_CLIENT_SECRET=paste-the-client-secret-here
GOOGLE_REDIRECT_URI=https://planner.getclearpages.com/api/google/callback
```

- [ ] Restart the app:

```bash
sudo systemctl restart planner
```

- [ ] Check that it saw them. The last line should end with "Google Calendar on":

```bash
journalctl -u planner -n 5 --no-pager
```

## 8. Connect (browser, on the live app)

- [ ] Open https://planner.getclearpages.com, then the gear, then **Connections**, then **Google Calendar**, then **Connect**.
- [ ] Choose your Google account, click through the "hasn't verified" notice (step 5), and allow both permissions.
- [ ] You come back to Planner, and it says "Google Calendar is connected." Your events show on the schedule in gray.
- [ ] In Settings, tick the calendars you want to see. Your main calendar, and any shown in Google Calendar's own list, start ticked.
- [ ] Optional: tick **Send planned blocks to Google**. Planner makes a calendar called "Planner" in your Google account and keeps it up to date. Untick it to take those events off again.

## On your Mac (optional)

To try it on localhost, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.env` on your Mac too (no `GOOGLE_REDIRECT_URI` needed), then run `npm run dev`. Connecting there links your Mac's own copy of the data, not the live one.

## If something goes wrong

- **"redirect_uri_mismatch" from Google:** the address in step 6 doesn't exactly match. Check for `https`, no slash at the end, and the right subdomain.
- **Settings says "Google ended the sign-in":** the app may still be in Testing (step 5), or you removed Planner's access in your Google account. Publish it, then click **Connect again**.
- **To disconnect:** Settings, then **Disconnect**. That takes Planner's events off your Google calendar, ends the sign-in, and removes Google events from Planner. You can also remove access at https://myaccount.google.com/permissions.
