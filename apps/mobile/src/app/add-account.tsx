import { router, useLocalSearchParams } from 'expo-router';
import { LoginForm } from '../components/LoginForm';

// Over Settings, which Cancel goes back to. Given an account kept, it is that account signed in to again.
export default function AddAccount() {
  const { server, user } = useLocalSearchParams<{ server?: string; user?: string }>();
  return <LoginForm onCancel={router.back} again={server ? { server, user: user ?? '' } : undefined} />;
}
