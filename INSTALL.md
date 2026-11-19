# Install Property Manager

Open the published HTTPS application address in your browser. The source starts at `index.html`. The ready-to-host files are in `dist/` and `Property-Manager-static.zip`. The owner needs a browser, with no build tools or application server to maintain.

## Windows

For a local Windows installation, double-click **Open Property Manager.cmd** in the source folder. Windows PowerShell serves only the packaged `dist` files at **http://127.0.0.1:8769/** and opens your default browser. Keep the window open until the app confirms **Offline ready**. Use Edge or Chrome's Install control. Open this address again for future local updates. This desktop address is a separate data origin from any later HTTPS installation. Use encrypted transfer to move records between them.

1. Open the trusted application address in Edge or Chrome using your regular browser profile. Let the first connected launch finish. The sample household lets you try the app before entering personal information.
2. In Edge, select the install icon in the address bar and choose **Install**. In Chrome, use the install icon or the browser’s install-app menu. Open the installed app and check **Settings → Installation & offline access** for **Offline ready**. [Microsoft Edge installation guidance](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/ux)
3. Close the app, disconnect the network, and open it again. Open Documents and a sample original. Return to the property selector and choose **Set up my rental** to start your separate personal records.

## iPhone

1. Open the same HTTPS address in Safari while connected. Tap **Share → Add to Home Screen**. Depending on the Safari layout, Share is in the Page Menu. If offered, turn on **Open as Web App**, then tap **Add**. [Apple’s Home Screen instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/27/ios/27)
2. Open Property Manager **from the Home Screen while still online**. Wait for **Offline ready** in installation settings. The app verifies the content hashes of all required local assets, including PDF and ZIP code, the embedded typeface, and bundled disclosure PDFs.
3. Quit the installed app, enable airplane mode, and launch it from its icon. Open an original and record a test item in the sample dataset. Test the camera, Files picker, sharing, backup download and restore on your device before relying on them.

A file opened directly from Files or Explorer can offer a local preview. A stable HTTPS origin enables service-worker installation and a cached offline launch. A localhost test origin works on the desktop that serves it. [Service-worker registration](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)

## Publish on GitHub Pages

1. Create an app repository on GitHub with a `main` branch. A public source repository supports Pages on GitHub Free. Private source repositories require a plan that supports private-repository Pages. [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
2. Commit the app source and `.github/workflows/pages.yml` to that repository. The included `.gitignore` allows the reviewed app files into version control and excludes other workspace files by default. Review the staged filenames before your first push. Use GitHub CLI, GitHub Desktop, or Git's credential manager for this publishing account.
3. In the app repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. Push to `main`, or run **Actions → Publish Property Manager → Run workflow**. The build verifies the packaged release and publishes only `dist/`. The deployment uses the workflow's own GitHub credential. [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
4. Open the published address shown on the deployment and check **Settings → Installation & offline access**. Use a dedicated hostname for owner records if other projects share your account's `github.io` hostname. Browser storage access is shared by origin across projects on the same hostname. [GitHub Pages custom domains](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#hosting-on-your-own-custom-domain)
5. Create a separate **private** repository for the encrypted owner workspace. Enter its limited token in the app when syncing. [Private repository setup](BACKUP.md#sync-personal-records-with-github)

This deployment serves a personal-use static app. GitHub restricts commercial transaction sites and advises against using Pages for sensitive transactions. The app authenticates sync requests directly with GitHub's API and encrypts the vault on the device. [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## Host the static release yourself

1. Extract `Property-Manager-static.zip` into its own folder, or use the provided `dist/` directory. Confirm that `index.html`, `sw.js`, `manifest.webmanifest`, `assets/`, and `legal-assets/` are directly inside.
2. On a static HTTPS host, upload **only the contents of that release folder**. For a manual Netlify deployment, sign in at [Netlify Drop](https://app.netlify.com/drop), then drag the extracted release folder into the deployment area. The host returns an HTTPS address. Keep that project and deploy subsequent updates to the same address. [Netlify manual deployment](https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/)
3. Serve files with their normal MIME types, including JavaScript for `sw.js` and `application/manifest+json` for the manifest. Preserve exact asset bytes. Upload all files as one release, using an atomic static deploy where available. Disable HTML injection, minification or URL rewriting that changes installed files. Configure `sw.js` to revalidate. Place the app at a dedicated origin or stable subdirectory.
4. Open the actual HTTPS address and check for **Offline ready**. Install and check each device separately. Keep rental documents, your private workspace folder, exported packages, and backups off the static host.

For maintainers, `node build-static.cjs` prepares the allowlisted release and its ZIP. `node build-static.cjs --check` verifies the checked-in service worker against its assets. The source helper, tests, and development files stay outside the installable release.

## Updates, privacy and recovery

While connected, open installation settings and check for an update. Save or close your work before applying a waiting update. Close other Property Manager tabs when prompted. A waiting release can activate after all older app windows are closed. A new release’s assets must pass integrity checks before it can take over. User records stay in IndexedDB, independent of the application cache.

The initial connection retrieves public application code and materials. Property records, file originals, and exports stay local until you export them or explicitly sync an encrypted snapshot. Web storage can be evicted when the browser or device is under pressure. Maintain encrypted, restore-tested copies in another location. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)

If the address changes, create an encrypted backup at the old origin, then restore or explicitly merge it at the new origin. The same procedure moves work between Windows and iPhone. See [backup and transfer instructions](BACKUP.md).

Email preparation works offline. A mail handoff prepopulates a draft where the mail app supports it. Download attachments or share the files and confirm actual sending in the outbox. [RFC 6068 mailto specification](https://www.rfc-editor.org/rfc/rfc6068)
