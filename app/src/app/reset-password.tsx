import { Redirect } from 'expo-router';

// Landing spot for the link in a password-reset email (discores://reset-password#...). The root layout reads the
// session from the URL and shows the "choose a new password" screen itself, replacing this route. If that did not
// happen (a link that is expired or malformed), go back to the start instead of leaving a blank screen.
export default function ResetPasswordLanding() {
  return <Redirect href="/" />;
}
