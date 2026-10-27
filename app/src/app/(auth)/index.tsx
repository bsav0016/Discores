import { Redirect } from 'expo-router';

// Where "/" lands when nobody is signed in (the tabs, which also own "/", are guarded off).
export default function AuthIndex() {
  return <Redirect href="/sign-in" />;
}
