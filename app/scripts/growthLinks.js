// Store links tagged so each place that sends people to the stores can be told apart in the store consoles. No tracker or
// script is involved: the stores count the installs themselves (App Store Connect > App Analytics > Campaigns, Google
// Play Console > Statistics > Acquisition by UTM). Campaigns in use are listed in docs/GROWTH_LINKS.md.
//
// Campaign names are lower-case words and dashes, at most 40 characters (the App Store limit for a campaign token).

// The App Store only reports a campaign link that also carries the account's provider token ("pt"), shown in App Store
// Connect when you build a campaign link there. It is public (it is in every campaign link) and not a secret. Leave it
// empty until it is known: links then carry the campaign name but the App Store will not report on it.
const APP_STORE_PROVIDER_TOKEN = '';

const CAMPAIGN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function assertCampaign(campaign) {
  if (!CAMPAIGN.test(campaign) || campaign.length > 40) {
    throw new Error(`Campaign must be lower-case words and dashes, 40 characters at most: ${campaign}`);
  }
}

/**
 * The same store link with a campaign added. App Store links get ct (and pt when known); Google Play links get an
 * install referrer carrying UTM values. Any other address is returned unchanged.
 */
function tagStoreLink(url, campaign, medium = 'organic') {
  assertCampaign(campaign);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname === 'apps.apple.com') {
    if (APP_STORE_PROVIDER_TOKEN) parsed.searchParams.set('pt', APP_STORE_PROVIDER_TOKEN);
    parsed.searchParams.set('ct', campaign);
    parsed.searchParams.set('mt', '8');
    return parsed.toString();
  }
  if (parsed.hostname === 'play.google.com') {
    parsed.searchParams.set('referrer', `utm_source=${campaign}&utm_medium=${medium}&utm_campaign=${campaign}`);
    return parsed.toString();
  }
  return url;
}

module.exports = { tagStoreLink };
