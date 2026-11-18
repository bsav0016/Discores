# Tagged store links

Every store button on the website carries a campaign, so the store consoles can tell you which page sent an install.
Nothing is added to the site or the app to do this (no script, no tracker): the stores count installs themselves, and
the privacy policy is unchanged.

## What is tagged

| Where | Campaign |
| --- | --- |
| Home page | `web-index` |
| FAQ | `web-faq` |
| Press kit | `web-press` |
| Every course page (state, country, course) | `web-courses` |

Course pages share one campaign on purpose: a campaign per region would be hundreds of names, and the question the
console needs to answer is whether the course pages bring installs at all.

The links are built by `app/scripts/growthLinks.js` (tested in `growthLinks.test.js`). For a new place you post (a club
page, a Reddit thread, a flyer), pick a name like `reddit-discgolf` (lower case, words and dashes, 40 characters at most)
and build the links in a terminal:

```
node -e "const g=require('./app/scripts/growthLinks'); console.log(g.tagStoreLink('https://apps.apple.com/us/app/discores-disc-golf-scorecard/id6820334635','reddit-discgolf')); console.log(g.tagStoreLink('https://play.google.com/store/apps/details?id=com.discores.app','reddit-discgolf','reddit'))"
```

Add the name to the table above so a campaign in a console can be traced back.

## The App Store provider token (already set)

The App Store only reports a campaign link that also carries the account's provider token (`pt`). In App Store Connect,
open the app, App Analytics, Campaigns, Create Campaign Link, and copy the number after `pt=` into
`APP_STORE_PROVIDER_TOKEN` in `app/scripts/growthLinks.js`, then rebuild the site (`node app/scripts/build-site.mjs`).
The token is public (it is in every campaign link) and is not a secret. It is the same for every app on the account.
The provider token is set (122126127, 2026-11-18), so the App Store reports these campaigns in App Analytics. Google Play needs nothing.

## Reading the results

- App Store Connect, App Analytics, Acquisition, Campaigns: first-time downloads per campaign.
- Google Play Console, Statistics: the UTM source and campaign dimensions under acquisition.
- Search traffic to the course pages: Google Search Console, after submitting `sitemap.xml`.
