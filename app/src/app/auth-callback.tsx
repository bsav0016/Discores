import { Redirect } from 'expo-router';

// Landing spot for the OAuth redirect (discores://auth-callback). The sign-in code reads the session from the URL
// itself; this route only keeps the router from showing "not found" and then returns to the start.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
