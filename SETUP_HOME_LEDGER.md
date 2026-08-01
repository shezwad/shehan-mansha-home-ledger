# Home Ledger — Fresh Setup Guide

This package contains the complete **Home Ledger** app. It is designed for two household members using separate accounts while sharing the same income, expense, budget-period, and fixed-bill records.

Home Ledger uses:

- **GitHub Pages** to publish the app interface.
- **Firebase Authentication** for separate private accounts.
- **Cloud Firestore** for the shared household database.
- Firebase's **Spark no-cost plan**. Do not add a billing account.

The GitHub website code is public, but your financial records are stored in Firestore and protected by the supplied security rules.

## Part 1 — Create the Firebase project

1. Open the Firebase Console: `https://console.firebase.google.com/`.
2. Select **Create a project**.
3. Use a project name such as `home-ledger-family`.
4. Google Analytics is optional and may be left off.
5. Keep the project on the **Spark** no-cost plan.

## Part 2 — Register Home Ledger as a web app

1. On the Firebase project overview, select the **Web** icon (`</>`).
2. Enter an app nickname such as `Home Ledger`.
3. Do not enable Firebase Hosting; GitHub Pages will host the app.
4. Select **Register app**.
5. Firebase displays a configuration object containing values such as `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, and `appId`.
6. On your computer, open `firebase-config.js` from the Home Ledger folder.
7. Replace every `REPLACE_WITH_...` value with the matching value shown by Firebase.
8. Save the file. Keep `export const firebaseConfig = {` unchanged.

Example structure:

```javascript
export const firebaseConfig = {
  apiKey: "your-value",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "your-value",
  appId: "your-value"
};
```

## Part 3 — Enable email and password accounts

1. In Firebase, open **Build → Authentication**.
2. Select **Get started**.
3. Open **Sign-in method**.
4. Select **Email/Password**.
5. Enable **Email/Password** and save.

You will add the GitHub Pages domain after GitHub gives you the website address.

## Part 4 — Create Firestore and publish the security rules

1. In Firebase, open **Build → Firestore Database**.
2. Select **Create database**.
3. Choose the standard/native Firestore database option.
4. Choose **Production mode**.
5. Select a database location near you.
6. After creation, open the **Rules** tab.
7. Open `firestore.rules` from this package.
8. Copy the entire file and replace everything in the Firebase Rules editor.
9. Select **Publish**.

Do not leave Firestore in test mode.

## Part 5 — Create a new GitHub repository

1. Sign in to GitHub.
2. Select **New repository**.
3. Name it something simple, such as `home-ledger`.
4. Choose **Public**. GitHub Pages on a normal free personal account publishes from a public repository.
5. Create the repository.
6. Upload **all files and folders inside the `Home_Ledger` folder**. Upload the contents, not the ZIP file itself.
7. Confirm that `index.html` is at the top level of the repository.
8. Commit the uploaded files.

The repository should contain files such as:

```text
index.html
app.css
app.js
bootstrap.js
firebase-config.js
firestore.rules
manifest.webmanifest
sw.js
icons/
```

## Part 6 — Turn on GitHub Pages

1. In the GitHub repository, open **Settings → Pages**.
2. Under the publishing source, select **Deploy from a branch**.
3. Select the `main` branch and the `/(root)` folder.
4. Save.
5. Return to **Settings → Pages** after deployment completes.
6. Copy the displayed website address. It normally looks like:

```text
https://YOUR-USERNAME.github.io/home-ledger/
```

## Part 7 — Authorize your GitHub Pages domain in Firebase

1. Return to Firebase.
2. Open **Authentication → Settings → Authorized domains**.
3. Select **Add domain**.
4. Enter only the host part of the GitHub Pages address, for example:

```text
YOUR-USERNAME.github.io
```

Do not include `https://`, slashes, or the repository name.

## Part 8 — Create and share the household

### On your iPhone

1. Open the GitHub Pages address in Safari.
2. Select **Create account**.
3. Create your personal account.
4. Select **Create household**.
5. Enter a household name.
6. Open **Settings → Household sharing**.
7. Select **Copy household code** and send it privately to your wife.

### On your wife's iPhone

1. Open the same GitHub Pages address in Safari.
2. Select **Create account** and use her own email and password.
3. Select **Join household**.
4. Enter the household code you sent her.

Both accounts will now read and update the same household records.

## Part 9 — Install Home Ledger on both iPhones

On each iPhone:

1. Open the Home Ledger website in Safari.
2. Tap **Share**.
3. Tap **Add to Home Screen**.
4. Turn on **Open as Web App** when that option is shown.
5. Tap **Add**.

## Part 10 — Add budget periods, entries, and fixed bills

### Custom budget period

Open **Periods → New period** and choose any start and end dates. For example, the period may run from August 15 through September 14.

### Daily income and expenses

Open **Overview** or **Entries**, select **Add entry**, and enter the date, amount, category, description, and optional household member.

### Recurring fixed bills

1. Open **Fixed → Add fixed bill**.
2. Enter the bill name, amount, and first or next due date.
3. Select **Monthly**, **Every 3 months**, **Every 6 months**, or **Yearly**.
4. Choose how many days before the due date the in-app reminder should begin showing.
5. Save the bill and keep it active.
6. Use **Add due bills to period** to create upcoming/unpaid expense entries for bills due during the selected budget period.

Bills due on the 29th, 30th, or 31st automatically use the final valid day in shorter months.

## Part 11 — Add iPhone Calendar alerts

The in-app reminder panel is shared automatically. iPhone Calendar events are stored separately on each phone, so each person should complete this once:

1. Open **Fixed**.
2. Select **Add reminder** for one bill, or **Add all reminders**.
3. Open/share the generated calendar file.
4. Add the events to the iPhone Calendar.

The calendar file includes adjusted month-end dates for the next 15 years. If you later change a bill's due date or recurrence, remove the old Calendar event and add the reminder again.

## Privacy and safety

- Never publish or post the household code.
- Use different strong passwords for both accounts.
- Keep `firestore.rules` exactly as supplied unless you understand Firebase Security Rules.
- The Firebase web configuration is visible in the public repository by design; it is not a password. Database access is controlled by Authentication and Firestore rules.
- Export a full JSON backup periodically from **Settings**.
- CSV export is available for viewing entries in Excel or another spreadsheet app.
