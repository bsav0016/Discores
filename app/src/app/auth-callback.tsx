// Landing spot for the OAuth redirect (discores://auth-callback). The sign-in code reads the session from the URL
// itself; this route only keeps the router from showing "not found" while the browser hands control back.
export default function AuthCallback() {
  return null;
}
