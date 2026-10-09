import { Redirect } from 'expo-router';

// Landing spot for the link in the sign-up confirmation email (discores://confirm-email). The root layout reads the
// session from the URL; this route only keeps the router from showing "not found" and then returns to the start.
export default function ConfirmEmail() {
  return <Redirect href="/" />;
}
