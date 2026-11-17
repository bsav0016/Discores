# Using your own domain for the website

The site is at https://bsav0016.github.io/Discores/ today. A short domain of your own (for example `discores.app`, about $12 a year) looks more trustworthy in store listings and shared messages, and keeps working if the site ever moves. Nothing in the code needs to change: the Publish site workflow reads two repository variables.

## One-time setup

1. **Buy the domain** from any registrar. Prefer one that lets you edit DNS records and does not hide them behind a site builder.
2. **Point it at GitHub Pages.** At the registrar's DNS settings, for an apex domain such as `discores.app` add four `A` records with the host `@` and these values: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`. Add a `CNAME` record with the host `www` and the value `bsav0016.github.io`.
3. **Tell GitHub.** Repository Settings, Pages, Custom domain: enter the domain and save. When the DNS check passes, tick **Enforce HTTPS** (it can take up to a day for the certificate).
4. **Tell the site.** Repository Settings, Secrets and variables, Actions, Variables: add `SITE_URL` (with the final slash, for example `https://discores.app/`) and `CUSTOM_DOMAIN` (for example `discores.app`). Then run the **Publish site** workflow from the Actions tab. Canonical links, the sitemap and link previews now use the new address.
5. **Update the places that name the old address:** App Store Connect and Play Console (privacy policy, support and marketing URLs), and the share message in `app/src/domain/share.ts` (`SITE_URL`), which ships with the next app build. The old address keeps redirecting to the new one for a while, so nothing breaks in between.

## If something goes wrong

- Pages shows "DNS check unsuccessful": the records are not live yet, or a leftover record for the same host conflicts. Wait an hour and check the records match step 2.
- The site opens but without styling or images: `SITE_URL` is missing its final slash or `CUSTOM_DOMAIN` does not match the Pages setting.
- To go back, remove the Custom domain in Pages settings and delete both variables, then run the workflow.
