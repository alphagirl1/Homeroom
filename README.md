# Homeroom: your own website

Homeroom puts assignments, grades, due dates and announcements from all your school sites in one place. This folder is the whole website: you put it online once, then send your friends one link.

**What you get**
- A real website at `your-name.vercel.app` (or your own domain) that works on phones and computers.
- Accounts with a username and password. Friends join with your invite link, and everyone's data is private.
- A **Logins** page (the key at the top) where each person saves their Genesis, VHL and other usernames and passwords.
- Background syncing every 30 minutes, even when nobody has Homeroom open.
- Phone notifications for new grades and missing work, a morning summary, and due dates on your phone's calendar.
- A Chrome extension for sites that use "Sign in with Google" (Google Classroom, DeltaMath, Savvas, McGraw Hill and others).

**Cost:** free. It uses three free services: Vercel (hosting), Upstash (the database, added from inside Vercel) and cron-job.org (the timer). No credit card needed. The optional AI features use a Claude API key that you pay for per use.

**Time:** about 20 minutes, all in your web browser. You don't need to install anything.

---

## Part 1: Put the code on GitHub (5 min)

1. Make a free account at **github.com**.
2. Click **+** (top right) → **New repository**. Name it `homeroom`, choose **Private**, and click **Create repository**.
3. On the new page, click the **uploading an existing file** link.
4. Unzip `homeroom-website.zip`. Open the `homeroom-website` folder, select **everything inside it** (the `api`, `public`, `server` folders and the other files), and drag it onto the GitHub page.
5. Wait for the files to finish uploading, then click **Commit changes**.

## Part 2: Put it online with Vercel (10 min)

1. Go to **vercel.com** → **Sign Up** → **Continue with GitHub**. Choose the free **Hobby** plan.
2. Click **Add New… → Project**, find `homeroom` in the list, and click **Import**. Leave every setting as it is and click **Deploy**.
3. **Add the database.** In your new project open the **Storage** tab → **Create Database** → **Upstash for Redis** → pick the **Free** plan → **Create** → **Connect** to your homeroom project.
4. **Add the secret.** Open **Settings → Environment Variables**. Add:
   - **Key:** `HOMEROOM_SECRET`
   - **Value:** a long random password with 40 or more letters and numbers. If you open your site before this step, it shows you one to copy.

   Click **Save**. This secret locks everyone's saved passwords. Never share it, and never change it later, or saved logins will stop working.
5. Open the **Deployments** tab. Click **⋯** on the top deployment → **Redeploy**.
6. Open your site (the **Visit** button, or `https://homeroom-<something>.vercel.app`).
7. Click **Create account**. The first account runs the site. Save the **recovery code** it shows you, because it's the only way back in if you forget your password.

If you see an **"Almost there"** page instead, Homeroom is telling you which of steps 3 and 4 it still needs. Do the missing step, then redeploy (step 5).

## Part 3: The background timer (5 min)

Vercel's free plan can't wake Homeroom on its own, so a free service does it.

1. In Homeroom open **Settings** (the sliders icon) → **Run this site** → **Background timer**, and click **Copy** next to the timer link.
2. Go to **cron-job.org** and make a free account.
3. Click **Create cronjob**. Set the title to `Homeroom`, paste the link as the URL, and choose **every 10 minutes**. Click **Create**.

Within 10 minutes, **Run this site** shows the timer as **Running**. Keep the timer link private.

## Part 4: Your logins

Open **Logins**: it's the key at the top of the page (on phones, the key icon).

- **Genesis:** type your Genesis username and password and click **Connect Genesis**. The address is already set to the MCMS student portal.
- **School sites:** open a site, type its username and password, and click **Save & sign in**. Sites with a plain login page (often VHL) work this way. Sites that sign in with JavaScript or Google usually say "Not working"; use the extension for those.
- **Chrome extension:** on the Logins page, click **Download the extension**, unzip it somewhere you'll keep it, go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the folder. Then click **Get my connection code** in Homeroom and paste the code into the extension. It checks Google Classroom, DeltaMath and the others every 30 minutes, but only while Chrome is open on a computer.
- **Calendar links (optional):** add your Google Calendar's "Secret address in iCal format", or any school calendar link.

## Part 5: Invite your friends

Open **Settings → Run this site → Invite friends**, click **Copy link**, and send it. Your friends:
1. open the link (the invite code fills itself in),
2. pick a username and password, and save their recovery code,
3. add their own logins on the Logins page.

They don't need GitHub, Vercel or anything else. Each person sees only their own data. You can remove an account, make a new invite code, or cap how many people can join on the same screen.

## On your phone

- **Install it:** open your site in Safari (iPhone) or Chrome (Android) → **Share → Add to Home Screen** (iPhone) or **⋮ → Install app** (Android).
- **Notifications:** open Homeroom (on iPhone, from the Home Screen icon) → **Settings → Notifications → Turn on notifications on this device**. You can pick new grades, missing work, new assignments, announcements, and a morning summary.
- **Calendar:** **Settings → Sync & calendar → Get my calendar link → Add to Google Calendar** (or Apple Calendar). Due dates show up with reminders the night before and that morning. Google Calendar can take a few hours to pick up changes.

## Optional extras

- **Your own address** (like `homeroom-nethra.com`): buy a domain (about $10–15 a year) from any registrar, then in Vercel go to **Settings → Domains → Add** and follow its steps.
- **AI planner:** each person can paste their own Claude API key in **Settings → Sync & calendar**. Or the site owner can share one key with everyone, with a daily limit per person, in **Run this site → Share your AI key** (you pay for their use).
- **Updating Homeroom:** upload the changed files to the same GitHub repository (**Add file → Upload files**). Vercel redeploys on its own within a minute. If you change anything in `src/`, the site rebuilds `public/index.html` during that deploy.
- **A separate copy for someone else:** anyone can import this code into their own Vercel account and follow Parts 2–3. Each copy has its own accounts and data.

## Running it on your own computer instead

If you'd rather not use Vercel: install Node.js 20 or newer from nodejs.org, open a terminal in this folder, and run:

```
node dev-server.mjs
```

Then open http://localhost:3000. Your data is saved in `homeroom-data.json` in this folder, and it syncs every 5 minutes while the terminal window is open. Only your computer can reach it, so this is for trying things out, not for sharing with friends.

## Privacy and safety

- Homeroom account passwords are stored scrambled (hashed), so nobody can read them, including you as the owner.
- Saved school-site passwords are encrypted with your `HOMEROOM_SECRET`. A leaked database alone doesn't reveal them. The person who runs the site has both the database and the secret, though, so **only use a Homeroom run by someone you trust**. Your friends are trusting you.
- Homeroom stops retrying a site login after 3 failures in a row, and it limits Genesis tries, so your school accounts don't get locked.
- Signing in to school sites from a server goes against some sites' terms of use. The Chrome extension only reads pages you can already see.
- **Settings → Privacy & account → Delete my account** erases everything for that person right away.
- Vercel's free plan is meant for personal, non-commercial projects. The free database comfortably fits about 15–20 students who use Homeroom every day. If it fills up, Upstash will ask you to upgrade, or everyone can set **Check every** to 60 minutes.

## If something's off

- **"Almost there" page:** the database or `HOMEROOM_SECRET` is missing. Follow what it says, then **Redeploy**.
- **Genesis says it didn't accept the login:** sign in at the Genesis page yourself to check your username and password. Too many tries make Homeroom pause Genesis for an hour.
- **Genesis connects but finds 0 assignments:** click **Debug info** on the Logins page and send it to whoever helps you. It shows what Genesis sent back.
- **The extension says Homeroom didn't recognize the code:** click **Make a new code** on the Logins page and paste the new one.
- **Nothing updates while Homeroom is closed:** check that **Run this site** shows the timer as **Running**, and that the cron-job.org job's history shows successful runs.
- **No notifications on iPhone:** they only work from the Home Screen icon, not inside Safari.
- **Forgot your password:** use **Forgot your password?** with your recovery code. If you lost the code too, the site owner can remove your account so you can make a new one.

## What's in this folder

| Path | What it is |
|---|---|
| `public/` | The website itself: the app page, icons, phone-app settings, the downloadable extension |
| `api/index.js` | The one server function Vercel runs |
| `server/` | Accounts, saved logins, Genesis and site sign-ins, syncing, notifications, calendar feed |
| `src/` | The app's source code. `node build.mjs` turns it into `public/index.html` |
| `chrome-extension/` | The extension's source (the same files as the zip in `public/`) |
| `dev-server.mjs` | Runs Homeroom on your own computer |
| `test/` | Automated checks with pretend school sites: `npm test` |
| `vercel.json` | Tells Vercel how to serve everything |
